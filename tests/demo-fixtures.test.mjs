import {test} from 'node:test'
import assert from 'node:assert/strict'
import {startAdminTestApi} from './helpers/admin-postgres.mjs'
import {prepareDemo} from '../scripts/database/prepare-demo.mjs'
import {recoveryFingerprint} from '../scripts/database/recovery.mjs'

test('controlled historical demo fixtures retain guards, provenance and idempotence without real identity substitution',async()=>{
  const f=await startAdminTestApi(process.env.DATABASE_TEST_ADMIN_URL)
  try {
    await f.pool.query("INSERT INTO patient_transfer.users(username,display_name,role) VALUES('demo-admin','Fictional fixture administrator','admin')")
    const options={date:'2030-01-15',noticeVersion:'development-v1',now:'2030-01-14T00:00:00Z'}
    const first=await prepareDemo(f.pool,options)
    assert.equal(first.length,3)
    const rows=(await f.pool.query('SELECT patient_name,landmark,appointment_at-submitted_at AS lead FROM patient_transfer.bookings')).rows
    assert.ok(rows.every(row=>row.patient_name.includes('สมมติ')&&row.landmark.startsWith('PRELOADED FICTIONAL DEMO')&&row.lead.days===3))
    assert.equal((await f.pool.query("SELECT id FROM patient_transfer.audit_logs WHERE action='PREPARE_FICTIONAL_DEMO'")).rowCount,3)
    const before=await recoveryFingerprint(f.pool)
    assert.deepEqual(await prepareDemo(f.pool,options),first)
    assert.deepEqual(await recoveryFingerprint(f.pool),before)
    await f.pool.query("UPDATE patient_transfer.users SET line_subject=$1 WHERE username='synthetic-citizen'",['U'+'e'.repeat(32)])
    const linked=await recoveryFingerprint(f.pool)
    await assert.rejects(prepareDemo(f.pool,options),/fictional demo identities required/)
    assert.deepEqual(await recoveryFingerprint(f.pool),linked)
  }finally{await f.close()}
})
