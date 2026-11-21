import { expect, test, type Page } from '@playwright/test'
import { checkCitizenSlotCapacity, computeBackwardBlockedWindow } from '../src/domain/capacity.ts'
import { setPickerTime } from './time-picker'

interface MockVehicle {
  id: string
  name: string
  plate: string
  vehicleType: string
  active: boolean
  held: boolean
  capabilities: string[]
  revision: number
  locationId: string
  availableAt: string
}

interface MockBooking {
  id: string
  reference: string
  status: string
  revision: number
  executionVersion: number
  patientName: string
  requesterName: string
  contactPhone: string
  bookingFor: 'self' | 'other'
  villageId: string
  hospitalId: string
  hospitalName: string
  hospitalLocationId: string
  depotLocationId: string
  pickupAddress: string
  latitude: number
  longitude: number
  landmark: string
  mobility: string
  assistance: string[]
  appointmentAt: string
  submittedAt: string
  patientProfileId: null
  vehicleId: string | null
  driverId: string | null
  startedAt: string | null
  incidentOpen: boolean
  resourceHold: boolean
  scheduleReviewRequired: boolean
  schedule: null | {
    departureAt: string
    pickupAt: string
    arrivalAt: string
    readyAt: string
    pickupWaitingMinutes: number
    originLocationId: string
    originKind: string
  }
  proposedSchedule: null | {
    departureAt: string
    pickupAt: string
    arrivalAt: string
    readyAt: string
    pickupWaitingMinutes: number
    originLocationId: string
    originKind: string
    vehicleId: string
    driverId: string
  }
}

function createSharedBackendState(vehiclesOverride?: MockVehicle[]) {
  const depotId = 'loc-depot-1'
  const hospitalId = 'hosp-lamphun'
  const hospitalLocId = 'loc-hosp-1'
  const villageId = 'vil-1'

  const vehicles: MockVehicle[] = vehiclesOverride ?? [
    { id: 'veh-1', name: 'รถคันที่ 01', plate: 'กข 1101', vehicleType: 'รถตู้พยาบาล', active: true, held: false, capabilities: ['standard', 'wheelchair', 'stretcher'], revision: 1, locationId: depotId, availableAt: '2026-01-01T06:00:00+07:00' },
    { id: 'veh-2', name: 'รถคันที่ 02', plate: 'กข 1102', vehicleType: 'รถตู้วีลแชร์', active: true, held: false, capabilities: ['standard', 'wheelchair'], revision: 1, locationId: depotId, availableAt: '2026-01-01T06:00:00+07:00' },
    { id: 'veh-3', name: 'รถคันที่ 03', plate: 'กข 1103', vehicleType: 'รถดัดแปลง', active: true, held: false, capabilities: ['standard', 'wheelchair'], revision: 1, locationId: depotId, availableAt: '2026-01-01T06:00:00+07:00' },
    { id: 'veh-4', name: 'รถคันที่ 04', plate: 'กข 1104', vehicleType: 'รถพร้อมเตียง', active: true, held: false, capabilities: ['standard', 'wheelchair', 'stretcher'], revision: 1, locationId: depotId, availableAt: '2026-01-01T06:00:00+07:00' },
    { id: 'veh-5', name: 'รถคันที่ 05', plate: 'กข 1105', vehicleType: 'รถทั่วไป', active: true, held: false, capabilities: ['standard'], revision: 1, locationId: depotId, availableAt: '2026-01-01T06:00:00+07:00' },
  ]

  const drivers = [
    { id: 'drv-1', name: 'นายสมชาย คนขับ 1', active: true, held: false, capabilities: ['standard', 'wheelchair', 'stretcher'], accountId: 'acc-drv-1', rosterActive: true, phone: '0811111101', revision: 1, locationId: depotId, availableAt: '2026-01-01T06:00:00+07:00' },
  ]

  const accounts = [
    { id: 'acc-admin-1', name: 'ผู้ดูแลระบบ', username: 'admin', role: 'admin', active: true, revision: 1 },
    { id: 'acc-disp-1', name: 'เจ้าหน้าที่จัดรถ', username: 'dispatcher', role: 'dispatcher', active: true, revision: 1 },
    { id: 'acc-drv-1', name: 'นายสมชาย คนขับ 1', username: 'driver1', role: 'driver', active: true, revision: 1 },
  ]

  const hospitals = [
    { id: hospitalId, name: 'โรงพยาบาลลำพูน', location_id: hospitalLocId, latitude: 18.5778, longitude: 99.0086 },
  ]

  const villages = [
    { id: villageId, number: 1, name: 'บ้านกลาง' },
  ]

  const locations = [
    { id: depotId, name: 'ศูนย์รถเทศบาลตำบลบ้านกลาง', kind: 'depot' },
    { id: hospitalLocId, name: 'โรงพยาบาลลำพูน', kind: 'hospital' },
  ]

  const bookings: MockBooking[] = []
  let seq = 1
  let forceNextServerCapacityConflict = false

  async function attachRoutes(page: Page, activeRole: 'admin' | 'citizen' | 'dispatcher' | 'driver') {
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line).*/, route => route.abort())
    await page.route('**/node_modules/.vite/deps/@line_liff.js*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `export default {
        init: async () => {},
        isLoggedIn: () => true,
        isInClient: () => true,
        getDecodedIDToken: () => ({ exp: Date.now() / 1000 + 3600 }),
        getIDToken: () => 'synthetic-citizen-token',
        logout: () => {},
        login: () => {},
        openWindow: () => {},
      }`,
    }))

    await page.route('**/api/**', async route => {
      const req = route.request()
      const url = new URL(req.url())
      const path = url.pathname
      const method = req.method()

      if (path === '/api/config') {
        return route.fulfill({
          json: {
            lineEnabled: true,
            liffId: 'synthetic-liff-id',
            noticeVersion: 'v2.1-test',
            noticeText: 'ประกาศความเป็นส่วนตัวสำหรับทดสอบระบบรับส่งผู้ป่วยตำบลบ้านกลาง',
            contactPhone: '053555000',
          },
        })
      }

      if (path === '/api/auth/line' || path === '/api/auth/login') {
        return route.fulfill({ json: { token: `token-${activeRole}` } })
      }

      if (path === '/api/auth/logout') {
        return route.fulfill({ json: { ok: true } })
      }

      if (path === '/api/auth/me') {
        return route.fulfill({
          json: {
            id: activeRole === 'citizen' ? 'cit-1' : `staff-${activeRole}`,
            name: `ผู้ทดสอบ-${activeRole}`,
            role: activeRole,
            driverId: activeRole === 'driver' ? 'drv-1' : null,
          },
        })
      }

      if (path === '/api/consents' && method === 'POST') {
        return route.fulfill({ json: { id: 'consent-1', accepted: true, noticeVersion: 'v2.1-test' } })
      }

      if (path === '/api/profiles') {
        return route.fulfill({ json: { profiles: [] } })
      }

      if (path === '/api/dispatcher-alerts') {
        return route.fulfill({ json: { alerts: [], unread: 0, nextCursor: null } })
      }

      if (path === '/api/notification-failures' || path === '/api/admin/notification-failures') {
        return route.fulfill({ json: { failures: [], total: 0, pending: 0, nextCursor: null, service: { configured: false, deliveryEnabled: false } } })
      }

      if (path === '/api/catalog') {
        if (activeRole === 'citizen') {
          const activeBookings = bookings
            .filter(b => !['COMPLETED', 'CANCELLED', 'REJECTED', 'ABORTED'].includes(b.status))
            .map(b => ({
              id: b.id,
              appointmentAt: b.appointmentAt,
              hospitalId: b.hospitalId,
              hospitalName: b.hospitalName,
              mobility: b.mobility,
              status: b.status,
              vehicleId: b.vehicleId,
              schedule: b.schedule,
            }))
          return route.fulfill({ json: { hospitals, villages, vehicles, activeBookings } })
        }
        return route.fulfill({
          json: {
            hospitals,
            villages,
            vehicles,
            drivers,
            locations,
            depotLocationId: depotId,
            configurationRevision: 1,
            closures: [],
            settings: {
              center: 'ศูนย์รถเทศบาลตำบลบ้านกลาง',
              latitude: 18.5835,
              longitude: 99.0422,
              opensAt: '06:00',
              closesAt: '16:00',
            },
          },
        })
      }

      if (path === '/api/admin/accounts') {
        return route.fulfill({ json: { accounts } })
      }
      if (path === '/api/admin/audit') {
        return route.fulfill({ json: { events: [] } })
      }
      if (path === '/api/admin/summary') {
        return route.fulfill({ json: { statuses: [{ status: 'COMPLETED', count: bookings.filter(b => b.status === 'COMPLETED').length }] } })
      }
      if (path === '/api/admin/availability') {
        return route.fulfill({
          json: {
            windows: [
              { id: 'win-v1', vehicleId: 'veh-1', driverId: null, startsAt: '2026-01-01T06:00:00+07:00', endsAt: '2028-12-31T16:00:00+07:00', revision: 1 },
              { id: 'win-v2', vehicleId: 'veh-2', driverId: null, startsAt: '2026-01-01T06:00:00+07:00', endsAt: '2028-12-31T16:00:00+07:00', revision: 1 },
              { id: 'win-d1', vehicleId: null, driverId: 'drv-1', startsAt: '2026-01-01T06:00:00+07:00', endsAt: '2028-12-31T16:00:00+07:00', revision: 1 },
            ],
          },
        })
      }

      if ((path === '/api/admin/seed-import' || path === '/api/admin/seed-reset') && method === 'POST') {
        return route.fulfill({ json: { ok: true } })
      }

      if (path.startsWith('/api/admin/resources/vehicles/') && method === 'POST') {
        const vehicleId = path.split('/').pop()!
        const body = req.postDataJSON() as { active?: boolean; capabilities?: string[] }
        const v = vehicles.find(item => item.id === vehicleId)
        if (v) {
          if (typeof body.active === 'boolean') v.active = body.active
          if (Array.isArray(body.capabilities)) v.capabilities = body.capabilities
          v.revision += 1
        }
        return route.fulfill({ json: { vehicle: v } })
      }

      if (path === '/api/bookings' && method === 'GET') {
        return route.fulfill({ json: { bookings, nextCursor: null, hasMore: false } })
      }

      if (path === '/api/bookings' && method === 'POST') {
        const body = req.postDataJSON() as Record<string, unknown>
        const capacity = checkCitizenSlotCapacity({
          appointmentAt: String(body.appointmentAt),
          hospitalId: String(body.hospitalId),
          mobility: String(body.mobility),
          vehicles,
          existingBookings: bookings,
        })
        if (forceNextServerCapacityConflict || !capacity.available) {
          forceNextServerCapacityConflict = false
          return route.fulfill({
            status: 409,
            json: {
              message: capacity.available
                ? 'ช่วงเวลาเต็ม / รถไม่ว่าง (ตรวจพบคิวซ้อนล่าสุดบนเซิร์ฟเวอร์)'
                : capacity.message,
              details: {
                code: 'CAPACITY_FULL',
                alternativeTimes: capacity.alternativeTimes.length ? capacity.alternativeTimes : ['10:00', '11:00'],
              },
            },
          })
        }

        const id = `BK-CAP-${100 + seq++}`
        const created: MockBooking = {
          id,
          reference: id,
          status: 'REQUESTED',
          revision: 1,
          executionVersion: 0,
          patientName: String(body.patientName),
          requesterName: String(body.requesterName || body.patientName),
          contactPhone: String(body.contactPhone),
          bookingFor: body.bookingFor === 'other' ? 'other' : 'self',
          villageId: String(body.villageId),
          hospitalId: String(body.hospitalId),
          hospitalName: 'โรงพยาบาลลำพูน',
          hospitalLocationId: hospitalLocId,
          depotLocationId: depotId,
          pickupAddress: String(body.pickupAddress),
          latitude: Number(body.latitude),
          longitude: Number(body.longitude),
          landmark: String(body.landmark ?? ''),
          mobility: String(body.mobility),
          assistance: Array.isArray(body.assistance) ? (body.assistance as string[]) : [],
          appointmentAt: String(body.appointmentAt),
          submittedAt: new Date().toISOString(),
          patientProfileId: null,
          vehicleId: null,
          driverId: null,
          startedAt: null,
          incidentOpen: false,
          resourceHold: false,
          scheduleReviewRequired: false,
          schedule: null,
          proposedSchedule: null,
        }
        bookings.push(created)
        return route.fulfill({ status: 201, json: created })
      }

      if (path.startsWith('/api/bookings/') && method === 'GET') {
        const bookingId = decodeURIComponent(path.split('/').pop()!)
        const found = bookings.find(b => b.id === bookingId)
        return route.fulfill({ status: found ? 200 : 404, json: found ?? { error: 'Not found' } })
      }

      if (path.endsWith('/schedule') && method === 'POST') {
        const bookingId = decodeURIComponent(path.split('/')[3])
        const body = req.postDataJSON() as { vehicleId: string; driverId: string }
        const b = bookings.find(row => row.id === bookingId)!
        const win = computeBackwardBlockedWindow(b.appointmentAt, { hospitalName: b.hospitalName })!
        b.status = 'SCHEDULED'
        b.vehicleId = body.vehicleId
        b.driverId = body.driverId
        b.revision += 1
        b.proposedSchedule = {
          departureAt: win.departureAt,
          pickupAt: win.pickupAt,
          arrivalAt: win.arrivalAt,
          readyAt: win.freeAt,
          pickupWaitingMinutes: 0,
          originLocationId: depotId,
          originKind: 'depot',
          vehicleId: body.vehicleId,
          driverId: body.driverId,
        }
        return route.fulfill({ json: b })
      }

      if (path.endsWith('/assignment') && method === 'POST') {
        const bookingId = decodeURIComponent(path.split('/')[3])
        const b = bookings.find(row => row.id === bookingId)!
        b.status = 'ASSIGNED'
        b.revision += 1
        if (b.proposedSchedule) {
          b.schedule = {
            departureAt: b.proposedSchedule.departureAt,
            pickupAt: b.proposedSchedule.pickupAt,
            arrivalAt: b.proposedSchedule.arrivalAt,
            readyAt: b.proposedSchedule.readyAt,
            pickupWaitingMinutes: b.proposedSchedule.pickupWaitingMinutes,
            originLocationId: b.proposedSchedule.originLocationId,
            originKind: b.proposedSchedule.originKind,
          }
          b.proposedSchedule = null
        }
        return route.fulfill({ json: b })
      }

      if (path.endsWith('/commands') && method === 'POST') {
        const bookingId = decodeURIComponent(path.split('/')[3])
        const body = req.postDataJSON() as { command: { type: string; reason?: string } }
        const b = bookings.find(row => row.id === bookingId)!
        b.revision += 1
        if (body.command.type === 'APPROVE') {
          b.status = 'APPROVED'
        } else if (body.command.type === 'START_TRIP') {
          b.startedAt = new Date().toISOString()
          b.executionVersion += 1
        } else if (body.command.type === 'DEPART_ORIGIN') {
          b.status = 'PICKING_UP'
          b.executionVersion += 1
        } else if (body.command.type === 'CONFIRM_PICKUP') {
          b.status = 'PICKED_UP'
          b.executionVersion += 1
        } else if (body.command.type === 'DEPART_FOR_HOSPITAL') {
          b.status = 'IN_TRANSIT'
          b.executionVersion += 1
        } else if (body.command.type === 'CONFIRM_HANDOVER') {
          b.status = 'COMPLETED'
          b.executionVersion += 1
        }
        return route.fulfill({ json: b })
      }

      if (path === '/api/driver/history') {
        return route.fulfill({
          json: {
            bookings: bookings
              .filter(b => b.status === 'COMPLETED')
              .map(b => ({
                id: b.id,
                reference: b.reference,
                status: b.status,
                appointmentAt: b.appointmentAt,
                hospitalName: b.hospitalName,
                schedule: b.schedule,
                completedAt: new Date().toISOString(),
              })),
            nextCursor: null,
            hasMore: false,
          },
        })
      }

      return route.fulfill({ status: 404, json: { error: `Unhandled route ${method} ${path}` } })
    })
  }

  return {
    vehicles,
    bookings,
    attachRoutes,
    triggerNextServerConflict: () => { forceNextServerCapacityConflict = true },
  }
}

async function fillCitizenStep1(page: Page, opts: { patientName: string; phone: string; hour: string; minute: string }) {
  await page.getByRole('button', { name: 'เริ่มจองรถ →' }).click()
  await page.getByLabel(/รับทราบการใช้ข้อมูล/).check()
  await page.getByRole('button', { name: 'รับทราบและถัดไป' }).click()

  await page.getByLabel(/ชื่อผู้ป่วย/).fill(opts.patientName)
  await page.getByLabel(/เบอร์โทรศัพท์ของคุณ/).fill(opts.phone)
  await page.getByLabel(/โรงพยาบาล/).selectOption('hosp-lamphun')

  // Pick a deterministic date next month (day 15) so all hours 06:20-15:50 clear >=48h notice.
  await page.locator('button.booking-input-trigger').first().click()
  await page.getByRole('button', { name: 'เดือนถัดไป', exact: true }).click()
  await page.locator('.booking-calendar button:not([disabled])', { hasText: /^\s*(?:[อาพพฤศส]\.\s*)?15$/ }).first().click()
  await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()

  await page.locator('button.booking-input-trigger').nth(1).click()
  await setPickerTime(page, 'ชั่วโมง', opts.hour)
  await setPickerTime(page, 'นาที', opts.minute)
  await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
}

async function fillCitizenStep2AndSubmit(page: Page, mobility: 'เดินได้' | 'รถเข็น' | 'เปลนอน' = 'เดินได้') {
  await page.getByRole('button', { name: mobility, exact: true }).click()
  await page.getByRole('checkbox', { name: 'ไม่ต้องการความช่วยเหลือเพิ่มเติม' }).check()
  await page.getByLabel(/หมู่บ้านในเขตบริการ/).selectOption('vil-1')
  await page.getByLabel(/ที่อยู่จุดรับ/).fill('99 หมู่ 1 บ้านกลาง ต.บ้านกลาง อ.เมืองลำพูน')
  await page.getByText('เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง').click()
  await page.getByLabel('ละติจูด').fill('18.5835')
  await page.getByLabel('ลองจิจูด').fill('99.0422')
  await page.getByRole('button', { name: 'ถัดไป →' }).click()
  await expect(page.getByRole('heading', { name: 'ตรวจสอบข้อมูล', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ' }).click()
  await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toBeVisible()
}

test('admin disables vehicles leaving 2 active units -> 2 overlapping citizen bookings succeed -> 3rd overlapping booking is blocked & alt slot works', async ({ browser }) => {
  const shared = createSharedBackendState()

  // 1. Admin disables 3 vehicles (veh-3, veh-4, veh-5), leaving ONLY 2 active vehicles.
  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await shared.attachRoutes(adminPage, 'admin')
  await adminPage.goto('/staff/login?next=%2Fadmin%2Fvehicles')
  await adminPage.getByLabel('ชื่อผู้ใช้').fill('admin')
  await adminPage.getByLabel('รหัสผ่าน').fill('pass')
  await adminPage.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await adminPage.getByRole('link', { name: 'เปิดหน้าผู้ดูแลระบบ' }).click()
  await expect(adminPage.locator('#admin-main')).toBeVisible()

  for (const id of ['veh-3', 'veh-4', 'veh-5']) {
    const row = adminPage.locator('tr', { hasText: id })
    await row.getByRole('button', { name: 'จัดการรถ' }).click()
    await adminPage.getByLabel('สถานะรถ').selectOption('false')
    await adminPage.getByLabel('เหตุผลในการเปลี่ยนแปลง').fill('ปรับลดรถพร้อมใช้งานเหลือ 2 คัน')
    await adminPage.getByRole('button', { name: 'บันทึก' }).click()
    await adminPage.getByRole('button', { name: 'บันทึก' }).click()
    await expect(row.getByText('ปิดใช้งาน')).toBeVisible()
  }
  await expect(adminPage.locator('.admin-metrics')).toContainText('2')
  await adminContext.close()

  // 2. Citizen completes 2 overlapping bookings at 13:30 on the same date.
  const citizenContext = await browser.newContext()
  const citizenPage = await citizenContext.newPage()
  await shared.attachRoutes(citizenPage, 'citizen')
  await citizenPage.goto('/booking')

  await fillCitizenStep1(citizenPage, { patientName: 'นางสมศรี ทดสอบหนึ่ง', phone: '0811111111', hour: '13', minute: '30' })
  await citizenPage.getByRole('button', { name: 'ถัดไป →' }).click()
  await fillCitizenStep2AndSubmit(citizenPage, 'เดินได้')
  await citizenPage.getByRole('link', { name: 'กลับหน้าหลัก' }).click()

  await fillCitizenStep1(citizenPage, { patientName: 'นายบุญมี ทดสอบสอง', phone: '0822222222', hour: '13', minute: '30' })
  await citizenPage.getByRole('button', { name: 'ถัดไป →' }).click()
  await fillCitizenStep2AndSubmit(citizenPage, 'เดินได้')
  await citizenPage.getByRole('link', { name: 'กลับหน้าหลัก' }).click()

  // 3. 3rd overlapping booking at 13:30 MUST be blocked before submission.
  await fillCitizenStep1(citizenPage, { patientName: 'นายสมชาย ทดสอบสาม', phone: '0833333333', hour: '13', minute: '30' })
  const capacityAlert = citizenPage.locator('.booking-capacity-alert')
  await expect(capacityAlert).toBeVisible()
  await expect(capacityAlert).toContainText('ช่วงเวลาเต็ม / รถไม่ว่าง')
  await expect(capacityAlert).toContainText('รถออก')

  await citizenPage.getByRole('button', { name: 'ถัดไป →' }).click()
  // Stays blocked on patient step.
  await expect(citizenPage.getByRole('heading', { name: 'ข้อมูลผู้ป่วย', exact: true })).toBeVisible()

  // Picking a suggested non-overlapping time unblocks Step 1 and lets the 3rd booking succeed.
  const altBtn = capacityAlert.locator('button.booking-capacity-alt-btn').first()
  await expect(altBtn).toBeVisible()
  await altBtn.click()
  await expect(capacityAlert).toHaveCount(0)

  await citizenPage.getByRole('button', { name: 'ถัดไป →' }).click()
  await fillCitizenStep2AndSubmit(citizenPage, 'เดินได้')
  expect(shared.bookings.length).toBe(3)
  await citizenContext.close()
})

test('mobility equipment capacity mismatch blocks stretcher request when active vehicles only support standard/wheelchair', async ({ browser }) => {
  const shared = createSharedBackendState([
    { id: 'veh-std-1', name: 'รถคันที่ 01', plate: 'กข 2201', vehicleType: 'รถทั่วไป', active: true, held: false, capabilities: ['standard', 'wheelchair'], revision: 1, locationId: 'loc-depot-1', availableAt: '2026-01-01T06:00:00+07:00' },
  ])
  const context = await browser.newContext()
  const page = await context.newPage()
  await shared.attachRoutes(page, 'citizen')
  await page.goto('/booking')

  await fillCitizenStep1(page, { patientName: 'นางคำแก้ว เปลนอน', phone: '0844444444', hour: '10', minute: '00' })
  await page.getByRole('button', { name: 'ถัดไป →' }).click()
  await expect(page.getByRole('heading', { name: 'การช่วยเหลือและจุดรับ', exact: true })).toBeVisible()

  // Select unsupported mobility equipment -> immediately blocked on Step 2.
  await page.getByRole('button', { name: 'เปลนอน', exact: true }).click()
  const alert = page.locator('.booking-capacity-alert')
  await expect(alert).toBeVisible()
  await expect(alert).toContainText('ช่วงเวลาเต็ม / รถไม่ว่าง')
  await expect(alert).toContainText('เปลนอน')

  // Attempting to continue stays blocked on Step 2.
  await page.getByLabel(/หมู่บ้านในเขตบริการ/).selectOption('vil-1')
  await page.getByLabel(/ที่อยู่จุดรับ/).fill('88 หมู่ 1 บ้านกลาง')
  await page.getByText('เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง').click()
  await page.getByLabel('ละติจูด').fill('18.5835')
  await page.getByLabel('ลองจิจูด').fill('99.0422')
  await page.getByRole('button', { name: 'ถัดไป →' }).click()
  await expect(page.getByRole('heading', { name: 'การช่วยเหลือและจุดรับ', exact: true })).toBeVisible()

  // Switching back to supported equipment unblocks.
  await page.getByRole('button', { name: 'รถเข็น', exact: true }).click()
  await expect(alert).toHaveCount(0)
  await page.getByRole('button', { name: 'ถัดไป →' }).click()
  await expect(page.getByRole('heading', { name: 'ตรวจสอบข้อมูล', exact: true })).toBeVisible()
  await context.close()
})

test('<48h lead time is blocked with 1669 notice and 4-actor Happy Path reaches COMPLETED', async ({ browser }) => {
  const shared = createSharedBackendState()

  // 1. Verify Citizen <48h rule + 1669 emergency link and submit a valid >=48h wheelchair booking.
  const citCtx = await browser.newContext()
  const citPage = await citCtx.newPage()
  await shared.attachRoutes(citPage, 'citizen')
  await citPage.goto('/booking')
  await expect(citPage.getByRole('link', { name: 'ฉุกเฉิน โทร 1669' })).toHaveAttribute('href', 'tel:1669')

  await citPage.getByRole('button', { name: 'เริ่มจองรถ →' }).click()
  await citPage.getByLabel(/รับทราบการใช้ข้อมูล/).check()
  await citPage.getByRole('button', { name: 'รับทราบและถัดไป' }).click()

  // Confirm today's date in the calendar is disabled (<48h rule).
  await citPage.locator('button.booking-input-trigger').first().click()
  await expect(citPage.locator('.booking-calendar button[disabled]').first()).toBeDisabled()
  await citPage.getByRole('button', { name: 'ยกเลิก', exact: true }).click()

  await citPage.getByLabel(/ชื่อผู้ป่วย/).fill('นางจันทร์ดี ครบวงจร')
  await citPage.getByLabel(/เบอร์โทรศัพท์ของคุณ/).fill('0855555555')
  await citPage.getByLabel(/โรงพยาบาล/).selectOption('hosp-lamphun')
  await citPage.locator('button.booking-input-trigger').first().click()
  await citPage.getByRole('button', { name: 'เดือนถัดไป', exact: true }).click()
  await citPage.locator('.booking-calendar button:not([disabled])', { hasText: /^\s*(?:[อาพพฤศส]\.\s*)?15$/ }).first().click()
  await citPage.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()
  await citPage.locator('button.booking-input-trigger').nth(1).click()
  await setPickerTime(citPage, 'ชั่วโมง', '10')
  await setPickerTime(citPage, 'นาที', '30')
  await citPage.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
  await citPage.getByRole('button', { name: 'ถัดไป →' }).click()
  await fillCitizenStep2AndSubmit(citPage, 'รถเข็น')
  expect(shared.bookings[0]?.status).toBe('REQUESTED')
  await citCtx.close()

  // 2. Dispatcher approves, schedules, and assigns vehicle & driver.
  const dispCtx = await browser.newContext()
  const dispPage = await dispCtx.newPage()
  await shared.attachRoutes(dispPage, 'dispatcher')
  await dispPage.goto('/staff/login?next=%2Fdispatcher')
  await dispPage.getByLabel('ชื่อผู้ใช้').fill('dispatcher')
  await dispPage.getByLabel('รหัสผ่าน').fill('pass')
  await dispPage.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await dispPage.getByRole('link', { name: 'เปิดหน้าจัดรถ' }).click()

  await dispPage.getByRole('button', { name: 'ดูรายละเอียด →' }).first().click()
  await dispPage.getByRole('button', { name: 'อนุมัติคำขอ', exact: true }).click()
  await dispPage.getByRole('button', { name: 'ยืนยันอนุมัติ', exact: true }).click()

  await dispPage.getByRole('link', { name: 'จัดตารางและมอบหมาย', exact: true }).click()
  await dispPage.getByRole('button', { name: 'รถรับส่ง: เลือกรถ', exact: true }).click()
  await dispPage.getByRole('option', { name: /รถคันที่ 01/ }).click()
  await dispPage.getByRole('button', { name: 'คนขับ: เลือกคนขับ', exact: true }).click()
  await dispPage.getByRole('option', { name: /นายสมชาย/ }).click()
  await dispPage.getByRole('button', { name: 'ตรวจสอบและยืนยันตาราง', exact: true }).click()
  await dispPage.getByRole('button', { name: 'ยืนยันตาราง', exact: true }).click()
  await dispPage.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
  await dispPage.getByRole('button', { name: 'ยืนยันการมอบหมาย', exact: true }).click()
  await expect(dispPage).toHaveURL(/\/dispatcher\/tracking$/)
  expect(shared.bookings[0]?.status).toBe('ASSIGNED')
  await dispCtx.close()

  // 3. Driver executes ordered lifecycle milestones through COMPLETED.
  const drvCtx = await browser.newContext()
  const drvPage = await drvCtx.newPage()
  await shared.attachRoutes(drvPage, 'driver')
  await drvPage.goto('/staff/login?next=%2Fdriver')
  await drvPage.getByLabel('ชื่อผู้ใช้').fill('driver1')
  await drvPage.getByLabel('รหัสผ่าน').fill('pass')
  await drvPage.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await drvPage.getByRole('link', { name: 'เปิดหน้าคนขับ' }).click()

  await drvPage.getByRole('button', { name: /ดูรายละเอียด/ }).first().click()
  for (const label of [
    'เริ่มงาน',
    'ออกจากต้นทางไปรับผู้ป่วย',
    'รับผู้ป่วยขึ้นรถแล้ว',
    'ออกเดินทางไปโรงพยาบาล',
    'ส่งถึงโรงพยาบาลแล้ว',
  ]) {
    await drvPage.getByRole('button', { name: label, exact: true }).click()
    await drvPage.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  }

  expect(shared.bookings[0]?.status).toBe('COMPLETED')
  await drvCtx.close()
})

test('admin 320+ seed load, analytics 12-village dashboard, pagination, reset, dispatcher timeline, and daily map view work end-to-end', async ({ browser }) => {
  const shared = createSharedBackendState()
  const context = await browser.newContext()

  // 1. Admin loads 320 realistic seed bookings, inspects Executive Analytics + paginated preview, tests reset, then reloads seed.
  const adminPage = await context.newPage()
  await shared.attachRoutes(adminPage, 'admin')
  await adminPage.goto('/staff/login?next=%2Fadmin')
  await adminPage.getByLabel('ชื่อผู้ใช้').fill('admin')
  await adminPage.getByLabel('รหัสผ่าน').fill('pass')
  await adminPage.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await adminPage.getByRole('link', { name: 'เปิดหน้าผู้ดูแลระบบ' }).click()
  await expect(adminPage.locator('#admin-main')).toBeVisible()

  await adminPage.getByRole('button', { name: 'โหลดข้อมูลตัวอย่าง 320 รายการ' }).first().click()
  await expect(adminPage.getByText('ข้อมูลจำลองในระบบ: 320 รายการ')).toBeVisible()

  // Phase 4: Executive Analytics Dashboard shows KPIs and all 12 Ban Klang villages without PII.
  const analytics = adminPage.locator('.admin-analytics-panel')
  await expect(analytics).toContainText('อัตราเดินทางสำเร็จ')
  await expect(analytics).toContainText('หมู่ 1 บ้านกลาง')
  await expect(analytics).toContainText('หมู่ 12 บ้านใหม่สันป่ายาง')
  await expect(analytics).toContainText('เปลนอน (Stretcher)')

  // Phase 1: Paginated preview table (50 rows per page).
  await adminPage.getByRole('button', { name: /ดูตารางตรวจสอบชุดข้อมูล/ }).click()
  await expect(adminPage.getByText(/แสดง 1–50 จาก 320 รายการ/)).toBeVisible()
  await adminPage.getByRole('button', { name: 'ถัดไป →' }).click()
  await expect(adminPage.getByText(/แสดง 51–100 จาก 320 รายการ/)).toBeVisible()

  // Test Reset / Clear Mock Data and confirm clean wipe.
  await adminPage.getByRole('button', { name: 'ล้างข้อมูลจำลอง / รีเซ็ตระบบ' }).click()
  await adminPage.getByRole('button', { name: 'ยืนยันล้างข้อมูลจำลอง' }).click()
  await expect(adminPage.getByText('ยังไม่มีชุดข้อมูลจำลอง')).toBeVisible()

  // Reload 320 records for Dispatcher inspection in same browser context.
  await adminPage.getByRole('button', { name: 'โหลดข้อมูลตัวอย่าง 320 รายการ' }).first().click()
  await expect(adminPage.getByText('ข้อมูลจำลองในระบบ: 320 รายการ')).toBeVisible()

  // 2. Dispatcher verifies Phase 3 fleet bar, inline mobility/window badges, timeline, compact refresh, and Phase 5 Daily Map View.
  const dispPage = await context.newPage()
  await shared.attachRoutes(dispPage, 'dispatcher')
  await dispPage.goto('/staff/login?next=%2Fdispatcher')
  await dispPage.getByLabel('ชื่อผู้ใช้').fill('dispatcher')
  await dispPage.getByLabel('รหัสผ่าน').fill('pass')
  await dispPage.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await dispPage.getByRole('link', { name: 'เปิดหน้าจัดรถ' }).click()
  await expect(dispPage.locator('#dispatcher-main')).toBeVisible()

  // Phase 3: Fleet status bar, compact refresh icon, inline badges, and Vehicle Timeline.
  await expect(dispPage.locator('.dispatch-fleet-bar')).toContainText('รถทั้งหมด / เปิดใช้งาน')
  await expect(dispPage.locator('.dispatch-fleet-bar')).toContainText('ว่างพร้อมจัด')
  await expect(dispPage.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' })).toBeVisible()
  await expect(dispPage.locator('.dispatch-window-chip').first()).toContainText('รถออก')
  await expect(dispPage.locator('.dispatch-timeline-panel')).toContainText('ไทม์ไลน์รถและช่วงเวลาว่าง')

  // Phase 5: Switch to Daily Dispatch Map View and inspect selected pin details.
  await dispPage.getByRole('button', { name: /มุมมองแผนที่รายวัน/ }).click()
  const mapView = dispPage.locator('.dispatch-map-view')
  await expect(mapView).toBeVisible()
  await expect(mapView.locator('.dispatch-map-popup-card')).toContainText('ช่วงเวลาปิดรถ')
  await mapView.getByRole('button', { name: 'ดูรายละเอียด →' }).click()
  await expect(dispPage.getByRole('dialog')).toBeVisible()
  await context.close()
})
