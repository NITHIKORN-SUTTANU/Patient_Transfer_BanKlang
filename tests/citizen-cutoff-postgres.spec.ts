import { test, expect } from '@playwright/test'
import { startOperationalTestApi, ids } from './helpers/operational-postgres'
import { recoveryFingerprint } from '../scripts/database/recovery.mjs'
import { syntheticPassword } from './helpers/admin-postgres.mjs'

test.use({ actionTimeout: 10000 })
test.beforeEach(() => test.skip(!process.env.DATABASE_TEST_ADMIN_URL, 'Local test database required'))
const subject = `U${'e'.repeat(32)}`
const providers = { liffId: 'synthetic-cutoff', verifyLine: async (token: string) => {
  expect(token).toBe('synthetic-cutoff-token')
  return { subject, name: 'ผู้จองทดสอบเวลาล่วงหน้า' }
} }

test('original dispatcher schedules and assigns after the cutoff using the original submission time', async ({ page }) => {
  test.setTimeout(60000)
  const f = await startOperationalTestApi()
  try {
    f.control.now = '2030-01-13T02:00:00.000Z'
    const requested = await f.requested()
    const original = (await f.pool.query('SELECT * FROM patient_transfer.bookings WHERE id=$1', [requested.id])).rows[0]
    expect(original.appointment_at.getTime() - original.submitted_at.getTime()).toBe(48 * 3600000)
    f.control.now = '2030-01-14T02:00:00.000Z'
    // Refresh expired staff sessions after advancing the authoritative clock.
    await f.login('dispatcher')
    expect(original.appointment_at.getTime() - Date.parse(f.control.now)).toBe(24 * 3600000)
    const before = await recoveryFingerprint(f.pool)
    await f.request('/bookings', 'citizen', {
      consentId: original.consent_id, bookingFor: 'self', patientName: original.patient_name,
      requesterName: original.requester_name, contactPhone: original.contact_phone,
      pickupAddress: original.pickup_address, latitude: 18.59, longitude: 99.05,
      villageId: ids.village, hospitalId: ids.hospital, mobility: 'standard', appointmentAt: original.appointment_at.toISOString(),
    }, 422)
    expect(await recoveryFingerprint(f.pool)).toEqual(before)
    const approved = await f.command(requested, 'APPROVE')
    const history = (await f.pool.query('SELECT * FROM patient_transfer.trip_events WHERE booking_id=$1 ORDER BY id', [requested.id])).rows
    expect(history.length).toBeGreaterThan(0)
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
    for (const stage of ['schedule', 'assignment'] as const) {
      await page.getByRole('button', { name: stage === 'schedule' ? 'ตรวจสอบและยืนยันตาราง' : 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
      const response = page.waitForResponse(r => r.url().endsWith(`/${stage}`) && r.request().method() === 'POST')
      await page.getByRole('button', { name: stage === 'schedule' ? 'ยืนยันตาราง' : 'ยืนยันการมอบหมาย', exact: true }).click()
      expect((await response).status()).toBe(200)
      const current = await f.get(requested.id)
      expect(current.status).toBe(stage === 'schedule' ? 'SCHEDULED' : 'ASSIGNED')
      expect((await f.pool.query('SELECT 1 FROM patient_transfer.schedules WHERE booking_id=$1 AND committed AND released_at IS NULL', [requested.id])).rowCount).toBe(stage === 'schedule' ? 0 : 1)
    }
    const final = (await f.pool.query('SELECT * FROM patient_transfer.bookings WHERE id=$1', [requested.id])).rows[0]
    for (const key of ['submitted_at', 'appointment_at', 'requester_id', 'consent_id', 'patient_name', 'pickup_address', 'reference']) expect(final[key]).toEqual(original[key])
    expect((await f.pool.query('SELECT * FROM patient_transfer.trip_events WHERE id=ANY($1::uuid[]) ORDER BY id', [history.map(r => r.id)])).rows).toEqual(history)
    const consent = (await f.pool.query('SELECT user_id,accepted FROM patient_transfer.consent_records WHERE id=$1', [final.consent_id])).rows[0]
    expect(consent).toEqual({ user_id: final.requester_id, accepted: true })
    expect((await f.pool.query('SELECT count(*)::int AS n FROM patient_transfer.bookings')).rows[0].n).toBe(1)
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every(r => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); await f.close()
  }
})

test('real citizen intake accepts exactly 48 hours in equivalent timezones, rejects one millisecond short and has no advance cap', async () => {
  const f = await startOperationalTestApi(providers)
  try {
    f.control.now = '2030-01-13T02:00:00.000Z'
    const login = await f.request('/auth/line', 'citizen', { idToken: 'synthetic-cutoff-token' })
    async function request(path: string, body?: unknown, status = 200) {
      const response = await fetch(`${f.base}/api${path}`, { method: body ? 'POST' : 'GET', headers: {
        Authorization: `Bearer ${login.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) })
      const result = await response.json()
      expect(response.status, JSON.stringify(result)).toBe(status)
      return result
    }
    const user = await request('/auth/me')
    const consent = await request('/consents', { accepted: true, noticeVersion: 'development-v1' }, 201)
    const payload = { consentId: consent.id, bookingFor: 'self', patientName: 'ผู้ป่วยทดสอบเวลา', requesterName: 'ผู้จองทดสอบเวลา', contactPhone: '0800000000',
      pickupAddress: 'บ้านทดสอบ', latitude: 18.59, longitude: 99.05, villageId: ids.village, hospitalId: ids.hospital, mobility: 'standard' }
    for (const appointmentAt of ['2030-01-15T08:59:59.999+07:00', '2030-01-15T09:00:00']) {
      const before = await recoveryFingerprint(f.pool)
      const result = await request('/bookings', { ...payload, appointmentAt }, 422)
      expect(result.error).toContain('48-hour notice and explicit timezone')
      expect(await recoveryFingerprint(f.pool)).toEqual(before)
    }
    for (const appointmentAt of ['2030-01-15T09:00:00+07:00', '2030-01-15T02:00:00Z', '2035-01-15T09:00:00+07:00']) {
      const booking = await request('/bookings', { ...payload, appointmentAt }, 201)
      const row = (await f.pool.query('SELECT * FROM patient_transfer.bookings WHERE id=$1', [booking.id])).rows[0]
      expect(row.requester_id).toBe(user.id)
      expect(row.consent_id).toBe(consent.id)
      expect(row.status).toBe('REQUESTED')
      expect(row.submitted_at.toISOString()).toBe(f.control.now)
      expect(row.appointment_at.getTime()).toBe(Date.parse(appointmentAt))
      const lead = row.appointment_at.getTime() - row.submitted_at.getTime()
      if (appointmentAt.startsWith('2030')) expect(lead).toBe(48 * 3600000)
      else expect(lead).toBeGreaterThan(365 * 24 * 3600000)
      expect((await request(`/bookings/${booking.id}`)).id).toBe(booking.id)
      await f.request(`/bookings/${booking.id}`, 'citizen', undefined, 403)
    }
    expect((await f.pool.query('SELECT count(DISTINCT reference)::int AS n FROM patient_transfer.bookings')).rows[0].n).toBe(3)
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.every(r => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally { await f.close() }
})

test('original citizen draft survives a server cutoff rejection and submits an edited appointment at exactly 48 hours', async ({ page }) => {
  test.setTimeout(60000)
  const f = await startOperationalTestApi(providers)
  try {
    f.control.now = '2030-01-13T02:00:00.001Z'
    // A lagging client clock cannot override the authoritative server cutoff.
    await page.clock.install({ time: new Date('2030-01-12T00:00:00Z') })
    await page.route('**/src/services/lineClient.ts', route => route.fulfill({ contentType: 'application/javascript', body: 'export async function lineIdToken() { return "synthetic-cutoff-token" }' }))
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line\.me|line-scdn).*/, route => route.abort())
    await page.goto('/booking')
    await page.getByRole('button', { name: 'เริ่มจองรถ →', exact: true }).click()
    await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
    await page.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
    await page.getByLabel('ชื่อผู้ป่วย *', { exact: true }).fill('ผู้ป่วยทดสอบขอบเขตเวลา')
    await page.getByLabel('เบอร์โทรศัพท์ของคุณ *', { exact: true }).fill('0800000000')
    await page.getByLabel('โรงพยาบาล *', { exact: true }).selectOption(ids.hospital)
    await page.locator('.booking-input-trigger').nth(0).click()
    await page.getByRole('button', { name: /15 มกราคม/ }).click()
    await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()
    await page.locator('.booking-input-trigger').nth(1).click()
    await page.getByRole('listbox', { name: 'ชั่วโมง', exact: true }).press('9')
    await page.getByRole('listbox', { name: 'นาที', exact: true }).press('Home')
    await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    await page.getByLabel('หมู่บ้านในเขตบริการ *').selectOption(ids.village)
    await page.getByLabel('ที่อยู่จุดรับ *').fill('บ้านทดสอบขอบเขตเวลา')
    await page.getByText('เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง', { exact: true }).click()
    await page.getByLabel('ละติจูด', { exact: true }).fill('18.59')
    await page.getByLabel('ลองจิจูด', { exact: true }).fill('99.05')
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    const before = await recoveryFingerprint(f.pool)
    const rejected = page.waitForResponse(r => r.url().endsWith('/api/bookings') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ', exact: true }).click()
    const failure = await rejected
    expect(failure.status()).toBe(422)
    expect(Date.parse(failure.request().postDataJSON().appointmentAt) - Date.parse(f.control.now)).toBe(48 * 3600000 - 1)
    await expect(page.getByRole('alert')).toContainText('ข้อมูลไม่ผ่านเงื่อนไข')
    expect(await recoveryFingerprint(f.pool)).toEqual(before)
    await page.getByRole('button', { name: 'แก้ไข วันนัดหมาย', exact: true }).click()
    await expect(page.getByLabel('ชื่อผู้ป่วย *', { exact: true })).toHaveValue('ผู้ป่วยทดสอบขอบเขตเวลา')
    await expect(page.getByLabel('เบอร์โทรศัพท์ของคุณ *', { exact: true })).toHaveValue('0800000000')
    await page.locator('.booking-input-trigger').nth(1).click()
    await page.getByRole('listbox', { name: 'นาที', exact: true }).press('ArrowDown')
    await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    await expect(page.getByLabel('ที่อยู่จุดรับ *')).toHaveValue('บ้านทดสอบขอบเขตเวลา')
    await expect(page.getByLabel('ละติจูด', { exact: true })).toHaveValue('18.59')
    await expect(page.getByLabel('ลองจิจูด', { exact: true })).toHaveValue('99.05')
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    f.control.now = '2030-01-13T02:01:00.000Z'
    const accepted = page.waitForResponse(r => r.url().endsWith('/api/bookings') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ลองส่งคำขออีกครั้ง', exact: true }).click()
    const success = await accepted
    expect(success.status()).toBe(201)
    await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toBeVisible()
    const rows = (await f.pool.query(`SELECT b.*,u.line_subject,c.user_id AS consent_owner,c.accepted FROM patient_transfer.bookings b
      JOIN patient_transfer.users u ON u.id=b.requester_id JOIN patient_transfer.consent_records c ON c.id=b.consent_id`)).rows
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.appointment_at.getTime() - row.submitted_at.getTime()).toBe(48 * 3600000)
    expect(row.appointment_at.toISOString()).toBe('2030-01-15T02:01:00.000Z')
    expect(row.patient_name).toBe('ผู้ป่วยทดสอบขอบเขตเวลา')
    expect(row.pickup_address).toBe('บ้านทดสอบขอบเขตเวลา')
    expect(row.line_subject).toBe(subject)
    expect(row.requester_id).toBe(row.consent_owner); expect(row.accepted).toBe(true)
    await expect(page.getByText(row.reference, { exact: true })).toBeVisible()
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); await f.close()
  }
})
