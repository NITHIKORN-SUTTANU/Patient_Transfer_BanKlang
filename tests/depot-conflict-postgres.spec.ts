import { expect, test } from '@playwright/test'
import { ids, startOperationalTestApi } from './helpers/operational-postgres'

test('depot trips can touch at hospital arrival, and actual handover releases both resources immediately', async () => {
  test.setTimeout(60000)
  test.skip(!process.env.DATABASE_TEST_ADMIN_URL, 'Local test database required')
  const f = await startOperationalTestApi()
  try {
    let first = await f.assigned('09:00')
    expect(first.schedule?.readyAt).toBe(first.schedule?.arrivalAt)
    const overlap = await f.command(await f.requested('09:49'), 'APPROVE')
    const failure = await f.request(`/bookings/${overlap.id}/schedule`, 'dispatcher', f.selection(overlap), 409)
    expect(failure.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CONFLICT', resourceId: ids.vehicle }),
      expect.objectContaining({ code: 'CONFLICT', resourceId: ids.driver }),
    ]))
    const next = await f.command(await f.requested('09:50'), 'APPROVE')
    const oldOrigin = { originKind: 'previous_hospital', originLocationId: first.hospitalLocationId, previousBookingId: first.id }
    await f.request(`/bookings/${next.id}/schedule`, 'dispatcher', f.selection(next, oldOrigin), 422)
    const proposed = await f.request(`/bookings/${next.id}/schedule`, 'dispatcher', f.selection(next))
    const second = await f.request(`/bookings/${next.id}/assignment`, 'dispatcher', f.selection(proposed))
    expect(second.schedule).toMatchObject({ originLocationId: ids.depot, departureAt: first.schedule?.arrivalAt })

    f.control.now = first.schedule!.departureAt
    await f.login('driver')
    first = await f.command(first, 'START_TRIP', {}, 'driver')
    first = await f.command(first, 'DEPART_ORIGIN', {}, 'driver')
    f.control.now = first.schedule!.pickupAt
    first = await f.command(first, 'CONFIRM_PICKUP', {}, 'driver')
    first = await f.command(first, 'DEPART_FOR_HOSPITAL', {}, 'driver')
    f.control.now = second.schedule.departureAt
    await f.command(second, 'START_TRIP', {}, 'driver', 409)
    first = await f.command(first, 'CONFIRM_HANDOVER', {}, 'driver')
    expect(first).toMatchObject({ status: 'COMPLETED', resourceHold: false, vehicleId: ids.vehicle, driverId: ids.driver })
    const { rows } = await f.pool.query(
      'SELECT handover_at FROM patient_transfer.schedules WHERE booking_id=$1 AND committed AND released_at IS NULL', [first.id],
    )
    expect(rows[0].handover_at.toISOString()).toBe(f.control.now)
    expect((await f.command(second, 'START_TRIP', {}, 'driver')).startedAt).toBe(f.control.now)
  } finally {
    await f.close()
  }
})
