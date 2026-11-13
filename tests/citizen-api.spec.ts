import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function setup(page: Page, enabled = true) {
  const config = { lineEnabled: enabled, liffId: enabled ? 'synthetic-liff' : '', noticeVersion: 'test-v1', noticeText: 'ประกาศทดสอบสำหรับบริการรับส่ง ไม่ใช่ข้อมูลจริง', contactPhone: '053000000' }
  const profiles = [{ id: 'profile', patientName: 'ผู้ป่วยที่บันทึกไว้', contactPhone: '0800000000', mobility: 'wheelchair', villageId: 'village', pickupAddress: 'บ้านทดสอบ', latitude: 18.59, longitude: 99.05, assistance: ['boarding_support'], landmark: 'ประตูหน้า' }]
  const rows: Record<string, unknown>[] = []
  const decisions: boolean[] = []
  const writes: Record<string, unknown>[] = []
  const controls = { failSubmit: false, fieldError: '', revoked: false, forbidden: false, failConsent: false, failRead: false }
  await page.clock.install({ time: new Date('2030-01-12T00:00:00Z') })
  // Replace only the external SDK adapter in the test browser. No runtime login bypass exists.
  await page.route('**/src/services/lineClient.ts', route => route.fulfill({ contentType: 'application/javascript', body: 'export async function lineIdToken() { return "synthetic-original-id-token" }' }))
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line\.me|line-scdn).*/, route => route.abort())
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api', '')
    const post = route.request().method() === 'POST'
    const body = post ? route.request().postDataJSON() : null
    if (path === '/config') return route.fulfill({ json: config })
    if (path === '/auth/line') {
      expect(body).toEqual({ idToken: 'synthetic-original-id-token' })
      return route.fulfill({ json: { token: 'synthetic-citizen-token' } })
    }
    expect(route.request().headers().authorization).toBe('Bearer synthetic-citizen-token')
    if (controls.revoked) return route.fulfill({ status: 401, json: { error: 'Revoked' } })
    if (path === '/auth/me') return route.fulfill({ json: { id: 'owner', role: 'citizen', name: 'ผู้จองทดสอบ' } })
    if (path === '/catalog') return route.fulfill({ json: { hospitals: [{ id: 'hospital', name: 'โรงพยาบาลทดสอบ' }], villages: [{ id: 'village', number: 1, name: 'หมู่บ้านทดสอบ' }] } })
    if (path === '/profiles') return route.fulfill({ json: post ? { ...body, id: 'new-profile' } : { profiles } })
    if (path === '/consents') {
      if (controls.failConsent) return route.fulfill({ status: 503, json: { error: 'Unavailable' } })
      decisions.push(body.accepted)
      expect(body.noticeVersion).toBe(config.noticeVersion)
      return route.fulfill({ status: 201, json: { id: 'consent', accepted: body.accepted } })
    }
    if (path === '/bookings' && post) {
      writes.push(body)
      if (controls.fieldError) return route.fulfill({ status: 422, json: { error: 'Invalid field', details: { field: controls.fieldError } } })
      if (controls.failSubmit) return route.fulfill({ status: 503, json: { error: 'Unavailable' } })
      const row = { ...body, id: 'booking', reference: 'BK-authoritative-reference', status: 'REQUESTED', revision: 1, executionVersion: 0, startedAt: null, cancellationLocked: false, schedule: null, submittedAt: '2030-01-12T00:00:00Z' }
      rows.push(row)
      return route.fulfill({ status: 201, json: row })
    }
    if (path === '/bookings') return route.fulfill({ status: controls.failRead ? 503 : 200, json: controls.failRead ? { error: 'Unavailable' } : { bookings: rows } })
    if (path.endsWith('/commands')) {
      writes.push(body)
      expect(body.expectedRevision).toBe(rows[0].revision)
      expect(body.command.type).toBe('CANCEL')
      if (controls.forbidden) return route.fulfill({ status: 409, json: { error: 'Started' } })
      Object.assign(rows[0], { status: 'CANCELLED', revision: 2 })
      return route.fulfill({ json: rows[0] })
    }
    if (path.startsWith('/bookings/')) return route.fulfill({ status: controls.forbidden || !rows.length ? 403 : 200, json: rows[0] ?? { error: 'Denied' } })
    return route.fulfill({ status: 404, json: { error: 'Missing' } })
  })
  return { config, profiles, rows, decisions, writes, controls }
}
async function consent(page: Page) {
  await page.goto('/booking')
  await page.getByRole('button', { name: 'เริ่มจองรถ →', exact: true }).click()
  await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
  await page.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ข้อมูลผู้ป่วย', exact: true, level: 1 })).toBeVisible()
}
async function patient(page: Page, profile = true) {
  if (profile) await page.getByLabel('ข้อมูลผู้ป่วยที่บันทึกไว้').selectOption('profile')
  else {
    await page.getByLabel('ชื่อผู้ป่วย *', { exact: true }).fill('ผู้ป่วยใหม่')
    await page.getByLabel('เบอร์โทรศัพท์ของคุณ *', { exact: true }).fill('+66 80-000-0000')
  }
  await page.getByLabel('โรงพยาบาล *', { exact: true }).selectOption('hospital')
  await page.locator('.booking-input-trigger').nth(0).click()
  await page.getByRole('button', { name: /15 มกราคม/ }).click()
  await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()
  await page.locator('.booking-input-trigger').nth(1).click()
  await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'การช่วยเหลือและจุดรับ', exact: true })).toBeVisible()
}

test('verified citizen reuses only API profiles, reviews, submits and cancels authoritative booking', async ({ page }) => {
  const fixture = await setup(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await consent(page)
  expect(fixture.decisions).toEqual([true])
  await patient(page)
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ตรวจสอบข้อมูล', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toBeVisible()
  await expect(page.getByText('BK-authoritative-reference', { exact: true })).toBeVisible()
  expect(fixture.writes[0]).toMatchObject({ consentId: 'consent', bookingFor: 'self', patientProfileId: 'profile', mobility: 'wheelchair', assistance: ['boarding_support'], landmark: 'ประตูหน้า', villageId: 'village', hospitalId: 'hospital' })
  expect(fixture.writes[0]).not.toHaveProperty('requesterId')
  await page.getByRole('button', { name: 'ดูสถานะการจอง', exact: true }).click()
  await page.getByRole('button', { name: 'ยกเลิกการจอง', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันยกเลิกการจอง', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ยกเลิกการจองแล้ว', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'ฉุกเฉิน โทร 1669', exact: true })).toHaveAttribute('href', 'tel:1669')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
})

test('direct route/browser storage cannot bypass consent; refusal persists and offers municipal phone', async ({ page }) => {
  const fixture = await setup(page)
  await page.addInitScript(() => localStorage.setItem('booking-consent', 'true'))
  await page.goto('/booking/review')
  await expect(page.getByRole('heading', { name: 'ข้อมูลส่วนบุคคล', exact: true })).toBeVisible()
  await expect(page.getByText(fixture.config.noticeText)).toBeVisible()
  await page.getByRole('button', { name: 'ไม่ยินยอมใช้ข้อมูล', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(fixture.decisions).toEqual([false])
  await expect(page.getByRole('dialog').getByRole('link', { name: /ติดต่อเทศบาล/ })).toHaveAttribute('href', 'tel:053000000')
  expect(fixture.writes).toEqual([])
})

test('missing LINE configuration fails closed', async ({ page }) => {
  await setup(page, false)
  await page.goto('/booking/patient')
  await expect(page.getByText('บริการจองผ่าน LINE ยังไม่พร้อม กรุณาติดต่อเทศบาล')).toBeVisible()
  await expect(page.getByLabel('ชื่อผู้ป่วย *', { exact: true })).toHaveCount(0)
})

test('consent service failure keeps intake locked and permits retry', async ({ page }) => {
  const fixture = await setup(page)
  await page.goto('/booking/privacy')
  fixture.controls.failConsent = true
  await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
  await page.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/booking\/privacy$/)
  expect(fixture.decisions).toEqual([])
  fixture.controls.failConsent = false
  await page.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ข้อมูลผู้ป่วย', exact: true, level: 1 })).toBeVisible()
})

test('stale cancellation retains the confirmation; ABORTED never reports completed transport', async ({ page }) => {
  const fixture = await setup(page)
  fixture.rows.push({ id: 'booking', reference: 'BK-stale', patientName: 'ผู้ป่วยทดสอบ', hospitalId: 'hospital', appointmentAt: '2030-01-15T03:30:00Z', status: 'ASSIGNED', revision: 2, executionVersion: 2, startedAt: null, cancellationLocked: false, mobility: 'standard', assistance: [], contactPhone: '0800000000', pickupAddress: 'บ้านทดสอบ', schedule: null })
  await page.goto('/booking/cancel/booking')
  await expect(page.getByRole('button', { name: 'ยืนยันยกเลิกการจอง', exact: true })).toBeVisible()
  fixture.controls.forbidden = true
  await page.getByRole('button', { name: 'ยืนยันยกเลิกการจอง', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('สถานะเปลี่ยนแล้ว')
  await expect(page).toHaveURL(/booking\/cancel\/booking$/)
  fixture.controls.forbidden = false
  fixture.rows[0].status = 'ABORTED'
  await page.getByRole('button', { name: 'กลับไปดูรายละเอียด', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ยุติการเดินทาง', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'ผลการเดินทาง', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'ยกเลิกการจองแล้ว', exact: true })).toHaveCount(0)
})

test('submission failure preserves draft; a newer notice requires a fresh recorded decision', async ({ page }) => {
  const fixture = await setup(page)
  await consent(page); await patient(page)
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  fixture.controls.failSubmit = true
  await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('ข้อมูลที่กรอกยังอยู่')
  await expect(page.getByText('ผู้ป่วยที่บันทึกไว้', { exact: true })).toBeVisible()
  fixture.controls.failSubmit = false
  fixture.config.noticeVersion = 'test-v2'; fixture.config.noticeText = 'ประกาศฉบับใหม่'
  await page.getByRole('button', { name: 'ลองส่งคำขออีกครั้ง', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ข้อมูลส่วนบุคคล', exact: true })).toBeVisible()
  await expect(page.getByText('ประกาศฉบับใหม่')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ })).not.toBeChecked()
  expect(fixture.writes.length).toBe(1)
  await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
  await page.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
  await expect(page.getByLabel('ชื่อผู้ป่วย *', { exact: true })).toHaveValue('ผู้ป่วยที่บันทึกไว้')
  fixture.controls.fieldError = 'consentId'
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ข้อมูลส่วนบุคคล', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ })).not.toBeChecked()
})

test('server field errors return to the matching input without erasing the draft', async ({ page }) => {
  const fixture = await setup(page)
  await consent(page); await patient(page)
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  fixture.controls.fieldError = 'contactPhone'
  await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ข้อมูลผู้ป่วย', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByLabel('เบอร์โทรศัพท์ของคุณ *', { exact: true })).toHaveValue('0800000000')
  await expect(page.getByLabel('เบอร์โทรศัพท์ของคุณ *', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('ชื่อผู้ป่วย *', { exact: true })).toHaveValue('ผู้ป่วยที่บันทึกไว้')
})

test('manual coordinate choice survives a late GPS callback; address-only cannot submit', async ({ page }) => {
  await setup(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (callback: (position: unknown) => void) => { (window as unknown as { lateGPS: () => void }).lateGPS = () => callback({ coords: { latitude: 1, longitude: 2, accuracy: 5 } }) } } })
  })
  await consent(page); await patient(page, false)
  await page.getByLabel('หมู่บ้านในเขตบริการ *').selectOption('village')
  await page.getByLabel('ที่อยู่จุดรับ *').fill('บ้านทดสอบ')
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('กรุณาเลือกพิกัด')
  await page.getByRole('button', { name: 'ใช้ตำแหน่งปัจจุบัน', exact: true }).click()
  await page.getByText('เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง', { exact: true }).click()
  await page.getByLabel('ละติจูด', { exact: true }).fill('18.59')
  await page.getByLabel('ลองจิจูด', { exact: true }).fill('99.05')
  await page.evaluate(() => (window as unknown as { lateGPS: () => void }).lateGPS())
  await expect(page.getByLabel('ละติจูด', { exact: true })).toHaveValue('18.59')
  await expect(page.getByLabel('ลองจิจูด', { exact: true })).toHaveValue('99.05')
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ตรวจสอบข้อมูล', exact: true })).toBeVisible()
})

test('started/reassigned cutoff and revoked or foreign detail never fall back to demo data', async ({ page }) => {
  const fixture = await setup(page)
  fixture.rows.push({ id: 'booking', reference: 'BK-locked', patientName: 'ผู้ป่วยทดสอบ', hospitalId: 'hospital', appointmentAt: '2030-01-15T03:30:00Z', status: 'ASSIGNED', revision: 2, executionVersion: 2, startedAt: null, cancellationLocked: true, mobility: 'standard', assistance: [], contactPhone: '0800000000', pickupAddress: 'บ้านทดสอบ', schedule: null })
  await page.goto('/booking/status/booking')
  await expect(page.getByText('BK-locked', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ยกเลิกการจอง', exact: true })).toHaveCount(0)
  fixture.controls.revoked = true
  await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
  await expect(page.getByText('เซสชันหมดอายุ กรุณายืนยันตัวตนผ่าน LINE อีกครั้ง')).toBeVisible()
  await expect(page.getByText('BK-locked', { exact: true })).toHaveCount(0)
  fixture.controls.revoked = false; fixture.controls.forbidden = true
  await page.getByRole('button', { name: 'ลองเชื่อมต่อ LINE อีกครั้ง', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('ไม่มีสิทธิ์เข้าถึง')
})
