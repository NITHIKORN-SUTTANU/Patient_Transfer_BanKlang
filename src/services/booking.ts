export interface BookingDetails {
  bookingFor: 'self' | 'other' | 'unknown'
  patientName: string
  contactName: string
  phone: string
  relationship: string
  hospital: string
  date: string
  time: string
  assistance: string
  extras: string[]
  pickup: { x: number; y: number; label: string; latitude?: number; longitude?: number; accuracy?: number } | null
  acknowledged: boolean
  villageId?: string
  pickupAddress?: string
  landmark?: string
  patientProfileId?: string
}
export const emptyBooking = (): BookingDetails => ({ bookingFor: 'self', patientName: '', contactName: '', phone: '', relationship: '', hospital: '', date: '', time: '', assistance: 'เดินได้', extras: [], pickup: null, acknowledged: false })
export const LEAD_TIME_MS = 48 * 60 * 60 * 1000
export const appointmentTimestamp = (date: string, time: string) => Date.parse(`${date}T${time}:00+07:00`)
export const meetsLeadTime = (date: string, time: string, now = Date.now()) => Number.isFinite(appointmentTimestamp(date, time)) && appointmentTimestamp(date, time) >= now + LEAD_TIME_MS
export function bangkokDate(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp)
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-')
}
export const thaiDate = (date: string, long = false) => date ? new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: long ? 'long' : 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00+07:00`)) : ''
export function validatePatient(d: BookingDetails, now = Date.now()) {
  const errors: Record<string, string> = {}
  if (!d.patientName.trim() || [...d.patientName.trim()].length > 120) errors.patientName = 'กรุณากรอกชื่อผู้ป่วย ไม่เกิน 120 ตัวอักษร'
  if (!/^0\d{9}$/.test(d.phone.replace(/[\s-]/g, '').replace(/^\+66/, '0'))) errors.phone = 'กรุณากรอกหมายเลขโทรศัพท์ให้ถูกต้อง (10 หลัก หรือ +66)'
  if (d.bookingFor === 'other') {
    if (!d.contactName.trim() || [...d.contactName.trim()].length > 120) errors.contactName = 'กรุณากรอกชื่อผู้ดูแล / ผู้ติดต่อ ไม่เกิน 120 ตัวอักษร'
    if (!d.relationship) errors.relationship = 'กรุณาเลือกความสัมพันธ์กับผู้ป่วย'
  }
  if (!d.hospital) errors.hospital = 'กรุณาเลือกโรงพยาบาล'
  if (!d.date) errors.date = 'กรุณาเลือกวันนัดหมาย'
  if (!d.time) errors.time = 'กรุณาเลือกเวลานัดหมาย'
  if (d.date && d.time && !meetsLeadTime(d.date, d.time, now)) errors.time = 'กรุณาจองล่วงหน้าอย่างน้อย 48 ชั่วโมง'
  return errors
}
export function validatePickup(d: BookingDetails) {
  const errors: Record<string, string> = {}
  if (!Number.isFinite(d.pickup?.latitude) || Math.abs(d.pickup!.latitude!) > 90 || !Number.isFinite(d.pickup?.longitude) || Math.abs(d.pickup!.longitude!) > 180) errors.pickup = 'กรุณาเลือกพิกัดจุดรับบนแผนที่ หรือระบุพิกัดด้วยตนเอง'
  if (!d.villageId) errors.villageId = 'กรุณาเลือกหมู่บ้านในเขตบริการ'
  if (!d.pickupAddress?.trim() || [...d.pickupAddress.trim()].length > 1000) errors.pickupAddress = 'กรุณากรอกที่อยู่จุดรับ ไม่เกิน 1,000 ตัวอักษร'
  if ([...(d.landmark ?? '').trim()].length > 1000) errors.landmark = 'จุดสังเกตต้องไม่เกิน 1,000 ตัวอักษร'
  if (!['เดินได้', 'รถเข็น', 'เปลนอน'].includes(d.assistance)) errors.assistance = 'กรุณาเลือกการช่วยเหลือ'
  return errors
}
