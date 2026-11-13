import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { startOperationalTestApi } from './helpers/operational-postgres'
import { syntheticPassword } from './helpers/admin-postgres.mjs'
import { newToken, tokenHash } from '../server/auth.mjs'

test.use({ actionTimeout: 10000 })
test.beforeEach(() => test.skip(!process.env.DATABASE_TEST_ADMIN_URL, 'Local test PostgreSQL required'))

async function openStaff(page: Page, base: string, path = '/dispatcher', role = 'dispatcher') {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    await route.fulfill({ response: await route.fetch({ url: `${base}${url.pathname}${url.search}` }) })
  })
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
  await page.goto(`/staff/login?next=${encodeURIComponent(path)}`)
  await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill(`synthetic-${role}`)
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await page.getByRole('link', { name: role === 'driver' ? 'เปิดหน้าคนขับ' : 'เปิดหน้าจัดรถ', exact: true }).click()
  await expect(page.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
}

// Bulk fixtures live only in the isolated database; preserve all schema guards.
async function cloneRequests(f: Awaited<ReturnType<typeof startOperationalTestApi>>, id: string, count = 102) {
  await f.pool.query(`INSERT INTO patient_transfer.bookings
    SELECT (jsonb_populate_record(NULL::patient_transfer.bookings,to_jsonb(b)||jsonb_build_object(
      'id',gen_random_uuid(),'reference','PAGE-'||n,'patient_name','ผู้ป่วยหน้าถัดไป '||n,
      'appointment_at','2030-01-15T02:00:00.123456Z'))).* FROM patient_transfer.bookings b
    CROSS JOIN generate_series(1,$2::integer) n WHERE b.id=$1`, [id, count])
}

test('dispatcher loads beyond 100 with precise tied timestamps; cursors retain authorization and stable positions', async ({ page }) => {
  test.setTimeout(90000)
  const f = await startOperationalTestApi()
  try {
    const seed = await f.requested()
    await cloneRequests(f, seed.id)
    const expected = (await f.pool.query('SELECT id,patient_name FROM patient_transfer.bookings ORDER BY appointment_at,id')).rows
    const first = await f.request('/bookings')
    expect(first.bookings).toHaveLength(100)
    for (const row of first.bookings) expect(row).toEqual(await f.get(row.id))
    const second = await f.request(`/bookings?cursor=${encodeURIComponent(first.nextCursor)}`)
    expect(second.nextCursor).toBeNull()
    expect([...first.bookings, ...second.bookings].map(b => b.id)).toEqual(expected.map(b => b.id))
    const own = await f.request('/bookings', 'citizen')
    expect((await f.request(`/bookings?cursor=${encodeURIComponent(own.nextCursor)}`, 'citizen')).bookings).toHaveLength(3)
    await f.request(`/bookings?cursor=${encodeURIComponent(first.nextCursor)}`, 'citizen', undefined, 400)
    for (const cursor of ['', 'not-json', Buffer.from(JSON.stringify({ scope: 'bad' })).toString('base64url')]) await f.request(`/bookings?cursor=${cursor}`, 'dispatcher', undefined, 400)
    await f.request('/bookings', 'admin', undefined, 403)
    await f.request('/driver/history', 'dispatcher', undefined, 403)
    // A cursor is not a reference lookup: insertion before its boundary cannot
    // shift the following page or reveal another requester's rows.
    await f.requested('08:00')
    expect((await f.request(`/bookings?cursor=${encodeURIComponent(first.nextCursor)}`)).bookings.map(b => b.id)).toEqual(second.bookings.map(b => b.id))
    const outsider = randomUUID(), token = newToken()
    await f.pool.query("INSERT INTO patient_transfer.users(id,role,display_name) VALUES($1,'citizen','Other requester')", [outsider])
    await f.pool.query(`INSERT INTO patient_transfer.auth_sessions(user_id,token_hash,access_version,created_at,expires_at)
      SELECT id,$2,access_version,'2030-01-01','2031-01-01' FROM patient_transfer.users WHERE id=$1`, [outsider, tokenHash(token)])
    const foreign = await fetch(`${f.base}/api/bookings?cursor=${encodeURIComponent(own.nextCursor)}`, { headers: { Authorization: `Bearer ${token}` } })
    expect(foreign.status).toBe(400)
    const empty = await fetch(`${f.base}/api/bookings`, { headers: { Authorization: `Bearer ${token}` } })
    expect((await empty.json()).bookings).toEqual([])
    const target = expected.at(-1)!
    await openStaff(page, f.base)
    await expect(page.getByText(target.patient_name, { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'โหลดรายการเพิ่มเติม', exact: true }).click()
    await expect(page.getByText(target.patient_name, { exact: true })).toBeVisible()
    // Exercise keyboard refresh after traversing the large table, without
    // depending on pointer auto-scrolling through the large table.
    const refresh = page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true })
    await refresh.focus()
    await refresh.press('Enter')
    await expect(page.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
    await expect(page.getByText(target.patient_name, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'โหลดรายการเพิ่มเติม', exact: true })).toHaveCount(0)
  } finally { await page.unrouteAll({ behavior: 'wait' }); await page.close(); await f.close() }
})

test('separate dispatcher sessions reject a stale approval beyond the first page and deny revoked next-page reads', async ({ browser }) => {
  test.setTimeout(90000)
  const f = await startOperationalTestApi()
  const contexts = [await browser.newContext(), await browser.newContext()]
  try {
    const seed = await f.requested()
    await cloneRequests(f, seed.id)
    const target = (await f.pool.query('SELECT id,patient_name FROM patient_transfer.bookings ORDER BY appointment_at DESC,id DESC LIMIT 1')).rows[0]
    const pages = await Promise.all(contexts.map(context => context.newPage()))
    const credentials: string[] = []
    for (const page of pages) {
      const initialRead = page.waitForRequest(r => new URL(r.url()).pathname === '/api/bookings')
      await openStaff(page, f.base)
      credentials.push((await initialRead).headers().authorization)
      await page.getByRole('button', { name: 'โหลดรายการเพิ่มเติม', exact: true }).click()
      const card = page.getByRole('row').filter({ has: page.getByText(target.patient_name, { exact: true }) })
      await expect(card).toBeVisible()
      // Opening the detail route refreshes the loaded range. Both sessions must
      // finish that read before either commits, so the second command is stale.
      const detailRead = page.waitForResponse(r => new URL(r.url()).pathname === '/api/bookings' && new URL(r.url()).searchParams.has('cursor'))
      await card.getByRole('button', { name: 'ดูรายละเอียด →', exact: true }).click()
      await page.getByRole('button', { name: 'อนุมัติคำขอ', exact: true }).click()
      await detailRead
    }
    const [a, b] = pages
    const committed = a.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
    await a.getByRole('button', { name: 'ยืนยันอนุมัติ', exact: true }).click()
    expect((await committed).status()).toBe(200)
    const stale = b.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
    await b.getByRole('button', { name: 'ยืนยันอนุมัติ', exact: true }).click()
    expect((await stale).status()).toBe(409)
    await expect(b.getByRole('alert')).toContainText('ข้อมูลหรือความพร้อมเปลี่ยนแล้ว')
    expect((await f.pool.query("SELECT count(*)::int AS n FROM patient_transfer.trip_events WHERE booking_id=$1 AND command='APPROVE'", [target.id])).rows[0].n).toBe(1)
    await b.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true }).click()
    const refreshed = b.waitForResponse(r => new URL(r.url()).pathname === '/api/bookings' && new URL(r.url()).searchParams.has('cursor'))
    await b.keyboard.press('Escape')
    await refreshed
    await expect(b.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true })).toBeEnabled()
    const cursor = (await f.request('/bookings')).nextCursor
    const accounts = await f.request('/admin/accounts', 'admin')
    const dispatcher = accounts.accounts.find(account => account.role === 'dispatcher')
    await f.request(`/admin/accounts/${dispatcher.id}`, 'admin', { name: dispatcher.name, username: dispatcher.username, role: dispatcher.role, active: false, expectedRevision: dispatcher.revision, reason: 'Synthetic revocation between page requests' })
    const revoked = await fetch(`${f.base}/api/bookings?cursor=${encodeURIComponent(cursor)}`, { headers: { Authorization: credentials[1] } })
    expect(revoked.status).toBe(401)
    await b.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
    await expect(b).toHaveURL(/staff\/login/)
    await expect(b.getByText(target.patient_name, { exact: true })).toHaveCount(0)
  } finally {
    for (const context of contexts) { for (const page of context.pages()) await page.unrouteAll({ behavior: 'wait' }); await context.close() }
    await f.close()
  }
})

test('driver loads older minimized history beyond 100; ended and out-of-shift details remain denied', async ({ page }) => {
  test.setTimeout(90000)
  const f = await startOperationalTestApi()
  try {
    const assigned = await f.assigned()
    await f.command(assigned, 'CANCEL', { reason: 'Synthetic cancelled assignment' }, 'citizen')
    await cloneRequests(f, assigned.id)
    await f.pool.query(`INSERT INTO patient_transfer.schedules SELECT (jsonb_populate_record(NULL::patient_transfer.schedules,
      to_jsonb(s)||jsonb_build_object('id',gen_random_uuid(),'booking_id',b.id))).*
      FROM patient_transfer.schedules s CROSS JOIN patient_transfer.bookings b
      WHERE s.booking_id=$1 AND s.committed AND b.reference LIKE 'PAGE-%'`, [assigned.id])
    const first = await f.request('/driver/history', 'driver')
    const second = await f.request(`/driver/history?cursor=${encodeURIComponent(first.nextCursor)}`, 'driver')
    expect(first.bookings).toHaveLength(100)
    expect(second.bookings).toHaveLength(3)
    expect(second.nextCursor).toBeNull()
    for (const row of [...first.bookings, ...second.bookings]) expect(Object.keys(row).sort()).toEqual(['appointmentAt', 'id', 'reference', 'status'])
    const expected = (await f.pool.query('SELECT id FROM patient_transfer.bookings ORDER BY appointment_at DESC,id DESC')).rows.map(row => row.id)
    expect([...first.bookings, ...second.bookings].map(row => row.id)).toEqual(expected)
    await f.request(`/bookings/${assigned.id}`, 'driver', undefined, 403)
    expect((await f.request('/bookings', 'driver')).bookings).toEqual([])
    await f.request(`/bookings?cursor=${encodeURIComponent(first.nextCursor)}`, 'driver', undefined, 400)
    await openStaff(page, f.base, '/driver/history', 'driver')
    const oldest = second.bookings.at(-1).reference
    await expect(page.getByRole('heading', { name: oldest, exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'โหลดประวัติเพิ่มเติม', exact: true }).click()
    await expect(page.getByRole('heading', { name: oldest, exact: true })).toBeVisible()
    await expect(page.getByText(/ผู้ป่วยหน้าถัดไป/)).toHaveCount(0)
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
    await expect(page.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: oldest, exact: true })).toBeVisible()
  } finally { await page.unrouteAll({ behavior: 'wait' }); await page.close(); await f.close() }
})

test('paginated operational reads retain driver shift scope and active overrun access', async () => {
  const f = await startOperationalTestApi()
  try {
    let booking = await f.assigned()
    await f.assigned('11:00', { originKind: 'previous_hospital', originLocationId: booking.hospitalLocationId, previousBookingId: booking.id })
    expect((await f.request('/bookings', 'driver')).bookings).toEqual([])
    f.control.now = booking.schedule!.departureAt
    await f.login('driver')
    expect((await f.request('/bookings', 'driver')).bookings).toHaveLength(2)
    booking = await f.command(booking, 'START_TRIP', {}, 'driver')
    f.control.now = '2030-01-16T10:00:00Z'
    await f.login('driver')
    const overrun = await f.request('/bookings', 'driver')
    expect(overrun.bookings.map(row => row.id)).toEqual([booking.id])
    expect(overrun.nextCursor).toBeNull()
    expect((await f.request(`/bookings/${booking.id}`, 'driver')).startedAt).toBeTruthy()
  } finally { await f.close() }
})
