import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTrip, transitionTrip } from '../src/domain/lifecycle.ts'
import { assignProductionTrip, modifyProductionTrip } from '../src/domain/assignment.ts'
import { calculateSchedule } from '../src/domain/scheduling.ts'

const officer = { id: 'officer', role: 'dispatcher' }
const now = '2026-11-10T06:00:00+07:00'
const day = clock => `2026-11-12T${clock}:00+07:00`
function fixture() {
  let trip = createProductionTrip('trip', 'requester')
  trip = transitionTrip(trip, { type: 'APPROVE' }, officer, 'approve', now)
  trip = transitionTrip(trip, { type: 'CONFIRM_SCHEDULE' }, officer, 'schedule', now)
  const resource = id => ({ id, active: true, locationId: 'depot', availableAt: day('06:00'),
    windows: [{ from: day('06:00'), until: day('16:00') }], capabilities: ['standard'], holds: [] })
  const state = { trips: [trip], scheduling: { calendar: { timezone: 'Asia/Bangkok', opensAt: '06:00', closesAt: '16:00', closureDates: [] },
    vehicles: [resource('v1'), resource('v2')], drivers: [resource('d1'), resource('d2')], reservations: [] } }
  const input = { request: { tripId: 'trip', submittedAt: now, appointmentAt: day('09:00'), pickupId: 'pickup', hospitalId: 'hospital', mobility: 'standard' },
    vehicleId: 'v1', driverId: 'd1', origin: { kind: 'depot', locationId: 'depot' },
    originToPickup: { fromId: 'depot', toId: 'pickup', minutes: 15 }, pickupToHospital: { fromId: 'pickup', toId: 'hospital', minutes: 35 } }
  const result = assignProductionTrip(state, input, officer, 'assign', now)
  assert.equal(result.ok, true)
  return { state: result.state, input }
}
function advance(state, type, at = day('07:50')) {
  const trip = state.trips[0]
  return { ...state, trips: [transitionTrip(trip, { type }, { id: trip.driverId, role: 'driver' }, `${type}-${trip.events.length}`, at, trip.executionVersion)] }
}

test('earlier pickup changes waiting only and is audited without duplicate driver notices', () => {
  const { state, input } = fixture()
  const before = globalThis.structuredClone(state)
  const result = modifyProductionTrip(state, { ...input, pickupWaitingMinutes: 10 }, officer, 'modify', now, 'Earlier pickup requested', state.trips[0].revision)
  assert.equal(result.ok, true)
  const old = state.scheduling.reservations[0].schedule
  const next = result.state.scheduling.reservations[0]
  assert.equal(Date.parse(old.pickupAt) - Date.parse(next.schedule.pickupAt), 600000)
  assert.equal(next.schedule.arrivalAt, old.arrivalAt)
  assert.equal(next.schedule.readyAt, old.readyAt)
  assert.deepEqual(next.input.pickupToHospital, input.pickupToHospital)
  assert.equal(result.state.scheduleHistory.length, 1)
  assert.equal(result.state.outbox.filter(notice => notice.event === 'ASSIGNMENT_CHANGED').length, 2)
  assert.deepEqual(state, before)
  for (const waiting of [-1, 0.5, Infinity]) assert.throws(() => calculateSchedule({ ...input, pickupWaitingMinutes: waiting }, state.scheduling.calendar))
})

test('unauthorized, missing reason and stale modifications fail', () => {
  const { state, input } = fixture()
  assert.throws(() => modifyProductionTrip(state, input, { id: 'admin', role: 'admin' }, 'bad', now, 'Reason', state.trips[0].revision))
  assert.throws(() => modifyProductionTrip(state, input, officer, 'bad', now, ' ', state.trips[0].revision))
  assert.throws(() => modifyProductionTrip(state, input, officer, 'bad', now, 'Reason', 1))
})

test('failed reschedule preserves lifecycle, reservations, history and outbox', () => {
  const { state, input } = fixture()
  const result = modifyProductionTrip(state, { ...input, pickupWaitingMinutes: 180 }, officer, 'bad', now, 'Earlier pickup', state.trips[0].revision)
  assert.equal(result.ok, false)
  assert.equal(result.state, state)
  assert.equal(state.scheduleHistory, undefined)
})

test('pre-pickup reassignment holds old resources and requires new Start Trip/version', () => {
  let { state, input } = fixture()
  state = advance(state, 'START_TRIP')
  state = advance(state, 'DEPART_ORIGIN')
  const changed = { ...input, request: { ...input.request, appointmentAt: day('09:30') }, vehicleId: 'v2', driverId: 'd2' }
  assert.throws(() => modifyProductionTrip(state, changed, officer, 'change', day('07:55'), 'Breakdown', state.trips[0].revision))
  const result = modifyProductionTrip(state, changed, officer, 'change', day('07:55'), 'Breakdown', state.trips[0].revision,
    { locationId: 'safe-point', confirmedAt: day('07:55'), note: 'Old team waits safely; replacement dispatched' })
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  const trip = result.state.trips[0]
  assert.equal(trip.status, 'ASSIGNED')
  assert.equal(trip.startedAt, undefined)
  assert.equal(trip.executionVersion, 1)
  assert.equal(trip.cancellationLocked, true)
  assert.throws(() => transitionTrip(trip, { type: 'CANCEL', reason: 'Already underway' }, { id: 'requester', role: 'citizen' }, 'cancel-after-reassign', day('08:00')))
  assert.equal(result.state.scheduling.vehicles[0].holds.length, 1)
  assert.equal(result.state.scheduling.drivers[0].holds.length, 1)
  assert.throws(() => transitionTrip(trip, { type: 'START_TRIP' }, { id: 'd1', role: 'driver' }, 'stale-driver', day('08:00'), 0))
  assert.throws(() => transitionTrip(trip, { type: 'START_TRIP' }, { id: 'd2', role: 'driver' }, 'stale-version', day('08:00'), 0))
  let next = advance(result.state, 'START_TRIP', day('08:00'))
  for (const command of ['DEPART_ORIGIN', 'CONFIRM_PICKUP', 'DEPART_FOR_HOSPITAL', 'CONFIRM_HANDOVER']) next = advance(next, command, day('08:20'))
  assert.equal(next.trips[0].status, 'COMPLETED')
  assert.equal(next.trips[0].resourceHold, true)
  const ready = transitionTrip(next.trips[0], { type: 'CONFIRM_READY', reason: 'Turnaround and readiness checked' }, officer, 'ready', day('09:40'))
  assert.equal(ready.resourceHold, false)
  assert.equal(result.state.outbox.filter(notice => notice.event === 'ASSIGNMENT_CHANGED').length, 3)
})

test('retained active resources require a verified handoff origin; pickup forbids reassignment', () => {
  let { state, input } = fixture()
  state = advance(state, 'START_TRIP'); state = advance(state, 'DEPART_ORIGIN')
  const arrangement = { locationId: 'safe-point', confirmedAt: day('07:55'), note: 'Physical location and readiness checked' }
  const changed = { ...input, request: { ...input.request, appointmentAt: day('09:30') } }
  assert.throws(() => modifyProductionTrip(state, changed, officer, 'wrong-origin', day('07:55'), 'Reroute', state.trips[0].revision, arrangement))
  const result = modifyProductionTrip(state, { ...changed, origin: { kind: 'handoff', locationId: 'safe-point' },
    originToPickup: { fromId: 'safe-point', toId: 'pickup', minutes: 10 } }, officer, 'handoff', day('07:55'), 'Reroute', state.trips[0].revision, arrangement)
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  state = advance(state, 'CONFIRM_PICKUP')
  assert.throws(() => modifyProductionTrip(state, changed, officer, 'after-pickup', day('08:00'), 'Reroute', state.trips[0].revision, arrangement))
})

test('breakdown journey can resume or end ABORTED; failed pickup retains readiness hold', () => {
  let { state } = fixture()
  for (const command of ['START_TRIP', 'DEPART_ORIGIN', 'CONFIRM_PICKUP']) state = advance(state, command)
  const driver = { id: 'd1', role: 'driver' }
  const trip = transitionTrip(state.trips[0], { type: 'REPORT_INCIDENT', reason: 'Breakdown' }, driver, 'incident', day('08:10'))
  assert.equal(trip.status, 'PICKED_UP')
  const resumed = transitionTrip(trip, { type: 'RESOLVE_INCIDENT', reason: 'Vehicle repaired and checked' }, officer, 'resolved', day('08:15'))
  assert.equal(transitionTrip(resumed, { type: 'DEPART_FOR_HOSPITAL' }, driver, 'resume', day('08:20')).status, 'IN_TRANSIT')
  const aborted = transitionTrip(trip, { type: 'ABORT', reason: 'Transport ended', endedAt: day('08:15'), location: 'Safe location', disposition: 'Authorized caregiver handoff confirmed' }, officer, 'aborted', day('08:20'))
  assert.equal(aborted.status, 'ABORTED'); assert.equal(aborted.resourceHold, true)
  let failed = fixture().state
  failed = advance(failed, 'START_TRIP'); failed = advance(failed, 'DEPART_ORIGIN')
  const cancelled = transitionTrip(failed.trips[0], { type: 'FAILED_PICKUP', reason: 'Patient absent' }, driver, 'failed', day('08:10'))
  assert.equal(cancelled.status, 'CANCELLED'); assert.equal(cancelled.resourceHold, true)
})

test('incident handoff preserves an existing released-driver hold without duplicating it and closes only retained-resource holds', () => {
  let { state, input } = fixture()
  state = advance(state, 'START_TRIP'); state = advance(state, 'DEPART_ORIGIN')
  state.trips[0] = transitionTrip(state.trips[0], { type: 'REPORT_INCIDENT', reason: 'Driver unavailable' },
    { id: 'd1', role: 'driver' }, 'incident-before-handoff', day('07:51'), state.trips[0].executionVersion)
  const originalHold = { from: day('07:51'), reason: 'Driver unavailable', tripId: 'trip' }
  state.scheduling.vehicles[0].holds = [{ ...originalHold }]
  state.scheduling.drivers[0].holds = [{ ...originalHold }]
  state.scheduling.drivers[1].positionUpdates = [{ at: day('07:54'), locationId: 'safe-point' }]
  const before = structuredClone(state)
  const replacement = { ...input, driverId: 'd2', request: { ...input.request, appointmentAt: day('09:30') },
    origin: { kind: 'handoff', locationId: 'safe-point' }, originToPickup: { fromId: 'safe-point', toId: 'pickup', minutes: 10 } }
  const result = modifyProductionTrip(state, replacement, officer, 'incident-handoff', day('07:55'), 'Verified driver replacement', state.trips[0].revision,
    { locationId: 'safe-point', confirmedAt: day('07:55'), note: 'Vehicle verified safe; old driver remains held' })
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  assert.deepEqual(result.state.scheduling.drivers[0].holds, [originalHold])
  assert.deepEqual(result.state.scheduling.vehicles[0].holds, [{ ...originalHold, until: day('07:55') }])
  assert.equal(result.state.trips[0].incidentOpen, false)
  assert.equal(result.state.trips[0].cancellationLocked, true)
  assert.equal(result.state.trips[0].driverId, 'd2')
  assert.deepEqual(state, before)
})
