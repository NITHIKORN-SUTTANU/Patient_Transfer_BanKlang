import { useRef, useState } from 'react'
import type { ApiBooking, Catalog } from '../services/dispatcherApi'
import { dispatcherError } from '../services/dispatcherApi'
import { staffRequest } from '../services/staffSession'
import { DispatchButton, DispatchModal } from './DispatcherUI'
import { dispatchDate, dispatchTime } from '../services/dispatch'

interface Proposal { hospitalName: string; arrivalAt: string; readyAt: string; latenessSeconds: number; appointmentLatenessSeconds: number }
export function DestinationRevisionForm({booking,catalog,onSaved,onBusyChange}:{booking:ApiBooking;catalog:Catalog;onSaved:()=>void;onBusyChange:(busy:boolean)=>void}) {
  const [hospitalId,setHospitalId]=useState('')
  const [latitude,setLatitude]=useState(''),[longitude,setLongitude]=useState(''),[label,setLabel]=useState(''),[reason,setReason]=useState('')
  const [confirmedAt,setConfirmedAt]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false)
  const [proposal,setProposal]=useState<{signature:string;data:Proposal}|null>(null)
  const pending=useRef(false),eventId=useRef<string>('')
  const signature=JSON.stringify({hospitalId,latitude,longitude,label,reason,confirmedAt})
  const current=proposal?.signature===signature?proposal.data:null
  const valid=!!hospitalId&&latitude.trim()!==''&&longitude.trim()!==''&&Number.isFinite(Number(latitude))&&Math.abs(Number(latitude))<=90&&Number.isFinite(Number(longitude))&&Math.abs(Number(longitude))<=180&&!!label.trim()&&!!reason.trim()&&!!confirmedAt
  function invalidate() {setConfirmedAt('');setProposal(null);eventId.current=''}
  const body=()=>({expectedRevision:booking.revision,expectedExecutionVersion:booking.executionVersion,hospitalId,reason:reason.trim(),currentLocation:{latitude:Number(latitude),longitude:Number(longitude),label:label.trim()},confirmedAt,confirmedPhase:booking.status})
  async function send(commit:boolean) {
    if(pending.current||!valid) return
    pending.current=true;setBusy(true);onBusyChange(true);setError('')
    try {
      if(commit) {
        eventId.current ||= crypto.randomUUID()
        await staffRequest(`/bookings/${booking.id}/destination`,{...body(),eventId:eventId.current})
        setConfirm(false);onSaved()
      } else {
        const result=await staffRequest<Proposal>(`/bookings/${booking.id}/destination-preview`,body())
        setProposal({signature,data:result})
      }
    } catch(error) {setError(dispatcherError(error));if(!commit) setProposal(null)}
    finally {pending.current=false;setBusy(false);onBusyChange(false)}
  }
  return <section className="dispatch-detail-section"><h3>เปลี่ยนโรงพยาบาลหลังรับผู้ป่วย</h3><p>ใช้รถและคนขับเดิม คงสถานะจริงและประวัติการรับผู้ป่วย หากมีเหตุขัดข้องต้องยืนยันคลี่คลายแยกต่างหาก</p><fieldset disabled={busy}>
    <label className="booking-field">โรงพยาบาลปลายทางใหม่<select value={hospitalId} onChange={e=>{setHospitalId(e.target.value);invalidate()}}><option value="">เลือกโรงพยาบาล</option>{catalog.hospitals.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
    <label className="booking-field">สถานที่ปัจจุบันที่ตรวจสอบ<input maxLength={1000} value={label} onChange={e=>{setLabel(e.target.value);invalidate()}} /></label>
    <label className="booking-field">ละติจูดปัจจุบัน<input type="number" step="any" min="-90" max="90" value={latitude} onChange={e=>{setLatitude(e.target.value);invalidate()}} /></label>
    <label className="booking-field">ลองจิจูดปัจจุบัน<input type="number" step="any" min="-180" max="180" value={longitude} onChange={e=>{setLongitude(e.target.value);invalidate()}} /></label>
    <label className="booking-field">เหตุผลเปลี่ยนโรงพยาบาล<textarea maxLength={1000} value={reason} onChange={e=>{setReason(e.target.value);invalidate()}} /></label>
    <label className="booking-checkbox"><input type="checkbox" checked={!!confirmedAt} onChange={e=>{setConfirmedAt(e.target.checked?new Date().toISOString():'');setProposal(null);eventId.current=''}} /><span>ยืนยันตำแหน่งจริงและสถานะปัจจุบันแล้ว (ภายใน 5 นาที)</span></label>
  </fieldset>{error&&!confirm&&<p role="alert" className="dispatch-alert">{error}</p>}<DispatchButton secondary disabled={busy||!valid} onClick={()=>void send(false)}>ตรวจเส้นทางและเวลาต่อจากตำแหน่งปัจจุบัน</DispatchButton>
  {current&&<><p>ปลายทางใหม่ {current.hospitalName} · คาดถึง {dispatchDate(current.arrivalAt)} {dispatchTime(current.arrivalAt)} น. · พร้อมรับงานต่อ {dispatchTime(current.readyAt)} น.</p><p>ช้ากว่าเป้าหมายเดิม {Math.ceil(current.latenessSeconds/60)} นาที · เลยเวลานัดเดิม {Math.ceil(current.appointmentLatenessSeconds/60)} นาที</p><DispatchButton disabled={busy} onClick={()=>{setError('');setConfirm(true)}}>ตรวจสอบและยืนยันปลายทางใหม่</DispatchButton></>}
  {confirm&&<DispatchModal title="ยืนยันเปลี่ยนโรงพยาบาล" onClose={()=>{if(!pending.current)setConfirm(false)}}><p>ยืนยันเดินทางต่อไปยัง {current?.hospitalName} โดยคงหมายเลขงาน เวลานัดเดิม การรับผู้ป่วย และสถานะจริงไว้ ระบบจะตรวจเส้นทางและงานถัดไปซ้ำก่อนบันทึก</p>{error&&<p role="alert" className="dispatch-alert">{error}</p>}<DispatchButton disabled={busy||!current} onClick={()=>void send(true)}>{busy?'กำลังตรวจสอบ…':'ยืนยันปลายทางใหม่'}</DispatchButton><DispatchButton secondary disabled={busy} onClick={()=>setConfirm(false)}>กลับไปตรวจสอบ</DispatchButton></DispatchModal>}
  </section>
}
