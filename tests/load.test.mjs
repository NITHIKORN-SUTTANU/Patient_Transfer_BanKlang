import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { setTimeout as pause } from 'node:timers/promises'
import { startAdminTestApi } from './helpers/admin-postgres.mjs'
import { newToken, tokenHash } from '../server/auth.mjs'
import { ApiError } from '../server/errors.mjs'
import { recoveryFingerprint } from '../scripts/database/recovery.mjs'
import { measureRequest, runUsers, summarize } from '../scripts/performance/measure.mjs'
import { loadDiagnostics } from './helpers/load-diagnostics.mjs'

const ids = { citizen: '00000000-0000-4000-8000-000000000001',
  village: '30000000-0000-4000-8000-000000000001', hospital: '40000000-0000-4000-8000-000000000001',
  depot: '20000000-0000-4000-8000-000000000001', vehicle: '50000000-0000-4000-8000-000000000001',
  driver: '60000000-0000-4000-8000-000000000001' }
const durationSeconds = Number(process.env.LOAD_DURATION_SECONDS ?? 60)
if (!Number.isInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 300) throw new Error('LOAD_DURATION_SECONDS must be 30–300')
if (!process.env.DATABASE_TEST_ADMIN_URL) throw new Error('Local DATABASE_TEST_ADMIN_URL required for load measurement')

test('provisional 50-user synthetic workload reports normal, routing and export outcomes separately', { timeout: 600000 }, async t => {
  const control = { now: '2030-01-12T00:00:00Z', outage: false, routeCalls: 0 }
  const diagnostics = process.env.LOAD_DIAGNOSTICS === 'true' ? loadDiagnostics() : null
  const route = async () => {
    control.routeCalls++; await pause(25)
    if (control.outage) throw new ApiError(503, 'Synthetic routing outage')
    return { minutes: 15, source: 'synthetic-load-fixed-25ms' }
  }
  const fixture = await startAdminTestApi(process.env.DATABASE_TEST_ADMIN_URL, {
    diagnostics,
    clock: () => control.now,
    route: () => diagnostics ? diagnostics.route(route) : route(),
  })
  const actors = [], samples = [], activity = { inFlight: 0, peak: 0 }
  const sql = (query, values) => fixture.pool.query(query, values)
  async function request(actor, path, body, status = 200) {
    const response = await fetch(`${fixture.base}/api${path}`, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${actor.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) })
    assert.equal(response.status, status, `Setup/check status for ${path}`)
    return response.json()
  }
  const command = (booking, type) => ({ eventId: randomUUID(), expectedRevision: booking.revision,
    expectedExecutionVersion: booking.executionVersion, command: { type } })
  const selection = (booking, vehicleId = ids.vehicle, driverId = ids.driver) => ({ eventId: randomUUID(),
    expectedRevision: booking.revision, vehicleId, driverId, originLocationId: ids.depot })
  const intake = (actor, appointmentAt = '2030-01-18T09:00:00+07:00') => ({ consentId: actor.consentId,
    bookingFor: 'self', patientName: `ผู้ป่วยสังเคราะห์ ${actor.index}`, requesterName: 'ผู้ขอสังเคราะห์',
    contactPhone: '0800000000', pickupAddress: 'จุดรับทดสอบโหลด', latitude: 18.59, longitude: 99.05,
    villageId: ids.village, hospitalId: ids.hospital, mobility: 'standard', appointmentAt })
  try {
    // Identity bootstrap is deliberately outside measurement. No public fake-login endpoint or rate-limit bypass.
    for (let index = 0; index < 50; index++) {
      const role = index < 35 ? 'citizen' : index < 45 ? 'dispatcher' : index < 49 ? 'driver' : 'admin'
      const actor = { index, role, id: randomUUID(), token: newToken() }
      await sql(`INSERT INTO patient_transfer.users(id,role,display_name) VALUES($1,$2,$3)`, [actor.id, role, `Synthetic load ${index}`])
      if (role === 'driver') {
        actor.driverId = randomUUID(); actor.vehicleId = randomUUID()
        await sql(`INSERT INTO patient_transfer.drivers(id,user_id,location_id,available_at) VALUES($1,$2,$3,'2029-01-01')`, [actor.driverId, actor.id, ids.depot])
        await sql(`INSERT INTO patient_transfer.vehicles(id,name,plate,location_id,available_at) VALUES($1,$2,$2,$3,'2029-01-01')`, [actor.vehicleId, `LOAD-${index}`, ids.depot])
      }
      // Roster linking revokes earlier sessions; establish the synthetic session after the link.
      await sql(`INSERT INTO patient_transfer.auth_sessions(user_id,token_hash,access_version,created_at,expires_at)
        SELECT id,$1,access_version,'2030-01-01','2031-01-01' FROM patient_transfer.users WHERE id=$2`, [tokenHash(actor.token), actor.id])
      actors.push(actor)
    }
    for (const [table, field] of [['vehicles', 'vehicle_id'], ['drivers', 'driver_id']]) {
      await sql(`INSERT INTO patient_transfer.availability_windows(${field},starts_at,ends_at)
        SELECT id,'2030-01-14T23:00Z','2030-01-18T09:00Z' FROM patient_transfer.${table}`)
    }
    const citizens = actors.filter(row => row.role === 'citizen'), dispatchers = actors.filter(row => row.role === 'dispatcher')
    for (const citizen of citizens) {
      citizen.consentId = (await request(citizen, '/consents', { accepted: true, noticeVersion: 'development-v1' }, 201)).id
      // Five initial requests per owner, all through API validation and transactional publication.
      for (let n = 0; n < 5; n++) citizen.booking = await request(citizen, '/bookings', intake(citizen), 201)
    }
    for (const dispatcher of dispatchers) dispatcher.booking = await request(citizens[0], '/bookings', intake(citizens[0]), 201)
    for (const driver of actors.filter(row => row.role === 'driver')) {
      let booking = await request(citizens[0], '/bookings', intake(citizens[0], '2030-01-15T09:00:00+07:00'), 201)
      booking = await request(dispatchers[0], `/bookings/${booking.id}/commands`, command(booking, 'APPROVE'))
      booking = await request(dispatchers[0], `/bookings/${booking.id}/schedule`, selection(booking, driver.vehicleId, driver.driverId))
      driver.booking = await request(dispatchers[0], `/bookings/${booking.id}/assignment`, selection(booking, driver.vehicleId, driver.driverId))
    }
    control.now = '2030-01-15T01:40:00Z' // 08:40 Bangkok; genuine execution-day shift scope, waiting already elapsed.
    const initialCounts = (await sql(`SELECT (SELECT count(*)::int FROM patient_transfer.bookings) AS bookings,
      (SELECT count(*)::int FROM patient_transfer.trip_events) AS events,
      (SELECT count(*)::int FROM patient_transfer.notifications) AS notifications,
      (SELECT count(*)::int FROM patient_transfer.users) AS users,
      (SELECT count(*)::int FROM patient_transfer.vehicles) AS vehicles,
      (SELECT count(*)::int FROM patient_transfer.drivers) AS drivers,
      (SELECT count(*)::int FROM patient_transfer.service_villages) AS villages,
      (SELECT count(*)::int FROM patient_transfer.hospitals) AS hospitals`)).rows[0]
    // Warm every authenticated identity outside the measured window and verify principal separation.
    for (const actor of actors) assert.equal((await request(actor, '/auth/me')).id, actor.id)
    const databaseVersion = (await sql('SELECT version() AS version')).rows[0].version
    const measuredRouteStart = control.routeCalls
    function nextOperation(actor, step) {
      const read = (name, path, validate) => ({ name, path, validate })
      const bookingRead = () => read('booking_detail', `/bookings/${actor.booking.id}`, row => row.id === actor.booking.id)
      if (step === 0) return read('identity', '/auth/me', row => row.id === actor.id)
      if (actor.role === 'citizen') {
        switch (step % 8) {
          case 0: return { name: 'citizen_intake', path: '/bookings', body: intake(actor), status: 201,
            validate: row => row.status === 'REQUESTED' && !!row.reference, saved: row => { actor.booking = row } }
          case 2: case 5: return bookingRead()
          case 4: return read('own_profiles', '/profiles', row => Array.isArray(row.profiles))
          default: return read('own_list', '/bookings', row => Array.isArray(row.bookings))
        }
      }
      if (actor.role === 'dispatcher') {
        switch (step % 8) {
          case 1: return read('dispatch_list', '/bookings', row => Array.isArray(row.bookings))
          case 2: return read('dispatch_review', `/bookings/${actor.booking.id}/review`, row => row.bookingId === actor.booking.id)
          case 3: return { name: 'verification', path: `/bookings/${actor.booking.id}/verification`,
            body: { eventId: randomUUID(), expectedLatestId: actor.latestVerification ?? null, outcome: 'confirmed', notes: 'ตรวจข้อมูลสังเคราะห์' },
            validate: row => !!row.id, saved: row => { actor.latestVerification = row.id } }
          case 4: return actor.booking.status === 'REQUESTED'
            ? { name: 'approval', path: `/bookings/${actor.booking.id}/commands`, body: command(actor.booking, 'APPROVE'),
              validate: row => row.status === 'APPROVED', saved: row => { actor.booking = row } }
            : read('catalog', '/catalog', row => Array.isArray(row.vehicles))
          case 5: return { name: 'confirm_schedule', kind: 'routing', path: `/bookings/${actor.booking.id}/schedule`,
            body: selection(actor.booking), validate: row => row.status === 'SCHEDULED', saved: row => { actor.booking = row } }
          case 6: return actor.index === 35 ? { name: 'daily_xlsx', kind: 'export', path: '/reports/daily', body: { date: '2030-01-15', format: 'xlsx' } } : bookingRead()
          default: return read('dispatch_alerts', '/dispatcher-alerts', row => Array.isArray(row.alerts))
        }
      }
      if (actor.role === 'driver') {
        const milestones = ['START_TRIP', 'DEPART_ORIGIN', 'CONFIRM_PICKUP', 'DEPART_FOR_HOSPITAL', 'CONFIRM_HANDOVER']
        if (step <= milestones.length) return { name: `driver_${milestones[step - 1].toLowerCase()}`, path: `/bookings/${actor.booking.id}/commands`,
          body: command(actor.booking, milestones[step - 1]), validate: row => row.id === actor.booking.id,
          saved: row => { actor.booking = row } }
        return step % 2 ? read('driver_jobs', '/bookings', row => Array.isArray(row.bookings))
          : read('driver_history', '/driver/history', row => Array.isArray(row.bookings) && row.bookings.some(b => b.id === actor.booking.id && b.status === 'COMPLETED'))
      }
      return step % 8 === 6 ? { name: 'monthly_xlsx', kind: 'export', path: '/reports/monthly', body: { month: '2030-01' } }
        : step % 2 ? read('admin_resources', '/catalog', row => Array.isArray(row.vehicles))
          : read('admin_accounts', '/admin/accounts', row => Array.isArray(row.accounts))
    }
    const measuredStartedAt = new Date().toISOString()
    diagnostics?.start()
    const elapsedMs = await runUsers(actors, nextOperation,
      (actor, operation) => measureRequest(fixture.base, actor, operation, samples, activity),
      { durationMs: durationSeconds * 1000, thinkMs: 1000 })
    const diagnosticResult = diagnostics?.stop()
    if (diagnosticResult) t.diagnostic(JSON.stringify({ diagnostics: diagnosticResult }))
    const categories = Object.fromEntries(['normal', 'routing', 'export'].map(kind => [kind,
      summarize(samples.filter(row => row.kind === kind), kind === 'normal' ? 2000 : kind === 'routing' ? 10000 : undefined)]))
    const byOperation = Object.fromEntries([...new Set(samples.map(row => row.operation))].sort().map(name =>
      [name, summarize(samples.filter(row => row.operation === name))]))
    const finalCounts = (await sql(`SELECT (SELECT count(*)::int FROM patient_transfer.bookings) AS bookings,
      (SELECT count(*)::int FROM patient_transfer.trip_events) AS events,
      (SELECT count(*)::int FROM patient_transfer.notifications) AS notifications`)).rows[0]
    t.diagnostic(JSON.stringify({ scope: 'provisional local synthetic workload; O-07 approval and live-provider measurement pending',
      environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model,
        logicalCpus: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 1024 ** 3), postgres: databaseVersion,
        apiPoolMax: fixture.pool.options.max, transport: 'loopback HTTP; API and generator share one Node process; PostgreSQL Docker',
        routing: 'injected 25ms per leg; no real provider', identity: '50 unique pre-inserted synthetic users/sessions; login not measured' },
      workload: { users: 50, roles: { citizen: 35, dispatcher: 10, driver: 4, admin: 1 },
        measuredStartedAt, measuredEndedAt: new Date().toISOString(), requestedSeconds: durationSeconds,
        actualSeconds: elapsedMs / 1000, thinkMs: 1000, model: 'closed loop; one outstanding request per user; no arrivals after deadline; drain included',
        warmup: 'one authenticated identity read per user; excluded', peakInFlight: activity.peak,
        completedRequests: samples.length, requestsPerSecond: samples.length / (elapsedMs / 1000),
        measuredRouteCalls: control.routeCalls - measuredRouteStart, initialCounts, finalCounts }, categories, byOperation }))
    // Report before assertions, so overload and functional failures remain reviewable rather than disappearing.
    assert.equal(samples.filter(row => !row.ok).length, 0, 'Functional failures: inspect aggregate diagnostic')
    for (const actor of actors) assert.ok(samples.some(row => row.actor === actor.index), 'Every user must perform measured work')
    for (const category of Object.values(categories)) assert.ok(category.attempts > 0)
    assert.ok(categories.normal.successfulWithinTargetPercent >= 95, 'Provisional local normal-request target missed')
    assert.ok(categories.routing.successfulWithinTargetPercent >= 95, 'Provisional synthetic-routing target missed')
    const successes = name => samples.filter(row => row.ok && row.operation === name).length
    assert.equal(finalCounts.bookings - initialCounts.bookings, successes('citizen_intake'))
    assert.equal(finalCounts.events - initialCounts.events, samples.filter(row => row.ok &&
      (['approval', 'confirm_schedule'].includes(row.operation) || row.operation.startsWith('driver_') && !['driver_jobs', 'driver_history'].includes(row.operation))).length)
    assert.equal((await sql('SELECT count(*)::int AS n FROM patient_transfer.verification_logs')).rows[0].n, successes('verification'))
    assert.equal((await sql("SELECT count(*)::int AS n FROM patient_transfer.audit_logs WHERE action IN ('EXPORT_DAILY_MANIFEST','EXPORT_MONTHLY_REPORT')")).rows[0].n,
      successes('daily_xlsx') + successes('monthly_xlsx'))
    assert.equal((await sql('SELECT count(*)::int AS n FROM patient_transfer.schedules WHERE committed')).rows[0].n, 4,
      'Repeated schedule confirmations must never reserve resources')
    for (const driver of actors.filter(row => row.role === 'driver')) {
      assert.equal(driver.booking.status, 'COMPLETED')
      const commands = (await sql('SELECT command FROM patient_transfer.trip_events WHERE booking_id=$1 ORDER BY sequence', [driver.booking.id])).rows.map(row => row.command)
      assert.deepEqual(commands, ['APPROVE', 'CONFIRM_SCHEDULE', 'ASSIGN', 'START_TRIP', 'DEPART_ORIGIN', 'CONFIRM_PICKUP', 'DEPART_FOR_HOSPITAL', 'CONFIRM_HANDOVER'])
    }
    // Fail-closed provider outage is a separate functional check, never a fast latency success.
    const dispatcher = dispatchers[0], before = await recoveryFingerprint(fixture.pool)
    control.outage = true
    await request(dispatcher, `/bookings/${dispatcher.booking.id}/schedule`, selection(dispatcher.booking), 503)
    assert.deepEqual(await recoveryFingerprint(fixture.pool), before)
    t.diagnostic('Separate synthetic routing-outage check: HTTP 503 and unchanged application/ledger table fingerprints; excluded from latency success counts.')
  } finally { diagnostics?.dispose(); await fixture.close() }
})
