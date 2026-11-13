import {test,expect} from '@playwright/test'
import ExcelJS from 'exceljs'
import {startOperationalTestApi} from './helpers/operational-postgres'
import {syntheticPassword} from './helpers/admin-postgres.mjs'
import {monthlyReport} from '../server/monthly-report.mjs'

test.beforeEach(()=>test.skip(!process.env.DATABASE_TEST_ADMIN_URL,'Local PostgreSQL required'))
test('monthly cohort includes pending/proposed/ended work; admin and dispatcher download only aggregates',async({page})=>{
 test.setTimeout(60000)
 const f=await startOperationalTestApi()
 try{
  const ended=await f.assigned();await f.command(ended,'CANCEL',{reason:'Synthetic cancellation'})
  const pending=await f.requested('12:00')
  let proposal=await f.requested('13:00');proposal=await f.command(proposal,'APPROVE')
  await f.request(`/bookings/${proposal.id}/schedule`,'dispatcher',f.selection(proposal))
  const data=await monthlyReport(f.pool,{role:'admin'},'2030-01',f.control.now)
  expect(data.summary).toMatchObject({requests:3,approvedActivity:2,other_cancelled:1,requested:1,scheduled:1,completionRate:'N/A'})
  expect(data.villages).toHaveLength(12)
  expect(data.groups.filter((r:{dimension:string})=>r.dimension==='vehicle').map((r:{requests:number})=>r.requests).sort()).toEqual([1,2])
  const serialized=JSON.stringify(data)
  for(const value of [pending.reference,pending.patientName,'0800000000','จุดรับสังเคราะห์','18.59','99.05'])expect(serialized).not.toContain(value)
  await f.request('/reports/monthly','citizen',{month:'2030-01'},403)
  await f.request('/reports/monthly','driver',{month:'2030-01'},403)
  await f.request('/reports/monthly','admin',{month:'2030-13'},400)
  await f.request('/reports/monthly','admin',{month:'2030-01',date:'2030-01-15'},400)
  expect((await fetch(`${f.base}/api/reports/monthly`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(401)
  await page.route('**/api/**',async route=>{const u=new URL(route.request().url());await route.fulfill({response:await route.fetch({url:`${f.base}${u.pathname}${u.search}`})})})
  await page.goto('/staff/login?next=%2Fadmin%2Fhistory')
  await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill('synthetic-admin');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(syntheticPassword)
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click()
  await page.getByRole('link',{name:'เปิดหน้าผู้ดูแลระบบ',exact:true}).click()
  await page.getByText('ส่งออกรายงานสรุปรายเดือน',{exact:true}).click()
  await page.getByLabel('เดือนนัดหมายสำหรับรายงาน').fill('2030-01')
  // A real failed export must retain the month and permit a later real download.
  const body=page.getByRole('button',{name:'ดาวน์โหลดรายงานรายเดือน (.xlsx)',exact:true})
  await f.pool.query(`CREATE FUNCTION patient_transfer.reject_monthly_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='EXPORT_MONTHLY_REPORT' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER reject_monthly_test BEFORE INSERT ON patient_transfer.audit_logs FOR EACH ROW EXECUTE FUNCTION patient_transfer.reject_monthly_test()`)
  await body.click();await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('เดือนนัดหมายสำหรับรายงาน')).toHaveValue('2030-01')
  expect((await f.pool.query("SELECT * FROM patient_transfer.audit_logs WHERE action='EXPORT_MONTHLY_REPORT'")).rowCount).toBe(0)
  await f.pool.query('DROP TRIGGER reject_monthly_test ON patient_transfer.audit_logs; DROP FUNCTION patient_transfer.reject_monthly_test()')
  const event=page.waitForEvent('download');await body.click();const download=await event
  expect(download.suggestedFilename()).toBe('service-2030-01.xlsx')
  const stream=await download.createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk))
  const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.concat(chunks))
  expect(book.worksheets.map(s=>s.name)).toEqual(['สรุปบริการ','สรุปตามหมู่บ้าน','โรงพยาบาลและกองรถ'])
  expect(book.getWorksheet('สรุปตามหมู่บ้าน')!.rowCount).toBe(25)
  const all=JSON.stringify(book.worksheets.map(s=>s.getSheetValues()))
  for(const value of [pending.patientName,pending.reference,pending.contactPhone,pending.pickupAddress])expect(all).not.toContain(value)
  const login=await fetch(`${f.base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'synthetic-dispatcher',password:syntheticPassword})}),token=(await login.json()).token
  const result=await fetch(`${f.base}/api/reports/monthly`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({month:'2030-01'})})
  expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toBe('no-store')
  const logs=(await f.pool.query("SELECT * FROM patient_transfer.audit_logs WHERE action='EXPORT_MONTHLY_REPORT'")).rows
  expect(logs).toHaveLength(2);expect(new Set(logs.map(r=>r.actor_id)).size).toBe(2)
  for(const log of logs){expect(log.after_data.rowCount).toBe(3);expect(log.after_data.month).toBe('2030-01');expect(JSON.stringify(log)).not.toContain(pending.reference)}
  await f.pool.query("UPDATE patient_transfer.users SET active=false WHERE role='dispatcher'")
  await f.request('/reports/monthly','dispatcher',{month:'2030-01'},401)
 }finally{await f.close()}
})

test('monthly Bangkok boundaries, leap February, year rollover and snapshot stability',async()=>{
 const f=await startOperationalTestApi()
 try{
  const booking=await f.requested(),user={role:'dispatcher'}
  for(const [at,count] of [['2030-01-31T16:59:59.999Z',0],['2030-01-31T17:00:00.000Z',1],['2030-02-28T16:59:59.999Z',1],['2030-02-28T17:00:00.000Z',0]] as const){
   await f.pool.query('UPDATE patient_transfer.bookings SET appointment_at=$1 WHERE id=$2',[at,booking.id])
   expect((await monthlyReport(f.pool,user,'2030-02',f.control.now)).summary.requests).toBe(count)
  }
  await f.pool.query("UPDATE patient_transfer.bookings SET appointment_at='2032-02-29T12:00:00+07:00' WHERE id=$1",[booking.id])
  const captured=await monthlyReport(f.pool,user,'2032-02',f.control.now)
  expect(captured.summary.requests).toBe(1);expect(captured.periodEnd).toBe('2032-03-01T00:00:00+07:00')
  await f.pool.query("UPDATE patient_transfer.bookings SET appointment_at='2032-03-01T00:00:00+07:00' WHERE id=$1",[booking.id])
  expect(captured.summary.requests).toBe(1)
  expect((await monthlyReport(f.pool,user,'2032-02',f.control.now)).summary.requests).toBe(0)
  expect((await monthlyReport(f.pool,user,'2032-12',f.control.now)).periodEnd).toBe('2033-01-01T00:00:00+07:00')
 }finally{await f.close()}
})

test('real completed, aborted and failed-pickup journeys reach distinct monthly outcomes and rate denominators',async()=>{
 test.setTimeout(60000)
 for(const outcome of ['completed','aborted','failed_pickup']){
  const f=await startOperationalTestApi()
  try{
   let booking=await f.assigned();const planned=booking.schedule!
   f.control.now=planned.departureAt
   await f.login('dispatcher');await f.login('driver')
   booking=await f.command(booking,'START_TRIP',{},'driver')
   booking=await f.command(booking,'DEPART_ORIGIN',{},'driver')
   f.control.now=planned.pickupAt
   if(outcome==='failed_pickup')booking=await f.command(booking,'FAILED_PICKUP',{reason:'Synthetic absent requester'},'driver')
   else{
    booking=await f.command(booking,'CONFIRM_PICKUP',{},'driver')
    booking=await f.command(booking,'DEPART_FOR_HOSPITAL',{},'driver')
    if(outcome==='completed'){
     f.control.now=planned.arrivalAt;booking=await f.command(booking,'CONFIRM_HANDOVER',{},'driver')
    }else booking=await f.command(booking,'ABORT',{reason:'Actual end without handover',endedAt:f.control.now,location:'Synthetic safe location',disposition:'Authorized synthetic caregiver handoff'})
   }
   const report=await monthlyReport(f.pool,{role:'admin'},'2030-01',f.control.now)
   expect(report.summary.requests).toBe(1);expect(report.summary[outcome]).toBe(1);expect(report.summary.approvedActivity).toBe(1)
   expect(report.summary.completionRate).toBe(outcome==='completed'?'100.0':'0.0')
   expect(report.summary.cancelledCombined).toBe(outcome==='failed_pickup'?1:0)
   expect(report.groups.find((g:{dimension:string})=>g.dimension==='vehicle')?.requests).toBe(1)
  }finally{await f.close()}
 }
})
