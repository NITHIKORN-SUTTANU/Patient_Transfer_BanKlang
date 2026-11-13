import { test, expect, type Page, type Route } from '@playwright/test'
import { emptyCatalog, enterDispatcher, mockDispatcherLogin } from './helpers/dispatcher'
import AxeBuilder from '@axe-core/playwright'

const schedule = { departureAt: '2026-12-01T01:00:00Z', pickupAt: '2026-12-01T01:30:00Z', arrivalAt: '2026-12-01T02:40:00Z', readyAt: '2026-12-01T03:10:00Z', pickupWaitingMinutes: 0, originLocationId: 'depot', originKind: 'depot' }
function requestRow() {
  return { id: 'booking-id', reference: 'BK-test', status: 'REQUESTED', revision: 1, executionVersion: 0, startedAt: null as string | null, patientName: 'ผู้ป่วยทดสอบ', appointmentAt: '2026-12-01T03:00:00Z', hospitalId: 'hospital', contactPhone: '0800000000', pickupAddress: 'จุดรับทดสอบ', latitude: 18.6, longitude: 99.0, mobility: 'wheelchair', vehicleId: null as string | null, driverId: null as string | null, incidentOpen: false, resourceHold: false, scheduleReviewRequired: false, schedule: null as typeof schedule | null, proposedSchedule: null as (typeof schedule & { vehicleId: string; driverId: string }) | null }
}

async function operationFixture(page: Page, row: ReturnType<typeof requestRow>, write: (route: Route) => Promise<void>) {
  await mockDispatcherLogin(page)
  await page.route('**/api/catalog', route => route.fulfill({ json: { ...emptyCatalog,
    hospitals: [{ id: 'hospital', name: 'โรงพยาบาลทดสอบ', location_id: 'hospital-location' }],
    vehicles: [{ id: 'vehicle', name: 'รถทดสอบ', plate: 'กข 1234', active: true, held: row.resourceHold }],
    drivers: [{ id: 'driver', name: 'คนขับทดสอบ', active: true, held: row.resourceHold }],
    locations: [{ id: 'depot', name: 'ศูนย์รถ', kind: 'depot' }, { id: 'hospital-location', name: 'โรงพยาบาลทดสอบ', kind: 'hospital' }], depotLocationId: 'depot',
  } }))
  await page.route('**/api/bookings**', route => route.request().method() === 'GET' ? route.fulfill({ json: { bookings: [row] } }) : write(route))
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
  await enterDispatcher(page, '/dispatcher/tracking')
}
test('dispatcher reviews, schedules and assigns through API without prototype data', async ({ page }) => {
  const row = requestRow()
  let conflict = false
  let routingDown = true
  const mutations: string[] = []
  await mockDispatcherLogin(page)
  await page.route('**/api/catalog', route => route.fulfill({ json: { ...emptyCatalog, hospitals: [{ id: 'hospital', name: 'โรงพยาบาลทดสอบ' }], vehicles: [{ id: 'vehicle', name: 'รถทดสอบ', plate: 'กข 1234', active: true, held: false }], drivers: [{ id: 'driver', name: 'คนขับทดสอบ', active: true, held: false }], locations: [{ id: 'depot', name: 'ศูนย์รถ', kind: 'depot' }], depotLocationId: 'depot' } }))
  await page.route('**/api/bookings**', async route => {
    expect(route.request().headers().authorization).toBe('Bearer synthetic-token')
    if (route.request().method() === 'GET') return route.fulfill({ json: { bookings: [row] } })
    const body = route.request().postDataJSON()
    expect(body.expectedRevision).toBe(row.revision)
    expect(body.eventId).toMatch(/^[a-f0-9-]{36}$/)
    const endpoint = route.request().url().split('/').pop()!
    if (conflict) return route.fulfill({ status: 409, json: { error: 'Changed' } })
    if (endpoint === 'schedule' && routingDown) return route.fulfill({ status: 503, json: { error: 'Routing unavailable' } })
    mutations.push(endpoint)
    if (endpoint === 'commands') { expect(body.command).toEqual({ type: 'APPROVE' }); row.status = 'APPROVED' }
    if (endpoint === 'schedule') { expect(body).not.toHaveProperty('originToPickup'); row.status = 'SCHEDULED'; row.proposedSchedule = { ...schedule, vehicleId: 'vehicle', driverId: 'driver' } }
    if (endpoint === 'assignment') { expect(row.status).toBe('SCHEDULED'); row.status = 'ASSIGNED'; row.vehicleId = 'vehicle'; row.driverId = 'driver'; row.schedule = schedule }
    row.revision++
    return route.fulfill({ json: row })
  })
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
  await enterDispatcher(page)
  await page.getByRole('button', { name: 'ดูรายละเอียด →', exact: true }).click()
  await page.getByRole('button', { name: 'อนุมัติคำขอ', exact: true }).click()
  conflict = true
  await page.getByRole('button', { name: 'ยืนยันอนุมัติ', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('ข้อมูลหรือความพร้อมเปลี่ยนแล้ว')
  expect(row.status).toBe('REQUESTED')
  conflict = false
  await page.getByRole('button', { name: 'ยืนยันอนุมัติ', exact: true }).click()
  await expect(page.locator('.dispatch-notice')).toContainText('อนุมัติคำขอ')
  await page.getByRole('link', { name: 'จัดตารางและมอบหมาย', exact: true }).click()
  await page.getByRole('button', { name: 'รถรับส่ง: เลือกรถ', exact: true }).click()
  await page.getByRole('option', { name: /รถทดสอบ/ }).click()
  await page.getByRole('button', { name: 'คนขับ: เลือกคนขับ', exact: true }).click()
  await page.getByRole('option', { name: /คนขับทดสอบ/ }).click()
  await page.getByRole('button', { name: 'ตรวจสอบและยืนยันตาราง', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันตาราง', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('บริการคำนวณเส้นทางยังไม่พร้อม')
  expect(row.status).toBe('APPROVED')
  routingDown = false
  await page.getByRole('button', { name: 'ยืนยันตาราง', exact: true }).click()
  await expect(page.getByText('ยืนยันตารางแล้ว ยังไม่จองรถหรือคนขับจนกว่าจะยืนยันการมอบหมาย')).toBeVisible()
  await page.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันการมอบหมาย', exact: true }).click()
  await expect(page).toHaveURL(/dispatcher\/tracking$/)
  await expect(page.getByRole('cell', { name: 'มอบหมายแล้ว', exact: true })).toBeVisible()
  expect(mutations).toEqual(['commands', 'schedule', 'assignment'])
})

test('dispatcher access requires verified role and never falls back to demo bookings', async ({ page }) => {
  let calls = 0
  await mockDispatcherLogin(page, 'admin')
  await page.route('**/api/bookings', route => { calls++; return route.fulfill({ json: { bookings: [] } }) })
  await page.goto('/dispatcher/tracking')
  await expect(page).toHaveURL(/staff\/login/)
  await page.getByLabel('ชื่อผู้ใช้').fill('admin')
  await page.getByLabel('รหัสผ่าน').fill('synthetic-password')
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'เจ้าหน้าที่ทดสอบ', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'เปิดหน้าจัดรถ' })).toHaveCount(0)
  // Navigate inside this document to retain the in-memory session.
  await page.evaluate(() => { history.pushState({}, '', '/dispatcher'); dispatchEvent(new PopStateEvent('popstate')) })
  await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงหน้านี้' })).toBeVisible()
  expect(calls).toBe(0)
})

test('rejection requires a reason and retains it after a stale response', async ({ page }) => {
  const row = requestRow()
  let reject = true
  let writes = 0
  await mockDispatcherLogin(page)
  await page.route('**/api/catalog', route => route.fulfill({ json: emptyCatalog }))
  await page.route('**/api/bookings**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { bookings: [row] } })
    writes++
    expect(route.request().postDataJSON().command).toEqual({ type: 'REJECT', reason: 'ข้อมูลคำขอไม่ถูกต้องหลังตรวจสอบแล้ว',rejectionKind:'other' })
    if (reject) return route.fulfill({ status: 409, json: {} })
    row.status = 'REJECTED'; row.revision++
    return route.fulfill({ json: row })
  })
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
  await enterDispatcher(page)
  await page.getByRole('button', { name: 'ดูรายละเอียด →', exact: true }).click()
  await page.getByRole('button', { name: 'ปฏิเสธคำขอ', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันปฏิเสธคำขอ', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('กรุณาระบุเหตุผล')
  expect(writes).toBe(0)
  const reason = page.getByRole('textbox', { name: 'เหตุผลการปฏิเสธ' })
  await reason.fill('ข้อมูลคำขอไม่ถูกต้องหลังตรวจสอบแล้ว')
  await page.getByRole('button', { name: 'ยืนยันปฏิเสธคำขอ', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('ข้อมูลหรือความพร้อมเปลี่ยนแล้ว')
  await expect(reason).toHaveValue('ข้อมูลคำขอไม่ถูกต้องหลังตรวจสอบแล้ว')
  reject = false
  await page.getByRole('button', { name: 'ยืนยันปฏิเสธคำขอ', exact: true }).click()
  await expect(page.locator('.dispatch-notice')).toContainText('ปฏิเสธคำขอ')
})

test('read failure shows no prototype bookings and a revoked session returns to login', async ({ page }) => {
  await mockDispatcherLogin(page)
  await page.route('**/api/catalog', route => route.fulfill({ json: emptyCatalog }))
  let status = 500
  await page.route('**/api/bookings', route => route.fulfill({ status, json: {} }))
  await enterDispatcher(page)
  await expect(page.getByRole('alert')).toContainText('เชื่อมต่อระบบไม่ได้')
  await expect(page.getByRole('button', { name: 'ดูรายละเอียด →', exact: true })).toHaveCount(0)
  status = 401
  await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' }).click()
  await expect(page).toHaveURL(/staff\/login/)
  await expect(page.getByRole('alert')).toContainText('เซสชันหมดอายุ')
})

test('after-start modification requires verified handoff and preserves input on conflict', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const row = { ...requestRow(), status: 'ASSIGNED', vehicleId: 'vehicle', driverId: 'driver', startedAt: '2026-11-11T01:00:00Z', schedule: { ...schedule }, resourceHold: true }
  let conflict = true
  await operationFixture(page, row, async route => {
    const body = route.request().postDataJSON()
    expect(route.request().url()).toMatch(/\/modification$/)
    expect(body.expectedRevision).toBe(row.revision)
    expect(body.reason).toBe('เปลี่ยนเวลารับตามที่ตรวจสอบ')
    expect(body.originKind).toBe('handoff')
    expect(body.arrangement.locationId).toBe('depot')
    expect(body.arrangement.note).toBe('ยืนยันรถและคนขับอยู่ที่จุดรับช่วงแล้ว')
    expect(Date.now() - Date.parse(body.arrangement.confirmedAt)).toBeLessThan(300000)
    if (conflict) return route.fulfill({ status: 409, json: {} })
    row.revision++; row.startedAt = ''
    return route.fulfill({ json: row })
  })
  await page.getByRole('button', { name: 'ดูสถานะ →', exact: true }).click()
  await page.getByRole('combobox', { name: 'การดำเนินการ', exact: true }).selectOption('modify')
  const start = page.getByRole('button', { name: 'ตรวจสอบและยืนยันการเปลี่ยนแปลง', exact: true })
  await expect(start).toBeDisabled()
  await page.getByLabel('เหตุผลการเปลี่ยนแปลง').fill('เปลี่ยนเวลารับตามที่ตรวจสอบ')
  await page.getByLabel('การยืนยันต้นทางและการรับช่วง', { exact: true }).fill('ยืนยันรถและคนขับอยู่ที่จุดรับช่วงแล้ว')
  await page.getByRole('checkbox', { name: 'ยืนยันตำแหน่งและแผนรับช่วงจริงแล้ว (ต้องยืนยันภายใน 5 นาที)' }).check()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(accessibility.violations).toEqual([])
  await page.screenshot({ path: 'test-results/dispatcher-modification-mobile.png' })
  await start.click()
  const confirm = page.getByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง', exact: true })
  await confirm.click()
  await expect(page.getByRole('alert').filter({ hasText: 'ข้อมูลหรือความพร้อมเปลี่ยนแล้ว' })).toBeVisible()
  expect(row.schedule).toEqual(schedule)
  conflict = false
  await confirm.click()
  await expect(page.locator('.dispatch-notice')).toContainText('บันทึกการดำเนินการแล้ว')
})

test('incident and ABORTED preserve holds; resource readiness requires position and server acceptance', async ({ page }) => {
  const row = { ...requestRow(), status: 'PICKED_UP', vehicleId: 'vehicle', driverId: 'driver', startedAt: '2026-11-11T01:00:00Z', schedule: { ...schedule } as typeof schedule | null }
  const commands: string[] = []
  await operationFixture(page, row, async route => {
    const body = route.request().postDataJSON()
    expect(body.expectedRevision).toBe(row.revision)
    commands.push(body.command.type)
    if (body.command.type === 'REPORT_INCIDENT') { row.incidentOpen = true; row.resourceHold = true }
    if (body.command.type === 'ABORT') {
      expect(body.command.endedAt).toBe('2026-11-11T02:00:00.000Z')
      expect(body.command.location).toBe('จุดส่งมอบที่ยืนยัน')
      expect(body.command.disposition).toBe('ผู้ดูแลรับช่วงต่อแล้ว')
      row.status = 'ABORTED'; row.schedule = null
    }
    row.revision++
    return route.fulfill({ json: row })
  })
  async function openAction(action: string) {
    await page.getByRole('button', { name: 'ดูสถานะ →', exact: true }).click()
    await page.getByRole('combobox', { name: 'การดำเนินการ', exact: true }).selectOption(action)
  }
  await openAction('REPORT_INCIDENT')
  await page.getByLabel('เหตุผล', { exact: true }).fill('รถขัดข้องหลังรับผู้ป่วย')
  await page.getByLabel('ตรวจสอบสถานการณ์จริงและยืนยันการดำเนินการนี้แล้ว').check()
  await page.getByRole('button', { name: 'ยืนยันการดำเนินการ', exact: true }).click()
  await expect(page.locator('.dispatch-notice')).toBeVisible()
  await openAction('ABORT')
  await expect(page.getByRole('combobox', { name: 'การดำเนินการ', exact: true }).locator('option[value="modify"]')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'การดำเนินการ', exact: true }).locator('option[value="CORRECT_MILESTONE"]')).toHaveCount(0)
  await page.getByLabel('เหตุผล', { exact: true }).fill('ไม่สามารถเดินทางต่อได้')
  await page.getByLabel('เวลาจบการเดินทางจริง (เวลาไทย)').fill('2026-11-11T09:00')
  await page.getByLabel('สถานที่จบการเดินทาง').fill('จุดส่งมอบที่ยืนยัน')
  await page.getByLabel('การส่งมอบผู้ป่วยหรือแผนรับช่วงต่อ').fill('ผู้ดูแลรับช่วงต่อแล้ว')
  await page.getByLabel('ตรวจสอบสถานการณ์จริงและยืนยันการดำเนินการนี้แล้ว').check()
  await page.getByRole('button', { name: 'ยืนยันการดำเนินการ', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'ยุติการเดินทางโดยไม่ส่งถึงโรงพยาบาล', exact: true })).toBeVisible()
  expect(row.resourceHold).toBe(true)
  let blocked = true
  await page.route('**/api/resources/**/readiness', route => {
    expect(route.request().postDataJSON()).toEqual({ locationId: 'depot', reason: 'ตรวจสอบรถและตำแหน่งแล้ว' })
    return route.fulfill({ status: blocked ? 409 : 200, json: {} })
  })
  await page.getByText('ยืนยันตำแหน่งและความพร้อมรถหรือคนขับ', { exact: true }).click()
  await page.getByLabel('ทรัพยากรที่ตรวจสอบ').selectOption('vehicles/vehicle')
  await page.getByLabel('ตำแหน่งปัจจุบันที่ยืนยันแล้ว').selectOption('depot')
  await page.getByLabel('เหตุผลและผลตรวจสอบ').fill('ตรวจสอบรถและตำแหน่งแล้ว')
  await page.getByLabel('ยืนยันตำแหน่งจริงและความพร้อมของทรัพยากรนี้แล้ว').check()
  await page.getByRole('button', { name: 'ยืนยันความพร้อมทรัพยากรนี้' }).click()
  await expect(page.getByRole('alert')).toContainText('ข้อมูลหรือความพร้อมเปลี่ยนแล้ว')
  blocked = false
  await page.getByRole('button', { name: 'ยืนยันความพร้อมทรัพยากรนี้' }).click()
  await expect(page.locator('.dispatch-notice')).toContainText('ยืนยันความพร้อมทรัพยากรแล้ว')
  expect(commands).toEqual(['REPORT_INCIDENT', 'ABORT'])
})

test('incident resolution precedes a safe milestone correction with physical confirmation', async ({ page }) => {
  const row = { ...requestRow(), status: 'IN_TRANSIT', vehicleId: 'vehicle', driverId: 'driver', startedAt: '2026-11-11T01:00:00Z', schedule: { ...schedule }, incidentOpen: true, resourceHold: true }
  await operationFixture(page, row, async route => {
    const body = route.request().postDataJSON()
    if (body.command.type === 'RESOLVE_INCIDENT') {
      expect(body.command.reason).toBe('แก้ไขเหตุขัดข้องและตรวจความพร้อมแล้ว')
      row.incidentOpen = false; row.resourceHold = false; row.revision++
      return route.fulfill({ json: row })
    }
    expect(body.command).toEqual({ type: 'CORRECT_MILESTONE', reason: 'ยังไม่ได้ออกจากจุดรับจริง', target: 'PICKED_UP', physicalStateConfirmed: true })
    row.status = 'PICKED_UP'; row.revision++
    return route.fulfill({ json: row })
  })
  await page.getByRole('button', { name: 'ดูสถานะ →', exact: true }).click()
  await page.getByRole('combobox', { name: 'การดำเนินการ', exact: true }).selectOption('RESOLVE_INCIDENT')
  await page.getByLabel('เหตุผล', { exact: true }).fill('แก้ไขเหตุขัดข้องและตรวจความพร้อมแล้ว')
  await page.getByLabel('ตรวจสอบสถานการณ์จริงและยืนยันการดำเนินการนี้แล้ว').check()
  await page.getByRole('button', { name: 'ยืนยันการดำเนินการ' }).click()
  await expect(page.locator('.dispatch-notice')).toContainText('บันทึกการดำเนินการแล้ว')
  await page.getByRole('button', { name: 'ดูสถานะ →', exact: true }).click()
  await page.getByRole('combobox', { name: 'การดำเนินการ', exact: true }).selectOption('CORRECT_MILESTONE')
  await page.getByLabel('เหตุผล', { exact: true }).fill('ยังไม่ได้ออกจากจุดรับจริง')
  await expect(page.getByRole('button', { name: 'ยืนยันการดำเนินการ' })).toBeDisabled()
  await page.getByLabel('ตรวจสอบสถานการณ์จริงและยืนยันการดำเนินการนี้แล้ว').check()
  await page.getByRole('button', { name: 'ยืนยันการดำเนินการ' }).click()
  await expect(page.getByRole('cell', { name: 'รับผู้ป่วยขึ้นรถแล้ว', exact: true })).toBeVisible()
})
