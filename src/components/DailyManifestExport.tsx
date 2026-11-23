import {useRef,useState} from 'react'
import {staffDownload} from '../services/staffSession'
import {dispatcherError} from '../services/dispatcherApi'
import {bangkokDate} from '../services/booking'
import {DispatchButton,DispatchModal} from './DispatcherUI'

export function DailyManifestExport() {
 const [date,setDate]=useState(()=>bangkokDate()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [open,setOpen]=useState(false)
 const pending=useRef(false)
 async function download(format:'xlsx'|'pdf') {
  if(pending.current||!date)return
  pending.current=true;setBusy(true);setError('');setNotice('')
  try{
   const file=await staffDownload('/reports/daily',{date,format})
   const url=URL.createObjectURL(file.blob),anchor=document.createElement('a')
   anchor.href=url;anchor.download=file.filename;document.body.append(anchor);anchor.click();anchor.remove()
   window.setTimeout(()=>URL.revokeObjectURL(url),1000)
   setNotice('สร้างไฟล์ใบงานแล้ว กรุณาเก็บรักษาตามระเบียบเทศบาล')
  }catch(error){setError(dispatcherError(error))}
  finally{pending.current=false;setBusy(false)}
 }
 return <><button type="button" className="dispatch-report-link" aria-haspopup="dialog" onClick={()=>setOpen(true)}>ส่งออกใบงานรายวัน</button>
  {open&&<DispatchModal title="ส่งออกใบงานรายวัน" kind="dispatch-report-modal" onClose={()=>{if(!pending.current)setOpen(false)}} footer={<>
   <DispatchButton disabled={busy||!date} onClick={()=>void download('xlsx')}>{busy?'กำลังสร้างไฟล์…':'ดาวน์โหลด Excel (.xlsx)'}</DispatchButton>
   <DispatchButton secondary disabled={busy||!date} onClick={()=>void download('pdf')}>ดาวน์โหลด PDF สำหรับพิมพ์</DispatchButton>
  </>}>
  <p>เฉพาะงานที่เคยมอบหมายแล้วตามวันนัดหมายเวลาไทย รวมงานจบ ยกเลิก และยุติ</p>
  <label className="booking-field">วันนัดหมายสำหรับส่งออก<input type="date" required value={date} disabled={busy} onChange={event=>{setDate(event.target.value);setNotice('')}} /></label>
  <p>ไฟล์มีข้อมูลผู้รับบริการและผู้ติดต่อสำหรับเจ้าหน้าที่จัดรถที่ได้รับอนุญาตเท่านั้น แต่ละครั้งระบุเวลาข้อมูล ณ ที่สร้างไฟล์</p>
  {error&&<p role="alert" className="dispatch-alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </DispatchModal>}
 </>
}
