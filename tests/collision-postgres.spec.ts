import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { startOperationalTestApi, ids } from './helpers/operational-postgres'
import { syntheticPassword } from './helpers/admin-postgres.mjs'
import { recoveryFingerprint } from '../scripts/database/recovery.mjs'

test.use({ actionTimeout: 10000 })
test.beforeEach(() => test.skip(!process.env.DATABASE_TEST_ADMIN_URL, 'Local test database required'))

test('original driver reconciles a lost committed handover response into minimized history without releasing holds', async ({ page }) => {
  test.setTimeout(60000)
  const f = await startOperationalTestApi()
  try {
    let booking = await f.assigned()
    f.control.now = booking.schedule!.departureAt
    await f.login('driver'); await f.login('dispatcher')
    booking = await f.command(booking, 'START_TRIP', {}, 'driver')
    booking = await f.command(booking, 'DEPART_ORIGIN', {}, 'driver')
    f.control.now = booking.schedule!.pickupAt
    booking = await f.command(booking, 'CONFIRM_PICKUP', {}, 'driver')
    booking = await f.command(booking, 'DEPART_FOR_HOSPITAL', {}, 'driver')
    f.control.now = booking.schedule!.arrivalAt
    const original = (await f.pool.query('SELECT * FROM patient_transfer.bookings WHERE id=$1', [booking.id])).rows[0]
    const schedules = (await f.pool.query('SELECT * FROM patient_transfer.schedules ORDER BY id')).rows
    const history = (await f.pool.query('SELECT * FROM patient_transfer.trip_events ORDER BY id')).rows
    await page.clock.setFixedTime(new Date(f.control.now))
    let commandCount = 0, eventId = ''
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url())
      const response = await route.fetch({ url: `${f.base}${url.pathname}${url.search}` })
      if (url.pathname.endsWith('/commands') && request.method() === 'POST') {
        commandCount++
        expect(request.postDataJSON().command.type).toBe('CONFIRM_HANDOVER')
        eventId = request.postDataJSON().eventId
        expect(response.status()).toBe(200)
        // The terminal transaction committed; the browser receives no response.
        await route.abort('failed')
        return
      }
      await route.fulfill({ response })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
    await page.goto(`/staff/login?next=${encodeURIComponent(`/driver/status?booking=${booking.id}`)}`)
    await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill('synthetic-driver')
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByRole('link', { name: 'เปิดหน้าคนขับ', exact: true }).click()
    await page.getByRole('button', { name: 'ส่งถึงโรงพยาบาลแล้ว', exact: true }).click()
    const failed = page.waitForEvent('requestfailed', { predicate: r => r.url().endsWith('/commands') && r.method() === 'POST' })
    await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
    await failed
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('ตรวจสอบสถานะล่าสุดก่อนทำรายการซ้ำ')
    await expect(page.getByText('บันทึกสถานะงานแล้ว', { exact: true })).toHaveCount(0)
    const completed = await f.get(booking.id)
    expect(completed.status).toBe('COMPLETED'); expect(completed.resourceHold).toBe(true)
    expect(completed.revision).toBe(booking.revision + 1)
    const committed = await recoveryFingerprint(f.pool)
    await page.getByRole('dialog').getByRole('button', { name: 'ยกเลิก', exact: true }).click()
    await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'ยังไม่มีงานที่เริ่มแล้ว', exact: true })).toBeVisible()
    await expect(page.getByText(booking.patientName, { exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'ประวัติ', exact: true }).click()
    await expect(page.getByRole('heading', { name: booking.reference, exact: true })).toBeVisible()
    await expect(page.getByText('ส่งถึงโรงพยาบาลแล้ว', { exact: true })).toBeVisible()
    for (const sensitive of [original.patient_name, original.contact_phone, original.pickup_address]) await expect(page.getByText(sensitive, { exact: false })).toHaveCount(0)
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0)
    const operational = await f.request('/bookings', 'driver')
    expect(operational.bookings).toEqual([])
    const minimized = await f.request('/driver/history', 'driver')
    expect(minimized.bookings).toHaveLength(1)
    expect(Object.keys(minimized.bookings[0]).sort()).toEqual(['appointmentAt', 'id', 'reference', 'status'])
    expect(minimized.bookings[0]).toMatchObject({ id: booking.id, reference: booking.reference, status: 'COMPLETED' })
    await f.request(`/bookings/${booking.id}`, 'driver', undefined, 403)
    await f.command(completed, 'CONFIRM_HANDOVER', {}, 'driver', 403)
    expect(await recoveryFingerprint(f.pool)).toEqual(committed)
    expect(commandCount).toBe(1)
    const holds = (await f.pool.query('SELECT vehicle_id,driver_id,starts_at,ends_at FROM patient_transfer.resource_holds WHERE booking_id=$1 ORDER BY vehicle_id NULLS LAST', [booking.id])).rows
    expect(holds).toEqual([
      { vehicle_id: ids.vehicle, driver_id: null, starts_at: new Date(f.control.now), ends_at: null },
      { vehicle_id: null, driver_id: ids.driver, starts_at: new Date(f.control.now), ends_at: null },
    ])
    expect((await f.pool.query("SELECT id FROM patient_transfer.trip_events WHERE booking_id=$1 AND command='CONFIRM_HANDOVER'", [booking.id])).rows).toEqual([{ id: eventId }])
    expect((await f.pool.query("SELECT 1 FROM patient_transfer.audit_logs WHERE entity_id=$1 AND action='CONFIRM_HANDOVER'", [booking.id])).rowCount).toBe(1)
    const outbox = (await f.pool.query('SELECT recipient_id,template_key,status,attempts FROM patient_transfer.notifications WHERE event_id=$1 ORDER BY recipient_id', [eventId])).rows
    const driverAccount = (await f.pool.query('SELECT user_id FROM patient_transfer.drivers WHERE id=$1', [ids.driver])).rows[0].user_id
    expect(outbox).toEqual([original.requester_id, driverAccount].sort().map(recipient_id => ({ recipient_id, template_key: 'TRIP_CONFIRM_HANDOVER', status: 'PENDING', attempts: 0 })))
    expect((await f.pool.query('SELECT * FROM patient_transfer.schedules ORDER BY id')).rows).toEqual(schedules)
    expect((await f.pool.query('SELECT * FROM patient_transfer.trip_events WHERE id=ANY($1::uuid[]) ORDER BY id', [history.map(r => r.id)])).rows).toEqual(history)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); await f.close()
  }
})

test('original driver reconciles committed Start Trip and departure after lost browser responses without duplicate writes', async ({ page }) => {
  test.setTimeout(60000)
  const f = await startOperationalTestApi()
  try {
    const booking = await f.assigned()
    const schedules = (await f.pool.query('SELECT * FROM patient_transfer.schedules ORDER BY id')).rows
    const history = (await f.pool.query('SELECT * FROM patient_transfer.trip_events ORDER BY id')).rows
    f.control.now = booking.schedule!.departureAt
    await f.login('dispatcher')
    await page.clock.setFixedTime(new Date(f.control.now))
    let loseCommandResponse = true
    const attempts: { type: string; eventId: string; status: number }[] = []
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url())
      const response = await route.fetch({ url: `${f.base}${url.pathname}${url.search}` })
      if (url.pathname.endsWith('/commands') && request.method() === 'POST') {
        const body = request.postDataJSON()
        attempts.push({ type: body.command.type, eventId: body.eventId, status: response.status() })
        if (loseCommandResponse) {
          loseCommandResponse = false
          expect(response.status()).toBe(200)
          // The real API has committed; only the browser response is lost.
          await route.abort('failed')
          return
        }
      }
      await route.fulfill({ response })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
    await page.goto(`/staff/login?next=${encodeURIComponent(`/driver/status?booking=${booking.id}`)}`)
    await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill('synthetic-driver')
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByRole('link', { name: 'เปิดหน้าคนขับ', exact: true }).click()
    for (const [index, stage] of [
      { type: 'START_TRIP', label: 'เริ่มงาน', before: 'ได้รับมอบหมาย', after: 'เริ่มงานแล้ว · ยังไม่ออกจากต้นทาง', status: 'ASSIGNED' },
      { type: 'DEPART_ORIGIN', label: 'ออกจากต้นทางไปรับผู้ป่วย', before: 'เริ่มงานแล้ว · ยังไม่ออกจากต้นทาง', after: 'กำลังไปรับผู้ป่วย', status: 'PICKING_UP' },
    ].entries()) {
      loseCommandResponse = true
      await expect(page.getByRole('heading', { name: stage.before, exact: true })).toBeVisible()
      await page.getByRole('button', { name: stage.label, exact: true }).click()
      const failed = page.waitForEvent('requestfailed', { predicate: r => r.url().endsWith('/commands') && r.method() === 'POST' })
      await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
      await failed
      await expect(page.getByRole('dialog').getByRole('alert')).toContainText('ตรวจสอบสถานะล่าสุดก่อนทำรายการซ้ำ')
      await expect(page.getByText('บันทึกสถานะงานแล้ว', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: stage.before, exact: true })).toBeVisible()
      const committed = await f.get(booking.id)
      expect(committed.status).toBe(stage.status)
      expect(committed.startedAt).toBe(f.control.now)
      expect(committed.revision).toBe(booking.revision + index + 1)
      expect(committed.executionVersion).toBe(booking.executionVersion)
      expect(attempts).toHaveLength(index + 1)
      expect(attempts[index]).toMatchObject({ type: stage.type, status: 200 })
      const beforeRefresh = await recoveryFingerprint(f.pool)
      // Dismiss the uncertain confirmation and reconcile using the existing read control.
      await page.getByRole('dialog').getByRole('button', { name: 'ยกเลิก', exact: true }).click()
      await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
      await expect(page.getByRole('heading', { name: stage.after, exact: true })).toBeVisible()
      expect(await recoveryFingerprint(f.pool)).toEqual(beforeRefresh)
      expect(attempts).toHaveLength(index + 1)
      const events = (await f.pool.query('SELECT id,actor_id,recorded_at FROM patient_transfer.trip_events WHERE booking_id=$1 AND command=$2', [booking.id, stage.type])).rows
      expect(events).toEqual([{ id: attempts[index].eventId, actor_id: '00000000-0000-4000-8000-000000000003', recorded_at: new Date(f.control.now) }])
      expect((await f.pool.query('SELECT 1 FROM patient_transfer.audit_logs WHERE entity_id=$1 AND action=$2', [booking.id, stage.type])).rowCount).toBe(1)
      expect((await f.pool.query('SELECT 1 FROM patient_transfer.notifications WHERE event_id=$1', [attempts[index].eventId])).rowCount).toBe(1)
    }
    await expect(page.getByRole('button', { name: 'รับผู้ป่วยขึ้นรถแล้ว', exact: true })).toBeEnabled()
    const final = await f.get(booking.id)
    expect(final.patientName).toBe(booking.patientName); expect(final.appointmentAt).toBe(booking.appointmentAt)
    expect(final.schedule).toEqual(booking.schedule)
    expect((await f.pool.query('SELECT * FROM patient_transfer.schedules ORDER BY id')).rows).toEqual(schedules)
    expect((await f.pool.query('SELECT * FROM patient_transfer.trip_events WHERE id=ANY($1::uuid[]) ORDER BY id', [history.map(r => r.id)])).rows).toEqual(history)
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.every(r => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); await f.close()
  }
})

test('original driver screen rejects hospital departure one millisecond before pickup waiting ends and retries at the exact boundary', async ({ page }) => {
  test.setTimeout(60000)
  const f = await startOperationalTestApi()
  try {
    let booking = await f.assigned('09:00', { pickupWaitingMinutes: 5 })
    const schedules = (await f.pool.query('SELECT * FROM patient_transfer.schedules WHERE booking_id=$1 ORDER BY id', [booking.id])).rows
    const committed = schedules.find(r => r.committed)
    expect(committed.pickup_waiting_seconds).toBe(300)
    expect(Number(committed.origin_to_pickup_seconds)).toBe(900)
    expect(Number(committed.pickup_to_hospital_seconds)).toBe(2100)
    expect(committed.routing_source).toBe('synthetic-configuration-test/synthetic-configuration-test')
    const boundary = new Date(Date.parse(booking.schedule!.pickupAt) + 300000).toISOString()
    expect(Date.parse(boundary) + 35 * 60000).toBe(Date.parse(booking.schedule!.arrivalAt))
    f.control.now = booking.schedule!.departureAt
    await f.login('driver'); await f.login('dispatcher')
    booking = await f.command(booking, 'START_TRIP', {}, 'driver')
    booking = await f.command(booking, 'DEPART_ORIGIN', {}, 'driver')
    f.control.now = booking.schedule!.pickupAt
    await page.clock.setFixedTime(new Date(f.control.now))
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
    await page.goto(`/staff/login?next=${encodeURIComponent(`/driver/status?booking=${booking.id}`)}`)
    await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill('synthetic-driver')
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByRole('link', { name: 'เปิดหน้าคนขับ', exact: true }).click()
    await page.getByRole('button', { name: 'รับผู้ป่วยขึ้นรถแล้ว', exact: true }).click()
    let response = page.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
    expect((await response).status()).toBe(200)
    await expect(page.getByRole('button', { name: 'ออกเดินทางไปโรงพยาบาล', exact: true })).toBeEnabled()
    const pickedUp = await f.get(booking.id)
    expect(pickedUp.status).toBe('PICKED_UP')
    const history = (await f.pool.query('SELECT * FROM patient_transfer.trip_events WHERE booking_id=$1 ORDER BY id', [booking.id])).rows
    expect(history.filter(r => r.command === 'CONFIRM_PICKUP').map(r => r.recorded_at.toISOString())).toEqual([f.control.now])
    f.control.now = new Date(Date.parse(boundary) - 1).toISOString()
    await page.getByRole('button', { name: 'ออกเดินทางไปโรงพยาบาล', exact: true }).click()
    const before = await recoveryFingerprint(f.pool)
    const routesBefore = [...f.control.routeCalls]
    response = page.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
    const rejected = await response
    expect(rejected.status()).toBe(409)
    expect((await rejected.json()).error).toBe('Planned pickup waiting allowance has not elapsed')
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
    expect(await recoveryFingerprint(f.pool)).toEqual(before)
    expect(await f.get(booking.id)).toEqual(pickedUp)
    f.control.now = boundary
    response = page.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
    expect((await response).status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'กำลังเดินทางไปโรงพยาบาล', exact: true })).toBeVisible()
    const final = await f.get(booking.id)
    expect(final.status).toBe('IN_TRANSIT')
    expect(final.revision).toBe(pickedUp.revision + 1)
    expect(final.executionVersion).toBe(pickedUp.executionVersion)
    expect(final.patientName).toBe(pickedUp.patientName); expect(final.appointmentAt).toBe(pickedUp.appointmentAt)
    expect(final.schedule).toEqual(pickedUp.schedule)
    const departures = (await f.pool.query("SELECT recorded_at FROM patient_transfer.trip_events WHERE booking_id=$1 AND command='DEPART_FOR_HOSPITAL'", [booking.id])).rows
    expect(departures.map(r => r.recorded_at.toISOString())).toEqual([boundary])
    expect((await f.pool.query('SELECT * FROM patient_transfer.trip_events WHERE id=ANY($1::uuid[]) ORDER BY id', [history.map(r => r.id)])).rows).toEqual(history)
    expect((await f.pool.query('SELECT * FROM patient_transfer.schedules WHERE booking_id=$1 ORDER BY id', [booking.id])).rows).toEqual(schedules)
    expect(f.control.routeCalls).toEqual(routesBefore)
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every(r => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); await f.close()
  }
})

for (const readiness of ['combined', 'vehicle-first', 'driver-first'] as const) test(`original driver screen keeps chained work blocked until actual handover turnaround and ${readiness} readiness`, async ({ page }) => {
  test.setTimeout(60000)
  const f = await startOperationalTestApi()
  try {
    let first = await f.assigned()
    const next = await f.assigned('11:00', { originKind: 'previous_hospital', originLocationId: first.hospitalLocationId, previousBookingId: first.id })
    const schedules = (await f.pool.query('SELECT * FROM patient_transfer.schedules ORDER BY id')).rows
    f.control.now = first.schedule!.departureAt
    await f.login('driver'); await f.login('dispatcher')
    first = await f.command(first, 'START_TRIP', {}, 'driver')
    first = await f.command(first, 'DEPART_ORIGIN', {}, 'driver')
    f.control.now = first.schedule!.pickupAt
    first = await f.command(first, 'CONFIRM_PICKUP', {}, 'driver')
    first = await f.command(first, 'DEPART_FOR_HOSPITAL', {}, 'driver')
    const originalEvents = (await f.pool.query('SELECT * FROM patient_transfer.trip_events ORDER BY id')).rows
    f.control.now = first.schedule!.readyAt
    await page.clock.setFixedTime(new Date(f.control.now))
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
    await page.goto(`/staff/login?next=${encodeURIComponent(`/driver/details?booking=${next.id}`)}`)
    await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill('synthetic-driver')
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByRole('link', { name: 'เปิดหน้าคนขับ', exact: true }).click()
    await expect(page.getByRole('button', { name: 'เริ่มงาน', exact: true })).toBeDisabled()
    await expect(page.getByText(new RegExp(`กรุณาจบงาน ${first.id}`))).toBeVisible()
    let before = await recoveryFingerprint(f.pool)
    const busy = await f.command(next, 'START_TRIP', {}, 'driver', 409)
    expect(busy.error).toBe('Resource already executing another trip')
    expect(await recoveryFingerprint(f.pool)).toEqual(before)
    expect(await f.get(next.id)).toEqual(next)
    // Actual handover is forty minutes later than planned arrival.
    f.control.now = new Date(Date.parse(first.schedule!.readyAt) + 10 * 60000).toISOString()
    const handoverAt = f.control.now
    const actualReady = new Date(Date.parse(handoverAt) + 30 * 60000).toISOString()
    expect(actualReady).toBe(next.schedule!.departureAt)
    await page.getByRole('link', { name: 'กลับไปงานที่กำลังทำ', exact: true }).click()
    await page.getByRole('button', { name: 'ส่งถึงโรงพยาบาลแล้ว', exact: true }).click()
    let response = page.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
    expect((await response).status()).toBe(200)
    await expect(page).toHaveURL(/driver\/history$/)
    first = await f.get(first.id)
    expect(first.status).toBe('COMPLETED'); expect(first.resourceHold).toBe(true)
    const handover = (await f.pool.query("SELECT recorded_at FROM patient_transfer.trip_events WHERE booking_id=$1 AND command='CONFIRM_HANDOVER'", [first.id])).rows
    expect(handover.map(r => r.recorded_at.toISOString())).toEqual([handoverAt])
    f.control.now = new Date(Date.parse(actualReady) - 1).toISOString()
    before = await recoveryFingerprint(f.pool)
    const early = await f.command(first, 'CONFIRM_READY', { reason: 'Check actual turnaround boundary' }, 'dispatcher', 409)
    expect(early.error).toBe('Turnaround not complete')
    expect(await recoveryFingerprint(f.pool)).toEqual(before)
    await page.getByRole('link', { name: 'งานวันนี้', exact: true }).click()
    await page.getByRole('button', { name: /ดูรายละเอียดงาน/ }).click()
    await page.getByRole('button', { name: 'เริ่มงาน', exact: true }).click()
    before = await recoveryFingerprint(f.pool)
    response = page.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
    const held = await response
    expect(held.status()).toBe(409)
    expect((await held.json()).error).toBe('Resource readiness hold blocks trip start')
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
    expect(await recoveryFingerprint(f.pool)).toEqual(before)
    expect(await f.get(next.id)).toEqual(next)
    // Time alone does not release either resource; dispatcher confirmation is explicit.
    f.control.now = actualReady
    before = await recoveryFingerprint(f.pool)
    await f.command(next, 'START_TRIP', {}, 'driver', 409)
    expect(await recoveryFingerprint(f.pool)).toEqual(before)
    if (readiness === 'combined') {
      first = await f.command(first, 'CONFIRM_READY', { reason: 'Both resources physically ready at hospital after actual turnaround' })
    } else {
      const dispatch = await page.context().newPage()
      await dispatch.route('**/api/**', async route => {
        const url = new URL(route.request().url())
        await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
      })
      await dispatch.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
      await dispatch.goto('/staff/login?next=%2Fdispatcher%2Ftracking')
      await dispatch.getByLabel('ชื่อผู้ใช้', { exact: true }).fill('synthetic-dispatcher')
      await dispatch.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
      await dispatch.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
      await dispatch.getByRole('link', { name: 'เปิดหน้าจัดรถ', exact: true }).click()
      const completedRevision = first.revision
      const resources = [['vehicles', ids.vehicle], ['drivers', ids.driver]] as const
      const releaseOrder = readiness === 'driver-first' ? [...resources].reverse() : resources
      for (const [index, [kind, id]] of releaseOrder.entries()) {
        await dispatch.getByText('ยืนยันตำแหน่งและความพร้อมรถหรือคนขับ', { exact: true }).click()
        await dispatch.getByLabel('ทรัพยากรที่ตรวจสอบ').selectOption(`${kind}/${id}`)
        await dispatch.getByLabel('ตำแหน่งปัจจุบันที่ยืนยันแล้ว').selectOption(first.hospitalLocationId!)
        await dispatch.getByLabel('เหตุผลและผลตรวจสอบ', { exact: true }).fill(`Verified ${kind} physically ready at predecessor hospital`)
        await dispatch.getByRole('checkbox', { name: 'ยืนยันตำแหน่งจริงและความพร้อมของทรัพยากรนี้แล้ว', exact: true }).check()
        const saved = dispatch.waitForResponse(r => r.url().endsWith(`/resources/${kind}/${id}/readiness`) && r.request().method() === 'POST')
        const refreshed = dispatch.waitForResponse(r => r.url().endsWith('/catalog'))
        await dispatch.getByRole('button', { name: 'ยืนยันความพร้อมทรัพยากรนี้', exact: true }).click()
        expect((await saved).status()).toBe(200)
        await refreshed
        await expect(dispatch.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
        const currentHolds = (await f.pool.query('SELECT vehicle_id,driver_id,ends_at FROM patient_transfer.resource_holds WHERE booking_id=$1', [first.id])).rows
        expect(currentHolds).toHaveLength(2)
        for (const [resourceKind, resourceId] of resources) {
          const hold = currentHolds.find(r => r[resourceKind === 'vehicles' ? 'vehicle_id' : 'driver_id'] === resourceId)
          if (index === 1 || resourceKind === kind) expect(hold.ends_at.toISOString()).toBe(actualReady)
          else expect(hold.ends_at).toBeNull()
        }
        const completed = await f.get(first.id)
        expect(completed.status).toBe('COMPLETED')
        expect(completed.revision).toBe(completedRevision)
        expect(completed.resourceHold).toBe(index === 0)
        expect(await f.get(next.id)).toEqual(next)
        const positions = (await f.pool.query(`SELECT location_id,confirmed_at,confirmed_by FROM patient_transfer.resource_position_updates
          WHERE ${kind === 'vehicles' ? 'vehicle_id' : 'driver_id'}=$1`, [id])).rows
        expect(positions).toEqual([{ location_id: first.hospitalLocationId, confirmed_at: new Date(actualReady), confirmed_by: '00000000-0000-4000-8000-000000000002' }])
        expect((await f.pool.query("SELECT 1 FROM patient_transfer.audit_logs WHERE entity_id=$1 AND action='CONFIRM_RESOURCE_READY' AND actor_id=$2", [id, positions[0].confirmed_by])).rowCount).toBe(1)
        if (index === 0) {
          before = await recoveryFingerprint(f.pool)
          response = page.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
          await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
          const partial = await response
          expect(partial.status()).toBe(409)
          expect((await partial.json()).error).toBe('Resource readiness hold blocks trip start')
          await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
          expect(await recoveryFingerprint(f.pool)).toEqual(before)
        }
      }
      first = await f.get(first.id)
    }
    expect(first.resourceHold).toBe(false)
    const holds = (await f.pool.query('SELECT vehicle_id,driver_id,ends_at FROM patient_transfer.resource_holds WHERE booking_id=$1', [first.id])).rows
    expect(holds).toHaveLength(2)
    expect(holds.every(r => r.ends_at.toISOString() === actualReady)).toBe(true)
    response = page.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
    expect((await response).status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'เริ่มงานแล้ว · ยังไม่ออกจากต้นทาง', exact: true })).toBeVisible()
    let started = await f.get(next.id)
    expect(started.status).toBe('ASSIGNED'); expect(started.startedAt).toBe(actualReady)
    await page.getByRole('button', { name: 'ออกจากต้นทางไปรับผู้ป่วย', exact: true }).click()
    response = page.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
    expect((await response).status()).toBe(200)
    started = await f.get(next.id)
    expect(started.status).toBe('PICKING_UP')
    expect(started.schedule?.originLocationId).toBe(first.hospitalLocationId)
    expect(started.schedule?.previousBookingId).toBe(first.id)
    expect(started.patientName).toBe(next.patientName); expect(started.appointmentAt).toBe(next.appointmentAt)
    expect((await f.pool.query('SELECT * FROM patient_transfer.schedules ORDER BY id')).rows).toEqual(schedules)
    expect((await f.pool.query('SELECT * FROM patient_transfer.trip_events WHERE id=ANY($1::uuid[]) ORDER BY id', [originalEvents.map(r => r.id)])).rows).toEqual(originalEvents)
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every(r => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally {
    for (const openPage of page.context().pages()) {
      await openPage.unrouteAll({ behavior: 'ignoreErrors' }); await openPage.close()
    }
    await f.close()
  }
})

test('original screen checks vehicle and driver location continuity independently before a hospital-origin chain', async ({ page }) => {
  test.setTimeout(60000)
  const f = await startOperationalTestApi()
  try {
    const driverAccount = randomUUID(), driver2 = randomUUID()
    const vehicle2 = '50000000-0000-4000-8000-000000000002'
    await f.pool.query(`INSERT INTO patient_transfer.users(id,role,username,display_name,password_hash)
      SELECT $1,'driver','synthetic-driver2','synthetic-driver2',password_hash FROM patient_transfer.users WHERE username='synthetic-driver'`, [driverAccount])
    await f.pool.query(`INSERT INTO patient_transfer.drivers(id,user_id,location_id,available_at,capabilities)
      VALUES($1,$2,$3,'2029-01-01',ARRAY['standard']::patient_transfer.mobility_type[])`, [driver2, driverAccount, ids.depot])
    await f.pool.query(`INSERT INTO patient_transfer.availability_windows(driver_id,starts_at,ends_at)
      VALUES($1,'2030-01-15T06:00:00+07:00','2030-01-15T16:00:00+07:00')`, [driver2])
    const predecessor = await f.assigned()
    const following = await f.command(await f.requested('11:00'), 'APPROVE')
    async function ledger(id: string) {
      const rows = []
      for (const [table, key] of [['bookings', 'id'], ['schedules', 'booking_id'], ['trip_events', 'booking_id'], ['audit_logs', 'entity_id'], ['notifications', 'booking_id']]) {
        rows.push((await f.pool.query(`SELECT * FROM patient_transfer.${table} WHERE ${key}=$1 ORDER BY id`, [id])).rows)
      }
      return rows
    }
    const predecessorLedger = await ledger(predecessor.id)
    const followingHistory = (await f.pool.query('SELECT * FROM patient_transfer.trip_events WHERE booking_id=$1 ORDER BY id', [following.id])).rows
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
    await page.goto(`/staff/login?next=${encodeURIComponent(`/dispatcher/assignment?booking=${following.id}`)}`)
    await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill('synthetic-dispatcher')
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByRole('link', { name: 'เปิดหน้าจัดรถ', exact: true }).click()
    async function choose(vehicle: string, driver: string) {
      await page.getByRole('button', { name: /^รถรับส่ง:/ }).click()
      await page.getByRole('option', { name: new RegExp(vehicle === ids.vehicle ? 'SYNTHETIC-01' : 'SYNTHETIC-02') }).click()
      await page.getByRole('button', { name: /^คนขับ:/ }).click()
      await page.getByRole('option', { name: new RegExp(driver === ids.driver ? 'Synthetic driver' : 'synthetic-driver2') }).click()
    }
    async function confirm(stage: 'schedule' | 'assignment') {
      await page.getByRole('button', { name: stage === 'schedule' ? 'ตรวจสอบและยืนยันตาราง' : 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
      const response = page.waitForResponse(r => r.url().endsWith(`/${stage}`) && r.request().method() === 'POST')
      await page.getByRole('button', { name: stage === 'schedule' ? 'ยืนยันตาราง' : 'ยืนยันการมอบหมาย', exact: true }).click()
      return response
    }
    for (const resource of ['vehicle', 'driver'] as const) {
      const vehicle = resource === 'vehicle' ? ids.vehicle : vehicle2
      const driver = resource === 'driver' ? ids.driver : driver2
      await choose(vehicle, driver)
      await page.getByRole('combobox', { name: /^ต้นทาง/ }).selectOption(ids.depot)
      const before = await recoveryFingerprint(f.pool)
      const response = await confirm('schedule')
      expect(response.status()).toBe(409)
      const result = await response.json()
      expect(result.details.filter((issue: { code: string }) => issue.code === 'LOCATION').map((issue: { resourceId: string }) => issue.resourceId)).toEqual([resource === 'vehicle' ? ids.vehicle : ids.driver])
      expect(result.details.every((issue: { code: string }) => issue.code === 'LOCATION')).toBe(true)
      expect(await recoveryFingerprint(f.pool)).toEqual(before)
      expect(await f.get(following.id)).toEqual(following)
      await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
      await page.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true }).click()
      await expect(page.getByRole('combobox', { name: /^ต้นทาง/ })).toHaveValue(ids.depot)
      await expect(page.getByRole('button', { name: /^รถรับส่ง:/ })).toContainText(vehicle === ids.vehicle ? 'SYNTHETIC-01' : 'SYNTHETIC-02')
      await expect(page.getByRole('button', { name: /^คนขับ:/ })).toContainText(driver === ids.driver ? 'Synthetic driver' : 'synthetic-driver2')
    }
    await choose(ids.vehicle, ids.driver)
    await page.getByRole('combobox', { name: /^ต้นทาง/ }).selectOption(predecessor.hospitalLocationId!)
    await page.getByRole('combobox', { name: /^งานก่อนหน้าที่โรงพยาบาล/ }).selectOption(predecessor.id)
    expect((await confirm('schedule')).status()).toBe(200)
    expect((await f.get(following.id)).status).toBe('SCHEDULED')
    expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rowCount).toBe(1)
    expect((await confirm('assignment')).status()).toBe(200)
    const final = await f.get(following.id)
    expect(final.status).toBe('ASSIGNED')
    expect(final.vehicleId).toBe(ids.vehicle); expect(final.driverId).toBe(ids.driver)
    expect(final.schedule?.originKind).toBe('previous_hospital')
    expect(final.schedule?.previousBookingId).toBe(predecessor.id)
    expect(final.schedule?.originLocationId).toBe(predecessor.hospitalLocationId)
    expect(Date.parse(final.schedule!.departureAt)).toBeGreaterThan(Date.parse(predecessor.schedule!.readyAt))
    expect(final.patientName).toBe(following.patientName); expect(final.appointmentAt).toBe(following.appointmentAt)
    expect(await ledger(predecessor.id)).toEqual(predecessorLedger)
    expect((await f.pool.query('SELECT * FROM patient_transfer.trip_events WHERE id=ANY($1::uuid[]) ORDER BY id', [followingHistory.map(r => r.id)])).rows).toEqual(followingHistory)
    const rows = (await f.pool.query('SELECT vehicle_id,driver_id,origin_location_id,previous_booking_id FROM patient_transfer.schedules WHERE booking_id=$1 AND committed AND released_at IS NULL', [following.id])).rows
    expect(rows).toEqual([{ vehicle_id: ids.vehicle, driver_id: ids.driver, origin_location_id: predecessor.hospitalLocationId, previous_booking_id: predecessor.id }])
    expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rowCount).toBe(2)
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every(r => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); await f.close()
  }
})

for (const leg of ['origin', 'hospital'] as const) test(`original screen requires the ${leg} route independently at proposal and assignment`, async ({ page }) => {
  test.setTimeout(60000)
  const f = await startOperationalTestApi()
  try {
    const approved = await f.command(await f.requested(), 'APPROVE')
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
    await page.goto(`/staff/login?next=${encodeURIComponent(`/dispatcher/assignment?booking=${approved.id}`)}`)
    await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill('synthetic-dispatcher')
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByRole('link', { name: 'เปิดหน้าจัดรถ', exact: true }).click()
    await page.getByRole('button', { name: /^รถรับส่ง:/ }).click()
    await page.getByRole('option', { name: /SYNTHETIC-01/ }).click()
    await page.getByRole('button', { name: /^คนขับ:/ }).click()
    await page.getByRole('option', { name: /Synthetic driver/ }).click()
    const waiting = page.getByLabel('เวลารอที่จุดรับเพิ่มเติม (นาที)', { exact: true })
    await waiting.fill('5')
    async function confirm(stage: 'schedule' | 'assignment', status: number) {
      await page.getByRole('button', { name: stage === 'schedule' ? 'ตรวจสอบและยืนยันตาราง' : 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
      const response = page.waitForResponse(r => r.url().endsWith(`/${stage}`) && r.request().method() === 'POST')
      await page.getByRole('button', { name: stage === 'schedule' ? 'ยืนยันตาราง' : 'ยืนยันการมอบหมาย', exact: true }).click()
      const result = await response
      expect(result.status()).toBe(status)
      expect(result.request().postDataJSON().pickupWaitingMinutes).toBe(5)
    }
    for (const stage of ['schedule', 'assignment'] as const) {
      const saved = await f.get(approved.id)
      expect(saved.status).toBe(stage === 'schedule' ? 'APPROVED' : 'SCHEDULED')
      expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rowCount).toBe(0)
      f.control.failedLeg = leg
      f.control.routeCalls.length = 0
      const before = await recoveryFingerprint(f.pool)
      await confirm(stage, 503)
      expect(f.control.routeCalls).toEqual([
        { leg: 'origin', failed: leg === 'origin' }, { leg: 'hospital', failed: leg === 'hospital' },
      ])
      await expect(page.getByRole('dialog').getByRole('alert')).toContainText('บริการคำนวณเส้นทางยังไม่พร้อม')
      expect(await recoveryFingerprint(f.pool)).toEqual(before)
      expect(await f.get(approved.id)).toEqual(saved)
      await page.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true }).click()
      await expect(waiting).toHaveValue('5')
      await expect(page.getByRole('button', { name: /^รถรับส่ง:/ })).toContainText('SYNTHETIC-01')
      await expect(page.getByRole('button', { name: /^คนขับ:/ })).toContainText('Synthetic driver')
      f.control.failedLeg = null
      f.control.routeCalls.length = 0
      await confirm(stage, 200)
      expect(f.control.routeCalls).toEqual([{ leg: 'origin', failed: false }, { leg: 'hospital', failed: false }])
      if (stage === 'schedule') {
        await expect(page.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true })).toBeVisible()
        const proposal = await f.get(approved.id)
        expect(proposal.status).toBe('SCHEDULED')
        expect(proposal.proposedSchedule?.pickupWaitingMinutes).toBe(5)
      }
    }
    const final = await f.get(approved.id)
    expect(final.status).toBe('ASSIGNED')
    expect(final.patientName).toBe(approved.patientName); expect(final.appointmentAt).toBe(approved.appointmentAt)
    expect(final.vehicleId).toBe(ids.vehicle); expect(final.driverId).toBe(ids.driver)
    const rows = (await f.pool.query('SELECT committed,origin_to_pickup_seconds,pickup_to_hospital_seconds,pickup_waiting_seconds,routing_source FROM patient_transfer.schedules WHERE booking_id=$1 ORDER BY committed', [approved.id])).rows
    expect(rows).toEqual([false, true].map(committed => ({ committed, origin_to_pickup_seconds: '900', pickup_to_hospital_seconds: '2100', pickup_waiting_seconds: 300, routing_source: 'synthetic-configuration-test/synthetic-configuration-test' })))
    expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rowCount).toBe(1)
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.every(r => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); await f.close()
  }
})

test('original screen keeps waiting separate from verified routes through proposal edit and assignment', async ({ page }) => {
  test.setTimeout(60000)
  const f = await startOperationalTestApi()
  try {
    const approved = await f.command(await f.requested(), 'APPROVE')
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
    await page.goto(`/staff/login?next=${encodeURIComponent(`/dispatcher/assignment?booking=${approved.id}`)}`)
    await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill('synthetic-dispatcher')
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByRole('link', { name: 'เปิดหน้าจัดรถ', exact: true }).click()
    await page.getByRole('button', { name: /^รถรับส่ง:/ }).click()
    await page.getByRole('option', { name: /SYNTHETIC-01/ }).click()
    await page.getByRole('button', { name: /^คนขับ:/ }).click()
    await page.getByRole('option', { name: /Synthetic driver/ }).click()
    const waiting = page.getByLabel('เวลารอที่จุดรับเพิ่มเติม (นาที)', { exact: true })
    await expect(waiting).toHaveValue('0')
    async function confirm(stage: 'schedule' | 'assignment', status: number, expectedWaiting = 5) {
      await page.getByRole('button', { name: stage === 'schedule' ? 'ตรวจสอบและยืนยันตาราง' : 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
      const response = page.waitForResponse(r => r.url().endsWith(`/${stage}`) && r.request().method() === 'POST')
      await page.getByRole('button', { name: stage === 'schedule' ? 'ยืนยันตาราง' : 'ยืนยันการมอบหมาย', exact: true }).click()
      const result = await response
      expect(result.status()).toBe(status)
      expect(result.request().postDataJSON().pickupWaitingMinutes).toBe(expectedWaiting)
    }
    await confirm('schedule', 200, 0)
    await expect(page.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true })).toBeVisible()
    const original = await f.get(approved.id)
    const originalRow = (await f.pool.query('SELECT * FROM patient_transfer.schedules WHERE booking_id=$1', [approved.id])).rows[0]
    const historicalEvents = (await f.pool.query('SELECT * FROM patient_transfer.trip_events WHERE booking_id=$1 ORDER BY id', [approved.id])).rows
    expect(original.proposedSchedule?.pickupWaitingMinutes).toBe(0)
    expect(originalRow.origin_to_pickup_seconds).toBe('900')
    expect(originalRow.pickup_to_hospital_seconds).toBe('2100')
    expect(originalRow.routing_source).toBe('synthetic-configuration-test/synthetic-configuration-test')
    await page.getByRole('button', { name: 'แก้ไขข้อเสนอตารางและทรัพยากร', exact: true }).click()
    await waiting.fill('5')
    f.control.unavailable = true
    let before = await recoveryFingerprint(f.pool)
    await confirm('schedule', 503)
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('บริการคำนวณเส้นทางยังไม่พร้อม')
    expect(await recoveryFingerprint(f.pool)).toEqual(before)
    expect(await f.get(approved.id)).toEqual(original)
    await page.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true }).click()
    await expect(waiting).toHaveValue('5')
    await expect(page.getByRole('button', { name: /^รถรับส่ง:/ })).toContainText('SYNTHETIC-01')
    await expect(page.getByRole('button', { name: /^คนขับ:/ })).toContainText('Synthetic driver')
    f.control.unavailable = false
    await confirm('schedule', 200)
    await expect(page.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true })).toBeVisible()
    const revised = await f.get(approved.id)
    const a = original.proposedSchedule!, b = revised.proposedSchedule!
    expect(revised.status).toBe('SCHEDULED')
    expect(b.pickupWaitingMinutes).toBe(5)
    for (const key of ['departureAt', 'pickupAt'] as const) expect(Date.parse(a[key]) - Date.parse(b[key])).toBe(5 * 60000)
    for (const key of ['arrivalAt', 'readyAt'] as const) expect(Date.parse(b[key])).toBe(Date.parse(a[key]))
    expect(Date.parse(b.arrivalAt)).toBe(Date.parse(approved.appointmentAt) - 20 * 60000)
    expect(Date.parse(b.readyAt)).toBe(Date.parse(b.arrivalAt) + 30 * 60000)
    await expect(page.getByRole('list', { name: 'กำหนดการเดินทาง' })).toContainText('07:45')
    await expect(page.getByRole('list', { name: 'กำหนดการเดินทาง' })).toContainText('08:00')
    const proposalRow = (await f.pool.query('SELECT * FROM patient_transfer.schedules WHERE booking_id=$1 AND NOT committed AND released_at IS NULL', [approved.id])).rows[0]
    expect(proposalRow.pickup_waiting_seconds).toBe(300)
    for (const key of ['origin_to_pickup_seconds', 'pickup_to_hospital_seconds', 'routing_source']) expect(proposalRow[key]).toBe(originalRow[key])
    const retainedRow = (await f.pool.query('SELECT * FROM patient_transfer.schedules WHERE id=$1', [originalRow.id])).rows[0]
    expect(retainedRow.released_at).not.toBeNull()
    expect({ ...retainedRow, released_at: null }).toEqual(originalRow)
    expect((await f.pool.query('SELECT * FROM patient_transfer.trip_events WHERE id=ANY($1::uuid[]) ORDER BY id', [historicalEvents.map(r => r.id)])).rows).toEqual(historicalEvents)
    expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rowCount).toBe(0)
    f.control.unavailable = true
    before = await recoveryFingerprint(f.pool)
    await confirm('assignment', 503)
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
    expect(await recoveryFingerprint(f.pool)).toEqual(before)
    expect(await f.get(approved.id)).toEqual(revised)
    await page.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true }).click()
    await expect(waiting).toHaveValue('5')
    f.control.unavailable = false
    await confirm('assignment', 200)
    const final = await f.get(approved.id)
    expect(final.status).toBe('ASSIGNED')
    expect(final.schedule?.pickupWaitingMinutes).toBe(5)
    for (const key of ['departureAt', 'pickupAt', 'arrivalAt', 'readyAt'] as const) expect(Date.parse(final.schedule![key])).toBe(Date.parse(b[key]))
    const committed = (await f.pool.query('SELECT * FROM patient_transfer.schedules WHERE booking_id=$1 AND committed AND released_at IS NULL', [approved.id])).rows
    expect(committed).toHaveLength(1)
    for (const key of ['origin_to_pickup_seconds', 'pickup_to_hospital_seconds', 'routing_source', 'pickup_waiting_seconds']) expect(committed[0][key]).toBe(proposalRow[key])
    expect(final.patientName).toBe(approved.patientName); expect(final.appointmentAt).toBe(approved.appointmentAt)
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.every(r => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); await f.close()
  }
})

for (const mobility of ['wheelchair', 'stretcher'] as const) test(`original screen independently checks both crew capabilities for ${mobility} at proposal and assignment`, async ({ page }) => {
  test.setTimeout(60000)
  const f = await startOperationalTestApi()
  try {
    async function capabilities(resource: 'vehicles' | 'drivers', capable: boolean) {
      const id = resource === 'vehicles' ? ids.vehicle : ids.driver
      await f.pool.query(`UPDATE patient_transfer.${resource} SET capabilities=$2::patient_transfer.mobility_type[] WHERE id=$1`, [id, capable ? ['standard', mobility] : ['standard']])
    }
    await capabilities('vehicles', true); await capabilities('drivers', true)
    const consent = await f.request('/consents', 'citizen', { accepted: true, noticeVersion: 'development-v1' }, 201)
    const requested = await f.request('/bookings', 'citizen', {
      consentId: consent.id, bookingFor: 'self', patientName: 'ผู้ป่วยทดสอบความสามารถ', requesterName: 'ผู้ขอทดสอบ', contactPhone: '0800000000',
      pickupAddress: 'จุดรับสังเคราะห์', latitude: 18.59, longitude: 99.05, villageId: ids.village, hospitalId: ids.hospital,
      mobility, appointmentAt: '2030-01-15T09:00:00+07:00',
    }, 201)
    const approved = await f.command(requested, 'APPROVE')
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
    await page.goto(`/staff/login?next=${encodeURIComponent(`/dispatcher/assignment?booking=${approved.id}`)}`)
    await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill('synthetic-dispatcher')
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByRole('link', { name: 'เปิดหน้าจัดรถ', exact: true }).click()
    await expect(page.getByText(`งานที่เลือก · ${approved.reference}`, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^รถรับส่ง:/ }).click()
    await page.getByRole('option', { name: /SYNTHETIC-01/ }).click()
    await page.getByRole('button', { name: /^คนขับ:/ }).click()
    await page.getByRole('option', { name: /Synthetic driver/ }).click()
    async function confirm(stage: 'schedule' | 'assignment', status: number) {
      await page.getByRole('button', { name: stage === 'schedule' ? 'ตรวจสอบและยืนยันตาราง' : 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
      const response = page.waitForResponse(r => r.url().endsWith(`/${stage}`) && r.request().method() === 'POST')
      await page.getByRole('button', { name: stage === 'schedule' ? 'ยืนยันตาราง' : 'ยืนยันการมอบหมาย', exact: true }).click()
      const result = await response
      expect(result.status()).toBe(status)
      return result.json()
    }
    for (const stage of ['schedule', 'assignment'] as const) {
      const baseline = await f.get(approved.id)
      expect(baseline.status).toBe(stage === 'schedule' ? 'APPROVED' : 'SCHEDULED')
      for (const resource of ['vehicles', 'drivers'] as const) {
        // Only one resource loses the required capability; the other stays compatible.
        await capabilities(resource, false)
        const rows = (await f.pool.query(`SELECT 'vehicle' AS kind,to_json(capabilities) AS capabilities FROM patient_transfer.vehicles WHERE id=$1
          UNION ALL SELECT 'driver',to_json(capabilities) FROM patient_transfer.drivers WHERE id=$2`, [ids.vehicle, ids.driver])).rows
        expect(rows.find(r => r.kind === 'vehicle').capabilities.includes(mobility)).toBe(resource !== 'vehicles')
        expect(rows.find(r => r.kind === 'driver').capabilities.includes(mobility)).toBe(resource !== 'drivers')
        const before = await recoveryFingerprint(f.pool)
        const result = await confirm(stage, 409)
        expect(result.details.filter((d: { code: string }) => d.code === 'CAPABILITY')).toEqual([
          expect.objectContaining({ code: 'CAPABILITY', resourceId: resource === 'vehicles' ? ids.vehicle : ids.driver }),
        ])
        await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
        expect(await recoveryFingerprint(f.pool)).toEqual(before)
        expect(await f.get(approved.id)).toEqual(baseline)
        await page.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true }).click()
        await expect(page.getByRole('button', { name: /^รถรับส่ง:/ })).toContainText('SYNTHETIC-01')
        await expect(page.getByRole('button', { name: /^คนขับ:/ })).toContainText('Synthetic driver')
        await capabilities(resource, true)
      }
      expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rowCount).toBe(0)
      await confirm(stage, 200)
    }
    const final = await f.get(approved.id)
    expect(final.status).toBe('ASSIGNED')
    expect(final.mobility).toBe(mobility)
    expect(final.patientName).toBe(approved.patientName)
    expect(final.appointmentAt).toBe(approved.appointmentAt)
    expect(final.vehicleId).toBe(ids.vehicle); expect(final.driverId).toBe(ids.driver)
    expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE committed AND released_at IS NULL AND booking_id=$1 AND vehicle_id=$2 AND driver_id=$3', [final.id, ids.vehicle, ids.driver])).rowCount).toBe(1)
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.every(r => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); await f.close()
  }
})

for (const boundary of ['opening', 'closing'] as const) test(`original screen enforces the ${boundary} service boundary despite wider crew windows`, async ({ page }) => {
  test.setTimeout(60000)
  const f = await startOperationalTestApi()
  try {
    const windows = await f.pool.query(`UPDATE patient_transfer.availability_windows
      SET starts_at='2030-01-15T05:00:00+07:00',ends_at='2030-01-15T17:00:00+07:00'
      WHERE (vehicle_id=$1 OR driver_id=$2) AND starts_at='2030-01-15T06:00:00+07:00' RETURNING id`, [ids.vehicle, ids.driver])
    expect(windows.rowCount).toBe(2)
    const outside = boundary === 'opening' ? await f.command(await f.requested('07:09:59.999'), 'APPROVE') : null
    const exact = await f.command(await f.requested(boundary === 'opening' ? '07:10' : '15:50'), 'APPROVE')
    if (outside) expect(Date.parse(exact.appointmentAt) - Date.parse(outside.appointmentAt)).toBe(1)
    else {
      // Readiness is appointment + 10 minutes, so intake can reject this case before dispatch.
      const consent = await f.request('/consents', 'citizen', { accepted: true, noticeVersion: 'development-v1' }, 201)
      const before = await recoveryFingerprint(f.pool)
      const rejected = await f.request('/bookings', 'citizen', {
        consentId: consent.id, bookingFor: 'self', patientName: 'ผู้ป่วยทดสอบเวลาบริการ', requesterName: 'ผู้ขอทดสอบ', contactPhone: '0800000000',
        pickupAddress: 'จุดรับสังเคราะห์', latitude: 18.59, longitude: 99.05, villageId: ids.village, hospitalId: ids.hospital,
        mobility: 'standard', appointmentAt: '2030-01-15T15:50:00.001+07:00',
      }, 422)
      expect(rejected.error).toBe('Appointment cannot fit the service-hour window')
      expect(Date.parse('2030-01-15T15:50:00.001+07:00') - Date.parse(exact.appointmentAt)).toBe(1)
      expect(await recoveryFingerprint(f.pool)).toEqual(before)
    }
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
    await page.goto(`/staff/login?next=${encodeURIComponent(`/dispatcher/assignment?booking=${outside?.id ?? exact.id}`)}`)
    await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill('synthetic-dispatcher')
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByRole('link', { name: 'เปิดหน้าจัดรถ', exact: true }).click()
    for (const booking of outside ? [outside, exact] : [exact]) {
      if (outside && booking.id === exact.id) await page.locator('.dispatch-waiting-list article').filter({ hasText: exact.id }).getByRole('button', { name: /เลือกงานนี้/ }).click()
      await expect(page.getByText(`งานที่เลือก · ${booking.reference}`, { exact: true })).toBeVisible()
      await page.getByRole('button', { name: /^รถรับส่ง:/ }).click()
      await page.getByRole('option', { name: /SYNTHETIC-01/ }).click()
      await page.getByRole('button', { name: /^คนขับ:/ }).click()
      await page.getByRole('option', { name: /Synthetic driver/ }).click()
      await page.getByRole('button', { name: 'ตรวจสอบและยืนยันตาราง', exact: true }).click()
      const before = await recoveryFingerprint(f.pool)
      const response = page.waitForResponse(r => r.url().endsWith('/schedule') && r.request().method() === 'POST')
      await page.getByRole('button', { name: 'ยืนยันตาราง', exact: true }).click()
      const result = await response
      expect(result.status()).toBe(booking.id === exact.id ? 200 : 409)
      if (booking.id === outside?.id) {
        expect(JSON.stringify(await result.json())).toContain('HOURS')
        await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
        expect(await recoveryFingerprint(f.pool)).toEqual(before)
        await page.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true }).click()
        await expect(page.getByRole('button', { name: /^รถรับส่ง:/ })).toContainText('SYNTHETIC-01')
        await expect(page.getByRole('button', { name: /^คนขับ:/ })).toContainText('Synthetic driver')
      }
    }
    const proposal = await f.get(exact.id)
    expect(proposal.status).toBe('SCHEDULED')
    const key = boundary === 'opening' ? 'departureAt' : 'readyAt'
    const instant = Date.parse(`2030-01-15T${boundary === 'opening' ? '06' : '16'}:00:00+07:00`)
    expect(Date.parse(proposal.proposedSchedule![key])).toBe(instant)
    expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rowCount).toBe(0)
    await page.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
    const committed = page.waitForResponse(r => r.url().endsWith('/assignment') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันการมอบหมาย', exact: true }).click()
    expect((await committed).status()).toBe(200)
    const final = await f.get(exact.id)
    expect(final.status).toBe('ASSIGNED')
    expect(final.vehicleId).toBe(ids.vehicle); expect(final.driverId).toBe(ids.driver)
    expect(Date.parse(final.schedule![key])).toBe(instant)
    const reservations = (await f.pool.query('SELECT departure_at,ready_at FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rows
    expect(reservations).toHaveLength(1)
    expect(reservations[0][boundary === 'opening' ? 'departure_at' : 'ready_at'].getTime()).toBe(instant)
    if (outside) expect(await f.get(outside.id)).toEqual(outside)
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.every(r => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally {
    await page.unrouteAll({ behavior: 'wait' }); await page.close(); await f.close()
  }
})

for (const resource of ['vehicle', 'driver'] as const) test(`original screen enforces independent ${resource} availability boundaries to the millisecond`, async ({ page }) => {
  test.setTimeout(60000)
  const f = await startOperationalTestApi()
  try {
    const field = resource === 'vehicle' ? 'vehicle_id' : 'driver_id'
    const resourceId = resource === 'vehicle' ? ids.vehicle : ids.driver
    const start = '2030-01-15T07:50:00+07:00', end = '2030-01-15T09:10:00+07:00'
    // Fixture-only narrowing isolates this resource; the other keeps its full service window.
    const window = (await f.pool.query(`UPDATE patient_transfer.availability_windows SET starts_at=$2,ends_at=$3
      WHERE ${field}=$1 AND starts_at='2030-01-15T06:00:00+07:00' RETURNING id`, [resourceId, start, end])).rows
    expect(window).toHaveLength(1)
    const windowId = window[0].id
    const early = await f.command(await f.requested('08:59:59.999'), 'APPROVE')
    const late = await f.command(await f.requested('09:00:00.001'), 'APPROVE')
    const exact = await f.command(await f.requested(), 'APPROVE')
    expect(Date.parse(exact.appointmentAt) - Date.parse(early.appointmentAt)).toBe(1)
    expect(Date.parse(late.appointmentAt) - Date.parse(exact.appointmentAt)).toBe(1)
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
    await page.goto(`/staff/login?next=${encodeURIComponent(`/dispatcher/assignment?booking=${early.id}`)}`)
    await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill('synthetic-dispatcher')
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByRole('link', { name: 'เปิดหน้าจัดรถ', exact: true }).click()
    for (const booking of [early, late, exact]) {
      if (booking.id !== early.id) await page.locator('.dispatch-waiting-list article').filter({ hasText: booking.id }).getByRole('button', { name: /เลือกงานนี้/ }).click()
      await expect(page.getByText(`งานที่เลือก · ${booking.reference}`, { exact: true })).toBeVisible()
      await page.getByRole('button', { name: /^รถรับส่ง:/ }).click()
      await page.getByRole('option', { name: /SYNTHETIC-01/ }).click()
      await page.getByRole('button', { name: /^คนขับ:/ }).click()
      await page.getByRole('option', { name: /Synthetic driver/ }).click()
      await page.getByRole('button', { name: 'ตรวจสอบและยืนยันตาราง', exact: true }).click()
      const before = await recoveryFingerprint(f.pool)
      const response = page.waitForResponse(r => r.url().endsWith('/schedule') && r.request().method() === 'POST')
      await page.getByRole('button', { name: 'ยืนยันตาราง', exact: true }).click()
      expect((await response).status()).toBe(booking.id === exact.id ? 200 : 409)
      if (booking.id !== exact.id) {
        await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
        expect(await recoveryFingerprint(f.pool)).toEqual(before)
        await page.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true }).click()
        await expect(page.getByRole('button', { name: /^รถรับส่ง:/ })).toContainText('SYNTHETIC-01')
        await expect(page.getByRole('button', { name: /^คนขับ:/ })).toContainText('Synthetic driver')
      }
    }
    const proposal = await f.get(exact.id)
    expect(proposal.status).toBe('SCHEDULED')
    expect(Date.parse(proposal.proposedSchedule!.departureAt)).toBe(Date.parse(start))
    expect(Date.parse(proposal.proposedSchedule!.readyAt)).toBe(Date.parse(end))
    expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rowCount).toBe(0)
    // A valid proposal cannot bypass either boundary if availability changes before assignment.
    for (const boundary of ['start', 'end']) {
      await f.pool.query(`UPDATE patient_transfer.availability_windows SET starts_at=$2::timestamptz + $4::interval,
        ends_at=$3::timestamptz - $5::interval WHERE id=$1`, [windowId, start, end, boundary === 'start' ? '1 millisecond' : '0 seconds', boundary === 'end' ? '1 millisecond' : '0 seconds'])
      await page.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
      const before = await recoveryFingerprint(f.pool)
      const rejected = page.waitForResponse(r => r.url().endsWith('/assignment') && r.request().method() === 'POST')
      await page.getByRole('button', { name: 'ยืนยันการมอบหมาย', exact: true }).click()
      expect((await rejected).status()).toBe(409)
      await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
      expect(await recoveryFingerprint(f.pool)).toEqual(before)
      expect(await f.get(exact.id)).toEqual(proposal)
      await page.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true }).click()
    }
    await f.pool.query('UPDATE patient_transfer.availability_windows SET starts_at=$2,ends_at=$3 WHERE id=$1', [windowId, start, end])
    await page.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
    const committed = page.waitForResponse(r => r.url().endsWith('/assignment') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันการมอบหมาย', exact: true }).click()
    expect((await committed).status()).toBe(200)
    const final = await f.get(exact.id)
    expect(final.status).toBe('ASSIGNED')
    expect(final.vehicleId).toBe(ids.vehicle); expect(final.driverId).toBe(ids.driver)
    const rows = (await f.pool.query('SELECT departure_at,ready_at FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].departure_at.getTime()).toBe(Date.parse(start))
    expect(rows[0].ready_at.getTime()).toBe(Date.parse(end))
    expect(await f.get(early.id)).toEqual(early); expect(await f.get(late.id)).toEqual(late)
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.every(r => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally {
    await page.unrouteAll({ behavior: 'wait' }); await page.close(); await f.close()
  }
})

test('original assignment screen accepts exact readiness adjacency and rejects one millisecond overlap', async ({ page }) => {
  test.setTimeout(60000)
  const f = await startOperationalTestApi()
  try {
    const predecessor = await f.assigned()
    async function ledger(id: string) {
      const rows = []
      for (const [table, key] of [['bookings', 'id'], ['schedules', 'booking_id'], ['trip_events', 'booking_id'], ['audit_logs', 'entity_id'], ['notifications', 'booking_id']]) {
        rows.push((await f.pool.query(`SELECT * FROM patient_transfer.${table} WHERE ${key}=$1 ORDER BY id`, [id])).rows)
      }
      return rows
    }
    const previousHistory = await ledger(predecessor.id)
    const origin = { originLocationId: predecessor.hospitalLocationId, originKind: 'previous_hospital', previousBookingId: predecessor.id }
    const early = await f.command(await f.requested('10:19:59.999'), 'APPROVE')
    const exact = await f.command(await f.requested('10:20'), 'APPROVE')
    expect(Date.parse(exact.appointmentAt) - Date.parse(early.appointmentAt)).toBe(1)
    expect(Date.parse(exact.appointmentAt) - 70 * 60000).toBe(Date.parse(predecessor.schedule!.readyAt))
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
    await page.goto(`/staff/login?next=${encodeURIComponent(`/dispatcher/assignment?booking=${early.id}`)}`)
    await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill('synthetic-dispatcher')
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByRole('link', { name: 'เปิดหน้าจัดรถ', exact: true }).click()
    async function chooseOrigin() {
      await page.getByRole('button', { name: /^รถรับส่ง:/ }).click()
      await page.getByRole('option', { name: /SYNTHETIC-01/ }).click()
      await page.getByRole('button', { name: /^คนขับ:/ }).click()
      await page.getByRole('option', { name: /Synthetic driver/ }).click()
      await page.getByRole('combobox', { name: /^ต้นทาง/ }).selectOption(predecessor.hospitalLocationId!)
      await page.getByRole('combobox', { name: /^งานก่อนหน้าที่โรงพยาบาล/ }).selectOption(predecessor.id)
    }
    await chooseOrigin()
    await page.getByRole('button', { name: 'ตรวจสอบและยืนยันตาราง', exact: true }).click()
    const before = await recoveryFingerprint(f.pool)
    const rejected = page.waitForResponse(r => r.url().endsWith('/schedule') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันตาราง', exact: true }).click()
    expect((await rejected).status()).toBe(409)
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
    expect(await recoveryFingerprint(f.pool)).toEqual(before)
    await f.request(`/bookings/${early.id}/assignment`, 'dispatcher', f.selection(early, origin), 409)
    expect(await recoveryFingerprint(f.pool)).toEqual(before)
    await page.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true }).click()
    await expect(page.getByRole('combobox', { name: /^งานก่อนหน้าที่โรงพยาบาล/ })).toHaveValue(predecessor.id)
    await page.locator('.dispatch-waiting-list article').filter({ hasText: exact.id }).getByRole('button', { name: /เลือกงานนี้/ }).click()
    await expect(page.getByText(`งานที่เลือก · ${exact.reference}`, { exact: true })).toBeVisible()
    await chooseOrigin()
    await page.getByRole('button', { name: 'ตรวจสอบและยืนยันตาราง', exact: true }).click()
    const proposed = page.waitForResponse(r => r.url().endsWith('/schedule') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันตาราง', exact: true }).click()
    expect((await proposed).status()).toBe(200)
    const proposal = await f.get(exact.id)
    expect(proposal.status).toBe('SCHEDULED')
    expect(Date.parse(proposal.proposedSchedule!.departureAt)).toBe(Date.parse(predecessor.schedule!.readyAt))
    expect(proposal.proposedSchedule?.originKind).toBe('previous_hospital')
    expect(proposal.proposedSchedule?.previousBookingId).toBe(predecessor.id)
    expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rowCount).toBe(1)
    await page.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
    const assigned = page.waitForResponse(r => r.url().endsWith('/assignment') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันการมอบหมาย', exact: true }).click()
    expect((await assigned).status()).toBe(200)
    const final = await f.get(exact.id)
    expect(final.status).toBe('ASSIGNED')
    expect(final.vehicleId).toBe(predecessor.vehicleId)
    expect(final.driverId).toBe(predecessor.driverId)
    expect(Date.parse(final.schedule!.departureAt)).toBe(Date.parse(predecessor.schedule!.readyAt))
    const reservations = (await f.pool.query('SELECT vehicle_id,driver_id,departure_at,ready_at FROM patient_transfer.schedules WHERE committed AND released_at IS NULL ORDER BY departure_at')).rows
    expect(reservations).toHaveLength(2)
    expect(reservations[1].departure_at).toEqual(reservations[0].ready_at)
    expect(reservations.every(r => r.vehicle_id === ids.vehicle && r.driver_id === ids.driver)).toBe(true)
    expect(await ledger(predecessor.id)).toEqual(previousHistory)
    expect(await f.get(early.id)).toEqual(early)
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.every(r => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally {
    await page.unrouteAll({ behavior: 'wait' }); await page.close(); await f.close()
  }
})

for (const conflict of ['crew', 'vehicle', 'driver'] as const) test(`two original dispatcher sessions race ${conflict} conflicts and recover with an independent crew`, async ({ browser }) => {
  test.setTimeout(90000)
  const f = await startOperationalTestApi()
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  const attempts: { eventId: string; authorization: string; body: Record<string, unknown> }[] = []
  try {
    const dispatcher2 = randomUUID(), driverAccount = randomUUID(), driver2 = randomUUID()
    const vehicle2 = '50000000-0000-4000-8000-000000000002'
    for (const [id, role, username, original] of [
      [dispatcher2, 'dispatcher', 'synthetic-dispatcher2', 'synthetic-dispatcher'],
      [driverAccount, 'driver', 'synthetic-driver2', 'synthetic-driver'],
    ]) await f.pool.query(`INSERT INTO patient_transfer.users(id,role,username,display_name,password_hash)
      SELECT $1,$2::patient_transfer.user_role,$3,$3,password_hash FROM patient_transfer.users WHERE username=$4`, [id, role, username, original])
    await f.pool.query(`INSERT INTO patient_transfer.drivers(id,user_id,location_id,available_at,capabilities)
      VALUES($1,$2,$3,'2029-01-01',ARRAY['standard']::patient_transfer.mobility_type[])`, [driver2, driverAccount, ids.depot])
    await f.pool.query(`INSERT INTO patient_transfer.availability_windows(driver_id,starts_at,ends_at)
      VALUES($1,'2030-01-15T06:00:00+07:00','2030-01-15T16:00:00+07:00')`, [driver2])
    const crews = [
      { vehicleId: ids.vehicle, driverId: ids.driver },
      { vehicleId: conflict === 'driver' ? vehicle2 : ids.vehicle, driverId: conflict === 'vehicle' ? driver2 : ids.driver },
    ]
    expect(crews[0].vehicleId === crews[1].vehicleId).toBe(conflict !== 'driver')
    expect(crews[0].driverId === crews[1].driverId).toBe(conflict !== 'vehicle')
    const plate = (id: string) => id === ids.vehicle ? 'SYNTHETIC-01' : 'SYNTHETIC-02'
    const driverName = (id: string) => id === ids.driver ? 'Synthetic driver' : 'synthetic-driver2'
    const bookings = []
    for (let i = 0; i < 2; i++) {
      const approved = await f.command(await f.requested(), 'APPROVE')
      bookings.push(await f.request(`/bookings/${approved.id}/schedule`, 'dispatcher', f.selection(approved, { ...crews[i], pickupWaitingMinutes: 5 })))
    }
    const pages = await Promise.all(contexts.map(context => context.newPage()))
    for (const [i, page] of pages.entries()) {
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.pathname.endsWith('/assignment') && request.method() === 'POST' && attempts.length < 2) {
          const body = request.postDataJSON()
          attempts.push({ eventId: body.eventId, authorization: request.headers().authorization, body })
          if (attempts.length === 2) release()
          await barrier
        }
        await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
      })
      await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
      await page.goto(`/staff/login?next=${encodeURIComponent(`/dispatcher/assignment?booking=${bookings[i].id}`)}`)
      await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill(i ? 'synthetic-dispatcher2' : 'synthetic-dispatcher')
      await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
      await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
      await page.getByRole('link', { name: 'เปิดหน้าจัดรถ', exact: true }).click()
      await expect(page.getByText('ยืนยันตารางแล้ว ยังไม่จองรถหรือคนขับจนกว่าจะยืนยันการมอบหมาย')).toBeVisible()
      await page.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
    }
    // Both proposals exist without any reservation. Capture every booking-owned write lane.
    async function ledger(id: string) {
      const rows = []
      for (const [table, key] of [['schedules', 'booking_id'], ['trip_events', 'booking_id'], ['audit_logs', 'entity_id'], ['notifications', 'booking_id']]) {
        rows.push((await f.pool.query(`SELECT * FROM patient_transfer.${table} WHERE ${key}=$1 ORDER BY id`, [id])).rows)
      }
      return rows
    }
    const before = await Promise.all(bookings.map(async b => ({ booking: await f.get(b.id), ledger: await ledger(b.id) })))
    expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rowCount).toBe(0)
    const responses = pages.map(page => page.waitForResponse(r => r.url().endsWith('/assignment') && r.request().method() === 'POST'))
    await Promise.all(pages.map(page => page.getByRole('button', { name: 'ยืนยันการมอบหมาย', exact: true }).click()))
    const results = await Promise.all(responses)
    expect(results.map(r => r.status()).sort()).toEqual([200, 409])
    expect(new Set(attempts.map(a => a.authorization)).size).toBe(2)
    const winnerIndex = results.findIndex(r => r.status() === 200), loserIndex = 1 - winnerIndex
    const winner = await f.snapshot(bookings[winnerIndex].id), loser = pages[loserIndex], losingBooking = bookings[loserIndex]
    expect(winner.booking.status).toBe('ASSIGNED')
    expect(winner.booking.vehicleId).toBe(crews[winnerIndex].vehicleId); expect(winner.booking.driverId).toBe(crews[winnerIndex].driverId)
    const recoveryCrew = { vehicleId: winner.booking.vehicleId === ids.vehicle ? vehicle2 : ids.vehicle, driverId: winner.booking.driverId === ids.driver ? driver2 : ids.driver }
    const winningEvent = results[winnerIndex].request().postDataJSON().eventId
    const committedEvent = (await f.pool.query('SELECT actor_id FROM patient_transfer.trip_events WHERE id=$1', [winningEvent])).rows
    expect(committedEvent).toEqual([{ actor_id: winnerIndex ? dispatcher2 : '00000000-0000-4000-8000-000000000002' }])
    expect((await f.pool.query('SELECT 1 FROM patient_transfer.audit_logs WHERE entity_id=$1 AND action=\'ASSIGN\'', [winner.booking.id])).rowCount).toBe(1)
    const winningLedger = await ledger(winner.booking.id)
    expect(await f.get(losingBooking.id)).toEqual(before[loserIndex].booking)
    expect(await ledger(losingBooking.id)).toEqual(before[loserIndex].ledger)
    expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rowCount).toBe(1)
    const dialog = loser.getByRole('dialog', { name: 'ยืนยันการมอบหมาย', exact: true })
    await expect(dialog.getByRole('alert')).toContainText('ข้อมูลหรือความพร้อมเปลี่ยนแล้ว')
    await dialog.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true }).click()
    await expect(loser.getByLabel('เวลารอที่จุดรับเพิ่มเติม (นาที)', { exact: true })).toHaveValue('5')
    await expect(loser.getByRole('button', { name: /^รถรับส่ง:/ })).toContainText(plate(crews[loserIndex].vehicleId))
    await expect(loser.getByRole('button', { name: /^คนขับ:/ })).toContainText(driverName(crews[loserIndex].driverId))
    // Repeating the losing command cannot leave a partial write in any application table.
    const fingerprint = await recoveryFingerprint(f.pool)
    const failed = attempts.find(a => a.eventId === results[loserIndex].request().postDataJSON().eventId)!
    const retry = await fetch(`${f.base}/api/bookings/${losingBooking.id}/assignment`, { method: 'POST', headers: { Authorization: failed.authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...failed.body, eventId: randomUUID() }) })
    expect(retry.status).toBe(409)
    expect(await recoveryFingerprint(f.pool)).toEqual(fingerprint)
    await loser.getByRole('button', { name: 'แก้ไขข้อเสนอตารางและทรัพยากร', exact: true }).click()
    await loser.getByRole('button', { name: /^รถรับส่ง:/ }).click()
    await loser.getByRole('option', { name: new RegExp(plate(recoveryCrew.vehicleId)) }).click()
    await loser.getByRole('button', { name: /^คนขับ:/ }).click()
    await loser.getByRole('option', { name: new RegExp(driverName(recoveryCrew.driverId)) }).click()
    await loser.getByRole('button', { name: 'ตรวจสอบและยืนยันตาราง', exact: true }).click()
    f.control.unavailable = true
    const beforeRevision = await recoveryFingerprint(f.pool)
    const failedRevision = loser.waitForResponse(r => r.url().endsWith('/schedule') && r.request().method() === 'POST')
    await loser.getByRole('button', { name: 'ยืนยันตาราง', exact: true }).click()
    expect((await failedRevision).status()).toBe(503)
    await expect(loser.getByRole('dialog').getByRole('alert')).toBeVisible()
    expect(await recoveryFingerprint(f.pool)).toEqual(beforeRevision)
    await loser.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true }).click()
    await expect(loser.getByRole('button', { name: /^รถรับส่ง:/ })).toContainText(plate(recoveryCrew.vehicleId))
    await expect(loser.getByRole('button', { name: /^คนขับ:/ })).toContainText(driverName(recoveryCrew.driverId))
    await expect(loser.getByLabel('เวลารอที่จุดรับเพิ่มเติม (นาที)', { exact: true })).toHaveValue('5')
    f.control.unavailable = false
    await loser.getByRole('button', { name: 'ตรวจสอบและยืนยันตาราง', exact: true }).click()
    const revised = loser.waitForResponse(r => r.url().endsWith('/schedule') && r.request().method() === 'POST')
    await loser.getByRole('button', { name: 'ยืนยันตาราง', exact: true }).click()
    expect((await revised).status()).toBe(200)
    await expect(loser.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true })).toBeVisible()
    const revisedProposal = await f.get(losingBooking.id)
    expect(revisedProposal.status).toBe('SCHEDULED'); expect(revisedProposal.proposedSchedule?.vehicleId).toBe(recoveryCrew.vehicleId)
    expect(revisedProposal.proposedSchedule?.driverId).toBe(recoveryCrew.driverId)
    expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rowCount).toBe(1)
    await loser.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
    const recovered = loser.waitForResponse(r => r.url().endsWith('/assignment') && r.request().method() === 'POST')
    await loser.getByRole('button', { name: 'ยืนยันการมอบหมาย', exact: true }).click()
    expect((await recovered).status()).toBe(200)
    await expect(loser).toHaveURL(/dispatcher\/tracking$/)
    const final = await f.get(losingBooking.id)
    expect(final.status).toBe('ASSIGNED'); expect(final.vehicleId).toBe(recoveryCrew.vehicleId); expect(final.driverId).toBe(recoveryCrew.driverId)
    expect(final.vehicleId).not.toBe(winner.booking.vehicleId); expect(final.driverId).not.toBe(winner.booking.driverId)
    expect(final.schedule?.pickupWaitingMinutes).toBe(5)
    expect(await f.snapshot(winner.booking.id)).toEqual(winner)
    expect(await ledger(winner.booking.id)).toEqual(winningLedger)
    expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE committed AND released_at IS NULL')).rowCount).toBe(2)
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every((r: { status: string; attempts: number }) => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally {
    release()
    for (const context of contexts) {
      for (const page of context.pages()) {
        // Assertions are complete; closing the context may cancel trailing tracking refreshes.
        await page.unrouteAll({ behavior: 'ignoreErrors' })
      }
      await context.close()
    }
    await f.close()
  }
})

