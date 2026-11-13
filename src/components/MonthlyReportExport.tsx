import {useRef,useState} from 'react'
import {staffDownload} from '../services/staffSession'
import {dispatcherError} from '../services/dispatcherApi'
import {bangkokDate} from '../services/booking'
import {DispatchButton} from './DispatcherUI'

export function MonthlyReportExport() {
 const [month,setMonth]=useState(()=>bangkokDate().slice(0,7)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
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
 return <details className="dispatch-panel"><summary>ส่งออกรายงานสรุปรายเดือน</summary>
  <p>รวมทุกคำขอตามเดือนนัดหมายเวลาไทย ไม่ใช้ตัวกรองตาราง ไม่มีชื่อผู้ป่วย เบอร์ติดต่อ หรือจุดรับ</p>
  <label className="booking-field">เดือนนัดหมายสำหรับรายงาน<input type="month" required value={month} disabled={busy} onChange={event=>{setMonth(event.target.value);setNotice('')}} /></label>
  <p>Excel 3 แผ่นงาน: สรุปบริการ หมู่บ้าน และโรงพยาบาล/กองรถ พร้อมเวลาข้อมูล ณ ที่สร้างไฟล์ ยอดเคยอนุมัติแยกจากผลลัพธ์ อัตราสำเร็จ = ส่งสำเร็จ ÷ (ส่งสำเร็จ + ยุติ + รับไม่สำเร็จ)</p>
  <DispatchButton secondary disabled={busy||!month} onClick={()=>void download()}>{busy?'กำลังสร้างรายงาน…':'ดาวน์โหลดรายงานรายเดือน (.xlsx)'}</DispatchButton>
  {error&&<p role="alert" className="dispatch-alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </details>
}
