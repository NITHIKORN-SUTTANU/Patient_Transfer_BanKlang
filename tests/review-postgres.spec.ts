import {randomUUID} from 'node:crypto'
import {test,expect} from '@playwright/test'
import {startOperationalTestApi,ids} from './helpers/operational-postgres'
import {syntheticPassword} from './helpers/admin-postgres.mjs'

test.beforeEach(()=>test.skip(!process.env.DATABASE_TEST_ADMIN_URL,'Local PostgreSQL required'))
test.use({actionTimeout:10000})
test('dispatcher reviews cross-requester exact warnings and appends verification/correction through existing details',async({page})=>{
 test.setTimeout(60000)
 const f=await startOperationalTestApi()
 try{
  const a=await f.requested(),b=await f.requested(),nameOnly=await f.requested()
  await f.pool.query("UPDATE patient_transfer.bookings SET contact_phone='0811111111' WHERE id=$1",[nameOnly.id])
  // Independent requester, same normalized transport identity; no citizen-facing lookup.
  const other=randomUUID();await f.pool.query("INSERT INTO patient_transfer.users(id,role,display_name) VALUES($1,'citizen','Synthetic other requester')",[other])
  const consent=randomUUID();await f.pool.query("INSERT INTO patient_transfer.consent_records(id,user_id,accepted,notice_version) VALUES($1,$2,true,'development-v1')",[consent,other])
  await f.pool.query('UPDATE patient_transfer.bookings SET requester_id=$1,consent_id=$2,patient_name=$3 WHERE id=$4',[other,consent,'  '+a.patientName+'  ',b.id])
  let review=await f.request(`/bookings/${a.id}/review`)
  expect(review.duplicates.map((r:{id:string})=>r.id)).toEqual([b.id]);expect(review.duplicates[0].reasons).toEqual(['exact_name_contact_hospital_appointment'])
  expect(JSON.stringify(review)).not.toContain(a.contactPhone)
  for(const role of ['admin','driver','citizen']){
   await f.request(`/bookings/${a.id}/review`,role,undefined,403)
   await f.request(`/bookings/${a.id}/verification`,role,{eventId:randomUUID(),expectedLatestId:null,outcome:'confirmed',notes:''},403)
  }
  const before=await f.get(a.id),counts=async()=> (await f.pool.query('SELECT (SELECT count(*) FROM patient_transfer.trip_events) AS events,(SELECT count(*) FROM patient_transfer.notifications) AS messages')).rows[0]
  const initialCounts=await counts()
  await page.route('**/api/**',async route=>{const url=new URL(route.request().url());await route.fulfill({response:await route.fetch({url:`${f.base}${url.pathname}${url.search}`})})})
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/,route=>route.abort())
  await page.goto(`/staff/login?next=${encodeURIComponent(`/dispatcher?booking=${a.id}&dialog=details`)}`)
  await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill('synthetic-dispatcher');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(syntheticPassword)
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await page.getByRole('link',{name:'เปิดหน้าจัดรถ',exact:true}).click()
  await page.getByRole('button',{name:'ตรวจรายการอาจซ้ำ / โหลดประวัติล่าสุด',exact:true}).click()
  await expect(page.getByRole('link',{name:b.reference,exact:true})).toBeVisible()
  await page.getByRole('combobox',{name:'ผลการตรวจสอบ',exact:true}).selectOption('unreachable')
  const notes=page.getByLabel('หมายเหตุการติดต่อ',{exact:false});await notes.fill('โทรตรวจสอบจุดรับ ยังติดต่อไม่ได้')
  await page.getByRole('button',{name:'บันทึกผลการตรวจสอบ',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'สถานะคำขอไม่เปลี่ยน'})).toBeVisible()
  review=await f.request(`/bookings/${a.id}/review`);expect(review.history).toHaveLength(1)
  const first=review.history[0]
  await page.getByLabel('แก้ไขผลรายการล่าสุด',{exact:false}).check();await page.getByRole('combobox',{name:'ผลการตรวจสอบ',exact:true}).selectOption('confirmed');await notes.fill('ติดต่อได้และยืนยันจุดรับแล้ว แก้ไขผลเดิม')
  await page.getByRole('button',{name:'บันทึกผลการตรวจสอบ',exact:true}).click()
  await expect(page.getByText('ติดต่อได้และยืนยันจุดรับแล้ว แก้ไขผลเดิม',{exact:true})).toBeVisible()
  review=await f.request(`/bookings/${a.id}/review`)
  expect(review.history).toHaveLength(2);expect(review.history[0].correctsId).toBe(first.id);expect(review.history[1]).toEqual(first)
  expect(await f.get(a.id)).toEqual(before);expect(await counts()).toEqual(initialCounts)
  await expect(f.pool.query('UPDATE patient_transfer.verification_logs SET notes=$1 WHERE id=$2',['overwrite',first.id])).rejects.toThrow('append-only')
  await expect(f.pool.query('DELETE FROM patient_transfer.verification_logs WHERE id=$1',[first.id])).rejects.toThrow('append-only')
  const admin=await f.request('/admin/audit','admin');expect(JSON.stringify(admin)).not.toContain(first.notes)
 }finally{await f.close()}
})

test('same-profile matches differing contacts; stale/replayed/concurrent writes are safe, paginated and atomic',async()=>{
 test.setTimeout(60000)
 const f=await startOperationalTestApi()
 try{
  const a=await f.requested(),b=await f.requested('12:00')
  const consent=await f.request('/consents','citizen',{accepted:true,noticeVersion:'development-v1'},201)
  const profile=await f.request('/profiles','citizen',{consentId:consent.id,patientName:'โปรไฟล์ทดสอบ',contactPhone:'0800000000',mobility:'standard',villageId:ids.village,pickupAddress:'จุดรับทดสอบ',latitude:18.59,longitude:99.05,landmark:'',assistance:[]},201)
  await f.pool.query('UPDATE patient_transfer.bookings SET patient_profile_id=$1 WHERE id=ANY($2::uuid[])',[profile.id,[a.id,b.id]])
  expect((await f.request(`/bookings/${a.id}/review`)).duplicates).toEqual([])
  await f.pool.query("UPDATE patient_transfer.bookings SET appointment_at=$1,contact_phone='0811111111' WHERE id=$2",[a.appointmentAt,b.id])
  expect((await f.request(`/bookings/${a.id}/review`)).duplicates[0].reasons).toEqual(['same_profile_appointment'])
  const path=`/bookings/${a.id}/verification`,body={eventId:randomUUID(),expectedLatestId:null,outcome:'requester_declined',notes:'ไม่ประสงค์ให้ตรวจสอบเพิ่มเติม'}
  await f.request(path,'dispatcher',{...body,recordedAt:'2000-01-01'},400)
  await f.request(path,'dispatcher',{...body,outcome:'auto_reject'},400)
  await f.request(path,'dispatcher',{...body,notes:'ก'.repeat(1001)},400)
  await f.request(path,'dispatcher',body);await f.request(path,'dispatcher',body)
  await f.request(path,'dispatcher',{...body,notes:'changed'},409)
  await f.request(path,'dispatcher',{...body,eventId:randomUUID()},409)
  let latest=body.eventId
  for(let i=0;i<51;i++){
   const id=randomUUID();await f.request(path,'dispatcher',{eventId:id,expectedLatestId:latest,outcome:'confirmed',notes:`ตรวจสอบ ${i}`});latest=id
  }
  const page=await f.request(`/bookings/${a.id}/review`),older=await f.request(`/bookings/${a.id}/review?cursor=${page.nextCursor}`)
  expect(page.history).toHaveLength(50);expect(older.history).toHaveLength(2);expect(new Set([...page.history,...older.history].map(r=>r.id)).size).toBe(52)
  await f.request(`/bookings/${b.id}/review?cursor=${page.nextCursor}`,'dispatcher',undefined,400)
  const login=await fetch(`${f.base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'synthetic-dispatcher',password:syntheticPassword})}),token=(await login.json()).token
  const responses=await Promise.all([0,1].map(async()=> (await fetch(`${f.base}/api${path}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({eventId:randomUUID(),expectedLatestId:latest,outcome:'unreachable',notes:'concurrent'})})).status))
  expect(responses.sort()).toEqual([200,409])
  // Late audit failure rolls back the verification row as well.
  const current=await f.request(`/bookings/${a.id}/review`),failureId=randomUUID()
  await f.pool.query(`CREATE FUNCTION patient_transfer.reject_verification_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='RECORD_VERIFICATION' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_verification_test BEFORE INSERT ON patient_transfer.audit_logs FOR EACH ROW EXECUTE FUNCTION patient_transfer.reject_verification_test()`)
  await f.request(path,'dispatcher',{eventId:failureId,expectedLatestId:current.latestId,outcome:'confirmed',notes:''},500)
  expect((await f.pool.query('SELECT 1 FROM patient_transfer.verification_logs WHERE id=$1',[failureId])).rowCount).toBe(0)
  await f.pool.query("UPDATE patient_transfer.users SET active=false WHERE role='dispatcher'")
  await f.request(`/bookings/${a.id}/review`,'dispatcher',undefined,401)
 }finally{await f.close()}
})
