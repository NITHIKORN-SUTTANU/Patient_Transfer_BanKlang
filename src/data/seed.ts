import type { ActorId } from './actors'
import type { BookingDetails } from '../services/booking'

// Shared domain contracts for the next implementation steps. No patient records are seeded yet.
export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'in_transit' | 'completed' | 'cancelled'
export type DriverStage = 'assigned' | 'going_to_pickup' | 'patient_onboard' | 'going_to_hospital' | 'delivered'
export interface DriverProgress { stage: DriverStage; events: { stage: DriverStage; at: string }[] }
// Production metadata is separate from the legacy visual grouping used by cards.
export interface Booking { apiStatus?: string; revision?: number; executionVersion?: number; incidentOpen?: boolean; resourceHold?: boolean }
export interface Booking { startedAt?: string | null; originName?: string; vehicleName?: string }
export interface Booking { reference?: string; cancellationLocked?: boolean }
export interface Booking { destinationRevision?: { version: number; arrivalAt: string; readyAt: string; latenessSeconds: number; appointmentLatenessSeconds: number; originalHospitalName: string; originalArrivalAt: string; recordedAt: string } }
export interface DemoSchedule {
  departureAt: string
  pickupAt: string
  arrivalAt: string
  endsAt: string
  centerToPickupMinutes?: number
  pickupToHospitalMinutes?: number
  preparationMinutes?: 20
  calculation: 'demo-manual-v1' | 'server-verified-v1'
}
export interface Booking { id: string; patientName: string; appointmentAt: string; status: BookingStatus; vehicleId?: string; driverId?: string; details?: BookingDetails; createdAt?: string; reviewedAt?: string; rejectionReason?: string; assignedAt?: string; schedule?: DemoSchedule; driverProgress?: DriverProgress; scheduleReview?: { requestedAt: string }; cancellation?: { at: string; by: 'citizen' | 'driver'; reason: string } }
export interface Vehicle { id: string; label: string; active: boolean; vehicleType?: string; support?: string }
export interface Driver { id: string; name: string; active: boolean; accountId?: string; phone?: string }
export type AdminRole = 'Dispatcher' | 'Driver' | 'Admin'
export interface AdminAccount { id: string; name: string; username: string; role: AdminRole; active: boolean; revision?: number }
export interface AdminSettings { center: string; parking?: { latitude: number; longitude: number }; serviceArea: string; opensAt: string; closesAt: string }
export interface AuditEvent { id: string; at: string; actor: string; category: 'accounts' | 'vehicles' | 'drivers' | 'settings'; action: string; recordId: string; reason?: string; before?: string; after: string }
export interface DemoState {
  version: 1
  selectedActor: ActorId | null
  bookings: Booking[]
  vehicles: Vehicle[]
  drivers: Driver[]
  dispatcherResourcesInitialized?: boolean
  accounts?: AdminAccount[]
  settings?: AdminSettings
  auditEvents?: AuditEvent[]
}
export function createSeedState(): DemoState {
  return { version: 1, selectedActor: null, bookings: [], vehicles: [], drivers: [] }
}
