import { test, expect, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { emptyCatalog, enterDriver, mockDispatcherLogin } from './helpers/dispatcher'

function fixture() {
  return { id: 'trip', reference: 'BK-driver', status: 'ASSIGNED', revision: 1, executionVersion: 2, patientName: 'ผู้ป่วยเฉพาะงาน', hospitalId: 'hospital', appointmentAt: '2026-11-11T10:00:00+07:00',
    startedAt: null as string | null, driverId: 'driver-id', vehicleId: 'vehicle', contactPhone: '0800000000', pickupAddress: 'จุดรับเฉพาะงาน', latitude: 18.6, longitude: 99.0, mobility: 'wheelchair', originName: 'โรงพยาบาลต้นทางที่ยืนยัน', vehicleName: 'รถทดสอบ',
    assistance: ['boarding_support', 'caregiver_accompanies'], landmark: 'ประตูหน้าจุดรับ',
    incidentOpen: false, resourceHold: false, scheduleReviewRequired: false, proposedSchedule: null,
    schedule: { departureAt: '2026-11-11T08:30:00+07:00', pickupAt: '2026-11-11T09:00:00+07:00', arrivalAt: '2026-11-11T09:40:00+07:00', readyAt: '2026-11-11T10:10:00+07:00', pickupWaitingMinutes: 0, originLocationId: 'origin', originKind: 'previous_hospital' } }
}
async function setup(page: Page, row: ReturnType<typeof fixture>, write: (route: Route) => Promise<void>, extraJobs: ReturnType<typeof fixture>[] = []) {
  await mockDispatcherLogin(page, 'driver')
  await page.route('**/api/catalog', route => route.fulfill({ json: { ...emptyCatalog, hospitals: [{ id: 'hospital', name: 'โรงพยาบาลปลายทาง' }] } }))
  await page.route('**/api/driver/history', route => route.fulfill({ json: { bookings: ['COMPLETED', 'CANCELLED', 'ABORTED'].includes(row.status) ? [{ id: row.id, reference: row.reference, status: row.status, appointmentAt: row.appointmentAt }] : [] } }))
  await page.route('**/api/bookings**', route => {
    expect(route.request().headers().authorization).toBe('Bearer synthetic-token')
    return route.request().method() === 'GET' ? route.fulfill({ json: { bookings: ['COMPLETED', 'CANCELLED', 'ABORTED'].includes(row.status) ? [] : [row, ...extraJobs] } }) : write(route)
  })
  await enterDriver(page, '/driver/details?booking=trip')
}

test('driver completes ordered milestones with separate start and departure and minimized history', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const row = fixture()
  const commands: string[] = []
  await setup(page, row, async route => {
    const body = route.request().postDataJSON()
    expect(body.expectedRevision).toBe(row.revision)
    expect(body.expectedExecutionVersion).toBe(2)
    commands.push(body.command.type)
    if (body.command.type === 'START_TRIP') { row.startedAt = '2026-11-11T08:20:00+07:00'; expect(row.status).toBe('ASSIGNED') }
    else row.status = ({ DEPART_ORIGIN: 'PICKING_UP', CONFIRM_PICKUP: 'PICKED_UP', DEPART_FOR_HOSPITAL: 'IN_TRANSIT', CONFIRM_HANDOVER: 'COMPLETED' } as Record<string, string>)[body.command.type]
    row.revision++
    return route.fulfill({ json: row })
  })
  await expect(page.getByText('ต้นทางที่ยืนยัน: โรงพยาบาลต้นทางที่ยืนยัน')).toBeVisible()
  await expect(page.getByText('ต้องการผู้ช่วยพยุงขึ้น-ลงรถ · มีผู้ดูแลเดินทางไปด้วย', { exact: true })).toBeVisible()
  await expect(page.getByText('จุดรับ • จุดรับเฉพาะงาน · ประตูหน้าจุดรับ', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'เริ่มงาน', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'เริ่มงานแล้ว · ยังไม่ออกจากต้นทาง', exact: true })).toBeVisible()
  expect(row.status).toBe('ASSIGNED')
  for (const name of ['ออกจากต้นทางไปรับผู้ป่วย', 'รับผู้ป่วยขึ้นรถแล้ว', 'ออกเดินทางไปโรงพยาบาล', 'ส่งถึงโรงพยาบาลแล้ว']) {
    await page.getByRole('button', { name, exact: true }).click()
    await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
    await expect(page.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
  }
  await expect(page).toHaveURL(/driver\/history$/)
  await expect(page.getByRole('heading', { name: 'BK-driver' })).toBeVisible()
  await expect(page.getByText('ผู้ป่วยเฉพาะงาน')).toHaveCount(0)
  await expect(page.getByText('จุดรับเฉพาะงาน')).toHaveCount(0)
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0)
  expect(commands).toEqual(['START_TRIP', 'DEPART_ORIGIN', 'CONFIRM_PICKUP', 'DEPART_FOR_HOSPITAL', 'CONFIRM_HANDOVER'])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
})

test('stale execution fails without advancing or losing the confirmation; incident blocks progress', async ({ page }) => {
  const row = { ...fixture(), status: 'PICKING_UP', startedAt: '2026-11-11T08:20:00+07:00' }
  await setup(page, row, route => route.fulfill({ status: 409, json: {} }))
  await page.getByRole('button', { name: 'ดูสถานะงาน', exact: true }).click()
  await page.getByRole('button', { name: 'รับผู้ป่วยขึ้นรถแล้ว', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('ข้อมูลหรือความพร้อมเปลี่ยนแล้ว')
  expect(row.status).toBe('PICKING_UP')
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click()
  row.incidentOpen = true; row.resourceHold = true; row.revision++
  await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' }).click()
  await expect(page.getByRole('button', { name: 'รับผู้ป่วยขึ้นรถแล้ว', exact: true })).toBeDisabled()
})

test('failed pickup reports through API and preserves readiness hold', async ({ page }) => {
  const row = { ...fixture(), status: 'PICKING_UP', startedAt: '2026-11-11T08:20:00+07:00' }
  await setup(page, row, async route => {
    expect(route.request().postDataJSON().command).toEqual({ type: 'FAILED_PICKUP', reason: 'ติดต่อผู้ป่วยไม่ได้' })
    row.status = 'CANCELLED'; row.resourceHold = true; row.revision++
    return route.fulfill({ json: row })
  })
  await page.getByRole('button', { name: 'ดูสถานะงาน', exact: true }).click()
  await page.getByRole('button', { name: 'รับผู้ป่วยไม่ได้', exact: true }).click()
  await page.getByLabel('เหตุผลที่รายงาน').fill('ติดต่อผู้ป่วยไม่ได้')
  await page.getByRole('button', { name: 'ยืนยันรายงานรับไม่ได้' }).click()
  await expect(page).toHaveURL(/driver\/history$/)
  await expect(page.locator('.driver-notice')).toContainText('ทรัพยากรยังไม่พร้อม')
  expect(row.resourceHold).toBe(true)
})

test('driver reports an incident without cancelling the active trip', async ({ page }) => {
  const row = { ...fixture(), status: 'PICKED_UP', startedAt: '2026-11-11T08:20:00+07:00' }
  await setup(page, row, async route => {
    expect(route.request().postDataJSON().command).toEqual({ type: 'REPORT_INCIDENT', reason: 'รถขัดข้องระหว่างรับส่ง' })
    row.incidentOpen = true; row.resourceHold = true; row.revision++
    return route.fulfill({ json: row })
  })
  await page.getByRole('button', { name: 'รายงานเหตุขัดข้อง', exact: true }).click()
  await page.getByLabel('เหตุผลที่รายงาน').fill('รถขัดข้องระหว่างรับส่ง')
  await page.getByRole('button', { name: 'ยืนยันรายงานเหตุขัดข้อง', exact: true }).click()
  await expect(page.getByRole('button', { name: 'ออกเดินทางไปโรงพยาบาล', exact: true })).toBeDisabled()
  expect(row.status).toBe('PICKED_UP')
})

test('a driver cannot start another job while an existing trip is active', async ({ page }) => {
  const row = fixture()
  const active = { ...fixture(), id: 'other-trip', status: 'PICKING_UP', startedAt: '2026-11-11T08:00:00+07:00' }
  let writes = 0
  await setup(page, row, route => { writes++; return route.fulfill({ json: row }) }, [active])
  await expect(page.getByRole('button', { name: 'เริ่มงาน', exact: true })).toBeDisabled()
  await expect(page.getByText(/กรุณาจบงาน other-trip ก่อนเริ่มงานใหม่/)).toBeVisible()
  expect(writes).toBe(0)
})

test('driver read failure and revoked session never select a prototype account', async ({ page }) => {
  const row = fixture()
  await setup(page, row, route => route.fulfill({ json: row }))
  let status = 500
  await page.route('**/api/bookings', route => route.fulfill({ status, json: {} }))
  await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' }).click()
  await expect(page.getByRole('alert')).toContainText('เชื่อมต่อระบบไม่ได้')
  await expect(page.getByText('ผู้ป่วยเฉพาะงาน')).toHaveCount(0)
  status = 401
  await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' }).click()
  await expect(page).toHaveURL(/staff\/login/)
  await expect(page.getByRole('alert')).toContainText('เซสชันหมดอายุ')
})
