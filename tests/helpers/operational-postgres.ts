import { randomUUID } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
import { startAdminTestApi, syntheticPassword } from './admin-postgres.mjs'
import { newToken, tokenHash } from '../../server/auth.mjs'
import { ApiError } from '../../server/errors.mjs'
import type { ApiBooking } from '../../src/services/dispatcherApi'

export const ids = { citizen:'00000000-0000-4000-8000-000000000001', hospital:'40000000-0000-4000-8000-000000000001', village:'30000000-0000-4000-8000-000000000001', depot:'20000000-0000-4000-8000-000000000001', vehicle:'50000000-0000-4000-8000-000000000001', driver:'60000000-0000-4000-8000-000000000001' }

export async function startOperationalTestApi(providers: { liffId?: string; verifyLine?: (token: string) => Promise<{ subject: string; name: string }> } = {}) {
  const adminUrl=process.env.DATABASE_TEST_ADMIN_URL
  if (!adminUrl) throw new Error('Local DATABASE_TEST_ADMIN_URL required')
  const control={ now:'2030-01-12T00:00:00Z', unavailable:false, minutes:35, remainingMinutes:35 }
  const api=await startAdminTestApi(adminUrl, {...providers, clock:()=>control.now, route:async (from: {kind?: string})=>{
    if(control.unavailable) throw new ApiError(503,'Injected routing outage')
    return {minutes:from.kind==='continuation'?control.remainingMinutes:from.kind?15:control.minutes,source:'synthetic-configuration-test'}
  }})
  const tokens: Record<string,string>={citizen:newToken()}
  await api.pool.query(`INSERT INTO patient_transfer.auth_sessions(user_id,token_hash,access_version,created_at,expires_at)
    SELECT id,$1,access_version,'2030-01-01','2031-01-01' FROM patient_transfer.users WHERE id=$2`,[tokenHash(tokens.citizen),ids.citizen])
  for(const [kind,field] of [['vehicles','vehicle_id'],['drivers','driver_id']]) await api.pool.query(`INSERT INTO patient_transfer.availability_windows(${field},starts_at,ends_at)
    SELECT r.id,d+time '06:00'-interval '7 hours',d+time '16:00'-interval '7 hours' FROM patient_transfer.${kind} r CROSS JOIN generate_series(date '2030-01-15',date '2030-01-19',interval '1 day') d`)
  async function login(role:string) {
    const response=await fetch(`${api.base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:`synthetic-${role}`,password:syntheticPassword})})
    expect(response.status).toBe(200);tokens[role]=(await response.json()).token
  }
  for(const role of ['admin','dispatcher','driver']) await login(role)
  async function request(path:string,role='dispatcher',body?:unknown,status=200) {
    const response=await fetch(`${api.base}/api${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${tokens[role]}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
    const result=await response.json()
    expect(response.status,JSON.stringify(result)).toBe(status)
    return result
  }
  const get=(id:string):Promise<ApiBooking>=>request(`/bookings/${id}`)
  const selection=(booking:ApiBooking,extra={})=>({eventId:randomUUID(),expectedRevision:booking.revision,vehicleId:ids.vehicle,driverId:ids.driver,originLocationId:ids.depot,...extra})
  const command=(booking:ApiBooking,type:string,extra={},role='dispatcher',status=200)=>request(`/bookings/${booking.id}/commands`,role,{eventId:randomUUID(),expectedRevision:booking.revision,expectedExecutionVersion:booking.executionVersion,command:{type,...extra}},status)
  async function requested(clock='09:00') {
    const consent=await request('/consents','citizen',{accepted:true,noticeVersion:'development-v1'},201)
    return request('/bookings','citizen',{consentId:consent.id,bookingFor:'self',patientName:'ผู้ป่วยทดสอบการตั้งค่า',requesterName:'ผู้ขอทดสอบ',contactPhone:'0800000000',pickupAddress:'จุดรับสังเคราะห์',latitude:18.59,longitude:99.05,villageId:ids.village,hospitalId:ids.hospital,mobility:'standard',appointmentAt:`2030-01-15T${clock}:00+07:00`},201) as Promise<ApiBooking>
  }
  async function assigned(clock='09:00',extra={}) {
    let booking=await requested(clock)
    booking=await command(booking,'APPROVE')
    booking=await request(`/bookings/${booking.id}/schedule`,'dispatcher',selection(booking,extra))
    return request(`/bookings/${booking.id}/assignment`,'dispatcher',selection(booking,extra)) as Promise<ApiBooking>
  }
  async function changeHospital(extra={}) {
    const data=await request('/admin/service-data','admin')
    const h=data.hospitals.find((row:{id:string})=>row.id===ids.hospital)
    return request(`/admin/hospitals/${h.id}`,'admin',{name:h.name,active:h.active,latitude:h.latitude+0.001,longitude:h.longitude,reason:'พิกัดที่อนุมัติสำหรับทดสอบ',expectedRevision:h.revision,...extra})
  }
  async function snapshot(id:string) {
    const booking=await get(id)
    const schedules=(await api.pool.query('SELECT id,hospital_location_snapshot,released_at,committed FROM patient_transfer.schedules WHERE booking_id=$1 ORDER BY created_at,id',[id])).rows
    return {booking,schedules}
  }
  async function open(page:Page,action='modify') {
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url())
      try {await route.fulfill({response:await route.fetch({url:`${api.base}${url.pathname}${url.search}`})})}
      catch {throw new Error(`Ephemeral configuration API request failed: ${url.pathname}`)}
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/,route=>route.abort())
    await page.goto('/staff/login?next=%2Fdispatcher%2Ftracking')
    await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill('synthetic-dispatcher')
    await page.getByLabel('รหัสผ่าน',{exact:true}).fill(syntheticPassword)
    await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click()
    await page.getByRole('link',{name:'เปิดหน้าจัดรถ',exact:true}).click()
    await page.getByRole('button',{name:'ดูสถานะ →',exact:true}).click()
    await page.getByRole('combobox',{name:'การดำเนินการ',exact:true}).selectOption(action)
  }
  return {...api,control,request,get,selection,command,requested,assigned,changeHospital,snapshot,open,login}
}

