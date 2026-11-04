import type { BookingDetails } from '../services/booking'
import { PickupMap } from './LocationMap'

export function DispatcherPickupMap({ pickup }: { pickup: BookingDetails['pickup'] | undefined }) {
  const latitude = pickup?.latitude
  const longitude = pickup?.longitude
  if (latitude === undefined || longitude === undefined || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return <p className="dispatch-small">ไม่มีพิกัดแผนที่ กรุณาติดต่อผู้จองเพื่อยืนยันจุดรับ</p>
  }
  const params = new URLSearchParams({ api: '1', query: `${latitude},${longitude}` })
  return <div className="dispatch-pickup-map">
    <PickupMap value={pickup ?? null} />
    <a className="dispatch-details-link" href={`https://www.google.com/maps/search/?${params}`} target="_blank" rel="noopener noreferrer">เปิดจุดรับใน Google Maps ↗</a>
    <p className="dispatch-small">จุดรับที่ผู้จองระบุ ไม่ใช่ตำแหน่งรถแบบเรียลไทม์</p>
  </div>
}
