import { test, expect } from '@playwright/test'
import { startOperationalTestApi, ids } from './helpers/operational-postgres'
import { recoveryFingerprint } from '../scripts/database/recovery.mjs'

test.use({ actionTimeout: 10000 })
test.beforeEach(() => test.skip(!process.env.DATABASE_TEST_ADMIN_URL, 'Local test database required'))

for (const operation of ['intake', 'profile-create', 'profile-update'] as const) for (const rejectedField of ['patientName', 'mobility', 'assistance'] as const) test(`original citizen ${operation} corrects real ${rejectedField} rejection without losing a Unicode boundary draft`, async ({ page }) => {
  test.setTimeout(60000)
  const f = await startOperationalTestApi({ liffId: 'synthetic-validation', verifyLine: async token => {
    expect(token).toBe('synthetic-validation-token')
    return { subject: `U${'c'.repeat(32)}`, name: 'ผู้จองทดสอบขอบเขตข้อมูล' }
  } })
  try {
    const login = await f.request('/auth/line', 'citizen', { idToken: 'synthetic-validation-token' })
    async function owner(path: string, body?: unknown, status = 200) {
      const response = await fetch(`${f.base}/api${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${login.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
      expect(response.status).toBe(status)
      return response.json()
    }
    const consent = await owner('/consents', { accepted: true, noticeVersion: 'development-v1' }, 201)
    const profileBody = { consentId: consent.id, patientName: 'ข้อมูลเดิม', contactPhone: '0800000000', mobility: 'standard', villageId: ids.village, pickupAddress: 'บ้านเดิม', latitude: 18.59, longitude: 99.05, assistance: [], landmark: '' }
    const profile = await owner('/profiles', profileBody, 201)
    const earlier = await owner('/bookings', { ...profileBody, bookingFor: 'self', requesterName: 'ผู้จองเดิม', hospitalId: ids.hospital, appointmentAt: '2030-01-15T09:00:00+07:00', patientProfileId: profile.id }, 201)
    async function snapshots() {
      const rows = []
      for (const [table, key, id] of [['bookings', 'id', earlier.id], ['trip_events', 'booking_id', earlier.id], ['audit_logs', 'entity_id', earlier.id], ['notifications', 'booking_id', earlier.id], ['patient_profiles', 'id', profile.id]]) rows.push((await f.pool.query(`SELECT * FROM patient_transfer.${table} WHERE ${key}=$1 ORDER BY id`, [id])).rows)
      return rows
    }
    const original = await snapshots()
    const oldLocation = (await f.pool.query('SELECT * FROM patient_transfer.locations WHERE id=$1', [original[4][0].pickup_location_id])).rows
    const targetPath = operation === 'intake' ? '/api/bookings' : operation === 'profile-create' ? '/api/profiles' : `/api/profiles/${profile.id}`
    const profileButton = operation === 'profile-update' ? 'อัปเดตข้อมูลผู้ป่วยที่บันทึกไว้' : 'บันทึกข้อมูลผู้ป่วย'
    let corruptNext = false
    let bookingPosts = 0
    const submitted: Record<string, unknown>[] = []
    await page.clock.install({ time: new Date(f.control.now) })
    await page.route('**/src/services/lineClient.ts', route => route.fulfill({ contentType: 'application/javascript', body: 'export async function lineIdToken() { return "synthetic-validation-token" }' }))
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url())
      const options: { url: string; postData?: string } = { url: `${f.base}${url.pathname}${url.search}` }
      if (url.pathname === '/api/bookings' && request.method() === 'POST') bookingPosts++
      if (url.pathname === targetPath && request.method() === 'POST') {
        const body = request.postDataJSON()
        submitted.push(body)
        if (corruptNext) {
          corruptNext = false
          // Deliberately malformed transport input exercises the real server's field errors;
          // the browser draft and every operational response remain unmodified.
          options.postData = JSON.stringify({ ...body, [rejectedField]: rejectedField === 'patientName' ? '😀'.repeat(121) : rejectedField === 'mobility' ? 'unsupported' : ['clinical'] })
        }
      }
      await route.fulfill({ response: await route.fetch(options) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line\.me|line-scdn).*/, route => route.abort())
    await page.goto('/booking')
    await page.getByRole('button', { name: 'เริ่มจองรถ →', exact: true }).click()
    await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
    await page.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
    await page.getByRole('button', { name: 'จองให้ผู้อื่น', exact: true }).click()
    if (operation === 'profile-update') await page.getByLabel('ข้อมูลผู้ป่วยที่บันทึกไว้').selectOption(profile.id)
    const patient = ` ก${'😀'.repeat(119)} `, requester = ` ผ${'😀'.repeat(119)} `
    await page.getByLabel('ชื่อผู้ป่วย *', { exact: true }).fill(` ${'😀'.repeat(121)} `)
    await page.getByLabel('ชื่อผู้ดูแล / ผู้ติดต่อ *', { exact: true }).fill(requester)
    await page.getByLabel('เบอร์โทรศัพท์ผู้ติดต่อ *', { exact: true }).fill('+660800000000')
    await page.getByLabel('ความสัมพันธ์กับผู้ป่วย *', { exact: true }).selectOption('บุตร')
    await page.getByLabel('โรงพยาบาล *', { exact: true }).selectOption(ids.hospital)
    await page.locator('.booking-input-trigger').nth(0).click()
    await page.getByRole('button', { name: /15 มกราคม/ }).click()
    await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()
    await page.locator('.booking-input-trigger').nth(1).click()
    await page.getByRole('listbox', { name: 'ชั่วโมง', exact: true }).press('9')
    await page.getByRole('listbox', { name: 'นาที', exact: true }).press('Home')
    await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
    const beforeClient = await recoveryFingerprint(f.pool)
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    await expect(page.getByLabel('ชื่อผู้ป่วย *', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('เบอร์โทรศัพท์ผู้ติดต่อ *', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('ชื่อผู้ดูแล / ผู้ติดต่อ *', { exact: true })).toHaveValue(requester)
    expect(await recoveryFingerprint(f.pool)).toEqual(beforeClient)
    await page.getByLabel('ชื่อผู้ป่วย *', { exact: true }).fill(patient)
    await page.getByLabel('เบอร์โทรศัพท์ผู้ติดต่อ *', { exact: true }).fill('+66 80-000-0001')
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    await page.getByRole('button', { name: 'รถเข็น', exact: true }).click()
    await page.getByRole('checkbox', { name: 'ต้องการผู้ช่วยพยุงขึ้น-ลงรถ', exact: true }).check()
    await page.getByRole('checkbox', { name: 'มีผู้ดูแลเดินทางไปด้วย', exact: true }).check()
    await page.getByLabel('หมู่บ้านในเขตบริการ *').selectOption(ids.village)
    const address = ` ${'😀'.repeat(1000)} `, landmark = ` ${'ก'.repeat(1000)} `
    await page.getByLabel('ที่อยู่จุดรับ *').fill(`${'😀'.repeat(1001)}`)
    await page.getByLabel('จุดสังเกต', { exact: true }).fill(landmark)
    await page.getByText('เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง', { exact: true }).click()
    await page.getByLabel('ละติจูด', { exact: true }).fill('18.59')
    await page.getByLabel('ลองจิจูด', { exact: true }).fill('99.05')
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    await expect(page.getByLabel('ที่อยู่จุดรับ *')).toHaveAttribute('aria-invalid', 'true')
    expect(await recoveryFingerprint(f.pool)).toEqual(beforeClient)
    await page.getByLabel('ที่อยู่จุดรับ *').fill(address)
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'ตรวจสอบข้อมูล', exact: true })).toBeVisible()
    const beforeDenied = await recoveryFingerprint(f.pool)
    corruptNext = true
    if (operation !== 'intake') await page.getByRole('checkbox', { name: 'บันทึกข้อมูลผู้ป่วยไว้ใช้ครั้งต่อไป', exact: true }).check()
    const denied = page.waitForResponse(r => r.url().endsWith(targetPath) && r.request().method() === 'POST')
    await page.getByRole('button', { name: operation === 'intake' ? 'ยืนยันและส่งคำขอ' : profileButton, exact: true }).click()
    expect((await denied).status()).toBe(400)
    expect((await (await denied).json()).details.field).toBe(rejectedField)
    expect(await recoveryFingerprint(f.pool)).toEqual(beforeDenied)
    if (rejectedField === 'patientName') {
      await expect(page.getByLabel('ชื่อผู้ป่วย *', { exact: true })).toHaveValue(patient)
      await expect(page.getByLabel('ชื่อผู้ป่วย *', { exact: true })).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByLabel('เบอร์โทรศัพท์ผู้ติดต่อ *', { exact: true })).toHaveValue('+66 80-000-0001')
      await page.getByLabel('ชื่อผู้ป่วย *', { exact: true }).fill(patient.trim())
      await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    } else {
      const group = page.getByRole('group', { name: rejectedField === 'mobility' ? 'การช่วยเหลือ' : 'ความช่วยเหลือเพิ่มเติม', exact: true })
      await expect(group).toHaveAttribute('aria-invalid', 'true')
      await expect(group).toBeFocused()
      await expect(page.getByRole('alert')).toContainText('กรุณาตรวจสอบข้อมูลในช่องนี้อีกครั้ง')
    }
    await expect(page.getByLabel('ที่อยู่จุดรับ *')).toHaveValue(address)
    await expect(page.getByLabel('จุดสังเกต', { exact: true })).toHaveValue(landmark)
    await expect(page.getByRole('button', { name: 'รถเข็น', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('checkbox', { name: 'ต้องการผู้ช่วยพยุงขึ้น-ลงรถ', exact: true })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'มีผู้ดูแลเดินทางไปด้วย', exact: true })).toBeChecked()
    if (rejectedField === 'mobility') await page.getByRole('button', { name: 'รถเข็น', exact: true }).click()
    if (rejectedField === 'assistance') {
      const caregiver = page.getByRole('checkbox', { name: 'มีผู้ดูแลเดินทางไปด้วย', exact: true })
      await caregiver.focus()
      await caregiver.press('Space')
      await expect(caregiver).not.toBeChecked()
      await caregiver.press('Space')
      await expect(caregiver).toBeChecked()
    }
    if (rejectedField !== 'patientName') await expect(page.getByRole('group', { name: rejectedField === 'mobility' ? 'การช่วยเหลือ' : 'ความช่วยเหลือเพิ่มเติม', exact: true })).toHaveAttribute('aria-invalid', 'false')
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'ตรวจสอบข้อมูล', exact: true })).toBeVisible()
    let savedProfileId: string | undefined
    if (operation !== 'intake') {
      expect(bookingPosts).toBe(0)
      await expect(page.getByRole('button', { name: 'ลองส่งคำขออีกครั้ง', exact: true })).toHaveCount(0)
      await expect(page.getByRole('alert')).toContainText('บันทึกข้อมูลผู้ป่วยไม่สำเร็จ')
      const profileSaved = page.waitForResponse(r => r.url().endsWith(targetPath) && r.request().method() === 'POST')
      await page.getByRole('button', { name: profileButton, exact: true }).click()
      expect((await profileSaved).status()).toBe(operation === 'profile-create' ? 201 : 200)
      const updated = await (await profileSaved).json()
      savedProfileId = updated.id
      expect(updated).toMatchObject({ patientName: patient.trim(), contactPhone: '0800000001', mobility: 'wheelchair', assistance: ['boarding_support', 'caregiver_accompanies'], pickupAddress: address.trim(), landmark: landmark.trim() })
      if (operation === 'profile-update') expect(updated.id).toBe(profile.id)
      else expect(updated.id).not.toBe(profile.id)
      await expect(page.getByRole('checkbox', { name: 'บันทึกข้อมูลผู้ป่วยไว้ใช้ครั้งต่อไป', exact: true })).not.toBeChecked()
      await expect(page.getByRole('alert')).toHaveCount(0)
      expect(bookingPosts).toBe(0)
      expect((await owner('/profiles')).profiles).toHaveLength(operation === 'profile-create' ? 2 : 1)
    }
    const saved = page.waitForResponse(r => r.url().endsWith('/api/bookings') && r.request().method() === 'POST')
    await page.getByRole('button', { name: operation === 'intake' ? 'ลองส่งคำขออีกครั้ง' : 'ยืนยันและส่งคำขอ', exact: true }).click()
    expect((await saved).status()).toBe(201)
    const booking = await (await saved).json()
    await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toBeVisible()
    expect(booking).toMatchObject({ patientName: patient.trim(), requesterName: requester.trim(), contactPhone: '0800000001', pickupAddress: address.trim(), landmark: landmark.trim(), mobility: 'wheelchair', assistance: ['boarding_support', 'caregiver_accompanies'], bookingFor: 'other', latitude: 18.59, longitude: 99.05 })
    expect(submitted).toHaveLength(2)
    expect(bookingPosts).toBe(operation === 'intake' ? 2 : 1)
    if (savedProfileId) expect(booking.patientProfileId).toBe(savedProfileId)
    expect((await owner('/bookings')).bookings).toHaveLength(2)
    if (operation === 'profile-update') expect((await snapshots()).slice(0, 4)).toEqual(original.slice(0, 4))
    else expect(await snapshots()).toEqual(original)
    expect((await f.pool.query('SELECT * FROM patient_transfer.locations WHERE id=$1', [original[4][0].pickup_location_id])).rows).toEqual(oldLocation)
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.every(row => row.status === 'PENDING' && row.attempts === 0)).toBe(true)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); await f.close()
  }
})
