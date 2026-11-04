import { expect, test } from '@playwright/test'

test('dashboard queue sorts appointment dates and times ascending across statuses', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const bookings = [
      { id: 'later-day', status: 'pending', appointmentAt: '2026-11-06T01:00:00Z' },
      { id: 'later-time', status: 'approved', appointmentAt: '2026-11-05T05:00:00Z' },
      { id: 'earliest', status: 'pending', appointmentAt: '2026-11-05T01:00:00Z' },
      { id: 'finished', status: 'completed', appointmentAt: '2026-11-04T01:00:00Z' },
    ].map(b => ({ ...b, patientName: 'Test patient' }))
    localStorage.setItem('ban-klang-transit:demo:v1', JSON.stringify({ version: 1, selectedActor: 'ACT-02', bookings, vehicles: [], drivers: [] }))
  })
  await page.goto('/dispatcher')
  await expect(page.locator('#dispatch-queue tbody th')).toHaveText(['earliest', 'later-time', 'later-day'])
})

test('tracking opens on all jobs, prioritizes Bangkok today, and filters dates', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-03T18:00:00Z'))
  await page.goto('/')
  await page.evaluate(() => {
    const jobs = [
      ['future', 'approved', '2026-11-05T01:00:00Z'],
      ['done', 'completed', '2026-11-04T01:00:00Z'],
      ['waiting-late', 'approved', '2026-11-04T03:00:00Z'],
      ['waiting-early', 'approved', '2026-11-04T02:00:00Z'],
      ['active', 'in_transit', '2026-11-04T04:00:00Z'],
      ['past', 'cancelled', '2026-11-03T01:00:00Z'],
    ].map(([id, status, pickupAt]) => ({
      id, status, patientName: `Patient ${id}`, vehicleId: 'v', driverId: 'd',
      appointmentAt: new Date(Date.parse(pickupAt) + 55 * 60000).toISOString(),
      schedule: { pickupAt, departureAt: new Date(Date.parse(pickupAt) - 30 * 60000).toISOString(), arrivalAt: new Date(Date.parse(pickupAt) + 35 * 60000).toISOString(), endsAt: new Date(Date.parse(pickupAt) + 55 * 60000).toISOString(), centerToPickupMinutes: 30, pickupToHospitalMinutes: 35, preparationMinutes: 20, calculation: 'demo-manual-v1' },
    }))
    localStorage.setItem('ban-klang-transit:demo:v1', JSON.stringify({ version: 1, selectedActor: 'ACT-02', bookings: jobs, vehicles: [{ id: 'v', label: 'Vehicle', active: true }], drivers: [{ id: 'd', name: 'Driver', active: true }] }))
  })
  await page.goto('/dispatcher/tracking')
  const ids = page.locator('tbody th')
  const cancelled = page.locator('.dispatch-status-badge.cancelled')
  await expect(cancelled).toHaveText('ยกเลิกแล้ว')
  await expect(cancelled).toHaveCSS('background-color', 'rgb(255, 240, 241)')
  await expect(cancelled).toHaveCSS('color', await page.locator('main').evaluate(el => getComputedStyle(el).getPropertyValue('--color-error').trim()).then(hex => {
    const value = hex.replace('#', '')
    return `rgb(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)})`
  }))
  await expect(page.getByRole('button', { name: 'ทั้งหมด', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: 'ช่วงเวลาของงานรับส่ง' }).getByRole('button')).toHaveCount(2)
  await expect(page.locator('.dispatch-tracking-day')).toHaveCount(0)
  await expect(page.locator('.dispatch-tracking-metrics article').first()).toContainText('4 พ.ย. 2569')
  await expect(ids).toHaveText(['activePatient active', 'waiting-earlyPatient waiting-early', 'waiting-latePatient waiting-late', 'donePatient done', 'pastPatient past', 'futurePatient future'])
  await page.getByLabel('วันรับผู้ป่วย', { exact: true }).fill('2026-11-03')
  await expect(ids).toHaveText(['pastPatient past'])
  await page.getByRole('button', { name: 'วันนี้', exact: true }).click()
  await expect(ids).toHaveCount(4)
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const headers = page.locator('.service-table thead th')
    await expect(headers.first()).toHaveCSS('border-top-left-radius', '15px')
    await expect(headers.last()).toHaveCSS('border-top-right-radius', '15px')
    if (width === 1440) {
      for (const header of await headers.all()) {
        expect(await header.evaluate(cell => cell.scrollWidth <= cell.clientWidth)).toBe(true)
      }
      await page.screenshot({ path: 'test-results/tracking-header-desktop.png', fullPage: true })
    }
  }
  await page.screenshot({ path: 'test-results/tracking-today-mobile.png', fullPage: true })
})
