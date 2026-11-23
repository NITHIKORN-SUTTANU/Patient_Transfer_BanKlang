import type { BookingDetails } from './booking'
import { appointmentTimestamp } from './booking'
import { viewBooking, type ApiBooking, type Catalog } from './dispatcherApi'

export interface CitizenCatalog { hospitals: { id: string; name: string }[]; villages: { id: string; name: string; number: number }[] }
export interface PatientProfile { id: string; patientName: string; contactPhone: string; mobility: string; villageId: string | null; pickupAddress: string; latitude: number | null; longitude: number | null; assistance: string[]; landmark: string }
export const extras = ['ต้องการผู้ช่วยพยุงขึ้น-ลงรถ', 'มีผู้ดูแลเดินทางไปด้วย']
const codes = ['boarding_support', 'caregiver_accompanies']
const mobility: Record<string, string> = { 'เดินได้': 'standard', 'รถเข็น': 'wheelchair', 'เปลนอน': 'stretcher' }
export interface CitizenBooking extends ApiBooking { requesterName: string; villageId: string | null; patientProfileId: string | null; submittedAt?: string; rejectionReason?: string }
export function citizenBooking(row: CitizenBooking, catalog: CitizenCatalog) {
  return { ...viewBooking(row, { ...catalog, vehicles: [], drivers: [], locations: [], depotLocationId: null } as Catalog), reference: row.reference,
    cancellationLocked: row.cancellationLocked, createdAt: row.submittedAt, rejectionReason: row.rejectionReason }
}
export function canCitizenCancel(row: CitizenBooking | undefined) {
  return !!row && ['REQUESTED', 'APPROVED', 'SCHEDULED', 'ASSIGNED'].includes(row.status) && !row.startedAt && !row.cancellationLocked
}
export function profileFields(draft: BookingDetails) {
  return { patientName: draft.patientName, contactPhone: draft.phone, mobility: mobility[draft.assistance],
    ...(draft.pickupMethod === 'address'
      ? { pickupMethod: 'address' as const, villageId: draft.villageId, pickupAddress: draft.pickupAddress, landmark: draft.landmark ?? '' }
      : { pickupMethod: 'map' as const, latitude: draft.pickup?.latitude, longitude: draft.pickup?.longitude }),
    assistance: draft.extras.map(label => codes[extras.indexOf(label)]) }
}
export function intakeFields(draft: BookingDetails, consentId: string) {
  return { ...profileFields(draft), consentId, bookingFor: draft.bookingFor, requesterName: draft.bookingFor === 'self' ? draft.patientName : draft.contactName,
    hospitalId: draft.hospital, appointmentAt: new Date(appointmentTimestamp(draft.date, draft.time)).toISOString(),
    ...(draft.patientProfileId ? { patientProfileId: draft.patientProfileId } : {}) }
}
export function applyProfile(draft: BookingDetails, profile: PatientProfile): BookingDetails {
  return { ...draft, patientProfileId: profile.id, patientName: profile.patientName, phone: profile.contactPhone, villageId: profile.villageId ?? undefined,
    pickupAddress: profile.pickupAddress, landmark: profile.landmark, pickupMethod: profile.latitude === null ? 'address' : 'map',
    assistance: Object.keys(mobility).find(key => mobility[key] === profile.mobility) ?? '',
    extras: profile.assistance.map(code => extras[codes.indexOf(code)]).filter(Boolean),
    pickup: profile.latitude === null ? null : { x: 50, y: 50, latitude: profile.latitude, longitude: profile.longitude ?? undefined, label: profile.pickupAddress } }
}
