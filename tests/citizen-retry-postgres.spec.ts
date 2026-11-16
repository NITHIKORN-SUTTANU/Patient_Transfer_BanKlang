import { test, expect } from '@playwright/test'
import { startOperationalTestApi, ids } from './helpers/operational-postgres'
import { recoveryFingerprint } from '../scripts/database/recovery.mjs'

test('original citizen retries a lost committed response with the same identity and no duplicate publication', async ({ page }) => {
  test.skip(!process.env.DATABASE_TEST_ADMIN_URL, 'Local test database required')
  test.setTimeout(60000)
  const f = await startOperationalTestApi({ liffId: 'synthetic-retry', verifyLine: async () => ({ subject: `U${'d'.repeat(32)}`, name: 'ผู้ทดสอบคำขอซ้ำ' }) })
  const bodies: Record<string, unknown>[] = []
  let authorization = '', committedId = ''
  try {
    await page.clock.install({ time: new Date(f.control.now) })
    await page.route('**/src/services/lineClient.ts', route => route.fulfill({ contentType: 'application/javascript', body: 'export async function lineIdToken() { return "synthetic-retry" }' }))
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url())
      const response = await route.fetch({ url: `${f.base}${url.pathname}${url.search}` })
      if (url.pathname === '/api/bookings' && request.method() === 'POST') {
        authorization = request.headers().authorization
        bodies.push(request.postDataJSON())
        expect(response.status()).toBe(201)
        committedId = (await response.json()).id
        if (bodies.length === 1) { await route.abort('failed'); return }
      }
      await route.fulfill({ response })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line\.me|line-scdn).*/, route => route.abort())
    await page.goto('/booking')
    await page.getByRole('button', { name: 'เริ่มจองรถ →', exact: true }).click()
    await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
    await page.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
    await page.getByLabel('ชื่อผู้ป่วย *', { exact: true }).fill('ผู้ป่วยทดสอบคำขอซ้ำ')
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
    await page.getByLabel('ที่อยู่จุดรับ *').fill('บ้านทดสอบคำขอซ้ำ')
    await page.getByText('เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง', { exact: true }).click()
    await page.getByLabel('ละติจูด', { exact: true }).fill('18.59')
    await page.getByLabel('ลองจิจูด', { exact: true }).fill('99.05')
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    const failed = page.waitForEvent('requestfailed', { predicate: r => r.url().endsWith('/api/bookings') && r.method() === 'POST' })
    await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ', exact: true }).click()
    await failed
    await expect(page.getByRole('button', { name: 'ลองส่งคำขออีกครั้ง', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'แก้ไข ข้อมูลผู้ป่วย', exact: true })).toBeDisabled()
    await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toHaveCount(0)
    expect(committedId).toBeTruthy()
    expect(bodies[0].requestId).toMatch(/^[0-9a-f-]{36}$/)
    // A later refusal must block fresh intake, but not turn reconciliation into a new request.
    const refusal = await fetch(`${f.base}/api/consents`, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ accepted: false, noticeVersion: 'development-v1' }) })
    expect(refusal.status).toBe(201)
    const before = await recoveryFingerprint(f.pool)
    await page.getByRole('button', { name: 'ลองส่งคำขออีกครั้ง', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toBeVisible()
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual(bodies[0])
    expect(await recoveryFingerprint(f.pool)).toEqual(before)
    expect((await f.pool.query('SELECT id FROM patient_transfer.bookings')).rows).toEqual([{ id: committedId }])
    expect((await f.pool.query('SELECT id FROM patient_transfer.notifications WHERE booking_id=$1', [committedId])).rowCount).toBe(1)
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); await f.close() }
})
