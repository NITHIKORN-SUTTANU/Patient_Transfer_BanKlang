import {test,expect} from '@playwright/test'
import ExcelJS from 'exceljs'
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {createCanvas} from '@napi-rs/canvas'
import {writeFile} from 'node:fs/promises'
import {startOperationalTestApi} from './helpers/operational-postgres'
import {syntheticPassword} from './helpers/admin-postgres.mjs'
import {dailyManifest,manifestRequest} from '../server/daily-manifest.mjs'
import {manifestXlsx,manifestPdf} from '../server/manifest-files.mjs'

test.beforeEach(()=>test.skip(!process.env.DATABASE_TEST_ADMIN_URL,'Local PostgreSQL required'))

test('daily files preserve committed history, Thai text, string cells, scope and audited downloads',async({page},testInfo)=>{
 test.setTimeout(90000)
 const f=await startOperationalTestApi()
 try {
  const assigned=await f.assigned()
  const pending=await f.requested('12:00')
  const cancelled=await f.command(assigned,'CANCEL',{reason:'ยกเลิกการเดินทางทดสอบ'})
  const captured=await dailyManifest(f.pool,{id:'00000000-0000-4000-8000-000000000002',role:'dispatcher'},'2030-01-15',f.control.now)
  expect(captured.entries.map((r:{id:string})=>r.id)).toEqual([cancelled.id])
  expect(captured.entries[0].outcome).toBe('other_cancelled')
  expect(captured.entries[0].assignment.releasedAt).toBeTruthy()
  expect(captured.entries[0].assignment.driverName).not.toContain('ชื่อปัจจุบัน')
  await f.pool.query("UPDATE patient_transfer.vehicles SET name='ชื่อรถใหม่' WHERE id=$1",[captured.entries[0].assignment.vehicleId])
  const after=await dailyManifest(f.pool,{role:'dispatcher'},'2030-01-15',f.control.now)
  expect(after.entries[0].assignment.vehicleName).toBe(captured.entries[0].assignment.vehicleName)
  expect((await dailyManifest(f.pool,{role:'dispatcher'},'2030-01-14',f.control.now)).entries).toEqual([])
  await expect(f.pool.query('UPDATE patient_transfer.schedules SET driver_name_snapshot=$1 WHERE booking_id=$2',['rewrite',assigned.id])).rejects.toThrow('immutable')
  for(const date of ['2030-02-30','2030-1-15','bad'])expect(()=>manifestRequest({date,format:'xlsx'})).toThrow()
  expect(()=>manifestRequest({date:'2030-01-15',format:'csv'})).toThrow()
  expect(()=>manifestRequest({date:'2030-01-15',format:'xlsx',role:'dispatcher'})).toThrow()
  const token=async(role:string)=>{
   const r=await fetch(`${f.base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:`synthetic-${role}`,password:syntheticPassword})})
   expect(r.status).toBe(200);return (await r.json()).token
  }
  for(const role of ['admin','driver']){
   const r=await fetch(`${f.base}/api/reports/daily`,{method:'POST',headers:{Authorization:`Bearer ${await token(role)}`,'Content-Type':'application/json'},body:JSON.stringify({date:'2030-01-15',format:'xlsx'})})
   expect(r.status).toBe(403)
  }
  await f.request('/reports/daily','citizen',{date:'2030-01-15',format:'xlsx'},403)
  expect((await fetch(`${f.base}/api/reports/daily`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(401)
  expect((await f.pool.query("SELECT * FROM patient_transfer.audit_logs WHERE action='EXPORT_DAILY_MANIFEST'")).rowCount).toBe(0)
  await page.route('**/api/**',async route=>{const url=new URL(route.request().url());await route.fulfill({response:await route.fetch({url:`${f.base}${url.pathname}${url.search}`})})})
  await page.goto('/staff/login?next=%2Fdispatcher%2Ftracking')
  await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill('synthetic-dispatcher')
  await page.getByLabel('รหัสผ่าน',{exact:true}).fill(syntheticPassword)
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click()
  await page.getByRole('link',{name:'เปิดหน้าจัดรถ',exact:true}).click()
  await page.getByText('ส่งออกใบงานรายวัน',{exact:true}).click()
  await page.getByLabel('วันนัดหมายสำหรับส่งออก').fill('2030-01-15')
  const download=page.waitForEvent('download')
  await page.getByRole('button',{name:'ดาวน์โหลด Excel (.xlsx)',exact:true}).click()
  const file=await download
  expect(file.suggestedFilename()).toBe('dispatch-2030-01-15.xlsx')
  const stream=await file.createReadStream(),chunks:Buffer[]=[]
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk))
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.concat(chunks))
  const sheet=workbook.getWorksheet('ใบงานรายวัน')!
  expect(sheet.rowCount).toBe(2)
  expect(sheet.getCell('A2').value).toBe(assigned.reference)
  expect(sheet.getCell('G2').value).toBe('0800000000')
  expect(JSON.stringify(sheet.getRow(2).values)).not.toContain(pending.reference)
  const pdfDownload=page.waitForEvent('download')
  await page.getByRole('button',{name:'ดาวน์โหลด PDF สำหรับพิมพ์',exact:true}).click()
  const pdfFile=await pdfDownload, pdfStream=await pdfFile.createReadStream(),pdfChunks:Buffer[]=[]
  for await(const chunk of pdfStream!)pdfChunks.push(Buffer.from(chunk))
  const loading=getDocument({data:new Uint8Array(Buffer.concat(pdfChunks)),useSystemFonts:false})
  const pdf=await loading.promise
  let text=''
  for(let n=1;n<=pdf.numPages;n++)text+=(await (await pdf.getPage(n)).getTextContent()).items.map(item=>'str'in item?item.str:'').join('')
  expect(text).toContain(assigned.reference)
  expect(text).toContain('ผู้ป่วยทดสอบการตั้งค่า')
  expect(text).toContain('0800000000')
  expect(pdf.numPages).toBeGreaterThan(1)
  const firstPage=await pdf.getPage(1),viewport=firstPage.getViewport({scale:1.5}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height))
  await firstPage.render({canvasContext:canvas.getContext('2d'),viewport}).promise
  await writeFile(testInfo.outputPath('daily-manifest.png'),canvas.toBuffer('image/png'))
  await loading.destroy()
  const logs=(await f.pool.query("SELECT * FROM patient_transfer.audit_logs WHERE action='EXPORT_DAILY_MANIFEST' ORDER BY recorded_at,id")).rows
  expect(logs).toHaveLength(2)
  expect(logs.map(r=>r.after_data.format).sort()).toEqual(['pdf','xlsx'])
  for(const log of logs){expect(log.after_data.rowCount).toBe(1);expect(log.after_data.timezone).toBe('Asia/Bangkok');expect(JSON.stringify(log)).not.toContain('ผู้ป่วยทดสอบ')}
  captured.entries[0].patientName='=HYPERLINK("https://invalid.example")'
  const literal=new ExcelJS.Workbook();await literal.xlsx.load(await manifestXlsx(captured))
  expect(literal.getWorksheet('ใบงานรายวัน')!.getCell('E2').type).toBe(ExcelJS.ValueType.String)
  captured.entries[0].landmark='漢字😀'.repeat(500)
  const longPdf=await manifestPdf(captured)
  expect(longPdf.subarray(0,5).toString()).toBe('%PDF-')
 }finally{await f.close()}
})

test('Bangkok appointment boundaries are half-open; pending/proposals and revoked sessions cannot export',async()=>{
 const f=await startOperationalTestApi()
 try{
  const assigned=await f.assigned()
  await f.command(assigned,'CANCEL',{reason:'Boundary fixture released'})
  let proposal=await f.requested('13:00')
  proposal=await f.command(proposal,'APPROVE')
  await f.request(`/bookings/${proposal.id}/schedule`,'dispatcher',f.selection(proposal))
  const user={role:'dispatcher'}
  for(const [at,count] of [['2030-01-14T16:59:59.999Z',0],['2030-01-14T17:00:00.000Z',1],['2030-01-15T16:59:59.999Z',1],['2030-01-15T17:00:00.000Z',0]] as const){
   // Released historical fixture varies only its appointment date to isolate SQL boundaries.
   await f.pool.query('UPDATE patient_transfer.bookings SET appointment_at=$1 WHERE id=$2',[at,assigned.id])
   const data=await dailyManifest(f.pool,user,'2030-01-15',f.control.now)
   expect(data.entries).toHaveLength(count)
   expect(data.entries.some((row:{id:string})=>row.id===proposal.id)).toBe(false)
  }
  await f.request('/reports/daily','dispatcher',{date:'2030-02-30',format:'pdf'},400)
  await f.pool.query("UPDATE patient_transfer.users SET active=false WHERE role='dispatcher'")
  await f.request('/reports/daily','dispatcher',{date:'2030-01-15',format:'pdf'},401)
  expect((await f.pool.query("SELECT * FROM patient_transfer.audit_logs WHERE action='EXPORT_DAILY_MANIFEST'")).rowCount).toBe(0)
 }finally{await f.close()}
})
