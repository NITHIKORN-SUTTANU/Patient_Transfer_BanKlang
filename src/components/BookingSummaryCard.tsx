import { DestinationRevisionSummary } from './DestinationRevisionSummary'
import { Link } from 'react-router'
import { useState } from 'react'
import type { Booking } from '../data/seed'
import { dispatchDate, dispatchTime } from '../services/dispatch'
import { BookingModal } from './BookingUI'
import { PickupMap } from './LocationMap'
import { ServiceSymbol } from './ServiceSymbol'

function mobilityIcon(assistance?: string) {
  if (assistance === 'รถเข็น') return 'wheel' as const
  if (assistance === 'เปลนอน') return 'bed' as const
  return 'walk' as const
}

function additionalAssistanceLabel(assistance: string) {
  if (assistance.includes('พยุงขึ้น-ลงรถ')) return 'ช่วยพยุงขึ้น-ลงรถ'
  if (assistance.includes('ผู้ดูแลเดินทาง')) return 'มีผู้ดูแลร่วมเดินทาง'
  return assistance
}

function compactReference(reference: string) {
  return reference.length > 20 ? `${reference.slice(0, 11)}…${reference.slice(-4)}` : reference
}

function statusIcon(booking: Booking) {
  const apiIcons = {
    REQUESTED: 'clock', APPROVED: 'check', SCHEDULED: 'calendar', ASSIGNED: 'vehicle',
    PICKING_UP: 'route', PICKED_UP: 'person', IN_TRANSIT: 'route', COMPLETED: 'check',
    CANCELLED: 'close', REJECTED: 'close', ABORTED: 'close',
  } as const
  if (booking.apiStatus && booking.apiStatus in apiIcons) return apiIcons[booking.apiStatus as keyof typeof apiIcons]
  return ({ pending: 'clock', approved: 'check', rejected: 'close', in_transit: 'route', completed: 'check', cancelled: 'close' } as const)[booking.status]
}

export function BookingSummaryCard({ booking, statusLabel, to }: { booking: Booking; statusLabel: string; to?: string }) {
  const [showPickupMap, setShowPickupMap] = useState(false)
  const pickup = booking.details?.pickup
  const hasPickupCoordinates = pickup?.latitude !== undefined && pickup.longitude !== undefined
    && Number.isFinite(pickup.latitude) && Number.isFinite(pickup.longitude)
    && Math.abs(pickup.latitude) <= 90 && Math.abs(pickup.longitude) <= 180
  const mapUrl = hasPickupCoordinates
    ? `https://www.google.com/maps/search/?api=1&query=${pickup.latitude},${pickup.longitude}`
    : undefined
  const contact = booking.details?.contactName && booking.details.contactName !== booking.patientName
    ? `${booking.details.contactName} · ${booking.details.phone}`
    : booking.details?.phone
  const reference = booking.reference ?? booking.id
  const content = <>
    {!to && <DestinationRevisionSummary revision={booking.destinationRevision} />}
    <div className="booking-summary-heading">
      <div className="booking-summary-identity">
        <div className="booking-summary-person-block">
          <strong className="booking-summary-person">{booking.patientName}</strong>
        </div>
      </div>
      {to && <span className={`booking-summary-stage-icon ${booking.status} ${booking.apiStatus?.toLowerCase() ?? ''}`} role="img" aria-label={statusLabel} title={statusLabel}><ServiceSymbol kind={statusIcon(booking)} /></span>}
    </div>
    <div className="booking-summary-appointment"><span className="booking-small">นัดหมาย</span><div><strong>{dispatchDate(booking.appointmentAt)}</strong><strong>{dispatchTime(booking.appointmentAt)} น.</strong></div></div>
    <p className="booking-summary-hospital">{booking.details?.hospital || 'โรงพยาบาลที่เลือก'}</p>
    {booking.details?.assistance && <div className="booking-summary-mobility" aria-label={`การเคลื่อนย้าย: ${booking.details.assistance}`}><ServiceSymbol kind={mobilityIcon(booking.details.assistance)} /><span>{booking.details.assistance}</span></div>}
    {!!booking.details?.extras.length && <div className="booking-summary-extra-assistance"><span>ช่วยเหลือเพิ่มเติม</span><ul>{booking.details.extras.map(extra => <li key={extra}><ServiceSymbol kind={extra.includes('ผู้ดูแลเดินทาง') ? 'people' : 'person'} />{additionalAssistanceLabel(extra)}</li>)}</ul></div>}
    {!to && contact && <p className="booking-summary-contact">ผู้ติดต่อ · {contact}</p>}
    {!to && pickup && <p className="booking-summary-pickup-compact">จุดรับ · {pickup.label}</p>}
    {!to && mapUrl && <button type="button" className="booking-summary-map-link" onClick={() => setShowPickupMap(true)}><ServiceSymbol kind="pin" />ดูแผนที่จุดรับ</button>}
    {!to && booking.schedule && !['rejected', 'cancelled'].includes(booking.status) && <div className="booking-summary-pickup-time"><span>เวลารับ </span><strong>{dispatchTime(booking.schedule.pickupAt)} น.</strong></div>}
    {to && <div className="booking-summary-next"><strong>เปิดรายละเอียด <span aria-hidden="true">›</span></strong></div>}
    {!to && <div className="booking-summary-status-text"><strong>{statusLabel}</strong></div>}
    {!to && <span className="booking-summary-reference" title={reference} aria-label={`เลขที่คำขอ ${reference}`}>เลขที่คำขอ · {compactReference(reference)}</span>}
  </>
  if (to) return <Link to={to} className={`booking-summary-card ${booking.status}`}>{content}</Link>
  return <>
    <section className={`booking-summary-card ${booking.status}`} aria-label="รายละเอียดคำขอจองรถ">{content}</section>
    {showPickupMap && pickup && mapUrl && <BookingModal title="แผนที่จุดรับผู้ป่วย" className="booking-location-modal" onClose={() => setShowPickupMap(false)} footer={<a className="booking-map-external-link" href={mapUrl} target="_blank" rel="noopener noreferrer">เปิดตำแหน่งใน Google Maps</a>}>
      <p>{pickup.label}</p>
      <PickupMap value={pickup} locationName="จุดรับผู้ป่วย" />
    </BookingModal>}
  </>
}
