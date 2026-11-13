const names={
 REQUEST_RECEIVED:'รับคำขอแล้ว (REQUESTED) รอเจ้าหน้าที่พิจารณา',
 ASSIGNED:'มอบหมายรถและคนขับแล้ว (ASSIGNED)',
 ASSIGNMENT_CHANGED:'มีการเปลี่ยนตารางหรือการมอบหมาย',
 SCHEDULE_CONFIRMED:'ยืนยันตารางเสนอแล้ว (SCHEDULED) ยังไม่มอบหมายรถหรือคนขับ',
 DESTINATION_CHANGED:'ปรับโรงพยาบาลปลายทางระหว่างเดินทางแล้ว',
 TRIP_APPROVE:'อนุมัติคำขอแล้ว รอจัดตารางและมอบหมาย',
 TRIP_REJECT:'ไม่อนุมัติคำขอ (REJECTED) เปิดดูเหตุผลในระบบ',
 TRIP_CANCEL:'ยกเลิกคำขอแล้ว (CANCELLED) เปิดดูรายละเอียดในระบบ',
 TRIP_FAILED_PICKUP:'รับผู้ป่วยไม่สำเร็จ ยกเลิกการรับ (CANCELLED) รถและคนขับยังต้องยืนยันความพร้อม',
 TRIP_REPORT_INCIDENT:'มีเหตุขัดข้อง กรุณาตรวจสอบและติดต่อเทศบาล สถานะระงับความพร้อมยังมีผล',
 TRIP_RESOLVE_INCIDENT:'ยืนยันคลี่คลายเหตุขัดข้องแล้ว กรุณาตรวจสถานะและขั้นตอนเดินทางล่าสุด',
 TRIP_CONFIRM_HANDOVER:'ส่งถึงโรงพยาบาลแล้ว (COMPLETED) ยังต้องเตรียมพร้อมและยืนยันก่อนรับงานต่อ',
 TRIP_ABORT:'ยุติการเดินทางโดยไม่ส่งถึงโรงพยาบาล (ABORTED) ติดต่อเทศบาลเพื่อทราบการจัดการต่อ ทรัพยากรยังรอยืนยันความพร้อม',
 TRIP_START_TRIP:'คนขับเริ่มงานแล้ว ยังไม่ออกจากต้นทาง',TRIP_UNDO_START:'แก้ไขการเริ่มงานแล้ว กรุณาตรวจสถานะล่าสุด',
 TRIP_DEPART_ORIGIN:'ออกจากต้นทางไปรับผู้ป่วยแล้ว',TRIP_CONFIRM_PICKUP:'รับผู้ป่วยขึ้นรถแล้ว (PICKED_UP)',
 TRIP_DEPART_FOR_HOSPITAL:'กำลังเดินทางไปโรงพยาบาล (IN_TRANSIT)',TRIP_CONFIRM_READY:'ยืนยันความพร้อมทรัพยากรหลังจบงานแล้ว',
 TRIP_CORRECT_MILESTONE:'แก้ไขสถานะที่บันทึกคลาดเคลื่อนแล้ว กรุณาตรวจสถานะล่าสุด',
}
const terminal=['COMPLETED','CANCELLED','REJECTED','ABORTED']
const stamp=value=>value instanceof Date?value.toISOString():value??null
export function messageSnapshot(row,event,audience,now,meaning='changed') {
 if(!Object.hasOwn(names,event)) throw new Error('Supported notification event required')
 const schedule=row.proposed_schedule&&row.status==='SCHEDULED'?row.proposed_schedule:null
 let path=audience==='citizen'?`/booking/status/${row.id}`:audience==='dispatcher'
  ?`/dispatcher${row.status==='REQUESTED'?'':'/tracking'}?booking=${row.id}&dialog=${row.status==='REQUESTED'?'details':'tracking'}`
  :meaning==='removed'?'/driver':terminal.includes(row.status)?'/driver/history':`/driver/details?booking=${row.id}`
 if(audience==='driver') path=`/staff/login?next=${encodeURIComponent(path)}`
 const timing=['ASSIGNED','ASSIGNMENT_CHANGED','SCHEDULE_CONFIRMED','DESTINATION_CHANGED'].includes(event)&&meaning!=='removed'
 const ready=event==='TRIP_CONFIRM_HANDOVER'?new Date(Math.max(Date.parse(row.ready_at??now),Date.parse(now)+30*60000)).toISOString():null
 return {version:1,event,audience,reference:row.reference,status:row.status,meaning,recordedAt:now,linkPath:path,
  pickupAt:timing?stamp(schedule?.pickupAt??row.pickup_at):null,
  arrivalAt:timing?stamp(schedule?.arrivalAt??row.arrival_at):null,
  readyAt:ready??(timing?stamp(schedule?.readyAt??row.ready_at):null)}
}
export function eventDescription(data) {
 if(data.event==='ASSIGNMENT_CHANGED'&&data.audience==='driver') {
  if(data.meaning==='removed') return 'ยกเลิกการมอบหมายงานนี้จากคุณแล้ว (REMOVED) ไม่สามารถเปิดรายละเอียดงานเดิมได้ กรุณาตรวจรายการงานปัจจุบัน'
  if(data.meaning==='assigned') return 'คุณได้รับมอบหมายงานแทนทีมเดิมแล้ว (ASSIGNED) กรุณาตรวจงานและยืนยันก่อนเริ่ม'
 }
 return names[data.event]??'มีการอัปเดตคำขอรับส่ง กรุณาตรวจสอบสถานะล่าสุด'
}
export function approvedAppOrigin(value) {
 try {
  const url=new URL(value)
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'?url.origin:null
 } catch {return null}
}
const localTime=value=>new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'short'}).format(new Date(value))
export function renderNotification(data,publicAppUrl) {
 const origin=approvedAppOrigin(publicAppUrl)
 if(!origin) return null
 // These paths originate from trusted server snapshots, never notification text,
 // user-provided callbacks, tokens or arbitrary redirect URLs.
 if(!/^\/(?:booking\/status\/|staff\/login\?next=)/.test(data.linkPath??'')) return null
 const lines=[`คำขอรับส่ง ${data.reference}`,eventDescription(data),`สถานะงานเมื่อบันทึก: ${data.status}`]
 if(data.pickupAt) lines.push(`${data.event==='SCHEDULE_CONFIRMED'?'เวลารับตามตารางเสนอ':'เวลารับที่ยืนยัน'} ${localTime(data.pickupAt)} น.`)
 if(data.arrivalAt) lines.push(`คาดถึงโรงพยาบาล ${localTime(data.arrivalAt)} น.`)
 if(data.readyAt) lines.push(`เตรียมพร้อมอย่างน้อยถึง ${localTime(data.readyAt)} น. และต้องยืนยันความพร้อมแยกต่างหาก`)
 lines.push(`ข้อมูลเหตุการณ์ ${localTime(data.recordedAt)} น. เปิดดูข้อมูลล่าสุดในระบบ`,new URL(data.linkPath,origin).href)
 return lines.join('\n')
}
