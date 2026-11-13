import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startAdminTestApi } from './helpers/admin-postgres.mjs'
import { loadDiagnostics } from './helpers/load-diagnostics.mjs'
import { newToken, tokenHash } from '../server/auth.mjs'
import { recoveryFingerprint } from '../scripts/database/recovery.mjs'

if (!process.env.DATABASE_TEST_ADMIN_URL) throw new Error('Local DATABASE_TEST_ADMIN_URL required')

test('intake reuses publication hydration only after atomic publication and commit', async t => {
  const diagnostics = loadDiagnostics(), fixture = await startAdminTestApi(process.env.DATABASE_TEST_ADMIN_URL, { diagnostics })
  const token = newToken(), citizenId = '00000000-0000-4000-8000-000000000001'
  async function request(path, body, status = 200) {
    const response = await fetch(`${fixture.base}/api${path}`, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) })
    assert.equal(response.status, status, `Unexpected status for ${path}`)
    return response.json()
  }
  try {
    await fixture.pool.query(`INSERT INTO patient_transfer.auth_sessions(user_id,token_hash,access_version,created_at,expires_at)
      SELECT id,$1,access_version,'2030-01-01','2031-01-01' FROM patient_transfer.users WHERE id=$2`, [tokenHash(token), citizenId])
    const consent = await request('/consents', { accepted: true, noticeVersion: 'development-v1' }, 201)
    const body = { consentId: consent.id, bookingFor: 'other', patientName: ' ผู้ป่วยสังเคราะห์ ', requesterName: 'ผู้ดูแลสังเคราะห์',
      contactPhone: '+66 80-000-0000', pickupAddress: ' จุดรับสังเคราะห์ ', landmark: ' หน้าศาลา ', latitude: 18.59, longitude: 99.05,
      villageId: '30000000-0000-4000-8000-000000000001', hospitalId: '40000000-0000-4000-8000-000000000001',
      mobility: 'standard', assistance: ['boarding_support', 'caregiver_accompanies'], appointmentAt: '2030-01-18T09:00:00+07:00' }
    await t.test('one hydration produces the committed response and matching requester/dispatcher snapshots', async () => {
      diagnostics.start()
      const created = await request('/bookings', body, 201)
      const report = diagnostics.stop()
      assert.deepEqual(created, await request(`/bookings/${created.id}`))
      assert.equal(created.patientName, 'ผู้ป่วยสังเคราะห์')
      assert.equal(created.contactPhone, '0800000000')
      assert.equal(created.landmark, 'หน้าศาลา')
      assert.equal(created.bookingFor, 'other')
      assert.equal(created.requesterName, body.requesterName)
      assert.deepEqual(created.assistance, body.assistance)
      const { rows: messages } = await fixture.pool.query(`SELECT message_data FROM patient_transfer.notifications WHERE booking_id=$1`, [created.id])
      const { rows: alerts } = await fixture.pool.query(`SELECT message_data FROM patient_transfer.dispatcher_alerts WHERE booking_id=$1`, [created.id])
      assert.equal(messages.length, 1); assert.equal(alerts.length, 1)
      for (const row of [...messages, ...alerts]) {
        assert.equal(row.message_data.reference, created.reference)
        assert.equal(row.message_data.status, created.status)
        assert.equal(row.message_data.event, 'REQUEST_RECEIVED')
      }
      assert.equal(report.byQuery.booking_hydration.calls, 1, 'Intake must not rehydrate the unchanged booking after publication')
      assert.equal(report.byOperation.intake.queryCount.mean, 13)
    })
    await fixture.pool.query(`CREATE FUNCTION patient_transfer.synthetic_intake_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic intake publication/commit failure' USING ERRCODE='23514'; END $$`)
    for (const [stage, table, definition] of [
      ['outbox', 'notifications', 'CREATE TRIGGER synthetic_intake_failure BEFORE INSERT'],
      ['dispatcher alert', 'dispatcher_alerts', 'CREATE TRIGGER synthetic_intake_failure BEFORE INSERT'],
      ['deferred commit', 'bookings', 'CREATE CONSTRAINT TRIGGER synthetic_intake_failure AFTER INSERT'],
    ]) await t.test(`${stage} failure returns no success and rolls back all application tables`, async () => {
      await fixture.pool.query(`${definition} ON patient_transfer.${table} ${stage === 'deferred commit' ? 'DEFERRABLE INITIALLY DEFERRED' : ''}
        FOR EACH ROW EXECUTE FUNCTION patient_transfer.synthetic_intake_failure()`)
      try {
        const before = await recoveryFingerprint(fixture.pool)
        const rejected = await request('/bookings', body, 422)
        assert.equal(rejected.id, undefined)
        assert.deepEqual(await recoveryFingerprint(fixture.pool), before)
      } finally { await fixture.pool.query(`DROP TRIGGER synthetic_intake_failure ON patient_transfer.${table}`) }
    })
    // Verify a failed publication/commit has not poisoned subsequent intake.
    const retried = await request('/bookings', body, 201)
    assert.deepEqual(retried, await request(`/bookings/${retried.id}`))
  } finally { diagnostics.dispose(); await fixture.close() }
})
