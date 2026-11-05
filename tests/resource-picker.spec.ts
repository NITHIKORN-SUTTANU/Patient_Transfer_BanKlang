import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-26T03:30:00Z'))
  await page.addInitScript(() => {
    const key = 'ban-klang-transit:demo:v1'
    if (localStorage.getItem(key)) return
    localStorage.setItem(key, JSON.stringify({
      version: 1, selectedActor: 'ACT-02', dispatcherResourcesInitialized: true,
      vehicles: [{ id: 'v1', label: 'รถคันที่ 01', active: true }, { id: 'v2', label: 'รถคันที่ 02', active: false }],
      drivers: [{ id: 'd1', name: 'คนขับ A', active: true }, { id: 'd2', name: 'คนขับ B', active: true }],
      bookings: [{
        id: 'BK-0001', patientName: 'ผู้รับบริการ จำลอง', status: 'approved',
        createdAt: '2026-10-26T03:30:00Z', appointmentAt: '2026-10-30T06:10:00Z',
        details: {
          bookingFor: 'self', patientName: 'ผู้รับบริการ จำลอง', contactName: '', phone: '0800000000',
          relationship: '', hospital: 'โรงพยาบาลลำพูน', date: '2026-10-30', time: '13:10',
          assistance: 'เดินได้', extras: [], acknowledged: true, pickup: { x: 50, y: 50, label: 'บ้านเลขที่ 12' },
        },
      }],
    }))
  })
  await page.goto('/dispatcher/assignment?booking=BK-0001')
})

test('mobile taps update both resources and the assignment confirmation', async ({ page }) => {
  const vehicle = page.getByRole('button', { name: /^รถรับส่ง:/ })
  const driver = page.getByRole('button', { name: /^คนขับ:/ })
  await vehicle.tap()
  await expect(page.getByRole('option', { name: /รถคันที่ 02/ })).toBeDisabled()
  await page.getByRole('option', { name: /รถคันที่ 01/ }).tap()
  await expect(vehicle).toContainText('รถคันที่ 01')
  await expect(vehicle).toHaveAttribute('aria-expanded', 'false')
  await driver.tap()
  await page.getByRole('option', { name: /คนขับ B/ }).tap()
  await expect(driver).toContainText('คนขับ B')
  await expect(page.locator('.dispatch-availability')).toContainText('รถและคนขับพร้อมรับงาน')
  await page.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).tap()
  await expect(page.getByRole('dialog')).toContainText('รถคันที่ 01')
  await expect(page.getByRole('dialog')).toContainText('คนขับ B')
})

test('resource pickers retain keyboard selection and close on outside interaction', async ({ page }) => {
  const driver = page.getByRole('button', { name: /^คนขับ:/ })
  await driver.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('option', { name: /คนขับ A/ })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(driver).toContainText('คนขับ B')
  await expect(driver).toBeFocused()
  await driver.tap()
  await page.getByRole('heading', { name: '3. เลือกรถและคนขับ', exact: true }).tap()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await driver.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(driver).toBeFocused()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('listbox')).toHaveCount(0)
})
