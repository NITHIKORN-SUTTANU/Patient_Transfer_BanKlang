import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { enterAdmin, enterDispatcher, mockDispatcherLogin } from './helpers/dispatcher'

async function setup(page: Page) {
  await mockDispatcherLogin(page, 'admin')
  const accounts = [{ id: 'managed', name: 'เจ้าหน้าที่จากระบบ', username: 'managed', role: 'dispatcher', active: true, revision: 1 }]
  const calls: string[] = []
  const writes: Record<string, unknown>[] = []
  const controls = { failWrite: false, failRead: false, revoked: false, pending: false, release: null as (() => void) | null }
  await page.route('**/api/catalog', route => route.fulfill({ json: { vehicles: [], drivers: [], villages: [], hospitals: [], locations: [],
    settings: { center: 'ศูนย์รถจากระบบ', latitude: 18.59, longitude: 99.05, opensAt: '06:00', closesAt: '16:00' } } }))
  await page.route('**/api/bookings', route => route.fulfill({ json: { bookings: [] } }))
  await page.route('**/api/admin/**', async route => {
    calls.push(route.request().url())
    expect(route.request().headers().authorization).toBe('Bearer synthetic-token')
    if (controls.revoked) return route.fulfill({ status: 401, json: { error: 'Revoked' } })
    if (controls.failRead && route.request().method() === 'GET') return route.fulfill({ status: 503, json: { error: 'Unavailable' } })
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); writes.push(body)
      if (controls.pending) await new Promise<void>(resolve => { controls.release = resolve })
      if (controls.failWrite) return route.fulfill({ status: 409, json: { error: 'Stale' } })
      const result = { ...body, id: path.endsWith('/accounts') ? 'created' : 'managed', revision: path.endsWith('/accounts') ? 1 : 2 }
      if (result.id === 'created') accounts.push(result)
      else Object.assign(accounts[0], result)
      return route.fulfill({ status: result.id === 'created' ? 201 : 200, json: result })
    }
    if (path.endsWith('/notification-failures')) return route.fulfill({json:{failures:[],total:0,pending:0,nextCursor:null,service:{configured:false,deliveryEnabled:false}}})
    if (path.endsWith('/service-data')) return route.fulfill({ json: { hospitals: [], villages: [], closures: [], pendingReviewCount: 0, settings: { name: 'ศูนย์รถจากระบบ', latitude: 18.59, longitude: 99.05, revision: 3 } } })
    if (path.endsWith('/accounts')) return route.fulfill({ json: { accounts } })
    if (path.endsWith('/summary')) return route.fulfill({ json: { statuses: [{ status: 'COMPLETED', count: 4 }, { status: 'ABORTED', count: 1 }] } })
    return route.fulfill({ json: { events: [] } })
  })
  return { accounts, controls, calls, writes }
}

test('admin creates a staff account only after server commitment; pending dialog cannot be dismissed', async ({ page }) => {
  const fixture = await setup(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await enterAdmin(page, '/admin/accounts')
  await expect(page.getByText('เจ้าหน้าที่จากระบบ', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '+ เพิ่มบัญชี', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('ชื่อ–นามสกุล', { exact: true }).fill('เจ้าหน้าที่ใหม่')
  await dialog.getByLabel('ชื่อผู้ใช้งาน', { exact: true }).fill('new-staff')
  await dialog.getByLabel('รหัสผ่านเริ่มต้น', { exact: true }).fill('Synthetic-New-Password-123')
  await dialog.getByLabel('เหตุผลในการเปลี่ยนแปลง', { exact: true }).fill('เพิ่มเจ้าหน้าที่ทดสอบ')
  fixture.controls.pending = true
  await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'กำลังบันทึก…', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(page.getByText('บันทึกข้อมูลและกิจกรรมแล้ว', { exact: true })).toHaveCount(0)
  await expect.poll(() => fixture.writes.length).toBe(1)
  fixture.controls.pending = false; fixture.controls.release!()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('เจ้าหน้าที่ใหม่', { exact: false })).toBeVisible()
  expect(fixture.writes[0]).toMatchObject({ role: 'dispatcher', active: true, reason: 'เพิ่มเจ้าหน้าที่ทดสอบ' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
})

test('stale account change preserves input and confirms session revocation before mutation', async ({ page }) => {
  const fixture = await setup(page)
  await enterAdmin(page, '/admin/accounts')
  await page.getByRole('button', { name: 'จัดการบัญชี', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('ชื่อ–นามสกุล', { exact: true }).fill('ชื่อที่ยังไม่บันทึก')
  await dialog.getByRole('combobox', { name: 'สถานะบัญชี', exact: true }).selectOption('false')
  await dialog.getByLabel('เหตุผลในการเปลี่ยนแปลง', { exact: true }).fill('เหตุผลที่ต้องคงไว้')
  await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click()
  await expect(dialog.getByText(/กดบันทึกอีกครั้งเพื่อยืนยัน/)).toBeVisible()
  expect(fixture.writes).toEqual([])
  fixture.controls.failWrite = true
  await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('ข้อมูลเปลี่ยน')
  await expect(dialog.getByLabel('ชื่อ–นามสกุล', { exact: true })).toHaveValue('ชื่อที่ยังไม่บันทึก')
  await expect(dialog.getByLabel('เหตุผลในการเปลี่ยนแปลง', { exact: true })).toHaveValue('เหตุผลที่ต้องคงไว้')
  expect(fixture.writes[0].expectedRevision).toBe(1)
  expect(fixture.writes[0]).not.toHaveProperty('password')
})

test('admin history and settings exclude demo patient records', async ({ page }) => {
  const fixture = await setup(page)
  await page.addInitScript(() => localStorage.setItem('ban-klang-transit:demo:v1', JSON.stringify({ version: 1, selectedActor: 'admin', vehicles: [], drivers: [], bookings: [{ id: 'PRIVATE', patientName: 'ผู้ป่วยลับในเดโม', appointmentAt: '2030-01-15T10:00:00+07:00', status: 'completed' }] })))
  await enterAdmin(page, '/admin/history')
  await expect(page.getByRole('heading', { name: 'ประวัติการเดินรถแบบสรุป', exact: true })).toBeVisible()
  await expect(page.getByText('ผู้ป่วยลับในเดโม')).toHaveCount(0)
  await expect(page.getByText('PRIVATE', { exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: 'การตั้งค่าระบบ', exact: true }).click()
  await page.getByRole('button', { name: 'จัดการศูนย์รถ', exact: true }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByLabel('ชื่อ', { exact: true })).toHaveValue('ศูนย์รถจากระบบ')
  await page.getByRole('dialog').getByRole('button', { name: 'ยกเลิก', exact: true }).click()
  expect(fixture.writes).toEqual([])
  expect(fixture.calls.every(url => !url.includes('/bookings'))).toBe(true)
})

async function resources(page: Page) {
  const fixture = await setup(page)
  const catalog = { vehicles: [{ id: 'vehicle', name: 'รถจากระบบ', plate: 'TEST-01', vehicleType: 'รถรับส่งทั่วไป', active: true, capabilities: ['standard', 'wheelchair'], revision: 4, locationId: 'depot', availableAt: '2030-01-12T00:00:00Z', held: true }], drivers: [], villages: [], hospitals: [], locations: [{ id: 'depot', name: 'ศูนย์รถทดสอบ', kind: 'depot' }], settings: null }
  const windows = [{ id: 'window', vehicleId: 'vehicle', driverId: null, startsAt: '2030-01-14T23:00:00Z', endsAt: '2030-01-15T09:00:00Z', revision: 1, retiredAt: null as string | null }]
  await page.route('**/api/catalog', route => route.fulfill({ json: catalog }))
  await page.route('**/api/admin/resources/**', route => {
    const body = route.request().postDataJSON(); fixture.writes.push(body)
    if (fixture.controls.failWrite) return route.fulfill({ status: 409, json: { error: 'Busy', details: { code: 'RESOURCE_UNFINISHED_WORK' } } })
    if (route.request().url().endsWith('/vehicles')) {
      const created = { ...catalog.vehicles[0], ...body, id: 'created-vehicle', revision: 1, held: false }
      catalog.vehicles.push(created)
      return route.fulfill({ status: 201, json: created })
    }
    Object.assign(catalog.vehicles[0], body, { revision: 5 })
    return route.fulfill({ json: catalog.vehicles[0] })
  })
  await page.route('**/api/admin/availability**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { windows: windows.filter(window => !window.retiredAt) } })
    const body = route.request().postDataJSON(); fixture.writes.push(body)
    if (fixture.controls.failWrite) return route.fulfill({ status: 409, json: { error: 'Required', details: { code: 'ASSIGNMENT_WINDOW_REQUIRED' } } })
    Object.assign(windows[0], body, { revision: windows[0].revision + 1, ...(route.request().url().endsWith('/retire') ? { retiredAt: '2030-01-12T00:00:00Z' } : {}) })
    catalog.vehicles[0].revision++
    return route.fulfill({ json: { ...windows[0], resourceRevision: catalog.vehicles[0].revision } })
  })
  return { ...fixture, catalog, windows }
}

test('resource edit preserves positions and holds and keeps failed changes for review', async ({ page }) => {
  const fixture = await resources(page)
  await enterAdmin(page, '/admin/vehicles')
  await page.getByRole('button', { name: 'จัดการรถ', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('ชื่อรถ', { exact: true }).fill('ชื่อรถที่แก้ไข')
  await dialog.getByLabel('เหตุผลในการเปลี่ยนแปลง', { exact: true }).fill('ตรวจสอบทะเบียนแล้ว')
  fixture.controls.failWrite = true
  await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('งานที่ยังไม่เสร็จ')
  await expect(dialog.getByLabel('ชื่อรถ', { exact: true })).toHaveValue('ชื่อรถที่แก้ไข')
  expect(fixture.writes[0].expectedRevision).toBe(4)
  expect(fixture.writes[0]).not.toHaveProperty('locationId')
  expect(fixture.writes[0]).not.toHaveProperty('availableAt')
  fixture.controls.failWrite = false
  await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(fixture.catalog.vehicles[0].held).toBe(true)
  await expect(page.getByText(/ชื่อรถที่แก้ไข · TEST-01/)).toBeVisible()
})

test('new vehicle requires initial physical state and does not invent working windows', async ({ page }) => {
  const fixture = await resources(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await enterAdmin(page, '/admin/vehicles')
  await page.getByRole('button', { name: '+ เพิ่มรถ', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('ชื่อรถ', { exact: true }).fill('รถใหม่ทดสอบ')
  await dialog.getByLabel('ทะเบียนรถ', { exact: true }).fill('TEST-NEW')
  await dialog.getByLabel('ประเภทรถ', { exact: true }).fill('รถรับส่งทั่วไป')
  await dialog.getByRole('combobox', { name: 'ตำแหน่งเริ่มต้นที่ตรวจสอบแล้ว', exact: true }).selectOption('depot')
  await dialog.getByLabel('พร้อมตั้งแต่ (เวลาไทย)', { exact: true }).fill('2030-01-12T08:00')
  await dialog.getByLabel('เหตุผลในการเปลี่ยนแปลง', { exact: true }).fill('เพิ่มรถทดสอบที่ตรวจสอบแล้ว')
  await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click()
  expect(fixture.writes).toEqual([])
  await dialog.getByRole('checkbox', { name: 'ตรวจสอบตำแหน่งและความพร้อมเริ่มต้นจริงแล้ว', exact: true }).check()
  await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(fixture.writes[0]).toMatchObject({ locationId: 'depot', availableAt: '2030-01-12T08:00:00+07:00', initialPositionConfirmed: true, capabilities: ['standard'] })
  expect(fixture.windows.length).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('availability editor uses Bangkok time and retains a required window after server rejection', async ({ page }) => {
  const fixture = await resources(page)
  await enterAdmin(page, '/admin/vehicles')
  await page.getByRole('button', { name: 'ช่วงเวลารถ', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'ช่วงเวลาที่บันทึกไว้', exact: true }).selectOption('window')
  await expect(dialog.getByLabel('เริ่มช่วงเวลา (เวลาไทย)', { exact: true })).toHaveValue('2030-01-15T06:00')
  await dialog.getByLabel('เหตุผลในการเปลี่ยนแปลง', { exact: true }).fill('ขอปรับช่วงเวลา')
  fixture.controls.failWrite = true
  await dialog.getByRole('button', { name: 'ปิดช่วงเวลานี้', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('ยังจำเป็นสำหรับงานที่ยืนยันแล้ว')
  await expect(dialog.getByLabel('เหตุผลในการเปลี่ยนแปลง', { exact: true })).toHaveValue('ขอปรับช่วงเวลา')
  expect(fixture.writes[0]).toMatchObject({ expectedRevision: 1, expectedResourceRevision: 4 })
  expect(fixture.windows[0].retiredAt).toBeNull()
  fixture.controls.failWrite = false
  await dialog.getByRole('button', { name: 'ปิดช่วงเวลานี้', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(fixture.windows[0].retiredAt).toBeTruthy()
})

test('anonymous and dispatcher sessions cannot enter admin screens or fetch admin data', async ({ page }) => {
  const fixture = await setup(page)
  await mockDispatcherLogin(page, 'dispatcher')
  await page.goto('/admin/accounts')
  await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบเจ้าหน้าที่', exact: true })).toBeVisible()
  expect(fixture.calls).toEqual([])
  await enterDispatcher(page)
  await page.evaluate(() => { history.pushState({}, '', '/admin/accounts'); dispatchEvent(new PopStateEvent('popstate')) })
  await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงหน้านี้', exact: true })).toBeVisible()
  expect(fixture.calls).toEqual([])
})

test('admin read failure and revocation show errors without cached prototype accounts', async ({ page }) => {
  const fixture = await setup(page)
  fixture.controls.failRead = true
  await enterAdmin(page)
  await expect(page.getByRole('alert')).toContainText('เชื่อมต่อระบบไม่ได้')
  await expect(page.getByText('dispatcher.demo', { exact: true })).toHaveCount(0)
  fixture.controls.failRead = false; fixture.controls.revoked = true
  await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบเจ้าหน้าที่', exact: true })).toBeVisible()
})

test('service master failure preserves coordinates, reason and revision for review', async ({page})=>{
  const fixture=await setup(page)
  await enterAdmin(page,'/admin/settings')
  await page.getByRole('button',{name:'จัดการศูนย์รถ',exact:true}).click()
  const dialog=page.getByRole('dialog')
  await dialog.getByLabel('ละติจูด',{exact:true}).fill('18.62')
  await dialog.getByLabel('เหตุผลในการเปลี่ยนแปลง',{exact:true}).fill('พิกัดที่เทศบาลอนุมัติ')
  fixture.controls.failWrite=true
  await dialog.getByRole('button',{name:'บันทึก',exact:true}).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByLabel('ละติจูด',{exact:true})).toHaveValue('18.62')
  await expect(dialog.getByLabel('เหตุผลในการเปลี่ยนแปลง',{exact:true})).toHaveValue('พิกัดที่เทศบาลอนุมัติ')
  expect(fixture.writes[0]).toMatchObject({expectedRevision:3,latitude:18.62})
})
