import { randomUUID } from 'node:crypto'
import { test,expect } from '@playwright/test'
import { startOperationalTestApi,ids } from './helpers/operational-postgres'
import { syntheticPassword } from './helpers/admin-postgres.mjs'
import type { ApiBooking } from '../src/services/dispatcherApi'

test.use({actionTimeout:10000})
test.beforeEach(()=>test.skip(!process.env.DATABASE_TEST_ADMIN_URL,'Run npm run test:destination:integration with a local test database configured'))

async function setup(phase='IN_TRANSIT',chain=false) {
  const f=await startOperationalTestApi()
  let booking=await f.assigned()
  const next=chain?await f.assigned('11:00',{originKind:'previous_hospital',originLocationId:booking.hospitalLocationId,previousBookingId:booking.id}):null
  f.control.now=booking.schedule!.departureAt
  for(const role of ['dispatcher','admin','driver']) await f.login(role)
  booking=await f.command(booking,'START_TRIP',{},'driver')
  booking=await f.command(booking,'DEPART_ORIGIN',{},'driver')
  f.control.now=booking.schedule!.pickupAt
  booking=await f.command(booking,'CONFIRM_PICKUP',{},'driver')
  if(phase==='IN_TRANSIT') booking=await f.command(booking,'DEPART_FOR_HOSPITAL',{},'driver')
  f.control.now=new Date(Date.parse(f.control.now)+5*60000).toISOString()
  const hospital=await f.request('/admin/hospitals','admin',{name:'โรงพยาบาลปลายทางใหม่ทดสอบ',latitude:18.65,longitude:99.08,active:true,reason:'Approved synthetic destination'})
  const body=(row:ApiBooking=booking,extra={})=>({eventId:randomUUID(),expectedRevision:row.revision,expectedExecutionVersion:row.executionVersion,hospitalId:hospital.id,reason:'ตรวจสอบปลายทางใหม่และการเดินทางต่อแล้ว',currentLocation:{latitude:18.60,longitude:99.06,label:'จุดปัจจุบันที่ตรวจสอบ'},confirmedAt:f.control.now,confirmedPhase:row.status,...extra})
  async function state() {
    return {booking:await f.get(booking.id),schedules:(await f.pool.query('SELECT * FROM patient_transfer.schedules WHERE booking_id=$1 ORDER BY id',[booking.id])).rows,
      legs:(await f.pool.query('SELECT * FROM patient_transfer.trip_route_legs WHERE booking_id=$1 ORDER BY version',[booking.id])).rows,
      events:(await f.pool.query('SELECT * FROM patient_transfer.trip_events WHERE booking_id=$1 ORDER BY sequence',[booking.id])).rows,
      outbox:(await f.pool.query('SELECT * FROM patient_transfer.notifications WHERE booking_id=$1 ORDER BY id',[booking.id])).rows}
  }
  return {...f,booking,next,hospital,body,state}
}

test('dispatcher changes an onboard destination through original screens; driver reloads and completes the same booking',async({page})=>{
  test.setTimeout(60000)
  const f=await setup()
  try {
    const before=await f.state()
    await page.clock.setFixedTime(new Date(f.control.now))
    await f.open(page,'destination')
    await page.getByRole('combobox',{name:'โรงพยาบาลปลายทางใหม่',exact:true}).selectOption(f.hospital.id)
    await page.getByLabel('สถานที่ปัจจุบันที่ตรวจสอบ',{exact:true}).fill('จุดปัจจุบันที่ตรวจสอบ')
    await page.getByLabel('ละติจูดปัจจุบัน',{exact:true}).fill('18.60')
    await page.getByLabel('ลองจิจูดปัจจุบัน',{exact:true}).fill('99.06')
    await page.getByLabel('เหตุผลเปลี่ยนโรงพยาบาล',{exact:true}).fill('ตรวจสอบปลายทางใหม่และการเดินทางต่อแล้ว')
    await page.getByRole('checkbox',{name:'ยืนยันตำแหน่งจริงและสถานะปัจจุบันแล้ว (ภายใน 5 นาที)',exact:true}).check()
    const preview=page.getByRole('button',{name:'ตรวจเส้นทางและเวลาต่อจากตำแหน่งปัจจุบัน',exact:true})
    f.control.unavailable=true
    await preview.click()
    await expect(page.getByRole('alert')).toBeVisible()
    expect(await f.state()).toEqual(before)
    f.control.unavailable=false
    await preview.click()
    await expect(page.getByRole('button',{name:'ตรวจสอบและยืนยันปลายทางใหม่',exact:true})).toBeVisible()
    expect(await f.state()).toEqual(before)
    await page.getByRole('button',{name:'ตรวจสอบและยืนยันปลายทางใหม่',exact:true}).click()
    const dialog=page.getByRole('dialog',{name:'ยืนยันเปลี่ยนโรงพยาบาล',exact:true})
    f.control.unavailable=true
    await dialog.getByRole('button',{name:'ยืนยันปลายทางใหม่',exact:true}).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    expect(await f.state()).toEqual(before)
    f.control.unavailable=false
    const submitted=page.waitForRequest(r=>r.url().endsWith('/destination')&&r.method()==='POST')
    await dialog.getByRole('button',{name:'ยืนยันปลายทางใหม่',exact:true}).click()
    const request=(await submitted).postDataJSON()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('กำลังโหลดข้อมูล…',{exact:true})).toHaveCount(0)
    const after=await f.state(),row=after.booking
    expect(row.status).toBe('IN_TRANSIT');expect(row.startedAt).toBe(f.booking.startedAt)
    expect(row.reference).toBe(f.booking.reference);expect(row.appointmentAt).toBe(f.booking.appointmentAt)
    expect(row.hospitalId).toBe(f.hospital.id);expect(row.executionVersion).toBe(f.booking.executionVersion+1)
    expect(row.destinationRevision!.latenessSeconds).toBeGreaterThan(0)
    expect(after.schedules).toEqual(before.schedules)
    expect(after.events.filter((e:{command:string})=>e.command==='CONFIRM_PICKUP')).toEqual(before.events.filter((e:{command:string})=>e.command==='CONFIRM_PICKUP'))
    expect(after.legs).toHaveLength(1);expect(after.outbox.length-before.outbox.length).toBe(2)
    await f.command(f.booking,'CONFIRM_HANDOVER',{},'driver',409)
    f.control.unavailable=true
    await f.request(`/bookings/${row.id}/destination`,'dispatcher',request)
    expect(await f.state()).toEqual(after)
    await f.request(`/bookings/${row.id}/destination`,'dispatcher',{...request,reason:'Different replay'},409)
    f.control.unavailable=false
    await expect(f.pool.query('UPDATE patient_transfer.trip_route_legs SET reason=$2 WHERE id=$1',[after.legs[0].id,'Rewrite history'])).rejects.toMatchObject({code:'55000'})
    const owner=await f.request(`/bookings/${row.id}`,'citizen')
    expect(owner.hospitalName).toBe(f.hospital.name);expect(owner.appointmentAt).toBe(f.booking.appointmentAt)
    await page.goto('/staff/login?next=%2Fdriver')
    await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill('synthetic-driver')
    await page.getByLabel('รหัสผ่าน',{exact:true}).fill(syntheticPassword)
    await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click()
    await page.getByRole('link',{name:'เปิดหน้าคนขับ',exact:true}).click()
    await expect(page.getByText(f.hospital.name,{exact:true})).toBeVisible()
    await expect(page.getByRole('region',{name:'ปลายทางและเวลาที่ปรับแล้ว',exact:true})).toBeVisible()
    f.control.now=row.destinationRevision!.arrivalAt
    const driver=await f.request(`/bookings/${row.id}`,'driver')
    expect(driver.hospitalId).toBe(f.hospital.id)
    let completed=await f.command(row,'CONFIRM_HANDOVER',{},'driver')
    expect(completed.status).toBe('COMPLETED')
    await f.command(completed,'CONFIRM_READY',{reason:'Too early'},'dispatcher',409)
    f.control.now=row.destinationRevision!.readyAt
    completed=await f.command(completed,'CONFIRM_READY',{reason:'Actual readiness verified'})
    expect(completed.resourceHold).toBe(false)
  } finally {if(!page.isClosed()){await page.unrouteAll({behavior:'wait'});await page.close()}await f.close()}
})

test('only dispatcher can continue after actual pickup with fresh physical confirmation and current revisions',async()=>{
  const f=await setup('PICKED_UP')
  try {
    const original=await f.state()
    for(const role of ['admin','citizen','driver']) await f.request(`/bookings/${f.booking.id}/destination`,role,f.body(),403)
    for(const extra of [
      {expectedRevision:f.booking.revision-1}, {expectedExecutionVersion:f.booking.executionVersion+1}, {confirmedPhase:'IN_TRANSIT'},
    ]) await f.request(`/bookings/${f.booking.id}/destination`,'dispatcher',f.body(f.booking,extra),409)
    for(const confirmedAt of [new Date(Date.parse(f.control.now)+1).toISOString(),new Date(Date.parse(f.control.now)-5*60000-1).toISOString(),f.booking.startedAt!]) await f.request(`/bookings/${f.booking.id}/destination`,'dispatcher',f.body(f.booking,{confirmedAt}),422)
    await f.request(`/bookings/${f.booking.id}/destination`,'dispatcher',f.body(f.booking,{reason:''}),400)
    await f.request(`/bookings/${f.booking.id}/destination`,'dispatcher',f.body(f.booking,{currentLocation:{latitude:91,longitude:99,label:'Bad coordinate'}}),400)
    await f.request(`/bookings/${f.booking.id}/destination`,'dispatcher',f.body(f.booking,{hospitalId:ids.hospital}),422)
    await f.request(`/bookings/${f.booking.id}/modification`,'dispatcher',f.selection(f.booking,{reason:'Must not weaken pre-pickup modification'}),409)
    expect(await f.state()).toEqual(original)
    let row=await f.request(`/bookings/${f.booking.id}/destination`,'dispatcher',f.body())
    expect(row.status).toBe('PICKED_UP');expect(row.cancellationLocked).toBe(true)
    await f.command(row,'CANCEL',{reason:'Cannot cancel onboard patient'},'citizen',409)
    const second=await f.request(`/bookings/${row.id}/destination`,'dispatcher',f.body(row,{hospitalId:ids.hospital}))
    expect(second.destinationRevision.version).toBe(2)
    const legs=(await f.state()).legs
    expect(legs[1].previous_leg_id).toBe(legs[0].id)
    row=await f.command(second,'DEPART_FOR_HOSPITAL',{},'driver')
    expect(row.status).toBe('IN_TRANSIT')
  } finally {await f.close()}
})

test('active late continuation can overrun original hours while incident holds and physical history remain',async()=>{
  const f=await setup()
  try {
    const incident=await f.command(f.booking,'REPORT_INCIDENT',{reason:'Synthetic incident requiring dispatcher intervention'})
    f.control.now='2030-01-15T09:20:00Z'
    for(const role of ['dispatcher','admin','driver']) await f.login(role)
    f.control.remainingMinutes=45
    const row=await f.request(`/bookings/${incident.id}/destination`,'dispatcher',f.body(incident))
    expect(row.status).toBe('IN_TRANSIT');expect(row.incidentOpen).toBe(true);expect(row.resourceHold).toBe(true)
    expect(Date.parse(row.destinationRevision.arrivalAt)).toBe(Date.parse('2030-01-15T10:05:00Z'))
    expect(Date.parse(row.destinationRevision.readyAt)).toBe(Date.parse('2030-01-15T10:35:00Z'))
    expect((await f.request(`/bookings/${row.id}`,'driver')).hospitalId).toBe(f.hospital.id)
    await f.command(row,'CONFIRM_HANDOVER',{},'driver',409)
    const resolved=await f.command(row,'RESOLVE_INCIDENT',{reason:'Actual incident resolved separately'})
    expect(resolved.incidentOpen).toBe(false)
    expect((await f.state()).events.filter((e:{command:string})=>e.command==='CONFIRM_PICKUP')).toHaveLength(1)
    const aborted=await f.command(resolved,'ABORT',{reason:'Actual transport ended without handover',endedAt:f.control.now,location:'Confirmed safe location',disposition:'Dispatcher arranged safe onward care'})
    expect(aborted.status).toBe('ABORTED');expect(aborted.resourceHold).toBe(true)
    expect(aborted.hospitalId).toBe(f.hospital.id);expect(aborted.destinationRevision.version).toBe(1)
    expect(aborted.schedule).toBeNull()
  } finally {await f.close()}
})

test('continuation protects downstream intervals and origins atomically, including raw database commits',async()=>{
  const f=await setup('IN_TRANSIT',true)
  try {
    f.control.remainingMinutes=180
    const before=await f.state(),following=await f.snapshot(f.next!.id)
    await f.request(`/bookings/${f.booking.id}/destination`,'dispatcher',f.body(),409)
    expect(await f.state()).toEqual(before);expect(await f.snapshot(f.next!.id)).toEqual(following)
    await f.command(f.next!,'CANCEL',{reason:'Remove incompatible future commitment before continuation'})
    const row=await f.request(`/bookings/${f.booking.id}/destination`,'dispatcher',f.body())
    expect(row.hospitalId).toBe(f.hospital.id)
    const old=following.schedules.find((s:{committed:boolean})=>s.committed)
    await expect(f.pool.query(`INSERT INTO patient_transfer.schedules SELECT (jsonb_populate_record(NULL::patient_transfer.schedules,
      to_jsonb(s)||jsonb_build_object('id',$2::text,'released_at',NULL,'created_at',now()))).* FROM patient_transfer.schedules s WHERE id=$1`,[old.id,randomUUID()])).rejects.toMatchObject({code:'23P01'})
    // New normal scheduling must use the effective continuation interval too.
    const pending=await f.get(f.next!.id)
    expect(pending.status).toBe('CANCELLED')
    expect((await f.state()).legs).toHaveLength(1)
  } finally {await f.close()}
})

test('destination boundary refuses pre-pickup work and rolls back event, audit and outbox on a late database failure',async()=>{
  const f=await startOperationalTestApi()
  try {
    let booking=await f.assigned()
    const hospital=await f.request('/admin/hospitals','admin',{name:'Synthetic destination',latitude:18.65,longitude:99.08,active:true,reason:'Synthetic destination setup'})
    const body=()=>({eventId:randomUUID(),expectedRevision:booking.revision,expectedExecutionVersion:booking.executionVersion,hospitalId:hospital.id,reason:'Injected write rollback',currentLocation:{latitude:18.60,longitude:99.06,label:'Verified synthetic point'},confirmedAt:f.control.now,confirmedPhase:booking.status})
    await f.request(`/bookings/${booking.id}/destination`,'dispatcher',body(),409)
    f.control.now=booking.schedule!.departureAt
    for(const role of ['dispatcher','admin','driver']) await f.login(role)
    booking=await f.command(booking,'START_TRIP',{},'driver')
    booking=await f.command(booking,'DEPART_ORIGIN',{},'driver')
    await f.request(`/bookings/${booking.id}/destination`,'dispatcher',body(),409)
    f.control.now=booking.schedule!.pickupAt
    booking=await f.command(booking,'CONFIRM_PICKUP',{},'driver')
    const before=await f.snapshot(booking.id)
    const counts=async()=> (await f.pool.query(`SELECT (SELECT count(*) FROM patient_transfer.trip_events WHERE booking_id=$1) AS events,
      (SELECT count(*) FROM patient_transfer.audit_logs WHERE entity_id=$1) AS audit,(SELECT count(*) FROM patient_transfer.notifications WHERE booking_id=$1) AS outbox`,[booking.id])).rows[0]
    const originalCounts=await counts()
    await f.pool.query(`CREATE FUNCTION patient_transfer.synthetic_route_write_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected test failure' USING ERRCODE='23514'; END $$`)
    await f.pool.query('CREATE TRIGGER synthetic_route_failure BEFORE INSERT ON patient_transfer.trip_route_legs FOR EACH ROW EXECUTE FUNCTION patient_transfer.synthetic_route_write_failure()')
    await f.request(`/bookings/${booking.id}/destination`,'dispatcher',body(),422)
    expect(await f.snapshot(booking.id)).toEqual(before)
    expect(await counts()).toEqual(originalCounts)
    expect((await f.pool.query('SELECT count(*)::int AS n FROM patient_transfer.trip_route_legs')).rows[0].n).toBe(0)
  } finally {await f.close()}
})
