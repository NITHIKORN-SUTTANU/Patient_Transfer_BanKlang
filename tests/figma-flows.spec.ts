import { selectTestDriver } from './testing-tools'
import { expect, test } from '@playwright/test'
import type { DemoState } from '../src/data/seed'

// Exercise exception flows and their dialogs at the minimum supported width.
test.use({ viewport: { width: 320, height: 640 } })

const seed: DemoState = {
  version: 1, selectedActor: null, dispatcherResourcesInitialized: true,
  accounts: [{ id: 'U1', name: 'คนขับทดสอบ', username: 'driver.demo', role: 'Driver', active: true }],
  vehicles: [{ id: 'V1', label: 'รถทดสอบ', active: true }],
  drivers: [{ id: 'D1', name: 'คนขับทดสอบ', active: true, accountId: 'U1', phone: '0800000000' }],
  settings: { center: 'ศูนย์เดิม', serviceArea: 'บ้านกลาง', opensAt: '08:00', closesAt: '16:30' },
  bookings: [{ id: 'BK-0001', patientName: 'ผู้ทดสอบ', status: 'approved', appointmentAt: '2026-10-30T06:10:00.000Z', createdAt: '2026-10-26T03:30:00.000Z', vehicleId: 'V1', driverId: 'D1',
    details: { bookingFor: 'self', patientName: 'ผู้ทดสอบ', contactName: '', phone: '0800000000', relationship: '', hospital: 'โรงพยาบาลทดสอบ', date: '2026-10-30', time: '13:10', assistance: 'เดินได้', extras: [], pickup: { x: 50, y: 50, label: 'จุดรับทดสอบ' }, acknowledged: true },
    schedule: { departureAt: '2026-10-30T04:45:00.000Z', pickupAt: '2026-10-30T05:15:00.000Z', arrivalAt: '2026-10-30T05:50:00.000Z', endsAt: '2026-10-30T06:10:00.000Z', centerToPickupMinutes: 30, pickupToHospitalMinutes: 35, preparationMinutes: 20, calculation: 'demo-manual-v1' } }],
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-26T03:30:00Z'))
  await page.addInitScript(state => {
    if (!localStorage.getItem('ban-klang-transit:demo:v1')) localStorage.setItem('ban-klang-transit:demo:v1', JSON.stringify(state))
    sessionStorage.setItem('ban-klang-transit:driver', 'D1')
  }, seed)
})

test('role-selection icon stays clear of role navigation while scrolling', async ({ page }) => {
  await page.goto('/booking')
  await page.evaluate(() => sessionStorage.removeItem('ban-klang-transit:driver'))
  for (const route of ['/driver/details?booking=BK-0001', '/dispatcher', '/dispatcher/assignment?booking=BK-0001', '/admin', '/booking']) {
    await page.goto(route)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('main')).not.toContainText(/ACT-0|Figma|Buffer|สาธิต/)
    const shortcut = page.getByRole('link', { name: 'กลับเลือกบทบาท', exact: true })
    await expect(shortcut).toHaveCount(1)
    await expect(shortcut.locator('svg')).toBeVisible()
    await expect(shortcut).toHaveText('')
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(shortcut).toBeInViewport()
    const bounds = await shortcut.boundingBox()
    if (route.startsWith('/booking')) {
      expect(bounds?.y).toBe(12)
      expect(bounds!.x + bounds!.width).toBe(page.viewportSize()!.width - 12)
    } else {
      expect(bounds!.x).toBe(12)
      expect(bounds!.y + bounds!.height).toBe(page.viewportSize()!.height - 12)
    }
  }
  await page.goto('/driver/details?booking=BK-0001')
  await expect(page.getByText('ผู้รับบริการ • ผู้ทดสอบ', { exact: true })).toBeVisible()
  await expect(page.getByLabel('คนขับสาธิต')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'โทรหาผู้ติดต่อ · 0800000000' })).toHaveAttribute('href', 'tel:0800000000')
  await page.getByRole('link', { name: 'กลับเลือกบทบาท', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/driver/details?booking=BK-0001')
  await page.evaluate(() => {
    const key = 'ban-klang-transit:demo:v1'
    const current = JSON.parse(localStorage.getItem(key)!)
    current.drivers[0].active = false
    current.drivers.push({ id: 'D2', name: 'คนขับอีกคน', active: true, accountId: 'U2' })
    current.accounts.push({ id: 'U2', name: 'คนขับอีกคน', username: 'second.driver', role: 'Driver', active: true })
    current.bookings.push({ ...current.bookings[0], id: 'BK-OTHER', driverId: 'D2' })
    localStorage.setItem(key, JSON.stringify(current))
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'บัญชีนี้ยังไม่พร้อมใช้งาน', exact: true })).toBeVisible()
  await expect(page.locator('main')).not.toContainText('BK-OTHER')
})

test('Figma cancellation is confirmed, persists, and is visible to staff and driver', async ({ page }) => {
  await page.goto('/booking/status/BK-0001')
  await page.getByRole('button', { name: 'ยกเลิกการจอง', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ยกเลิกการจอง', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'กลับไปดูรายละเอียด' }).click()
  await expect(page.locator('.booking-badge')).toContainText('อนุมัติแล้ว')
  await page.getByRole('button', { name: 'ยกเลิกการจอง', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันยกเลิกการจอง' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'ยกเลิกการจองแล้ว' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ยกเลิกการจอง', exact: true })).toHaveCount(0)
  await page.goto('/dispatcher/tracking')
  await expect(page.getByRole('row').filter({ hasText: 'BK-0001' })).toContainText('ยกเลิกแล้ว')
  await page.goto('/driver/history')
  await expect(page.locator('.driver-trip')).toContainText('ยกเลิกแล้ว')
})

test('start confirmation blocks citizen cancellation and failed pickup cancels the shared job', async ({ page, context }) => {
  await page.goto('/booking/cancel/BK-0001')
  const driver = await context.newPage()
  await driver.goto('/driver/status?booking=BK-0001')
  await selectTestDriver(driver, 'D1')
  await driver.goto('/driver/status?booking=BK-0001')
  await driver.locator('.driver-action').getByRole('button').click()
  await driver.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  await expect(page.getByRole('button', { name: 'ยืนยันยกเลิกการจอง' })).toBeDisabled()
  await driver.getByRole('button', { name: 'รับผู้ป่วยไม่ได้', exact: true }).click()
  await expect(driver.getByRole('button', { name: 'ยืนยันรายงานรับไม่ได้' })).toBeEnabled()
  await driver.getByLabel('เหตุผลที่รับผู้ป่วยไม่ได้').selectOption('ติดต่อผู้ป่วยไม่ได้')
  await driver.getByRole('button', { name: 'ยืนยันรายงานรับไม่ได้' }).click()
  await expect(driver.locator('.driver-trip')).toContainText('ติดต่อผู้ป่วยไม่ได้')
  await page.goto('/booking/status/BK-0001')
  await expect(page.getByRole('heading', { name: 'ยกเลิกการจองแล้ว' })).toBeVisible()
  await expect(page.locator('.booking-card')).toContainText('ติดต่อผู้ป่วยไม่ได้')
})

test('geospatial changes preserve the active schedule until dispatcher review', async ({ page }) => {
  await page.goto('/admin/settings')
  await page.getByRole('button', { name: 'แก้ไขการตั้งค่า', exact: true }).click()
  await page.getByLabel('ตำแหน่งศูนย์รถเทศบาล').fill('ศูนย์ใหม่ทดสอบ')
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
  await expect(page.getByText('รอตรวจสอบตาราง 1 งาน', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'ดูรายการที่ได้รับผลกระทบ' }).click()
  await expect(page.getByRole('dialog')).toContainText('ยังคงมีผลจนกว่าเจ้าหน้าที่จัดรถจะยืนยัน')
  await page.getByRole('link', { name: 'ไปตรวจสอบตารางกับเจ้าหน้าที่จัดรถ' }).click()
  await page.getByRole('button', { name: 'ตรวจสอบ BK-0001', exact: true }).click()
  await page.getByLabel('ศูนย์ → จุดรับ (นาที)', { exact: true }).fill('40')
  await page.getByLabel('จุดรับ → โรงพยาบาล (นาที)', { exact: true }).fill('45')
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('ban-klang-transit:demo:v1')!).bookings[0].schedule)
  expect(before.centerToPickupMinutes).toBe(30)
  await page.getByRole('button', { name: 'ตรวจสอบและยืนยันตารางใหม่', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('ban-klang-transit:demo:v1')!).bookings[0])
  expect(after.schedule.centerToPickupMinutes).toBe(40)
  expect(after.schedule.preparationMinutes).toBe(20)
  expect(after.scheduleReview).toBeUndefined()
})

test('Figma assets keep intrinsic sizes and role screenshots use their source layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/booking')
  const assets = await page.locator('.booking-hero img').evaluateAll(images => images.map(el => {
    const image = el as HTMLImageElement
    const rect = image.getBoundingClientRect()
    return { loaded: image.complete && image.naturalWidth > 0, width: rect.width, natural: image.naturalWidth }
  }))
  expect(assets).toHaveLength(3)
  expect(assets.every(asset => asset.loaded && Math.abs(asset.width - asset.natural) < 1)).toBe(true)
  await page.screenshot({ path: 'test-results/figma-citizen.png', fullPage: true })
  await page.goto('/driver/status?booking=BK-0001')
  await page.screenshot({ path: 'test-results/figma-driver.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dispatcher')
  await page.screenshot({ path: 'test-results/figma-dispatcher.png', fullPage: true })
  await page.goto('/admin')
  await page.screenshot({ path: 'test-results/figma-admin.png', fullPage: true })
})
