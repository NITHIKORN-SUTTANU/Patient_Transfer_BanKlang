import type { ResourceReservation, ServiceCalendar, TripOrigin } from './lifecycle.ts'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
export type Mobility = 'standard' | 'wheelchair' | 'stretcher'
export interface BookingRequest {
  tripId: string
  submittedAt: string
  appointmentAt: string
  pickupId: string
  hospitalId: string
  mobility: Mobility
}
export interface RouteLeg {
  fromId: string
  toId: string
  minutes: number
}
export interface ScheduleInput {
  request: BookingRequest
  vehicleId: string
  driverId: string
  origin: TripOrigin
  originToPickup: RouteLeg
  pickupToHospital: RouteLeg
  pickupWaitingMinutes?: number
}
export interface ScheduledReservation extends ResourceReservation {
  tripId: string
  hospitalId: string
  pickupWaitingMinutes: number
}
export interface AvailabilityWindow { from: string; until: string }
export interface SchedulingResource {
  id: string
  active: boolean
  /** Verified starting location/readiness before the supplied reservation timeline. */
  locationId: string
  availableAt: string
  windows: AvailabilityWindow[]
  /** Vehicle equipment or driver qualifications, supplied by municipal master data. */
  capabilities: Mobility[]
  holds: { from: string; until?: string; reason: string; tripId?: string }[]
  positionUpdates?: { at: string; locationId: string }[]
}
export interface ReservedTrip {
  input: ScheduleInput
  schedule: ScheduledReservation
  continuation?: { hospitalId: string; arrivalAt: string; readyAt: string; recordedAt: string }
}
export interface SchedulingContext {
  calendar: ServiceCalendar
  vehicles: SchedulingResource[]
  drivers: SchedulingResource[]
  /** Committed timeline only: recommendations must not be included here.
   * Keep readiness/location history for ended trips; exclude cancelled reservations
   * but preserve their operational holds in the resource records.
   */
  reservations: ReservedTrip[]
}
export interface SchedulingIssue {
  code: 'INVALID' | 'LEAD_TIME' | 'CLOSED' | 'HOURS' | 'RESOURCE' | 'CAPABILITY' |
    'SHIFT' | 'HOLD' | 'CONFLICT' | 'LOCATION' | 'CHAIN' | 'STALE'
  tripId: string
  message: string
  resourceId?: string
  relatedTripId?: string
}
export class SchedulingError extends Error {
  readonly code: SchedulingIssue['code']
  constructor(code: SchedulingIssue['code'], message: string) { super(message); this.code = code }
}
function requireSchedule(condition: boolean, code: SchedulingIssue['code'], message: string): asserts condition {
  if (!condition) throw new SchedulingError(code, message)
}
function time(value: string): number {
  // Explicit timezone prevents browser/server-local interpretations from differing.
  requireSchedule(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value), 'INVALID', 'Timestamp requires a valid clock, seconds and an explicit timezone')
  const result = Date.parse(value)
  requireSchedule(Number.isFinite(result), 'INVALID', 'Invalid timestamp')
  const date = value.slice(0, 10)
  requireSchedule(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date, 'INVALID', 'Invalid calendar date')
  return result
}
const iso = (value: number) => {
  requireSchedule(Number.isFinite(value) && Math.abs(value) <= 8.64e15, 'INVALID', 'Calculated timestamp out of range')
  return new Date(value).toISOString()
}
function local(value: number) {
  const shifted = new Date(value + 7 * 60 * MINUTE).toISOString()
  return { day: shifted.slice(0, 10), clock: shifted.slice(11, 23) }
}
function validateCalendar(calendar: ServiceCalendar) {
  requireSchedule(calendar.timezone === 'Asia/Bangkok' && calendar.opensAt === '06:00' && calendar.closesAt === '16:00', 'INVALID', 'Expected confirmed Bangkok service hours 06:00–16:00')
  for (const day of calendar.closureDates) {
    requireSchedule(/^\d{4}-\d{2}-\d{2}$/.test(day), 'INVALID', 'Closure dates must be YYYY-MM-DD')
    time(`${day}T00:00:00+07:00`)
  }
}

/** Route durations must be obtained by the caller from a verified routing result.
 * This function never invents a travel time or treats a routing failure as zero.
 */
export function calculateSchedule(input: ScheduleInput, calendar: ServiceCalendar): ScheduledReservation {
  validateCalendar(calendar)
  const { request, origin, originToPickup, pickupToHospital } = input
  requireSchedule([request.tripId, request.pickupId, request.hospitalId, input.vehicleId, input.driverId, origin.locationId].every(id => typeof id === 'string' && id.trim().length > 0), 'INVALID', 'Trip, locations and resources are required')
  requireSchedule(['standard', 'wheelchair', 'stretcher'].includes(request.mobility), 'INVALID', 'Unknown mobility requirement')
  requireSchedule(['depot', 'previous_hospital', 'handoff'].includes(origin.kind), 'INVALID', 'Unknown trip origin')
  requireSchedule(origin.kind === 'previous_hospital' ? !!origin.previousTripId && origin.previousTripId !== request.tripId : !origin.previousTripId, 'CHAIN', 'Previous hospital origin requires a different preceding trip; depot origin cannot reference one')
  requireSchedule(originToPickup.fromId === origin.locationId && originToPickup.toId === request.pickupId && pickupToHospital.fromId === request.pickupId && pickupToHospital.toId === request.hospitalId, 'INVALID', 'Route endpoints do not match the planned journey')
  requireSchedule([originToPickup.minutes, pickupToHospital.minutes].every(n => Number.isFinite(n) && n >= 0), 'INVALID', 'Both valid route durations are required')
  const waiting = input.pickupWaitingMinutes ?? 0
  requireSchedule(Number.isSafeInteger(waiting) && waiting >= 0, 'INVALID', 'Pickup waiting allowance must be nonnegative whole minutes')
  const submitted = time(request.submittedAt)
  const appointment = time(request.appointmentAt)
  requireSchedule(appointment - submitted >= 2 * DAY, 'LEAD_TIME', 'At least 48 hours advance notice required')
  const arrival = appointment - 20 * MINUTE
  const pickup = arrival - Math.ceil(pickupToHospital.minutes * MINUTE) - waiting * MINUTE
  const departure = pickup - Math.ceil(originToPickup.minutes * MINUTE)
  const ready = arrival + 30 * MINUTE
  const departureAt = iso(departure)
  const readyAt = iso(ready)
  const startLocal = local(departure)
  const endLocal = local(ready)
  requireSchedule(!calendar.closureDates.includes(startLocal.day) && !calendar.closureDates.includes(endLocal.day), 'CLOSED', 'Trip falls on a configured closure date')
  requireSchedule(startLocal.day === endLocal.day && startLocal.clock >= '06:00:00.000' && endLocal.clock <= '16:00:00.000', 'HOURS', 'The full trip including turnaround must fit 06:00–16:00')
  return { tripId: request.tripId, hospitalId: request.hospitalId, vehicleId: input.vehicleId, driverId: input.driverId,
    origin: { ...origin }, departureAt, pickupAt: iso(pickup), arrivalAt: iso(arrival), readyAt, pickupWaitingMinutes: waiting }
}

function overlap(start: number, end: number, otherStart: number, otherEnd: number) {
  return start < otherEnd && otherStart < end
}

function sameSchedule(a: ScheduledReservation, b: ScheduledReservation) {
  const keys = ['tripId', 'hospitalId', 'vehicleId', 'driverId', 'departureAt', 'pickupAt', 'arrivalAt', 'readyAt', 'pickupWaitingMinutes'] as const
  return keys.every(key => a[key] === b[key]) && a.origin.kind === b.origin.kind &&
    a.origin.locationId === b.origin.locationId && a.origin.previousTripId === b.origin.previousTripId
}

/** Validates the whole proposed timeline so changes cannot break later trips silently. */
export function validateReservations(context: SchedulingContext): SchedulingIssue[] {
  const issues: SchedulingIssue[] = []
  const add = (code: SchedulingIssue['code'], tripId: string, message: string, resourceId?: string, relatedTripId?: string) =>
    issues.push({ code, tripId, message, resourceId, relatedTripId })
  const seen = new Set<string>()
  for (const record of context.reservations) {
    const id = record.input.request.tripId
    if (seen.has(id)) add('INVALID', id, 'Duplicate trip reservation')
    seen.add(id)
    try {
      const calculated = calculateSchedule(record.input, context.calendar)
      if (!sameSchedule(calculated, record.schedule)) add('STALE', id, 'Stored schedule differs from its request/routes; recalculate before confirmation')
      if (record.continuation) {
        const leg = record.continuation
        requireSchedule(!!leg.hospitalId && time(leg.arrivalAt) >= time(leg.recordedAt) && time(leg.readyAt) >= time(leg.arrivalAt) + 30 * MINUTE && time(leg.readyAt) >= time(record.schedule.readyAt), 'INVALID', 'Invalid operational continuation')
      }
    } catch (error) {
      if (!(error instanceof SchedulingError)) throw error
      add(error.code, id, error.message)
    }
  }
  // Never inspect malformed schedules for conflicts or allow them to look available.
  if (issues.length) return issues
  for (const kind of ['vehicles', 'drivers'] as const) {
    const key = kind === 'vehicles' ? 'vehicleId' : 'driverId'
    const effective = context.reservations.map(record => record.continuation ? {...record, schedule: {...record.schedule, hospitalId: record.continuation.hospitalId, arrivalAt: record.continuation.arrivalAt, readyAt: record.continuation.readyAt}} : record)
    const ids = new Set(effective.map(record => record.schedule[key]))
    for (const id of ids) {
      const resources = context[kind].filter(resource => resource.id === id)
      const timeline = effective.filter(record => record.schedule[key] === id)
        .sort((a, b) => time(a.schedule.departureAt) - time(b.schedule.departureAt))
      const resource = resources[0]
      if (resources.length !== 1 || !resource.active) {
        for (const record of timeline) add('RESOURCE', record.schedule.tripId, 'Resource missing, inactive or duplicated', id)
        continue
      }
      try {
        const initialReady = time(resource.availableAt)
        const windows = resource.windows.map(window => ({ start: time(window.from), end: time(window.until) }))
        requireSchedule(windows.every(window => window.start < window.end), 'INVALID', 'Invalid availability window')
        const holds = resource.holds.map(hold => ({ start: time(hold.from), end: hold.until ? time(hold.until) : Infinity }))
        requireSchedule(holds.every(hold => hold.start < hold.end), 'INVALID', 'Invalid resource hold')
        for (let index = 0; index < timeline.length; index++) {
          const record = timeline[index]
          const { schedule, input } = record
          const start = time(schedule.departureAt)
          const end = time(schedule.readyAt)
          if (!resource.capabilities.includes(input.request.mobility)) add('CAPABILITY', schedule.tripId, 'Required assistance capability unavailable', id)
          // An already onboard continuation may overrun its planned interval;
          // retain the original window proof and independently check all later work.
          const plannedEnd = record.continuation ? time(context.reservations.find(item => item.schedule.tripId === schedule.tripId)!.schedule.readyAt) : end
          if (!windows.some(window => window.start <= start && window.end >= plannedEnd)) add('SHIFT', schedule.tripId, 'Full trip must fit an availability window', id)
          if (holds.some((hold, index) => resource.holds[index].tripId !== schedule.tripId && overlap(start, end, hold.start, hold.end))) add('HOLD', schedule.tripId, 'Resource has an operational hold', id)
          for (const other of timeline.slice(0, index)) {
            if (overlap(start, end, time(other.schedule.departureAt), time(other.schedule.readyAt))) add('CONFLICT', schedule.tripId, 'Resource reservations overlap', id, other.schedule.tripId)
          }
          const previous = timeline[index - 1]?.schedule
          const updates = (resource.positionUpdates ?? []).map(update => ({ ...update, timestamp: time(update.at) }))
            .filter(update => update.timestamp <= start && update.timestamp >= (previous ? time(previous.readyAt) : initialReady))
            .sort((a, b) => b.timestamp - a.timestamp)
          const expectedLocation = updates[0]?.locationId ?? previous?.hospitalId ?? resource.locationId
          const ready = previous ? time(previous.readyAt) : initialReady
          if (start < ready) add('CONFLICT', schedule.tripId, 'Resource not ready at origin departure', id, previous?.tripId)
          if (schedule.origin.locationId !== expectedLocation) add('LOCATION', schedule.tripId, 'Resource cannot reach origin without a validated repositioning leg', id, previous?.tripId)
          if (schedule.origin.kind === 'previous_hospital' && (!previous || previous.tripId !== schedule.origin.previousTripId)) add('CHAIN', schedule.tripId, 'Origin must reference the immediately preceding trip for both resources', id, previous?.tripId)
        }
      } catch (error) {
        if (!(error instanceof SchedulingError)) throw error
        for (const record of timeline) add(error.code, record.schedule.tripId, error.message, id)
      }
    }
  }
  return issues
}

/** Returns a proposal without changing the committed context. */
export function proposeReservation(context: SchedulingContext, input: ScheduleInput): ReservedTrip {
  return { input: structuredClone(input), schedule: calculateSchedule(input, context.calendar) }
}

export type ReservationResult =
  | { ok: true; context: SchedulingContext; reservation: ReservedTrip }
  | { ok: false; context: SchedulingContext; issues: SchedulingIssue[] }

/** Call again against the latest persisted snapshot inside the database transaction.
 * This pure function provides no cross-process lock or database atomicity by itself.
 */
export function confirmReservation(context: SchedulingContext, input: ScheduleInput, now: string, replace = false): ReservationResult {
  const tripId = input.request.tripId
  try {
    const existing = context.reservations.some(record => record.input.request.tripId === tripId)
    requireSchedule(replace === existing, 'INVALID', replace ? 'Cannot replace an unknown reservation' : 'Trip already has a reservation')
    const reservation = proposeReservation(context, input)
    requireSchedule(time(reservation.schedule.departureAt) >= time(now), 'HOURS', 'Cannot confirm a departure in the past')
    const proposed = { ...context, reservations: [...context.reservations.filter(record => record.input.request.tripId !== tripId), reservation] }
    const issues = validateReservations(proposed)
    if (issues.length) return { ok: false, context, issues }
    return { ok: true, context: proposed, reservation }
  } catch (error) {
    if (!(error instanceof SchedulingError)) throw error
    return { ok: false, context, issues: [{ code: error.code, tripId, message: error.message }] }
  }
}

/** Closure changes flag existing assignments for review; never cancel them. */
export function reviewCalendarChange(context: SchedulingContext, calendar: ServiceCalendar) {
  validateCalendar(calendar)
  return { context: { ...context, calendar: structuredClone(calendar) },
    issues: validateReservations({ ...context, calendar }) }
}
