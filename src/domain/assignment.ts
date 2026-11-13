import { transitionTrip } from './lifecycle.ts'
import type { ProductionTrip, TripActor } from './lifecycle.ts'
import { confirmReservation } from './scheduling.ts'
import type { ReservedTrip, ScheduleInput, SchedulingContext, SchedulingIssue } from './scheduling.ts'

export interface AssignmentNotice {
  key: string
  tripId: string
  recipient: 'citizen' | 'driver'
  recipientId: string
  event: 'ASSIGNED' | 'ASSIGNMENT_CHANGED'
  meaning?: 'changed' | 'removed' | 'assigned'
}

export interface ProductionDispatchState {
  trips: ProductionTrip[]
  scheduling: SchedulingContext
  outbox?: AssignmentNotice[]
  scheduleHistory?: ReservedTrip[]
}

function notices(trip: ProductionTrip, driverIds: string[], eventId: string, event: AssignmentNotice['event']): AssignmentNotice[] {
  return [{ key: `${eventId}:citizen:${trip.requesterId}`, tripId: trip.id, recipient: 'citizen', recipientId: trip.requesterId, event },
    ...[...new Set(driverIds)].map(id => ({ key: `${eventId}:driver:${id}`, tripId: trip.id, recipient: 'driver' as const, recipientId: id, event,
      meaning:event==='ASSIGNMENT_CHANGED'&&new Set(driverIds).size>1?id===trip.driverId?'assigned' as const:'removed' as const:'changed' as const }))]
}

export function modifyProductionTrip(
  state: ProductionDispatchState, input: ScheduleInput, actor: TripActor, eventId: string, at: string,
  reason: string, expectedRevision: number,
  arrangement?: { locationId: string; confirmedAt: string; note: string },
): AssignmentResult {
  const trip = state.trips.find(current => current.id === input.request.tripId)
  if (!trip || trip.revision !== expectedRevision) throw new Error('Trip changed; reload current revision')
  const command = { type: 'MODIFY_ASSIGNMENT' as const, vehicleId: input.vehicleId, driverId: input.driverId, reason, ...(arrangement ? { arrangement } : {}) }
  const modified = transitionTrip(trip, command, actor, eventId, at)
  const previous = state.scheduling.reservations.find(record => record.input.request.tripId === trip.id)
  if (!previous) throw new Error('Current committed reservation required')
  const scheduling = structuredClone(state.scheduling)
  if (trip.startedAt && arrangement) {
    for (const kind of ['vehicles', 'drivers'] as const) {
      const oldId = kind === 'vehicles' ? trip.vehicleId : trip.driverId
      const newId = kind === 'vehicles' ? input.vehicleId : input.driverId
      const old = scheduling[kind].find(resource => resource.id === oldId)
      if (!old) throw new Error('Current resource missing')
      if (oldId !== newId) {
        if (!old.holds.some(hold => hold.tripId === trip.id && !hold.until)) {
          old.holds.push({ from: at, reason, tripId: trip.id })
        }
      } else {
        if (input.origin.kind !== 'handoff' || input.origin.locationId !== arrangement.locationId) throw new Error('Retained resource requires a verified handoff origin')
        old.positionUpdates = [...(old.positionUpdates ?? []), { at, locationId: arrangement.locationId }]
        old.holds = old.holds.flatMap(hold => hold.tripId === trip.id && !hold.until
          ? Date.parse(hold.from) < Date.parse(at) ? [{ ...hold, until: at }] : [] : [hold])
      }
    }
  }
  const result = confirmReservation(scheduling, input, at, true)
  if (!result.ok) return { ok: false, state, issues: result.issues }
  return { ok: true, state: {
    ...state, trips: state.trips.map(current => current.id === trip.id ? modified : current), scheduling: result.context,
    scheduleHistory: [...(state.scheduleHistory ?? []), structuredClone(previous)],
    outbox: [...(state.outbox ?? []), ...notices(modified, [trip.driverId!, input.driverId], eventId, 'ASSIGNMENT_CHANGED')],
  } }
}
export type AssignmentResult =
  | { ok: true; state: ProductionDispatchState }
  | { ok: false; state: ProductionDispatchState; issues: SchedulingIssue[] }

/** Trusted server actor required. Persist both changes in a single database
 * transaction with resource exclusion constraints; this is an in-memory reducer.
 */
export function assignProductionTrip(
  state: ProductionDispatchState, input: ScheduleInput, actor: TripActor, eventId: string, at: string,
): AssignmentResult {
  if (actor.role !== 'dispatcher') throw new Error('Dispatcher authority required')
  const matches = state.trips.filter(trip => trip.id === input.request.tripId)
  if (matches.length !== 1) throw new Error('A unique trip is required')
  const trip = matches[0]
  // Validate state/identity before preparing a resource commit.
  const assigned = transitionTrip(trip, { type: 'ASSIGN', vehicleId: input.vehicleId, driverId: input.driverId }, actor, eventId, at)
  const result = confirmReservation(state.scheduling, input, at)
  if (!result.ok) return { ok: false, state, issues: result.issues }
  return { ok: true, state: { ...state, trips: state.trips.map(current => current.id === trip.id ? assigned : current), scheduling: result.context,
    outbox: [...(state.outbox ?? []), ...notices(assigned, [input.driverId], eventId, 'ASSIGNED')] } }
}
