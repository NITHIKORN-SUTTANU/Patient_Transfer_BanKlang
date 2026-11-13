import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { startOperationalTestApi, ids } from './helpers/operational-postgres'
import { syntheticPassword } from './helpers/admin-postgres.mjs'
import { recoveryFingerprint } from '../scripts/database/recovery.mjs'

test.use({ actionTimeout: 10000 })
test.beforeEach(() => test.skip(!process.env.DATABASE_TEST_ADMIN_URL, 'Local test database required'))

test('concurrent original dispatcher reassignments commit once, retain losing input and invalidate already-open driver execution', async ({ browser }) => {
  test.setTimeout(90000)
  const f = await startOperationalTestApi()
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()))
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  type Attempt = { page: Page; body: Record<string, unknown>; authorization: string }
  const attempts: Attempt[] = []
  try {
    const dispatcher2 = randomUUID(), driver2Account = randomUUID(), driver2 = randomUUID()
    for (const [id, role, username, name, original] of [
      [dispatcher2, 'dispatcher', 'synthetic-dispatcher2', 'Synthetic dispatcher two', 'synthetic-dispatcher'],
      [driver2Account, 'driver', 'synthetic-driver2', 'Synthetic replacement driver', 'synthetic-driver'],
    ]) await f.pool.query(`INSERT INTO patient_transfer.users(id,role,username,display_name,password_hash)
      SELECT $1,$2::patient_transfer.user_role,$3,$4,password_hash FROM patient_transfer.users WHERE username=$5`, [id, role, username, name, original])
    await f.pool.query(`INSERT INTO patient_transfer.drivers(id,user_id,location_id,available_at,capabilities)
      VALUES($1,$2,$3,'2029-01-01',ARRAY['standard']::patient_transfer.mobility_type[])`, [driver2, driver2Account, ids.depot])
    await f.pool.query(`INSERT INTO patient_transfer.availability_windows(driver_id,starts_at,ends_at)
      VALUES($1,'2030-01-15T06:00:00+07:00','2030-01-15T16:00:00+07:00')`, [driver2])
    const original = await f.assigned()
    f.control.now = '2030-01-15T00:00:00Z'
    for (const role of ['dispatcher', 'driver', 'driver2']) await f.login(role)
    const pages = await Promise.all(contexts.map(context => context.newPage()))
    const [a, b, oldDriver, newDriver] = pages
    async function open(page: Page, username: string, path: string) {
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.pathname.endsWith('/modification') && request.method() === 'POST') {
          attempts.push({ page, body: request.postDataJSON(), authorization: request.headers().authorization })
          if (attempts.length === 2) release()
          await barrier
        }
        await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
      })
      await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
      await page.goto(`/staff/login?next=${encodeURIComponent(path)}`)
      await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill(username)
      await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
      await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
      await page.getByRole('link', { name: username.includes('driver') ? 'เปิดหน้าคนขับ' : 'เปิดหน้าจัดรถ', exact: true }).click()
      await expect(page.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
    }
    await open(oldDriver, 'synthetic-driver', `/driver/details?booking=${original.id}`)
    await expect(oldDriver.getByText(`ผู้รับบริการ • ${original.patientName}`, { exact: true })).toBeVisible()
    await oldDriver.getByRole('button', { name: 'เริ่มงาน', exact: true }).click()
    await expect(oldDriver.getByRole('dialog', { name: 'ยืนยันการอัปเดตสถานะ', exact: true })).toBeVisible()
    await open(newDriver, 'synthetic-driver2', `/driver/details?booking=${original.id}`)
    await expect(newDriver.getByRole('heading', { name: 'ไม่พบงานที่มอบหมายให้คนขับนี้', exact: true })).toBeVisible()
    const reasons = ['ตรวจสอบการเปลี่ยนคนขับโดยเจ้าหน้าที่หนึ่ง', 'ตรวจสอบการเปลี่ยนคนขับโดยเจ้าหน้าที่สอง']
    for (const [index, page] of [a, b].entries()) {
      await open(page, index ? 'synthetic-dispatcher2' : 'synthetic-dispatcher', '/dispatcher/tracking')
      const read = page.waitForResponse(response => new URL(response.url()).pathname === '/api/bookings')
      await page.getByRole('button', { name: 'ดูสถานะ →', exact: true }).click()
      await read
      await page.getByRole('combobox', { name: 'การดำเนินการ', exact: true }).selectOption('modify')
      await page.getByRole('button', { name: /^รถรับส่ง:/ }).click()
      const catalog = await f.request('/catalog')
      const vehicle = catalog.vehicles.find((row: { id: string }) => row.id === '50000000-0000-4000-8000-000000000002')
      await page.getByRole('option', { name: new RegExp(vehicle.plate) }).click()
      await page.getByRole('button', { name: /^คนขับ:/ }).click()
      await page.getByRole('option', { name: /Synthetic replacement driver/ }).click()
      await page.getByLabel('เวลารอที่จุดรับเพิ่มเติม (นาที)', { exact: true }).fill(String(index ? 10 : 5))
      await page.getByLabel('เหตุผลการเปลี่ยนแปลง', { exact: true }).fill(reasons[index])
      await page.getByRole('button', { name: 'ตรวจสอบและยืนยันการเปลี่ยนแปลง', exact: true }).click()
    }
    const before = await f.snapshot(original.id)
    const responses = [a, b].map(page => page.waitForResponse(response => response.url().endsWith('/modification') && response.request().method() === 'POST'))
    await Promise.all([a, b].map(page => page.getByRole('dialog', { name: 'ยืนยันการเปลี่ยนแปลง', exact: true }).getByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง', exact: true }).click()))
    const results = await Promise.all(responses)
    expect(results.map(response => response.status()).sort()).toEqual([200, 409])
    expect(attempts).toHaveLength(2)
    expect(new Set(attempts.map(row => row.authorization)).size).toBe(2)
    expect(attempts.every(row => row.body.expectedRevision === original.revision)).toBe(true)
    const winnerIndex = results.findIndex(response => response.status() === 200), loserIndex = 1 - winnerIndex
    const loser = [a, b][loserIndex], winner = [a, b][winnerIndex]
    await expect(winner.getByRole('dialog', { name: 'ยืนยันการเปลี่ยนแปลง', exact: true })).toHaveCount(0)
    const dialog = loser.getByRole('dialog', { name: 'ยืนยันการเปลี่ยนแปลง', exact: true })
    await expect(dialog.getByRole('alert')).toContainText('ข้อมูลหรือความพร้อมเปลี่ยนแล้ว')
    await dialog.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true }).click()
    await expect(loser.getByRole('textbox', { name: 'เหตุผลการเปลี่ยนแปลง', exact: true })).toHaveValue(reasons[loserIndex])
    await expect(loser.getByRole('spinbutton', { name: 'เวลารอที่จุดรับเพิ่มเติม (นาที)', exact: true })).toHaveValue(String(loserIndex ? 10 : 5))
    await expect(loser.getByRole('button', { name: /^คนขับ:/ })).toContainText('Synthetic replacement driver')
    const after = await f.snapshot(original.id)
    expect(after.booking.driverId).toBe(driver2)
    expect(after.booking.vehicleId).toBe('50000000-0000-4000-8000-000000000002')
    expect(after.booking.revision).toBe(original.revision + 1)
    expect(after.booking.executionVersion).toBe(original.executionVersion + 1)
    expect(after.booking.schedule?.pickupWaitingMinutes).toBe(winnerIndex ? 10 : 5)
    expect(after.schedules).toHaveLength(before.schedules.length + 1)
    const oldSchedule = before.schedules.find((row: { committed: boolean; released_at: unknown }) => row.committed && !row.released_at)
    expect(after.schedules.find((row: { id: string }) => row.id === oldSchedule.id).released_at).toBeTruthy()
    expect(after.schedules.filter((row: { committed: boolean; released_at: unknown }) => row.committed && !row.released_at)).toHaveLength(1)
    const events = (await f.pool.query("SELECT id,actor_id,command_data FROM patient_transfer.trip_events WHERE booking_id=$1 AND command='MODIFY_ASSIGNMENT'", [original.id])).rows
    expect(events).toHaveLength(1)
    const winningAttempt = attempts.find(attempt => attempt.page === winner)!
    expect(events[0].id).toBe(winningAttempt.body.eventId)
    expect(events[0].command_data.reason).toBe(reasons[winnerIndex])
    const audits = (await f.pool.query("SELECT actor_id,reason FROM patient_transfer.audit_logs WHERE entity_id=$1 AND action='MODIFY_ASSIGNMENT'", [original.id])).rows
    expect(audits).toHaveLength(1); expect(audits[0].reason).toBe(reasons[winnerIndex])
    expect(audits[0].actor_id).toBe(events[0].actor_id)
    expect(events[0].actor_id === dispatcher2).toBe(winnerIndex === 1)
    const messages = (await f.pool.query("SELECT event_id,recipient_id,message_data,status,attempts FROM patient_transfer.notifications WHERE booking_id=$1 AND template_key='ASSIGNMENT_CHANGED'", [original.id])).rows
    expect(messages).toHaveLength(3)
    expect(messages.every((row: { event_id: string; status: string; attempts: number }) => row.event_id === events[0].id && row.status === 'PENDING' && row.attempts === 0)).toBe(true)
    expect(messages.map((row: { recipient_id: string }) => row.recipient_id).sort()).toEqual([ids.citizen, '00000000-0000-4000-8000-000000000003', driver2Account].sort())
    expect(new Set(messages.map((row: { recipient_id: string }) => row.recipient_id)).size).toBe(3)
    expect(messages.find((row: { recipient_id: string }) => row.recipient_id === driver2Account).message_data.meaning).toBe('assigned')
    expect(messages.some((row: { message_data: { meaning: string } }) => row.message_data.meaning === 'removed')).toBe(true)
    // A second explicit stale request must leave every application table unchanged.
    const committed = await recoveryFingerprint(f.pool)
    const staleAttempt = attempts.find(attempt => attempt.page === loser)!
    const stale = await fetch(`${f.base}/api/bookings/${original.id}/modification`, { method: 'POST', headers: { Authorization: staleAttempt.authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...staleAttempt.body, eventId: randomUUID() }) })
    expect(stale.status).toBe(409)
    expect(await recoveryFingerprint(f.pool)).toEqual(committed)
    const oldWrite = oldDriver.waitForResponse(response => response.url().endsWith('/commands') && response.request().method() === 'POST')
    await oldDriver.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
    expect((await oldWrite).status()).toBe(403)
    expect(await recoveryFingerprint(f.pool)).toEqual(committed)
    await f.request(`/bookings/${original.id}`, 'driver', undefined, 403)
    await f.request(`/bookings/${original.id}`, 'driver2')
    await oldDriver.getByRole('button', { name: 'ยกเลิก', exact: true }).click()
    await oldDriver.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
    await expect(oldDriver.getByRole('heading', { name: 'ไม่พบงานที่มอบหมายให้คนขับนี้', exact: true })).toBeVisible()
    await expect(oldDriver.getByText(original.patientName, { exact: false })).toHaveCount(0)
    await newDriver.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
    await expect(newDriver.getByText(`ผู้รับบริการ • ${original.patientName}`, { exact: true })).toBeVisible()
    await newDriver.getByRole('button', { name: 'เริ่มงาน', exact: true }).click()
    const newWrite = newDriver.waitForResponse(response => response.url().endsWith('/commands') && response.request().method() === 'POST')
    await newDriver.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
    expect((await newWrite).status()).toBe(200)
    await expect(newDriver.getByRole('heading', { name: 'เริ่มงานแล้ว · ยังไม่ออกจากต้นทาง', exact: true })).toBeVisible()
    const started = await f.get(original.id)
    expect(started.driverId).toBe(driver2); expect(started.startedAt).toBeTruthy(); expect(started.status).toBe('ASSIGNED')
  } finally {
    release()
    for (const context of contexts) { for (const page of context.pages()) await page.unrouteAll({ behavior: 'wait' }); await context.close() }
    await f.close()
  }
})

for (const variant of ['both', 'driver', 'vehicle', 'driver-incident'] as const) test(`post-start ${variant} replacement rejects invalid handoff, preserves cutoff and separates retained/released resources`, async ({ browser }) => {
  test.setTimeout(90000)
  const incident = variant === 'driver-incident'
  const replaceDriver = variant !== 'vehicle', replaceVehicle = variant !== 'driver' && !incident
  const subject = `U${'7'.repeat(32)}`
  const f = await startOperationalTestApi({ liffId: 'synthetic-reassignment', verifyLine: async token => {
    if (token !== 'synthetic-reassignment-owner') throw new Error('Unexpected synthetic identity')
    return { subject, name: 'Synthetic reassignment requester' }
  } })
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()))
  const pickup = '20000000-0000-4000-8000-000000000003', vehicle2 = '50000000-0000-4000-8000-000000000002'
  try {
    await f.pool.query('UPDATE patient_transfer.users SET line_subject=$1 WHERE id=$2', [subject, ids.citizen])
    const account = randomUUID(), replacement = randomUUID()
    await f.pool.query(`INSERT INTO patient_transfer.users(id,role,username,display_name,password_hash)
      SELECT $1,'driver','synthetic-driver2','Synthetic handoff driver',password_hash FROM patient_transfer.users WHERE username='synthetic-driver'`, [account])
    await f.pool.query(`INSERT INTO patient_transfer.drivers(id,user_id,location_id,available_at,capabilities)
      VALUES($1,$2,$3,'2029-01-01',ARRAY['standard']::patient_transfer.mobility_type[])`, [replacement, account, ids.depot])
    await f.pool.query(`INSERT INTO patient_transfer.availability_windows(driver_id,starts_at,ends_at)
      VALUES($1,'2030-01-15T06:00:00+07:00','2030-01-15T16:00:00+07:00')`, [replacement])
    const currentDriver = replaceDriver ? replacement : ids.driver, currentVehicle = replaceVehicle ? vehicle2 : ids.vehicle
    let booking = await f.assigned()
    f.control.now = '2030-01-15T00:50:00.000Z'
    for (const role of ['dispatcher', 'driver', 'driver2']) await f.login(role)
    const [dispatcher, oldDriver, newDriver, citizen] = await Promise.all(contexts.map(context => context.newPage()))
    async function wire(page: Page) {
      await page.clock.setFixedTime(new Date(f.control.now))
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url())
        await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
      })
      await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line\.me|line-scdn).*/, route => route.abort())
    }
    async function staff(page: Page, username: string, path: string) {
      await wire(page)
      await page.goto(`/staff/login?next=${encodeURIComponent(path)}`)
      await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill(username)
      await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
      await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
      await page.getByRole('link', { name: username.includes('driver') ? 'เปิดหน้าคนขับ' : 'เปิดหน้าจัดรถ', exact: true }).click()
      await expect(page.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
    }
    await wire(citizen)
    await citizen.route('**/src/services/lineClient.ts', route => route.fulfill({ contentType: 'application/javascript', body: 'export async function lineIdToken() { return "synthetic-reassignment-owner" }' }))
    await citizen.goto(`/booking/cancel/${booking.id}`)
    await expect(citizen.getByRole('button', { name: 'ยืนยันยกเลิกการจอง', exact: true })).toBeEnabled()
    await staff(oldDriver, 'synthetic-driver', `/driver/details?booking=${booking.id}`)
    async function driverStep(page: Page, label: string) {
      await page.getByRole('button', { name: label, exact: true }).click()
      const response = page.waitForResponse(row => row.url().endsWith('/commands') && row.request().method() === 'POST')
      await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
      expect((await response).status()).toBe(200)
      await expect(page.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
    }
    await driverStep(oldDriver, 'เริ่มงาน')
    await driverStep(oldDriver, 'ออกจากต้นทางไปรับผู้ป่วย')
    booking = await f.get(booking.id)
    expect(booking.status).toBe('PICKING_UP')
    const originalStart = booking.startedAt!
    await oldDriver.getByRole('button', { name: 'รับผู้ป่วยขึ้นรถแล้ว', exact: true }).click()
    const incidentReason = 'คนขับไม่พร้อมปฏิบัติงานต่อ ขอให้เจ้าหน้าที่จัดชุดรับช่วง'
    let reportedIncident: Record<string, unknown> | undefined
    let reportedDriverHold: Record<string, unknown> | undefined
    if (incident) {
      // Keep the old pickup confirmation open while a second real session reports.
      f.control.now = '2030-01-15T00:51:00.000Z'
      const reporter = await oldDriver.context().newPage()
      await staff(reporter, 'synthetic-driver', `/driver/status?booking=${booking.id}`)
      await reporter.getByRole('button', { name: 'รายงานเหตุขัดข้อง', exact: true }).click()
      await reporter.getByRole('textbox', { name: 'เหตุผลที่รายงาน', exact: true }).fill(incidentReason)
      const report = reporter.waitForResponse(row => row.url().endsWith('/commands') && row.request().method() === 'POST')
      await reporter.getByRole('button', { name: 'ยืนยันรายงานเหตุขัดข้อง', exact: true }).click()
      expect((await report).status()).toBe(200)
      await expect(reporter.getByRole('button', { name: 'รับผู้ป่วยขึ้นรถแล้ว', exact: true })).toBeDisabled()
      booking = await f.get(booking.id)
      expect(booking.status).toBe('PICKING_UP'); expect(booking.incidentOpen).toBe(true); expect(booking.resourceHold).toBe(true)
      const incidentHolds = (await f.pool.query('SELECT vehicle_id,driver_id FROM patient_transfer.resource_holds WHERE booking_id=$1 AND ends_at IS NULL', [booking.id])).rows
      expect(incidentHolds).toEqual(expect.arrayContaining([{ vehicle_id: ids.vehicle, driver_id: null }, { vehicle_id: null, driver_id: ids.driver }]))
      expect(incidentHolds).toHaveLength(2)
      reportedIncident = (await f.pool.query('SELECT * FROM patient_transfer.trip_incidents WHERE booking_id=$1', [booking.id])).rows[0]
      expect(reportedIncident!.reason).toBe(incidentReason)
      expect(reportedIncident!.reported_by).toBe('00000000-0000-4000-8000-000000000003')
      expect(reportedIncident!.resolved_at).toBeNull()
      reportedDriverHold = (await f.pool.query('SELECT * FROM patient_transfer.resource_holds WHERE booking_id=$1 AND driver_id=$2 AND ends_at IS NULL', [booking.id, ids.driver])).rows[0]
      const blocked = await recoveryFingerprint(f.pool)
      await f.command(booking, 'CONFIRM_PICKUP', {}, 'driver', 409)
      await f.request(`/resources/vehicles/${ids.vehicle}/readiness`, 'dispatcher', { locationId: pickup, reason: 'Readiness cannot resolve active incident execution' }, 409)
      expect(await recoveryFingerprint(f.pool)).toEqual(blocked)
    }
    await citizen.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
    await expect(citizen.getByRole('button', { name: 'ยืนยันยกเลิกการจอง', exact: true })).toBeDisabled()
    await staff(newDriver, replaceDriver ? 'synthetic-driver2' : 'synthetic-driver', `/driver/details?booking=${booking.id}`)
    if (replaceDriver) await expect(newDriver.getByRole('heading', { name: 'ไม่พบงานที่มอบหมายให้คนขับนี้', exact: true })).toBeVisible()
    else await expect(newDriver.getByText(`ผู้รับบริการ • ${booking.patientName}`, { exact: true })).toBeVisible()
    f.control.now = '2030-01-15T00:52:00.000Z'
    // A fresh synthetic route is shorter, keeping the replacement departure in the future.
    f.control.minutes = 15
    // Both replacement resources are independently confirmed at the safe handoff origin.
    for (const [kind, id] of [...(replaceVehicle ? [['vehicles', vehicle2]] : []), ...(replaceDriver ? [['drivers', replacement]] : [])]) await f.request(`/resources/${kind}/${id}/readiness`, 'dispatcher', { locationId: pickup, reason: 'Synthetic replacement physical location verified' })
    const reason = 'เปลี่ยนชุดรถและคนขับก่อนรับผู้ป่วย', note = 'ตรวจตำแหน่งจริงและให้ชุดเดิมรอการยืนยันความพร้อมแยกกัน'
    const body = (confirmedAt?: string) => f.selection(booking, { vehicleId: currentVehicle, driverId: currentDriver, originLocationId: pickup, originKind: 'handoff', reason,
      ...(confirmedAt ? { arrangement: { locationId: pickup, confirmedAt, note } } : {}) })
    async function rejects(payload: unknown, status: number) {
      const before = await recoveryFingerprint(f.pool)
      await f.request(`/bookings/${booking.id}/modification`, 'dispatcher', payload, status)
      expect(await recoveryFingerprint(f.pool)).toEqual(before)
    }
    await rejects(body(), 422)
    // Fresh in wall time, but preceding Start Trip: the domain must reject it.
    await rejects(body(new Date(Date.parse(originalStart) - 1000).toISOString()), 409)
    await rejects(body('2030-01-15T00:53:00.000Z'), 422)
    f.control.now = '2030-01-15T00:56:00.000Z'
    await rejects(body('2030-01-15T00:50:59.000Z'), 422) // After Start Trip, older than five minutes.
    if (variant !== 'both') {
      const mismatched = body(f.control.now)
      await rejects({ ...mismatched, arrangement: { locationId: ids.depot, confirmedAt: f.control.now, note } }, 422)
      // A retained resource must be explicitly confirmed at a handoff origin.
      await rejects({ ...mismatched, originKind: 'depot', originLocationId: ids.depot }, 409)
    }
    const retainedKey = replaceVehicle ? 'driver_id' : 'vehicle_id'
    const retainedId = replaceVehicle ? ids.driver : ids.vehicle
    const previousPositions = variant === 'both' ? [] : (await f.pool.query(`SELECT * FROM patient_transfer.resource_position_updates WHERE ${retainedKey}=$1 ORDER BY confirmed_at,id`, [retainedId])).rows
    await staff(dispatcher, 'synthetic-dispatcher', '/dispatcher/tracking')
    const read = dispatcher.waitForResponse(response => new URL(response.url()).pathname === '/api/bookings')
    await dispatcher.getByRole('button', { name: 'ดูสถานะ →', exact: true }).click(); await read
    await dispatcher.getByRole('combobox', { name: 'การดำเนินการ', exact: true }).selectOption('modify')
    const submit = dispatcher.getByRole('button', { name: 'ตรวจสอบและยืนยันการเปลี่ยนแปลง', exact: true })
    await expect(submit).toBeDisabled()
    if (incident) {
      await dispatcher.getByRole('button', { name: /^รถรับส่ง:/ }).click()
      const retained = dispatcher.getByRole('option', { name: /SYNTHETIC-01/ })
      await expect(retained).toBeEnabled(); await retained.click()
    }
    if (replaceVehicle) {
      await dispatcher.getByRole('button', { name: /^รถรับส่ง:/ }).click()
      await dispatcher.getByRole('option', { name: /SYNTHETIC-02/ }).click()
    }
    if (replaceDriver) {
      await dispatcher.getByRole('button', { name: /^คนขับ:/ }).click()
      await dispatcher.getByRole('option', { name: /Synthetic handoff driver/ }).click()
    }
    await dispatcher.getByRole('combobox', { name: 'ต้นทาง', exact: true }).selectOption(pickup)
    await dispatcher.getByRole('textbox', { name: 'เหตุผลการเปลี่ยนแปลง', exact: true }).fill(reason)
    await dispatcher.getByRole('textbox', { name: 'การยืนยันต้นทางและการรับช่วง', exact: true }).fill(note)
    await expect(submit).toBeDisabled()
    const confirmed = dispatcher.getByRole('checkbox', { name: 'ยืนยันตำแหน่งและแผนรับช่วงจริงแล้ว (ต้องยืนยันภายใน 5 นาที)', exact: true })
    await dispatcher.clock.setFixedTime(new Date('2030-01-15T00:50:59.000Z'))
    await confirmed.check(); await submit.click()
    const beforeStale = await recoveryFingerprint(f.pool)
    let response = dispatcher.waitForResponse(row => row.url().endsWith('/modification') && row.request().method() === 'POST')
    await dispatcher.getByRole('dialog', { name: 'ยืนยันการเปลี่ยนแปลง', exact: true }).getByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง', exact: true }).click()
    expect((await response).status()).toBe(422)
    expect(await recoveryFingerprint(f.pool)).toEqual(beforeStale)
    const confirmation = dispatcher.getByRole('dialog', { name: 'ยืนยันการเปลี่ยนแปลง', exact: true })
    await expect(confirmation.getByRole('alert')).toBeVisible()
    await confirmation.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true }).click()
    await expect(dispatcher.getByRole('textbox', { name: 'การยืนยันต้นทางและการรับช่วง', exact: true })).toHaveValue(note)
    await expect(dispatcher.getByRole('textbox', { name: 'เหตุผลการเปลี่ยนแปลง', exact: true })).toHaveValue(reason)
    await dispatcher.clock.setFixedTime(new Date(f.control.now))
    await confirmed.uncheck(); await confirmed.check(); await submit.click()
    response = dispatcher.waitForResponse(row => row.url().endsWith('/modification') && row.request().method() === 'POST')
    await dispatcher.getByRole('dialog', { name: 'ยืนยันการเปลี่ยนแปลง', exact: true }).getByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง', exact: true }).click()
    const modification = await response
    expect(modification.status(), modification.status() === 200 ? '' : (await modification.json()).error).toBe(200)
    await expect(dispatcher.getByRole('dialog', { name: 'ติดตามสถานะงานรับส่ง', exact: true })).toHaveCount(0)
    const reassigned = await f.get(booking.id)
    expect(reassigned.status).toBe('ASSIGNED'); expect(reassigned.startedAt).toBeNull()
    expect(reassigned.cancellationLocked).toBe(true); expect(reassigned.executionVersion).toBe(booking.executionVersion + 1)
    expect(reassigned.resourceHold).toBe(true)
    if (incident) {
      expect(reassigned.incidentOpen).toBe(false)
      const records = (await f.pool.query('SELECT * FROM patient_transfer.trip_incidents WHERE booking_id=$1', [booking.id])).rows
      expect(records).toHaveLength(1)
      const { resolved_at, resolved_by, resolution, ...originalFields } = records[0]
      const { resolved_at: oldResolvedAt, resolved_by: oldResolvedBy, resolution: oldResolution, ...reportedFields } = reportedIncident!
      void oldResolvedAt; void oldResolvedBy; void oldResolution
      expect(originalFields).toEqual(reportedFields)
      expect(resolved_at.toISOString()).toBe(f.control.now)
      expect(resolved_by).toBe('00000000-0000-4000-8000-000000000002')
      expect(resolution).toBe(reason)
      const retainedHolds = (await f.pool.query('SELECT starts_at,ends_at FROM patient_transfer.resource_holds WHERE booking_id=$1 AND vehicle_id=$2', [booking.id, ids.vehicle])).rows
      expect(retainedHolds).toHaveLength(1)
      expect(retainedHolds[0].starts_at.toISOString()).toBe('2030-01-15T00:51:00.000Z')
      expect(retainedHolds[0].ends_at.toISOString()).toBe(f.control.now)
      const oldDriverHolds = (await f.pool.query('SELECT * FROM patient_transfer.resource_holds WHERE booking_id=$1 AND driver_id=$2 AND ends_at IS NULL', [booking.id, ids.driver])).rows
      expect(oldDriverHolds).toEqual([reportedDriverHold])
      const catalog = await f.request('/catalog')
      expect(catalog.vehicles.find((row: { id: string }) => row.id === ids.vehicle).held).toBe(false)
      expect(catalog.drivers.find((row: { id: string }) => row.id === ids.driver).held).toBe(true)
    }
    expect((await f.request(`/bookings/${booking.id}`, replaceDriver ? 'driver2' : 'driver')).resourceHold).toBe(false)
    const holds = async () => (await f.pool.query('SELECT vehicle_id,driver_id FROM patient_transfer.resource_holds WHERE booking_id=$1 AND ends_at IS NULL ORDER BY id', [booking.id])).rows
    const expectedHolds = [...(replaceVehicle ? [{ vehicle_id: ids.vehicle, driver_id: null }] : []), ...(replaceDriver ? [{ vehicle_id: null, driver_id: ids.driver }] : [])]
    expect(await holds()).toEqual(expect.arrayContaining(expectedHolds))
    expect(await holds()).toHaveLength(expectedHolds.length)
    if (variant !== 'both') {
      const positions = (await f.pool.query(`SELECT * FROM patient_transfer.resource_position_updates WHERE ${retainedKey}=$1 ORDER BY confirmed_at,id`, [retainedId])).rows
      expect(positions).toHaveLength(previousPositions.length + 1)
      expect(positions.slice(0, previousPositions.length)).toEqual(previousPositions)
      const last = positions.at(-1)
      expect(last.location_id).toBe(pickup)
      expect(last.confirmed_at.toISOString()).toBe(f.control.now)
      expect(last.confirmed_by).toBe('00000000-0000-4000-8000-000000000002')
      expect(reassigned.schedule?.originKind).toBe('handoff')
      expect(reassigned.schedule?.originLocationId).toBe(pickup)
    }
    const history = (await f.pool.query("SELECT command,command_data FROM patient_transfer.trip_events WHERE booking_id=$1 ORDER BY sequence", [booking.id])).rows
    expect(history.filter((row: { command: string }) => row.command === 'START_TRIP')).toHaveLength(1)
    expect(history.find((row: { command: string }) => row.command === 'MODIFY_ASSIGNMENT').command_data.arrangement).toEqual({ locationId: pickup, confirmedAt: f.control.now, note })
    const locked = await recoveryFingerprint(f.pool)
    await f.command(reassigned, 'CANCEL', { reason: 'Cutoff must not reset' }, 'citizen', 409)
    expect(await recoveryFingerprint(f.pool)).toEqual(locked)
    await citizen.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
    await expect(citizen.getByRole('button', { name: 'ยืนยันยกเลิกการจอง', exact: true })).toBeDisabled()
    const oldWrite = oldDriver.waitForResponse(row => row.url().endsWith('/commands') && row.request().method() === 'POST')
    await oldDriver.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
    expect((await oldWrite).status()).toBe(replaceDriver ? 403 : 409)
    expect(await recoveryFingerprint(f.pool)).toEqual(locked)
    await newDriver.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
    await expect(newDriver.getByRole('button', { name: 'เริ่มงาน', exact: true })).toBeEnabled()
    await driverStep(newDriver, 'เริ่มงาน')
    expect((await f.get(booking.id)).startedAt).toBeTruthy()
    expect(await holds()).toHaveLength(expectedHolds.length)
    if (!incident) {
      // New reassignment holds cannot be released at their creation instant.
      const active = await recoveryFingerprint(f.pool)
      await f.request(`/resources/${replaceVehicle ? 'vehicles/' + ids.vehicle : 'drivers/' + ids.driver}/readiness`, 'dispatcher', { locationId: pickup, reason: 'Too early readiness' }, 409)
      expect(await recoveryFingerprint(f.pool)).toEqual(active)
    }
    // The preserved incident hold began earlier; handoff must not reset that timestamp.
    f.control.now = reassigned.schedule!.departureAt
    await driverStep(newDriver, 'ออกจากต้นทางไปรับผู้ป่วย')
    expect((await f.get(booking.id)).status).toBe('PICKING_UP')
    f.control.now = new Date(Date.parse(f.control.now) + 60000).toISOString()
    async function ready(value: string, location = pickup, status = 200) {
      const summary = dispatcher.getByText('ยืนยันตำแหน่งและความพร้อมรถหรือคนขับ', { exact: true })
      if (await summary.locator('..').getAttribute('open') === null) await summary.click()
      await dispatcher.getByRole('combobox', { name: 'ทรัพยากรที่ตรวจสอบ', exact: true }).selectOption(value)
      await dispatcher.getByRole('combobox', { name: 'ตำแหน่งปัจจุบันที่ยืนยันแล้ว', exact: true }).selectOption(location)
      await dispatcher.getByRole('textbox', { name: 'เหตุผลและผลตรวจสอบ', exact: true }).fill('ตรวจตำแหน่งจริงและพร้อมใช้งานแล้ว')
      await dispatcher.getByRole('checkbox', { name: 'ยืนยันตำแหน่งจริงและความพร้อมของทรัพยากรนี้แล้ว', exact: true }).check()
      const response = dispatcher.waitForResponse(row => row.url().endsWith('/readiness') && row.request().method() === 'POST')
      await dispatcher.getByRole('button', { name: 'ยืนยันความพร้อมทรัพยากรนี้', exact: true }).click()
      expect((await response).status()).toBe(status)
      await expect(dispatcher.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
    }
    if (variant !== 'both') {
      const current = await recoveryFingerprint(f.pool)
      const retainedResource = replaceVehicle ? 'drivers/' + ids.driver : 'vehicles/' + ids.vehicle
      await f.request(`/resources/${retainedResource}/readiness`, 'dispatcher', { locationId: pickup, reason: 'Active retained resource cannot be released' }, 409)
      expect(await recoveryFingerprint(f.pool)).toEqual(current)
    }
    if (replaceVehicle) {
      await ready(`vehicles/${ids.vehicle}`)
      expect(await holds()).toEqual(replaceDriver ? [{ vehicle_id: null, driver_id: ids.driver }] : [])
      expect((await f.get(booking.id)).resourceHold).toBe(replaceDriver)
    }
    if (replaceDriver) await ready(`drivers/${ids.driver}`)
    expect(await holds()).toEqual([])
    const final = await f.get(booking.id)
    expect(final.driverId).toBe(currentDriver); expect(final.vehicleId).toBe(currentVehicle); expect(final.status).toBe('PICKING_UP'); expect(final.resourceHold).toBe(false)
    expect(final.cancellationLocked).toBe(true)
    if (incident) {
      expect(final.incidentOpen).toBe(false)
      const preserved = (await f.pool.query('SELECT * FROM patient_transfer.trip_incidents WHERE booking_id=$1', [booking.id])).rows
      expect(preserved).toHaveLength(1); expect(preserved[0].id).toBe(reportedIncident!.id); expect(preserved[0].reason).toBe(incidentReason)
      const released = (await f.pool.query('SELECT ends_at FROM patient_transfer.resource_holds WHERE booking_id=$1 AND driver_id=$2', [booking.id, ids.driver])).rows
      expect(released).toHaveLength(1); expect(released.every((row: { ends_at: unknown }) => row.ends_at)).toBe(true)
    }
    const notices = (await f.pool.query("SELECT recipient_id,status,attempts,message_data FROM patient_transfer.notifications WHERE booking_id=$1 AND template_key='ASSIGNMENT_CHANGED'", [booking.id])).rows
    expect(notices).toHaveLength(replaceDriver ? 3 : 2)
    expect(notices.map((row: { recipient_id: string }) => row.recipient_id).sort()).toEqual([ids.citizen, '00000000-0000-4000-8000-000000000003', ...(replaceDriver ? [account] : [])].sort())
    if (!replaceDriver) expect(notices.find((row: { recipient_id: string }) => row.recipient_id !== ids.citizen).message_data.meaning).toBe('changed')
    if (variant === 'both') {
      const currentResources = [['vehicles', 'vehicle_id', currentVehicle], ['drivers', 'driver_id', currentDriver]]
      const positionHistory = await Promise.all(currentResources.map(async ([, key, id]) =>
        (await f.pool.query(`SELECT * FROM patient_transfer.resource_position_updates WHERE ${key}=$1 ORDER BY confirmed_at,id`, [id])).rows))
      async function rejectsOldExecution(type: string) {
        const current = await f.get(booking.id), before = await recoveryFingerprint(f.pool)
        await f.request(`/bookings/${booking.id}/commands`, 'driver2', { eventId: randomUUID(),
          expectedRevision: current.revision, expectedExecutionVersion: booking.executionVersion, command: { type } }, 409)
        expect(await recoveryFingerprint(f.pool)).toEqual(before)
      }
      const hospital = reassigned.hospitalLocationId!
      f.control.now = reassigned.schedule!.pickupAt
      await rejectsOldExecution('CONFIRM_PICKUP')
      await driverStep(newDriver, 'รับผู้ป่วยขึ้นรถแล้ว')
      expect((await f.get(booking.id)).status).toBe('PICKED_UP')
      await driverStep(newDriver, 'ออกเดินทางไปโรงพยาบาล')
      expect((await f.get(booking.id)).status).toBe('IN_TRANSIT')
      const actualHandover = new Date(Date.parse(reassigned.schedule!.arrivalAt) + 10 * 60000).toISOString()
      f.control.now = actualHandover
      await rejectsOldExecution('CONFIRM_HANDOVER')
      await driverStep(newDriver, 'ส่งถึงโรงพยาบาลแล้ว')
      await expect(newDriver).toHaveURL(/driver\/history$/)
      await expect(newDriver.getByText(booking.patientName, { exact: false })).toHaveCount(0)
      await expect(newDriver.locator('a[href^="tel:"]')).toHaveCount(0)
      const completed = await f.get(booking.id)
      expect(completed.status).toBe('COMPLETED'); expect(completed.resourceHold).toBe(true)
      expect(completed.driverId).toBe(currentDriver); expect(completed.vehicleId).toBe(currentVehicle)
      expect(completed.schedule).toEqual(reassigned.schedule)
      const events = (await f.pool.query('SELECT command,actor_id,recorded_at FROM patient_transfer.trip_events WHERE booking_id=$1 ORDER BY sequence', [booking.id])).rows
      expect(events.map((row: { command: string }) => row.command)).toEqual(['APPROVE', 'CONFIRM_SCHEDULE', 'ASSIGN',
        'START_TRIP', 'DEPART_ORIGIN', 'MODIFY_ASSIGNMENT', 'START_TRIP', 'DEPART_ORIGIN', 'CONFIRM_PICKUP', 'DEPART_FOR_HOSPITAL', 'CONFIRM_HANDOVER'])
      expect(events[3].actor_id).toBe('00000000-0000-4000-8000-000000000003')
      expect(events[3].recorded_at.toISOString()).toBe(originalStart)
      expect(events.slice(6).every((row: { actor_id: string }) => row.actor_id === account)).toBe(true)
      expect(events.at(-1).recorded_at.toISOString()).toBe(actualHandover)
      const outcome = citizen.waitForResponse(row => new URL(row.url()).pathname === `/api/bookings/${booking.id}` && row.request().method() === 'GET')
      await citizen.getByRole('button', { name: 'กลับไปดูรายละเอียด', exact: true }).click()
      const own = await (await outcome).json()
      expect(own.status).toBe('COMPLETED'); expect(own.driverId).toBe(currentDriver); expect(own.vehicleId).toBe(currentVehicle)
      expect(own.hospitalLocationId).toBe(hospital)
      await expect(citizen.getByText('ผู้ป่วยเดินทางถึงโรงพยาบาลแล้ว', { exact: true })).toBeVisible()
      await expect(citizen.getByText('Synthetic hospital', { exact: true })).toBeVisible()
      await expect(citizen.getByRole('button', { name: 'ยกเลิกการจอง', exact: true })).toHaveCount(0)
      expect(await holds()).toHaveLength(2)
      const boundary = Math.max(Date.parse(completed.schedule!.readyAt), Date.parse(actualHandover) + 30 * 60000)
      expect(boundary).toBeGreaterThan(Date.parse(completed.schedule!.readyAt))
      // Both current resources remain held even at the old planned readiness time.
      f.control.now = completed.schedule!.readyAt
      for (const resource of [`vehicles/${currentVehicle}`, `drivers/${currentDriver}`]) {
        const before = await recoveryFingerprint(f.pool)
        await f.request(`/resources/${resource}/readiness`, 'dispatcher', { locationId: hospital, reason: 'Planned readiness cannot waive actual turnaround' }, 409)
        expect(await recoveryFingerprint(f.pool)).toEqual(before)
      }
      f.control.now = new Date(boundary - 1).toISOString()
      const refreshed = dispatcher.waitForResponse(row => new URL(row.url()).pathname === '/api/catalog')
      await dispatcher.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click(); await refreshed
      await expect(dispatcher.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
      const beforeEarly = await recoveryFingerprint(f.pool)
      await ready(`vehicles/${currentVehicle}`, hospital, 409)
      await expect(dispatcher.getByRole('alert').filter({ hasText: 'ข้อมูลหรือความพร้อมเปลี่ยนแล้ว' })).toBeVisible()
      await expect(dispatcher.getByRole('textbox', { name: 'เหตุผลและผลตรวจสอบ', exact: true })).toHaveValue('ตรวจตำแหน่งจริงและพร้อมใช้งานแล้ว')
      expect(await recoveryFingerprint(f.pool)).toEqual(beforeEarly)
      // Exact handover + 30-minute boundary permits each independent confirmation.
      f.control.now = new Date(boundary).toISOString()
      await ready(`vehicles/${currentVehicle}`, hospital)
      expect(await holds()).toEqual([{ vehicle_id: null, driver_id: currentDriver }])
      expect((await f.get(booking.id)).resourceHold).toBe(true)
      await ready(`drivers/${currentDriver}`, hospital)
      expect(await holds()).toEqual([])
      const ended = await f.get(booking.id)
      expect(ended.status).toBe('COMPLETED'); expect(ended.resourceHold).toBe(false)
      expect(ended.cancellationLocked).toBe(true)
      for (const [index, [kind, key, id]] of currentResources.entries()) {
        const positions = (await f.pool.query(`SELECT * FROM patient_transfer.resource_position_updates WHERE ${key}=$1 ORDER BY confirmed_at,id`, [id])).rows
        expect(positions).toHaveLength(positionHistory[index].length + 1)
        expect(positions.slice(0, -1)).toEqual(positionHistory[index])
        expect(positions.at(-1).location_id).toBe(hospital)
        expect(positions.at(-1).confirmed_at.toISOString()).toBe(new Date(boundary).toISOString())
        expect(positions.at(-1).confirmed_by).toBe('00000000-0000-4000-8000-000000000002')
        expect((await f.pool.query(`SELECT location_id FROM patient_transfer.${kind} WHERE id=$1`, [id])).rows[0].location_id).toBe(ids.depot)
      }
      const completion = (await f.pool.query("SELECT recipient_id,status,attempts,message_data FROM patient_transfer.notifications WHERE booking_id=$1 AND template_key='TRIP_CONFIRM_HANDOVER'", [booking.id])).rows
      expect(completion.map((row: { recipient_id: string }) => row.recipient_id).sort()).toEqual([ids.citizen, account].sort())
      expect(completion.every((row: { status: string; attempts: number; message_data: { status: string } }) => row.status === 'PENDING' && row.attempts === 0 && row.message_data.status === 'COMPLETED')).toBe(true)
    }
    expect(notices.every((row: { status: string; attempts: number }) => row.status === 'PENDING' && row.attempts === 0)).toBe(true)
  } finally {
    for (const context of contexts) { for (const page of context.pages()) await page.unrouteAll({ behavior: 'wait' }); await context.close() }
    await f.close()
  }
})
