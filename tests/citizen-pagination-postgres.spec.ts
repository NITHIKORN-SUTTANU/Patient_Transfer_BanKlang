import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { startOperationalTestApi, ids } from './helpers/operational-postgres'

test.use({ actionTimeout: 10000 })
test.beforeEach(() => test.skip(!process.env.DATABASE_TEST_ADMIN_URL, 'Local test PostgreSQL required'))

async function fixture(assigned = false) {
  const subjects = { owner: `U${'1'.repeat(32)}`, other: `U${'2'.repeat(32)}` }
  const f = await startOperationalTestApi({ liffId: 'synthetic-citizen-pagination', verifyLine: async token => {
    if (token !== 'owner' && token !== 'other') throw new Error('Unexpected synthetic LINE token')
    return { subject: subjects[token], name: `Synthetic ${token}` }
  } })
  try {
    await f.pool.query('UPDATE patient_transfer.users SET line_subject=$1 WHERE id=$2', [subjects.owner, ids.citizen])
    const target = assigned ? await f.assigned('10:00') : await f.requested('10:00')
    // All guards remain enabled. Only the temporary database receives bulk rows.
    await f.pool.query(`INSERT INTO patient_transfer.bookings SELECT (jsonb_populate_record(NULL::patient_transfer.bookings,
      to_jsonb(b)||jsonb_build_object('id',gen_random_uuid(),'reference','CITIZEN-PAGE-'||n,'status','REQUESTED',
        'started_at',NULL,'execution_version',0,'cancellation_locked',false,'revision',1,
        'appointment_at','2030-01-15T02:00:00.123456Z'))).*
      FROM patient_transfer.bookings b CROSS JOIN generate_series(1,102) n WHERE b.id=$1`, [target.id])
    const otherId = randomUUID(), consentId = randomUUID(), foreignId = randomUUID()
    await f.pool.query("INSERT INTO patient_transfer.users(id,role,display_name,line_subject) VALUES($1,'citizen','Other requester',$2)", [otherId, subjects.other])
    await f.pool.query("INSERT INTO patient_transfer.consent_records(id,user_id,notice_version,accepted,recorded_at) VALUES($1,$2,'development-v1',true,$3)", [consentId, otherId, f.control.now])
    await f.pool.query(`INSERT INTO patient_transfer.bookings SELECT (jsonb_populate_record(NULL::patient_transfer.bookings,
      to_jsonb(b)||jsonb_build_object('id',$2::text,'reference','OTHER-OWNER-ONLY','requester_id',$3::text,
        'consent_id',$4::text,'patient_profile_id',NULL,'status','REQUESTED','started_at',NULL,'revision',1,
        'execution_version',0,'cancellation_locked',false))).* FROM patient_transfer.bookings b WHERE b.id=$1`, [target.id, foreignId, otherId, consentId])
    return { ...f, target, foreignId }
  } catch (error) { await f.close(); throw error }
}

async function openCitizen(page: Page, f: Awaited<ReturnType<typeof fixture>>, identity = 'owner', path = '/booking/bookings') {
  const control = { failCursor: false, cursorRequests: 0 }
  await page.clock.setFixedTime(new Date(f.control.now))
  await page.route('**/src/services/lineClient.ts', route => route.fulfill({ contentType: 'application/javascript', body: `export async function lineIdToken() { return ${JSON.stringify(identity)} }` }))
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/bookings' && url.searchParams.has('cursor')) {
      control.cursorRequests++
      // A real transport interruption, never a fabricated operational response.
      if (control.failCursor) return route.abort('failed')
    }
    await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
  })
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line\.me|line-scdn).*/, route => route.abort())
  await page.goto(path)
  await expect(page.getByRole('heading', { name: path.includes('/status/') ? 'สถานะการจอง' : 'รายการจองของฉัน', exact: true })).toBeVisible()
  return control
}

test('citizen loads all own pages, recovers from a cursor transport failure and retains the range on refresh', async ({ page }) => {
  test.setTimeout(90000)
  const f = await fixture()
  try {
    const control = await openCitizen(page, f)
    await expect(page.locator('a[href^="/booking/status/"]')).toHaveCount(100)
    await expect(page.getByText('100 รายการที่โหลดแล้ว', { exact: true })).toBeVisible()
    await expect(page.getByText(f.target.reference, { exact: true })).toHaveCount(0)
    control.failCursor = true
    await page.getByRole('button', { name: 'โหลดรายการเพิ่มเติม', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.locator('a[href^="/booking/status/"]')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'ยังไม่มีรายการจอง', exact: true })).toHaveCount(0)
    control.failCursor = false
    await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
    await expect(page.locator('a[href^="/booking/status/"]')).toHaveCount(103)
    await expect(page.getByText(f.target.reference, { exact: true })).toBeVisible()
    const idsInList = await page.locator('a[href^="/booking/status/"]').evaluateAll(links => links.map(link => link.getAttribute('href')))
    expect(new Set(idsInList).size).toBe(103)
    expect(control.cursorRequests).toBeGreaterThanOrEqual(2)
    await expect(page.getByText('OTHER-OWNER-ONLY', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
    await expect(page.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
    await expect(page.locator('a[href^="/booking/status/"]')).toHaveCount(103)
    await page.locator(`a[href="/booking/status/${f.target.id}"]`).click()
    await expect(page.getByRole('heading', { name: 'สถานะการจอง', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'ยกเลิกการจอง', exact: true }).click()
    await page.getByRole('button', { name: 'ยืนยันยกเลิกการจอง', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'ยกเลิกการจองแล้ว', exact: true })).toBeVisible()
    expect((await f.get(f.target.id)).status).toBe('CANCELLED')
    await page.getByRole('button', { name: 'รายการจองของฉัน', exact: true }).click()
    await expect(page.locator('a[href^="/booking/status/"]')).toHaveCount(103)
    await expect(page.locator(`a[href="/booking/status/${f.target.id}"]`)).toContainText('ยกเลิกแล้ว')
  } finally { await page.unrouteAll({ behavior: 'wait' }); await page.close(); await f.close() }
})

test('separate verified citizens cannot list or open another owner’s booking beyond page one', async ({ browser }) => {
  test.setTimeout(90000)
  const f = await fixture()
  const contexts = [await browser.newContext(), await browser.newContext()]
  try {
    const owner = await contexts[0].newPage(), other = await contexts[1].newPage()
    await openCitizen(owner, f)
    await owner.getByRole('button', { name: 'โหลดรายการเพิ่มเติม', exact: true }).click()
    await expect(owner.locator('a[href^="/booking/status/"]')).toHaveCount(103)
    await openCitizen(other, f, 'other')
    await expect(other.locator('a[href^="/booking/status/"]')).toHaveCount(1)
    await expect(other.getByText('OTHER-OWNER-ONLY', { exact: true })).toBeVisible()
    await expect(other.getByText(f.target.reference, { exact: true })).toHaveCount(0)
    await expect(other.getByRole('button', { name: 'โหลดรายการเพิ่มเติม', exact: true })).toHaveCount(0)
    for (const [page, id] of [[owner, f.foreignId], [other, f.target.id]] as const) {
      const denied = page.waitForResponse(r => new URL(r.url()).pathname === `/api/bookings/${id}`)
      await page.goto(`/booking/status/${id}`)
      expect((await denied).status()).toBe(403)
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(page.getByRole('button', { name: 'ยกเลิกการจอง', exact: true })).toHaveCount(0)
      await expect(page.locator('a[href^="/booking/status/"]')).toHaveCount(0)
    }
  } finally {
    for (const context of contexts) { for (const page of context.pages()) await page.unrouteAll({ behavior: 'wait' }); await context.close() }
    await f.close()
  }
})

test('a page-two cancellation confirmation refreshes the Start Trip lock and rejects an already-open stale confirmation', async ({ page }) => {
  test.setTimeout(90000)
  const f = await fixture(true)
  try {
    f.control.now = f.target.schedule!.departureAt
    for (const role of ['driver', 'dispatcher']) await f.login(role)
    await openCitizen(page, f)
    await page.getByRole('button', { name: 'โหลดรายการเพิ่มเติม', exact: true }).click()
    await page.locator(`a[href="/booking/status/${f.target.id}"]`).click()
    await page.getByRole('button', { name: 'ยกเลิกการจอง', exact: true }).click()
    await expect(page.getByRole('button', { name: 'ยืนยันยกเลิกการจอง', exact: true })).toBeEnabled()
    const started = await f.command(f.target, 'START_TRIP', {}, 'driver')
    const rejected = page.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันยกเลิกการจอง', exact: true }).click()
    expect((await rejected).status()).toBe(409)
    await expect(page.getByRole('alert')).toContainText('สถานะเปลี่ยนแล้ว')
    expect((await f.get(started.id)).status).toBe('ASSIGNED')
    await page.reload()
    await expect(page.getByText('ไม่สามารถยกเลิกได้ กรุณาติดต่อเทศบาล', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ยืนยันยกเลิกการจอง', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'กลับไปดูรายละเอียด', exact: true }).click()
    await expect(page.getByRole('button', { name: 'ยกเลิกการจอง', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'รายการจองของฉัน', exact: true }).click()
    // Document reload intentionally resets the in-memory range. A focused detail
    // fetched outside page one must not silently count as part of the list.
    await expect(page.locator('a[href^="/booking/status/"]')).toHaveCount(100)
    await page.getByRole('button', { name: 'โหลดรายการเพิ่มเติม', exact: true }).click()
    await page.locator(`a[href="/booking/status/${f.target.id}"]`).click()
    await expect(page.getByText('คนขับเริ่มงานแล้ว', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ยกเลิกการจอง', exact: true })).toHaveCount(0)
    expect((await f.pool.query("SELECT count(*)::int AS n FROM patient_transfer.trip_events WHERE booking_id=$1 AND command='CANCEL'", [started.id])).rows[0].n).toBe(0)
  } finally { await page.unrouteAll({ behavior: 'wait' }); await page.close(); await f.close() }
})
