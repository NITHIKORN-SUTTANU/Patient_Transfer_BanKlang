import {randomUUID} from 'node:crypto'
import {test,expect} from '@playwright/test'
import {startOperationalTestApi,ids} from './helpers/operational-postgres'
import {syntheticPassword} from './helpers/admin-postgres.mjs'

test.use({actionTimeout:10000})
test.beforeEach(()=>test.skip(!process.env.DATABASE_TEST_ADMIN_URL,'Local PostgreSQL required'))
const alternative={vehicleId:ids.vehicle,driverId:ids.driver,originLocationId:ids.depot}

test('original rejection dialog stores considered alternatives, rechecks and links capacity rejection atomically',async({page})=>{
 test.setTimeout(60000)
 const f=await startOperationalTestApi()
 try{
  // This real committed job blocks the same vehicle/driver at the requested time.
  await f.assigned();const booking=await f.requested()
  await page.route('**/api/**',async route=>{const u=new URL(route.request().url());await route.fulfill({response:await route.fetch({url:`${f.base}${u.pathname}${u.search}`})})})
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/,route=>route.abort())
  await page.goto(`/staff/login?next=${encodeURIComponent(`/dispatcher?booking=${booking.id}&dialog=reject`)}`)
  await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill('synthetic-dispatcher');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(syntheticPassword)
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await page.getByRole('link',{name:'เปิดหน้าจัดรถ',exact:true}).click()
  await page.getByRole('combobox',{name:'ประเภทเหตุผลการปฏิเสธ',exact:true}).selectOption('capacity')
  await page.getByLabel('เหตุผลการปฏิเสธ',{exact:true}).fill('ไม่มีรถและคนขับพร้อมหลังตรวจสอบทางเลือกแล้ว')
  await page.getByRole('button',{name:'ยืนยันปฏิเสธคำขอ',exact:true}).click();await expect(page.getByRole('alert')).toContainText('หลักฐาน')
  await page.getByRole('combobox',{name:'รถที่พิจารณา',exact:true}).selectOption(ids.vehicle)
  await page.getByRole('combobox',{name:'คนขับที่พิจารณา',exact:true}).selectOption(ids.driver)
  await page.getByRole('button',{name:'เพิ่มทางเลือกที่พิจารณา',exact:true}).click()
  await page.getByLabel('เหตุผลที่ทางเลือกทั้งหมดไม่สามารถให้บริการได้',{exact:true}).fill('รถและคนขับติดงานที่ยืนยันแล้ว ไม่มีการจัดต้นทางอื่นที่ยืนยันได้')
  await page.getByRole('button',{name:'ตรวจเส้นทางและกำลังรถล่าสุด',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'บันทึกหลักฐานแล้ว'})).toBeVisible()
  const before=await f.get(booking.id);expect(before.status).toBe('REQUESTED')
  expect((await f.pool.query('SELECT count(*)::int AS n FROM patient_transfer.capacity_checks WHERE booking_id=$1',[booking.id])).rows[0].n).toBe(1)
  f.control.unavailable=true
  await page.getByRole('button',{name:'ยืนยันปฏิเสธคำขอ',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible()
  expect(await f.get(booking.id)).toEqual(before);await expect(page.getByLabel('เหตุผลการปฏิเสธ',{exact:true})).toHaveValue('ไม่มีรถและคนขับพร้อมหลังตรวจสอบทางเลือกแล้ว')
  f.control.unavailable=false
  await page.getByRole('button',{name:'ยืนยันปฏิเสธคำขอ',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await f.get(booking.id)).status).toBe('REJECTED')
  const links=(await f.pool.query(`SELECT r.* FROM patient_transfer.capacity_rejections r JOIN patient_transfer.trip_events e ON e.id=r.event_id WHERE e.booking_id=$1`,[booking.id])).rows
  expect(links).toHaveLength(1);expect(links[0].validated_check_id).not.toBe(links[0].source_check_id)
  const review=await f.request(`/bookings/${booking.id}/review`);expect(review.capacityDecision.explanation).toContain('ติดงาน')
  expect(review.capacityDecision.alternatives[0].issues.some((i:{code:string})=>i.code==='CONFLICT')).toBe(true)
  await expect(f.pool.query("UPDATE patient_transfer.capacity_checks SET explanation='rewrite' WHERE id=$1",[links[0].source_check_id])).rejects.toThrow('append-only')
 }finally{await f.close()}
})

test('approved unstarted work considers a real previous-hospital alternative; one viable alternative blocks capacity rejection',async()=>{
 const f=await startOperationalTestApi()
 try{
  const previous=await f.assigned()
  let booking=await f.requested('12:00');booking=await f.command(booking,'APPROVE')
  const input={expectedRevision:booking.revision,explanation:'Checked depot and preceding hospital arrangements',alternatives:[alternative,{...alternative,originKind:'previous_hospital',originLocationId:previous.hospitalLocationId,previousBookingId:previous.id}]}
  const evidence=await f.request(`/bookings/${booking.id}/capacity-checks`,'dispatcher',input)
  expect(evidence.alternatives.map((a:{result:string})=>a.result)).toEqual(['unavailable','available'])
  expect(evidence.rejectable).toBe(false)
  await f.command(booking,'REJECT',{reason:'Capacity claim must fail',rejectionKind:'capacity',capacityCheckId:evidence.id},'dispatcher',409)
  expect((await f.get(booking.id)).status).toBe('APPROVED')
 }finally{await f.close()}
})

test('capacity evidence rejects viable, stale, foreign or incomplete checks and preserves replay/rollback',async()=>{
 test.setTimeout(60000)
 const f=await startOperationalTestApi()
 try{
  const a=await f.requested(),path=`/bookings/${a.id}/capacity-checks`,body={expectedRevision:a.revision,alternatives:[alternative],explanation:'Investigated available alternatives'}
  for(const role of ['citizen','driver','admin'])await f.request(path,role,body,403)
  await f.request(path,'dispatcher',{...body,alternatives:[]},400)
  const available=await f.request(path,'dispatcher',body);expect(available.rejectable).toBe(false);expect(available.alternatives[0].result).toBe('available')
  await f.command(a,'REJECT',{reason:'Not enough vehicles',rejectionKind:'capacity',capacityCheckId:available.id},'dispatcher',409)
  await f.command(a,'REJECT',{reason:'Not enough vehicles'},'dispatcher',400)
  f.control.unavailable=true;await f.request(path,'dispatcher',body,503);f.control.unavailable=false
  await f.assigned();const blocked=await f.request(path,'dispatcher',body);expect(blocked.rejectable).toBe(true)
  const b=await f.requested();await f.command(b,'REJECT',{reason:'Capacity rejection',rejectionKind:'capacity',capacityCheckId:blocked.id},'dispatcher',409)
  // Any resource revision invalidates previously captured state, even unchanged times.
  const beforeRevision=await f.request(path,'dispatcher',body)
  await f.pool.query('UPDATE patient_transfer.vehicles SET revision=revision+1 WHERE id=$1',[ids.vehicle])
  await f.command(a,'REJECT',{reason:'Capacity rejection',rejectionKind:'capacity',capacityCheckId:beforeRevision.id},'dispatcher',409)
  let current=await f.request(path,'dispatcher',body)
  // Changed route results are evaluated again at decision time, not trusted from the saved check.
  f.control.minutes=180
  await f.command(a,'REJECT',{reason:'Capacity rejection',rejectionKind:'capacity',capacityCheckId:current.id},'dispatcher',409)
  f.control.minutes=35;current=await f.request(path,'dispatcher',body)
  const eventId=randomUUID(),command={type:'REJECT',reason:'No valid considered alternatives',rejectionKind:'capacity',capacityCheckId:current.id},payload={eventId,expectedRevision:a.revision,expectedExecutionVersion:a.executionVersion,command}
  await f.pool.query(`CREATE FUNCTION patient_transfer.fail_capacity_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected decision-link failure'; END $$; CREATE TRIGGER fail_capacity_test BEFORE INSERT ON patient_transfer.capacity_rejections FOR EACH ROW EXECUTE FUNCTION patient_transfer.fail_capacity_test()`)
  await f.request(`/bookings/${a.id}/commands`,'dispatcher',payload,500)
  expect((await f.get(a.id)).status).toBe('REQUESTED');expect((await f.pool.query('SELECT 1 FROM patient_transfer.trip_events WHERE id=$1',[eventId])).rowCount).toBe(0)
  await f.pool.query('DROP TRIGGER fail_capacity_test ON patient_transfer.capacity_rejections; DROP FUNCTION patient_transfer.fail_capacity_test()')
  await f.request(`/bookings/${a.id}/commands`,'dispatcher',payload);await f.request(`/bookings/${a.id}/commands`,'dispatcher',payload)
  expect((await f.pool.query('SELECT 1 FROM patient_transfer.capacity_rejections WHERE event_id=$1',[eventId])).rowCount).toBe(1)
  const citizen=await f.request(`/bookings/${a.id}`,'citizen');expect(JSON.stringify(citizen)).not.toContain('capacityDecision')
 }finally{await f.close()}
})
