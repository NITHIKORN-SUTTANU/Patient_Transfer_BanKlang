import type { Booking, DriverStage } from '../data/seed'
import { demoStore } from './demoStore'
import { driverAvailable } from './resources'

export const driverStages: DriverStage[] = ['assigned', 'going_to_pickup', 'patient_onboard', 'going_to_hospital', 'delivered']
export const driverLabels: Record<DriverStage, string> = { assigned: 'ได้รับมอบหมาย', going_to_pickup: 'กำลังไปรับผู้ป่วย', patient_onboard: 'รับผู้ป่วยขึ้นรถแล้ว', going_to_hospital: 'กำลังเดินทางไปโรงพยาบาล', delivered: 'ส่งถึงโรงพยาบาล' }
export function driverStage(booking: Booking): DriverStage {
  return booking.driverProgress?.stage || (booking.status === 'completed' ? 'delivered' : booking.status === 'in_transit' ? 'going_to_pickup' : 'assigned')
}
export function advanceDriverTrip(id: string, driverId: string, expected: DriverStage) {
  demoStore.update(state => {
    const booking = state.bookings.find(b => b.id === id)
    if (!driverAvailable(state, state.drivers.find(d => d.id === driverId))) throw new Error('กรุณาเลือกคนขับที่พร้อมใช้งาน')
    if (!booking || booking.driverId !== driverId || !booking.schedule || !booking.vehicleId || !['approved', 'in_transit', 'completed'].includes(booking.status)) throw new Error('งานนี้ไม่ได้มอบหมายให้คนขับที่เลือก กรุณาตรวจสอบงานล่าสุด')
    const current = driverStage(booking)
    if (current !== expected || current === 'delivered') throw new Error('สถานะงานเปลี่ยนแล้ว กรุณาปิดหน้าต่างและตรวจสอบสถานะล่าสุด')
    const activeJob = state.bookings.find(b => b.id !== id && b.driverId === driverId && b.status === 'in_transit')
    if (current === 'assigned' && activeJob) throw new Error(`กรุณาจบงาน ${activeJob.id} ก่อนเริ่มงานใหม่`)
    const next = driverStages[driverStages.indexOf(current) + 1]
    const events = [...(booking.driverProgress?.events || []), { stage: next, at: new Date().toISOString() }]
    return { ...state, bookings: state.bookings.map(b => b.id === id ? { ...b, status: next === 'delivered' ? 'completed' : 'in_transit', driverProgress: { stage: next, events } } : b) }
  })
}
