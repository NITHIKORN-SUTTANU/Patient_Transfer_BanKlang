import {useRef,useState} from 'react'
import {Link} from 'react-router'
import {staffRequest} from '../services/staffSession'
import {dispatcherError} from '../services/dispatcherApi'
import {dispatchDate,dispatchTime} from '../services/dispatch'
import {DispatchButton} from './DispatcherUI'

interface Entry {id:string;outcome:string;notes:string;recordedAt:string;actor:string;correctsId:string|null}
interface Review {latestId:string|null;duplicates:{id:string;reference:string;status:string;reasons:string[]}[];history:Entry[];nextCursor:string|null;capacityDecision?:{id:string;recordedAt:string;explanation:string;alternatives:{selection:{vehicleId:string;driverId:string;originLocationId:string};result:string}[]}|null}
const labels:Record<string,string>={confirmed:'ยืนยันข้อมูลแล้ว',correction_needed:'ต้องแก้ไขข้อมูล',unreachable:'ติดต่อไม่ได้',requester_declined:'ผู้ขอไม่ประสงค์ให้ตรวจสอบ'}
export function DispatchReview({bookingId,onBusyChange}:{bookingId:string;onBusyChange:(value:boolean)=>void}){
 const [data,setData]=useState<Review|null>(null),[outcome,setOutcome]=useState('confirmed'),[notes,setNotes]=useState(''),[correcting,setCorrecting]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const pending=useRef(false),event=useRef(crypto.randomUUID())
 async function load(more=false){
  if(pending.current)return
  pending.current=true;setBusy(true);onBusyChange(true);setError('')
  try{const result=await staffRequest<Review>(`/bookings/${bookingId}/review${more&&data?.nextCursor?'?cursor='+encodeURIComponent(data.nextCursor):''}`);setData(previous=>more&&previous?{...result,latestId:previous.latestId,history:[...previous.history,...result.history]}:result);setCorrecting(false)}
  catch(error){setError(dispatcherError(error))}
  finally{pending.current=false;setBusy(false);onBusyChange(false)}
 }
 async function save(){
  if(pending.current||!data)return
  pending.current=true;setBusy(true);onBusyChange(true);setError('');setNotice('')
  try{
   await staffRequest(`/bookings/${bookingId}/verification`,{eventId:event.current,expectedLatestId:data.latestId,outcome,notes,correctsId:correcting?data.latestId:null})
   event.current=crypto.randomUUID();setNotes('');setCorrecting(false);setNotice('บันทึกผลตรวจสอบแล้ว สถานะคำขอไม่เปลี่ยน')
   setData(await staffRequest<Review>(`/bookings/${bookingId}/review`))
  }catch(error){setError(dispatcherError(error))}
  finally{pending.current=false;setBusy(false);onBusyChange(false)}
 }
 return <section className="dispatch-detail-section"><h3>ตรวจสอบคำขอและประวัติการติดต่อ</h3>
  <p>คำเตือนอาจซ้ำและผลติดต่อไม่เปลี่ยนสถานะ ไม่ปฏิเสธ รวม หรือยกเลิกคำขอโดยอัตโนมัติ</p>
  <DispatchButton secondary disabled={busy} onClick={()=>void load()}>ตรวจรายการอาจซ้ำ / โหลดประวัติล่าสุด</DispatchButton>
  {data&&<><h4>รายการที่อาจซ้ำ · {data.duplicates.length}</h4>{data.duplicates.length?<ul>{data.duplicates.map(row=><li key={row.id}><Link aria-disabled={busy} onClick={e=>{if(pending.current)e.preventDefault()}} to={`/dispatcher?booking=${encodeURIComponent(row.id)}&dialog=details`}>{row.reference}</Link> · {row.status} · {row.reasons.map(reason=>reason==='same_profile_appointment'?'โปรไฟล์เดียวกันและนัดเวลาเดียวกัน':'ชื่อ/เบอร์/โรงพยาบาล/เวลานัดตรงกัน').join(' · ')}</li>)}</ul>:<p>ไม่พบรายการตรงตามเกณฑ์ ไม่ใช่การยืนยันตัวบุคคล</p>}
   {data.capacityDecision&&<section><h4>หลักฐานกำลังรถที่ใช้ปฏิเสธ</h4><p>{data.capacityDecision.id} · {dispatchDate(data.capacityDecision.recordedAt)} {dispatchTime(data.capacityDecision.recordedAt)}</p><p>{data.capacityDecision.explanation}</p><ul>{data.capacityDecision.alternatives.map((a,i)=><li key={i}>{a.selection.vehicleId} · {a.selection.driverId} · {a.selection.originLocationId} · {a.result}</li>)}</ul></section>}
   <label className="booking-field">ผลการตรวจสอบ<select value={outcome} disabled={busy} onChange={e=>{setOutcome(e.target.value);event.current=crypto.randomUUID()}}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <label className="booking-field">หมายเหตุการติดต่อ (เฉพาะงานรับส่ง ไม่บันทึกข้อมูลทางคลินิก)<textarea value={notes} maxLength={1000} disabled={busy} onChange={e=>{setNotes(e.target.value);event.current=crypto.randomUUID()}} /></label>
   {data.latestId&&<label><input type="checkbox" checked={correcting} disabled={busy} onChange={e=>{setCorrecting(e.target.checked);event.current=crypto.randomUUID()}} />แก้ไขผลรายการล่าสุดโดยเพิ่มประวัติใหม่ (ระบุคำอธิบาย)</label>}
   <DispatchButton disabled={busy||(correcting&&!notes.trim())} onClick={()=>void save()}>{busy?'กำลังบันทึก…':'บันทึกผลการตรวจสอบ'}</DispatchButton>
   <ol>{data.history.map(row=><li key={row.id}>{labels[row.outcome]??`ผลเดิม: ${row.outcome}`} · {dispatchDate(row.recordedAt)} {dispatchTime(row.recordedAt)} · {row.actor}{row.correctsId&&<p>แก้ไขรายการ {row.correctsId} โดยเก็บประวัติเดิมไว้</p>}<p>{row.notes}</p><small>รหัสรายการ {row.id}</small></li>)}</ol>
   {data.nextCursor&&<DispatchButton secondary disabled={busy} onClick={()=>void load(true)}>ประวัติก่อนหน้า</DispatchButton>}
  </>}{error&&<p role="alert" className="dispatch-alert">{error} โหลดประวัติล่าสุดก่อนลองอีกครั้ง</p>}{notice&&<p role="status">{notice}</p>}
 </section>
}
