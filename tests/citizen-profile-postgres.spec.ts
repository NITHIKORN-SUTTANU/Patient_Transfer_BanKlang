import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { startOperationalTestApi, ids } from './helpers/operational-postgres'
import { recoveryFingerprint } from '../scripts/database/recovery.mjs'
import { createApi } from '../server/app.mjs'

test.use({ actionTimeout: 10000 })
test.beforeEach(() => test.skip(!process.env.DATABASE_TEST_ADMIN_URL, 'Local test database required'))

for (const scenario of [null, 'profile', 'intake', 'notice-profile', 'notice-intake', 'village-inactive', 'village-boundary'] as const) test(`original citizen profile reuse preserves snapshots${scenario ? ` and rejects stale state for ${scenario}` : ''}`, async ({ page, browser }) => {
  test.setTimeout(60000)
  const noticeChanged = scenario?.startsWith('notice-') ?? false
  const villageChanged = scenario?.startsWith('village-') ?? false
  const staleAction = villageChanged ? null : scenario?.endsWith('profile') ? 'profile' : scenario ? 'intake' : null
  let recoveredVillage = ids.village
  const ownerSubject = `U${'a'.repeat(32)}`
  const f = await startOperationalTestApi({ liffId: 'synthetic-profile', verifyLine: async token => {
    expect(['synthetic-profile-owner', 'synthetic-profile-other']).toContain(token)
    return { subject: token.endsWith('owner') ? ownerSubject : `U${'b'.repeat(32)}`, name: 'ผู้จองทดสอบข้อมูลบันทึก' }
  } })
  let activeBase = f.base
  let replacement: ReturnType<typeof createApi> | undefined
  let authorization = ''
  const bookingWrites: Record<string, unknown>[] = []
  try {
    await page.clock.install({ time: new Date(f.control.now) })
    await page.route('**/src/services/lineClient.ts', route => route.fulfill({ contentType: 'application/javascript', body: 'export async function lineIdToken() { return "synthetic-profile-owner" }' }))
    const profileWrites: { path: string; body: Record<string, unknown> }[] = []
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url())
      if (request.headers().authorization) authorization = request.headers().authorization
      if (url.pathname === '/api/bookings' && request.method() === 'POST') bookingWrites.push(request.postDataJSON())
      if (url.pathname.startsWith('/api/profiles') && request.method() === 'POST') profileWrites.push({ path: url.pathname, body: request.postDataJSON() })
      await route.fulfill({ response: await route.fetch({ url: `${activeBase}${url.pathname}${url.search}` }) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line\.me|line-scdn).*/, route => route.abort())
    async function begin(profileId?: string) {
      await page.goto('/booking')
      await page.getByRole('button', { name: 'เริ่มจองรถ →', exact: true }).click()
      await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
      await page.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
      if (profileId) {
        await page.getByLabel('ข้อมูลผู้ป่วยที่บันทึกไว้').selectOption(profileId)
        await expect(page.getByLabel('ชื่อผู้ป่วย *', { exact: true })).toHaveValue('ผู้ป่วยข้อมูลเดิม')
        await expect(page.getByLabel('เบอร์โทรศัพท์ของคุณ *', { exact: true })).toHaveValue('0800000000')
        await page.getByLabel('ชื่อผู้ป่วย *', { exact: true }).fill('ผู้ป่วยข้อมูลใหม่')
        await page.getByLabel('เบอร์โทรศัพท์ของคุณ *', { exact: true }).fill('0800000001')
      } else {
        await page.getByLabel('ชื่อผู้ป่วย *', { exact: true }).fill('ผู้ป่วยข้อมูลเดิม')
        await page.getByLabel('เบอร์โทรศัพท์ของคุณ *', { exact: true }).fill('0800000000')
      }
      await page.getByLabel('โรงพยาบาล *', { exact: true }).selectOption(ids.hospital)
      await page.locator('.booking-input-trigger').nth(0).click()
      await page.getByRole('button', { name: /15 มกราคม/ }).click()
      await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()
      await page.locator('.booking-input-trigger').nth(1).click()
      await page.getByRole('listbox', { name: 'ชั่วโมง', exact: true }).press('9')
      await page.getByRole('listbox', { name: 'นาที', exact: true }).press('Home')
      await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
      await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
      if (profileId) {
        await expect(page.getByLabel('ที่อยู่จุดรับ *')).toHaveValue('บ้านข้อมูลเดิม')
        await expect(page.getByLabel('หมู่บ้านในเขตบริการ *')).toHaveValue(ids.village)
        await page.getByRole('button', { name: 'รถเข็น', exact: true }).click()
        await page.getByRole('checkbox', { name: 'มีผู้ดูแลเดินทางไปด้วย', exact: true }).check()
      } else await page.getByLabel('หมู่บ้านในเขตบริการ *').selectOption(ids.village)
      await page.getByLabel('ที่อยู่จุดรับ *').fill(profileId ? 'บ้านข้อมูลใหม่' : 'บ้านข้อมูลเดิม')
      await page.getByText('เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง', { exact: true }).click()
      if (profileId) {
        await expect(page.getByLabel('ละติจูด', { exact: true })).toHaveValue('18.59')
        await expect(page.getByLabel('ลองจิจูด', { exact: true })).toHaveValue('99.05')
      }
      await page.getByLabel('ละติจูด', { exact: true }).fill(profileId ? '18.591' : '18.59')
      await page.getByLabel('ลองจิจูด', { exact: true }).fill(profileId ? '99.051' : '99.05')
      await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'ตรวจสอบข้อมูล', exact: true })).toBeVisible()
      await expect(page.getByText(profileId ? 'ผู้ป่วยข้อมูลใหม่' : 'ผู้ป่วยข้อมูลเดิม', { exact: true })).toBeVisible()
      await page.getByRole('checkbox', { name: 'บันทึกข้อมูลผู้ป่วยไว้ใช้ครั้งต่อไป', exact: true }).check()
      if (profileId && villageChanged) {
        const data = await f.request('/admin/service-data', 'admin')
        const village = data.villages.find((row: { id: string }) => row.id === ids.village)
        recoveredVillage = data.villages.find((row: { id: string; active: boolean }) => row.id !== ids.village && row.active).id
        await f.request(`/admin/villages/${ids.village}`, 'admin', { name: village.name, number: village.number,
          active: scenario !== 'village-inactive', shape: 'circle', latitude: scenario === 'village-boundary' ? 19 : village.latitude,
          longitude: scenario === 'village-boundary' ? 100 : village.longitude, radiusMetres: village.radiusMetres,
          expectedRevision: village.revision, reason: 'ทดสอบการเปลี่ยนเขตบริการของข้อมูลบันทึก' })
        const afterChange = await bookingLedger()
        expect(afterChange.slice(1)).toEqual(original.slice(1))
        expect(afterChange[0]).toEqual(original[0].map(row => ({ ...row, revision: String(BigInt(row.revision) + 1n), schedule_review_required: true })))
        original = afterChange
        const before = await recoveryFingerprint(f.pool)
        const consent = (await f.pool.query('SELECT id FROM patient_transfer.consent_records WHERE user_id=$1 ORDER BY decision_order DESC LIMIT 1', [oldProfile.requester_id])).rows[0]
        const deniedIntake = await fetch(`${activeBase}/api/bookings`, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...bookingWrites[0], requestId: randomUUID(), consentId: consent.id }) })
        expect(deniedIntake.status).toBe(422)
        expect((await deniedIntake.json()).error).toBe('Consent, hospital or service-area validation failed')
        const deniedProfile = page.waitForResponse(r => r.url().endsWith(`/api/profiles/${profileId}`) && r.request().method() === 'POST')
        await page.getByRole('button', { name: 'อัปเดตข้อมูลผู้ป่วยที่บันทึกไว้', exact: true }).click()
        expect((await deniedProfile).status()).toBe(422)
        expect((await (await deniedProfile).json()).error).toBe('Pickup is outside active service scope')
        await expect(page.getByRole('heading', { name: 'ตรวจสอบข้อมูล', exact: true })).toBeVisible()
        await page.getByRole('checkbox', { name: 'บันทึกข้อมูลผู้ป่วยไว้ใช้ครั้งต่อไป', exact: true }).uncheck()
        const deniedBooking = page.waitForResponse(r => r.url().endsWith('/api/bookings') && r.request().method() === 'POST')
        await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ', exact: true }).click()
        expect((await deniedBooking).status()).toBe(422)
        await expect(page.getByRole('button', { name: 'ลองส่งคำขออีกครั้ง', exact: true })).toBeVisible()
        expect(await recoveryFingerprint(f.pool)).toEqual(before)
        const context = await browser.newContext()
        const fresh = await context.newPage()
        try {
          await fresh.route('**/src/services/lineClient.ts', route => route.fulfill({ contentType: 'application/javascript', body: 'export async function lineIdToken() { return "synthetic-profile-owner" }' }))
          await fresh.route('**/api/**', async route => {
            const url = new URL(route.request().url())
            await route.fulfill({ response: await route.fetch({ url: `${activeBase}${url.pathname}${url.search}` }) })
          })
          await fresh.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line\.me|line-scdn).*/, route => route.abort())
          const profiles = fresh.waitForResponse(r => r.url().endsWith('/api/profiles'))
          await fresh.goto('/booking')
          expect((await (await profiles).json()).profiles).toEqual([])
          await fresh.getByRole('button', { name: 'เริ่มจองรถ →', exact: true }).click()
          await fresh.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
          await fresh.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
          await expect(fresh.getByLabel('ชื่อผู้ป่วย *', { exact: true })).toHaveValue('')
          await expect(fresh.getByLabel('ข้อมูลผู้ป่วยที่บันทึกไว้')).toHaveCount(0)
        } finally { await fresh.unrouteAll({ behavior: 'ignoreErrors' }); await context.close() }
        // The fresh same-owner acceptance supersedes this draft's consent; explicitly accept again.
        await page.getByRole('button', { name: 'แก้ไข ข้อมูลผู้ป่วย', exact: true }).click()
        await expect(page.getByLabel('ชื่อผู้ป่วย *', { exact: true })).toHaveValue('ผู้ป่วยข้อมูลใหม่')
        await expect(page.getByLabel('เบอร์โทรศัพท์ของคุณ *', { exact: true })).toHaveValue('0800000001')
        await page.getByRole('button', { name: 'ย้อนกลับ', exact: true }).click()
        await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
        await page.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
        await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
        await expect(page.getByLabel('ที่อยู่จุดรับ *')).toHaveValue('บ้านข้อมูลใหม่')
        await expect(page.getByRole('checkbox', { name: 'มีผู้ดูแลเดินทางไปด้วย', exact: true })).toBeChecked()
        await page.getByLabel('หมู่บ้านในเขตบริการ *').selectOption(recoveredVillage)
        await page.getByText('เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง', { exact: true }).click()
        await expect(page.getByLabel('ละติจูด', { exact: true })).toHaveValue('18.591')
        await expect(page.getByLabel('ลองจิจูด', { exact: true })).toHaveValue('99.051')
        await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
        await expect(page.getByRole('heading', { name: 'ตรวจสอบข้อมูล', exact: true })).toBeVisible()
        await page.getByRole('checkbox', { name: 'บันทึกข้อมูลผู้ป่วยไว้ใช้ครั้งต่อไป', exact: true }).check()
      }
      if (profileId && staleAction) {
        const context = await browser.newContext()
        const other = await context.newPage()
        try {
          await other.route('**/src/services/lineClient.ts', route => route.fulfill({ contentType: 'application/javascript', body: 'export async function lineIdToken() { return "synthetic-profile-owner" }' }))
          await other.route('**/api/**', async route => {
            const url = new URL(route.request().url())
            await route.fulfill({ response: await route.fetch({ url: `${f.base}${url.pathname}${url.search}` }) })
          })
          await other.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line\.me|line-scdn).*/, route => route.abort())
          const consentHistory = (await f.pool.query('SELECT * FROM patient_transfer.consent_records ORDER BY decision_order')).rows
          if (noticeChanged) {
            // A configuration rollout replaces the API process, retaining the same database/sessions.
            replacement = createApi({ pool: f.pool, clock: () => f.control.now, noticeVersion: 'synthetic-v2', noticeText: 'ประกาศฉบับใหม่สำหรับทดสอบ', liffId: 'synthetic-profile',
              verifyLine: async () => { throw new Error('External LINE disabled') }, route: async () => { throw new Error('External routing disabled') } })
            await new Promise<void>(resolve => replacement!.listen(0, '127.0.0.1', resolve))
            const address = replacement.address()
            if (!address || typeof address === 'string') throw new Error('Temporary API address required')
            activeBase = `http://127.0.0.1:${address.port}`
          } else {
            await other.goto('/booking')
            await other.getByRole('button', { name: 'เริ่มจองรถ →', exact: true }).click()
            const refusal = other.waitForResponse(r => r.url().endsWith('/api/consents') && r.request().method() === 'POST')
            await other.getByRole('button', { name: 'ไม่ยินยอมใช้ข้อมูล', exact: true }).click()
            expect((await refusal).status()).toBe(201)
          }
          const before = await recoveryFingerprint(f.pool)
          if (noticeChanged) {
            for (const [path, body] of [[`/profiles/${profileId}`, profileWrites[0].body], ['/bookings', bookingWrites[0]]] as const) {
              const response = await fetch(`${activeBase}/api${path}`, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(path === '/bookings' ? { ...body, requestId: randomUUID() } : body) })
              expect(response.status).toBe(422)
              expect((await response.json()).details.field).toBe('consentId')
            }
            expect(await recoveryFingerprint(f.pool)).toEqual(before)
          }
          if (staleAction === 'intake') await page.getByRole('checkbox', { name: 'บันทึกข้อมูลผู้ป่วยไว้ใช้ครั้งต่อไป', exact: true }).uncheck()
          const denied = noticeChanged && staleAction === 'intake' ? null : page.waitForResponse(r => r.url().includes(staleAction === 'profile' ? '/api/profiles/' : '/api/bookings') && r.request().method() === 'POST')
          await page.getByRole('button', { name: staleAction === 'profile' ? 'อัปเดตข้อมูลผู้ป่วยที่บันทึกไว้' : 'ยืนยันและส่งคำขอ', exact: true }).click()
          if (denied) expect((await denied).status()).toBe(422)
          await expect(page).toHaveURL(/\/booking\/privacy$/)
          expect(await recoveryFingerprint(f.pool)).toEqual(before)
          if (noticeChanged && staleAction === 'intake') {
            expect(bookingWrites).toHaveLength(1)
            expect(profileWrites).toHaveLength(1)
            await expect(page.getByText('ประกาศฉบับใหม่สำหรับทดสอบ', { exact: true })).toBeVisible()
          }
          await expect(page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ })).not.toBeChecked()
          await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
          await page.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
          if (noticeChanged && staleAction === 'profile') {
            // The first acceptance attempt refreshes the old displayed notice; it cannot record acceptance.
            await expect(page.getByText('ประกาศเปลี่ยนแล้ว กรุณาอ่านประกาศล่าสุดและยืนยันอีกครั้ง', { exact: true })).toBeVisible()
            await expect(page.getByText('ประกาศฉบับใหม่สำหรับทดสอบ', { exact: true })).toBeVisible()
            expect(await recoveryFingerprint(f.pool)).toEqual(before)
            await expect(page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ })).not.toBeChecked()
            await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
            await page.getByRole('button', { name: 'รับทราบและถัดไป', exact: true }).click()
          }
          await expect(page.getByLabel('ชื่อผู้ป่วย *', { exact: true })).toHaveValue('ผู้ป่วยข้อมูลใหม่')
          await expect(page.getByLabel('เบอร์โทรศัพท์ของคุณ *', { exact: true })).toHaveValue('0800000001')
          await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
          await expect(page.getByLabel('ที่อยู่จุดรับ *')).toHaveValue('บ้านข้อมูลใหม่')
          await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
          await page.getByRole('checkbox', { name: 'บันทึกข้อมูลผู้ป่วยไว้ใช้ครั้งต่อไป', exact: true }).check()
          if (noticeChanged) {
            expect((await f.pool.query('SELECT * FROM patient_transfer.consent_records WHERE id=ANY($1::uuid[]) ORDER BY decision_order', [consentHistory.map(row => row.id)])).rows).toEqual(consentHistory)
            const latest = (await f.pool.query('SELECT * FROM patient_transfer.consent_records ORDER BY decision_order DESC LIMIT 1')).rows[0]
            expect(latest).toMatchObject({ notice_version: 'synthetic-v2', accepted: true, user_id: consentHistory.at(-1).user_id })
          }
        } finally {
          await other.unrouteAll({ behavior: 'ignoreErrors' }); await context.close()
        }
      }
      const saved = page.waitForResponse(r => r.url().includes('/api/profiles') && r.request().method() === 'POST')
      await page.getByRole('button', { name: profileId ? 'อัปเดตข้อมูลผู้ป่วยที่บันทึกไว้' : 'บันทึกข้อมูลผู้ป่วย', exact: true }).click()
      const response = await saved
      expect(response.status()).toBe(profileId ? 200 : 201)
      return response.json()
    }
    async function submit() {
      const saved = page.waitForResponse(r => r.url().endsWith('/api/bookings') && r.request().method() === 'POST')
      await page.getByRole('button', { name: /^(ยืนยันและส่งคำขอ|ลองส่งคำขออีกครั้ง)$/ }).click()
      const response = await saved
      expect(response.status()).toBe(201)
      await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toBeVisible()
      return response.json()
    }
    const profile = await begin()
    const first = await submit()
    async function bookingLedger() {
      const rows = []
      for (const [table, key] of [['bookings', 'id'], ['trip_events', 'booking_id'], ['audit_logs', 'entity_id'], ['notifications', 'booking_id']]) rows.push((await f.pool.query(`SELECT * FROM patient_transfer.${table} WHERE ${key}=$1 ORDER BY id`, [first.id])).rows)
      return rows
    }
    let original = await bookingLedger()
    const oldProfile = (await f.pool.query('SELECT * FROM patient_transfer.patient_profiles WHERE id=$1', [profile.id])).rows[0]
    const oldLocation = (await f.pool.query('SELECT * FROM patient_transfer.locations WHERE id=$1', [oldProfile.pickup_location_id])).rows[0]
    const updated = await begin(profile.id)
    expect(updated.id).toBe(profile.id)
    expect(updated).toMatchObject({ patientName: 'ผู้ป่วยข้อมูลใหม่', contactPhone: '0800000001', mobility: 'wheelchair', assistance: ['caregiver_accompanies'], pickupAddress: 'บ้านข้อมูลใหม่', latitude: 18.591, longitude: 99.051, villageId: recoveredVillage })
    expect(await bookingLedger()).toEqual(original)
    const second = await submit()
    expect(second).toMatchObject({ patientProfileId: profile.id, patientName: updated.patientName, contactPhone: updated.contactPhone, mobility: updated.mobility, assistance: updated.assistance, latitude: updated.latitude, longitude: updated.longitude, pickupAddress: updated.pickupAddress })
    expect(second.id).not.toBe(first.id); expect(second.reference).not.toBe(first.reference)
    expect(first.patientProfileId).toBe(profile.id)
    expect(await bookingLedger()).toEqual(original)
    expect((await f.pool.query('SELECT * FROM patient_transfer.locations WHERE id=$1', [oldLocation.id])).rows).toEqual([oldLocation])
    const savedProfile = (await f.pool.query('SELECT * FROM patient_transfer.patient_profiles WHERE id=$1', [profile.id])).rows[0]
    expect(savedProfile.pickup_location_id).not.toBe(oldProfile.pickup_location_id)
    expect(savedProfile.requester_id).toBe(oldProfile.requester_id)
    expect(profileWrites.map(w => w.path)).toEqual(['/api/profiles', ...(staleAction === 'profile' || villageChanged ? [`/api/profiles/${profile.id}`] : []), `/api/profiles/${profile.id}`])
    const login = await f.request('/auth/line', 'citizen', { idToken: 'synthetic-profile-other' })
    async function foreign(path: string, body?: unknown, status = 200) {
      const response = await fetch(`${activeBase}/api${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${login.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
      expect(response.status).toBe(status)
      return response.json()
    }
    expect((await foreign('/profiles')).profiles).toEqual([])
    const consent = await foreign('/consents', { accepted: true, noticeVersion: noticeChanged ? 'synthetic-v2' : 'development-v1' }, 201)
    const beforeDenied = await recoveryFingerprint(f.pool)
    await foreign(`/profiles/${profile.id}`, { ...profileWrites[1].body, consentId: consent.id }, 404)
    expect(await recoveryFingerprint(f.pool)).toEqual(beforeDenied)
    const rows = (await f.pool.query(`SELECT b.*,u.line_subject,c.user_id AS consent_owner,c.accepted FROM patient_transfer.bookings b
      JOIN patient_transfer.users u ON u.id=b.requester_id JOIN patient_transfer.consent_records c ON c.id=b.consent_id ORDER BY b.reference`)).rows
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.patient_profile_id === profile.id && r.requester_id === savedProfile.requester_id && r.requester_id === r.consent_owner && r.accepted && r.line_subject === ownerSubject && r.status === 'REQUESTED')).toBe(true)
    expect((await f.pool.query("SELECT action FROM patient_transfer.audit_logs WHERE entity_id=$1 AND entity_type='patient_profile' ORDER BY action", [profile.id])).rows).toEqual([{ action: 'CREATE_PROFILE' }, { action: 'UPDATE_PROFILE' }])
    const messages = (await f.pool.query('SELECT status,attempts FROM patient_transfer.notifications')).rows
    expect(messages.every(r => r.status === 'PENDING' && r.attempts === 0)).toBe(true)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close()
    if (replacement) { replacement.closeAllConnections(); await new Promise<void>(resolve => replacement!.close(() => resolve())) }
    await f.close()
  }
})
