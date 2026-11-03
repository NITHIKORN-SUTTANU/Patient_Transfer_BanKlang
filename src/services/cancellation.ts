import type { Booking } from '../data/seed'
import { demoStore } from './demoStore'
import { driverAvailable } from './resources'

export function citizenCanCancel(booking: Booking) {
  return ['pending', 'approved'].includes(booking.status) && (!booking.driverProgress || booking.driverProgress.stage === 'assigned')
}
export function cancelBooking(id: string, by: 'citizen' | 'driver', reason = '', driverId?: string) {
  demoStore.update(state => {
    const booking = state.bookings.find(b => b.id === id)
    if (!booking) throw new Error('ไม่พบรายการจองนี้')
    if (by === 'citizen' && !citizenCanCancel(booking)) throw new Error('คนขับเริ่มงานแล้ว ไม่สามารถยกเลิกได้ กรุณาติดต่อเทศบาล')
    if (by === 'driver' && (booking.status !== 'in_transit' || booking.driverProgress?.stage !== 'going_to_pickup' || booking.driverId !== driverId || !driverAvailable(state, state.drivers.find(d => d.id === driverId)))) throw new Error('รายงานได้เฉพาะงานของคุณที่ยังไม่รับผู้ป่วยขึ้นรถ')
    if (by === 'driver' && !reason.trim()) throw new Error('กรุณาระบุเหตุผลที่รับผู้ป่วยไม่ได้')
    return { ...state, bookings: state.bookings.map(b => b.id === id ? { ...b, status: 'cancelled', cancellation: { at: new Date().toISOString(), by, reason: by === 'citizen' ? 'ผู้จองยกเลิกก่อนคนขับเริ่มงาน' : reason.trim() } } : b) }
  })
}
