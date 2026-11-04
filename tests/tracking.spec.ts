import { expect, test } from '@playwright/test'

test('dashboard separates review requests from assignment jobs and sorts each by appointment', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const bookings = [
      { id: 'later-day', status: 'pending', appointmentAt: '2026-11-06T01:00:00Z' },
      { id: 'later-time', status: 'approved', appointmentAt: '2026-11-05T05:00:00Z' },
      { id: 'earlier-approved', status: 'approved', appointmentAt: '2026-11-05T01:00:00Z' },
      { id: 'earliest', status: 'pending', appointmentAt: '2026-11-05T01:00:00Z' },
      { id: 'finished', status: 'completed', appointmentAt: '2026-11-04T01:00:00Z' },
    ].map(b => ({ ...b, patientName: 'Test patient' }))
    localStorage.setItem('ban-klang-transit:demo:v1', JSON.stringify({ version: 1, selectedActor: 'ACT-02', bookings, vehicles: [], drivers: [] }))
  })
  await page.goto('/dispatcher')
  await expect(page.locator('#dispatch-queue tbody th .service-cell-content > span:first-child')).toHaveText(['earliest', 'later-day'])
  await expect(page.locator('#dispatch-assignment-queue tbody th .service-cell-content > span:first-child')).toHaveText(['earlier-approved', 'later-time'])
  await expect(page.locator('#dispatch-queue .dispatch-queue-count')).toHaveText('2 รายการ')
  await expect(page.locator('#dispatch-assignment-queue .dispatch-queue-count')).toHaveText('2 รายการ')
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const left = (await page.locator('#dispatch-queue').boundingBox())!
    const right = (await page.locator('#dispatch-assignment-queue').boundingBox())!
    if (width === 1440) { expect(right.x).toBeGreaterThan(left.x); expect(right.y).toBe(left.y) }
    else expect(right.y).toBeGreaterThanOrEqual(left.y + left.height)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({ path: `test-results/dashboard-split-${width}.png`, fullPage: true })
  }
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
  await expect(cancelled).toContainText('ยกเลิกแล้ว')
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
  await expect(page.getByRole('row').filter({ hasText: 'waiting-early' }).locator('.dispatch-status-badge')).toContainText('รอเริ่มเดินทาง')
  await expect(page.getByRole('row').filter({ hasText: 'Patient done' }).locator('.dispatch-status-badge')).toContainText('ส่งถึงโรงพยาบาลแล้ว')
  for (const [stage, label] of [
    ['going_to_pickup', 'กำลังไปรับผู้ป่วย'],
    ['patient_onboard', 'รับผู้ป่วยขึ้นรถแล้ว'],
    ['going_to_hospital', 'กำลังเดินทางไปโรงพยาบาล'],
  ]) {
    await page.evaluate(stage => {
      const key = 'ban-klang-transit:demo:v1'
      const state = JSON.parse(localStorage.getItem(key)!)
      state.bookings.find((b: { id: string }) => b.id === 'active').driverProgress = { stage, events: [{ stage, at: '2026-11-04T00:00:00Z' }] }
      localStorage.setItem(key, JSON.stringify(state))
    }, stage)
    await page.reload()
    const active = page.getByRole('row').filter({ hasText: 'Patient active' })
    await expect(active.locator('.dispatch-status-badge')).toContainText(label)
  }
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
