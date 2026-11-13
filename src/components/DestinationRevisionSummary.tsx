import type { DestinationRevision } from '../services/dispatcherApi'
import { dispatchDate, dispatchTime } from '../services/dispatch'

export function DestinationRevisionSummary({revision}:{revision?: DestinationRevision | null}) {
  if(!revision) return null
  return <section className="dispatch-alert" aria-label="ปลายทางและเวลาที่ปรับแล้ว"><p>ปรับปลายทางระหว่างเดินทางแล้ว · ครั้งที่ {revision.version}</p><p>คาดถึง {dispatchDate(revision.arrivalAt)} {dispatchTime(revision.arrivalAt)} น. · พร้อมรับงานต่อ {dispatchTime(revision.readyAt)} น.</p><p>โรงพยาบาลเดิม {revision.originalHospitalName} · เป้าหมายถึงเดิม {dispatchTime(revision.originalArrivalAt)} น.</p><p>ช้ากว่าเป้าหมายเดิม {Math.ceil(revision.latenessSeconds/60)} นาที · เลยเวลานัดเดิม {Math.ceil(revision.appointmentLatenessSeconds/60)} นาที</p></section>
}
