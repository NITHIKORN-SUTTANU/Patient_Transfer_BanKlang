import { test } from 'node:test'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { startAdminTestApi } from './helpers/admin-postgres.mjs'
import { syntheticAvailabilityCanary } from './helpers/availability-canary.mjs'
import { availabilityReport } from '../scripts/operations/availability.mjs'
import { ApiError } from '../server/errors.mjs'
import { collectProbe, readProbeJournal, replayProbeJournal, probeIntervals } from '../scripts/operations/probe-journal.mjs'
import { temporaryProbeJournal } from './helpers/probe-journal-temp.mjs'
import { initializeAlertStore, evaluateAndPersistAlerts, readAlertStore } from '../scripts/operations/alert-store.mjs'

if (!process.env.DATABASE_TEST_ADMIN_URL) throw new Error('Local DATABASE_TEST_ADMIN_URL required')

test('synthetic critical-service probes detect failures beyond database health', { timeout: 180000 }, async t => {
  const results = []
  const journal = await temporaryProbeJournal()
  const alertDirectory = join(dirname(journal.path), 'alerts')
  const policy = { label: 'provisional-synthetic-v1', cadenceMs: 60000, maxAgeMs: 120000 }
  const duty = { label: 'provisional-local-alerts-v1', mode: 'always_for_rehearsal', publishedOpenDates: [] }
  let alertState = null
  const alertEvents = []
  try {
  await initializeAlertStore({ directory: alertDirectory })
  for (const [scenario, failedCheck, failureCode] of [
    ['healthy', null, null], ['routing', 'dispatcher_schedule', 'http_503'],
    ['intake_write', 'citizen_booking', 'http_422'], ['driver_write', 'driver_record', 'http_422'],
    ['driver_auth', 'driver_jobs', 'http_401'], ['database', 'line_identity', 'http_500'],
    ['identity_provider', 'line_identity', 'http_503'],
    ['healthy_recovery', null, null],
  ]) await t.test(scenario, async () => {
    const healthy = failedCheck === null
    const control = { now: '2030-01-12T00:00:00Z' }
    // Inject database loss at the API connection boundary; never stop/reset the real container.
    const diagnostics = { server() {}, pool(raw) {
      const guard = () => { if (scenario === 'database') throw Object.assign(new Error('Synthetic API database outage'), { code: '08006' }) }
      return { async connect() { guard(); return raw.connect() }, async query(...args) { guard(); return raw.query(...args) } }
    } }
    const fixture = await startAdminTestApi(process.env.DATABASE_TEST_ADMIN_URL, { diagnostics, clock: () => control.now,
      liffId: 'synthetic-availability', verifyLine: async token => {
        if (scenario === 'identity_provider') throw new ApiError(503, 'Synthetic identity provider outage')
        assert.equal(token, 'synthetic-availability-line')
        return { subject: `U${'a'.repeat(32)}`, name: 'ผู้ใช้สังเคราะห์ตรวจบริการ' }
      }, route: async () => {
        if (scenario === 'routing') throw new ApiError(503, 'Synthetic routing outage')
        return { minutes: 15, source: 'synthetic-availability' }
      } })
    try {
      for (const [table, field] of [['vehicles', 'vehicle_id'], ['drivers', 'driver_id']]) {
        await fixture.pool.query(`INSERT INTO patient_transfer.availability_windows(${field},starts_at,ends_at)
          SELECT id,'2030-01-14T23:00Z','2030-01-15T09:00Z' FROM patient_transfer.${table}`)
      }
      if (['intake_write', 'driver_write'].includes(scenario)) {
        const table = scenario === 'intake_write' ? 'bookings' : 'trip_events'
        await fixture.pool.query(`CREATE FUNCTION patient_transfer.synthetic_probe_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          ${scenario === 'driver_write' ? "IF NEW.command<>'START_TRIP' THEN RETURN NEW; END IF;" : ''}
          RAISE EXCEPTION 'Synthetic write-path outage' USING ERRCODE='23514'; END $$`)
        await fixture.pool.query(`CREATE TRIGGER synthetic_probe_failure BEFORE INSERT ON patient_transfer.${table}
          FOR EACH ROW EXECUTE FUNCTION patient_transfer.synthetic_probe_failure()`)
      }
      const result = await collectProbe({ path: journal.path, policy, run: () => syntheticAvailabilityCanary({ base: fixture.base, control, beforeDriverAccess: async () => {
        if (scenario === 'driver_auth') await fixture.pool.query(`UPDATE patient_transfer.auth_sessions SET revoked_at=$1
          WHERE user_id='00000000-0000-4000-8000-000000000003' AND revoked_at IS NULL`, [control.now])
      } }) })
      assert.equal(result.state, healthy ? 'available' : 'unavailable')
      assert.equal(result.databaseHealthOk, scenario !== 'database')
      assert.deepEqual(result.failure, failedCheck ? { check: failedCheck, code: failureCode } : null)
      const evaluated = await evaluateAndPersistAlerts({ directory: alertDirectory, path: journal.path, policy, duty, at: result.finishedAt })
      alertState = evaluated.state; alertEvents.push(...evaluated.newEvents)
      assert.deepEqual((await readAlertStore({ directory: alertDirectory })).state, alertState)
      const repeated = await evaluateAndPersistAlerts({ directory: alertDirectory, path: journal.path, policy, duty, at: result.finishedAt })
      assert.equal(repeated.newEvents.length, 0)
      assert.equal(repeated.committed, false)
      if (scenario === 'healthy_recovery') assert.equal(alertState.active.length, 0)
      const { rows: bookings } = await fixture.pool.query('SELECT id,status,started_at FROM patient_transfer.bookings')
      if (['database', 'identity_provider', 'intake_write'].includes(scenario)) assert.equal(bookings.length, 0)
      else {
        assert.equal(bookings.length, 1)
        assert.equal(bookings[0].status, scenario === 'routing' ? 'APPROVED' : 'ASSIGNED')
        assert.equal(!!bookings[0].started_at, healthy)
        const commands = (await fixture.pool.query('SELECT command FROM patient_transfer.trip_events WHERE booking_id=$1 ORDER BY sequence', [bookings[0].id])).rows.map(row => row.command)
        assert.deepEqual(commands, scenario === 'routing' ? ['APPROVE'] : ['APPROVE', 'CONFIRM_SCHEDULE', 'ASSIGN', ...(healthy ? ['START_TRIP'] : [])])
      }
      assert.equal((await fixture.pool.query("SELECT count(*)::int AS n FROM patient_transfer.notifications WHERE status<>'PENDING' OR attempts<>0")).rows[0].n, 0)
      results.push({ scenario, ...result })
    } finally { await fixture.close() }
  })
  assert.equal(results.length, 8)
  const recorded = await readProbeJournal(journal.path)
  assert.equal(recorded.length, 8)
  const storedAlerts = await readAlertStore({ directory: alertDirectory })
  assert.equal(storedAlerts.head.sequence, 8)
  assert.equal(storedAlerts.checkpointStatus, 'current')
  assert.deepEqual(storedAlerts.events, alertEvents)
  assert.equal(alertEvents.filter(row => row.transition === 'opened').length, 2)
  assert.equal(alertEvents.filter(row => row.transition === 'recovered').length, 2)
  assert.equal(new Set(alertEvents.map(row => row.id)).size, alertEvents.length)
  assert.ok(alertEvents.filter(row => row.transition === 'recovered').every(row => row.source.hash === recorded.at(-1).hash))
  const actualStart = recorded[0].observedAt, actualEnd = recorded.at(-1).finishedAt
  // Replay the last month separately if a run crosses a Bangkok month boundary.
  const actualMonth = new Date(Date.parse(actualEnd) - 1 + 7 * 3600000).toISOString().slice(0, 7)
  const replayStart = new Date(Math.max(Date.parse(actualStart), Date.parse(`${actualMonth}-01T00:00:00+07:00`))).toISOString()
  const openDates = [...new Set(recorded.flatMap(row => [row.observedAt, row.finishedAt])
    .map(value => new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 10)))].filter(date => date.startsWith(actualMonth))
  const replay = await replayProbeJournal({ path: journal.path, policy, month: actualMonth,
    calendarLabel: 'Synthetic journal; explicit observed Bangkok dates only', publishedOpenDates: openDates,
    observationStart: replayStart, observationEnd: actualEnd, expectedHead: { sequence: recorded.at(-1).sequence, hash: recorded.at(-1).hash } })
  assert.equal(replay.provenance.clockKind, 'system')
  const fullRunIntervals = probeIntervals(recorded, { policy, observationStart: actualStart, observationEnd: actualEnd })
  for (const state of ['available', 'unavailable', 'unknown']) assert.ok(fullRunIntervals.some(row => row.state === state))
  assert.equal(replay.monthlyTargetMet, null)
  // Deliberately simulated accounting intervals, not wall-clock uptime inferred from short checks.
  const intervals = results.map((row, index) => ({
    start: new Date(Date.parse('2030-01-14T23:00:00Z') + index * 600000).toISOString(),
    end: new Date(Date.parse('2030-01-14T23:00:00Z') + (index + 1) * 600000).toISOString(), state: row.state,
  }))
  const accounting = availabilityReport({ month: '2030-01', calendarLabel: 'Synthetic declared outage intervals; not actual pilot uptime',
    publishedOpenDates: ['2030-01-15'], observationStart: intervals[0].start, observationEnd: intervals.at(-1).end, intervals })
  assert.equal(accounting.windowServiceMinutes, 80)
  assert.equal(accounting.unavailableMinutes, 60)
  assert.equal(accounting.monthlyTargetMet, null)
  t.diagnostic(JSON.stringify({ scope: 'synthetic rehearsal; no production monitoring/monthly availability claim',
    probes: results.map(({ scenario, state, databaseHealthOk, failure, observedAt, finishedAt }) =>
      ({ scenario, state, databaseHealthOk, failure, elapsedMs: Date.parse(finishedAt) - Date.parse(observedAt) })), accounting,
    journalReplay: { recordCount: replay.provenance.recordCount, clockKind: replay.provenance.clockKind,
      observationStart: replayStart, observationEnd: actualEnd, intervalCount: replay.intervals.length,
      availableMinutes: replay.availableMinutes, unavailableMinutes: replay.unavailableMinutes,
      unknownMinutes: replay.unknownMinutes, availabilityPercent: replay.availabilityPercent, monthlyTargetMet: replay.monthlyTargetMet },
    localAlertRehearsal: { transitions: alertEvents.map(row => ({ category: row.category, transition: row.transition })),
      remainingActive: alertState.active.length, persistedEvaluations: storedAlerts.head.sequence, persistedTransitions: storedAlerts.events.length,
      checkpointStatus: storedAlerts.checkpointStatus, stagingArtifacts: storedAlerts.stagingArtifacts, externalMessages: 0, confirmedServiceOutages: 0 } }))
  } finally { await journal.close() }
})
