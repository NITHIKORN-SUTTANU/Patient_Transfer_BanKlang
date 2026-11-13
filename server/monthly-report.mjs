import {randomUUID} from 'node:crypto'
import ExcelJS from 'exceljs'
import {check,fields} from './errors.mjs'

export function monthlyRequest(body) {
 fields(body,['month'],['month'])
 check(typeof body.month==='string'&&/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(body.month)&&Number(body.month.slice(0,4))>=1&&Number(body.month.slice(0,4))<9999,400,'Valid report month required')
 return body
}
export const outcomes=['completed','aborted','failed_pickup','other_cancelled','rejected','requested','approved','scheduled','assigned','picking_up','picked_up','in_transit']
const empty=()=>({requests:0,approvedActivity:0,...Object.fromEntries(outcomes.map(key=>[key,0]))})
function add(t,row){check(outcomes.includes(row.outcome),500,'Unknown report state');t.requests++;t.approvedActivity+=Number(row.approved);t[row.outcome]++}
function finish(t){return {...t,cancelledCombined:t.failed_pickup+t.other_cancelled,completionRate:t.completed+t.aborted+t.failed_pickup===0?'N/A':(100*t.completed/(t.completed+t.aborted+t.failed_pickup)).toFixed(1)}}

export async function monthlyReport(client,user,month,asOf) {
 check(['admin','dispatcher'].includes(user.role),403,'Monthly aggregate authority required')
 monthlyRequest({month})
 // One MVCC statement captures the full cohort and village catalog together.
 // No patient, contact, pickup, booking-reference or unrestricted note fields.
 const {rows:[data]}=await client.query(`WITH cohort AS (
  SELECT b.village_id,b.mobility,
   CASE WHEN b.status='CANCELLED' THEN CASE WHEN EXISTS(SELECT 1 FROM patient_transfer.trip_events e WHERE e.booking_id=b.id AND e.command='FAILED_PICKUP' AND e.recorded_at<=$2) THEN 'failed_pickup' ELSE 'other_cancelled' END ELSE lower(b.status::text) END AS outcome,
   EXISTS(SELECT 1 FROM patient_transfer.trip_events e WHERE e.booking_id=b.id AND e.command='APPROVE' AND e.recorded_at<=$2) AS approved,
   coalesce(leg.hospital_id,b.hospital_id) AS hospital_id,coalesce(leg.hospital_name,b.hospital_name_snapshot,'ไม่ทราบชื่อที่บันทึก') AS hospital_name,
   s.vehicle_id,s.driver_id,s.vehicle_name_snapshot,s.vehicle_plate_snapshot,s.driver_name_snapshot
  FROM patient_transfer.bookings b
  LEFT JOIN LATERAL (SELECT vehicle_id,driver_id,vehicle_name_snapshot,vehicle_plate_snapshot,driver_name_snapshot FROM patient_transfer.schedules WHERE booking_id=b.id AND committed ORDER BY routed_at DESC,created_at DESC,id DESC LIMIT 1) s ON true
  LEFT JOIN LATERAL (SELECT hospital_id,hospital_name FROM patient_transfer.trip_route_legs WHERE booking_id=b.id ORDER BY version DESC LIMIT 1) leg ON true
  WHERE b.appointment_at>=($1::date::timestamp AT TIME ZONE 'Asia/Bangkok')
   AND b.appointment_at<(($1::date::timestamp+interval '1 month') AT TIME ZONE 'Asia/Bangkok')
   AND b.submitted_at<=$2
 ) SELECT coalesce((SELECT json_agg(c) FROM cohort c),'[]'::json) AS cohort,
  (SELECT json_agg(json_build_object('id',id,'number',village_number,'name',name) ORDER BY village_number) FROM patient_transfer.service_villages) AS villages`,[`${month}-01`,asOf])
 const total=empty(),villages=new Map(data.villages.map(v=>[v.id,{key:v.id,label:`หมู่ ${v.number} ${v.name} (ชื่อปัจจุบัน)`,...empty()}])),groups=new Map()
 for(const row of data.cohort){
  add(total,row)
  if(!villages.has(row.village_id))villages.set(row.village_id,{key:row.village_id,label:'ไม่ทราบหมู่บ้าน',...empty()})
  add(villages.get(row.village_id),row)
  for(const [dimension,key,label] of [
   ['hospital',row.hospital_id,row.hospital_name],
   ['vehicle',row.vehicle_id,row.vehicle_id?`${row.vehicle_name_snapshot??'ไม่ทราบชื่อเดิม'} / ${row.vehicle_plate_snapshot??'ไม่ทราบทะเบียนเดิม'}`:'ไม่ได้มอบหมาย/ไม่เกี่ยวข้อง'],
   ['driver',row.driver_id,row.driver_id?(row.driver_name_snapshot??'ไม่ทราบชื่อเดิม'):'ไม่ได้มอบหมาย/ไม่เกี่ยวข้อง'],
   ['mobility',row.mobility,row.mobility],['outcome',row.outcome,row.outcome]]){
   const groupKey=JSON.stringify([dimension,key])
   if(!groups.has(groupKey))groups.set(groupKey,{dimension,key:key??'unassigned',labels:new Set(),...empty()})
   const group=groups.get(groupKey);group.labels.add(label);add(group,row)
  }
 }
 const [year,m]=month.split('-').map(Number),next=m===12?`${String(year+1).padStart(4,'0')}-01`:`${String(year).padStart(4,'0')}-${String(m+1).padStart(2,'0')}`
 return {id:randomUUID(),month,asOf,timezone:'Asia/Bangkok',periodStart:`${month}-01T00:00:00+07:00`,periodEnd:`${next}-01T00:00:00+07:00`,
  cohort:'All submitted requests by Bangkok appointment month; current outcomes at capture',
  attribution:'One latest committed assignment (including released history) per booking; latest recorded destination; uncommitted proposals are unassigned. Each dimension is a separate partition, never add dimensions together.',
  summary:finish(total),villages:[...villages.values()].map(finish),groups:[...groups.values()].map(({labels,...g})=>finish({...g,label:[...labels].sort().join(' | ')})).sort((a,b)=>a.dimension.localeCompare(b.dimension)||a.key.localeCompare(b.key))}
}
export async function auditMonthlyReport(client,user,report,now) {
 await client.query(`INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,reason,recorded_at,after_data)
  VALUES($1,'EXPORT_MONTHLY_REPORT','report_export',$2,$3,$4,$5)`,[user.id,report.id,`Monthly xlsx report ${report.month}`,now,
  {kind:'monthly_aggregate',format:'xlsx',month:report.month,timezone:report.timezone,periodStart:report.periodStart,periodEnd:report.periodEnd,asOf:report.asOf,cohort:report.cohort,attribution:report.attribution,rowCount:report.summary.requests}])
}
const metrics=[['requests','คำขอทั้งหมด'],['approvedActivity','เคยอนุมัติ (กิจกรรมแยก ไม่บวกกับผลลัพธ์)'],...outcomes.map(key=>[key,key]),['cancelledCombined','ยกเลิกรวม (failed_pickup + other_cancelled; ไม่บวกซ้ำ)'],['completionRate','อัตราสำเร็จ (%)']]
export async function monthlyFile(report) {
 const workbook=new ExcelJS.Workbook();workbook.creator='Municipal transport service';workbook.created=new Date(report.generatedAt??report.asOf)
 function sheet(name,dimensions,rows){
  const s=workbook.addWorksheet(name,{pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}})
  for(const row of [['รายงานสรุปรายเดือน',report.month],['รหัสรายงาน',report.id],['เขตเวลา',report.timezone],['เริ่มช่วง (รวม)',report.periodStart],['สิ้นช่วง (ไม่รวม)',report.periodEnd],['ข้อมูล ณ',report.asOf],['สร้างเมื่อ',report.generatedAt??report.asOf],['ประชากร/ตัวกรอง',report.cohort],['การจัดกลุ่ม',report.attribution],['สูตรอัตราสำเร็จ','completed / (completed + aborted + failed_pickup) × 100; ทศนิยม 1 ตำแหน่ง; ตัวหาร 0 = N/A'],['หมายเหตุ','approvedActivity และ cancelledCombined ไม่ใช่ผลลัพธ์ที่นำมาบวกเพิ่ม; ชื่อกลุ่มเป็นข้อมูลที่บันทึก เว้นแต่ระบุชื่อปัจจุบัน']])s.addRow(row)
  s.addRow([]);const header=s.addRow([...dimensions.map(d=>d[1]),...metrics.map(m=>m[1])]);header.font={bold:true}
  for(const row of rows)s.addRow([...dimensions.map(([key])=>String(row[key]??'')),...metrics.map(([key])=>row[key])])
  s.columns.forEach((c,i)=>{c.width=i<dimensions.length?34:24})
  s.eachRow(row=>{row.alignment={wrapText:true,vertical:'top'}})
  // Long metadata is readable without affecting numeric table columns.
  for(let n=1;n<header.number-1;n++){s.mergeCells(n,2,n,dimensions.length+metrics.length);s.getRow(n).height=n>=8?45:28}
  s.autoFilter={from:{row:header.number,column:1},to:{row:s.rowCount,column:dimensions.length+metrics.length}}
  s.views=[{state:'frozen',ySplit:header.number}]
  return s
 }
 sheet('สรุปบริการ',[],[report.summary])
 sheet('สรุปตามหมู่บ้าน',[['key','รหัสหมู่บ้าน'],['label','หมู่บ้าน']],report.villages)
 sheet('โรงพยาบาลและกองรถ',[['dimension','มิติ (แต่ละมิติรวมแยกกัน)'],['key','รหัสกลุ่ม'],['label','ชื่อกลุ่ม']],report.groups)
 return {buffer:Buffer.from(await workbook.xlsx.writeBuffer()),contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename:`service-${report.month}.xlsx`}
}
