import {
  BAN_KLANG_DEPOT,
  BAN_KLANG_VILLAGES,
  SEED_DRIVERS,
  SEED_VEHICLES,
  SUPPORTED_HOSPITALS,
} from '../data/realisticSeed'
import type { Booking } from '../data/seed'
import {
  bangkokDateFromMs,
  checkCitizenSlotCapacity,
  computeBackwardBlockedWindow,
  parseVehicleCapabilities,
} from '../domain/capacity'
import { ApiError } from './apiError'
import type { AdminResource, AvailabilityWindow, StaffAccount } from './adminApi'
import type { CitizenBooking, PatientProfile } from './citizenApi'
import type { ApiBooking } from './dispatcherApi'
import { seedOverlay } from './seedOverlay'
import { bookingToApiBooking, mobilityCodeFromLabel } from '../utils/seedCsvImport'

const DB_KEY = 'ban-klang-transit:interactive-demo-db:v1'

interface DemoHospital {
  id: string
  name: string
  location_id: string
  latitude: number
  longitude: number
  active: boolean
  revision: number
}

interface DemoVillage {
  id: string
  number: number
  name: string
  latitude: number
  longitude: number
  shape: 'circle'
  radiusMetres: number
  active: boolean
  revision: number
}

interface DemoClosure {
  id: string
  date: string
  reason: string
  active: boolean
  revision: number
}

interface DemoAudit {
  id: string
  action: string
  entityType: string
  entityId?: string
  recordedAt: string
  actor: string | null
  reason?: string
  before?: unknown
  after?: unknown
}

interface DemoVerificationEntry {
  id: string
  outcome: string
  notes: string
  recordedAt: string
  actor: string
  correctsId: string | null
}

interface DemoDatabase {
  seq: number
  configurationRevision: number
  settings: {
    id: string
    name: string
    center: string
    latitude: number
    longitude: number
    opensAt: string
    closesAt: string
    revision: number
  }
  hospitals: DemoHospital[]
  villages: DemoVillage[]
  closures: DemoClosure[]
  accounts: StaffAccount[]
  vehicles: AdminResource[]
  drivers: AdminResource[]
  windows: AvailabilityWindow[]
  bookings: CitizenBooking[]
  profiles: PatientProfile[]
  auditEvents: DemoAudit[]
  verifications: Record<string, DemoVerificationEntry[]>
}

function isoOffsetDays(daysFromNow: number, clock: string): string {
  const bkkToday = bangkokDateFromMs(Date.now())
  const base = Date.parse(`${bkkToday}T12:00:00+07:00`)
  const targetDate = bangkokDateFromMs(base + daysFromNow * 24 * 3600_000)
  return new Date(`${targetDate}T${clock}:00+07:00`).toISOString()
}

function createInitialDemoDatabase(): DemoDatabase {
  const depotId = BAN_KLANG_DEPOT.id
  const hospitals: DemoHospital[] = SUPPORTED_HOSPITALS.map(h => ({
    id: h.id,
    name: h.name,
    location_id: h.id,
    latitude: h.latitude,
    longitude: h.longitude,
    active: true,
    revision: 1,
  }))

  const villages: DemoVillage[] = BAN_KLANG_VILLAGES.map(v => ({
    id: v.id,
    number: v.number,
    name: v.name,
    latitude: v.latitude,
    longitude: v.longitude,
    shape: 'circle',
    radiusMetres: 2500,
    active: true,
    revision: 1,
  }))

  const accounts: StaffAccount[] = [
    { id: 'USR-ADM-1', name: 'ผู้ดูแลระบบ (สาธิต)', username: 'admin', role: 'admin', active: true, revision: 1 },
    { id: 'USR-DSP-1', name: 'เจ้าหน้าที่จัดรถ (สาธิต)', username: 'dispatcher', role: 'dispatcher', active: true, revision: 1 },
    ...SEED_DRIVERS.map((d, idx) => ({
      id: d.accountId || `USR-DRV-${idx + 1}`,
      name: d.name,
      username: `driver${idx + 1}`,
      role: 'driver' as const,
      active: true,
      revision: 1,
    })),
  ]

  const vehicles: AdminResource[] = SEED_VEHICLES.map(v => {
    const [namePart, platePart] = v.label.split(' · ')
    return {
      id: v.id,
      name: namePart || v.label,
      plate: platePart || v.id,
      vehicleType: v.vehicleType || 'รถรับส่งผู้ป่วย',
      active: v.active,
      held: false,
      capabilities: parseVehicleCapabilities(v),
      revision: 1,
      locationId: depotId,
      availableAt: '2026-01-01T06:00:00+07:00',
    }
  })

  const drivers: AdminResource[] = SEED_DRIVERS.map((d, idx) => ({
    id: d.id,
    name: d.name,
    phone: d.phone || `081234560${idx + 1}`,
    accountId: d.accountId || `USR-DRV-${idx + 1}`,
    active: d.active,
    rosterActive: d.active,
    held: false,
    capabilities: ['standard', 'wheelchair', 'stretcher'],
    revision: 1,
    locationId: depotId,
    availableAt: '2026-01-01T06:00:00+07:00',
  }))

  const windows: AvailabilityWindow[] = [
    ...vehicles.map((v, idx) => ({
      id: `win-veh-${idx + 1}`,
      vehicleId: v.id,
      driverId: null,
      startsAt: '2026-01-01T06:00:00+07:00',
      endsAt: '2028-12-31T16:00:00+07:00',
      revision: 1,
    })),
    ...drivers.map((d, idx) => ({
      id: `win-drv-${idx + 1}`,
      vehicleId: null,
      driverId: d.id,
      startsAt: '2026-01-01T06:00:00+07:00',
      endsAt: '2028-12-31T16:00:00+07:00',
      revision: 1,
    })),
  ]

  // Seed 4 initial realistic cases across lifecycle stages so every role sees live data immediately.
  const todayAssignedAppt = isoOffsetDays(0, '10:30')
  const todayAssignedWin = computeBackwardBlockedWindow(todayAssignedAppt, { hospitalName: SUPPORTED_HOSPITALS[0].name })!
  const pendingAppt = isoOffsetDays(3, '09:00')
  const approvedAppt = isoOffsetDays(4, '10:00')
  const completedAppt = isoOffsetDays(-2, '08:30')
  const completedWin = computeBackwardBlockedWindow(completedAppt, { hospitalName: SUPPORTED_HOSPITALS[1].name })!

  const initialBookings: CitizenBooking[] = [
    {
      id: 'BK-DEMO-1001',
      reference: 'BK-DEMO-1001',
      status: 'REQUESTED',
      revision: 1,
      executionVersion: 0,
      patientName: 'นางสมศรี วงศ์คำ',
      requesterName: 'นางสมศรี วงศ์คำ',
      contactPhone: '081-234-5671',
      bookingFor: 'self',
      villageId: 'village-01',
      hospitalId: SUPPORTED_HOSPITALS[0].id,
      hospitalName: SUPPORTED_HOSPITALS[0].name,
      hospitalLocationId: SUPPORTED_HOSPITALS[0].id,
      depotLocationId: depotId,
      pickupAddress: '45 หมู่ 1 บ้านกลาง ต.บ้านกลาง อ.เมืองลำพูน',
      latitude: BAN_KLANG_VILLAGES[0].latitude,
      longitude: BAN_KLANG_VILLAGES[0].longitude,
      landmark: 'ตรงข้ามวัดบ้านกลาง',
      mobility: 'wheelchair',
      assistance: ['boarding_support'],
      appointmentAt: pendingAppt,
      submittedAt: new Date(Date.now() - 3600_000).toISOString(),
      patientProfileId: null,
      vehicleId: null,
      driverId: null,
      startedAt: null,
      incidentOpen: false,
      resourceHold: false,
      scheduleReviewRequired: false,
      originName: BAN_KLANG_DEPOT.name,
      schedule: null,
      proposedSchedule: null,
    },
    {
      id: 'BK-DEMO-1002',
      reference: 'BK-DEMO-1002',
      status: 'APPROVED',
      revision: 2,
      executionVersion: 0,
      patientName: 'นายบุญมี ศรีบุญเรือง',
      requesterName: 'น.ส.กนกวรรณ ศรีบุญเรือง',
      contactPhone: '089-442-1122',
      bookingFor: 'other',
      villageId: 'village-04',
      hospitalId: SUPPORTED_HOSPITALS[1].id,
      hospitalName: SUPPORTED_HOSPITALS[1].name,
      hospitalLocationId: SUPPORTED_HOSPITALS[1].id,
      depotLocationId: depotId,
      pickupAddress: '112 หมู่ 4 บ้านสันป่ายางหน่อม ต.บ้านกลาง',
      latitude: BAN_KLANG_VILLAGES[3].latitude,
      longitude: BAN_KLANG_VILLAGES[3].longitude,
      landmark: 'ซอยข้างร้านค้าชุมชน',
      mobility: 'stretcher',
      assistance: ['boarding_support', 'caregiver_accompanies'],
      appointmentAt: approvedAppt,
      submittedAt: new Date(Date.now() - 7200_000).toISOString(),
      patientProfileId: null,
      vehicleId: null,
      driverId: null,
      startedAt: null,
      incidentOpen: false,
      resourceHold: false,
      scheduleReviewRequired: false,
      originName: BAN_KLANG_DEPOT.name,
      schedule: null,
      proposedSchedule: null,
    },
    {
      id: 'BK-DEMO-1003',
      reference: 'BK-DEMO-1003',
      status: 'ASSIGNED',
      revision: 3,
      executionVersion: 0,
      patientName: 'นายคำปัน ปัญญา',
      requesterName: 'นายคำปัน ปัญญา',
      contactPhone: '086-991-3344',
      bookingFor: 'self',
      villageId: 'village-02',
      hospitalId: SUPPORTED_HOSPITALS[0].id,
      hospitalName: SUPPORTED_HOSPITALS[0].name,
      hospitalLocationId: SUPPORTED_HOSPITALS[0].id,
      depotLocationId: depotId,
      pickupAddress: '78 หมู่ 2 บ้านท่าล้อ ต.บ้านกลาง',
      latitude: BAN_KLANG_VILLAGES[1].latitude,
      longitude: BAN_KLANG_VILLAGES[1].longitude,
      landmark: 'ใกล้ศาลาอเนกประสงค์หมู่ 2',
      mobility: 'standard',
      assistance: [],
      appointmentAt: todayAssignedAppt,
      submittedAt: new Date(Date.now() - 72 * 3600_000).toISOString(),
      patientProfileId: null,
      vehicleId: vehicles[0].id,
      driverId: drivers[0].id,
      vehicleName: `${vehicles[0].name} · ${vehicles[0].plate}`,
      startedAt: null,
      incidentOpen: false,
      resourceHold: false,
      scheduleReviewRequired: false,
      originName: BAN_KLANG_DEPOT.name,
      schedule: {
        departureAt: todayAssignedWin.departureAt,
        pickupAt: todayAssignedWin.pickupAt,
        arrivalAt: todayAssignedWin.arrivalAt,
        readyAt: todayAssignedWin.freeAt,
        pickupWaitingMinutes: 0,
        originLocationId: depotId,
        originKind: 'depot',
      },
      proposedSchedule: null,
    },
    {
      id: 'BK-DEMO-1004',
      reference: 'BK-DEMO-1004',
      status: 'COMPLETED',
      revision: 5,
      executionVersion: 5,
      patientName: 'นางจันทร์ดี แก้วมูล',
      requesterName: 'นางจันทร์ดี แก้วมูล',
      contactPhone: '084-772-5588',
      bookingFor: 'self',
      villageId: 'village-07',
      hospitalId: SUPPORTED_HOSPITALS[1].id,
      hospitalName: SUPPORTED_HOSPITALS[1].name,
      hospitalLocationId: SUPPORTED_HOSPITALS[1].id,
      depotLocationId: depotId,
      pickupAddress: '19 หมู่ 7 บ้านแม่ตีบ ต.บ้านกลาง',
      latitude: BAN_KLANG_VILLAGES[6].latitude,
      longitude: BAN_KLANG_VILLAGES[6].longitude,
      landmark: 'หน้าโรงเรียนบ้านแม่ตีบ',
      mobility: 'wheelchair',
      assistance: ['boarding_support'],
      appointmentAt: completedAppt,
      submittedAt: new Date(Date.now() - 120 * 3600_000).toISOString(),
      patientProfileId: null,
      vehicleId: vehicles[1].id,
      driverId: drivers[0].id,
      vehicleName: `${vehicles[1].name} · ${vehicles[1].plate}`,
      startedAt: completedWin.departureAt,
      incidentOpen: false,
      resourceHold: false,
      scheduleReviewRequired: false,
      originName: BAN_KLANG_DEPOT.name,
      schedule: {
        departureAt: completedWin.departureAt,
        pickupAt: completedWin.pickupAt,
        arrivalAt: completedWin.arrivalAt,
        readyAt: completedWin.freeAt,
        pickupWaitingMinutes: 0,
        originLocationId: depotId,
        originKind: 'depot',
      },
      proposedSchedule: null,
    },
  ]

  return {
    seq: 1005,
    configurationRevision: 1,
    settings: {
      id: depotId,
      name: BAN_KLANG_DEPOT.name,
      center: BAN_KLANG_DEPOT.name,
      latitude: BAN_KLANG_DEPOT.latitude,
      longitude: BAN_KLANG_DEPOT.longitude,
      opensAt: '06:00',
      closesAt: '16:00',
      revision: 1,
    },
    hospitals,
    villages,
    closures: [],
    accounts,
    vehicles,
    drivers,
    windows,
    bookings: initialBookings,
    profiles: [],
    auditEvents: [
      {
        id: 'AUD-DEMO-1',
        action: 'CREATE_RESOURCE',
        entityType: 'vehicles',
        entityId: vehicles[0].id,
        recordedAt: new Date(Date.now() - 86_400_000).toISOString(),
        actor: 'ผู้ดูแลระบบ (สาธิต)',
        reason: 'ตั้งค่าข้อมูลรถรับส่งเริ่มต้นเทศบาลตำบลบ้านกลาง 5 คัน',
      },
    ],
    verifications: {},
  }
}

function loadDb(): DemoDatabase {
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DemoDatabase>
      if (parsed && Array.isArray(parsed.vehicles) && Array.isArray(parsed.bookings) && Array.isArray(parsed.hospitals)) {
        return parsed as DemoDatabase
      }
    }
  } catch {
    // Fallback cleanly when localStorage is unavailable.
  }
  const initial = createInitialDemoDatabase()
  saveDb(initial)
  return initial
}

let inMemoryFallback: DemoDatabase | null = null

function readDb(): DemoDatabase {
  try {
    const db = loadDb()
    inMemoryFallback = db
    return db
  } catch {
    if (!inMemoryFallback) inMemoryFallback = createInitialDemoDatabase()
    return inMemoryFallback
  }
}

function saveDb(db: DemoDatabase) {
  inMemoryFallback = db
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db))
  } catch {
    // Keep in-memory state if storage quota exceeded.
  }
}

export function resetDemoApiBackend() {
  const fresh = createInitialDemoDatabase()
  saveDb(fresh)
  seedOverlay.reset()
}

function roleFromToken(token?: string): 'citizen' | 'dispatcher' | 'driver' | 'admin' {
  if (token === 'demo-token-admin') return 'admin'
  if (token === 'demo-token-dispatcher') return 'dispatcher'
  if (token === 'demo-token-driver') return 'driver'
  return 'citizen'
}

function recordAudit(db: DemoDatabase, entry: Omit<DemoAudit, 'id' | 'recordedAt'>) {
  db.auditEvents.unshift({
    id: `AUD-DEMO-${db.seq++}`,
    recordedAt: new Date().toISOString(),
    ...entry,
  })
  if (db.auditEvents.length > 200) db.auditEvents.length = 200
}

function toCitizenBookingFromSeed(b: Booking, db: DemoDatabase): CitizenBooking {
  const api = bookingToApiBooking(b)
  const village = db.villages.find(v => v.id === b.details?.villageId) ?? db.villages[0]
  const hospital = db.hospitals.find(h => h.name === b.details?.hospital || h.id === api.hospitalId) ?? db.hospitals[0]
  return {
    ...api,
    hospitalId: hospital.id,
    hospitalName: hospital.name,
    hospitalLocationId: hospital.location_id,
    depotLocationId: db.settings.id,
    requesterName: b.details?.contactName || b.patientName,
    villageId: village.id,
    patientProfileId: null,
    submittedAt: b.createdAt || new Date().toISOString(),
    rejectionReason: b.rejectionReason,
  }
}

function mergeWithOverlayBookings(db: DemoDatabase): CitizenBooking[] {
  const overlay = seedOverlay.getState()
  if (!overlay.active || overlay.bookings.length === 0) return db.bookings
  const existingIds = new Set(db.bookings.map(b => b.id))
  const extra = overlay.bookings
    .filter(b => !existingIds.has(b.id))
    .map(b => toCitizenBookingFromSeed(b, db))
  return [...db.bookings, ...extra]
}

function toCapacityInputs(rows: CitizenBooking[]) {
  return rows.map(b => ({
    id: b.id,
    appointmentAt: b.appointmentAt,
    status: b.status,
    mobility: b.mobility,
    hospitalId: b.hospitalId,
    hospitalName: b.hospitalName,
    vehicleId: b.vehicleId,
    schedule: b.schedule,
  }))
}

export async function handleDemoApiRequest<T>(
  rawPath: string,
  options: { token?: string; body?: unknown } = {},
): Promise<T> {
  const [pathname] = rawPath.split('?')
  const body = (options.body && typeof options.body === 'object' ? options.body : undefined) as Record<string, unknown> | undefined
  const isPost = options.body !== undefined
  const role = roleFromToken(options.token)
  const db = readDb()

  // --- Auth & Config ---
  if (pathname === '/config') {
    return {
      lineEnabled: true,
      liffId: 'demo-liff-banklang',
      noticeVersion: 'demo-v2.1',
      noticeText:
        'ประกาศความเป็นส่วนตัว (โหมดสาธิตเทศบาลตำบลบ้านกลาง): ข้อมูลชื่อผู้ป่วย เบอร์ติดต่อ จุดรับ และวันเวลานัดหมาย ใช้เพื่อการจัดรถรับ–ส่งผู้ป่วยตามนัดหมายเท่านั้น โดยไม่จัดเก็บประวัติการรักษา',
      contactPhone: '053-555-000',
    } as T
  }

  if (pathname === '/auth/line') {
    return { token: 'demo-token-citizen' } as T
  }

  if (pathname === '/auth/login') {
    const username = String(body?.username ?? '').toLowerCase()
    const mapped = username.includes('admin')
      ? 'admin'
      : username.includes('driver')
      ? 'driver'
      : 'dispatcher'
    return { token: `demo-token-${mapped}` } as T
  }

  if (pathname === '/auth/logout') {
    return { loggedOut: true } as T
  }

  if (pathname === '/auth/me') {
    if (role === 'citizen') {
      return { id: 'demo-citizen-1', role: 'citizen', name: 'ผู้ป่วย / ผู้ดูแล (โหมดสาธิต)' } as T
    }
    if (role === 'admin') {
      return { id: 'USR-ADM-1', role: 'admin', name: 'ผู้ดูแลระบบ (โหมดสาธิต)', driverId: null } as T
    }
    if (role === 'driver') {
      const firstDriver = db.drivers[0]
      return {
        id: firstDriver?.accountId || 'USR-DRV-1',
        role: 'driver',
        name: firstDriver?.name || 'นายสมชาย ใจดี (คนขับ A)',
        driverId: firstDriver?.id || 'demo-driver-A',
      } as T
    }
    return { id: 'USR-DSP-1', role: 'dispatcher', name: 'เจ้าหน้าที่จัดรถ (โหมดสาธิต)', driverId: null } as T
  }

  // --- Citizen Consents & Profiles ---
  if (pathname === '/consents' && isPost) {
    return {
      id: `demo-consent-${db.seq++}`,
      accepted: Boolean(body?.accepted),
      noticeVersion: String(body?.noticeVersion ?? 'demo-v2.1'),
    } as T
  }

  if (pathname === '/profiles' && !isPost) {
    return { profiles: db.profiles } as T
  }

  if ((pathname === '/profiles' || pathname.startsWith('/profiles/')) && isPost) {
    const existingId = pathname.startsWith('/profiles/') ? decodeURIComponent(pathname.slice('/profiles/'.length)) : null
    const id = existingId || `prof-demo-${db.seq++}`
    const profile: PatientProfile = {
      id,
      patientName: String(body?.patientName ?? ''),
      contactPhone: String(body?.contactPhone ?? ''),
      mobility: String(body?.mobility ?? 'standard'),
      villageId: String(body?.villageId ?? db.villages[0].id),
      pickupAddress: String(body?.pickupAddress ?? ''),
      latitude: Number(body?.latitude ?? BAN_KLANG_DEPOT.latitude),
      longitude: Number(body?.longitude ?? BAN_KLANG_DEPOT.longitude),
      assistance: Array.isArray(body?.assistance) ? (body.assistance as string[]) : [],
      landmark: String(body?.landmark ?? ''),
    }
    db.profiles = [...db.profiles.filter(p => p.id !== id), profile]
    saveDb(db)
    return profile as T
  }

  // --- Catalog ---
  if (pathname === '/catalog') {
    const activeHospitals = db.hospitals.filter(h => h.active)
    const activeVillages = db.villages.filter(v => v.active)
    const locations = [
      { id: db.settings.id, name: db.settings.name, kind: 'depot' },
      ...activeHospitals.map(h => ({ id: h.location_id, name: h.name, kind: 'hospital' })),
    ]

    if (role === 'citizen') {
      const allBookings = mergeWithOverlayBookings(db)
      const activeBookings = allBookings
        .filter(b => !['COMPLETED', 'CANCELLED', 'REJECTED', 'ABORTED'].includes(b.status))
        .map(b => ({
          id: b.id,
          appointmentAt: b.appointmentAt,
          hospitalId: b.hospitalId,
          hospitalName: b.hospitalName,
          mobility: b.mobility,
          status: b.status,
          vehicleId: b.vehicleId,
          schedule: b.schedule,
        }))
      return {
        hospitals: activeHospitals.map(h => ({ id: h.id, name: h.name, location_id: h.location_id })),
        villages: activeVillages.map(v => ({ id: v.id, number: v.number, name: v.name })),
        vehicles: db.vehicles.map(v => ({
          id: v.id,
          name: v.name,
          plate: v.plate,
          active: v.active,
          held: v.held,
          capabilities: v.capabilities,
        })),
        activeBookings,
      } as T
    }

    return {
      hospitals: activeHospitals.map(h => ({ id: h.id, name: h.name, location_id: h.location_id })),
      villages: activeVillages.map(v => ({ id: v.id, number: v.number, name: v.name })),
      vehicles: db.vehicles,
      drivers: db.drivers,
      locations,
      depotLocationId: db.settings.id,
      configurationRevision: db.configurationRevision,
      closures: db.closures.filter(c => c.active).map(c => ({ date: c.date, reason: c.reason })),
      settings: {
        center: db.settings.center,
        latitude: db.settings.latitude,
        longitude: db.settings.longitude,
        opensAt: db.settings.opensAt,
        closesAt: db.settings.closesAt,
      },
    } as T
  }

  // --- Bookings Collection & Creation ---
  if (pathname === '/bookings' && !isPost) {
    const allBookings = mergeWithOverlayBookings(db)
    if (role === 'driver') {
      const driverId = db.drivers[0]?.id || 'demo-driver-A'
      const driverJobs = allBookings.filter(
        b =>
          b.driverId === driverId &&
          !['REQUESTED', 'APPROVED', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'ABORTED'].includes(b.status),
      )
      return { bookings: driverJobs, nextCursor: null, hasMore: false } as T
    }
    return { bookings: allBookings, nextCursor: null, hasMore: false } as T
  }

  if (pathname === '/bookings' && isPost) {
    const appointmentAt = String(body?.appointmentAt ?? '')
    const hospitalId = String(body?.hospitalId ?? '')
    const hospital = db.hospitals.find(h => h.id === hospitalId) ?? db.hospitals[0]
    const allBookings = mergeWithOverlayBookings(db)

    const capacity = checkCitizenSlotCapacity({
      appointmentAt,
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      mobility: String(body?.mobility ?? 'standard'),
      vehicles: db.vehicles,
      existingBookings: toCapacityInputs(allBookings),
    })

    if (!capacity.available) {
      throw new ApiError(409, undefined, 'CAPACITY_FULL', capacity.message, capacity.alternativeTimes)
    }

    const id = `BK-DEMO-${db.seq++}`
    const created: CitizenBooking = {
      id,
      reference: id,
      status: 'REQUESTED',
      revision: 1,
      executionVersion: 0,
      patientName: String(body?.patientName ?? 'ผู้ป่วยสาธิต'),
      requesterName: String(body?.requesterName ?? body?.patientName ?? 'ผู้จองสาธิต'),
      contactPhone: String(body?.contactPhone ?? '080-000-0000'),
      bookingFor: body?.bookingFor === 'other' ? 'other' : 'self',
      villageId: String(body?.villageId ?? db.villages[0].id),
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      hospitalLocationId: hospital.location_id,
      depotLocationId: db.settings.id,
      pickupAddress: String(body?.pickupAddress ?? 'ต.บ้านกลาง อ.เมืองลำพูน'),
      latitude: Number(body?.latitude ?? BAN_KLANG_DEPOT.latitude),
      longitude: Number(body?.longitude ?? BAN_KLANG_DEPOT.longitude),
      landmark: String(body?.landmark ?? ''),
      mobility: String(body?.mobility ?? 'standard'),
      assistance: Array.isArray(body?.assistance) ? (body.assistance as string[]) : [],
      appointmentAt,
      submittedAt: new Date().toISOString(),
      patientProfileId: typeof body?.patientProfileId === 'string' ? body.patientProfileId : null,
      vehicleId: null,
      driverId: null,
      startedAt: null,
      incidentOpen: false,
      resourceHold: false,
      scheduleReviewRequired: false,
      originName: db.settings.name,
      schedule: null,
      proposedSchedule: null,
    }
    db.bookings.unshift(created)
    saveDb(db)
    return created as T
  }

  // --- Booking Detail & Lifecycle Commands ---
  if (pathname.startsWith('/bookings/')) {
    const rest = pathname.slice('/bookings/'.length).split('/')
    const bookingId = decodeURIComponent(rest[0] || '')
    const action = rest[1] || ''
    const allBookings = mergeWithOverlayBookings(db)
    let booking = db.bookings.find(b => b.id === bookingId)
    if (!booking) {
      const fromOverlay = allBookings.find(b => b.id === bookingId)
      if (fromOverlay) {
        booking = { ...fromOverlay }
        db.bookings.push(booking)
      }
    }
    if (!booking) throw new ApiError(404)

    if (!action && !isPost) {
      return booking as T
    }

    if (action === 'review') {
      const history = db.verifications[booking.id] ?? []
      return {
        latestId: history[0]?.id ?? null,
        duplicates: [],
        history,
        nextCursor: null,
        capacityDecision: null,
      } as T
    }

    if (action === 'verification' && isPost) {
      const list = db.verifications[booking.id] ?? []
      const entry: DemoVerificationEntry = {
        id: `VER-DEMO-${db.seq++}`,
        outcome: String(body?.outcome ?? 'confirmed'),
        notes: String(body?.notes ?? ''),
        recordedAt: new Date().toISOString(),
        actor: 'เจ้าหน้าที่จัดรถ (โหมดสาธิต)',
        correctsId: typeof body?.correctsId === 'string' ? body.correctsId : null,
      }
      db.verifications[booking.id] = [entry, ...list]
      saveDb(db)
      return entry as T
    }

    if (action === 'capacity-checks' && isPost) {
      const cap = checkCitizenSlotCapacity({
        appointmentAt: booking.appointmentAt,
        hospitalId: booking.hospitalId,
        hospitalName: booking.hospitalName,
        mobility: booking.mobility,
        vehicles: db.vehicles,
        existingBookings: toCapacityInputs(allBookings),
        excludeBookingId: booking.id,
      })
      const alts = Array.isArray(body?.alternatives) ? body.alternatives : []
      return {
        id: `CAP-DEMO-${db.seq++}`,
        rejectable: !cap.available,
        recordedAt: new Date().toISOString(),
        alternatives: alts.map(selection => ({
          selection,
          result: cap.available ? 'available' : 'unavailable',
          issues: cap.available ? [] : [{ code: 'CONFLICT', message: cap.message }],
        })),
      } as T
    }

    if ((action === 'schedule' || action === 'assignment' || action === 'modification' || action === 'configuration-preview') && isPost) {
      const vehicleId = String(body?.vehicleId || booking.vehicleId || db.vehicles.find(v => v.active)?.id || '')
      const driverId = String(body?.driverId || booking.driverId || db.drivers.find(d => d.active)?.id || '')
      const vehicle = db.vehicles.find(v => v.id === vehicleId)
      const driver = db.drivers.find(d => d.id === driverId)
      if (!vehicle || !vehicle.active || vehicle.held) {
        throw new ApiError(409, undefined, 'RESOURCE_UNAVAILABLE', 'รถที่เลือกไม่พร้อมใช้งาน')
      }
      if (!driver || !driver.active || driver.held) {
        throw new ApiError(409, undefined, 'RESOURCE_UNAVAILABLE', 'คนขับที่เลือกไม่พร้อมใช้งาน')
      }

      const win = computeBackwardBlockedWindow(booking.appointmentAt, { hospitalName: booking.hospitalName })!
      const waitMin = Number(body?.pickupWaitingMinutes ?? 0) || 0
      const newStartMs = win.startMs - waitMin * 60_000
      const newEndMs = win.endMs

      for (const peer of allBookings) {
        if (peer.id === booking.id || ['CANCELLED', 'REJECTED', 'ABORTED', 'COMPLETED'].includes(peer.status)) continue
        const sameVehicle = peer.vehicleId === vehicleId
        const sameDriver = peer.driverId === driverId
        if (!sameVehicle && !sameDriver) continue
        if (peer.incidentOpen) {
          throw new ApiError(
            409,
            undefined,
            'RESOURCE_INCIDENT_HOLD',
            `ไม่สามารถมอบหมายได้: ${sameVehicle ? 'รถรับส่ง' : 'คนขับ'}มีเหตุขัดข้องค้างอยู่ในงาน ${peer.reference}`,
          )
        }
        const peerSchedule = peer.schedule ?? peer.proposedSchedule
        if (!peerSchedule && !['ASSIGNED', 'PICKING_UP', 'PICKED_UP', 'IN_TRANSIT', 'SCHEDULED'].includes(peer.status)) continue
        const peerWin = computeBackwardBlockedWindow(peer.appointmentAt, {
          hospitalName: peer.hospitalName,
          existingSchedule: peerSchedule,
        })
        if (peerWin && newStartMs < peerWin.endMs && newEndMs > peerWin.startMs) {
          const who = sameVehicle && sameDriver ? 'รถรับส่งและคนขับ' : sameVehicle ? 'รถรับส่ง' : 'คนขับ'
          throw new ApiError(
            409,
            undefined,
            'RESOURCE_TIME_CONFLICT',
            `ช่วงเวลาทับซ้อนกับงาน ${peer.reference} (${peerWin.windowLabel}) — ${who}ไม่ว่างในช่วงเวลานี้`,
          )
        }
      }

      const scheduleObj = {
        departureAt: new Date(newStartMs).toISOString(),
        pickupAt: win.pickupAt,
        arrivalAt: win.arrivalAt,
        readyAt: win.freeAt,
        pickupWaitingMinutes: waitMin,
        originLocationId: String(body?.originLocationId || db.settings.id),
        originKind: String(body?.originKind || 'depot'),
      }

      if (action === 'configuration-preview') {
        return {
          configurationRevision: db.configurationRevision,
          schedule: { ...scheduleObj, vehicleId, driverId },
        } as T
      }

      booking.vehicleId = vehicleId
      booking.driverId = driverId
      booking.vehicleName = `${vehicle.name} · ${vehicle.plate}`
      booking.revision += 1

      if (action === 'schedule') {
        booking.status = 'SCHEDULED'
        booking.proposedSchedule = { ...scheduleObj, vehicleId, driverId }
      } else {
        booking.status = 'ASSIGNED'
        booking.schedule = scheduleObj
        booking.proposedSchedule = null
      }
      saveDb(db)
      return booking as T
    }

    if (action === 'destination-preview' && isPost) {
      const hosp = db.hospitals.find(h => h.id === body?.hospitalId) ?? db.hospitals[0]
      const win = computeBackwardBlockedWindow(booking.appointmentAt, { hospitalName: hosp.name })!
      return {
        hospitalName: hosp.name,
        arrivalAt: win.arrivalAt,
        readyAt: win.freeAt,
        latenessSeconds: 0,
        appointmentLatenessSeconds: 0,
      } as T
    }

    if (action === 'destination' && isPost) {
      const hosp = db.hospitals.find(h => h.id === body?.hospitalId) ?? db.hospitals[0]
      booking.hospitalId = hosp.id
      booking.hospitalName = hosp.name
      booking.hospitalLocationId = hosp.location_id
      booking.revision += 1
      saveDb(db)
      return booking as T
    }

    if (action === 'commands' && isPost) {
      const cmd = (body?.command ?? {}) as { type?: string; reason?: string; targetStatus?: string }
      booking.revision += 1
      switch (cmd.type) {
        case 'APPROVE':
          booking.status = 'APPROVED'
          break
        case 'REJECT':
          booking.status = 'REJECTED'
          booking.rejectionReason = cmd.reason || 'ปฏิเสธคำขอ'
          break
        case 'CANCEL':
          booking.status = 'CANCELLED'
          break
        case 'START_TRIP':
          booking.startedAt = new Date().toISOString()
          booking.executionVersion += 1
          break
        case 'DEPART_ORIGIN':
          booking.status = 'PICKING_UP'
          booking.executionVersion += 1
          break
        case 'CONFIRM_PICKUP':
          booking.status = 'PICKED_UP'
          booking.executionVersion += 1
          break
        case 'DEPART_FOR_HOSPITAL':
          booking.status = 'IN_TRANSIT'
          booking.executionVersion += 1
          break
        case 'CONFIRM_HANDOVER':
          booking.status = 'COMPLETED'
          booking.executionVersion += 1
          break
        case 'FAILED_PICKUP':
        case 'REPORT_FAILED_PICKUP':
          booking.status = 'CANCELLED'
          booking.resourceHold = true
          booking.incidentReason = cmd.reason || 'ไม่สามารถรับผู้ป่วยได้'
          booking.incidentReportedAt = new Date().toISOString()
          if (booking.vehicleId) {
            const v = db.vehicles.find(item => item.id === booking.vehicleId)
            if (v) v.held = true
          }
          if (booking.driverId) {
            const d = db.drivers.find(item => item.id === booking.driverId)
            if (d) d.held = true
          }
          booking.executionVersion += 1
          break
        case 'REPORT_INCIDENT':
          booking.incidentOpen = true
          booking.resourceHold = true
          booking.incidentReason = cmd.reason || 'รายงานเหตุขัดข้องระหว่างปฏิบัติงาน'
          booking.incidentReportedAt = new Date().toISOString()
          if (booking.vehicleId) {
            const v = db.vehicles.find(item => item.id === booking.vehicleId)
            if (v) v.held = true
          }
          if (booking.driverId) {
            const d = db.drivers.find(item => item.id === booking.driverId)
            if (d) d.held = true
          }
          booking.executionVersion += 1
          break
        case 'RESOLVE_INCIDENT':
          booking.incidentOpen = false
          booking.resourceHold = false
          booking.incidentReason = null
          booking.incidentReportedAt = null
          if (booking.vehicleId) {
            const v = db.vehicles.find(item => item.id === booking.vehicleId)
            if (v) v.held = false
          }
          if (booking.driverId) {
            const d = db.drivers.find(item => item.id === booking.driverId)
            if (d) d.held = false
          }
          break
        case 'ABORT':
          booking.status = 'ABORTED'
          booking.incidentOpen = false
          break
        case 'CORRECT_MILESTONE':
          if (cmd.targetStatus) booking.status = cmd.targetStatus
          break
        default:
          break
      }
      saveDb(db)
      return booking as T
    }
  }

  // --- Driver History ---
  if (pathname === '/driver/history') {
    const driverId = db.drivers[0]?.id || 'demo-driver-A'
    const allBookings = mergeWithOverlayBookings(db)
    const history = allBookings
      .filter(b => b.driverId === driverId && ['COMPLETED', 'CANCELLED', 'ABORTED'].includes(b.status))
      .sort((a, b) => Date.parse(b.appointmentAt) - Date.parse(a.appointmentAt))
      .map(b => {
        const village = db.villages.find(v => v.id === b.villageId)
        return {
          id: b.id,
          reference: b.reference,
          status: b.status,
          appointmentAt: b.appointmentAt,
          villageName: village ? `หมู่ ${village.number} ${village.name}` : undefined,
          hospitalName: b.hospitalName || SUPPORTED_HOSPITALS[0].name,
          schedule: b.schedule,
          completedAt: b.schedule?.arrivalAt || b.appointmentAt,
        }
      })
    return { bookings: history, nextCursor: null, hasMore: false } as T
  }

  // --- Alerts & Notification Queues ---
  if (pathname.startsWith('/dispatcher-alerts')) {
    return { alerts: [], unread: 0, nextCursor: null } as T
  }

  if (pathname.startsWith('/notification-failures') || pathname.startsWith('/admin/notification-failures')) {
    return {
      failures: [],
      total: 0,
      pending: 0,
      nextCursor: null,
      service: { configured: false, deliveryEnabled: false },
    } as T
  }

  if (pathname.startsWith('/resources/') && pathname.endsWith('/readiness') && isPost) {
    const parts = pathname.split('/')
    const kind = parts[2]
    const id = decodeURIComponent(parts[3] || '')
    const list = kind === 'vehicles' ? db.vehicles : db.drivers
    const res = list.find(item => item.id === id)
    if (res) {
      res.held = false
      if (typeof body?.locationId === 'string') res.locationId = body.locationId
      res.revision += 1
      saveDb(db)
    }
    return { ok: true } as T
  }

  // --- Admin Endpoints ---
  if (pathname === '/admin/accounts' && !isPost) {
    return { accounts: db.accounts } as T
  }

  if ((pathname === '/admin/accounts' || pathname.startsWith('/admin/accounts/')) && isPost) {
    const existingId = pathname.startsWith('/admin/accounts/') ? decodeURIComponent(pathname.slice('/admin/accounts/'.length)) : null
    if (existingId) {
      const acc = db.accounts.find(a => a.id === existingId)
      if (!acc) throw new ApiError(404)
      const before = { ...acc }
      if (typeof body?.name === 'string') acc.name = body.name
      if (typeof body?.username === 'string') acc.username = body.username
      if (body?.role === 'admin' || body?.role === 'dispatcher' || body?.role === 'driver') acc.role = body.role
      if (typeof body?.active === 'boolean') acc.active = body.active
      acc.revision += 1
      recordAudit(db, { action: 'UPDATE_STAFF_ACCOUNT', entityType: 'staff_account', entityId: acc.id, actor: 'ผู้ดูแลระบบ (สาธิต)', reason: String(body?.reason ?? ''), before, after: acc })
      saveDb(db)
      return acc as T
    }
    const created: StaffAccount = {
      id: `USR-DEMO-${db.seq++}`,
      name: String(body?.name ?? 'เจ้าหน้าที่ใหม่'),
      username: String(body?.username ?? `staff${db.seq}`),
      role: (body?.role === 'admin' || body?.role === 'driver' ? body.role : 'dispatcher'),
      active: body?.active !== false,
      revision: 1,
    }
    db.accounts.push(created)
    recordAudit(db, { action: 'CREATE_STAFF_ACCOUNT', entityType: 'staff_account', entityId: created.id, actor: 'ผู้ดูแลระบบ (สาธิต)', reason: String(body?.reason ?? ''), after: created })
    saveDb(db)
    return created as T
  }

  if (pathname.startsWith('/admin/resources/') && isPost) {
    const parts = pathname.split('/')
    const kind = parts[3] as 'vehicles' | 'drivers'
    const resourceId = parts[4] ? decodeURIComponent(parts[4]) : null
    const sub = parts[5]

    if (sub === 'windows' && resourceId) {
      const win: AvailabilityWindow = {
        id: `win-demo-${db.seq++}`,
        vehicleId: kind === 'vehicles' ? resourceId : null,
        driverId: kind === 'drivers' ? resourceId : null,
        startsAt: String(body?.startsAt ?? '2026-01-01T06:00:00+07:00'),
        endsAt: String(body?.endsAt ?? '2028-12-31T16:00:00+07:00'),
        revision: 1,
      }
      db.windows.push(win)
      recordAudit(db, { action: 'CREATE_AVAILABILITY', entityType: kind, entityId: resourceId, actor: 'ผู้ดูแลระบบ (สาธิต)', reason: String(body?.reason ?? ''), after: win })
      saveDb(db)
      return win as T
    }

    const list = kind === 'vehicles' ? db.vehicles : db.drivers
    if (resourceId) {
      const item = list.find(r => r.id === resourceId)
      if (!item) throw new ApiError(404)
      const before = { ...item }
      if (typeof body?.name === 'string') item.name = body.name
      if (typeof body?.plate === 'string') item.plate = body.plate
      if (typeof body?.vehicleType === 'string') item.vehicleType = body.vehicleType
      if (typeof body?.phone === 'string') item.phone = body.phone
      if (typeof body?.userId === 'string') item.accountId = body.userId
      if (Array.isArray(body?.capabilities)) item.capabilities = body.capabilities as string[]
      if (typeof body?.active === 'boolean') {
        item.active = body.active
        if (kind === 'drivers') item.rosterActive = body.active
      }
      item.revision += 1
      recordAudit(db, { action: 'UPDATE_RESOURCE', entityType: kind, entityId: item.id, actor: 'ผู้ดูแลระบบ (สาธิต)', reason: String(body?.reason ?? ''), before, after: item })
      saveDb(db)
      return { [kind === 'vehicles' ? 'vehicle' : 'driver']: item } as T
    }

    const created: AdminResource = {
      id: `${kind === 'vehicles' ? 'demo-vehicle' : 'demo-driver'}-${db.seq++}`,
      name: String(body?.name ?? (kind === 'vehicles' ? 'รถรับส่งใหม่' : 'คนขับใหม่')),
      plate: typeof body?.plate === 'string' ? body.plate : undefined,
      vehicleType: typeof body?.vehicleType === 'string' ? body.vehicleType : undefined,
      phone: typeof body?.phone === 'string' ? body.phone : undefined,
      accountId: typeof body?.userId === 'string' ? body.userId : undefined,
      active: body?.active !== false,
      rosterActive: kind === 'drivers' ? body?.active !== false : undefined,
      held: false,
      capabilities: Array.isArray(body?.capabilities) ? (body.capabilities as string[]) : ['standard'],
      revision: 1,
      locationId: String(body?.locationId || db.settings.id),
      availableAt: String(body?.availableAt || new Date().toISOString()),
    }
    list.push(created)
    recordAudit(db, { action: 'CREATE_RESOURCE', entityType: kind, entityId: created.id, actor: 'ผู้ดูแลระบบ (สาธิต)', reason: String(body?.reason ?? ''), after: created })
    saveDb(db)
    return { [kind === 'vehicles' ? 'vehicle' : 'driver']: created } as T
  }

  if (pathname === '/admin/availability' && !isPost) {
    return { windows: db.windows } as T
  }

  if (pathname.startsWith('/admin/availability/') && isPost) {
    const parts = pathname.split('/')
    const winId = decodeURIComponent(parts[3] || '')
    const retire = parts[4] === 'retire'
    if (retire) {
      db.windows = db.windows.filter(w => w.id !== winId)
      recordAudit(db, { action: 'RETIRE_AVAILABILITY', entityType: 'settings', entityId: winId, actor: 'ผู้ดูแลระบบ (สาธิต)', reason: String(body?.reason ?? '') })
    } else {
      const win = db.windows.find(w => w.id === winId)
      if (win) {
        if (typeof body?.startsAt === 'string') win.startsAt = body.startsAt
        if (typeof body?.endsAt === 'string') win.endsAt = body.endsAt
        win.revision += 1
        recordAudit(db, { action: 'UPDATE_AVAILABILITY', entityType: 'settings', entityId: winId, actor: 'ผู้ดูแลระบบ (สาธิต)', reason: String(body?.reason ?? ''), after: win })
      }
    }
    saveDb(db)
    return { ok: true } as T
  }

  if (pathname === '/admin/audit') {
    return { events: db.auditEvents } as T
  }

  if (pathname === '/admin/summary') {
    const allBookings = mergeWithOverlayBookings(db)
    const counts = new Map<string, number>()
    for (const b of allBookings) {
      counts.set(b.status, (counts.get(b.status) ?? 0) + 1)
    }
    return {
      statuses: Array.from(counts.entries()).map(([status, count]) => ({ status, count })),
    } as T
  }

  if (pathname === '/admin/service-data' && !isPost) {
    return {
      hospitals: db.hospitals,
      villages: db.villages,
      settings: db.settings,
      closures: db.closures,
      pendingReviewCount: 0,
    } as T
  }

  if (pathname.startsWith('/admin/service-data') && isPost) {
    if (pathname.includes('/depot') || pathname.includes('/settings')) {
      if (typeof body?.name === 'string') {
        db.settings.name = body.name
        db.settings.center = body.name
      }
      if (typeof body?.latitude === 'number') db.settings.latitude = body.latitude
      if (typeof body?.longitude === 'number') db.settings.longitude = body.longitude
      db.settings.revision += 1
      db.configurationRevision += 1
    } else if (pathname.includes('/closures')) {
      db.closures.push({
        id: `cls-demo-${db.seq++}`,
        date: String(body?.date ?? ''),
        reason: String(body?.reason ?? ''),
        active: body?.active !== false,
        revision: 1,
      })
    }
    recordAudit(db, { action: 'UPDATE_SERVICE_SETTINGS', entityType: 'settings', actor: 'ผู้ดูแลระบบ (สาธิต)', reason: String(body?.reason ?? '') })
    saveDb(db)
    return { affectedCount: 0 } as T
  }

  if (pathname === '/admin/seed-import' && isPost) {
    const incoming = Array.isArray(body?.bookings) ? (body.bookings as Booking[]) : []
    const replace = body?.replace !== false
    const converted = incoming.map(b => toCitizenBookingFromSeed(b, db))
    if (replace) {
      db.bookings = converted
    } else {
      const ids = new Set(converted.map(b => b.id))
      db.bookings = [...db.bookings.filter(b => !ids.has(b.id)), ...converted]
    }
    recordAudit(db, {
      action: 'SEED_IMPORT',
      entityType: 'settings',
      actor: 'ผู้ดูแลระบบ (สาธิต)',
      reason: `นำเข้าชุดข้อมูลจำลอง ${converted.length} รายการ`,
    })
    saveDb(db)
    return { ok: true, importedCount: converted.length } as T
  }

  if (pathname === '/admin/seed-reset' && isPost) {
    db.bookings = []
    recordAudit(db, {
      action: 'SEED_RESET',
      entityType: 'settings',
      actor: 'ผู้ดูแลระบบ (สาธิต)',
      reason: 'ล้างข้อมูลการจองจำลองทั้งหมดก่อนส่งมอบระบบ',
    })
    saveDb(db)
    return { ok: true } as T
  }

  // Fallback for unhandled paths in demo mode
  throw new ApiError(404, undefined, 'DEMO_ROUTE_NOT_FOUND', `Unhandled demo route: ${pathname}`)
}

export async function handleDemoApiDownload(
  path: string,
  body: unknown,
): Promise<{ blob: Blob; filename: string }> {
  const db = readDb()
  const allBookings = mergeWithOverlayBookings(db)
  const payload = (body && typeof body === 'object' ? body : {}) as { date?: string; month?: string }

  if (path === '/reports/daily') {
    const targetDate = payload.date || bangkokDateFromMs(Date.now())
    const rows = allBookings.filter(b => bangkokDateFromMs(Date.parse(b.schedule?.pickupAt || b.appointmentAt)) === targetDate)
    const header = ['รหัสงาน', 'ชื่อผู้ป่วย', 'เบอร์ติดต่อ', 'วันนัดหมาย', 'เวลารับ', 'โรงพยาบาล', 'อุปกรณ์', 'รถ', 'คนขับ', 'สถานะ']
    const lines = [
      header.join(','),
      ...rows.map((b: ApiBooking) => {
        const veh = db.vehicles.find(v => v.id === b.vehicleId)
        const drv = db.drivers.find(d => d.id === b.driverId)
        const pickup = b.schedule?.pickupAt ? new Date(Date.parse(b.schedule.pickupAt) + 7 * 3600_000).toISOString().slice(11, 16) : '-'
        return [
          b.reference,
          b.patientName,
          b.contactPhone,
          targetDate,
          pickup,
          b.hospitalName || '',
          mobilityCodeFromLabel(b.mobility),
          veh ? `${veh.name} ${veh.plate}` : '-',
          drv?.name || '-',
          b.status,
        ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')
      }),
    ]
    const csv = `\uFEFF${lines.join('\r\n')}`
    return {
      blob: new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
      filename: `daily-manifest-${targetDate}.csv`,
    }
  }

  const targetMonth = payload.month || bangkokDateFromMs(Date.now()).slice(0, 7)
  const rows = allBookings.filter(b => bangkokDateFromMs(Date.parse(b.appointmentAt)).startsWith(targetMonth))
  const byStatus = new Map<string, number>()
  for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1)
  const csv = `\uFEFFสถานะ,จำนวน\r\n${Array.from(byStatus.entries()).map(([k, v]) => `"${k}",${v}`).join('\r\n')}`
  return {
    blob: new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    filename: `monthly-summary-${targetMonth}.csv`,
  }
}
