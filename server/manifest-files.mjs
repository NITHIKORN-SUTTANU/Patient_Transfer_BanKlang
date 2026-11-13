import ExcelJS from 'exceljs'
import {PDFDocument} from 'pdfkit'
import {openSync} from 'fontkit'
import {createRequire} from 'node:module'

const require=createRequire(import.meta.url)
const local=value=>value?new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(value)):'—'
const mobility={standard:'เดินได้',wheelchair:'รถเข็น',stretcher:'เปลนอน'}
const assist={boarding_support:'ผู้ช่วยพยุงขึ้น-ลงรถ',caregiver_accompanies:'ผู้ดูแลเดินทางด้วย'}
const value=input=>input===null||input===undefined?'':String(input)
const cohortThai='วันนัดหมายตามเวลาไทย; เฉพาะงานที่มีประวัติมอบหมายที่ยืนยันแล้ว รวมงานที่จบ/ยกเลิก/ยุติแล้ว'
const verificationText=entry=>entry.verification.map(v=>`${v.outcome} | ${local(v.at)} | ${v.actorId} | ${v.note}${v.correctsId?' | แก้ไขรายการ '+v.correctsId+' (เก็บประวัติเดิม)':''}`).join('\n')
const exceptionText=entry=>entry.events.filter(e=>e.reason).map(e=>`${e.type} | ${local(e.at)} | ${e.reason}`).join('\n')
const historyText=entry=>entry.assignments.map(a=>`${a.scheduleId} | ${a.vehicleId} | ${a.vehicleName} ${a.vehiclePlate} | ${a.driverId} | ${a.driverName} | ${a.originLocationId} ${a.originName} | ${local(a.departureAt)} → ${local(a.pickupAt)} → ${local(a.arrivalAt)} | ${a.releasedAt?'สิ้นผล '+local(a.releasedAt):'ยังมีผล'}${a.changeReason?' | '+a.changeReason:''}`).join('\n')
const columns=[
 ['reference','หมายเลขคำขอ',42],['appointmentDate','วันนัดหมาย (เวลาไทย)',23],['status','สถานะ',19],['outcome','ประเภทผลลัพธ์',19],
 ['patientName','ผู้รับบริการ',26],['requesterName','ผู้ขอ',26],['contactPhone','เบอร์ติดต่อ',18],['pickupAddress','ที่อยู่จุดรับ',45],
 ['villageNumber','หมู่ที่',10],['villageName','ชื่อหมู่บ้านปัจจุบัน',27],['latitude','ละติจูดจุดรับ',19],['longitude','ลองจิจูดจุดรับ',19],['landmark','จุดสังเกต',32],
 ['hospitalName','ปลายทางปัจจุบัน/ที่บันทึก',33],['appointmentAt','เวลานัดเดิม',25],['departureAt','ออกจากต้นทางตามตาราง',25],['pickupAt','รับตามตาราง',25],['originalArrivalAt','ถึงตามตารางเดิม',25],
 ['estimatedArrivalAt','ประมาณถึงที่ปรับล่าสุด',25],['estimatedReadyAt','พร้อมตามประมาณล่าสุด',25],['originName','ต้นทางที่ยืนยัน',34],['originKind','ประเภทต้นทาง',21],
 ['originLocationId','รหัสต้นทาง',40],['originLatitude','ละติจูดต้นทาง',19],['originLongitude','ลองจิจูดต้นทาง',19],['vehicleName','รถ',28],['vehiclePlate','ทะเบียน',22],['vehicleId','รหัสรถ',40],
 ['driverName','คนขับ',28],['driverId','รหัสคนขับในบัญชีรถ',40],['driverUserId','บัญชีคนขับ ณ มอบหมาย (ถ้าทราบ)',42],
 ['mobility','ลักษณะการเดินทาง',22],['assistance','ความช่วยเหลือเพิ่มเติม',30],['actualPickupAt','รับผู้ป่วยจริง',25],['actualHandoverAt','ส่งถึงโรงพยาบาลจริง',25],
 ['verification','การตรวจสอบที่บันทึก',48],['exceptions','เหตุผิดปกติที่อนุญาต',48],['history','ประวัติทีม/ต้นทางที่มอบหมาย',80],['routeHistory','ประวัติปลายทางที่ปรับ',65],
]
function flat(entry) {
 const a=entry.assignment
 return {...entry,appointmentDate:new Date(Date.parse(entry.appointmentAt)+7*3600000).toISOString().slice(0,10),appointmentAt:local(entry.appointmentAt),
  departureAt:local(a.departureAt),pickupAt:local(a.pickupAt),originalArrivalAt:local(a.arrivalAt),estimatedArrivalAt:local(entry.estimatedArrivalAt),estimatedReadyAt:local(entry.estimatedReadyAt),
  originName:a.originName,originKind:a.originKind,originLocationId:a.originLocationId,originLatitude:a.originLatitude,originLongitude:a.originLongitude,
  vehicleName:a.vehicleName,vehiclePlate:a.vehiclePlate,vehicleId:a.vehicleId,driverName:a.driverName,driverId:a.driverId,driverUserId:a.driverUserId??'ไม่ทราบบัญชีเดิม',
  mobility:mobility[entry.mobility]??entry.mobility,assistance:entry.assistance.map(code=>assist[code]??code).join(', '),
  actualPickupAt:local(entry.events.find(e=>e.type==='CONFIRM_PICKUP')?.at),actualHandoverAt:local(entry.events.findLast(e=>e.type==='CONFIRM_HANDOVER')?.at),
  verification:verificationText(entry),exceptions:exceptionText(entry),history:historyText(entry),
  routeHistory:entry.routeLegs.map(r=>`${r.version} | ${r.hospitalName} | คาดถึง ${local(r.arrivalAt)} | พร้อม ${local(r.readyAt)} | ${r.reason}`).join('\n')}
}
export async function manifestXlsx(report) {
 const workbook=new ExcelJS.Workbook()
 workbook.creator='Municipal transport service';workbook.created=new Date(report.generatedAt??report.asOf)
 const metadata=workbook.addWorksheet('ข้อมูลรายงาน')
 const information=[['รายงาน','ใบงานรับส่งรายวัน'],['รหัสรายงาน',report.id],['วันนัดหมาย',report.date],['เขตเวลา',report.timezone],['เริ่มช่วง (รวม)',report.periodStart],['สิ้นช่วง (ไม่รวม)',report.periodEnd],
  ['ข้อมูล ณ',report.asOf],['สร้างเมื่อ',report.generatedAt??report.asOf],['ตัวกรอง/ประชากรรายงาน',cohortThai],['จำนวนงานในใบงาน',report.entries.length],
  ['คำอธิบาย','เป็นงานที่เคยมอบหมายแล้ว ไม่ใช่จำนวนคำขอทั้งหมดในวันนั้น'],['ชื่อประวัติเดิม','ถ้าไม่เคยบันทึกชื่อ ณ มอบหมาย จะแสดงรหัสและระบุชัดว่าป้ายชื่อเป็นชื่อปัจจุบัน'],
  ['ความพร้อม','เวลาโดยประมาณไม่ปล่อยสถานะระงับหรือยกเว้นการยืนยันความพร้อม'],['การใช้ข้อมูล','เฉพาะเจ้าหน้าที่จัดรถที่ได้รับอนุญาต เก็บรักษาตามระเบียบเทศบาล']]
 metadata.columns=[{width:32},{width:110}];information.forEach(row=>metadata.addRow(row))
 metadata.eachRow(row=>{row.alignment={wrapText:true,vertical:'top'};row.height=34})
 const sheet=workbook.addWorksheet('ใบงานรายวัน',{views:[{state:'frozen',ySplit:1}],pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1'}})
 sheet.columns=columns.map(([key,header,width])=>({key,header,width}))
 for(const entry of report.entries) {
  const data=flat(entry)
  // All user-entered values are string cells, never formulas or hyperlinks.
  sheet.addRow(columns.map(([key])=>value(data[key])))
 }
 sheet.getRow(1).font={bold:true};sheet.getRow(1).height=38
 sheet.eachRow(row=>{row.alignment={wrapText:true,vertical:'top'}})
 sheet.autoFilter={from:'A1',to:{row:Math.max(1,sheet.rowCount),column:columns.length}}
 return Buffer.from(await workbook.xlsx.writeBuffer())
}

let fonts
function reportFonts() {
 if(!fonts)fonts=['thai','latin','latin-ext'].map(name=>{
  const path=require.resolve(`@fontsource/noto-sans-thai/files/noto-sans-thai-${name}-400-normal.woff`)
  return {name,path,font:openSync(path)}
 })
 return fonts
}
export async function manifestPdf(report) {
 const doc=new PDFDocument({size:'A4',margin:36,autoFirstPage:false,info:{Title:`Daily dispatch ${report.date}`,Author:'Municipal transport service'}})
 const chunks=[],completed=new Promise((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject)})
 const fontList=reportFonts();fontList.forEach(f=>doc.registerFont(f.name,f.path))
 const segmenter=new Intl.Segmenter('th',{granularity:'grapheme'}),coverage=new Map()
 let page=0,y=0,escaped=false,activeReference=''
 function parts(text) {
  const result=[]
  for(const {segment} of segmenter.segment(value(text))) {
   let font=coverage.get(segment)
   if(!font){font=fontList.find(f=>[...segment].every(c=>f.font.hasGlyphForCodePoint(c.codePointAt(0))))?.name??'unsupported';coverage.set(segment,font)}
   const label=font==='unsupported'?[...segment].map(c=>`[U+${c.codePointAt(0).toString(16).toUpperCase()}]`).join(''):segment
   if(font==='unsupported')escaped=true
   const name=font==='unsupported'?'latin':font
   if(result.at(-1)?.font===name)result.at(-1).text+=label
   else result.push({font:name,text:label})
  }
  return result
 }
 function width(text,size){return parts(text).reduce((sum,run)=>sum+doc.font(run.font).fontSize(size).widthOfString(run.text),0)}
 function paint(text,x,at,size=10,color='#152d2e') {
  for(const run of parts(text)){doc.font(run.font).fontSize(size).fillColor(color).text(run.text,x,at,{lineBreak:false});x+=doc.widthOfString(run.text)}
 }
 function newPage() {
  doc.addPage();page++;y=36
  paint('ใบงานรับส่งรายวัน',36,y,15);y+=25
  paint(`${report.date} | Asia/Bangkok | หน้า ${page}`,36,y,9);y+=17
  paint(`ข้อมูล ณ ${local(report.asOf)} | สร้างเมื่อ ${local(report.generatedAt??report.asOf)}`,36,y,9);y+=17
  paint(`รหัสรายงาน ${report.id}`,36,y,8);y+=17
  paint('วันนัดหมายเวลาไทย เฉพาะงานที่เคยมอบหมายแล้ว รวมงานจบ/ยกเลิก/ยุติ',36,y,9);y+=18
  if(activeReference){paint(activeReference,36,y,9);y+=18}
  doc.moveTo(36,y).lineTo(559,y).strokeColor('#b8c8c8').stroke();y+=12
 }
 function line(text,size=10) {
  if(y+20>790)newPage()
  paint(text,36,y,size);y+=size+7
 }
 function paragraph(text,size=10) {
  for(const source of value(text).split(/\r?\n/)) {
   let current=''
   const displayed=parts(source).map(run=>run.text).join('')
   for(const {segment} of segmenter.segment(displayed)) {
    if(current&&width(current+segment,size)>523){line(current,size);current=''}
    current+=segment
   }
   line(current||'—',size)
  }
 }
 newPage()
 if(!report.entries.length)paragraph('ไม่พบงานที่มีประวัติมอบหมายในวันนัดหมายที่เลือก')
 for(const [index,entry] of report.entries.entries()) {
  activeReference=entry.reference
  if(index)newPage()
  paragraph(`งาน ${index+1}/${report.entries.length} | ${entry.reference}`,12)
  const data=flat(entry)
  for(const [key,label] of columns)paragraph(`${label}: ${value(data[key])||'—'}`)
 }
 if(escaped)paragraph('หมายเหตุ: อักขระที่ฟอนต์ไม่รองรับแสดงเป็น [U+รหัส] โดยไม่แทนชื่อด้วยข้อมูลอื่น ข้อมูลตัวอักษรเต็มอยู่ในไฟล์ Excel',9)
 paragraph('เฉพาะเจ้าหน้าที่จัดรถที่ได้รับอนุญาต เวลาโดยประมาณไม่ยกเว้นการยืนยันความพร้อม',9)
 doc.end()
 return completed
}
export async function manifestFile(report,format) {
 return {buffer:format==='xlsx'?await manifestXlsx(report):await manifestPdf(report),
  contentType:format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/pdf',filename:`dispatch-${report.date}.${format}`}
}
