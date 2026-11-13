import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router'
import {staffRequest} from '../services/staffSession'
import {dispatcherError} from '../services/dispatcherApi'
import {dispatchDate,dispatchTime} from '../services/dispatch'
import {DispatchButton} from './DispatcherUI'

interface Alert {id:string;reference:string;description:string;status:string;createdAt:string;acknowledgedAt:string|null;linkPath:string;pickupAt:string|null;arrivalAt:string|null}
interface Queue {alerts:Alert[];unread:number;nextCursor:string|null}
export function DispatcherAlerts() {
 const [data,setData]=useState<Queue|null>(null),[error,setError]=useState(''),[version,setVersion]=useState(0),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false)
 const pending=useRef(false)
 useEffect(()=>{let active=true;staffRequest<Queue>(`/dispatcher-alerts${cursor?`?cursor=${cursor}`:''}`).then(result=>{if(active){setData(result);setError('')}}).catch(error=>{if(active){setData(null);setError(dispatcherError(error))}});return()=>{active=false}},[cursor,version])
 async function acknowledge(id:string) {
  if(pending.current)return
  pending.current=true;setBusy(true);setError('')
  try{await staffRequest(`/dispatcher-alerts/${id}/acknowledgement`,{});setVersion(value=>value+1)}catch(error){setError(dispatcherError(error))}
  finally{pending.current=false;setBusy(false)}
 }
 return <details className="dispatch-panel"><summary>แจ้งเตือนงานรับส่ง{data?` · ยังไม่รับทราบ ${data.unread} รายการ`:''}</summary><p>รายการเหตุการณ์ในเว็บสำหรับเจ้าหน้าที่จัดรถ การรับทราบในเว็บไม่ใช่หลักฐานว่าผู้รับอ่านข้อความ LINE</p>
  <DispatchButton secondary disabled={busy} onClick={()=>setVersion(value=>value+1)}>โหลดแจ้งเตือนงานล่าสุด</DispatchButton>
  {error&&<p role="alert">{error}</p>}{!data&&!error&&<p role="status">กำลังโหลดแจ้งเตือนงาน…</p>}
  {data?.alerts.map(row=><section className="dispatch-detail-section" key={row.id}><h3>{row.reference}</h3><p>{row.description}</p><p>สถานะเมื่อบันทึก {row.status} · {dispatchDate(row.createdAt)} {dispatchTime(row.createdAt)} น.</p>
    {row.pickupAt&&<p>เวลารับตามเหตุการณ์ {dispatchTime(row.pickupAt)} น.</p>}{row.arrivalAt&&<p>คาดถึงตามเหตุการณ์ {dispatchTime(row.arrivalAt)} น.</p>}
    <Link to={row.linkPath}>เปิดงานและสถานะล่าสุด</Link>{row.acknowledgedAt?<p>รับทราบรายการในเว็บแล้ว</p>:<DispatchButton secondary disabled={busy} onClick={()=>void acknowledge(row.id)}>รับทราบรายการในเว็บ</DispatchButton>}
  </section>)}{cursor&&<DispatchButton secondary disabled={busy} onClick={()=>setCursor(null)}>กลับแจ้งเตือนล่าสุด</DispatchButton>}{data?.nextCursor&&<DispatchButton secondary disabled={busy} onClick={()=>setCursor(data.nextCursor)}>ดูแจ้งเตือนเก่ากว่า</DispatchButton>}
 </details>
}
