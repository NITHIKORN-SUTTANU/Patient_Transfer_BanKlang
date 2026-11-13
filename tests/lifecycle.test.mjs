import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProductionTrip, transitionTrip } from '../src/domain/lifecycle.ts'

const dispatcher = { id: 'officer', role: 'dispatcher' }
const driver = { id: 'driver', role: 'driver' }
const citizen = { id: 'requester', role: 'citizen' }
const at = '2026-11-12T01:00:00Z'
function act(trip, command, actor = dispatcher, id = `event-${trip.events.length}`) {
  return transitionTrip(trip, command, actor, id, at)
}
function assigned() {
  let trip = createProductionTrip('trip', citizen.id)
  for (const command of [{ type: 'APPROVE' }, { type: 'CONFIRM_SCHEDULE' }, { type: 'ASSIGN', vehicleId: 'vehicle', driverId: driver.id }]) trip = act(trip, command)
  return trip
}
function onboard() {
  let trip = assigned()
  for (const type of ['START_TRIP', 'DEPART_ORIGIN', 'CONFIRM_PICKUP']) trip = act(trip, { type }, driver)
  return trip
}

test('destination revision preserves onboard phase, pickup and holds while invalidating stale driver actions',()=>{
  const trip=act(onboard(),{type:'REPORT_INCIDENT',reason:'Road obstruction'})
  const revised=act(trip,{type:'REVISE_DESTINATION',hospitalId:'new-hospital',reason:'Verified supported hospital'})
  assert.equal(revised.status,'PICKED_UP');assert.equal(revised.startedAt,trip.startedAt)
  assert.equal(revised.incidentOpen,true);assert.equal(revised.resourceHold,true)
  assert.equal(revised.executionVersion,trip.executionVersion+1)
  assert.deepEqual(revised.events.slice(0,-1),trip.events)
  assert.throws(()=>act(revised,{type:'DEPART_FOR_HOSPITAL'},driver),/execution version/)
  assert.throws(()=>act(assigned(),{type:'REVISE_DESTINATION',hospitalId:'hospital',reason:'Too early'}),/not permitted/)
})

test('normal lifecycle separates Start Trip from departure and retains history', () => {
  const before = assigned()
  let trip = act(before, { type: 'START_TRIP' }, driver)
  assert.equal(trip.status, 'ASSIGNED')
  assert.equal(trip.startedAt, at)
  assert.equal(before.startedAt, undefined)
  for (const type of ['DEPART_ORIGIN', 'CONFIRM_PICKUP', 'DEPART_FOR_HOSPITAL', 'CONFIRM_HANDOVER']) trip = act(trip, { type }, driver)
  assert.equal(trip.status, 'COMPLETED')
  assert.equal(trip.events.length, 8)
  assert.equal(trip.resourceHold, true)
})

test('identity, order, reasons, and both resources are enforced', () => {
  assert.throws(() => act(assigned(), { type: 'START_TRIP' }, { ...driver, id: 'other' }))
  assert.throws(() => act(assigned(), { type: 'DEPART_ORIGIN' }, driver))
  assert.throws(() => act(assigned(), { type: 'CONFIRM_PICKUP' }, driver))
  assert.throws(() => act(assigned(), { type: 'REJECT', reason: ' ' }))
  assert.throws(() => act(createProductionTrip('t', citizen.id), { type: 'APPROVE' }, citizen))
  let scheduled = act(createProductionTrip('t', citizen.id), { type: 'APPROVE' })
  scheduled = act(scheduled, { type: 'CONFIRM_SCHEDULE' })
  assert.throws(() => act(scheduled, { type: 'ASSIGN', driverId: '', vehicleId: 'v' }))
})

test('citizen cancellation stops at Start Trip, including while ASSIGNED', () => {
  assert.equal(act(assigned(), { type: 'CANCEL', reason: 'Changed plans' }, citizen).status, 'CANCELLED')
  const trip = act(assigned(), { type: 'START_TRIP' }, driver)
  assert.throws(() => act(trip, { type: 'CANCEL', reason: 'Changed plans' }, citizen))
  const reset = act(trip, { type: 'UNDO_START', reason: 'Accidental start' })
  assert.equal(reset.startedAt, undefined)
  assert.equal(act(reset, { type: 'CANCEL', reason: 'Changed plans' }, citizen).status, 'CANCELLED')
})

test('failed pickup holds resources and is forbidden after pickup', () => {
  let trip = act(assigned(), { type: 'START_TRIP' }, driver)
  trip = act(trip, { type: 'DEPART_ORIGIN' }, driver)
  trip = act(trip, { type: 'FAILED_PICKUP', reason: 'Patient absent' }, driver)
  assert.equal(trip.status, 'CANCELLED')
  assert.equal(trip.resourceHold, true)
  assert.throws(() => act(trip, { type: 'CONFIRM_READY', reason: 'Ready' }, driver))
  assert.equal(act(trip, { type: 'CONFIRM_READY', reason: 'Readiness checked' }).resourceHold, false)
  assert.throws(() => act(onboard(), { type: 'FAILED_PICKUP', reason: 'Absent' }, driver))
  assert.throws(() => act(onboard(), { type: 'CANCEL', reason: 'Stop' }))
})

test('incident stays active; resumed transport or ABORTED requires dispatcher', () => {
  const trip = act(onboard(), { type: 'REPORT_INCIDENT', reason: 'Vehicle unavailable' }, driver)
  assert.equal(trip.status, 'PICKED_UP')
  assert.equal(trip.resourceHold, true)
  assert.throws(() => act(trip, { type: 'DEPART_FOR_HOSPITAL' }, driver))
  const resolved = act(trip, { type: 'RESOLVE_INCIDENT', reason: 'Vehicle checked; safe to resume' })
  assert.equal(act(resolved, { type: 'DEPART_FOR_HOSPITAL' }, driver).status, 'IN_TRANSIT')
  const command = { type: 'ABORT', reason: 'Transport ended', endedAt: at, location: 'Agreed location', disposition: 'Handoff to authorized caregiver confirmed' }
  assert.throws(() => act(trip, command, driver))
  assert.throws(() => act(trip, { ...command, disposition: '' }))
  const ended = act(trip, command)
  assert.equal(ended.status, 'ABORTED')
  assert.equal(ended.resourceHold, true)
})

test('corrections append history and cannot undo pickup or reopen terminal trips', () => {
  let trip = act(assigned(), { type: 'START_TRIP' }, driver)
  trip = act(trip, { type: 'DEPART_ORIGIN' }, driver)
  const command = { type: 'CORRECT_MILESTONE', target: 'ASSIGNED', reason: 'Tapped departure accidentally', physicalStateConfirmed: true }
  assert.throws(() => act(trip, command, driver))
  assert.throws(() => act(trip, { ...command, physicalStateConfirmed: false }))
  const corrected = act(trip, command)
  assert.equal(corrected.status, 'ASSIGNED')
  assert.deepEqual(corrected.events.slice(0, -1), trip.events)
  assert.throws(() => act(onboard(), { ...command, target: 'PICKING_UP' }))
  let completed = act(onboard(), { type: 'DEPART_FOR_HOSPITAL' }, driver)
  completed = act(completed, { type: 'CONFIRM_HANDOVER' }, driver)
  assert.throws(() => act(completed, { ...command, target: 'IN_TRANSIT' }))
})

test('retry is idempotent but identifier reuse and old timestamps fail', () => {
  const original = assigned()
  const command = { type: 'START_TRIP' }
  const trip = act(original, command, driver, 'retry-id')
  assert.equal(act(trip, command, driver, 'retry-id'), trip)
  assert.throws(() => act(trip, { type: 'DEPART_ORIGIN' }, driver, 'retry-id'))
  assert.throws(() => transitionTrip(trip, { type: 'DEPART_ORIGIN' }, driver, 'old', '2026-11-11T00:00:00Z'))
})
