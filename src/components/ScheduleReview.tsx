import { useState } from 'react'
import { Link } from 'react-router'
import type { Booking, DemoState } from '../data/seed'
import { demoStore } from '../services/demoStore'
import { checkAssignment, dispatchTime, estimateParkingTravel, makeDemoSchedule } from '../services/dispatch'
import { BookingButton, BookingModal } from './BookingUI'

export function RecalculationPending({ state }: { state: DemoState }) {
  const [open, setOpen] = useState(false)
  const waiting = state.bookings.filter(b => b.scheduleReview && b.status === 'approved')
  if (!waiting.length) return null
  return <><section className="schedule-review-banner"><div><strong>รอตรวจสอบตาราง {waiting.length} งาน</strong><p>ตำแหน่งศูนย์หรือพื้นที่บริการเปลี่ยน · ตารางเดิมยังมีผล</p></div><button type="button" onClick={() => setOpen(true)}>ดูรายการที่ได้รับผลกระทบ</button></section>{open && <BookingModal title="รอการยืนยันตารางที่คำนวณใหม่" className="schedule-review-modal" onClose={() => setOpen(false)}><p className="booking-small">การตั้งค่าศูนย์รถและพื้นที่บริการ</p><section className="schedule-review-detail"><h3>ตารางปัจจุบัน</h3><p>ยังคงมีผลจนกว่าเจ้าหน้าที่จัดรถจะยืนยัน</p></section><section className="schedule-review-detail"><h3>งานที่ต้องตรวจสอบ</h3>{waiting.map(b => <p key={b.id}>{b.id} · รับ {dispatchTime(b.schedule!.pickupAt)} น.</p>)}</section><section className="schedule-review-detail"><h3>ตารางที่เสนอใหม่</h3><p>ตรวจสอบเวลาเดินทางจากศูนย์และพื้นที่บริการใหม่</p></section><section className="schedule-review-detail"><h3>หากตรวจสอบไม่ผ่าน</h3><p>คงตารางเดิมและกลับไปแก้ไข</p></section><Link className="booking-button" to="/dispatcher/assignment">ไปตรวจสอบตารางกับเจ้าหน้าที่จัดรถ</Link><BookingButton secondary onClick={() => setOpen(false)}>กลับไปการตั้งค่า</BookingButton></BookingModal>}</>
}

export function ScheduleReview({ state }: { state: DemoState }) {
  const [selected, setSelected] = useState<Booking | null>(null)
  const [center, setCenter] = useState('30')
  const [hospital, setHospital] = useState('35')
  const [error, setError] = useState('')
  const waiting = state.bookings.filter(b => b.scheduleReview && b.status === 'approved' && b.schedule)
  function open(booking: Booking) { setSelected(booking); setCenter(String(estimateParkingTravel(state.settings?.parking, booking.details?.pickup) ?? booking.schedule!.centerToPickupMinutes)); setHospital(String(booking.schedule!.pickupToHospitalMinutes)); setError('') }
  function confirm() {
    try {
      demoStore.update(latest => {
        const booking = latest.bookings.find(b => b.id === selected?.id)
        if (!booking || booking.status !== 'approved' || !booking.scheduleReview || booking.scheduleReview.requestedAt !== selected?.scheduleReview?.requestedAt) throw new Error('งานหรือการตั้งค่าเปลี่ยนแล้ว กรุณาเปิดรายการใหม่')
        if (!center.trim() || !hospital.trim()) throw new Error('กรุณากรอกเวลาเดินทางทั้งสองช่วง')
        const schedule = makeDemoSchedule(booking, Number(center), Number(hospital))
        const check = checkAssignment(latest, { ...booking, schedule: undefined, assignedAt: undefined }, booking.vehicleId || '', booking.driverId || '', schedule)
        if (!check.ready) throw new Error([...check.issues, ...check.conflicts.map(c => `ตารางชนกับ ${c.booking.id}`)].join(' · '))
        return { ...latest, bookings: latest.bookings.map(b => b.id === booking.id ? { ...b, schedule, scheduleReview: undefined } : b) }
      })
      setSelected(null)
    } catch(e) { setError((e as Error).message) }
  }
  return <>{!!waiting.length && <section className="schedule-review-banner"><div><strong>ตรวจสอบตารางหลังเปลี่ยนการตั้งค่า</strong><p>ตารางเดิมยังมีผลจนกว่าจะยืนยัน</p></div>{waiting.map(b => <button type="button" key={b.id} onClick={() => open(b)}>ตรวจสอบ {b.id}</button>)}</section>}{selected && <BookingModal title="ตรวจสอบและยืนยันตารางใหม่" className="schedule-review-modal" onClose={() => setSelected(null)}><p>{selected.id} · {state.vehicles.find(v => v.id === selected.vehicleId)?.label} · {state.drivers.find(d => d.id === selected.driverId)?.name}</p><section className="schedule-review-detail"><h3>ตารางปัจจุบัน</h3><p>ออกศูนย์ {dispatchTime(selected.schedule!.departureAt)} · รับ {dispatchTime(selected.schedule!.pickupAt)} · ถึง รพ. {dispatchTime(selected.schedule!.arrivalAt)}</p></section><p className="booking-info">ระบุเวลาเดินทางโดยประมาณหลังตรวจสอบการตั้งค่า</p><label className="booking-field">ศูนย์ → จุดรับ (นาที)<input type="number" min="0" step="1" value={center} onChange={e => setCenter(e.target.value)} /></label><label className="booking-field">จุดรับ → โรงพยาบาล (นาที)<input type="number" min="0" step="1" value={hospital} onChange={e => setHospital(e.target.value)} /></label><p className="booking-small">ถึงก่อนนัด 20 นาที · ตรวจสอบรถและคนขับซ้ำก่อนบันทึก</p>{error && <p role="alert" className="booking-error-box">{error}</p>}<BookingButton onClick={confirm}>ตรวจสอบและยืนยันตารางใหม่</BookingButton><BookingButton secondary onClick={() => setSelected(null)}>เก็บตารางเดิมไว้</BookingButton></BookingModal>}</>
}
