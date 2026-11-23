import { chooseCitizenPickup } from './helpers/citizen-gps'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function setup(page: Page, enabled = true) {
  const config = { lineEnabled: enabled, liffId: enabled ? 'synthetic-liff' : '', noticeVersion: 'test-v1', noticeText: 'ประกาศทดสอบสำหรับบริการรับส่ง ไม่ใช่ข้อมูลจริง', contactPhone: '053000000' }
  const profiles = [{ id: 'profile', patientName: 'ผู้ป่วยที่บันทึกไว้', contactPhone: '0800000000', mobility: 'wheelchair', villageId: 'village', pickupAddress: 'บ้านทดสอบ', latitude: 18.59, longitude: 99.05, assistance: ['boarding_support'], landmark: 'ประตูหน้า' }]
  const rows: Record<string, unknown>[] = []
  const decisions: boolean[] = []
  const writes: Record<string, unknown>[] = []
  const controls = { failSubmit: false, fieldError: '', revoked: false, forbidden: false, rejectCancel: false, failConsent: false, failRead: false }
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
      if (controls.rejectCancel) return route.fulfill({ status: 409, json: { error: 'Started' } })
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
  if (profile) await page.getByRole('button', { name: 'ใช้ข้อมูลบันทึกไว้', exact: true }).click()
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

test('appointment picker offers only 06:00 through 16:00 Bangkok time', async ({ page }) => {
  await setup(page)
  await consent(page)
  await page.locator('.booking-input-trigger').nth(1).click()
  const dialog = page.getByRole('dialog', { name: 'เลือกเวลานัดหมาย' })
  const hours = dialog.getByRole('listbox', { name: 'ชั่วโมง' })
  await expect(hours.getByRole('option')).toHaveText(['06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16'])
  await hours.focus()
  await hours.press('End')
  await expect(dialog.getByRole('listbox', { name: 'นาที' }).getByRole('option')).toHaveText(['00'])
  await expect(dialog.getByText('16:00 น.', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
  await expect(page.locator('.booking-input-trigger').nth(1)).toContainText('16:00')
})

test('verified citizen reuses only API profiles, reviews, submits and cancels authoritative booking', async ({ page }) => {
  const fixture = await setup(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await consent(page)
  expect(fixture.decisions).toEqual([true])
  await patient(page)
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ตรวจสอบข้อมูล', exact: true })).toBeVisible()
  const submit = page.getByRole('button', { name: 'ยืนยันและส่งคำขอ', exact: true })
  await submit.scrollIntoViewIfNeeded()
  const scrollBeforeSubmit = await page.evaluate(() => window.scrollY)
  expect(scrollBeforeSubmit).toBeGreaterThan(0)
  await submit.click()
  await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toBeVisible()
  const backHome = page.getByRole('link', { name: '← กลับหน้าหลัก', exact: true })
  await expect(backHome).toHaveAttribute('href', '/booking')
  await expect.poll(() => page.evaluate(top => Math.abs(window.scrollY - Math.min(top, document.documentElement.scrollHeight - window.innerHeight)), scrollBeforeSubmit)).toBeLessThanOrEqual(1)
  await expect(page.getByText('BK-authoritative-reference', { exact: true })).toBeVisible()
  expect(fixture.writes[0]).toMatchObject({ consentId: 'consent', bookingFor: 'self', patientProfileId: 'profile', mobility: 'wheelchair', assistance: ['boarding_support'], pickupMethod: 'map', latitude: 18.59, longitude: 99.05, hospitalId: 'hospital' })
  expect(fixture.writes[0]).not.toHaveProperty('requesterId')
  await page.getByRole('button', { name: 'ดูสถานะการจอง', exact: true }).click()
  await expect(backHome).toHaveAttribute('href', '/booking')
  await expect(backHome).toBeInViewport()
  await page.getByRole('button', { name: 'ยกเลิกการจอง', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันยกเลิกการจอง', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ยกเลิกการจองแล้ว', exact: true })).toBeVisible()
  const contactFooter = page.locator('footer.booking-contact-footer')
  await expect(contactFooter.getByRole('link', { name: 'ฉุกเฉิน โทร 1669', exact: true })).toHaveAttribute('href', 'tel:1669')
  await expect(contactFooter.getByRole('link', { name: /ติดต่อเทศบาล/ })).toHaveAttribute('href', 'tel:053000000')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
})

test('direct route/browser storage cannot bypass consent; refusal persists and offers municipal phone', async ({ page }) => {
  const fixture = await setup(page)
  await page.addInitScript(() => localStorage.setItem('booking-consent', 'true'))
  await page.goto('/booking/review')
  await expect(page.getByRole('heading', { name: 'ข้อมูลส่วนบุคคล', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '← กลับหน้าหลัก', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: 'อ่านประกาศความเป็นส่วนตัว', exact: true }).click()
  const privacyNotice = page.getByRole('dialog')
  await expect(privacyNotice.getByText(fixture.config.noticeText)).toBeVisible()
  await privacyNotice.getByText('ปิด', { exact: true }).click()
  await page.getByRole('button', { name: 'ไม่ยินยอมใช้ข้อมูล', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(fixture.decisions).toEqual([false])
  await expect(page.getByRole('dialog').getByRole('link', { name: /ติดต่อเทศบาล/ })).toHaveAttribute('href', 'tel:053000000')
  expect(fixture.writes).toEqual([])
  await page.getByRole('dialog').getByRole('link', { name: '← กลับหน้าหลัก', exact: true }).click()
  await expect(page).toHaveURL(/\/booking$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
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
  await page.goto('/booking/status/booking')
  const trigger = page.getByRole('button', { name: 'ยกเลิกการจอง', exact: true })
  const dialog = page.getByRole('dialog', { name: 'ต้องการยกเลิกการจองนี้หรือไม่?', exact: true })
  await trigger.click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('BK-stale', { exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'กลับ', exact: true }).click()
  await expect(trigger).toBeFocused()
  expect(fixture.writes).toEqual([])
  await trigger.click()
  fixture.controls.rejectCancel = true
  fixture.rows[0].status = 'ABORTED'
  await dialog.getByRole('button', { name: 'ยืนยันยกเลิกการจอง', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('สถานะเปลี่ยนแล้ว')
  await expect(dialog.getByRole('button', { name: 'ยืนยันยกเลิกการจอง', exact: true })).toBeDisabled()
  await expect(page).toHaveURL(/booking\/status\/booking$/)
  await dialog.getByRole('button', { name: 'กลับ', exact: true }).click()
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
  fixture.controls.fieldError = 'consentId'
  await page.getByRole('button', { name: 'ลองส่งคำขออีกครั้ง', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ข้อมูลส่วนบุคคล', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'อ่านประกาศความเป็นส่วนตัว', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('ประกาศฉบับใหม่')).toBeVisible()
  await page.getByRole('dialog').getByText('ปิด', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ })).not.toBeChecked()
  expect(fixture.writes.length).toBe(2)
  expect(fixture.writes[1]).toEqual(fixture.writes[0])
  await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
  await page.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
  await expect(page.getByLabel('ชื่อผู้ป่วย *', { exact: true })).toHaveValue('ผู้ป่วยที่บันทึกไว้')
  fixture.controls.fieldError = 'consentId'
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await page.getByRole('button', { name: 'ลองส่งคำขออีกครั้ง', exact: true }).click()
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

test('a newer pickup survives a late GPS callback; map mode requires a point', async ({ page }) => {
  await setup(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (callback: (position: unknown) => void) => { (window as unknown as { lateGPS: () => void }).lateGPS = () => callback({ coords: { latitude: 1, longitude: 2, accuracy: 5 } }) } } })
  })
  await consent(page); await patient(page, false)
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('กรุณาเลือกพิกัด')
  const gps = page.getByRole('region', { name: 'แผนที่จุดรับ', exact: true }).getByRole('button', { name: 'ใช้ตำแหน่งปัจจุบัน', exact: true })
  await expect(gps).toBeVisible()
  expect((await gps.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await gps.click()
  await chooseCitizenPickup(page, 18.59, 99.05)
  await page.evaluate(() => (window as unknown as { lateGPS: () => void }).lateGPS())
  await expect(page.locator('.booking-pickup-value strong')).toContainText('18.590000, 99.050000')
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
  await page.reload()
  await expect(page.getByText('เซสชันหมดอายุ กรุณายืนยันตัวตนผ่าน LINE อีกครั้ง')).toBeVisible()
  await expect(page.getByText('BK-locked', { exact: true })).toHaveCount(0)
  fixture.controls.revoked = false; fixture.controls.forbidden = true
  await page.getByRole('button', { name: 'ลองเชื่อมต่อ LINE อีกครั้ง', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('ไม่มีสิทธิ์เข้าถึง')
})
