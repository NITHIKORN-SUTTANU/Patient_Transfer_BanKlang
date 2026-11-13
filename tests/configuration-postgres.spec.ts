import { test, expect } from '@playwright/test'
import { startOperationalTestApi as fixture, ids } from './helpers/operational-postgres'

test.use({ actionTimeout: 10000 })
test.beforeEach(()=>test.skip(!process.env.DATABASE_TEST_ADMIN_URL,'Run npm run test:configuration:integration with a local test database configured'))

test('original dispatcher reviews an assigned location replacement, retains failed writes and commits only explicit acceptance',async({page})=>{
  test.setTimeout(60000)
  const f=await fixture()
  try {
    const original=await f.assigned()
    const master=await f.changeHospital()
    const before=await f.snapshot(original.id)
    expect(before.booking.hospitalLocationId).toBe(original.hospitalLocationId)
    expect(before.booking.scheduleReviewRequired).toBe(true)
    f.control.minutes=40
    await f.open(page)
    await expect(page.getByRole('button',{name:'ตรวจสอบและยืนยันการเปลี่ยนแปลง',exact:true})).toBeDisabled()
    await page.getByRole('checkbox',{name:'ตรวจสอบและนำการตั้งค่าปัจจุบันมาคำนวณใหม่',exact:true}).check()
    await page.getByLabel('เหตุผลการเปลี่ยนแปลง').fill('ตรวจเส้นทางและเวลาใหม่แล้ว')
    const previewButton=page.getByRole('button',{name:'คำนวณข้อเสนอใหม่โดยยังไม่เปลี่ยนตาราง',exact:true})
    f.control.unavailable=true
    await previewButton.click()
    await expect(page.getByRole('alert').filter({hasText:'บริการคำนวณเส้นทางยังไม่พร้อม'})).toBeVisible()
    expect(await f.snapshot(original.id)).toEqual(before)
    f.control.unavailable=false
    await previewButton.click()
    await expect(page.getByText('ข้อเสนอคำนวณจากเส้นทางที่ตรวจสอบแล้ว กรุณาตรวจเวลาข้างต้นก่อนยืนยัน')).toBeVisible()
    expect(await f.snapshot(original.id)).toEqual(before)
    await page.getByRole('button',{name:'ตรวจสอบและยืนยันการเปลี่ยนแปลง',exact:true}).click()
    f.control.unavailable=true
    const confirmation=page.getByRole('dialog',{name:'ยืนยันการเปลี่ยนแปลง',exact:true})
    await confirmation.getByRole('button',{name:'ยืนยันการเปลี่ยนแปลง',exact:true}).click()
    await expect(confirmation.getByRole('alert')).toContainText('บริการคำนวณเส้นทางยังไม่พร้อม')
    expect(await f.snapshot(original.id)).toEqual(before)
    f.control.unavailable=false
    await confirmation.getByRole('button',{name:'ยืนยันการเปลี่ยนแปลง',exact:true}).click()
    await expect(confirmation).toHaveCount(0)
    await expect(page.locator('.dispatch-notice')).toContainText('บันทึกการดำเนินการแล้ว')
    await expect(page.getByText('กำลังโหลดข้อมูล…',{exact:true})).toHaveCount(0)
    const after=await f.snapshot(original.id)
    expect(after.booking.status).toBe('ASSIGNED')
    expect(after.booking.hospitalLocationId).toBe(master.locationId)
    expect(after.booking.scheduleReviewRequired).toBe(false)
    expect(after.booking.schedule?.pickupAt).not.toBe(original.schedule?.pickupAt)
    expect(after.schedules.filter((row:{committed:boolean;released_at:unknown})=>row.committed&&!row.released_at)).toHaveLength(1)
    expect(after.schedules.some((row:{id:string;released_at:unknown})=>row.id===before.schedules.find((s:{committed:boolean})=>s.committed).id&&!!row.released_at)).toBe(true)
    expect((await f.pool.query("SELECT count(*)::int AS n FROM patient_transfer.audit_logs WHERE entity_id=$1 AND action='ACCEPT_CONFIGURATION'",[original.id])).rows[0].n).toBe(1)
  } finally {if(!page.isClosed()){await page.unrouteAll({behavior:'wait'});await page.close()}await f.close()}
})

test('dispatcher previews and direct commands reject inactive hospitals, changed boundaries and closure dates',async({page})=>{
  test.setTimeout(60000)
  const f=await fixture()
  async function blockedPreview(status:number) {
    await f.open(page)
    await page.getByRole('checkbox',{name:'ตรวจสอบและนำการตั้งค่าปัจจุบันมาคำนวณใหม่',exact:true}).check()
    await page.getByLabel('เหตุผลการเปลี่ยนแปลง').fill('ตรวจสอบเงื่อนไขที่ไม่ผ่าน')
    const response=page.waitForResponse(response=>response.url().endsWith('/configuration-preview')&&response.request().method()==='POST')
    await page.getByRole('button',{name:'คำนวณข้อเสนอใหม่โดยยังไม่เปลี่ยนตาราง',exact:true}).click()
    expect((await response).status()).toBe(status)
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('button',{name:'ตรวจสอบและยืนยันการเปลี่ยนแปลง',exact:true})).toBeDisabled()
  }
  try {
    const original=await f.assigned()
    await f.changeHospital({active:false})
    let booking=await f.get(original.id)
    let before=await f.snapshot(original.id)
    await blockedPreview(422)
    await f.request(`/bookings/${booking.id}/configuration-preview`,'dispatcher',f.selection(booking),422)
    let settings=await f.request('/admin/service-data','admin')
    await f.request(`/bookings/${booking.id}/modification`,'dispatcher',f.selection(booking,{acceptConfiguration:true,expectedConfigurationRevision:settings.settings.revision,reason:'Inactive hospital cannot be accepted'}),422)
    expect(await f.snapshot(original.id)).toEqual(before)
    await f.changeHospital({active:true})
    const data=await f.request('/admin/service-data','admin')
    const village=data.villages.find((row:{id:string})=>row.id===ids.village)
    const villageBody={name:village.name,number:village.number,active:true,shape:'circle',latitude:19,longitude:100,radiusMetres:100,reason:'Approved boundary test',expectedRevision:village.revision}
    const changed=await f.request(`/admin/villages/${ids.village}`,'admin',villageBody)
    booking=await f.get(original.id);before=await f.snapshot(original.id)
    await blockedPreview(422)
    await f.request(`/bookings/${booking.id}/configuration-preview`,'dispatcher',f.selection(booking),422)
    settings=await f.request('/admin/service-data','admin')
    await f.request(`/bookings/${booking.id}/modification`,'dispatcher',f.selection(booking,{acceptConfiguration:true,expectedConfigurationRevision:settings.settings.revision,reason:'Out of boundary cannot be accepted'}),422)
    expect(await f.snapshot(original.id)).toEqual(before)
    await f.request(`/admin/villages/${ids.village}`,'admin',{...villageBody,latitude:village.latitude,longitude:village.longitude,radiusMetres:village.radiusMetres,expectedRevision:changed.revision})
    const closure=await f.request('/admin/closures','admin',{date:'2030-01-15',reason:'Closed test day',expectedRevision:0})
    booking=await f.get(original.id);before=await f.snapshot(original.id)
    await blockedPreview(409)
    await f.request(`/bookings/${booking.id}/configuration-preview`,'dispatcher',f.selection(booking),409)
    settings=await f.request('/admin/service-data','admin')
    await f.request(`/bookings/${booking.id}/modification`,'dispatcher',f.selection(booking,{acceptConfiguration:true,expectedConfigurationRevision:settings.settings.revision,reason:'Attempt closed replacement'}),409)
    expect(await f.snapshot(original.id)).toEqual(before)
    await f.request('/admin/closures','admin',{date:closure.date,active:false,reason:'Reopening test day',expectedRevision:closure.revision})
    booking=await f.get(original.id)
    const preview=await f.request(`/bookings/${booking.id}/configuration-preview`,'dispatcher',f.selection(booking))
    expect(preview.configurationRevision).toBeGreaterThan(0)
  } finally {if(!page.isClosed()){await page.unrouteAll({behavior:'wait'});await page.close()}await f.close()}
})

test('changing a predecessor destination cannot silently move the downstream chained origin',async()=>{
  const f=await fixture()
  try {
    const first=await f.assigned()
    const second=await f.assigned('11:00',{originLocationId:first.hospitalLocationId,originKind:'previous_hospital',previousBookingId:first.id})
    await f.changeHospital()
    const booking=await f.get(first.id)
    const beforeFirst=await f.snapshot(first.id),beforeSecond=await f.snapshot(second.id)
    const result=await f.request(`/bookings/${first.id}/configuration-preview`,'dispatcher',f.selection(booking),409)
    expect(result.details.some((issue:{code:string;tripId:string})=>issue.code==='LOCATION'&&issue.tripId===second.id)).toBe(true)
    const data=await f.request('/admin/service-data','admin')
    await f.request(`/bookings/${first.id}/modification`,'dispatcher',f.selection(booking,{acceptConfiguration:true,expectedConfigurationRevision:data.settings.revision,reason:'Cannot invalidate following origin'}),409)
    expect(await f.snapshot(first.id)).toEqual(beforeFirst)
    expect(await f.snapshot(second.id)).toEqual(beforeSecond)
    // Explicitly remove the incompatible downstream commitment before accepting
    // a predecessor replacement, then create its successor at the new location.
    await f.command(await f.get(second.id),'CANCEL',{reason:'Remove incompatible future chain before reviewed replacement'})
    const fresh=await f.get(first.id)
    const preview=await f.request(`/bookings/${first.id}/configuration-preview`,'dispatcher',f.selection(fresh))
    const accepted=await f.request(`/bookings/${first.id}/modification`,'dispatcher',f.selection(fresh,{acceptConfiguration:true,expectedConfigurationRevision:preview.configurationRevision,reason:'Following commitment explicitly removed'}))
    expect(accepted.hospitalLocationId).not.toBe(first.hospitalLocationId)
    const replacement=await f.assigned('11:00',{originLocationId:accepted.hospitalLocationId,originKind:'previous_hospital',previousBookingId:first.id})
    expect(replacement.schedule?.originLocationId).toBe(accepted.hospitalLocationId)
  } finally {await f.close()}
})

test('started trips retain their destination and reject master configuration acceptance',async({page})=>{
  const f=await fixture()
  try {
    let booking=await f.assigned()
    f.control.now='2030-01-15T00:00:00Z'
    for(const role of ['admin','dispatcher','driver']) await f.login(role)
    booking=await f.command(booking,'START_TRIP',{},'driver')
    const before=await f.snapshot(booking.id)
    const changed=await f.changeHospital()
    expect(changed.affectedCount).toBe(0)
    expect(await f.snapshot(booking.id)).toEqual(before)
    await f.request(`/bookings/${booking.id}/configuration-preview`,'dispatcher',f.selection(booking),409)
    const data=await f.request('/admin/service-data','admin')
    await f.request(`/bookings/${booking.id}/modification`,'dispatcher',f.selection(booking,{acceptConfiguration:true,expectedConfigurationRevision:data.settings.revision,reason:'Must not redirect active trip'}),409)
    expect(await f.snapshot(booking.id)).toEqual(before)
    await f.open(page)
    await expect(page.getByRole('checkbox',{name:'ตรวจสอบและนำการตั้งค่าปัจจุบันมาคำนวณใหม่',exact:true})).toHaveCount(0)
    await expect(page.getByRole('button',{name:'คำนวณข้อเสนอใหม่โดยยังไม่เปลี่ยนตาราง',exact:true})).toHaveCount(0)
  } finally {if(!page.isClosed()){await page.unrouteAll({behavior:'wait'});await page.close()}await f.close()}
})
