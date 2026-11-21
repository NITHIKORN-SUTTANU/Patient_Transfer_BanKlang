import type { Booking, BookingStatus, Driver, DriverProgress, DriverStage, Vehicle } from './seed.ts'

export interface BanKlangVillageSeed {
  id: string
  number: number
  name: string
  latitude: number
  longitude: number
}

export interface HospitalSeed {
  id: string
  name: string
  latitude: number
  longitude: number
  travelMinutes: number
}

export const BAN_KLANG_DEPOT = {
  id: 'depot-banklang',
  name: 'ศูนย์รถเทศบาลตำบลบ้านกลาง',
  latitude: 18.5835,
  longitude: 99.0422,
} as const

export const BAN_KLANG_VILLAGES: BanKlangVillageSeed[] = [
  { id: 'village-01', number: 1, name: 'บ้านกลาง', latitude: 18.5795, longitude: 99.0435 },
  { id: 'village-02', number: 2, name: 'บ้านท่าล้อ', latitude: 18.5842, longitude: 99.0352 },
  { id: 'village-03', number: 3, name: 'บ้านพญาผาบ', latitude: 18.5758, longitude: 99.0510 },
  { id: 'village-04', number: 4, name: 'บ้านสันป่ายางหน่อม', latitude: 18.5890, longitude: 99.0468 },
  { id: 'village-05', number: 5, name: 'บ้านศรีชุม', latitude: 18.5934, longitude: 99.0385 },
  { id: 'village-06', number: 6, name: 'บ้านฮ่องกอม่วง', latitude: 18.5978, longitude: 99.0492 },
  { id: 'village-07', number: 7, name: 'บ้านแม่ตีบ', latitude: 18.5812, longitude: 99.0604 },
  { id: 'village-08', number: 8, name: 'บ้านดอยคำ', latitude: 18.5695, longitude: 99.0568 },
  { id: 'village-09', number: 9, name: 'บ้านสันป่าสัก', latitude: 18.5712, longitude: 99.0378 },
  { id: 'village-10', number: 10, name: 'บ้านขี้เหล็ก', latitude: 18.5865, longitude: 99.0275 },
  { id: 'village-11', number: 11, name: 'บ้านแม่สารป่าขาม', latitude: 18.6015, longitude: 99.0342 },
  { id: 'village-12', number: 12, name: 'บ้านใหม่สันป่ายาง', latitude: 18.5920, longitude: 99.0562 },
]

export const SUPPORTED_HOSPITALS: HospitalSeed[] = [
  { id: 'hospital-lamphun', name: 'โรงพยาบาลลำพูน', latitude: 18.5778, longitude: 99.0086, travelMinutes: 25 },
  { id: 'hospital-hariphunchai', name: 'โรงพยาบาลหริภุญชัย เมโมเรียล', latitude: 18.5904, longitude: 99.0290, travelMinutes: 15 },
  { id: 'hospital-pasang', name: 'โรงพยาบาลป่าซาง', latitude: 18.5284, longitude: 98.9403, travelMinutes: 30 },
  { id: 'hospital-saraphi', name: 'โรงพยาบาลสารภี', latitude: 18.7126, longitude: 99.0365, travelMinutes: 35 },
  { id: 'hospital-suandok', name: 'โรงพยาบาลมหาราชนครเชียงใหม่', latitude: 18.7897, longitude: 98.9742, travelMinutes: 50 },
]

export const SEED_VEHICLES: Vehicle[] = [
  { id: 'demo-vehicle-1', label: 'รถคันที่ 01 · กข 1101', active: true, vehicleType: 'รถตู้พยาบาลฉุกเฉิน', support: 'เดินได้ / รถเข็น / เปลนอน' },
  { id: 'demo-vehicle-2', label: 'รถคันที่ 02 · กข 1102', active: true, vehicleType: 'รถตู้ลิฟต์ยกวีลแชร์', support: 'เดินได้ / รถเข็น' },
  { id: 'demo-vehicle-3', label: 'รถคันที่ 03 · กข 1103', active: true, vehicleType: 'รถกระบะดัดแปลงหลังคาสูง', support: 'เดินได้ / รถเข็น' },
  { id: 'demo-vehicle-4', label: 'รถคันที่ 04 · กข 1104', active: true, vehicleType: 'รถพยาบาลพร้อมเตียง', support: 'เดินได้ / รถเข็น / เปลนอน' },
  { id: 'demo-vehicle-5', label: 'รถคันที่ 05 · กข 1105', active: true, vehicleType: 'รถยนต์อเนกประสงค์', support: 'เดินได้' },
]

export const SEED_DRIVERS: Driver[] = [
  { id: 'demo-driver-A', name: 'นายสมชาย ใจดี (คนขับ A)', active: true, accountId: 'USR-DRV-1', phone: '0812345601' },
  { id: 'demo-driver-B', name: 'นายประสิทธิ์ ขยันงาน (คนขับ B)', active: true, accountId: 'USR-DRV-2', phone: '0812345602' },
  { id: 'demo-driver-C', name: 'นายวิชัย รักถิ่น (คนขับ C)', active: true, accountId: 'USR-DRV-3', phone: '0812345603' },
  { id: 'demo-driver-D', name: 'นายอนุชา สุขสันต์ (คนขับ D)', active: true, accountId: 'USR-DRV-4', phone: '0812345604' },
  { id: 'demo-driver-E', name: 'นายธนากร มั่นคง (คนขับ E)', active: true, accountId: 'USR-DRV-5', phone: '0812345605' },
]

const FIRST_NAMES = [
  'สมศรี', 'บุญมี', 'คำปัน', 'จันทร์ดี', 'ประเสริฐ', 'สุวรรณ', 'คำแก้ว', 'ทองดี',
  'อำนวย', 'ศรีนวล', 'บัวผัน', 'แสงจันทร์', 'สมบูรณ์', 'มานะ', 'กัลยา', 'นงลักษณ์',
  'สุรชัย', 'สมปอง', 'บุญยืน', 'สายฝน', 'สมจิต', 'พิมพา', 'อุดม', 'วันเพ็ญ',
]

const LAST_NAMES = [
  'วงศ์คำ', 'ศรีบุญเรือง', 'ปัญญา', 'แก้วมูล', 'อินต๊ะ', 'ชัยชนะ', 'เจริญสุข', 'มูลคำ',
  'สุริยะ', 'จันทร์ตา', 'คำแสน', 'ไชยวงศ์', 'ยอดคำ', 'สุทธะ', 'ปันแก้ว', 'บุญมา',
]

const CAREGIVER_NAMES = [
  'กนกวรรณ วงศ์คำ', 'ณัฐพล ศรีบุญเรือง', 'ปวีณา ปัญญา', 'ธวัชชัย แก้วมูล',
  'ศิริพร อินต๊ะ', 'เกียรติศักดิ์ ชัยชนะ', 'รุ่งนภา เจริญสุข', 'อรุณี มูลคำ',
]

const REJECTION_REASONS = [
  'รถรับส่งทุกคันและคนขับติดภารกิจช่วงเวลาเดียวกันเต็มหมดแล้ว',
  'ขออภัย รถรองรับเปลนอนอยู่ระหว่างซ่อมบำรุงในวันดังกล่าว',
  'จุดรับอยู่นอกเขตบริการ 12 หมู่บ้านเทศบาลตำบลบ้านกลาง',
]

const CANCELLATION_REASONS = [
  'ผู้ป่วยเลื่อนนัดกับทางโรงพยาบาล',
  'ญาติสามารถพาส่งโรงพยาบาลเองได้แล้ว',
  'ติดต่อผู้ป่วย ณ จุดรับไม่สำเร็จ (Failed Pickup)',
]

// All 8 primary lifecycle states + CANCELLED + REJECTED
export type SeedApiStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'ASSIGNED'
  | 'PICKING_UP'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED'

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mapApiToDemoStatus(apiStatus: SeedApiStatus): BookingStatus {
  if (apiStatus === 'REQUESTED') return 'pending'
  if (apiStatus === 'REJECTED') return 'rejected'
  if (apiStatus === 'COMPLETED') return 'completed'
  if (apiStatus === 'CANCELLED') return 'cancelled'
  if (apiStatus === 'PICKING_UP' || apiStatus === 'PICKED_UP' || apiStatus === 'IN_TRANSIT') return 'in_transit'
  return 'approved'
}

function mapApiToDriverProgress(apiStatus: SeedApiStatus, departureMs: number, pickupMs: number, arrivalMs: number): DriverProgress | undefined {
  if (apiStatus === 'ASSIGNED') {
    return { stage: 'assigned', events: [] }
  }
  const events: { stage: DriverStage; at: string }[] = []
  if (['PICKING_UP', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED'].includes(apiStatus)) {
    events.push({ stage: 'going_to_pickup', at: new Date(departureMs).toISOString() })
  }
  if (['PICKED_UP', 'IN_TRANSIT', 'COMPLETED'].includes(apiStatus)) {
    events.push({ stage: 'patient_onboard', at: new Date(pickupMs).toISOString() })
  }
  if (['IN_TRANSIT', 'COMPLETED'].includes(apiStatus)) {
    events.push({ stage: 'going_to_hospital', at: new Date(pickupMs + 5 * 60000).toISOString() })
  }
  if (apiStatus === 'COMPLETED') {
    events.push({ stage: 'delivered', at: new Date(arrivalMs).toISOString() })
  }
  const stage = events.at(-1)?.stage
  return stage ? { stage, events } : undefined
}

function formatBangkokDate(ms: number): string {
  const shifted = new Date(ms + 7 * 3600000).toISOString()
  return shifted.slice(0, 10)
}

function formatBangkokClock(ms: number): string {
  const shifted = new Date(ms + 7 * 3600000).toISOString()
  return shifted.slice(11, 16)
}

export function buildDemoScheduleFromAppt(appointmentIso: string, centerMinutes: number, hospitalMinutes: number) {
  const appointmentMs = Date.parse(appointmentIso)
  const arrivalMs = appointmentMs - 20 * 60000
  const pickupMs = arrivalMs - hospitalMinutes * 60000
  const departureMs = pickupMs - centerMinutes * 60000
  return {
    departureAt: new Date(departureMs).toISOString(),
    pickupAt: new Date(pickupMs).toISOString(),
    arrivalAt: new Date(arrivalMs).toISOString(),
    endsAt: new Date(appointmentMs).toISOString(),
    centerToPickupMinutes: centerMinutes,
    pickupToHospitalMinutes: hospitalMinutes,
    preparationMinutes: 20 as const,
    calculation: 'demo-manual-v1' as const,
  }
}

export function generateRealisticSeedBookings(count = 320, anchorDate = '2026-11-22'): Booking[] {
  const rand = mulberry32(20261122)
  const anchorMs = Date.parse(`${anchorDate}T09:00:00+07:00`)
  const bookings: Booking[] = []

  // Peak morning hours weighted heavier (07:30-10:30), plus afternoon clinic slots (13:00-15:00)
  const peakSlots = ['07:30', '08:00', '08:30', '09:00', '09:00', '09:30', '10:00', '10:30', '11:00', '13:00', '13:30', '14:00', '14:30', '15:00']
  const assistanceOptions = ['เดินได้', 'เดินได้', 'เดินได้', 'รถเข็น', 'รถเข็น', 'เปลนอน'] as const
  const activeStates: SeedApiStatus[] = ['REQUESTED', 'APPROVED', 'SCHEDULED', 'ASSIGNED', 'PICKING_UP', 'PICKED_UP', 'IN_TRANSIT']

  // Village weighting across all 12 villages so every village has realistic demand (18-38 cases each)
  const villageWeights = [12, 10, 8, 9, 11, 7, 6, 6, 8, 9, 7, 7]
  const villagePool: number[] = []
  villageWeights.forEach((w, idx) => {
    for (let i = 0; i < w; i++) villagePool.push(idx)
  })

  for (let i = 0; i < count; i++) {
    const idNum = 1001 + i
    const id = `BK-SEED-${idNum}`
    const villageIdx = i < 12 ? i : villagePool[Math.floor(rand() * villagePool.length)]
    const village = BAN_KLANG_VILLAGES[villageIdx]
    const hospital = SUPPORTED_HOSPITALS[Math.floor(rand() * SUPPORTED_HOSPITALS.length)]
    const assistance = i < 12
      ? assistanceOptions[i % assistanceOptions.length]
      : assistanceOptions[Math.floor(rand() * assistanceOptions.length)]

    // First 36 records are spread around anchorDate (-1 day to +6 days) including multi-trip & peak overlaps
    // Remaining 284 records span 18 months backwards (-540 days to -2 days)
    let dayOffset: number
    let slotTime: string
    if (i < 10) {
      // Today / active operations on anchorDate (all 8 states visible immediately!)
      dayOffset = 0
      slotTime = ['08:00', '08:30', '09:00', '09:00', '09:30', '10:00', '11:00', '13:30', '13:30', '14:30'][i]
    } else if (i < 36) {
      // Upcoming +3 to +7 days (48h+ valid requests, multi-trip peak hours, overlaps)
      dayOffset = 3 + (i % 5)
      slotTime = i % 4 === 0 ? '09:00' : i % 4 === 1 ? '09:30' : peakSlots[Math.floor(rand() * peakSlots.length)]
    } else {
      // Historical 18 months (-540 to -1 days)
      const monthBucket = Math.floor(((i - 36) / (count - 36)) * 540)
      dayOffset = -(1 + monthBucket + Math.floor(rand() * 3))
      slotTime = peakSlots[Math.floor(rand() * peakSlots.length)]
    }

    const apptDayStr = formatBangkokDate(anchorMs + dayOffset * 86400000)
    const appointmentAt = new Date(`${apptDayStr}T${slotTime}:00+07:00`).toISOString()
    const appointmentMs = Date.parse(appointmentAt)
    const leadHours = 50 + Math.floor(rand() * 120)
    const latestAllowedCreatedMs = Math.min(anchorMs, Date.now()) - (i + 1) * 60000
    const createdAt = new Date(Math.min(appointmentMs - leadHours * 3600000, latestAllowedCreatedMs)).toISOString()

    // Choose realistic lifecycle status
    let apiStatus: SeedApiStatus
    if (i < 10) {
      // Guarantee every one of the 8 lifecycle states + CANCELLED + REJECTED appears on anchorDate
      const guaranteed: SeedApiStatus[] = [
        'REQUESTED', 'APPROVED', 'SCHEDULED', 'ASSIGNED',
        'PICKING_UP', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED',
        'CANCELLED', 'REJECTED',
      ]
      apiStatus = guaranteed[i]
    } else if (dayOffset >= 3) {
      const r = rand()
      apiStatus = r < 0.35 ? 'REQUESTED' : r < 0.55 ? 'APPROVED' : r < 0.72 ? 'SCHEDULED' : r < 0.90 ? 'ASSIGNED' : r < 0.95 ? 'CANCELLED' : 'REJECTED'
    } else {
      const r = rand()
      if (r < 0.76) apiStatus = 'COMPLETED'
      else if (r < 0.88) apiStatus = 'CANCELLED'
      else if (r < 0.96) apiStatus = 'REJECTED'
      else apiStatus = activeStates[Math.floor(rand() * activeStates.length)]
    }

    const status = mapApiToDemoStatus(apiStatus)
    const firstName = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)]
    const lastName = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)]
    const patientName = `${firstName} ${lastName}`
    const bookingFor = rand() < 0.55 ? 'other' : 'self'
    const contactName = bookingFor === 'other' ? CAREGIVER_NAMES[Math.floor(rand() * CAREGIVER_NAMES.length)] : patientName
    const phone = `08${String(10000000 + ((i * 7919) % 89999999)).padStart(8, '0')}`
    const latOffset = (rand() - 0.5) * 0.0045
    const lngOffset = (rand() - 0.5) * 0.0045
    const latitude = Number((village.latitude + latOffset).toFixed(6))
    const longitude = Number((village.longitude + lngOffset).toFixed(6))
    const centerMinutes = 12 + Math.floor(rand() * 14) // 12–25 min deadhead
    const hospitalMinutes = hospital.travelMinutes

    const compatibleVehicles = SEED_VEHICLES.filter(v => {
      if (assistance === 'เปลนอน') return v.support?.includes('เปลนอน')
      if (assistance === 'รถเข็น') return v.support?.includes('รถเข็น')
      return true
    })
    const vehicleIdx = i % compatibleVehicles.length
    const assignedVehicle = compatibleVehicles[vehicleIdx]
    const assignedDriver = SEED_DRIVERS[SEED_VEHICLES.findIndex(v => v.id === assignedVehicle.id) % SEED_DRIVERS.length]

    const hasAssignedSchedule = ['SCHEDULED', 'ASSIGNED', 'PICKING_UP', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED'].includes(apiStatus)
      || (apiStatus === 'CANCELLED' && rand() < 0.5)

    const schedule = hasAssignedSchedule
      ? buildDemoScheduleFromAppt(appointmentAt, centerMinutes, hospitalMinutes)
      : undefined

    const driverProgress = schedule
      ? mapApiToDriverProgress(
          apiStatus,
          Date.parse(schedule.departureAt),
          Date.parse(schedule.pickupAt),
          Date.parse(schedule.arrivalAt),
        )
      : undefined

    const extras: string[] = []
    if (assistance !== 'เดินได้' || rand() < 0.4) extras.push('ต้องการผู้ช่วยพยุงขึ้น-ลงรถ')
    if (bookingFor === 'other' && rand() < 0.7) extras.push('มีผู้ดูแลเดินทางไปด้วย')

    const booking: Booking = {
      id,
      reference: id,
      patientName,
      appointmentAt,
      status,
      apiStatus,
      createdAt,
      revision: 1,
      executionVersion: driverProgress ? 1 : 0,
      ...(status !== 'pending' ? { reviewedAt: new Date(Date.parse(createdAt) + 4 * 3600000).toISOString() } : {}),
      ...(apiStatus === 'REJECTED' ? { rejectionReason: REJECTION_REASONS[i % REJECTION_REASONS.length] } : {}),
      ...(apiStatus === 'CANCELLED' ? {
        cancellation: {
          at: new Date(appointmentMs - 12 * 3600000).toISOString(),
          by: i % 3 === 0 ? 'driver' : 'citizen',
          reason: CANCELLATION_REASONS[i % CANCELLATION_REASONS.length],
        },
      } : {}),
      ...(schedule ? {
        vehicleId: assignedVehicle.id,
        driverId: assignedDriver.id,
        vehicleName: assignedVehicle.label,
        originName: BAN_KLANG_DEPOT.name,
        assignedAt: new Date(Date.parse(createdAt) + 6 * 3600000).toISOString(),
        schedule,
      } : {}),
      ...(driverProgress ? { driverProgress } : {}),
      ...(apiStatus === 'PICKING_UP' || apiStatus === 'PICKED_UP' || apiStatus === 'IN_TRANSIT'
        ? { startedAt: schedule?.departureAt }
        : {}),
      details: {
        bookingFor,
        patientName,
        contactName: bookingFor === 'other' ? contactName : '',
        phone,
        relationship: bookingFor === 'other' ? ['บุตร', 'ญาติ', 'ผู้ดูแล'][i % 3] : '',
        hospital: hospital.name,
        date: apptDayStr,
        time: formatBangkokClock(appointmentMs),
        assistance,
        extras,
        villageId: village.id,
        pickupAddress: `บ้านเลขที่ ${10 + (i % 190)} หมู่ ${village.number} ${village.name} ต.บ้านกลาง อ.เมืองลำพูน`,
        landmark: `ใกล้ศาลาเอนกประสงค์${village.name}`,
        pickup: {
          x: 50,
          y: 50,
          latitude,
          longitude,
          label: `หมู่ ${village.number} ${village.name} ต.บ้านกลาง`,
        },
        acknowledged: true,
      },
    }

    bookings.push(booking)
  }

  return bookings
}
