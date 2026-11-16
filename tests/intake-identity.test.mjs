import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startAdminTestApi } from './helpers/admin-postgres.mjs'
import { newToken, tokenHash } from '../server/auth.mjs'
import { recoveryFingerprint } from '../scripts/database/recovery.mjs'

test('owner-scoped intake identity preserves one committed request across concurrent retries and rollback', async t => {
  const control={now:'2030-01-12T00:00:00Z'}
  const f=await startAdminTestApi(process.env.DATABASE_TEST_ADMIN_URL,{clock:()=>control.now})
  const token=newToken()
  async function post(path,body,status=201,credential=token) {
    const response=await fetch(`${f.base}/api${path}`,{method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify(body)})
    const result=await response.json()
    assert.equal(response.status,status,JSON.stringify(result));return result
  }
  try {
    await f.pool.query(`INSERT INTO patient_transfer.auth_sessions(user_id,token_hash,access_version,created_at,expires_at)
      SELECT id,$1,access_version,'2030-01-01','2031-01-01' FROM patient_transfer.users WHERE username='synthetic-citizen'`,[tokenHash(token)])
    const consent=await post('/consents',{accepted:true,noticeVersion:'development-v1'})
    const body={requestId:randomUUID(),consentId:consent.id,bookingFor:'self',patientName:'Synthetic retry',requesterName:'Synthetic requester',contactPhone:'0800000000',pickupAddress:'Synthetic pickup',latitude:18.59,longitude:99.05,villageId:'30000000-0000-4000-8000-000000000001',hospitalId:'40000000-0000-4000-8000-000000000001',mobility:'standard',appointmentAt:'2030-01-15T09:00:00+07:00'}
    let booking
    await t.test('simultaneous requests commit exactly one booking and publication set',async()=>{
      const rows=await Promise.all(Array.from({length:3},()=>post('/bookings',body)))
      assert.equal(new Set(rows.map(row=>row.id)).size,1);booking=rows[0]
      assert.equal((await f.pool.query('SELECT id FROM patient_transfer.bookings')).rowCount,1)
      assert.equal((await f.pool.query('SELECT id FROM patient_transfer.notifications WHERE booking_id=$1',[booking.id])).rowCount,1)
      assert.equal((await f.pool.query('SELECT id FROM patient_transfer.dispatcher_alerts WHERE booking_id=$1',[booking.id])).rowCount,1)
      const before=await recoveryFingerprint(f.pool)
      assert.deepEqual(await post('/bookings',body),booking)
      assert.deepEqual(await recoveryFingerprint(f.pool),before)
    })
    await t.test('changed content conflicts and invalid identity fails without writes',async()=>{
      const before=await recoveryFingerprint(f.pool)
      await post('/bookings',{...body,patientName:'Changed patient'},409)
      await post('/bookings',{...body,requestId:'invalid'},400)
      assert.deepEqual(await recoveryFingerprint(f.pool),before)
      await assert.rejects(f.pool.query('UPDATE patient_transfer.bookings SET intake_request_id=$1 WHERE id=$2',[randomUUID(),booking.id]),error=>error.code==='23514')
    })
    await t.test('failed publication rolls back identity and retry remains usable',async()=>{
      const retry={...body,requestId:randomUUID()}
      await f.pool.query(`CREATE FUNCTION patient_transfer.synthetic_retry_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic publication failure' USING ERRCODE='23514'; END $$;
        CREATE TRIGGER synthetic_retry_failure BEFORE INSERT ON patient_transfer.notifications FOR EACH ROW EXECUTE FUNCTION patient_transfer.synthetic_retry_failure()`)
      const before=await recoveryFingerprint(f.pool)
      try {await post('/bookings',retry,422);assert.deepEqual(await recoveryFingerprint(f.pool),before)}
      finally {await f.pool.query('DROP TRIGGER synthetic_retry_failure ON patient_transfer.notifications; DROP FUNCTION patient_transfer.synthetic_retry_failure()')}
      const created=await post('/bookings',retry)
      assert.notEqual(created.id,booking.id)
      assert.equal((await post('/bookings',retry)).id,created.id)
    })
    await t.test('another owner can use the same UUID without reading the first owner',async()=>{
      const other=newToken()
      await f.pool.query(`WITH u AS (INSERT INTO patient_transfer.users(role,display_name) VALUES('citizen','Other synthetic owner') RETURNING id,access_version)
        INSERT INTO patient_transfer.auth_sessions(user_id,token_hash,access_version,created_at,expires_at) SELECT id,$1,access_version,'2030-01-01','2031-01-01' FROM u`,[tokenHash(other)])
      await post('/bookings',body,422,other)
      const decision=await post('/consents',{accepted:true,noticeVersion:'development-v1'},201,other)
      const own={...body,consentId:decision.id}
      const created=await post('/bookings',own,201,other)
      assert.notEqual(created.id,booking.id)
      assert.equal((await post('/bookings',own,201,other)).id,created.id)
    })
    await t.test('replay reads current status after cancellation, refusal and lead-time cutoff',async()=>{
      const cancelled=await post(`/bookings/${booking.id}/commands`,{eventId:randomUUID(),expectedRevision:booking.revision,expectedExecutionVersion:booking.executionVersion,command:{type:'CANCEL',reason:'Synthetic cancellation'}},200)
      await post('/consents',{accepted:false,noticeVersion:'development-v1'})
      control.now='2030-01-14T00:00:00Z'
      const before=await recoveryFingerprint(f.pool)
      assert.deepEqual(await post('/bookings',body),cancelled)
      assert.deepEqual(await recoveryFingerprint(f.pool),before)
      await post('/bookings',{...body,requestId:randomUUID()},422)
    })
    await t.test('revoked access cannot use a committed identity',async()=>{
      await f.pool.query('UPDATE patient_transfer.auth_sessions SET revoked_at=$1 WHERE token_hash=$2',[control.now,tokenHash(token)])
      const before=await recoveryFingerprint(f.pool)
      await post('/bookings',body,401)
      assert.deepEqual(await recoveryFingerprint(f.pool),before)
    })
  } finally {await f.close()}
})
