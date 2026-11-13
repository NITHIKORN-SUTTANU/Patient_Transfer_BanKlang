import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { startAdminTestApi, syntheticPassword } from './helpers/admin-postgres.mjs'
import { temporaryProbeJournal } from './helpers/probe-journal-temp.mjs'
import { newToken, tokenHash } from '../server/auth.mjs'
import { initializeTrustStore, advanceTrustAnchor, readTrustHead } from '../scripts/database/trust-anchor-store.mjs'
import { postgresArchive, recoveryFingerprint, recoveryTarget } from '../scripts/database/recovery.mjs'
import { initializeBackupRehearsal, runScheduledBackup, postgresBackupCapture, readVerifiedBackup, backupReadiness, createBackupAnchor, readAnchoredBackup, anchoredBackupReadiness } from '../scripts/database/backup-readiness.mjs'

if (!process.env.DATABASE_TEST_ADMIN_URL) throw new Error('Local DATABASE_TEST_ADMIN_URL required')
for (const encrypted of [false, true]) test(`retained ${encrypted ? 'encrypted' : 'plain'} synthetic PostgreSQL backup restores matching tables and excludes later committed work`, { timeout: 180000 }, async t => {
  const adminUrl = process.env.DATABASE_TEST_ADMIN_URL, destination = `pt_test_${randomUUID().replaceAll('-', '')}`
  recoveryTarget(adminUrl, destination)
  const admin = new pg.Client({ connectionString: adminUrl }), temp = await temporaryProbeJournal()
  let fixture, restored, created = false
  try {
    await admin.connect()
    fixture = await startAdminTestApi(adminUrl)
    const database = (await fixture.pool.query('SELECT current_database() AS name')).rows[0].name
    const encryptionKey = encrypted ? randomBytes(32) : undefined
    const source = { connectionString: adminUrl, database }, directory = join(dirname(temp.path), 'backups')
    const citizen = newToken()
    await fixture.pool.query(`INSERT INTO patient_transfer.auth_sessions(user_id,token_hash,access_version,created_at,expires_at)
      SELECT id,$1,access_version,'2030-01-01','2031-01-01' FROM patient_transfer.users WHERE id='00000000-0000-4000-8000-000000000001'`, [tokenHash(citizen)])
    async function request(path, token, body, status = 200) {
      const response = await fetch(`${fixture.base}/api${path}`, { method: body ? 'POST' : 'GET', headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) })
      assert.equal(response.status, status)
      return response.json()
    }
    const consent = await request('/consents', citizen, { accepted: true, noticeVersion: 'development-v1' }, 201)
    const intake = () => request('/bookings', citizen, { consentId: consent.id, bookingFor: 'self', patientName: 'ผู้ป่วยสำรองสังเคราะห์', requesterName: 'ผู้ขอสังเคราะห์',
      contactPhone: '0800000000', pickupAddress: 'จุดรับสังเคราะห์', latitude: 18.59, longitude: 99.05,
      villageId: '30000000-0000-4000-8000-000000000001', hospitalId: '40000000-0000-4000-8000-000000000001', mobility: 'standard', appointmentAt: '2030-01-15T09:00:00+07:00' }, 201)
    const booking = await intake()
    const dispatcher = (await request('/auth/login', null, { username: 'synthetic-dispatcher', password: syntheticPassword })).token
    await request(`/bookings/${booking.id}/commands`, dispatcher, { eventId: randomUUID(), expectedRevision: booking.revision,
      expectedExecutionVersion: booking.executionVersion, command: { type: 'APPROVE' } })
    const original = await recoveryFingerprint(fixture.pool)
    const anchorAt = new Date(Date.now() - 1000).toISOString()
    await initializeBackupRehearsal({ directory, source, anchorAt, encryptionKey })
    const run = await runScheduledBackup({ directory, source, encryptionKey, at: new Date().toISOString(), capture: postgresBackupCapture({ source, pool: fixture.pool }) })
    assert.equal(run.manifest.status, 'SUCCESS')
    const later = await intake()
    let trustedAnchor
    if (encrypted) {
      const trust = { directory: join(dirname(temp.path), 'trust'), backupDirectory: directory }
      await initializeTrustStore(trust)
      const result = await advanceTrustAnchor({ ...trust, expectedHead: null,
        nextAnchor: await createBackupAnchor({ directory, source, encryptionKey }), operationId: randomUUID() })
      trustedAnchor = (await readTrustHead({ ...trust, expectedHead: result.head })).anchor
    }
    const stored = encrypted
      ? await readAnchoredBackup({ directory, source, slot: 0, encryptionKey, trustedAnchor })
      : await readVerifiedBackup({ directory, source, slot: 0, encryptionKey })
    await admin.query(`CREATE DATABASE "${destination}"`); created = true
    await postgresArchive(adminUrl, destination, { archive: stored.archive })
    const url = new URL(adminUrl); url.pathname = `/${destination}`
    restored = new pg.Pool({ connectionString: url.toString() })
    assert.deepEqual(await recoveryFingerprint(restored), original)
    assert.equal((await restored.query('SELECT count(*)::int AS n FROM patient_transfer.bookings WHERE id=$1', [later.id])).rows[0].n, 0)
    assert.equal((await restored.query("SELECT count(*)::int AS n FROM patient_transfer.notifications WHERE attempts<>0 OR status<>'PENDING'")).rows[0].n, 0)
    const ready = await backupReadiness({ directory, source, encryptionKey, at: new Date().toISOString() })
    assert.equal(ready.healthy, true)
    if (encrypted) {
      const anchored = await anchoredBackupReadiness({ directory, source, encryptionKey, trustedAnchor, at: new Date().toISOString() })
      assert.equal(anchored.trusted, true)
      assert.equal(anchored.healthy, true)
    }
    assert.ok(ready.recoveryPointAgeMs <= 3600000)
    t.diagnostic(JSON.stringify({ scope: 'local retained synthetic backup; not protected production acceptance',
      archiveBytes: stored.archive.length, comparedTables: Object.keys(original).length,
      recoveryPointAt: stored.manifest.recoveryPointAt, recoveryPointAgeMs: ready.recoveryPointAgeMs,
      protection: ready.protection, excludedPostSnapshotBookings: 1, externalMessages: 0 }))
  } finally {
    await restored?.end()
    if (created) await admin.query(`DROP DATABASE "${destination}"`)
    await fixture?.close(); await admin.end(); await temp.close()
  }
})
