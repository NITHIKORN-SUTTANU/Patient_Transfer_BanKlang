import { SUPPORTED_HOSPITALS } from '../data/realisticSeed.ts'
import type { Mobility } from './scheduling.ts'

const MINUTE = 60_000
export const DEFAULT_DEADHEAD_MINUTES = 30
export const DEFAULT_TRAVEL_MINUTES = 35
export const PREPARATION_BUFFER_MINUTES = 20
export const HOSPITAL_TURNAROUND_MINUTES = 30

const TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'ABORTED',
  'completed',
  'cancelled',
  'rejected',
])

export interface CapacityVehicleInput {
  id: string
  label?: string
  name?: string
  active: boolean
  held?: boolean
  capabilities?: string[]
  support?: string
}

export interface CapacityBookingInput {
  id?: string
  appointmentAt: string
  status?: string
  apiStatus?: string
  mobility?: string
  assistance?: string
  hospitalId?: string
  hospitalName?: string
  vehicleId?: string | null
  schedule?: {
    departureAt?: string
    pickupAt?: string
    arrivalAt?: string
    readyAt?: string
  } | null
}

export interface BackwardBlockedWindow {
  appointmentAt: string
  departureAt: string
  pickupAt: string
  arrivalAt: string
  freeAt: string
  startMs: number
  endMs: number
  pickupMs: number
  travelMinutes: number
  deadheadMinutes: number
  returnMinutes: number
  departureClock: string
  pickupClock: string
  freeClock: string
  windowLabel: string
}

export interface CapacityCheckResult {
  available: boolean
  reason?: 'equipment_unavailable' | 'window_full'
  message: string
  requestedMobility: Mobility
  requestedMobilityLabel: string
  totalActiveVehicles: number
  compatibleVehiclesCount: number
  occupiedCompatibleCount: number
  window: BackwardBlockedWindow
  alternativeTimes: string[]
}

export function normalizeMobilityCode(value?: string | null): Mobility {
  const raw = (value ?? '').trim().toLowerCase()
  if (raw === 'stretcher' || raw.includes('เปลนอน')) return 'stretcher'
  if (raw === 'wheelchair' || raw.includes('รถเข็น') || raw.includes('วีลแชร์')) return 'wheelchair'
  return 'standard'
}

export function mobilityThaiLabel(code: Mobility): string {
  if (code === 'stretcher') return 'เปลนอน'
  if (code === 'wheelchair') return 'รถเข็น'
  return 'เดินได้ (ทั่วไป)'
}

export function parseVehicleCapabilities(vehicle: Pick<CapacityVehicleInput, 'capabilities' | 'support'>): Mobility[] {
  if (Array.isArray(vehicle.capabilities) && vehicle.capabilities.length > 0) {
    const normalized = new Set<Mobility>(vehicle.capabilities.map(c => normalizeMobilityCode(c)))
    return Array.from(normalized)
  }
  const support = (vehicle.support ?? '').trim()
  if (!support) return ['standard']
  const found = new Set<Mobility>()
  if (support.includes('เดินได้') || support.toLowerCase().includes('standard') || support.includes('ทั่วไป')) {
    found.add('standard')
  }
  if (support.includes('รถเข็น') || support.toLowerCase().includes('wheelchair')) {
    found.add('wheelchair')
  }
  if (support.includes('เปลนอน') || support.toLowerCase().includes('stretcher')) {
    found.add('stretcher')
  }
  return found.size > 0 ? Array.from(found) : ['standard']
}

export function bangkokClockFromMs(ms: number): string {
  const shifted = new Date(ms + 7 * 60 * MINUTE)
  return shifted.toISOString().slice(11, 16)
}

export function bangkokDateFromMs(ms: number): string {
  const shifted = new Date(ms + 7 * 60 * MINUTE)
  return shifted.toISOString().slice(0, 10)
}

export function estimateHospitalTravelMinutes(hospitalIdOrName?: string): number {
  const needle = (hospitalIdOrName ?? '').trim().toLowerCase()
  if (!needle) return DEFAULT_TRAVEL_MINUTES
  const matched = SUPPORTED_HOSPITALS.find(
    h => h.id.toLowerCase() === needle || h.name.toLowerCase() === needle || needle.includes(h.name.toLowerCase()),
  )
  return matched?.travelMinutes ?? DEFAULT_TRAVEL_MINUTES
}

export function computeBackwardBlockedWindow(
  appointmentAt: string,
  options: {
    hospitalId?: string
    hospitalName?: string
    travelMinutes?: number
    deadheadMinutes?: number
    existingSchedule?: CapacityBookingInput['schedule']
  } = {},
): BackwardBlockedWindow | null {
  const apptMs = Date.parse(appointmentAt)
  if (!Number.isFinite(apptMs)) return null

  const travelMinutes = options.travelMinutes ?? estimateHospitalTravelMinutes(options.hospitalName || options.hospitalId)
  const deadheadMinutes = options.deadheadMinutes ?? DEFAULT_DEADHEAD_MINUTES
  const returnMinutes = travelMinutes

  const targetArrivalMs = apptMs - PREPARATION_BUFFER_MINUTES * MINUTE
  const calcPickupMs = targetArrivalMs - travelMinutes * MINUTE
  const calcDepartureMs = calcPickupMs - deadheadMinutes * MINUTE
  const calcFreeMs = apptMs + (returnMinutes + HOSPITAL_TURNAROUND_MINUTES) * MINUTE

  const existingDepMs = options.existingSchedule?.departureAt ? Date.parse(options.existingSchedule.departureAt) : NaN
  const existingPickupMs = options.existingSchedule?.pickupAt ? Date.parse(options.existingSchedule.pickupAt) : NaN
  const existingArrivalMs = options.existingSchedule?.arrivalAt ? Date.parse(options.existingSchedule.arrivalAt) : NaN
  const existingReadyMs = options.existingSchedule?.readyAt ? Date.parse(options.existingSchedule.readyAt) : NaN

  const startMs = Number.isFinite(existingDepMs) ? Math.min(existingDepMs, calcDepartureMs) : calcDepartureMs
  const pickupMs = Number.isFinite(existingPickupMs) ? existingPickupMs : calcPickupMs
  const arrivalMs = Number.isFinite(existingArrivalMs) ? existingArrivalMs : targetArrivalMs
  const endMs = Math.max(Number.isFinite(existingReadyMs) ? existingReadyMs : 0, calcFreeMs)

  const departureClock = bangkokClockFromMs(startMs)
  const pickupClock = bangkokClockFromMs(pickupMs)
  const freeClock = bangkokClockFromMs(endMs)

  return {
    appointmentAt: new Date(apptMs).toISOString(),
    departureAt: new Date(startMs).toISOString(),
    pickupAt: new Date(pickupMs).toISOString(),
    arrivalAt: new Date(arrivalMs).toISOString(),
    freeAt: new Date(endMs).toISOString(),
    startMs,
    endMs,
    pickupMs,
    travelMinutes,
    deadheadMinutes,
    returnMinutes,
    departureClock,
    pickupClock,
    freeClock,
    windowLabel: `รถออก ${departureClock} – ว่างอีกครั้ง ${freeClock}`,
  }
}

export function isNonTerminalBooking(booking: Pick<CapacityBookingInput, 'status' | 'apiStatus'>): boolean {
  const code = (booking.apiStatus || booking.status || 'REQUESTED').trim()
  return !TERMINAL_STATUSES.has(code)
}

export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

const CANDIDATE_SLOTS = [
  '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
]

function canFitCandidate(
  candidateWindow: BackwardBlockedWindow,
  requestedMobility: Mobility,
  vehicles: CapacityVehicleInput[],
  bookings: CapacityBookingInput[],
  excludeBookingId?: string,
): { ok: boolean; compatibleCount: number; occupiedCompatibleCount: number } {
  const activeVehicles = vehicles
    .filter(v => v.active && !v.held)
    .map(v => ({
      id: v.id,
      capabilities: parseVehicleCapabilities(v),
    }))

  const compatibleVehicles = activeVehicles.filter(v => v.capabilities.includes(requestedMobility))
  if (compatibleVehicles.length === 0) {
    return { ok: false, compatibleCount: 0, occupiedCompatibleCount: 0 }
  }

  // Track occupied intervals per active vehicle.
  const vehicleSchedules = new Map<string, { startMs: number; endMs: number }[]>()
  for (const v of activeVehicles) {
    vehicleSchedules.set(v.id, [])
  }

  const unassignedOverlaps: { mobility: Mobility; startMs: number; endMs: number }[] = []

  for (const b of bookings) {
    if (excludeBookingId && b.id === excludeBookingId) continue
    if (!isNonTerminalBooking(b)) continue
    const win = computeBackwardBlockedWindow(b.appointmentAt, {
      hospitalId: b.hospitalId,
      hospitalName: b.hospitalName,
      existingSchedule: b.schedule,
    })
    if (!win) continue
    if (!intervalsOverlap(win.startMs, win.endMs, candidateWindow.startMs, candidateWindow.endMs)) {
      continue
    }

    if (b.vehicleId && vehicleSchedules.has(b.vehicleId)) {
      vehicleSchedules.get(b.vehicleId)!.push({ startMs: win.startMs, endMs: win.endMs })
    } else {
      unassignedOverlaps.push({
        mobility: normalizeMobilityCode(b.mobility || b.assistance),
        startMs: win.startMs,
        endMs: win.endMs,
      })
    }
  }

  // Allocate unassigned overlapping trips with fewest-option vehicles first (strict 1:1).
  const rarityScore = (m: Mobility) => (m === 'stretcher' ? 0 : m === 'wheelchair' ? 1 : 2)
  unassignedOverlaps.sort((a, b) => rarityScore(a.mobility) - rarityScore(b.mobility) || a.startMs - b.startMs)
  const vehiclesBySpecificity = [...activeVehicles].sort(
    (a, b) => a.capabilities.length - b.capabilities.length || a.id.localeCompare(b.id),
  )

  for (const trip of unassignedOverlaps) {
    const chosen = vehiclesBySpecificity.find(v => {
      if (!v.capabilities.includes(trip.mobility)) return false
      const busyList = vehicleSchedules.get(v.id)!
      return !busyList.some(slot => intervalsOverlap(slot.startMs, slot.endMs, trip.startMs, trip.endMs))
    })
    if (chosen) {
      vehicleSchedules.get(chosen.id)!.push({ startMs: trip.startMs, endMs: trip.endMs })
    }
  }

  let freeCompatible = 0
  for (const v of compatibleVehicles) {
    const busyList = vehicleSchedules.get(v.id)!
    const isBusy = busyList.some(slot =>
      intervalsOverlap(slot.startMs, slot.endMs, candidateWindow.startMs, candidateWindow.endMs),
    )
    if (!isBusy) freeCompatible += 1
  }

  return {
    ok: freeCompatible > 0,
    compatibleCount: compatibleVehicles.length,
    occupiedCompatibleCount: compatibleVehicles.length - freeCompatible,
  }
}

export function checkCitizenSlotCapacity(params: {
  appointmentAt: string
  hospitalId?: string
  hospitalName?: string
  mobility?: string
  vehicles: CapacityVehicleInput[]
  existingBookings: CapacityBookingInput[]
  nowMs?: number
  minLeadMs?: number
  excludeBookingId?: string
}): CapacityCheckResult {
  const requestedMobility = normalizeMobilityCode(params.mobility)
  const requestedMobilityLabel = mobilityThaiLabel(requestedMobility)
  const totalActiveVehicles = params.vehicles.filter(v => v.active && !v.held).length
  const window = computeBackwardBlockedWindow(params.appointmentAt, {
    hospitalId: params.hospitalId,
    hospitalName: params.hospitalName,
  }) ?? {
    appointmentAt: params.appointmentAt,
    departureAt: params.appointmentAt,
    pickupAt: params.appointmentAt,
    arrivalAt: params.appointmentAt,
    freeAt: params.appointmentAt,
    startMs: Date.parse(params.appointmentAt) || 0,
    endMs: Date.parse(params.appointmentAt) || 0,
    pickupMs: Date.parse(params.appointmentAt) || 0,
    travelMinutes: DEFAULT_TRAVEL_MINUTES,
    deadheadMinutes: DEFAULT_DEADHEAD_MINUTES,
    returnMinutes: DEFAULT_TRAVEL_MINUTES,
    departureClock: '00:00',
    pickupClock: '00:00',
    freeClock: '00:00',
    windowLabel: '-',
  }

  const fit = canFitCandidate(
    window,
    requestedMobility,
    params.vehicles,
    params.existingBookings,
    params.excludeBookingId,
  )

  if (fit.compatibleCount === 0) {
    return {
      available: false,
      reason: 'equipment_unavailable',
      message: `ช่วงเวลาเต็ม / รถไม่ว่าง: ขณะนี้ไม่มีรถที่เปิดใช้งานและรองรับอุปกรณ์ประเภท "${requestedMobilityLabel}" (เปิดใช้งานทั้งหมด ${totalActiveVehicles} คัน)`,
      requestedMobility,
      requestedMobilityLabel,
      totalActiveVehicles,
      compatibleVehiclesCount: 0,
      occupiedCompatibleCount: 0,
      window,
      alternativeTimes: [],
    }
  }

  if (fit.ok) {
    return {
      available: true,
      message: `มีรถพร้อมให้บริการ (${fit.compatibleCount - fit.occupiedCompatibleCount}/${fit.compatibleCount} คันว่างสำหรับประเภท ${requestedMobilityLabel})`,
      requestedMobility,
      requestedMobilityLabel,
      totalActiveVehicles,
      compatibleVehiclesCount: fit.compatibleCount,
      occupiedCompatibleCount: fit.occupiedCompatibleCount,
      window,
      alternativeTimes: [],
    }
  }

  // Find valid alternative time slots on the same date respecting 48h notice and 06:00 start.
  const apptMs = Date.parse(window.appointmentAt)
  const dateStr = bangkokDateFromMs(apptMs)
  const nowMs = params.nowMs ?? Date.now()
  const minLeadMs = params.minLeadMs ?? 48 * 3600 * 1000
  const alternatives: { clock: string; diff: number }[] = []

  for (const clock of CANDIDATE_SLOTS) {
    const candidateIso = `${dateStr}T${clock}:00+07:00`
    const candidateMs = Date.parse(candidateIso)
    if (!Number.isFinite(candidateMs) || candidateMs - nowMs < minLeadMs) continue
    const altWindow = computeBackwardBlockedWindow(candidateIso, {
      hospitalId: params.hospitalId,
      hospitalName: params.hospitalName,
    })
    if (!altWindow) continue
    // Ensure vehicle departure is within service hours (>= 06:00 Bangkok).
    const depDate = bangkokDateFromMs(altWindow.startMs)
    if (depDate !== dateStr || altWindow.departureClock < '06:00') continue

    const altFit = canFitCandidate(
      altWindow,
      requestedMobility,
      params.vehicles,
      params.existingBookings,
      params.excludeBookingId,
    )
    if (altFit.ok) {
      alternatives.push({ clock, diff: Math.abs(candidateMs - apptMs) })
    }
  }

  alternatives.sort((a, b) => a.diff - b.diff || a.clock.localeCompare(b.clock))
  const alternativeTimes = alternatives.slice(0, 3).map(a => a.clock)

  const hintText = alternativeTimes.length > 0
    ? ` แนะนำเวลานัดอื่นที่ยังมีรถว่าง: ${alternativeTimes.map(t => `${t} น.`).join(', ')}`
    : ' กรุณาเลือกวันนัดหมายอื่นหรือติดต่อเจ้าหน้าที่'

  return {
    available: false,
    reason: 'window_full',
    message: `ช่วงเวลาเต็ม / รถไม่ว่าง สำหรับอุปกรณ์ "${requestedMobilityLabel}" ช่วง${window.windowLabel} (มีรถรองรับ ${fit.compatibleCount} คัน ถูกจองเต็มแล้ว ${fit.occupiedCompatibleCount} คัน)${hintText}`,
    requestedMobility,
    requestedMobilityLabel,
    totalActiveVehicles,
    compatibleVehiclesCount: fit.compatibleCount,
    occupiedCompatibleCount: fit.occupiedCompatibleCount,
    window,
    alternativeTimes,
  }
}
