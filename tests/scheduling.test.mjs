import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateSchedule, confirmReservation, proposeReservation, validateReservations, reviewCalendarChange } from '../src/domain/scheduling.ts'
import { isAppointmentClock } from '../src/domain/appointmentHours.ts'
import { checkCitizenSlotCapacity, computeBackwardBlockedWindow } from '../src/domain/capacity.ts'
import { assignProductionTrip } from '../src/domain/assignment.ts'
import { createProductionTrip, transitionTrip } from '../src/domain/lifecycle.ts'

const now = '2026-11-10T06:00:00+07:00'
const calendar = { timezone: 'Asia/Bangkok', opensAt: '06:00', closesAt: '16:00', closureDates: [] }
const stamp = clock => `2026-11-12T${clock}:00+07:00`
function input(id = 'first', appointment = '09:00', overrides = {}) {
  return { request: { tripId: id, submittedAt: now, appointmentAt: stamp(appointment), pickupId: 'pickup', hospitalId: 'hospital', mobility: 'standard' },
    vehicleId: 'vehicle', driverId: 'driver', origin: { kind: 'depot', locationId: 'depot' },
    originToPickup: { fromId: 'depot', toId: 'pickup', minutes: 15 },
    pickupToHospital: { fromId: 'pickup', toId: 'hospital', minutes: 35 }, ...overrides }
}
function resource(id) {
  return { id, active: true, locationId: 'depot', availableAt: stamp('06:00'),
    windows: [{ from: stamp('06:00'), until: stamp('16:00') }], capabilities: ['standard', 'wheelchair'], holds: [] }
}
function context() { return { calendar, vehicles: [resource('vehicle')], drivers: [resource('driver')], reservations: [] } }
function reserve(ctx, request) {
  const result = confirmReservation(ctx, request, now)
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  return result.context
}
function chained(appointment = '11:00') {
  return input('second', appointment, { origin: { kind: 'previous_hospital', locationId: 'hospital', previousTripId: 'first' },
    originToPickup: { fromId: 'hospital', toId: 'pickup', minutes: 20 } })
}
const codes = result => result.issues.map(issue => issue.code)

test('continuation retains the original schedule and checks the revised arrival against later work',()=>{
  const ctx=reserve(context(),input())
  const planned=structuredClone(ctx.reservations[0].schedule)
  ctx.reservations[0].continuation={hospitalId:'new-hospital',recordedAt:stamp('16:00'),arrivalAt:stamp('17:00'),readyAt:stamp('17:00')}
  assert.deepEqual(validateReservations(ctx),[])
  assert.deepEqual(ctx.reservations[0].schedule,planned)
  const later=confirmReservation(ctx,input('second','11:00'),now)
  assert.equal(later.ok,false);assert.ok(codes(later).includes('CONFLICT'))
  ctx.reservations[0].continuation.readyAt=stamp('16:59')
  assert.ok(validateReservations(ctx).some(issue=>issue.code==='INVALID'))
})

test('reverse scheduling ends occupancy at the buffered hospital arrival', () => {
  const schedule = calculateSchedule(input(), calendar)
  assert.equal(schedule.departureAt, new Date(stamp('07:50')).toISOString())
  assert.equal(schedule.pickupAt, new Date(stamp('08:05')).toISOString())
  assert.equal(schedule.arrivalAt, new Date(stamp('08:40')).toISOString())
  assert.equal(schedule.readyAt, schedule.arrivalAt)
})

test('48-hour boundary is inclusive and no maximum advance booking applies', () => {
  const exact = input('exact', '09:00')
  exact.request.submittedAt = '2026-11-10T09:00:00+07:00'
  assert.doesNotThrow(() => calculateSchedule(exact, calendar))
  exact.request.submittedAt = '2026-11-10T09:00:01+07:00'
  assert.throws(() => calculateSchedule(exact, calendar), { code: 'LEAD_TIME' })
  exact.request.appointmentAt = '2028-11-12T09:00:00+07:00'
  assert.doesNotThrow(() => calculateSchedule(exact, calendar))
})

test('appointment hours are inclusive and early departure still requires a covering driver shift', () => {
  assert.equal(isAppointmentClock('06:00:00.000'), true)
  assert.equal(isAppointmentClock('16:00:00.000'), true)
  assert.equal(isAppointmentClock('05:59:59.999'), false)
  assert.equal(isAppointmentClock('16:00:00.001'), false)
  const early = input('early', '06:00')
  assert.equal(calculateSchedule(early, calendar).departureAt, new Date(stamp('04:50')).toISOString())
  const ctx = context()
  assert.ok(codes(confirmReservation(ctx, early, now)).includes('SHIFT'))
  ctx.drivers[0].windows[0].from = stamp('04:50')
  assert.equal(confirmReservation(ctx, early, now).ok, true)
  const utc = input(); utc.request.appointmentAt = '2026-11-12T02:00:00Z'
  assert.deepEqual(calculateSchedule(utc, calendar), calculateSchedule(input(), calendar))
})

test('closures, invalid dates, absent routing and wrong route endpoints fail explicitly', () => {
  assert.throws(() => calculateSchedule(input(), { ...calendar, closureDates: ['2026-11-12'] }), { code: 'CLOSED' })
  assert.throws(() => calculateSchedule(input(), { ...calendar, closureDates: ['2026-02-30'] }), { code: 'INVALID' })
  for (const minutes of [NaN, Infinity, -1]) {
    assert.throws(() => calculateSchedule(input('bad', '09:00', { originToPickup: { fromId: 'depot', toId: 'pickup', minutes } }), calendar), { code: 'INVALID' })
  }
  const invalid = input(); invalid.request.appointmentAt = '2026-11-12T09:00:00'
  assert.throws(() => calculateSchedule(invalid, calendar), { code: 'INVALID' })
  invalid.request.appointmentAt = '2026-02-30T09:00:00+07:00'
  assert.throws(() => calculateSchedule(invalid, calendar), { code: 'INVALID' })
  assert.throws(() => calculateSchedule(input('bad', '09:00', { originToPickup: { fromId: 'wrong', toId: 'pickup', minutes: 15 } }), calendar), { code: 'INVALID' })
})

test('proposals do not reserve resources; later confirmations see latest conflicts', () => {
  const ctx = context()
  proposeReservation(ctx, input())
  assert.equal(ctx.reservations.length, 0)
  const committed = reserve(ctx, input())
  const result = confirmReservation(committed, input('competing'), now)
  assert.equal(result.ok, false)
  assert.ok(codes(result).includes('CONFLICT'))
  assert.equal(result.context, committed)
  assert.equal(committed.reservations.length, 1)
})

test('each driver and vehicle independently prevents overlap', () => {
  const ctx = reserve(context(), input())
  ctx.vehicles.push(resource('other-vehicle')); ctx.drivers.push(resource('other-driver'))
  const vehicleConflict = confirmReservation(ctx, input('vehicle-only', '09:00', { driverId: 'other-driver' }), now)
  assert.ok(vehicleConflict.issues.some(issue => issue.code === 'CONFLICT' && issue.resourceId === 'vehicle'))
  const driverConflict = confirmReservation(ctx, input('driver-only', '09:00', { vehicleId: 'other-vehicle' }), now)
  assert.ok(driverConflict.issues.some(issue => issue.code === 'CONFLICT' && issue.resourceId === 'driver'))
})

test('depot departure can equal prior hospital arrival; one minute earlier fails', () => {
  const ctx = reserve(context(), input())
  const next = confirmReservation(ctx, input('second', '09:50'), now)
  assert.equal(next.ok, true, JSON.stringify(next.issues))
  assert.equal(next.reservation.schedule.departureAt, ctx.reservations[0].schedule.readyAt)
  const early = confirmReservation(ctx, input('second', '09:49'), now)
  assert.equal(early.ok, false)
  assert.ok(codes(early).includes('CONFLICT'))
})

test('a legacy hospital-origin reservation remains readable, and new proposals must start at the depot', () => {
  const ctx = reserve(context(), input())
  ctx.drivers.push(resource('replacement'))
  const next = chained(); next.driverId = 'replacement'
  const result = confirmReservation(ctx, next, now)
  assert.equal(result.ok, false)
  assert.ok(codes(result).includes('LOCATION'))
  const historical = { ...chained(), historicalTurnaroundMinutes: 30 }
  ctx.reservations.push({ input: historical, schedule: calculateSchedule(historical, calendar) })
  assert.deepEqual(validateReservations(ctx), [])
})

test('capabilities, shifts, inactive resources and readiness holds are enforced', () => {
  const ctx = context()
  const request = input(); request.request.mobility = 'stretcher'
  assert.ok(codes(confirmReservation(ctx, request, now)).includes('CAPABILITY'))
  ctx.drivers[0].windows = [{ from: stamp('08:00'), until: stamp('16:00') }]
  assert.ok(codes(confirmReservation(ctx, input(), now)).includes('SHIFT'))
  ctx.drivers[0] = resource('driver')
  ctx.vehicles[0].holds = [{ from: stamp('06:00'), reason: 'Readiness unconfirmed' }]
  assert.ok(codes(confirmReservation(ctx, input(), now)).includes('HOLD'))
  ctx.vehicles[0] = { ...resource('vehicle'), active: false }
  assert.ok(codes(confirmReservation(ctx, input(), now)).includes('RESOURCE'))
})

test('schedule changes revalidate downstream and preserve existing schedules on failure', () => {
  let ctx = reserve(context(), input())
  ctx = reserve(ctx, input('second', '09:50'))
  const before = globalThis.structuredClone(ctx)
  const failed = confirmReservation(ctx, input('first', '09:15'), now, true)
  assert.equal(failed.ok, false)
  assert.ok(failed.issues.some(issue => issue.tripId === 'second' && issue.code === 'CONFLICT'))
  assert.equal(failed.context, ctx)
  assert.deepEqual(ctx, before)
  const changedDestination = input()
  changedDestination.request.hospitalId = 'other-hospital'
  changedDestination.pickupToHospital.toId = 'other-hospital'
  assert.equal(confirmReservation(ctx, changedDestination, now, true).ok, true)
})

test('calendar change flags affected assignments and never cancels or mutates them', () => {
  const ctx = reserve(context(), input())
  const changed = reviewCalendarChange(ctx, { ...calendar, closureDates: ['2026-11-12'] })
  assert.ok(changed.issues.some(issue => issue.code === 'CLOSED' && issue.tripId === 'first'))
  assert.equal(changed.context.reservations, ctx.reservations)
  assert.deepEqual(ctx.calendar.closureDates, [])
})

test('malformed stored schedules and past departures cannot be confirmed', () => {
  const ctx = reserve(context(), input())
  ctx.reservations[0].schedule = Object.fromEntries(Object.entries(ctx.reservations[0].schedule).reverse())
  assert.deepEqual(validateReservations(ctx), [])
  ctx.reservations[0].schedule.readyAt = stamp('08:50')
  assert.ok(validateReservations(ctx).some(issue => issue.code === 'STALE'))
  assert.equal(confirmReservation(context(), input(), stamp('08:00')).ok, false)
})

test('deterministic collision simulation accepts zero overlapping assignments', () => {
  let ctx = context()
  let accepted = 0
  // Many independent recommendations contend for the same resources and interval.
  for (let i = 0; i < 100; i++) {
    const result = confirmReservation(ctx, input(`simulation-${i}`), now)
    if (result.ok) { accepted++; ctx = result.context }
    else assert.ok(codes(result).includes('CONFLICT'))
  }
  assert.equal(accepted, 1)
  assert.deepEqual(validateReservations(ctx), [])
})

test('dispatcher assignment commits lifecycle and both reservations together or neither', () => {
  const officer = { id: 'officer', role: 'dispatcher' }
  function scheduled(id) {
    let trip = createProductionTrip(id, 'requester')
    trip = transitionTrip(trip, { type: 'APPROVE' }, officer, `${id}-approve`, now)
    return transitionTrip(trip, { type: 'CONFIRM_SCHEDULE' }, officer, `${id}-schedule`, now)
  }
  const state = { trips: [scheduled('first'), scheduled('second')], scheduling: context() }
  assert.throws(() => assignProductionTrip(state, input(), { id: 'admin', role: 'admin' }, 'assign', now))
  const result = assignProductionTrip(state, input(), officer, 'assign', now)
  assert.equal(result.ok, true)
  assert.equal(result.state.trips[0].status, 'ASSIGNED')
  assert.equal(result.state.scheduling.reservations.length, 1)
  assert.equal(state.trips[0].status, 'SCHEDULED')
  assert.equal(state.scheduling.reservations.length, 0)
  const failed = assignProductionTrip(result.state, input('second'), officer, 'second-assign', now)
  assert.equal(failed.ok, false)
  assert.equal(failed.state, result.state)
  assert.equal(failed.state.trips[1].status, 'SCHEDULED')
})

test('citizen backward-scheduled capacity engine blocks overlapping slots and incompatible mobility', () => {
  const appt = '2026-11-15T13:30:00+07:00'
  const win = computeBackwardBlockedWindow(appt, { hospitalName: 'โรงพยาบาลลำพูน' })
  assert.ok(win)
  // T_appt=13:30 -> T_target=13:10 -> T_pickup=12:45 (25m) -> departure=12:15 (30m), free=13:30+25+30=14:25
  assert.equal(win.pickupClock, '12:45')
  assert.equal(win.departureClock, '12:15')
  assert.equal(win.freeClock, '14:25')

  const twoVehicles = [
    { id: 'v1', active: true, capabilities: ['standard', 'wheelchair'] },
    { id: 'v2', active: true, capabilities: ['standard'] },
  ]
  const existing = [
    { id: 'b1', appointmentAt: appt, mobility: 'standard', status: 'REQUESTED', hospitalName: 'โรงพยาบาลลำพูน' },
    { id: 'b2', appointmentAt: appt, mobility: 'standard', status: 'APPROVED', hospitalName: 'โรงพยาบาลลำพูน' },
  ]
  const thirdOverlap = checkCitizenSlotCapacity({
    appointmentAt: appt,
    hospitalName: 'โรงพยาบาลลำพูน',
    mobility: 'standard',
    vehicles: twoVehicles,
    existingBookings: existing,
    nowMs: Date.parse('2026-11-10T06:00:00+07:00'),
  })
  assert.equal(thirdOverlap.available, false)
  assert.equal(thirdOverlap.reason, 'window_full')
  assert.match(thirdOverlap.message, /ช่วงเวลาเต็ม \/ รถไม่ว่าง/)
  assert.ok(thirdOverlap.alternativeTimes.length > 0)

  const stretcherBlocked = checkCitizenSlotCapacity({
    appointmentAt: '2026-11-15T09:00:00+07:00',
    hospitalName: 'โรงพยาบาลลำพูน',
    mobility: 'stretcher',
    vehicles: twoVehicles,
    existingBookings: [],
    nowMs: Date.parse('2026-11-10T06:00:00+07:00'),
  })
  assert.equal(stretcherBlocked.available, false)
  assert.equal(stretcherBlocked.reason, 'equipment_unavailable')
})
