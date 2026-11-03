import { setPickerTime } from './time-picker'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Booking, DemoState } from '../src/data/seed'

test('approved and completed booking cards stay distinct, readable and open their details', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ban-klang-transit:demo:v1', JSON.stringify({
    version: 1, selectedActor: null, vehicles: [], drivers: [], bookings: [
      { id: 'BK-APPROVED', patientName: 'ผู้ทดสอบ', status: 'approved', appointmentAt: '2026-10-30T02:15:00.000Z' },
      { id: 'BK-COMPLETED', patientName: 'ผู้ทดสอบ', status: 'completed', appointmentAt: '2026-10-29T02:15:00.000Z' },
    ],
  })))
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/booking/bookings')
    const approved = page.locator('a.booking-summary-card.approved')
    const completed = page.locator('a.booking-summary-card.completed')
    await expect(approved).toContainText('อนุมัติแล้ว')
    await expect(completed).toContainText('เสร็จสิ้น')
    await expect(completed).toContainText('ดูสรุปการเดินทาง')
    await expect(approved.locator('.booking-summary-status-icon svg')).toBeVisible()
    await expect(completed.locator('.booking-summary-status-icon svg')).toBeVisible()
    await checkCitizenSurface(page)
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(audit.violations).toEqual([])
    await page.screenshot({ path: `test-results/booking-distinct-statuses-${width}.png`, fullPage: true })
    await completed.click()
    await expect(page).toHaveURL(/booking\/status\/BK-COMPLETED$/)
    await expect(page.getByRole('region', { name: 'รายละเอียดคำขอจองรถ', exact: true })).toContainText('ส่งถึงโรงพยาบาลแล้ว')
  }
})

async function checkCitizenSurface(page: Page) {
  if (new URL(page.url()).pathname.replace(/\/$/, '') !== '/booking') await expect(page.locator('a[href="tel:1669"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const problems = await page.locator('main, dialog[open]').evaluateAll(roots => {
    const failures: string[] = []
    for (const root of roots) {
      for (const element of root.querySelectorAll<HTMLElement>('*')) {
        if (!element.checkVisibility()) continue
        const ownText = [...element.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
        if (ownText && parseFloat(getComputedStyle(element).fontSize) < 16) failures.push(`Small text: ${element.textContent?.slice(0, 50)}`)
      }
      for (const element of root.querySelectorAll<HTMLElement>('button:not(:disabled), a, select, input:not([type=checkbox]), label:has(input[type=checkbox])')) {
        if (!element.checkVisibility()) continue
        const rect = element.getBoundingClientRect()
        const minimum = element.closest('.booking-calendar, .booking-calendar-month') ? 42 : 48
        if (rect.width < minimum - .1 || rect.height < minimum - .1) failures.push(`Small target ${Math.round(rect.width)}×${Math.round(rect.height)}: ${element.getAttribute('aria-label') || element.textContent?.slice(0, 50)}`)
      }
    }
    return failures
  })
  expect(problems).toEqual([])
}

for (const width of [320, 390, 768, 1440]) test(`citizen readable controls, emergency access and pickers at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.clock.setFixedTime(new Date('2026-10-26T03:30:00Z'))
  await page.goto('/booking')
  await checkCitizenSurface(page)
  await page.getByRole('button', { name: 'เริ่มจองรถ →', exact: true }).click()
  await checkCitizenSurface(page)
  await page.getByRole('button', { name: 'ไม่ยินยอมใช้ข้อมูล', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('คุณยังไม่ได้ยินยอมใช้ข้อมูล')
  await expect(page.locator('a[href="tel:1669"]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'รับทราบและถัดไป' })).toBeDisabled()
  await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
  await page.getByRole('button', { name: 'รับทราบและถัดไป' }).click()
  await expect(page.getByRole('navigation', { name: 'ขั้นตอนที่ 1 จาก 3' }).locator('[aria-current=step]')).toContainText('ข้อมูลผู้ป่วย')
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await expect(page.getByLabel('ชื่อผู้ป่วย *', { exact: true })).toBeFocused()
  await checkCitizenSurface(page)

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(page.locator('a[href="tel:1669"]')).toHaveCount(0)
  await page.getByRole('button', { name: /วันนัดหมาย \*/ }).click()
  await checkCitizenSurface(page)
  await expect(page.getByRole('button', { name: 'ยืนยันวันที่', exact: true })).toBeInViewport()
  await expect(page.getByRole('dialog').locator('a[href="tel:1669"]')).toHaveCount(0)
  await page.screenshot({ path: `test-results/refined-calendar-${width}.png`, fullPage: true })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /วันนัดหมาย \*/ })).toBeFocused()
  await page.getByRole('button', { name: /เวลานัดหมาย \*/ }).click()
  await checkCitizenSurface(page)
  await page.keyboard.press('Escape')
  await page.screenshot({ path: `test-results/refined-patient-${width}.png`, fullPage: true })
  await page.getByLabel('ชื่อผู้ป่วย *', { exact: true }).fill('ผู้ป่วย จำลอง')
  await page.getByLabel('เบอร์โทรศัพท์ของคุณ *', { exact: true }).fill('0800000000')
  await page.getByLabel('โรงพยาบาล *', { exact: true }).selectOption('โรงพยาบาลลำพูน')
  await page.getByRole('button', { name: /วันนัดหมาย \*/ }).click()
  await page.getByRole('button', { name: /30 ตุลาคม 2569$/, exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันวันที่' }).click()
  await page.getByRole('button', { name: /เวลานัดหมาย \*/ }).click()
  await setPickerTime(page, 'ชั่วโมง', '9')
  await page.getByRole('button', { name: 'ยืนยันเวลา' }).click()
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await checkCitizenSurface(page)
  await expect(page.getByRole('navigation', { name: 'ขั้นตอนที่ 2 จาก 3' }).locator('[aria-current=step]')).toContainText('จุดรับ')
  await checkCitizenSurface(page)
  await page.getByRole('region', { name: 'แผนที่จุดรับ' }).focus()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await checkCitizenSurface(page)
  await page.screenshot({ path: `test-results/refined-review-${width}.png`, fullPage: true })
  await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toBeVisible()
  await checkCitizenSurface(page)
  await page.getByRole('button', { name: 'ดูสถานะการจอง', exact: true }).click()
  await checkCitizenSurface(page)
  await page.screenshot({ path: `test-results/refined-status-${width}.png`, fullPage: true })
  await page.getByRole('button', { name: 'รายการจองของฉัน', exact: true }).click()
  await checkCitizenSurface(page)
})

test('staff phone records retain every field and their action without clipping', async ({ page }) => {
  const appointmentAt = '2026-10-30T02:15:00.000Z'
  const state: DemoState = {
    version: 1, selectedActor: null, dispatcherResourcesInitialized: true,
    vehicles: [{ id: 'V-PHONE', label: 'รถรับส่งทดสอบ', active: true }],
    drivers: [{ id: 'D-PHONE', name: 'คนขับทดสอบ', active: true }],
    bookings: [{ id: 'BK-PHONE', patientName: 'ผู้ทดสอบ', status: 'approved', appointmentAt, vehicleId: 'V-PHONE', driverId: 'D-PHONE', schedule: { departureAt: '2026-10-30T00:50:00.000Z', pickupAt: '2026-10-30T01:20:00.000Z', arrivalAt: '2026-10-30T01:55:00.000Z', endsAt: appointmentAt, centerToPickupMinutes: 30, pickupToHospitalMinutes: 35, preparationMinutes: 20, calculation: 'demo-manual-v1' } }],
  }
  await page.goto('/dispatcher/tracking')
  await page.evaluate(value => localStorage.setItem('ban-klang-transit:demo:v1', JSON.stringify(value)), state)
  await page.reload()
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 })
    const row = page.getByRole('row').filter({ hasText: 'BK-PHONE' })
    await expect(row).toContainText('รถรับส่งทดสอบ · คนขับทดสอบ')
    await expect(row.getByRole('button', { name: 'ดูสถานะ →', exact: true })).toBeVisible()
    expect(await row.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return [...element.children].every(cell => { const rect = cell.getBoundingClientRect(); return rect.bottom <= bounds.bottom + 1 && rect.right <= bounds.right + 1 }) && element.scrollHeight <= element.clientHeight + 1
    })).toBe(true)
    await row.screenshot({ path: `test-results/dispatcher-record-${width}.png` })
  }
})

test('citizen status distinguishes approval, assignment and each saved driver milestone', async ({ page }) => {
  await page.goto('/booking')
  const booking: Booking = { id: 'BK-0001', patientName: 'ผู้ป่วย จำลอง', appointmentAt: '2026-10-30T02:15:00.000Z', createdAt: '2026-10-26T03:30:00.000Z', status: 'pending' }
  const state: DemoState = { version: 1, selectedActor: null, bookings: [booking], vehicles: [], drivers: [] }
  async function save() {
    await page.evaluate(value => localStorage.setItem('ban-klang-transit:demo:v1', JSON.stringify(value)), state)
    await page.goto('/booking/status/BK-0001')
    await page.reload()
  }
  await save()
  await expect(page.locator('.booking-current-status')).toContainText('ยังไม่ยืนยันรถรับส่ง')
  booking.status = 'approved'
  booking.reviewedAt = '2026-10-26T04:00:00.000Z'
  await save()
  await expect(page.locator('.booking-current-status')).toContainText('ยังไม่ยืนยันเวลารับ')
  booking.vehicleId = 'V-1'; booking.driverId = 'D-1'
  booking.schedule = { departureAt: '2026-10-30T00:50:00.000Z', pickupAt: '2026-10-30T01:20:00.000Z', arrivalAt: '2026-10-30T01:55:00.000Z', endsAt: booking.appointmentAt, centerToPickupMinutes: 30, pickupToHospitalMinutes: 35, preparationMinutes: 20, calculation: 'demo-manual-v1' }
  await save()
  await expect(page.locator('.booking-current-status')).toContainText('จัดรถและคนขับแล้ว')
  for (const [stage, label] of [['going_to_pickup', 'คนขับกำลังไปรับ'], ['patient_onboard', 'รับผู้ป่วยขึ้นรถแล้ว'], ['going_to_hospital', 'กำลังเดินทางไปโรงพยาบาล']] as const) {
    booking.status = 'in_transit'
    booking.driverProgress = { stage, events: [...(booking.driverProgress?.events || []), { stage, at: '2026-10-30T01:00:00.000Z' }] }
    await save()
    await expect(page.locator('.booking-current-status h3')).toHaveText(label)
    await page.getByText('ดูทุกขั้นตอน', { exact: true }).click()
    await expect(page.locator('.booking-trip-timeline [aria-current=step]')).toBeVisible()
    await expect(page.locator('.booking-trip-timeline [aria-current=step] ~ li.complete')).toHaveCount(0)
  }
})
