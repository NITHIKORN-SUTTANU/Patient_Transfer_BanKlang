import type { ReactNode } from 'react'
import { DestinationRevisionSummary } from './DestinationRevisionSummary'
import { Link } from 'react-router'
import type { Booking } from '../data/seed'
import { formatPickupSummary } from '../services/booking'
import { dispatchDate, dispatchTime } from '../services/dispatch'
import { driverLabels, driverStage } from '../services/driver'
import { ServiceSymbol } from './ServiceSymbol'

function nextStep(booking: Booking) {
  if (booking.apiStatus) return ({ REQUESTED: 'รอเจ้าหน้าที่พิจารณา', APPROVED: 'รอจัดตาราง', SCHEDULED: 'ยืนยันตารางแล้ว รอมอบหมายรถและคนขับ', ASSIGNED: booking.startedAt ? 'คนขับเริ่มงานแล้ว' : 'จัดรถและคนขับแล้ว', PICKING_UP: 'คนขับกำลังไปรับ', PICKED_UP: 'รับผู้ป่วยขึ้นรถแล้ว', IN_TRANSIT: 'กำลังเดินทางไปโรงพยาบาล', COMPLETED: 'ส่งถึงโรงพยาบาลแล้ว', ABORTED: 'ยุติการเดินทาง กรุณาติดต่อเทศบาล', CANCELLED: 'ยกเลิกคำขอแล้ว', REJECTED: 'ดูเหตุผลการไม่อนุมัติในรายละเอียด' } as Record<string, string>)[booking.apiStatus] ?? ''
  if (booking.status === 'pending') return 'รอเจ้าหน้าที่พิจารณา'
  if (booking.status === 'approved') return booking.schedule ? '' : 'รอจัดรถและแจ้งเวลารับ'
  if (booking.status === 'in_transit') return driverLabels[driverStage(booking)]
  return { completed: 'ส่งถึงโรงพยาบาลแล้ว', rejected: 'ดูเหตุผลการไม่อนุมัติในรายละเอียด', cancelled: 'ยกเลิกคำขอแล้ว ไม่มีการจัดรถ' }[booking.status]
}

export function BookingSummaryCard({
  booking,
  statusLabel,
  to,
  headerAction,
}: {
  booking: Booking
  statusLabel: string
  to?: string
  headerAction?: ReactNode
}) {
  const pickupLabel = booking.details?.pickup ? formatPickupSummary(booking.details.pickup.label) : ''
  const showPickupTime = !['rejected', 'cancelled'].includes(booking.status)
  const content = (
    <>
      <DestinationRevisionSummary revision={booking.destinationRevision} />
      <div className="booking-summary-heading">
        <div className="booking-summary-identity">
          {['approved', 'completed'].includes(booking.status) && (
            <span className="booking-summary-status-icon">
              <ServiceSymbol kind={booking.status === 'completed' ? 'check' : 'calendar'} />
            </span>
          )}
          <div>
            <span className="booking-small">หมายเลขคำขอ</span>
            <strong className="booking-summary-id">{booking.reference ?? booking.id}</strong>
          </div>
        </div>
        <div className="booking-summary-heading-right">
          <span className={`booking-badge ${booking.status}`}>{statusLabel}</span>
          {!to && headerAction}
        </div>
      </div>

      {to ? (
        <>
          <div className="booking-summary-appointment">
            <span className="booking-small">วันนัดหมาย</span>
            <div>
              <strong>{dispatchDate(booking.appointmentAt)}</strong>
              <span>{dispatchTime(booking.appointmentAt)} น.</span>
            </div>
          </div>
          {showPickupTime && (
            <div className="booking-summary-pickup-time">
              <span>เวลารับผู้ป่วย: </span>
              <strong>{booking.schedule ? `${dispatchTime(booking.schedule.pickupAt)} น.` : 'รอเจ้าหน้าที่ยืนยัน'}</strong>
            </div>
          )}
        </>
      ) : (
        <div className="booking-slip-body">
          <div className="booking-slip-schedule-row">
            <div className="booking-slip-cell">
              <span className="booking-small">วันและเวลานัด</span>
              <strong>{dispatchDate(booking.appointmentAt)} · {dispatchTime(booking.appointmentAt)} น.</strong>
            </div>
            {showPickupTime && (
              <div className="booking-slip-cell booking-slip-pickup-pill">
                <span className="booking-small">เวลารับผู้ป่วย</span>
                <strong>{booking.schedule ? `${dispatchTime(booking.schedule.pickupAt)} น.` : 'รอเจ้าหน้าที่ยืนยัน'}</strong>
              </div>
            )}
          </div>
          <dl className="booking-slip-meta">
            <div>
              <dt>โรงพยาบาลปลายทาง</dt>
              <dd>{booking.details?.hospital || 'โรงพยาบาลที่เลือก'}</dd>
            </div>
            <div>
              <dt>ผู้ป่วย</dt>
              <dd>{booking.patientName}</dd>
            </div>
            {booking.details?.phone && (
              <div>
                <dt>เบอร์โทรศัพท์ผู้ติดต่อ</dt>
                <dd className="tabular-nums">{booking.details.phone}</dd>
              </div>
            )}
            {pickupLabel && (
              <div className="booking-slip-meta-wide">
                <dt>จุดรับผู้ป่วย</dt>
                <dd>{pickupLabel}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {(to || nextStep(booking)) && (
        <div className="booking-summary-next">
          {!to && nextStep(booking) && <span>{nextStep(booking)}</span>}
          {to && (
            <strong>
              {booking.status === 'completed' ? 'ดูสรุปการเดินทาง' : 'ดูรายละเอียด'}{' '}
              <span aria-hidden="true">›</span>
            </strong>
          )}
        </div>
      )}
    </>
  )
  return to ? (
    <Link to={to} className={`booking-summary-card ${booking.status}`}>{content}</Link>
  ) : (
    <section className={`booking-summary-card booking-appointment-slip ${booking.status}`} aria-label="รายละเอียดคำขอจองรถ">
      {content}
    </section>
  )
}
