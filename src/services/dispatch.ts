import type { Booking, DemoSchedule, DemoState } from '../data/seed'
import { LEAD_TIME_MS } from './booking'
import { demoStore } from './demoStore'
import { driverAvailable } from './resources'

export const PREPARATION_MINUTES = 20 as const
// Editable demo estimates taken from D-02's example, never routing estimates.
export const DEFAULT_DEMO_TRAVEL = { centerToPickupMinutes: 30, pickupToHospitalMinutes: 35 }
export function initializeDispatcherResources() {
  if (demoStore.getState().dispatcherResourcesInitialized) return
  demoStore.update(state => ({
    ...state,
    vehicles: state.vehicles.length ? state.vehicles : [1, 2, 3].map(n => ({ id: `demo-vehicle-${n}`, label: `รถคันที่ 0${n}`, active: true })),
    drivers: state.drivers.length ? state.drivers : ['A', 'B', 'C'].map(name => ({ id: `demo-driver-${name}`, name: `คนขับ ${name}`, active: true })),
    dispatcherResourcesInitialized: true,
  }))
}
export function bookingReviewIssue(booking: Booking, now = Date.now()): string | null {
  if (!booking.details?.acknowledged || !booking.details.pickup) return 'ข้อมูลคำขอหรือจุดรับไม่ครบ กรุณาตรวจสอบคำขอ'
  const createdAt = Date.parse(booking.createdAt || '')
  const appointmentAt = Date.parse(booking.appointmentAt)
  if (!Number.isFinite(createdAt)) return 'ไม่พบเวลาส่งคำขอ จึงตรวจสอบเงื่อนไขจองล่วงหน้าไม่ได้'
  if (appointmentAt - createdAt < LEAD_TIME_MS) return 'คำขอไม่ผ่านเงื่อนไขจองล่วงหน้าอย่างน้อย 48 ชั่วโมงนับจากเวลาส่งคำขอ'
  if (appointmentAt <= now) return 'เลยเวลานัดหมายแล้ว กรุณาตรวจสอบคำขอ'
  return null
}
export function makeDemoSchedule(booking: Booking, centerToPickupMinutes: number, pickupToHospitalMinutes: number): DemoSchedule {
  if (![centerToPickupMinutes, pickupToHospitalMinutes].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('กรุณากรอกเวลาเดินทางเป็นจำนวนนาทีเต็มตั้งแต่ 0 ขึ้นไป')
  const appointment = Date.parse(booking.appointmentAt)
  const arrival = appointment - PREPARATION_MINUTES * 60000
  const pickup = arrival - pickupToHospitalMinutes * 60000
  const departure = pickup - centerToPickupMinutes * 60000
  if (![appointment, arrival, pickup, departure].every(n => Number.isFinite(n) && Math.abs(n) <= 8640000000000000)) throw new Error('เวลาเดินทางอยู่นอกช่วงที่รองรับ')
  return { departureAt: new Date(departure).toISOString(), pickupAt: new Date(pickup).toISOString(), arrivalAt: new Date(arrival).toISOString(), endsAt: booking.appointmentAt, centerToPickupMinutes, pickupToHospitalMinutes, preparationMinutes: PREPARATION_MINUTES, calculation: 'demo-manual-v1' }
}
export interface AssignmentCheck { issues: string[]; conflicts: { booking: Booking; vehicle: boolean; driver: boolean }[]; ready: boolean }
export function checkAssignment(state: DemoState, booking: Booking, vehicleId: string, driverId: string, schedule: DemoSchedule, now = Date.now()): AssignmentCheck {
  const issues: string[] = []
  if (booking.status !== 'approved' || booking.schedule || booking.assignedAt) issues.push('งานนี้ไม่ได้อยู่ในสถานะรอจัดตาราง กรุณาโหลดข้อมูลล่าสุด')
  const reviewIssue = bookingReviewIssue(booking, now)
  if (reviewIssue) issues.push(reviewIssue)
  if (!state.vehicles.find(v => v.id === vehicleId)?.active) issues.push('รถรับส่งไม่พร้อมใช้งาน กรุณาเลือกรถที่พร้อม')
  if (!driverAvailable(state, state.drivers.find(d => d.id === driverId))) issues.push('คนขับไม่พร้อมใช้งาน กรุณาเลือกคนขับที่พร้อม')
  const start = Date.parse(schedule.departureAt)
  const end = Date.parse(schedule.endsAt)
  const conflicts: AssignmentCheck['conflicts'] = []
  for (const other of state.bookings) {
    if (other.id === booking.id || !['approved', 'in_transit'].includes(other.status)) continue
    const vehicle = !!vehicleId && other.vehicleId === vehicleId
    const driver = !!driverId && other.driverId === driverId
    if (!vehicle && !driver) continue
    if (!other.schedule) {
      issues.push(`${other.id}: ไม่พบช่วงเวลาของทรัพยากรที่ถูกมอบหมาย จึงยืนยันความพร้อมไม่ได้`)
      continue
    }
    if (start < Date.parse(other.schedule.endsAt) && Date.parse(other.schedule.departureAt) < end) conflicts.push({ booking: other, vehicle, driver })
  }
  return { issues, conflicts, ready: issues.length === 0 && conflicts.length === 0 }
}
export function reviewBooking(id: string, decision: 'approved' | 'rejected', reason = '') {
  demoStore.update(state => {
    const booking = state.bookings.find(b => b.id === id)
    if (!booking || booking.status !== 'pending') throw new Error('คำขอนี้ถูกดำเนินการแล้ว กรุณาตรวจสอบสถานะล่าสุด')
    if (decision === 'approved') {
      const issue = bookingReviewIssue(booking)
      if (issue) throw new Error(issue)
    } else if (!reason.trim()) throw new Error('กรุณาระบุเหตุผลการปฏิเสธคำขอ')
    return { ...state, bookings: state.bookings.map(b => b.id === id ? { ...b, status: decision, reviewedAt: new Date().toISOString(), rejectionReason: decision === 'rejected' ? reason.trim() : undefined } : b) }
  })
}
export function assignBooking(id: string, vehicleId: string, driverId: string, centerMinutes: number, hospitalMinutes: number) {
  demoStore.update(state => {
    const booking = state.bookings.find(b => b.id === id)
    if (!booking) throw new Error('ไม่พบคำขอนี้แล้ว')
    const schedule = makeDemoSchedule(booking, centerMinutes, hospitalMinutes)
    const check = checkAssignment(state, booking, vehicleId, driverId, schedule)
    if (!check.ready) throw new Error([...check.issues, ...check.conflicts.map(c => `ตารางเวลาซ้อนกันกับ ${c.booking.id}: ${[c.vehicle ? 'รถ' : '', c.driver ? 'คนขับ' : ''].filter(Boolean).join(' / ')}`)].join(' · '))
    return { ...state, bookings: state.bookings.map(b => b.id === id ? { ...b, vehicleId, driverId, schedule, assignedAt: new Date().toISOString() } : b) }
  })
}
export const dispatchTime = (iso: string) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
export const dispatchDate = (iso: string) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
export function dispatchStatus(booking: Booking) {
  if (booking.status === 'pending') return 'รอตรวจสอบ'
  if (booking.status === 'approved') return booking.schedule ? 'มอบหมายแล้ว' : 'รอจัดตาราง'
  return { rejected: 'ไม่อนุมัติ', in_transit: 'กำลังเดินทาง', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิกแล้ว' }[booking.status]
}
