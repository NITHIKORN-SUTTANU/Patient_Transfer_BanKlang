/** Production domain contracts. These do not read or migrate the prototype store. */
export type TripStatus = 'REQUESTED' | 'APPROVED' | 'SCHEDULED' | 'ASSIGNED' |
  'PICKING_UP' | 'PICKED_UP' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED' | 'REJECTED' | 'ABORTED'
export type TripActor = { id: string; role: 'citizen' | 'dispatcher' | 'driver' | 'admin' }
export interface TripOrigin {
  kind: 'depot' | 'previous_hospital' | 'handoff'
  locationId: string
  previousTripId?: string
}
export interface ResourceReservation {
  vehicleId: string
  driverId: string
  origin: TripOrigin
  departureAt: string
  pickupAt: string
  arrivalAt: string
  readyAt: string
}
export interface ServiceCalendar {
  timezone: 'Asia/Bangkok'
  opensAt: '06:00'
  closesAt: '16:00'
  closureDates: string[]
}
export type TripCommand =
  | { type: 'REVISE_DESTINATION'; hospitalId: string; reason: string }
  | { type: 'APPROVE' }
  | { type: 'CONFIRM_SCHEDULE' }
  | { type: 'ASSIGN'; vehicleId: string; driverId: string }
  | { type: 'MODIFY_ASSIGNMENT'; vehicleId: string; driverId: string; reason: string; arrangement?: { locationId: string; confirmedAt: string; note: string } }
  | { type: 'START_TRIP' }
  | { type: 'UNDO_START'; reason: string }
  | { type: 'DEPART_ORIGIN' }
  | { type: 'CONFIRM_PICKUP' }
  | { type: 'DEPART_FOR_HOSPITAL' }
  | { type: 'CONFIRM_HANDOVER' }
  | { type: 'CANCEL'; reason: string }
  | { type: 'REJECT'; reason: string; rejectionKind?: 'capacity'|'other'; capacityCheckId?: string }
  | { type: 'FAILED_PICKUP'; reason: string }
  | { type: 'REPORT_INCIDENT'; reason: string }
  | { type: 'RESOLVE_INCIDENT'; reason: string }
  | { type: 'ABORT'; reason: string; endedAt: string; location: string; disposition: string }
  | { type: 'CONFIRM_READY'; reason: string }
  | { type: 'CORRECT_MILESTONE'; target: TripStatus; reason: string; physicalStateConfirmed: boolean }

export interface TripEvent {
  id: string
  at: string
  actor: TripActor
  command: TripCommand
  from: TripStatus
  to: TripStatus
}
export interface ProductionTrip {
  id: string
  requesterId: string
  status: TripStatus
  vehicleId?: string
  driverId?: string
  startedAt?: string
  resourceHold: boolean
  incidentOpen: boolean
  revision: number
  executionVersion: number
  cancellationLocked: boolean
  events: TripEvent[]
}

const terminals: TripStatus[] = ['COMPLETED', 'CANCELLED', 'REJECTED', 'ABORTED']
const milestones: TripStatus[] = ['ASSIGNED', 'PICKING_UP', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED']
const stamp = (value: string) => Number.isFinite(Date.parse(value))
const nonempty = (value: string) => value.trim().length > 0
function requireRule(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function createProductionTrip(id: string, requesterId: string): ProductionTrip {
  requireRule(nonempty(id) && nonempty(requesterId), 'Trip and requester identifiers are required')
  return { id, requesterId, status: 'REQUESTED', resourceHold: false, incidentOpen: false, revision: 1, executionVersion: 0, cancellationLocked: false, events: [] }
}

/** Actors must come from verified server identity, never client-supplied role fields.
 * Scheduling/assignment callers must validate routes, capabilities and availability
 * and commit resource reservations with this transition in one database transaction.
 */
export function transitionTrip(
  trip: ProductionTrip,
  command: TripCommand,
  actor: TripActor,
  eventId: string,
  at: string,
  expectedExecutionVersion?: number,
): ProductionTrip {
  requireRule(nonempty(actor.id) && nonempty(eventId) && stamp(at), 'Valid actor, event identifier and timestamp required')
  const duplicate = trip.events.find(event => event.id === eventId)
  if (duplicate) {
    requireRule(duplicate.actor.id === actor.id && duplicate.actor.role === actor.role &&
      JSON.stringify(duplicate.command) === JSON.stringify(command), 'Event identifier reused for a different operation')
    return trip
  }
  const previousEvent = trip.events.at(-1)
  requireRule(!previousEvent || Date.parse(at) >= Date.parse(previousEvent.at), 'Event timestamp precedes trip history')
  if ('reason' in command) requireRule(nonempty(command.reason), 'A reason is required')
  const dispatcher = () => requireRule(actor.role === 'dispatcher', 'Dispatcher authority required')
  const driver = () => {
    requireRule(actor.role === 'driver' && actor.id === trip.driverId, 'Assigned driver required')
    requireRule(trip.executionVersion === 0 || expectedExecutionVersion === trip.executionVersion, 'Assignment changed; reload current execution version')
  }
  const from = (...statuses: TripStatus[]) => requireRule(statuses.includes(trip.status), 'Action is not permitted in this state')
  const next = { ...trip }

  switch (command.type) {
    case 'REVISE_DESTINATION':
      dispatcher(); from('PICKED_UP', 'IN_TRANSIT')
      requireRule(!!trip.startedAt && nonempty(command.hospitalId), 'Active pickup and supported hospital required')
      next.executionVersion = trip.executionVersion + 1
      break
    case 'APPROVE':
      dispatcher(); from('REQUESTED'); next.status = 'APPROVED'; break
    case 'CONFIRM_SCHEDULE':
      dispatcher(); from('APPROVED', 'SCHEDULED'); next.status = 'SCHEDULED'; break
    case 'ASSIGN':
      dispatcher(); from('SCHEDULED')
      requireRule(nonempty(command.vehicleId) && nonempty(command.driverId), 'Both resources are required')
      next.vehicleId = command.vehicleId; next.driverId = command.driverId; next.status = 'ASSIGNED'; break
    case 'START_TRIP':
      driver(); from('ASSIGNED')
      requireRule(!trip.startedAt && !trip.resourceHold, 'Trip already started or resources held')
      next.startedAt = at; next.cancellationLocked = true; break
    case 'MODIFY_ASSIGNMENT':
      dispatcher(); from('ASSIGNED', 'PICKING_UP')
      requireRule(nonempty(command.vehicleId) && nonempty(command.driverId), 'Both resources are required')
      if (trip.startedAt) {
        const arrangement = command.arrangement
        requireRule(!!arrangement && nonempty(arrangement.locationId) && nonempty(arrangement.note) && stamp(arrangement.confirmedAt) &&
          Date.parse(arrangement.confirmedAt) <= Date.parse(at) && Date.parse(arrangement.confirmedAt) >= Math.max(Date.parse(at)-5*60000,Date.parse(trip.startedAt)), 'Current confirmed operational arrangement required after Start Trip')
      }
      next.vehicleId = command.vehicleId; next.driverId = command.driverId
      next.status = 'ASSIGNED'; next.executionVersion = trip.executionVersion + 1
      next.resourceHold = false; next.incidentOpen = false
      delete next.startedAt
      break
    case 'UNDO_START':
      dispatcher(); from('ASSIGNED')
      requireRule(!!trip.startedAt, 'Trip has not started')
      delete next.startedAt
      next.cancellationLocked = trip.events.some(event => event.command.type === 'DEPART_ORIGIN')
      break
    case 'DEPART_ORIGIN':
    case 'CONFIRM_PICKUP':
    case 'DEPART_FOR_HOSPITAL':
    case 'CONFIRM_HANDOVER': {
      driver()
      const steps = {
        DEPART_ORIGIN: ['ASSIGNED', 'PICKING_UP'],
        CONFIRM_PICKUP: ['PICKING_UP', 'PICKED_UP'],
        DEPART_FOR_HOSPITAL: ['PICKED_UP', 'IN_TRANSIT'],
        CONFIRM_HANDOVER: ['IN_TRANSIT', 'COMPLETED'],
      } as const
      const [expected, target] = steps[command.type]
      from(expected)
      requireRule(!!trip.startedAt, 'Start Trip must be recorded before departure')
      requireRule(!trip.incidentOpen, 'Dispatcher must resolve the incident before normal progression')
      next.status = target
      // Completion alone does not waive turnaround or a readiness hold.
      if (target === 'COMPLETED') next.resourceHold = true
      break
    }
    case 'CANCEL':
      from('REQUESTED', 'APPROVED', 'SCHEDULED', 'ASSIGNED', 'PICKING_UP')
      if (actor.role === 'citizen') {
        requireRule(actor.id === trip.requesterId && !trip.startedAt && !trip.cancellationLocked, 'Citizen cancellation is no longer permitted')
      } else dispatcher()
      next.status = 'CANCELLED'
      if (trip.startedAt) next.resourceHold = true
      break
    case 'REJECT':
      dispatcher(); from('REQUESTED', 'APPROVED', 'SCHEDULED'); next.status = 'REJECTED'; break
    case 'FAILED_PICKUP':
      driver(); from('PICKING_UP'); next.status = 'CANCELLED'; next.resourceHold = true; break
    case 'REPORT_INCIDENT':
      if (actor.role !== 'dispatcher') driver()
      from('ASSIGNED', 'PICKING_UP', 'PICKED_UP', 'IN_TRANSIT')
      next.incidentOpen = true; next.resourceHold = true; break
    case 'ABORT':
      dispatcher(); from('PICKED_UP', 'IN_TRANSIT')
      requireRule(stamp(command.endedAt) && Date.parse(command.endedAt) <= Date.parse(at) &&
        !!trip.startedAt && Date.parse(command.endedAt) >= Date.parse(trip.startedAt) &&
        nonempty(command.location) && nonempty(command.disposition), 'Actual end time, location and patient disposition required')
      next.status = 'ABORTED'; next.resourceHold = true; break
    case 'RESOLVE_INCIDENT':
      dispatcher(); from('ASSIGNED', 'PICKING_UP', 'PICKED_UP', 'IN_TRANSIT')
      requireRule(trip.incidentOpen, 'No open incident to resolve')
      next.incidentOpen = false; next.resourceHold = false; break
    case 'CONFIRM_READY':
      dispatcher()
      requireRule(terminals.includes(trip.status) && trip.resourceHold, 'Only ended trips with a hold can be released')
      next.resourceHold = false; next.incidentOpen = false; break
    case 'CORRECT_MILESTONE': {
      dispatcher()
      requireRule(!terminals.includes(trip.status) && !trip.incidentOpen && command.physicalStateConfirmed, 'Physical state confirmation required; terminal/incident corrections forbidden')
      const index = milestones.indexOf(trip.status)
      requireRule(index > 0 && milestones[index - 1] === command.target, 'Only the preceding milestone may be restored')
      const pickedUp = trip.events.some(event => event.command.type === 'CONFIRM_PICKUP')
      requireRule(!(pickedUp && command.target === 'PICKING_UP'), 'Recorded pickup requires incident handling, not rollback')
      next.status = command.target; break
    }
    default:
      throw new Error('Unknown trip command')
  }
  return { ...next, revision: trip.revision + 1, events: [...trip.events, { id: eventId, at, actor: { ...actor }, command: structuredClone(command), from: trip.status, to: next.status }] }
}
