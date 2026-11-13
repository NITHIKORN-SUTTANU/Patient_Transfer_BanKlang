import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { createApi } from '../server/app.mjs'
import { migrate } from '../scripts/database/migrate.mjs'
import { hashPassword } from '../server/auth.mjs'
import { syntheticPassword } from './helpers/admin-postgres.mjs'
import { completeCitizenJourney } from './helpers/citizen-journey'

test.use({ actionTimeout: 10000 })

for (const outcome of ['cancel', 'handover', 'failed pickup', 'aborted'] as const) {
test(`original citizen screens submit and ${outcome} through real API/PostgreSQL with synthetic LINE`, async ({ page, browser }) => {
  test.setTimeout(90000)
  const adminUrl = process.env.DATABASE_TEST_ADMIN_URL
  test.skip(!adminUrl, 'Run npm run test:citizen:integration with a local test database configured')
  const url = new URL(adminUrl!)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Local test database required')
  const database = `pt_test_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: adminUrl })
  let pool: pg.Pool | undefined
  let server: ReturnType<typeof createApi> | undefined
  let created = false
  const control = { now: '2030-01-12T00:00:00Z' }
  try {
    await admin.connect()
    await admin.query(`CREATE DATABASE "${database}"`); created = true
    url.pathname = `/${database}`
    pool = new pg.Pool({ connectionString: url.toString() })
    const client = await pool.connect()
    try {
      await migrate(client)
      await client.query('BEGIN')
      await client.query(await readFile(new URL('../database/seeds/development.sql', import.meta.url), 'utf8'))
      await client.query("UPDATE patient_transfer.users SET password_hash=$1 WHERE role IN ('dispatcher','driver')", [await hashPassword(syntheticPassword)])
      for (const [table, field] of [['vehicles', 'vehicle_id'], ['drivers', 'driver_id']]) await client.query(`INSERT INTO patient_transfer.availability_windows(${field},starts_at,ends_at) SELECT id,'2030-01-14T23:00:00Z','2030-01-15T09:00:00Z' FROM patient_transfer.${table}`)
      await client.query('COMMIT')
    } finally { client.release() }
    server = createApi({ pool, clock: () => control.now, route: async () => ({ minutes: 15, source: 'synthetic-journey-test' }), liffId: 'synthetic-liff', noticeVersion: 'synthetic-browser-v1', noticeText: 'ประกาศทดสอบการรับส่ง', contactPhone: '053000000',
      verifyLine: async (token: string) => {
        if (token !== 'synthetic-browser-line-token') throw new Error('Unexpected synthetic token')
        return { subject: `U${'d'.repeat(32)}`, name: 'ผู้จองที่ยืนยันแล้ว' }
      } })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    await page.clock.install({ time: new Date('2030-01-12T00:00:00Z') })
    await page.route('**/src/services/lineClient.ts', route => route.fulfill({ contentType: 'application/javascript', body: 'export async function lineIdToken() { return "synthetic-browser-line-token" }' }))
    // Forward every UI API request to the real ephemeral API. No API payload is fabricated.
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      await route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${port}${url.pathname}${url.search}` }) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line\.me|line-scdn).*/, route => route.abort())
    await page.goto('/booking')
    await page.getByRole('button', { name: 'เริ่มจองรถ →', exact: true }).click()
    await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
    await page.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
    await page.getByRole('button', { name: 'จองให้ผู้อื่น', exact: true }).click()
    await page.getByLabel('ชื่อผู้ป่วย *', { exact: true }).fill('ผู้ป่วยสังเคราะห์')
    await page.getByLabel('ชื่อผู้ดูแล / ผู้ติดต่อ *', { exact: true }).fill('ผู้ดูแลสังเคราะห์')
    await page.getByLabel('เบอร์โทรศัพท์ผู้ติดต่อ *', { exact: true }).fill('+66 80-000-0000')
    await page.getByLabel('ความสัมพันธ์กับผู้ป่วย *', { exact: true }).selectOption('ผู้ดูแล')
    await page.getByLabel('โรงพยาบาล *', { exact: true }).selectOption('40000000-0000-4000-8000-000000000001')
    await page.locator('.booking-input-trigger').nth(0).click()
    await page.getByRole('button', { name: /15 มกราคม/ }).click()
    await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()
    await page.locator('.booking-input-trigger').nth(1).click()
    await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    await page.getByRole('checkbox', { name: 'มีผู้ดูแลเดินทางไปด้วย', exact: true }).check()
    await page.getByLabel('หมู่บ้านในเขตบริการ *').selectOption('30000000-0000-4000-8000-000000000001')
    await page.getByLabel('ที่อยู่จุดรับ *').fill('บ้านทดสอบ')
    await page.getByText('เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง', { exact: true }).click()
    await page.getByLabel('ละติจูด', { exact: true }).fill('18.59')
    await page.getByLabel('ลองจิจูด', { exact: true }).fill('99.05')
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    await page.getByRole('checkbox', { name: 'บันทึกข้อมูลผู้ป่วยไว้ใช้ครั้งต่อไป', exact: true }).check()
    await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toBeVisible()
    const { rows: [saved] } = await pool.query(`SELECT b.*,u.line_subject,c.notice_version FROM patient_transfer.bookings b
      JOIN patient_transfer.users u ON u.id=b.requester_id JOIN patient_transfer.consent_records c ON c.id=b.consent_id`)
    expect(saved.patient_name).toBe('ผู้ป่วยสังเคราะห์')
    expect(saved.requester_name).toBe('ผู้ดูแลสังเคราะห์')
    expect(saved.contact_phone).toBe('0800000000')
    expect(saved.booking_for).toBe('other')
    expect(saved.assistance).toEqual(['caregiver_accompanies'])
    expect(saved.notice_version).toBe('synthetic-browser-v1')
    expect(saved.line_subject).toBe(`U${'d'.repeat(32)}`)
    expect(saved.patient_profile_id).toBeTruthy()
    await expect(page.getByText(saved.reference, { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText(saved.reference, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'ดูสถานะการจอง', exact: true }).click()
    if (outcome !== 'cancel') {
      await completeCitizenJourney({ browser, citizen: page, pool, base: `http://127.0.0.1:${port}`, control, bookingId: saved.id, outcome })
      return
    }
    await page.getByRole('button', { name: 'ยกเลิกการจอง', exact: true }).click()
    await page.getByRole('button', { name: 'ยืนยันยกเลิกการจอง', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'ยกเลิกการจองแล้ว', exact: true })).toBeVisible()
    expect((await pool.query('SELECT status FROM patient_transfer.bookings WHERE id=$1', [saved.id])).rows[0].status).toBe('CANCELLED')
    expect((await pool.query('SELECT count(*)::int AS count FROM patient_transfer.notifications WHERE booking_id=$1', [saved.id])).rows[0].count).toBeGreaterThan(0)
  } finally {
    await page.unrouteAll({ behavior: 'wait' })
    server?.closeAllConnections()
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
    await pool?.end()
    if (created) {
      await admin.query(`DROP DATABASE "${database}"`)
    }
    await admin.end()
  }
})
}
