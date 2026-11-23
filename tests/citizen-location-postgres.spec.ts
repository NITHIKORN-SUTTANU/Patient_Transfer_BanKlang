import { chooseCitizenPickup } from './helpers/citizen-gps'
import { test, expect } from '@playwright/test'
import { startOperationalTestApi, ids } from './helpers/operational-postgres'
import { recoveryFingerprint } from '../scripts/database/recovery.mjs'

test.use({ actionTimeout: 10000 })
test.beforeEach(() => test.skip(!process.env.DATABASE_TEST_ADMIN_URL, 'Local test database required'))

for (const mode of ['denied', 'timeout', 'late', 'outside', 'inactive', 'address'] as const) test(`original citizen ${mode} location journey through real API and PostgreSQL`, async ({ page }) => {
  test.setTimeout(60000)
  const subject = `U${'f'.repeat(32)}`
  const f = await startOperationalTestApi({ liffId: 'synthetic-location', verifyLine: async token => {
    expect(token).toBe('synthetic-location-token')
    return { subject, name: 'ผู้จองทดสอบพิกัด' }
  } })
  try {
    if (mode === 'inactive') {
      await f.pool.query('UPDATE patient_transfer.service_villages SET active=false WHERE id<>$1', [ids.village])
    }
    await page.clock.install({ time: new Date(f.control.now) })
    await page.addInitScript(mode => {
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
        getCurrentPosition: (success: PositionCallback, failure: PositionErrorCallback) => {
          if (mode === 'late') {
            (window as unknown as { lateGPS: () => void }).lateGPS = () => success({ coords: { latitude: 1, longitude: 2, accuracy: 5 } } as GeolocationPosition)
          } else failure({ code: mode === 'denied' ? 1 : 3 } as GeolocationPositionError)
        },
      } })
    }, mode)
    await page.route('**/src/services/lineClient.ts', route => route.fulfill({ contentType: 'application/javascript', body: 'export async function lineIdToken() { return "synthetic-location-token" }' }))
    let submissions = 0
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/bookings' && route.request().method() === 'POST') submissions++
      await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line\.me|line-scdn).*/, route => route.abort())
    await page.goto('/booking')
    await page.getByRole('button', { name: 'เริ่มจองรถ →', exact: true }).click()
    await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
    await page.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
    await page.getByLabel('ชื่อผู้ป่วย *', { exact: true }).fill('ผู้ป่วยทดสอบพิกัด')
    await page.getByLabel('เบอร์โทรศัพท์ของคุณ *', { exact: true }).fill('0800000000')
    await page.getByLabel('โรงพยาบาล *', { exact: true }).selectOption(ids.hospital)
    await page.locator('.booking-input-trigger').nth(0).click()
    await page.getByRole('button', { name: /15 มกราคม/ }).click()
    await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()
    await page.locator('.booking-input-trigger').nth(1).click()
    await page.getByRole('listbox', { name: 'ชั่วโมง', exact: true }).press('9')
    await page.getByRole('listbox', { name: 'นาที', exact: true }).press('Home')
    await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    await expect(page.getByRole('radio', { name: 'เลือกจุดบนแผนที่', exact: true })).toBeChecked()
    await expect(page.getByLabel('ที่อยู่จุดรับ *')).toHaveCount(0)
    await expect(page.getByLabel('หมู่บ้านในเขตบริการ *')).toHaveCount(0)
    await expect(page.getByLabel('จุดสังเกต', { exact: true })).toHaveCount(0)
    if (mode === 'address') {
      await page.getByRole('radio', { name: 'กรอกที่อยู่แทนแผนที่', exact: true }).check()
      await page.getByLabel('หมู่บ้านในเขตบริการ *').selectOption(ids.village)
      await page.getByLabel('ที่อยู่จุดรับ *').fill('บ้านทดสอบพิกัดด้วยตนเอง')
      await expect(page.getByRole('button', { name: 'ใช้ตำแหน่งปัจจุบัน', exact: true })).toHaveCount(0)
      await page.getByLabel('จุดสังเกต', { exact: true }).fill('หน้าประตูสีเขียว')
      await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'ตรวจสอบข้อมูล', exact: true })).toBeVisible()
      await expect(page.getByText('หน้าประตูสีเขียว', { exact: true })).toBeVisible()
      await page.getByRole('checkbox', { name: 'บันทึกข้อมูลผู้ป่วยไว้ใช้ครั้งต่อไป', exact: true }).check()
      const submitted = page.waitForResponse(r => r.url().endsWith('/api/bookings') && r.request().method() === 'POST')
      await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ', exact: true }).click()
      const response = await submitted
      expect(response.status(), await response.text()).toBe(201)
      const body = response.request().postDataJSON()
      expect(body).toMatchObject({ pickupMethod: 'address', villageId: ids.village, landmark: 'หน้าประตูสีเขียว' })
      expect(body).not.toHaveProperty('latitude')
      expect(body).not.toHaveProperty('longitude')
      const booking = await response.json()
      expect(booking).toMatchObject({ status: 'REQUESTED', latitude: null, longitude: null })
      expect((await f.pool.query('SELECT pickup_location_id,pickup_address FROM patient_transfer.patient_profiles')).rows)
        .toContainEqual({ pickup_location_id: null, pickup_address: 'บ้านทดสอบพิกัดด้วยตนเอง' })
      await f.command(booking, 'APPROVE', {}, 'dispatcher', 422)
      await f.command(booking, 'APPROVE', { pickup: { latitude: 19, longitude: 100 } }, 'dispatcher', 422)
      expect(await f.get(booking.id)).toMatchObject({ status: 'REQUESTED', latitude: null, longitude: null, revision: booking.revision })
      expect(f.control.routeCalls).toHaveLength(0)
      const approved = await f.command(booking, 'APPROVE', { pickup: { latitude: 18.59, longitude: 99.05 } })
      expect(approved).toMatchObject({ status: 'APPROVED', latitude: 18.59, longitude: 99.05 })
      const scheduled = await f.request(`/bookings/${booking.id}/schedule`, 'dispatcher', f.selection(approved))
      expect(scheduled.status).toBe('SCHEDULED')
      expect(f.control.routeCalls).toHaveLength(2)
      return
    }
    const before = await recoveryFingerprint(f.pool)
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('กรุณาเลือกพิกัด')
    if (mode === 'denied' || mode === 'timeout' || mode === 'late') {
      await page.getByRole('button', { name: 'ใช้ตำแหน่งปัจจุบัน', exact: true }).click()
      if (mode !== 'late') {
        const dialog = page.getByRole('dialog', { name: 'ไม่พบตำแหน่งปัจจุบัน', exact: true })
        await expect(dialog.getByText('ยังจองรถต่อได้โดยปักหมุดเอง', { exact: true })).toBeVisible()
        await dialog.getByRole('button', { name: 'ย้อนกลับ', exact: true }).click()
      } else await expect(page.getByRole('button', { name: 'กำลังค้นหาตำแหน่ง…', exact: true })).toBeDisabled()
    }
    const latitude = mode === 'outside' ? '19.907' : '18.59'
    const longitude = mode === 'outside' ? '99.83' : '99.05'
    await chooseCitizenPickup(page, Number(latitude), Number(longitude))
    if (mode === 'late') await page.evaluate(() => (window as unknown as { lateGPS: () => void }).lateGPS())
    await expect(page.locator('.booking-pickup-value strong')).toContainText(Number(latitude).toFixed(6))
    expect(submissions).toBe(0)
    expect(await recoveryFingerprint(f.pool)).toEqual(before)
    await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'ตรวจสอบข้อมูล', exact: true })).toBeVisible()
    await expect(page.getByText('ผู้ป่วยทดสอบพิกัด', { exact: true })).toBeVisible()
        if (mode === 'inactive') await f.pool.query('UPDATE patient_transfer.service_villages SET active=false WHERE id=$1', [ids.village])
    if (mode === 'outside') await page.getByRole('checkbox', { name: 'บันทึกข้อมูลผู้ป่วยไว้ใช้ครั้งต่อไป', exact: true }).check()
const submitted = page.waitForResponse(r => r.url().endsWith('/api/bookings') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ', exact: true }).click()
    const response = await submitted
    expect(response.status()).toBe(201)
    expect(response.request().postDataJSON()).toMatchObject({ latitude: Number(latitude), longitude: Number(longitude), pickupMethod: 'map' })
    expect(response.request().postDataJSON()).not.toHaveProperty('pickupAddress')
    expect(response.request().postDataJSON()).not.toHaveProperty('villageId')
    await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toBeVisible()
    expect(submissions).toBe(1)
    const rows = (await f.pool.query(`SELECT b.*,ST_Y(b.pickup_point::geometry) AS latitude,ST_X(b.pickup_point::geometry) AS longitude,
      u.line_subject,c.user_id AS consent_owner,c.accepted,c.notice_version
      FROM patient_transfer.bookings b JOIN patient_transfer.users u ON u.id=b.requester_id
      JOIN patient_transfer.consent_records c ON c.id=b.consent_id`)).rows
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row).toMatchObject({ status: 'REQUESTED', latitude: Number(latitude), longitude: Number(longitude), village_id: mode === 'outside' || mode === 'inactive' ? null : ids.village,
      patient_name: 'ผู้ป่วยทดสอบพิกัด', pickup_address: 'จุดรับบนแผนที่', contact_phone: '0800000000',
      line_subject: subject, accepted: true, notice_version: 'development-v1', booking_for: 'self' })
    expect(row.requester_id).toBe(row.consent_owner)
    expect(row.submitted_at.getTime()).toBe(Date.parse(f.control.now))
    expect(row.appointment_at.toISOString()).toBe('2030-01-15T02:00:00.000Z')
    await expect(page.getByTitle(row.reference, { exact: true })).toBeVisible()
    await f.request(`/bookings/${row.id}`, 'citizen', undefined, 403)
    if (mode === 'outside') {
      const dispatcher = await f.get(row.id)
      expect(dispatcher).toMatchObject({ status: 'REQUESTED', villageId: null, latitude: 19.907, longitude: 99.83 })
      expect((await f.pool.query('SELECT village_id FROM patient_transfer.patient_profiles WHERE id=$1', [row.patient_profile_id])).rows)
        .toEqual([{ village_id: null }])
      expect(f.control.routeCalls).toHaveLength(0)
      const approved = await f.command(dispatcher, 'APPROVE')
      expect(approved).toMatchObject({ status: 'APPROVED', villageId: null, latitude: 19.907, longitude: 99.83 })
      const scheduled = await f.request(`/bookings/${row.id}/schedule`, 'dispatcher', f.selection(approved))
      expect(scheduled.status).toBe('SCHEDULED')
    }
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every(r => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); await f.close()
  }
})
