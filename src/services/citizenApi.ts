import type { BookingDetails } from './booking'
import { appointmentTimestamp } from './booking'
import { viewBooking, type ApiBooking, type Catalog } from './dispatcherApi'

export interface CitizenCatalog { hospitals: { id: string; name: string }[]; villages: { id: string; name: string; number: number }[] }
export interface PatientProfile { id: string; patientName: string; contactPhone: string; mobility: string; villageId: string; pickupAddress: string; latitude: number; longitude: number; assistance: string[]; landmark: string }
export const extras = ['ต้องการผู้ช่วยพยุงขึ้น-ลงรถ', 'มีผู้ดูแลเดินทางไปด้วย']
const codes = ['boarding_support', 'caregiver_accompanies']
const mobility: Record<string, string> = { 'เดินได้': 'standard', 'รถเข็น': 'wheelchair', 'เปลนอน': 'stretcher' }
export interface CitizenBooking extends ApiBooking { requesterName: string; villageId: string; patientProfileId: string | null; submittedAt?: string; rejectionReason?: string }
export function citizenBooking(row: CitizenBooking, catalog: CitizenCatalog) {
  return { ...viewBooking(row, { ...catalog, vehicles: [], drivers: [], locations: [], depotLocationId: null } as Catalog), reference: row.reference,
    cancellationLocked: row.cancellationLocked, createdAt: row.submittedAt, rejectionReason: row.rejectionReason }
}
export function canCitizenCancel(row: CitizenBooking | undefined) {
  return !!row && ['REQUESTED', 'APPROVED', 'SCHEDULED', 'ASSIGNED'].includes(row.status) && !row.startedAt && !row.cancellationLocked
}
export function profileFields(draft: BookingDetails) {
  return { patientName: draft.patientName, contactPhone: draft.phone, mobility: mobility[draft.assistance], villageId: draft.villageId,
    pickupAddress: draft.pickupAddress, latitude: draft.pickup?.latitude, longitude: draft.pickup?.longitude,
    assistance: draft.extras.map(label => codes[extras.indexOf(label)]), landmark: draft.landmark ?? '' }
}
export function intakeFields(draft: BookingDetails, consentId: string) {
  return { ...profileFields(draft), consentId, bookingFor: draft.bookingFor, requesterName: draft.bookingFor === 'self' ? draft.patientName : draft.contactName,
    hospitalId: draft.hospital, appointmentAt: new Date(appointmentTimestamp(draft.date, draft.time)).toISOString(),
    ...(draft.patientProfileId ? { patientProfileId: draft.patientProfileId } : {}) }
}
export function applyProfile(draft: BookingDetails, profile: PatientProfile): BookingDetails {
  return { ...draft, patientProfileId: profile.id, patientName: profile.patientName, phone: profile.contactPhone, villageId: profile.villageId,
    pickupAddress: profile.pickupAddress, landmark: profile.landmark,
    assistance: Object.keys(mobility).find(key => mobility[key] === profile.mobility) ?? '',
    extras: profile.assistance.map(code => extras[codes.indexOf(code)]).filter(Boolean),
    pickup: { x: 50, y: 50, latitude: profile.latitude, longitude: profile.longitude, label: profile.pickupAddress } }
}
