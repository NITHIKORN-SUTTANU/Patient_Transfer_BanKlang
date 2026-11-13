import type { Booking } from '../data/seed'
import { dispatchDate, dispatchTime } from '../services/dispatch'
import { driverStage } from '../services/driver'

// Use the authoritative lifecycle when present; show timestamps only if recorded.
export function BookingTripTimeline({ booking }: { booking: Booking }) {
  const stage = driverStage(booking)
  const current = booking.apiStatus ? ({ REQUESTED: 0, APPROVED: 1, SCHEDULED: 1, ASSIGNED: 2, PICKING_UP: 3, PICKED_UP: 4, IN_TRANSIT: 5, COMPLETED: 6 } as Record<string, number>)[booking.apiStatus] ?? 0 : booking.status === 'pending' ? 0 : !booking.schedule ? 1 : stage === 'assigned' ? 2 : stage === 'going_to_pickup' ? 3 : stage === 'patient_onboard' ? 4 : stage === 'going_to_hospital' ? 5 : 6
  const steps = ['ส่งคำขอแล้ว', 'เจ้าหน้าที่อนุมัติคำขอ', 'จัดรถและคนขับแล้ว', 'คนขับกำลังไปรับ', 'รับผู้ป่วยขึ้นรถแล้ว', 'กำลังเดินทางไปโรงพยาบาล', 'ส่งถึงโรงพยาบาลแล้ว']
  const hints = ['เจ้าหน้าที่กำลังตรวจสอบ ยังไม่ยืนยันรถรับส่ง', 'รอจัดรถและคนขับ ยังไม่ยืนยันเวลารับ', 'ตรวจสอบเวลารับที่ยืนยันด้านล่าง', 'กรุณาเตรียมตัวที่จุดรับ', 'ผู้ป่วยขึ้นรถแล้ว', 'คนขับกำลังนำผู้ป่วยไปโรงพยาบาล', 'การเดินทางเสร็จสิ้น']
  return <div className="booking-trip-progress"><section className="booking-current-status" aria-label="สถานะปัจจุบัน"><span aria-hidden="true">{current < 3 ? '◷' : '→'}</span><div><h3>{steps[current]}</h3><p>{hints[current]}</p></div></section><details className="booking-progress-details"><summary>ดูทุกขั้นตอน</summary><ol className="booking-trip-timeline" aria-label="ความคืบหน้าการเดินทาง">{steps.map((label, index) => {
    const eventAt = index === 0 ? booking.createdAt : index === 1 ? booking.reviewedAt : index === 2 ? booking.assignedAt : booking.driverProgress?.events.find(event => event.stage === ['going_to_pickup', 'patient_onboard', 'going_to_hospital', 'delivered'][index - 3])?.at
    return <li key={label} className={index < current ? 'complete' : index === current ? 'current' : ''} aria-current={index === current ? 'step' : undefined}><span aria-hidden="true">{index < current ? '✓' : index + 1}</span><div><strong>{label}</strong>{index <= current && eventAt && <p className="booking-small">{dispatchDate(eventAt)} · {dispatchTime(eventAt)} น.</p>}</div></li>
  })}</ol></details></div>
}
