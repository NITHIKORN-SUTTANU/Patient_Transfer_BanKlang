import {useEffect,useRef,useState} from 'react'
import {staffRequest} from '../services/staffSession'
import {dispatcherError} from '../services/dispatcherApi'
import {dispatchDate,dispatchTime} from '../services/dispatch'
import {BookingButton} from './BookingUI'
import {Link} from 'react-router'

interface Failure {
  id:string;revision:number;failureCode:string;attempts:number;lastAttemptAt:string|null;nextAttemptAt:string|null;terminal:boolean;
  reviewerName:string|null;reviewerActive:boolean;isMine:boolean;reviewedAt:string|null;reviewNote:string|null;
  bookingId?:string;reference?:string;eventId?:string;recipientId?:string;recipientRole?:string;
}
interface Queue {failures:Failure[];total:number;pending:number;nextCursor:string|null;service?:{configured:boolean;deliveryEnabled:boolean;linksConfigured?:boolean}}
function explanation(code:string) {
  if(code==='NO_VERIFIED_LINE_ACCOUNT') return 'ผู้รับยังไม่มีบัญชี LINE ที่ยืนยันแล้ว — ตรวจสอบช่องทางติดต่ออื่น'
  if(code==='ACCOUNT_INACTIVE') return 'บัญชีผู้รับไม่เปิดใช้งาน — ตรวจสอบสิทธิ์และช่องทางติดต่อ'
  if(['RECIPIENT_CHANGED','RECIPIENT_ACCESS_CHANGED'].includes(code)) return 'บัญชีหรือสิทธิ์งานของผู้รับเปลี่ยนแล้ว — ตรวจสอบผู้รับและช่องทางติดต่อโดยไม่ส่งข้อมูลเดิมซ้ำ'
  if(code==='MESSAGE_LINK_UNCONFIGURED') return 'ยังไม่ได้ตั้งค่าลิงก์ HTTPS ที่อนุมัติ — ให้ผู้รับผิดชอบระบบตรวจสอบ'
  if(['LINE_HTTP_401','LINE_HTTP_403'].includes(code)) return 'การตั้งค่าหรือสิทธิ์ส่ง LINE มีปัญหา — ให้ผู้รับผิดชอบระบบตรวจสอบ'
  if(['RETRY_KEY_EXPIRED','RETRY_HISTORY_UNKNOWN','MESSAGE_PAYLOAD_UNAVAILABLE','RETRY_PAYLOAD_UNKNOWN','LINE_DELIVERY_UNCERTAIN'].includes(code)) return 'ต้องตรวจสอบผลการส่งเดิมก่อนดำเนินการต่อ เพื่อป้องกันข้อความซ้ำ'
  if(code==='LINE_HTTP_429') return 'ผู้ให้บริการจำกัดคำขอส่งข้อความ'
  if(code==='LINE_NETWORK'||code.startsWith('LINE_HTTP_5')) return 'เชื่อมต่อผู้ให้บริการไม่สำเร็จ'
  return 'ส่งข้อความไม่สำเร็จ — ตรวจสอบผู้รับและการตั้งค่ากับผู้รับผิดชอบระบบ'
}
export function NotificationFailures({admin=false}:{admin?:boolean}) {
  const [queue,setQueue]=useState<Queue|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[version,setVersion]=useState(0),[cursor,setCursor]=useState<string|null>(null)
  const path=admin?'/admin/notification-failures':'/notification-failures'
  useEffect(()=>{
    let active=true
    staffRequest<Queue>(`${path}${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`).then(data=>{if(active)setQueue(data)}).catch(error=>{if(active){setQueue(null);setError(dispatcherError(error))}}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[path,cursor,version])
  function reload(){setError('');setLoading(true);setVersion(value=>value+1)}
  return <details className={admin?'admin-panel':'dispatch-panel'}><summary>{admin?'ปัญหาการส่งข้อความ — ผู้รับผิดชอบระบบ':'ข้อความที่ส่งไม่สำเร็จ'}{queue?` · รอตรวจสอบ ${queue.pending} รายการ`:''}{queue?.service&&!queue.service.configured?' · ยังไม่ได้ตั้งค่า LINE':''}</summary>
    <p>{admin?'แสดงเฉพาะปัญหาการเชื่อมต่อและการตั้งค่า ไม่มีข้อมูลผู้ป่วยหรือรายการจอง':'เจ้าหน้าที่จัดรถต้องรับตรวจสอบรายการที่หยุดลองใหม่ บันทึกผลและขั้นตอนถัดไป เช่น ติดต่อผู้ขอผ่านช่องทางที่ได้รับอนุญาต'}</p>
    <p>การบันทึกผลตรวจสอบไม่ใช่การยืนยันว่าผู้รับอ่านข้อความ และไม่ส่งข้อความซ้ำหรือเปลี่ยนสถานะงาน</p>
    <BookingButton secondary disabled={loading} onClick={reload}>โหลดรายการส่งข้อความล่าสุด</BookingButton>
    {loading&&<p role="status">กำลังโหลดรายการส่งข้อความ…</p>}{error&&<p role="alert">{error}</p>}
    {queue?.service&&<p>{queue.service.configured?'ตั้งค่าการส่ง LINE แล้ว':'ยังไม่ได้ตั้งค่าการส่ง LINE'} · {queue.service.deliveryEnabled?'อนุญาตให้ worker ส่งข้อความ':'ยังไม่อนุญาตให้ส่งข้อความจริง'}</p>}
    {queue?.service?.linksConfigured===false&&<p>ยังไม่ได้ตั้งค่าลิงก์ HTTPS ของระบบที่อนุมัติแล้ว</p>}
    {queue&&!loading&&<><p>แสดง {queue.failures.length} จาก {queue.total} รายการส่งไม่สำเร็จ</p>{queue.failures.map(row=><FailureReview key={`${row.id}:${row.revision}`} row={row} path={path} onSaved={reload} />)}
      {cursor&&<BookingButton secondary onClick={()=>{setCursor(null);setLoading(true)}}>กลับรายการล่าสุด</BookingButton>}
      {queue.nextCursor&&<BookingButton secondary onClick={()=>{setCursor(queue.nextCursor);setLoading(true)}}>ดูรายการเก่ากว่า</BookingButton>}
    </>}
  </details>
}
function FailureReview({row,path,onSaved}:{row:Failure;path:string;onSaved:()=>void}) {
  const [note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),pending=useRef(false)
  async function send(action:'claim'|'review') {
    if(pending.current)return
    pending.current=true;setBusy(true);setError('')
    try {await staffRequest(`${path}/${row.id}`,{action,expectedRevision:row.revision,...(action==='review'?{note:note.trim()}:{})});onSaved()}
    catch(error){setError(dispatcherError(error))}
    finally{pending.current=false;setBusy(false)}
  }
  return <section className="dispatch-detail-section"><h3>{row.reference??'รายการแจ้งเตือนระบบ'}</h3><p>{explanation(row.failureCode)}</p><p>พยายามส่ง {row.attempts} ครั้ง{row.lastAttemptAt?` · ล่าสุด ${dispatchDate(row.lastAttemptAt)} ${dispatchTime(row.lastAttemptAt)} น.`:''}</p>
    {row.bookingId&&<Link to={`/dispatcher/tracking?booking=${encodeURIComponent(row.bookingId)}&dialog=tracking`}>เปิดรายละเอียดงานที่ได้รับอนุญาต</Link>}
    {row.nextAttemptAt?<p>รอลองใหม่ {dispatchDate(row.nextAttemptAt)} {dispatchTime(row.nextAttemptAt)} น.</p>:<p>หยุดลองใหม่อัตโนมัติ — ต้องตรวจสอบผลและช่องทางติดต่อ</p>}
    {row.eventId!==undefined&&<details><summary>ข้อมูลอ้างอิงสำหรับตรวจสอบ</summary><p>เหตุการณ์ {row.eventId??'ไม่มีรหัสเหตุการณ์เดิม'} · ผู้รับ ({row.recipientRole}) {row.recipientId}</p></details>}
    {row.reviewerName&&<p>ผู้รับตรวจสอบ {row.reviewerName}{row.reviewerActive?'':' (สิทธิ์เดิมไม่ใช้งานแล้ว)'}</p>}
    {row.reviewedAt?<p>บันทึกผลตรวจสอบแล้ว · {row.reviewNote}</p>:row.terminal&&<fieldset disabled={busy}>
      {row.isMine?<><label className="booking-field">ผลตรวจสอบและขั้นตอนถัดไป<textarea maxLength={1000} required value={note} onChange={event=>setNote(event.target.value)} /></label><BookingButton disabled={!note.trim()} onClick={()=>void send('review')}>บันทึกผลตรวจสอบ</BookingButton></>:<BookingButton disabled={!!row.reviewerName&&row.reviewerActive} onClick={()=>void send('claim')}>รับตรวจสอบรายการนี้</BookingButton>}
    </fieldset>}{error&&<p role="alert">{error}</p>}
  </section>
}
