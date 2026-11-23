import {useRef,useState} from 'react'
import {staffDownload} from '../services/staffSession'
import {dispatcherError} from '../services/dispatcherApi'
import {bangkokDate} from '../services/booking'
import {DispatchButton,DispatchModal} from './DispatcherUI'

export function MonthlyReportExport() {
 const [month,setMonth]=useState(()=>bangkokDate().slice(0,7)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [open,setOpen]=useState(false)
 const pending=useRef(false)
 async function download(){
  if(pending.current||!month)return
  pending.current=true;setBusy(true);setError('');setNotice('')
  try{
   const file=await staffDownload('/reports/monthly',{month})
   const url=URL.createObjectURL(file.blob),anchor=document.createElement('a')
   anchor.href=url;anchor.download=file.filename;document.body.append(anchor);anchor.click();anchor.remove()
   window.setTimeout(()=>URL.revokeObjectURL(url),1000)
   setNotice('สร้างรายงานรายเดือนแล้ว')
  }catch(error){setError(dispatcherError(error))}
  finally{pending.current=false;setBusy(false)}
 }
 return <><button type="button" className="dispatch-report-link" aria-haspopup="dialog" onClick={()=>setOpen(true)}>ส่งออกรายงานสรุปรายเดือน</button>
  {open&&<DispatchModal title="ส่งออกรายงานสรุปรายเดือน" kind="dispatch-report-modal" onClose={()=>{if(!pending.current)setOpen(false)}} footer={<>
   <DispatchButton disabled={busy||!month} onClick={()=>void download()}>{busy?'กำลังสร้างรายงาน…':'ดาวน์โหลดรายงานรายเดือน (.xlsx)'}</DispatchButton>
  </>}>
  <p>รวมทุกคำขอตามเดือนนัดหมายเวลาไทย ไม่มีชื่อผู้ป่วย เบอร์ติดต่อ หรือจุดรับ</p>
  <label className="booking-field">เดือนนัดหมายสำหรับรายงาน<input type="month" required value={month} disabled={busy} onChange={event=>{setMonth(event.target.value);setNotice('')}} /></label>
  <p>Excel 3 แผ่นงาน: สรุปบริการ หมู่บ้าน และโรงพยาบาล/กองรถ พร้อมเวลาข้อมูล ณ ที่สร้างไฟล์ ยอดเคยอนุมัติแยกจากผลลัพธ์ อัตราสำเร็จ = ส่งสำเร็จ ÷ (ส่งสำเร็จ + ยุติ + รับไม่สำเร็จ)</p>
  {error&&<p role="alert" className="dispatch-alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </DispatchModal>}
 </>
}
