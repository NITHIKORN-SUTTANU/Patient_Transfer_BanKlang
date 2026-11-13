import {useRef,useState} from 'react'
import {staffRequest} from '../services/staffSession'
import {dispatcherError,type Catalog} from '../services/dispatcherApi'
import {DispatchButton} from './DispatcherUI'
interface Alternative {vehicleId:string;driverId:string;originLocationId:string;originKind:string;previousBookingId?:string}
interface Evidence {id:string;rejectable:boolean;recordedAt:string;alternatives:{selection:Alternative;result:string;issues?:{code:string;message:string}[]}[]}
export function CapacityEvidence({bookingId,revision,catalog,onEvidence,onBusyChange}:{bookingId:string;revision:number;catalog:Catalog;onEvidence:(id:string|null)=>void;onBusyChange:(busy:boolean)=>void}){
 const [vehicle,setVehicle]=useState(''),[driver,setDriver]=useState(''),[origin,setOrigin]=useState(catalog.depotLocationId??''),[previous,setPrevious]=useState(''),[alternatives,setAlternatives]=useState<Alternative[]>([]),[explanation,setExplanation]=useState(''),[result,setResult]=useState<Evidence|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const pending=useRef(false)
 function invalidate(){setResult(null);onEvidence(null)}
 async function inspect(){
  if(pending.current)return
  pending.current=true;setBusy(true);onBusyChange(true);setError('');invalidate()
  try{const evidence=await staffRequest<Evidence>(`/bookings/${bookingId}/capacity-checks`,{expectedRevision:revision,alternatives,explanation});setResult(evidence);onEvidence(evidence.rejectable?evidence.id:null)}
  catch(error){setError(dispatcherError(error))}
  finally{pending.current=false;setBusy(false);onBusyChange(false)}
 }
 return <section className="dispatch-detail-section"><h3>หลักฐานตรวจสอบกำลังรถ</h3><p>เพิ่มรถ/คนขับและต้นทางที่พิจารณา ระบบตรวจเฉพาะทางเลือกที่ระบุ ไม่ใช่การยืนยันว่าได้ค้นหาทุกการจัดรถ ต้องอธิบายเหตุผลที่ไม่มีการจัดรถที่เหมาะสม การติดต่อไม่ได้หรือคำเตือนอาจซ้ำใช้แทนหลักฐานนี้ไม่ได้</p>
  <label className="booking-field">รถที่พิจารณา<select value={vehicle} disabled={busy} onChange={e=>setVehicle(e.target.value)}><option value="">เลือกรถ</option>{catalog.vehicles.map(v=><option key={v.id} value={v.id}>{v.name} · {v.plate}</option>)}</select></label>
  <label className="booking-field">คนขับที่พิจารณา<select value={driver} disabled={busy} onChange={e=>setDriver(e.target.value)}><option value="">เลือกคนขับ</option>{catalog.drivers.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
  <label className="booking-field">ต้นทางที่พิจารณา<select value={origin} disabled={busy} onChange={e=>setOrigin(e.target.value)}><option value="">เลือกต้นทาง</option>{catalog.locations.filter(l=>['depot','hospital'].includes(l.kind)).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
  {origin!==catalog.depotLocationId&&<label className="booking-field">รหัสงานก่อนหน้าที่จบ ณ ต้นทางนี้<input value={previous} disabled={busy} onChange={e=>setPrevious(e.target.value)} /></label>}
  <DispatchButton secondary disabled={busy||!vehicle||!driver||!origin||alternatives.length>=30||(origin!==catalog.depotLocationId&&!previous)} onClick={()=>{invalidate();setAlternatives(a=>[...a,{vehicleId:vehicle,driverId:driver,originLocationId:origin,originKind:origin===catalog.depotLocationId?'depot':'previous_hospital',...(origin!==catalog.depotLocationId?{previousBookingId:previous}:{})}])}}>เพิ่มทางเลือกที่พิจารณา</DispatchButton>
  <ol>{alternatives.map((a,i)=><li key={i}>{catalog.vehicles.find(v=>v.id===a.vehicleId)?.name} · {catalog.drivers.find(d=>d.id===a.driverId)?.name} · {catalog.locations.find(l=>l.id===a.originLocationId)?.name}<DispatchButton secondary disabled={busy} onClick={()=>{invalidate();setAlternatives(rows=>rows.filter((_,index)=>index!==i))}}>นำทางเลือก {i+1} ออก</DispatchButton></li>)}</ol>
  <label className="booking-field">เหตุผลที่ทางเลือกทั้งหมดไม่สามารถให้บริการได้<textarea value={explanation} maxLength={1000} disabled={busy} onChange={e=>{setExplanation(e.target.value);invalidate()}} /></label>
  <DispatchButton secondary disabled={busy||!alternatives.length||!explanation.trim()} onClick={()=>void inspect()}>ตรวจเส้นทางและกำลังรถล่าสุด</DispatchButton>
  {result&&<><p role="status">{result.rejectable?'บันทึกหลักฐานแล้ว ต้องตรวจซ้ำโดยเซิร์ฟเวอร์เมื่อยืนยันปฏิเสธ':'ยังปฏิเสธด้วยเหตุทรัพยากรไม่เพียงพอไม่ได้ มีทางเลือกที่ใช้ได้หรือไม่ใช่ปัญหากำลังรถ'}</p><ol>{result.alternatives.map((a,i)=><li key={i}>ทางเลือก {i+1}: {a.result==='available'?'จัดรถได้':a.result==='unavailable'?'ไม่พร้อมตามเงื่อนไข':'ต้องตรวจสอบเหตุอื่น'} {a.issues?.map(issue=>issue.code).join(', ')}</li>)}</ol></>}
  {error&&<p role="alert" className="dispatch-alert">{error}</p>}
 </section>
}
