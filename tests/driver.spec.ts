import { setPickerTime } from './time-picker'
import { selectTestDriver } from './testing-tools'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Every request used by these tests is submitted through the ACT-01 UI.
async function submitPatientBooking(page: Page, hour = '13', minute = '10') {
  await page.clock.setFixedTime(new Date('2026-10-26T03:30:00Z'))
  await page.goto('/booking')
  await page.getByRole('button', { name: 'เริ่มจองรถ →', exact: true }).click()
  await page.getByRole('checkbox', { name: 'รับทราบการใช้ข้อมูล' }).check()
  await page.getByRole('button', { name: 'รับทราบและถัดไป' }).click()
  await page.getByLabel('ชื่อผู้ป่วย *', { exact: true }).fill('ผู้รับบริการ จำลอง')
  await page.getByLabel('เบอร์โทรศัพท์ของคุณ *', { exact: true }).fill('0800000000')
  await page.getByLabel('โรงพยาบาล *', { exact: true }).selectOption('โรงพยาบาลลำพูน')
  await page.getByRole('button', { name: /วันนัดหมาย \*/ }).click()
  await page.getByRole('button', { name: /30 ตุลาคม 2569$/, exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()
  await page.getByRole('button', { name: /เวลานัดหมาย \*/ }).click()
  await setPickerTime(page, 'ชั่วโมง', hour)
  await setPickerTime(page, 'นาที', minute)
  await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await page.getByRole('region', { name: 'แผนที่จุดรับ' }).focus()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toBeVisible()
  return (await page.locator('.booking-summary-id').textContent())!
}
async function selectResources(page: Page, vehicle = '01', driver = 'A') {
  await page.getByRole('button', { name: /^รถรับส่ง:/ }).click()
  await page.getByRole('option', { name: new RegExp(`รถคันที่ ${vehicle}`) }).click()
  await page.getByRole('button', { name: /^คนขับ:/ }).click()
  await page.getByRole('option', { name: new RegExp(`คนขับ ${driver}`) }).click()
}
async function assign(page: Page, id: string, vehicle = '01', driver = 'A') {
  await page.goto(`/dispatcher/assignment?booking=${id}`)
  await selectResources(page, vehicle, driver)
  await page.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '✓ รถและคนขับพร้อมรับงาน' })).toBeVisible()
  await page.getByRole('button', { name: 'ยืนยันการมอบหมาย', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '✓ รถและคนขับพร้อมรับงาน' })).toBeVisible()
  await page.getByRole('button', { name: 'ยืนยันการมอบหมาย', exact: true }).click()
  await expect(page).toHaveURL(/dispatcher\/tracking$/)
}


test('complete shared ACT-01 → ACT-02 → ACT-03 journey across tabs and reload', async ({ page, context }) => {
  const id = await submitPatientBooking(page)
  await page.goto('/dispatcher')
  await page.getByRole('row').filter({ hasText: id }).getByRole('button', { name: 'ดูรายละเอียด →', exact: true }).click()
  await page.getByRole('button', { name: 'อนุมัติคำขอ', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันอนุมัติ', exact: true }).click()
  await assign(page, id)
  const patient = await context.newPage()
  await patient.goto(`/booking/status/${id}`)
  const driver = await context.newPage()
  await driver.clock.setFixedTime(new Date('2026-10-30T03:30:00Z'))
  await driver.goto('/driver')
  await selectTestDriver(driver, 'demo-driver-B')
  await expect(driver.getByText('ไม่มีงานรับส่งวันนี้', { exact: true })).toBeVisible()
  await selectTestDriver(driver, 'demo-driver-A')
  await driver.getByRole('button', { name: 'ดูรายละเอียดงาน', exact: false }).click()
  await expect(driver.getByText('ผู้รับบริการ • ผู้รับบริการ จำลอง', { exact: true })).toBeVisible()
  await expect(driver.locator('.driver-schedule')).toContainText('12:15')
  await driver.getByRole('button', { name: 'เปิดแผนที่ไปจุดรับ' }).click()
  await expect(driver.getByRole('region', { name: 'แผนที่จุดรับ' })).toBeVisible()
  await expect(driver.getByRole('link', { name: 'นำทางด้วย Google Maps' })).toHaveAttribute('href', /destination=/)
  await driver.getByRole('dialog').getByRole('button', { name: 'ปิด', exact: true }).click()
  await driver.getByRole('button', { name: 'ไปเริ่มรับผู้ป่วย' }).click()
  await expect(driver.getByRole('link', { name: 'โทรหาผู้ติดต่อ', exact: true })).toHaveAttribute('href', 'tel:0800000000')
  await expect(driver.getByRole('button', { name: 'ดูจุดรับ', exact: true })).toBeVisible()
  await driver.locator('.driver-action').getByRole('button').click()
  await expect(driver.getByRole('button', { name: 'ยกเลิก', exact: true })).toBeFocused()
  await driver.getByRole('button', { name: 'ยกเลิก', exact: true }).click()
  expect(await driver.evaluate(() => JSON.parse(localStorage.getItem('ban-klang-transit:demo:v1')!).bookings[0].status)).toBe('approved')
  for (const stage of ['going_to_pickup', 'patient_onboard', 'going_to_hospital', 'delivered']) {
    await driver.locator('.driver-action').getByRole('button').click()
    await driver.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
    await expect(driver.getByRole('dialog')).toHaveCount(0)
    const saved = await driver.evaluate(() => JSON.parse(localStorage.getItem('ban-klang-transit:demo:v1')!).bookings[0])
    expect(saved.driverProgress.stage).toBe(stage)
    expect(saved.status).toBe(stage === 'delivered' ? 'completed' : 'in_transit')
    await expect(page.getByRole('row').filter({ hasText: id })).toContainText(stage === 'delivered' ? 'เสร็จสิ้น' : 'กำลังเดินทาง')
    await driver.reload()
    expect(await driver.evaluate(() => sessionStorage.getItem('ban-klang-transit:driver'))).toBe('demo-driver-A')
  }
  await expect(patient.getByText('เสร็จสิ้น', { exact: true }).first()).toBeVisible()
  await patient.reload()
  await expect(patient.getByText('เสร็จสิ้น', { exact: true }).first()).toBeVisible()
  await driver.getByRole('link', { name: 'ดูประวัติงาน', exact: true }).click()
  await expect(driver.locator('.driver-trip')).toContainText(id)
  await expect(driver.locator('.driver-trip')).toContainText('เสร็จสิ้น')
})

async function seedDriver(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-30T03:30:00Z'))
  await page.goto('/driver')
  await page.evaluate(() => {
    const key = 'ban-klang-transit:demo:v1'
    const state = JSON.parse(localStorage.getItem(key)!)
    state.bookings = [1, 2].map(n => ({ id: `BK-000${n}`, patientName: 'ผู้รับบริการ จำลอง', status: 'approved', driverId: 'demo-driver-A', vehicleId: 'demo-vehicle-1', appointmentAt: `2026-10-30T${n === 1 ? '06' : '09'}:10:00.000Z`, schedule: { departureAt: `2026-10-30T${n === 1 ? '04' : '07'}:45:00.000Z`, pickupAt: `2026-10-30T${n === 1 ? '05' : '08'}:15:00.000Z`, arrivalAt: `2026-10-30T${n === 1 ? '05' : '08'}:50:00.000Z`, endsAt: `2026-10-30T${n === 1 ? '06' : '09'}:10:00.000Z`, centerToPickupMinutes: 30, pickupToHospitalMinutes: 35, preparationMinutes: 20, calculation: 'demo-manual-v1' } }))
    localStorage.setItem(key, JSON.stringify(state))
    sessionStorage.setItem('ban-klang-transit:driver', 'demo-driver-A')
  })
  await page.reload()
}

test('driver must finish active job before starting another, including stale confirmations', async ({ page, context }) => {
  await seedDriver(page)
  await page.goto('/driver/details?booking=BK-0002')
  await page.getByRole('button', { name: 'ไปเริ่มรับผู้ป่วย', exact: true }).click()
  const other = await context.newPage()
  await other.goto('/driver/details?booking=BK-0001')
  await other.getByRole('button', { name: 'ไปเริ่มรับผู้ป่วย', exact: true }).click()
  await other.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  await expect(page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true })).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('กรุณาจบงาน BK-0001 ก่อนเริ่มงานใหม่')
  const blocked = await page.evaluate(async () => {
    const modulePath = '/src/services/driver.ts'
    const { advanceDriverTrip } = await import(modulePath)
    try { advanceDriverTrip('BK-0002', 'demo-driver-A', 'assigned'); return '' }
    catch (e) { return (e as Error).message }
  })
  expect(blocked).toContain('กรุณาจบงาน BK-0001 ก่อนเริ่มงานใหม่')
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click()
  await expect(page.getByRole('button', { name: 'ไปเริ่มรับผู้ป่วย', exact: true })).toBeDisabled()
  for (let step = 0; step < 3; step++) {
    await other.locator('.driver-action').getByRole('button').click()
    await other.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: 'ไปเริ่มรับผู้ป่วย', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'ไปเริ่มรับผู้ป่วย', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  await expect(page.locator('.driver-header')).toContainText('BK-0002')
  await expect(page.locator('.driver-current')).toContainText('กำลังไปรับผู้ป่วย')
  const timeRange = page.getByRole('group', { name: 'ช่วงเวลางานตามแผน' })
  await expect(timeRange.locator('time')).toHaveText(['14:45 น.', '16:10 น.'])
  await expect(timeRange.locator('time').first()).toHaveAttribute('datetime', '2026-10-30T07:45:00.000Z')
  await page.setViewportSize({ width: 320, height: 844 })
  expect(await timeRange.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test('job details returns to its source page and survives reload', async ({ page }) => {
  await seedDriver(page)
  await page.locator('.driver-trip').first().getByRole('button').click()
  await page.getByRole('link', { name: 'กลับหน้าก่อนหน้า', exact: true }).click()
  await expect(page).toHaveURL(/\/driver$/)
  await page.locator('.driver-trip').first().getByRole('button').click()
  await page.getByRole('button', { name: 'ไปเริ่มรับผู้ป่วย', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  const statusUrl = page.url()
  await page.getByRole('link', { name: 'ดูรายละเอียดงาน →', exact: true }).click()
  await page.reload()
  await page.getByRole('link', { name: 'กลับหน้าก่อนหน้า', exact: true }).click()
  await expect(page).toHaveURL(statusUrl)
  await page.goto('/driver/details?booking=BK-0002')
  await expect(page.getByRole('link', { name: 'กลับหน้าก่อนหน้า', exact: true })).toHaveAttribute('href', '/driver')
})

test('work status shows only the started job and clears after completion', async ({ page }) => {
  await seedDriver(page)
  await page.goto('/driver/status?booking=BK-0001')
  await expect(page.locator('.driver-status-indicator')).toHaveCount(0)
  await expect(page.locator('.driver-current')).toHaveCount(0)
  await expect(page.locator('.driver-action')).toHaveCount(0)
  await page.goto('/driver/details?booking=BK-0002')
  await page.getByRole('button', { name: 'ไปเริ่มรับผู้ป่วย', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  await page.goto('/driver/status?booking=BK-0001')
  await expect(page.locator('.driver-header')).toContainText('BK-0002')
  await expect(page.locator('.driver-current')).toContainText('กำลังไปรับผู้ป่วย')
  await expect(page.getByRole('link', { name: 'สถานะงาน', exact: true }).locator('.driver-status-indicator')).toBeVisible()
  await page.locator('#driver-sidebar').getByRole('button', { name: 'ย่อเมนูด้านข้าง', exact: true }).click()
  await expect(page.locator('.driver-status-indicator')).toBeVisible()
  for (let step = 0; step < 3; step++) {
    await page.locator('.driver-action').getByRole('button').click()
    await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  }
  await expect(page.locator('.driver-current')).toHaveCount(0)
  await expect(page.locator('.driver-action')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.driver-current')).toHaveCount(0)
  await expect(page.locator('.driver-status-indicator')).toHaveCount(0)
})

for (const recovery of ['retry', 'zoom'] as const) test(`driver map recovers from tile failure via ${recovery} and keeps navigation available`, async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedDriver(page)
  const tile = await page.evaluate(() => {
    const key = 'ban-klang-transit:demo:v1'
    const state = JSON.parse(localStorage.getItem(key)!)
    state.bookings[0].details = { bookingFor: 'self', patientName: 'ผู้รับบริการ จำลอง', contactName: '', phone: '0800000000', relationship: '', hospital: 'โรงพยาบาลลำพูน', date: '2026-10-30', time: '13:10', assistance: 'เดินได้', extras: [], acknowledged: true, pickup: { x: 50, y: 50, label: 'จุดรับทดสอบ', latitude: 18.58, longitude: 99.01 } }
    localStorage.setItem(key, JSON.stringify(state))
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const drawing = canvas.getContext('2d')!
    drawing.fillStyle = '#e0f0e0'; drawing.fillRect(0, 0, 256, 256)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  let unavailable = true
  await page.route('https://tile.openstreetmap.org/**', route => unavailable ? route.fulfill({ status: 503 }) : route.fulfill({ contentType: 'image/png', body: Buffer.from(tile, 'base64') }))
  await page.goto('/driver/details?booking=BK-0001')
  await page.getByRole('button', { name: 'เปิดแผนที่ไปจุดรับ' }).click()
  const failure = page.getByText('โหลดแผนที่ไม่สำเร็จ กรุณาลองใหม่ หรือเปิดนำทางด้วย Google Maps', { exact: true })
  await expect(failure).toBeVisible()
  await expect(page.getByText('กรุณากรอกพิกัดด้านล่าง', { exact: false })).toHaveCount(0)
  const navigation = page.getByRole('link', { name: 'นำทางด้วย Google Maps' })
  await expect(navigation).toBeVisible()
  const url = new URL((await navigation.getAttribute('href'))!)
  expect(url.searchParams.get('destination')).toBe('18.58,99.01')
  expect(url.searchParams.get('dir_action')).toBe('navigate')
  if (recovery === 'retry') {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: 18.57, longitude: 99.00 })
    await page.getByRole('button', { name: 'ใช้ตำแหน่งของฉันเป็นจุดเริ่มต้น' }).click()
    await expect(page.getByText('ตั้งจุดเริ่มต้นแล้ว กดนำทางด้วย Google Maps เพื่อเปิดเส้นทาง')).toBeVisible()
    expect(new URL((await navigation.getAttribute('href'))!).searchParams.get('origin')).toBe('18.57,99')
    const originToggle = page.getByRole('button', { name: 'ใช้ตำแหน่งของคุณแล้ว · ยกเลิก' })
    await expect(originToggle).toHaveAttribute('aria-pressed', 'true')
    await originToggle.click()
    expect(new URL((await navigation.getAttribute('href'))!).searchParams.has('origin')).toBe(false)
    await expect(page.getByRole('button', { name: 'ใช้ตำแหน่งของฉันเป็นจุดเริ่มต้น' })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: 'ใช้ตำแหน่งของฉันเป็นจุดเริ่มต้น' }).click()
    await expect(originToggle).toHaveAttribute('aria-pressed', 'true')
    expect(new URL((await navigation.getAttribute('href'))!).searchParams.get('origin')).toBe('18.57,99')
  } else {
    await page.evaluate(() => Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) => failure({ code: 1 } as GeolocationPositionError) } }))
    await page.getByRole('button', { name: 'ใช้ตำแหน่งของฉันเป็นจุดเริ่มต้น' }).click()
    await expect(page.getByText('ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง กรุณาอนุญาต GPS หรือเลือกจุดเริ่มต้นใน Google Maps')).toBeVisible()
    expect(new URL((await navigation.getAttribute('href'))!).searchParams.has('origin')).toBe(false)
  }
  unavailable = false
  if (recovery === 'retry') await page.getByRole('button', { name: 'ลองโหลดแผนที่อีกครั้ง' }).click()
  else await page.locator('.maplibregl-ctrl-zoom-in').click()
  await expect(page.locator('.pickup-map-canvas')).toHaveAttribute('data-ready', 'true')
  await expect(failure).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'ลองโหลดแผนที่อีกครั้ง' })).toHaveCount(0)
  await expect(page.locator('.pickup-map-coordinates')).toHaveText('พิกัด 18.580000, 99.010000')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await context.route('https://www.google.com/maps/dir/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Maps handoff received</p>' }))
  const [mapsTab] = await Promise.all([context.waitForEvent('page'), navigation.click()])
  await expect(mapsTab).toHaveURL(/google.com\/maps\/dir\//)
  expect(new URL(mapsTab.url()).searchParams.get('destination')).toBe('18.58,99.01')
  await expect(page).toHaveURL(/driver\/details\?booking=BK-0001/)
  await mapsTab.close()
})

test('driver sidebar matches the dispatcher icon rail and active trips take priority on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await seedDriver(page)
  const sidebar = page.locator('#driver-sidebar')
  await sidebar.getByRole('button', { name: 'ย่อเมนูด้านข้าง', exact: true }).click()
  expect((await sidebar.boundingBox())!.width).toBe(80)
  await expect(sidebar.getByRole('img', { name: 'ตราเทศบาลจำลอง' })).toBeVisible()
  await sidebar.getByRole('link', { name: 'สถานะงาน', exact: true }).click()
  expect((await sidebar.boundingBox())!.width).toBe(80)
  await page.goto('/driver/status?booking=BK-0002')
  await page.locator('.driver-action').getByRole('button').click()
  await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  await page.goto('/driver')
  await page.setViewportSize({ width: 320, height: 640 })
  await expect(page.locator('.driver-trip.is-primary')).toContainText('BK-0002')
  await expect(page.locator('.driver-trip.is-primary')).toContainText('กำลังไปรับผู้ป่วย')
  await page.getByRole('button', { name: /ติดตามสถานะงาน/ }).click()
  const action = page.locator('.driver-action').getByRole('button')
  await expect(action).toBeInViewport()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(action).toBeInViewport()
  const shortcut = (await page.getByRole('link', { name: 'กลับเลือกบทบาท' }).boundingBox())!
  const actionBounds = (await action.boundingBox())!
  expect(actionBounds.x).toBeGreaterThanOrEqual(shortcut.x + shortcut.width)
})

test('stale confirmations, identity isolation, missing jobs, and storage reset', async ({ page, context }) => {
  await seedDriver(page)
  await page.goto('/driver/status?booking=BK-0001')
  await page.locator('.driver-action').getByRole('button').click()
  const other = await context.newPage()
  await other.goto('/driver/status?booking=BK-0001')
  await selectTestDriver(other, 'demo-driver-A')
  await other.locator('.driver-action').getByRole('button').click()
  await other.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('งานหรือสถานะเปลี่ยนแล้ว')
  await expect(page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await selectTestDriver(page, 'demo-driver-B')
  expect(await other.evaluate(() => sessionStorage.getItem('ban-klang-transit:driver'))).toBe('demo-driver-A')
  await page.goto('/driver/details?booking=missing')
  await expect(page.getByRole('heading', { name: 'ไม่พบงานที่มอบหมายให้คนขับนี้' })).toBeVisible()
  await other.evaluate(() => localStorage.removeItem('ban-klang-transit:demo:v1'))
  await expect(page.getByRole('heading', { name: 'บัญชีนี้ยังไม่พร้อมใช้งาน' })).toBeVisible()
})

for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920]) {
  test(`driver layouts and dialogs at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await seedDriver(page)
    for (const path of ['/driver', '/driver/details?booking=BK-0001', '/driver/status?booking=BK-0001', '/driver/history']) {
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      if ([320, 1280].includes(width)) await page.screenshot({ path: `test-results/driver-refined-${path.split('?')[0].split('/').pop() || 'dashboard'}-${width}.png`, fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      for (const control of await page.locator('.driver-shell button, .driver-shell select, .driver-nav a').all()) {
        const box = await control.boundingBox()
        if (box) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1) }
      }
      if (path.includes('/status')) {
        await page.locator('.driver-action').getByRole('button').click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        const bounds = await dialog.boundingBox()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
        await page.screenshot({ path: `test-results/driver-dialog-${width}.png`, fullPage: true })
        await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click()
      }
      if (path === '/driver') await page.screenshot({ path: `test-results/driver-dashboard-${width}.png`, fullPage: true })
    }
    await page.evaluate(() => {
      const key = 'ban-klang-transit:demo:v1'
      const state = JSON.parse(localStorage.getItem(key)!)
      state.bookings[0].status = 'completed'
      localStorage.setItem(key, JSON.stringify(state))
    })
    await page.goto('/driver/history')
    await expect(page.locator('.driver-trip')).toContainText('BK-0001')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: /ดูรายละเอียด/ }).click()
    await page.getByRole('button', { name: 'ดูสถานะงาน', exact: true }).click()
    await expect(page.locator('.driver-action').getByRole('button')).toHaveCount(0)
    await expect(page.locator('.driver-current')).toContainText('ส่งถึงโรงพยาบาล')
  })
}
