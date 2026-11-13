import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { writeFile, readFile } from 'node:fs/promises'
import { syntheticRestoreQuarantine, quarantineDigest } from '../scripts/database/synthetic-restore-quarantine.mjs'
import { dirname, join } from 'node:path'
import { syntheticRecoveryProvider, syntheticProviderHistory } from './helpers/recovery-provider.mjs'
import { temporaryProbeJournal } from './helpers/probe-journal-temp.mjs'
import { initializeBackupRehearsal, runScheduledBackup, createBackupAnchor, readAnchoredBackup } from '../scripts/database/backup-readiness.mjs'
import { initializeTrustStore, advanceTrustAnchor, readTrustHead } from '../scripts/database/trust-anchor-store.mjs'
import { startAdminTestApi, syntheticPassword } from './helpers/admin-postgres.mjs'
import { createApi } from '../server/app.mjs'
import { newToken, tokenHash } from '../server/auth.mjs'
import { deliverNotifications } from '../server/notifications.mjs'
import { migrate } from '../scripts/database/migrate.mjs'
import { recoveryTarget, postgresArchive, recoveryFingerprint } from '../scripts/database/recovery.mjs'

const ids = { citizen: '00000000-0000-4000-8000-000000000001',
  village: '30000000-0000-4000-8000-000000000001', hospital: '40000000-0000-4000-8000-000000000001',
  vehicle: '50000000-0000-4000-8000-000000000001', driver: '60000000-0000-4000-8000-000000000001',
  depot: '20000000-0000-4000-8000-000000000001' }
const businessTime = '2030-01-12T00:00:00Z'

test('recovery tooling refuses nonlocal servers, other ports and persistent database names', () => {
  const generated = `pt_test_${'a'.repeat(32)}`
  for (const [url, name] of [
    ['postgres://user@remote:54329/postgres', generated],
    ['postgres://user@localhost:5432/postgres', generated],
    ['postgres://user@localhost:54329/postgres', 'patient_transfer'],
    ['postgres://user@localhost:54329/postgres', `${generated}";DROP DATABASE postgres`],
  ]) assert.throws(() => recoveryTarget(url, name), /generated local test database/)
  assert.equal(recoveryTarget('postgres://user@127.0.0.1:54329/postgres', generated).database, generated)
  assert.throws(() => postgresArchive('postgres://user@localhost:54329/postgres', generated, { snapshot: 'invalid' }), /snapshot/)
})

for (const { encrypted, ambiguity, quarantine } of [
  { encrypted: false }, { encrypted: true },
  { encrypted: true, ambiguity: 'within-window' }, { encrypted: true, ambiguity: 'expired-window' },
  { encrypted: true, ambiguity: 'within-window', quarantine: true },
]) test(`${encrypted ? 'encrypted retained/persisted-trust' : 'in-memory plain'} recovery restores service${ambiguity ? ' with post-snapshot acceptance ' + ambiguity : ''}${quarantine ? ' under quarantine' : ''}`, {
  skip: !process.env.DATABASE_TEST_ADMIN_URL, timeout: 180000,
}, async t => {
  const adminUrl = process.env.DATABASE_TEST_ADMIN_URL
  const restoredName = `pt_test_${randomUUID().replaceAll('-', '')}`
  recoveryTarget(adminUrl, restoredName)
  const admin = new pg.Client({ connectionString: adminUrl }), temp = await temporaryProbeJournal()
  let source, restoredPool, restoredServer, sourceClosed = false, restoredCreated = false
  const tokens = { citizen: newToken(), other: newToken(), revoked: newToken() }
  let base
  async function request(path, role, body, expected = 200) {
    const response = await fetch(`${base}/api${path}`, { method: body ? 'POST' : 'GET',
      headers: { ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) })
    // Never print response payloads: even a recovery test should not expose credentials.
    assert.equal(response.status, expected, `Unexpected HTTP status on ${path}`)
    return response.json()
  }
  async function login(role) {
    tokens[role] = (await request('/auth/login', null, { username: `synthetic-${role}`, password: syntheticPassword })).token
  }
  async function intake(name, appointmentAt = '2030-01-15T09:00:00+07:00') {
    const consent = await request('/consents', 'citizen', { accepted: true, noticeVersion: 'development-v1' }, 201)
    return request('/bookings', 'citizen', { consentId: consent.id, bookingFor: 'self', patientName: name,
      requesterName: 'ผู้ขอทดสอบการกู้คืน', contactPhone: '0800000000', pickupAddress: 'จุดรับสังเคราะห์',
      latitude: 18.59, longitude: 99.05, villageId: ids.village, hospitalId: ids.hospital,
      mobility: 'standard', appointmentAt }, 201)
  }
  const command = (booking, type) => request(`/bookings/${booking.id}/commands`, 'dispatcher', {
    eventId: randomUUID(), expectedRevision: booking.revision, expectedExecutionVersion: booking.executionVersion, command: { type },
  })
  try {
    await admin.connect()
    source = await startAdminTestApi(adminUrl, { clock: () => businessTime,
      route: async () => ({ minutes: 15, source: 'synthetic-recovery' }) })
    base = source.base
    const sourceName = (await source.pool.query('SELECT current_database() AS name')).rows[0].name
    recoveryTarget(adminUrl, sourceName)
    await source.pool.query('UPDATE patient_transfer.users SET line_subject=$1 WHERE id=$2', [`U${'a'.repeat(32)}`, ids.citizen])
    const otherId = randomUUID()
    await source.pool.query("INSERT INTO patient_transfer.users(id,role,display_name) VALUES($1,'citizen','Synthetic other owner')", [otherId])
    for (const [role, user] of [['citizen', ids.citizen], ['other', otherId], ['revoked', ids.citizen]]) {
      await source.pool.query(`INSERT INTO patient_transfer.auth_sessions(user_id,token_hash,access_version,created_at,expires_at,revoked_at)
        SELECT id,$1,access_version,'2030-01-01','2031-01-01', $3::timestamptz FROM patient_transfer.users WHERE id=$2`,
      [tokenHash(tokens[role]), user, role === 'revoked' ? businessTime : null])
    }
    for (const role of ['dispatcher', 'driver', 'admin']) await login(role)
    for (const [field, id] of [['vehicle_id', ids.vehicle], ['driver_id', ids.driver]]) {
      await source.pool.query(`INSERT INTO patient_transfer.availability_windows(${field},starts_at,ends_at) VALUES($1,'2030-01-14T23:00Z','2030-01-15T09:00Z')`, [id])
    }
    let booking = await intake('ผู้ป่วยสังเคราะห์ก่อนสำรอง')
    booking = await command(booking, 'APPROVE')
    const selection = row => ({ eventId: randomUUID(), expectedRevision: row.revision,
      vehicleId: ids.vehicle, driverId: ids.driver, originLocationId: ids.depot })
    booking = await request(`/bookings/${booking.id}/schedule`, 'dispatcher', selection(booking))
    booking = await request(`/bookings/${booking.id}/assignment`, 'dispatcher', selection(booking))
    // Preserve both consumed retry history and still-pending work in the recovery point.
    await deliverNotifications(source.pool, async () => ({ ok: false, retry: true, code: 'LINE_HTTP_503' }), {
      now: businessTime, limit: 1, publicAppUrl: 'https://municipality.example',
    })
    let legacyId
    if (ambiguity === 'expired-window') {
      // A synthetic legacy row whose pre-snapshot send history is unavailable.
      legacyId = (await source.pool.query("SELECT n.id FROM patient_transfer.notifications n JOIN patient_transfer.users u ON u.id=n.recipient_id WHERE n.attempts=0 AND u.line_subject ~ '^U[a-f0-9]{32}$' ORDER BY n.id LIMIT 1")).rows[0].id
      await source.pool.query('UPDATE patient_transfer.notifications SET attempts=2 WHERE id=$1', [legacyId])
    }
    const snapshotNotifications = (await source.pool.query('SELECT id,attempts FROM patient_transfer.notifications ORDER BY id')).rows
    const providerPath = join(dirname(temp.path), 'synthetic-provider.json')
    let originalAcceptances = 0, originalAcceptedIds = []
    const beforeBooking = await request(`/bookings/${booking.id}`, 'dispatcher')
    let archive, fingerprint, recoveryPoint
    const backup = { directory: join(dirname(temp.path), 'backups'), source: { connectionString: adminUrl, database: sourceName }, encryptionKey: randomBytes(32) }
    const trust = { directory: join(dirname(temp.path), 'trust'), backupDirectory: backup.directory }
    let expectedHead
    async function captureSnapshot() {
      const snapshotClient = await source.pool.connect()
      try {
        // Conservative database timestamp before acquiring the exported MVCC snapshot.
        recoveryPoint = (await snapshotClient.query('SELECT clock_timestamp() AS at')).rows[0].at
        await snapshotClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const { snapshot } = (await snapshotClient.query('SELECT pg_export_snapshot() AS snapshot')).rows[0]
        fingerprint = await recoveryFingerprint(snapshotClient)
        assert.ok(fingerprint['patient_transfer.bookings'].rows > 0)
        assert.ok(fingerprint['patient_transfer.trip_events'].rows >= 3)
        assert.ok(fingerprint['patient_transfer.audit_logs'].rows > 0)
        assert.ok(fingerprint['patient_transfer.notification_attempts'].rows > 0)
        const bytes = await postgresArchive(adminUrl, sourceName, { snapshot })
        assert.ok(bytes.length > 0)
        await snapshotClient.query('COMMIT')
        return { archive: bytes, recoveryPointAt: recoveryPoint.toISOString() }
      } finally { try { await snapshotClient.query('ROLLBACK') } finally { snapshotClient.release() } }
    }
    const dumpStarted = performance.now()
    if (encrypted) {
      await initializeBackupRehearsal({ ...backup, anchorAt: new Date(Date.now() - 1000).toISOString() })
      const run = await runScheduledBackup({ ...backup, at: new Date().toISOString(), capture: captureSnapshot })
      assert.equal(run.manifest.status, 'SUCCESS')
      await initializeTrustStore(trust)
      expectedHead = (await advanceTrustAnchor({ ...trust, expectedHead: null,
        nextAnchor: await createBackupAnchor(backup), operationId: randomUUID() })).head
      // Retain no plaintext archive for recovery; reload bytes and trust only after source loss.
      assert.equal(archive, undefined)
    } else archive = (await captureSnapshot()).archive
    const dumpMs = performance.now() - dumpStarted
    if (ambiguity) {
      await deliverNotifications(source.pool, syntheticRecoveryProvider(providerPath, '2030-01-12T00:01:00Z'), {
        now: '2030-01-12T00:01:00Z', limit: 100, publicAppUrl: 'https://municipality.example' })
      const history = await syntheticProviderHistory(providerPath)
      originalAcceptances = history.filter(row => row.accepted).length
      originalAcceptedIds = history.filter(row => row.accepted).map(row => row.retryKey)
      assert.ok(originalAcceptances > 0)
      assert.equal(new Set(originalAcceptedIds).size, originalAcceptances)
      assert.ok(originalAcceptedIds.every(id => snapshotNotifications.some(row => row.id === id)))
      if (legacyId) assert.equal(originalAcceptedIds.includes(legacyId), false)
      assert.equal((await source.pool.query("SELECT count(*)::int AS n FROM patient_transfer.notifications WHERE status='SENT'")).rows[0].n, originalAcceptances)
    }
    const lostBooking = await intake('ผู้ป่วยสังเคราะห์หลังจุดสำรอง')
    const recoveryStarted = performance.now()
    const failureAt = (await source.pool.query('SELECT clock_timestamp() AS at')).rows[0].at
    // Source loss is confined to the unique database created by the fixture.
    await source.close(); sourceClosed = true
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [sourceName])).rowCount, 0)
    if (encrypted) {
      const persisted = await readTrustHead({ ...trust, expectedHead })
      assert.deepEqual(persisted, expectedHead)
      await assert.rejects(readAnchoredBackup({ ...backup, trustedAnchor: persisted.anchor, slot: 0, encryptionKey: randomBytes(32) }), { message: 'BACKUP_TRUST_VERIFICATION_FAILED' })
      await assert.rejects(readAnchoredBackup({ ...backup, slot: 0 }), { message: 'BACKUP_TRUST_VERIFICATION_FAILED' })
      const retained = await readAnchoredBackup({ ...backup, trustedAnchor: persisted.anchor, slot: 0 })
      assert.equal(retained.manifest.recoveryPointAt, recoveryPoint.toISOString())
      archive = retained.archive
    }
    await admin.query(`CREATE DATABASE "${restoredName}"`); restoredCreated = true
    const restoreStarted = performance.now()
    await assert.rejects(postgresArchive(adminUrl, restoredName, { archive: Buffer.from('Synthetic corrupt archive') }), /pg_restore failed/)
    await postgresArchive(adminUrl, restoredName, { archive })
    const restoreMs = performance.now() - restoreStarted
    const url = new URL(adminUrl); url.pathname = `/${restoredName}`
    restoredPool = new pg.Pool({ connectionString: url.toString() })
    const restoredClient = await restoredPool.connect()
    try {
      await restoredClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      assert.deepEqual(await recoveryFingerprint(restoredClient), fingerprint)
      await restoredClient.query('COMMIT')
      assert.ok((await migrate(restoredClient, 'status')).every(row => row.applied))
    } finally { restoredClient.release() }
    assert.equal((await restoredPool.query('SELECT count(*)::int AS n FROM patient_transfer.bookings WHERE id=$1', [lostBooking.id])).rows[0].n, 0)
    restoredServer = createApi({ pool: restoredPool, clock: () => businessTime, noticeVersion: 'development-v1',
      liffId: '', verifyLine: async () => { throw new Error('External LINE disabled') }, noticeText: 'Synthetic recovery notice',
      route: async () => ({ minutes: 15, source: 'synthetic-recovery' }) })
    await new Promise(resolve => restoredServer.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${restoredServer.address().port}`
    await request(`/bookings/${booking.id}`, null, undefined, 401)
    await request(`/bookings/${booking.id}`, 'revoked', undefined, 401)
    await request(`/bookings/${booking.id}`, 'other', undefined, 403)
    await request(`/bookings/${booking.id}`, 'admin', undefined, 403)
    await request('/admin/accounts', 'citizen', undefined, 403)
    assert.deepEqual((await request('/bookings', 'other')).bookings, [])
    assert.equal((await request(`/bookings/${booking.id}`, 'citizen')).reference, booking.reference)
    assert.deepEqual(await request(`/bookings/${booking.id}`, 'dispatcher'), beforeBooking)
    await login('dispatcher'); await login('driver'); await login('admin')
    await request('/admin/accounts', 'admin')
    await request('/auth/login', null, { username: 'synthetic-dispatcher', password: 'Synthetic-Wrong-Password-123' }, 401)
    // Resume the restored retry within its 24-hour provider key boundary, before execution-day travel.
    const sent = []
    const retryAt = ambiguity === 'expired-window' ? '2030-01-13T00:01:00.000Z' : '2030-01-12T00:02:00.000Z'
    const persistedSender = ambiguity ? syntheticRecoveryProvider(providerPath, retryAt) : async () => ({ ok: true })
    const sendSynthetic = async message => { sent.push(message); return persistedSender(message) }
    const restoredNotifications = (await restoredPool.query('SELECT id,attempts FROM patient_transfer.notifications ORDER BY id')).rows
    assert.deepEqual(restoredNotifications, snapshotNotifications)
    let beforeAttempt, quarantineEvidence, quarantineOptions
    if (quarantine) {
      const rows = (await restoredPool.query('SELECT to_jsonb(n) AS row FROM patient_transfer.notifications n ORDER BY id')).rows.map(row => row.row)
      const provider = await syntheticProviderHistory(providerPath)
      const restoreId = randomUUID(), evidencePath = join(dirname(temp.path), 'reconciliation.json')
      quarantineEvidence = { version: 1, scope: 'synthetic-local-only', restoreId,
        databaseHash: quarantineDigest(restoredName), recoveryAnchorHash: expectedHead.hash,
        reviewer: 'synthetic-reviewer-service-owner', reviewedAt: retryAt,
        decisions: rows.map(row => {
          const accepted = provider.find(item => item.retryKey === row.id && item.accepted)
          return { notificationId: row.id, rowDigest: quarantineDigest(row),
            decision: accepted ? 'RETRY_WITHIN_WINDOW' : 'CONFIRMED_NOT_ACCEPTED',
            firstProviderUseAt: accepted ? new Date(accepted.at).toISOString() : null, evidenceRef: quarantineDigest(accepted ?? ['checked-no-acceptance', row.id]) }
        }) }
      quarantineOptions = { source: { connectionString: adminUrl, database: restoredName }, restoreId,
        recoveryAnchorHash: expectedHead.hash, evidencePath, expectedEvidenceDigest: quarantineDigest(quarantineEvidence) }
      const before = await recoveryFingerprint(restoredPool), ledgerBefore = await readFile(providerPath, 'utf8')
      async function denied(evidence, patch = {}, now = retryAt) {
        if (evidence) await writeFile(evidencePath, JSON.stringify(evidence))
        const options = { ...quarantineOptions, ...(evidence ? { expectedEvidenceDigest: quarantineDigest(evidence) } : {}), ...patch }
        await assert.rejects(deliverNotifications(restoredPool, sendSynthetic, { now, limit: 100,
          publicAppUrl: 'https://municipality.example', beforeAttempt: syntheticRestoreQuarantine(options) }), { message: 'RESTORE_QUARANTINE_BLOCKED' })
        assert.equal(sent.length, 0)
        assert.deepEqual(await recoveryFingerprint(restoredPool), before)
        assert.equal(await readFile(providerPath, 'utf8'), ledgerBefore)
      }
      await denied(null) // No evidence file: do not reserve an attempt or call a provider.
      for (const change of [
        evidence => { evidence.restoreId = randomUUID() },
        evidence => { evidence.recoveryAnchorHash = '0'.repeat(64) },
        evidence => { evidence.databaseHash = '0'.repeat(64) },
        evidence => { evidence.reviewedAt = '2030-01-12T00:03:00.000Z' },
        evidence => { evidence.decisions.forEach(row => { row.rowDigest = '0'.repeat(64) }) },
        evidence => { evidence.decisions.forEach(row => { row.decision = 'HOLD'; row.firstProviderUseAt = null }) },
        evidence => { evidence.decisions.push(evidence.decisions[0]) },
        evidence => { evidence.decisions = [] },
      ]) {
        const evidence = structuredClone(quarantineEvidence); change(evidence); await denied(evidence)
      }
      await denied(quarantineEvidence, { expectedEvidenceDigest: '0'.repeat(64) })
      await denied(quarantineEvidence, {}, '2030-01-13T00:01:00.000Z')
      await writeFile(evidencePath, JSON.stringify(quarantineEvidence))
      beforeAttempt = syntheticRestoreQuarantine(quarantineOptions)
    }
    await deliverNotifications(restoredPool, sendSynthetic, { now: retryAt, limit: 100, publicAppUrl: 'https://municipality.example', ...(beforeAttempt ? { beforeAttempt } : {}) })
    assert.ok(sent.length > 0)
    assert.equal(new Set(sent.map(row => row.retryKey)).size, sent.length)
    const retry = (await restoredPool.query(`SELECT n.id,n.status,n.attempts,n.failure_code,n.next_attempt_at FROM patient_transfer.notifications n
      WHERE EXISTS(SELECT 1 FROM patient_transfer.notification_attempts a WHERE a.notification_id=n.id AND a.failure_code='LINE_HTTP_503')`)).rows
    assert.equal(retry.length, 1)
    if (ambiguity) assert.equal(originalAcceptedIds.includes(retry[0].id), true)
    let duplicateAcceptances = 0
    if (ambiguity === 'expired-window') {
      assert.equal(retry[0].status, 'FAILED'); assert.equal(retry[0].attempts, 1)
      assert.equal(retry[0].failure_code, 'RETRY_KEY_EXPIRED'); assert.equal(retry[0].next_attempt_at, null)
      const legacy = (await restoredPool.query('SELECT attempts,failure_code,next_attempt_at FROM patient_transfer.notifications WHERE id=$1', [legacyId])).rows[0]
      assert.equal(legacy.attempts, 2); assert.equal(legacy.failure_code, 'RETRY_HISTORY_UNKNOWN'); assert.equal(legacy.next_attempt_at, null)
      assert.equal(sent.some(row => row.retryKey === legacyId || row.retryKey === retry[0].id), false)
    } else {
      assert.equal(retry[0].status, 'SENT'); assert.equal(retry[0].attempts, 2)
    }
    if (ambiguity) {
      // Reload the independent provider ledger after source loss, not source outbox state.
      const history = await syntheticProviderHistory(providerPath)
      const callsAfterRestore = history.slice(originalAcceptances)
      assert.equal(callsAfterRestore.length, sent.length)
      assert.ok(callsAfterRestore.every(row => snapshotNotifications.some(n => n.id === row.retryKey)))
      duplicateAcceptances = history.filter(row => row.accepted).length - originalAcceptances
      if (ambiguity === 'within-window') {
        assert.equal(duplicateAcceptances, 0)
        assert.ok(callsAfterRestore.every(row => !row.accepted))
      } else {
        // This intentionally characterizes the limitation: restored zero-attempt rows
        // cannot know about first sends erased by disaster once provider dedup expires.
        const restoredZeroAttemptIds = snapshotNotifications.filter(row => row.attempts === 0 && originalAcceptedIds.includes(row.id)).map(row => row.id)
        assert.equal(duplicateAcceptances, restoredZeroAttemptIds.length)
        assert.deepEqual(sent.map(row => row.retryKey).sort(), restoredZeroAttemptIds.sort())
        assert.ok(duplicateAcceptances > 0)
      }
    }
    const acceptedCount = sent.length
    await deliverNotifications(restoredPool, sendSynthetic, { now: retryAt, limit: 100, publicAppUrl: 'https://municipality.example' })
    assert.equal(sent.length, acceptedCount)
    await assert.rejects(restoredPool.query('UPDATE patient_transfer.trip_events SET command=command WHERE booking_id=$1', [booking.id]), { code: '55000' })
    await assert.rejects(restoredPool.query('DELETE FROM patient_transfer.notification_attempts WHERE notification_id=$1', [retry[0].id]), { code: '55000' })
    // Execution-day access and a fresh real driver command prove the restored service is writable.
    const departureAt = booking.schedule.departureAt
    restoredServer.closeAllConnections()
    await new Promise(resolve => restoredServer.close(resolve))
    restoredServer = createApi({ pool: restoredPool, clock: () => departureAt, liffId: '',
      noticeVersion: 'development-v1', noticeText: 'Synthetic recovery notice',
      verifyLine: async () => { throw new Error('External LINE disabled') },
      route: async () => ({ minutes: 15, source: 'synthetic-recovery' }) })
    await new Promise(resolve => restoredServer.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${restoredServer.address().port}`
    await login('driver'); await login('dispatcher')
    const driverBooking = await request(`/bookings/${booking.id}`, 'driver')
    const started = await request(`/bookings/${booking.id}/commands`, 'driver', {
      eventId: randomUUID(), expectedRevision: driverBooking.revision, expectedExecutionVersion: driverBooking.executionVersion,
      command: { type: 'START_TRIP' },
    })
    assert.ok(started.startedAt)
    const fresh = await intake('ผู้ป่วยสังเคราะห์หลังการกู้คืน', '2030-01-18T09:00:00+07:00')
    if (quarantine) {
      // New application writes stay usable, but an old reconciliation cannot release their new outbox rows.
      const before = await recoveryFingerprint(restoredPool), count = sent.length
      await assert.rejects(deliverNotifications(restoredPool, sendSynthetic, { now: new Date(departureAt).toISOString(), limit: 100,
        publicAppUrl: 'https://municipality.example', beforeAttempt }), { message: 'RESTORE_QUARANTINE_BLOCKED' })
      assert.equal(sent.length, count)
      assert.deepEqual(await recoveryFingerprint(restoredPool), before)
      assert.ok((await restoredPool.query('SELECT count(*)::int AS n FROM patient_transfer.notifications WHERE booking_id=$1 AND attempts=0', [fresh.id])).rows[0].n > 0)
    }
    const recoveryMs = performance.now() - recoveryStarted
    const recoveryPointAgeMs = failureAt.getTime() - recoveryPoint.getTime()
    assert.ok(recoveryPointAgeMs >= 0 && recoveryPointAgeMs <= 3600000)
    assert.ok(recoveryMs <= 4 * 3600000)
    t.diagnostic(JSON.stringify({ scope: 'local synthetic logical restore; not production acceptance',
      protection: encrypted ? 'encrypted-retained-persisted-trust' : 'plain-in-memory', sourceAbsentBeforeRestore: true, externalMessages: 0,
      recoveryPointAt: recoveryPoint.toISOString(), declaredFailureAt: failureAt.toISOString(),
      recoveryPointAgeMs, dumpMs: Math.round(dumpMs), restoreMs: Math.round(restoreMs), verifiedRecoveryMs: Math.round(recoveryMs),
      archiveBytes: archive.length, comparedTables: Object.keys(fingerprint).length,
      syntheticSends: sent.length, postSnapshotBookingsLost: 1,
      ...(quarantine ? { quarantine: true, blockedInvalidEvidenceCases: 11, freshWritesRemainUsable: true } : {}),
      ...(ambiguity ? { ambiguity, originalProviderAcceptances: originalAcceptances, duplicateProviderAcceptances: duplicateAcceptances,
        ...(ambiguity === 'expired-window' ? { limitation: 'RESTORED_ZERO_ATTEMPT_HISTORY_CANNOT_ESTABLISH_FIRST_SEND_TIME', knownExpiredBlocked: 1, legacyUnknownBlocked: 1 } : {}) } : {}) }))
  } finally {
    if (restoredServer) { restoredServer.closeAllConnections(); await new Promise(resolve => restoredServer.close(resolve)) }
    await restoredPool?.end()
    if (restoredCreated) await admin.query(`DROP DATABASE "${restoredName}"`)
    if (source && !sourceClosed) await source.close()
    await admin.end()
    await temp.close()
  }
})
