import {
  BAN_KLANG_DEPOT,
  BAN_KLANG_VILLAGES,
  buildDemoScheduleFromAppt,
  SEED_VEHICLES,
  SUPPORTED_HOSPITALS,
  type SeedApiStatus,
} from '../data/realisticSeed.ts'
import type { Booking, BookingStatus, DriverProgress, DriverStage } from '../data/seed.ts'
import type { ApiBooking } from '../services/dispatcherApi.ts'

export const SEED_CSV_HEADERS = [
  'id',
  'reference',
  'patientName',
  'requesterName',
  'bookingFor',
  'phone',
  'villageId',
  'villageName',
  'pickupAddress',
  'latitude',
  'longitude',
  'hospitalId',
  'hospitalName',
  'appointmentDate',
  'appointmentTime',
  'mobility',
  'assistanceLabel',
  'extras',
  'status',
  'apiStatus',
  'vehicleId',
  'driverId',
  'centerToPickupMinutes',
  'pickupToHospitalMinutes',
  'createdAt',
  'rejectionReason',
  'cancellationReason',
] as const

const escapeCsvCell = (value: string | number | undefined | null) => {
  const str = String(value ?? '')
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

export function mobilityCodeFromLabel(label?: string): 'standard' | 'wheelchair' | 'stretcher' {
  if (!label) return 'standard'
  if (label === 'wheelchair' || label.includes('รถเข็น')) return 'wheelchair'
  if (label === 'stretcher' || label.includes('เปลนอน')) return 'stretcher'
  return 'standard'
}

export function assistanceLabelFromMobility(code?: string): 'เดินได้' | 'รถเข็น' | 'เปลนอน' {
  if (code === 'wheelchair' || code === 'รถเข็น') return 'รถเข็น'
  if (code === 'stretcher' || code === 'เปลนอน') return 'เปลนอน'
  return 'เดินได้'
}

export function generateRealisticSeedCSV(bookings: Booking[]): string {
  const lines = [SEED_CSV_HEADERS.join(',')]
  for (const b of bookings) {
    const d = b.details
    const village = BAN_KLANG_VILLAGES.find(v => v.id === d?.villageId)
    const hospital = SUPPORTED_HOSPITALS.find(h => h.name === d?.hospital)
    const appointmentDate = d?.date || (b.appointmentAt ? new Date(Date.parse(b.appointmentAt) + 7 * 3600000).toISOString().slice(0, 10) : '')
    const appointmentTime = d?.time || (b.appointmentAt ? new Date(Date.parse(b.appointmentAt) + 7 * 3600000).toISOString().slice(11, 16) : '')
    const row = [
      b.id,
      b.reference || b.id,
      b.patientName,
      d?.contactName || b.patientName,
      d?.bookingFor === 'other' ? 'other' : 'self',
      d?.phone || '0800000000',
      d?.villageId || village?.id || 'village-01',
      village ? `หมู่ ${village.number} ${village.name}` : '',
      d?.pickupAddress || d?.pickup?.label || '',
      d?.pickup?.latitude ?? village?.latitude ?? 18.58,
      d?.pickup?.longitude ?? village?.longitude ?? 99.04,
      hospital?.id || 'hospital-lamphun',
      d?.hospital || 'โรงพยาบาลลำพูน',
      appointmentDate,
      appointmentTime,
      mobilityCodeFromLabel(d?.assistance),
      assistanceLabelFromMobility(d?.assistance),
      (d?.extras ?? []).join('|'),
      b.status,
      b.apiStatus || '',
      b.vehicleId || '',
      b.driverId || '',
      b.schedule?.centerToPickupMinutes ?? '',
      b.schedule?.pickupToHospitalMinutes ?? '',
      b.createdAt || '',
      b.rejectionReason || '',
      b.cancellation?.reason || '',
    ].map(escapeCsvCell)
    lines.push(row.join(','))
  }
  return '\uFEFF' + lines.join('\r\n')
}

function parseCsvRows(csvText: string): string[][] {
  const clean = csvText.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let current: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      current.push(field)
      field = ''
    } else if (ch === '\r') {
      if (clean[i + 1] === '\n') i++
      current.push(field)
      if (current.some(c => c.trim().length > 0)) rows.push(current)
      current = []
      field = ''
    } else if (ch === '\n') {
      current.push(field)
      if (current.some(c => c.trim().length > 0)) rows.push(current)
      current = []
      field = ''
    } else {
      field += ch
    }
  }
  current.push(field)
  if (current.some(c => c.trim().length > 0)) rows.push(current)
  return rows
}

function validApiStatus(value: string): SeedApiStatus | undefined {
  const upper = value.trim().toUpperCase()
  const allowed: SeedApiStatus[] = [
    'REQUESTED', 'APPROVED', 'SCHEDULED', 'ASSIGNED',
    'PICKING_UP', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED', 'REJECTED',
  ]
  return allowed.includes(upper as SeedApiStatus) ? (upper as SeedApiStatus) : undefined
}

function resolveStatus(rawStatus: string, rawApiStatus: string): { status: BookingStatus; apiStatus: SeedApiStatus } {
  const api = validApiStatus(rawApiStatus) || validApiStatus(rawStatus)
  if (api) {
    const status: BookingStatus =
      api === 'REQUESTED' ? 'pending'
      : api === 'REJECTED' ? 'rejected'
      : api === 'COMPLETED' ? 'completed'
      : api === 'CANCELLED' ? 'cancelled'
      : ['PICKING_UP', 'PICKED_UP', 'IN_TRANSIT'].includes(api) ? 'in_transit'
      : 'approved'
    return { status, apiStatus: api }
  }
  const lower = rawStatus.trim().toLowerCase()
  if (lower === 'pending') return { status: 'pending', apiStatus: 'REQUESTED' }
  if (lower === 'approved') return { status: 'approved', apiStatus: 'APPROVED' }
  if (lower === 'in_transit') return { status: 'in_transit', apiStatus: 'IN_TRANSIT' }
  if (lower === 'completed') return { status: 'completed', apiStatus: 'COMPLETED' }
  if (lower === 'cancelled') return { status: 'cancelled', apiStatus: 'CANCELLED' }
  if (lower === 'rejected') return { status: 'rejected', apiStatus: 'REJECTED' }
  return { status: 'pending', apiStatus: 'REQUESTED' }
}

function buildProgressForApiStatus(apiStatus: SeedApiStatus, departureAt: string, pickupAt: string, arrivalAt: string): DriverProgress | undefined {
  if (apiStatus === 'ASSIGNED') return { stage: 'assigned', events: [] }
  const events: { stage: DriverStage; at: string }[] = []
  if (['PICKING_UP', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED'].includes(apiStatus)) {
    events.push({ stage: 'going_to_pickup', at: departureAt })
  }
  if (['PICKED_UP', 'IN_TRANSIT', 'COMPLETED'].includes(apiStatus)) {
    events.push({ stage: 'patient_onboard', at: pickupAt })
  }
  if (['IN_TRANSIT', 'COMPLETED'].includes(apiStatus)) {
    events.push({ stage: 'going_to_hospital', at: new Date(Date.parse(pickupAt) + 5 * 60000).toISOString() })
  }
  if (apiStatus === 'COMPLETED') {
    events.push({ stage: 'delivered', at: arrivalAt })
  }
  const stage = events.at(-1)?.stage
  return stage ? { stage, events } : undefined
}

export interface CsvImportResult {
  bookings: Booking[]
  errors: string[]
  totalRows: number
}

function normalizeCsvDateString(raw: string): string {
  const trimmed = raw.trim()
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed)
  if (isoMatch) {
    const rawYear = Number(isoMatch[1])
    const year = rawYear >= 2400 ? rawYear - 543 : rawYear
    return `${String(year).padStart(4, '0')}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`
  }
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed)
  if (slashMatch) {
    const rawYear = Number(slashMatch[3])
    const year = rawYear >= 2400 ? rawYear - 543 : rawYear
    return `${String(year).padStart(4, '0')}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`
  }
  return trimmed
}

function normalizeCsvTimestampString(raw: string): string {
  const trimmed = raw.trim()
  const match = /^(\d{4})-(\d{2}-\d{2}[T ].*)$/.exec(trimmed)
  if (match) {
    const rawYear = Number(match[1])
    if (rawYear >= 2400) {
      return `${String(rawYear - 543).padStart(4, '0')}-${match[2]}`
    }
  }
  return trimmed
}

export function parseSeedBookingsCSV(csvText: string): CsvImportResult {
  const rows = parseCsvRows(csvText)
  if (rows.length < 2) {
    return { bookings: [], errors: ['ไฟล์ CSV ไม่มีข้อมูลรายการจอง (ต้องมีส่วนหัวและอย่างน้อย 1 แถว)'], totalRows: 0 }
  }

  const headers = rows[0].map(h => h.trim())
  const col = (row: string[], ...names: string[]) => {
    for (const name of names) {
      const idx = headers.findIndex(h => h.toLowerCase() === name.toLowerCase())
      if (idx >= 0) return (row[idx] ?? '').trim()
    }
    return ''
  }

  const bookings: Booking[] = []
  const errors: string[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const id = col(row, 'id', 'รหัสคำขอ') || `BK-CSV-${1000 + i}`
    const reference = col(row, 'reference') || id
    const patientName = col(row, 'patientName', 'ชื่อผู้ป่วย')
    const appointmentDate = normalizeCsvDateString(col(row, 'appointmentDate', 'date', 'วันนัดหมาย'))
    const appointmentTime = col(row, 'appointmentTime', 'time', 'เวลานัดหมาย')
    const rawAppt = normalizeCsvTimestampString(col(row, 'appointmentAt', 'วันเวลานัดหมอ'))

    let date = appointmentDate
    let time = appointmentTime
    let appointmentAt = ''

    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      appointmentAt = new Date(`${date}T${time}:00+07:00`).toISOString()
    } else if (rawAppt && Number.isFinite(Date.parse(rawAppt))) {
      appointmentAt = new Date(Date.parse(rawAppt)).toISOString()
      const bkk = new Date(Date.parse(appointmentAt) + 7 * 3600000).toISOString()
      date = bkk.slice(0, 10)
      time = bkk.slice(11, 16)
    }

    if (!patientName || !appointmentAt || !Number.isFinite(Date.parse(appointmentAt))) {
      errors.push(`แถวที่ ${i + 1}: ข้อมูลชื่อผู้ป่วยหรือวันเวลานัดไม่ถูกต้อง`)
      continue
    }

    const rawVillageId = col(row, 'villageId')
    const rawVillageName = col(row, 'villageName')
    const village = BAN_KLANG_VILLAGES.find(
      v => v.id === rawVillageId || rawVillageName.includes(v.name) || rawVillageName.includes(`หมู่ ${v.number}`),
    ) ?? BAN_KLANG_VILLAGES[i % BAN_KLANG_VILLAGES.length]

    const rawHospitalName = col(row, 'hospitalName', 'hospital', 'โรงพยาบาลปลายทาง')
    const rawHospitalId = col(row, 'hospitalId')
    const hospital = SUPPORTED_HOSPITALS.find(
      h => h.id === rawHospitalId || h.name === rawHospitalName,
    ) ?? SUPPORTED_HOSPITALS[0]

    const latParsed = Number(col(row, 'latitude'))
    const lngParsed = Number(col(row, 'longitude'))
    const latitude = Number.isFinite(latParsed) && Math.abs(latParsed) <= 90 && latParsed !== 0 ? latParsed : village.latitude
    const longitude = Number.isFinite(lngParsed) && Math.abs(lngParsed) <= 180 && lngParsed !== 0 ? lngParsed : village.longitude

    const assistance = assistanceLabelFromMobility(col(row, 'assistanceLabel', 'mobility', 'ความช่วยเหลือ'))
    const bookingFor = col(row, 'bookingFor') === 'other' ? 'other' : 'self'
    const requesterName = col(row, 'requesterName')
    const phone = col(row, 'phone', 'contactPhone', 'เบอร์โทรศัพท์') || '0800000000'
    const pickupAddress = col(row, 'pickupAddress', 'จุดรับผู้ป่วย') || `หมู่ ${village.number} ${village.name} ต.บ้านกลาง`
    const extrasRaw = col(row, 'extras')
    const extras = extrasRaw ? extrasRaw.split('|').map(s => s.trim()).filter(Boolean) : []
    const { status, apiStatus } = resolveStatus(col(row, 'status', 'สถานะ'), col(row, 'apiStatus'))

    const rawCreated = col(row, 'createdAt')
    const createdAt = rawCreated && Number.isFinite(Date.parse(rawCreated))
      ? new Date(Date.parse(rawCreated)).toISOString()
      : new Date(Date.parse(appointmentAt) - 72 * 3600000).toISOString()

    const vehicleId = col(row, 'vehicleId', 'รหัสรถ')
    const driverId = col(row, 'driverId', 'รหัสคนขับ')
    const centerMinRaw = Number(col(row, 'centerToPickupMinutes'))
    const hospMinRaw = Number(col(row, 'pickupToHospitalMinutes'))
    const hasScheduleData = Boolean(vehicleId && driverId && Number.isSafeInteger(centerMinRaw) && centerMinRaw >= 0 && Number.isSafeInteger(hospMinRaw) && hospMinRaw >= 0)
    const schedule = hasScheduleData ? buildDemoScheduleFromAppt(appointmentAt, centerMinRaw, hospMinRaw) : undefined
    const driverProgress = schedule ? buildProgressForApiStatus(apiStatus, schedule.departureAt, schedule.pickupAt, schedule.arrivalAt) : undefined

    const vehicle = SEED_VEHICLES.find(v => v.id === vehicleId)
    const rejectionReason = col(row, 'rejectionReason')
    const cancellationReason = col(row, 'cancellationReason')

    bookings.push({
      id,
      reference,
      patientName,
      appointmentAt,
      status,
      apiStatus,
      createdAt,
      revision: 1,
      executionVersion: driverProgress ? 1 : 0,
      ...(status !== 'pending' ? { reviewedAt: createdAt } : {}),
      ...(status === 'rejected' ? { rejectionReason: rejectionReason || 'ปฏิเสธคำขอ' } : {}),
      ...(status === 'cancelled' ? { cancellation: { at: createdAt, by: 'citizen', reason: cancellationReason || 'ยกเลิกการจอง' } } : {}),
      ...(schedule ? {
        vehicleId,
        driverId,
        vehicleName: vehicle?.label,
        originName: BAN_KLANG_DEPOT.name,
        assignedAt: createdAt,
        schedule,
      } : {}),
      ...(driverProgress ? { driverProgress } : {}),
      ...(apiStatus === 'PICKING_UP' || apiStatus === 'PICKED_UP' || apiStatus === 'IN_TRANSIT'
        ? { startedAt: schedule?.departureAt }
        : {}),
      details: {
        bookingFor,
        patientName,
        contactName: bookingFor === 'other' ? requesterName || 'ผู้ดูแล' : '',
        phone,
        relationship: bookingFor === 'other' ? 'ผู้ดูแล' : '',
        hospital: hospital.name,
        date,
        time,
        assistance,
        extras,
        villageId: village.id,
        pickupAddress,
        landmark: `ใกล้${village.name}`,
        pickup: {
          x: 50,
          y: 50,
          latitude,
          longitude,
          label: pickupAddress,
        },
        acknowledged: true,
      },
    })
  }

  return { bookings, errors, totalRows: rows.length - 1 }
}

export function bookingToApiBooking(b: Booking): ApiBooking {
  const hosp = SUPPORTED_HOSPITALS.find(h => h.name === b.details?.hospital) ?? SUPPORTED_HOSPITALS[0]
  const mobility = mobilityCodeFromLabel(b.details?.assistance)
  const assistanceCodes = (b.details?.extras ?? [])
    .map(label => label.includes('พยุง') ? 'boarding_support' : label.includes('ผู้ดูแล') ? 'caregiver_accompanies' : '')
    .filter(Boolean)

  const apiStatus = b.apiStatus || (
    b.status === 'pending' ? 'REQUESTED'
    : b.status === 'rejected' ? 'REJECTED'
    : b.status === 'completed' ? 'COMPLETED'
    : b.status === 'cancelled' ? 'CANCELLED'
    : b.status === 'in_transit' ? 'IN_TRANSIT'
    : b.schedule ? 'ASSIGNED' : 'APPROVED'
  )

  const scheduleReadyAt = b.schedule
    ? new Date(Date.parse(b.schedule.arrivalAt) + 30 * 60000).toISOString()
    : null

  return {
    id: b.id,
    reference: b.reference || b.id,
    status: apiStatus,
    revision: b.revision ?? 1,
    executionVersion: b.executionVersion ?? 0,
    patientName: b.patientName,
    appointmentAt: b.appointmentAt,
    hospitalId: hosp.id,
    hospitalName: b.details?.hospital || hosp.name,
    hospitalLocationId: hosp.id,
    depotLocationId: BAN_KLANG_DEPOT.id,
    contactPhone: b.details?.phone || '0800000000',
    pickupAddress: b.details?.pickupAddress || b.details?.pickup?.label || '',
    latitude: b.details?.pickup?.latitude ?? 18.5835,
    longitude: b.details?.pickup?.longitude ?? 99.0422,
    mobility,
    vehicleId: b.vehicleId ?? null,
    driverId: b.driverId ?? null,
    startedAt: b.startedAt ?? null,
    incidentOpen: b.incidentOpen ?? false,
    resourceHold: b.resourceHold ?? false,
    scheduleReviewRequired: false,
    originName: b.originName ?? BAN_KLANG_DEPOT.name,
    vehicleName: b.vehicleName,
    assistance: assistanceCodes,
    landmark: b.details?.landmark ?? '',
    requesterName: b.details?.contactName || b.patientName,
    bookingFor: b.details?.bookingFor === 'other' ? 'other' : 'self',
    schedule: b.schedule ? {
      departureAt: b.schedule.departureAt,
      pickupAt: b.schedule.pickupAt,
      arrivalAt: b.schedule.arrivalAt,
      readyAt: scheduleReadyAt!,
      pickupWaitingMinutes: 0,
      originLocationId: BAN_KLANG_DEPOT.id,
      originKind: 'depot',
    } : null,
    proposedSchedule: null,
  }
}
