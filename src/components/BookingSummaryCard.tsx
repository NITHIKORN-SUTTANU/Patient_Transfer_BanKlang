import { Link } from 'react-router'
import type { Booking } from '../data/seed'
import { dispatchDate, dispatchTime } from '../services/dispatch'
import { driverLabels, driverStage } from '../services/driver'
import { ServiceSymbol } from './ServiceSymbol'

function nextStep(booking: Booking) {
  if (booking.status === 'pending') return 'รอเจ้าหน้าที่พิจารณา'
  if (booking.status === 'approved') return booking.schedule ? '' : 'รอจัดรถและแจ้งเวลารับ'
  if (booking.status === 'in_transit') return driverLabels[driverStage(booking)]
  return { completed: 'ส่งถึงโรงพยาบาลแล้ว', rejected: 'ดูเหตุผลการไม่อนุมัติในรายละเอียด', cancelled: 'ยกเลิกคำขอแล้ว ไม่มีการจัดรถ' }[booking.status]
}

export function BookingSummaryCard({ booking, statusLabel, to }: { booking: Booking; statusLabel: string; to?: string }) {
  const content = <><div className="booking-summary-heading"><div className="booking-summary-identity">{['approved', 'completed'].includes(booking.status) && <span className="booking-summary-status-icon"><ServiceSymbol kind={booking.status === 'completed' ? 'check' : 'calendar'} /></span>}<div><span className="booking-small">หมายเลขคำขอ</span><strong className="booking-summary-id">{booking.id}</strong></div></div><span className={`booking-badge ${booking.status}`}>{statusLabel}</span></div><div className="booking-summary-appointment"><span className="booking-small">{to ? 'วันนัดหมาย' : 'วันและเวลานัด'}</span><div><strong>{dispatchDate(booking.appointmentAt)}</strong>{!to && <strong>{dispatchTime(booking.appointmentAt)} น.</strong>}</div></div>{!to && <><p className="booking-summary-hospital">{booking.details?.hospital || 'โรงพยาบาลที่เลือก'}</p><p className="booking-summary-patient">ผู้ป่วย · {booking.patientName}</p></>}{!to && booking.details?.phone && <div className="booking-summary-pickup"><span className="booking-small">เบอร์โทรศัพท์ผู้ติดต่อ</span><p>{booking.details.phone}</p></div>}{!to && booking.details?.pickup && <div className="booking-summary-pickup"><span className="booking-small">จุดรับผู้ป่วย</span><p>{booking.details.pickup.label}</p></div>}{!['rejected', 'cancelled'].includes(booking.status) && <div className="booking-summary-pickup-time"><span>เวลารับผู้ป่วย: </span><strong>{booking.schedule ? `${dispatchTime(booking.schedule.pickupAt)} น.` : 'รอเจ้าหน้าที่ยืนยัน'}</strong></div>}{(to || nextStep(booking)) && <div className="booking-summary-next">{!to && nextStep(booking) && <span>{nextStep(booking)}</span>}{to && <strong>{booking.status === 'completed' ? 'ดูสรุปการเดินทาง' : 'ดูรายละเอียด'} <span aria-hidden="true">›</span></strong>}</div>}</>
  return to ? <Link to={to} className={`booking-summary-card ${booking.status}`}>{content}</Link> : <section className={`booking-summary-card ${booking.status}`} aria-label="รายละเอียดคำขอจองรถ">{content}</section>
}
