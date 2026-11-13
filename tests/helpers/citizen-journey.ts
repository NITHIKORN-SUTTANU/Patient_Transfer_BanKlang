import { expect, type Browser, type Page } from '@playwright/test'
import type pg from 'pg'
import { syntheticPassword } from './admin-postgres.mjs'
import { ids } from './operational-postgres'

// Only external adapters are synthetic; browser API requests reach the real server.
export async function completeCitizenJourney({ browser, citizen, pool, base, control, bookingId, outcome }: {
  browser: Browser; citizen: Page; pool: pg.Pool; base: string; control: { now: string }; bookingId: string; outcome: 'handover' | 'failed pickup' | 'aborted'
}) {
  const contexts = []
  async function staff(role: 'dispatcher' | 'driver', path: string = role) {
    const context = await browser.newContext()
    contexts.push(context)
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date(control.now))
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      await route.fulfill({ response: await route.fetch({ url: `${base}${url.pathname}${url.search}` }) })
    })
    await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
    await page.goto(`/staff/login?next=${encodeURIComponent(`/${path}`)}`)
    await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill(`synthetic-${role}`)
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(syntheticPassword)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByRole('link', { name: role === 'driver' ? 'เปิดหน้าคนขับ' : 'เปิดหน้าจัดรถ', exact: true }).click()
    return page
  }
  async function state() {
    return (await pool.query(`SELECT status,started_at,incident_open,EXISTS(SELECT 1 FROM patient_transfer.resource_holds h WHERE h.booking_id=b.id AND h.ends_at IS NULL) AS resource_hold FROM patient_transfer.bookings b WHERE id=$1`, [bookingId])).rows[0]
  }
  try {
    let dispatch = await staff('dispatcher')
    await dispatch.getByRole('button', { name: 'ดูรายละเอียด →', exact: true }).click()
    await dispatch.getByRole('button', { name: 'อนุมัติคำขอ', exact: true }).click()
    await dispatch.getByRole('button', { name: 'ยืนยันอนุมัติ', exact: true }).click()
    await dispatch.getByRole('link', { name: 'จัดตารางและมอบหมาย', exact: true }).click()
    await dispatch.getByRole('button', { name: 'รถรับส่ง: เลือกรถ', exact: true }).click()
    await dispatch.getByRole('option', { name: /Synthetic vehicle 1/ }).click()
    await dispatch.getByRole('button', { name: 'คนขับ: เลือกคนขับ', exact: true }).click()
    await dispatch.getByRole('option', { name: /Synthetic driver/ }).click()
    await dispatch.getByRole('button', { name: 'ตรวจสอบและยืนยันตาราง', exact: true }).click()
    await dispatch.getByRole('button', { name: 'ยืนยันตาราง', exact: true }).click()
    await expect(dispatch.getByText('ยืนยันตารางแล้ว ยังไม่จองรถหรือคนขับจนกว่าจะยืนยันการมอบหมาย')).toBeVisible()
    expect((await pool.query('SELECT count(*)::int AS n FROM patient_transfer.schedules WHERE booking_id=$1 AND committed AND released_at IS NULL', [bookingId])).rows[0].n).toBe(0)
    await dispatch.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
    await dispatch.getByRole('button', { name: 'ยืนยันการมอบหมาย', exact: true }).click()
    await expect(dispatch).toHaveURL(/dispatcher\/tracking$/)
    const { rows: [schedule] } = await pool.query('SELECT * FROM patient_transfer.schedules WHERE booking_id=$1 AND committed AND released_at IS NULL', [bookingId])
    control.now = schedule.departure_at.toISOString()
    const driver = await staff('driver')
    await driver.getByRole('button', { name: /ดูรายละเอียดงาน/ }).click()
    async function milestone(name: string, status: string) {
      await driver.getByRole('button', { name, exact: true }).click()
      const committed = driver.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
      await driver.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
      expect((await committed).status()).toBe(200)
      await expect.poll(async () => (await state()).status).toBe(status)
      await expect(driver.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
    }
    await milestone('เริ่มงาน', 'ASSIGNED')
    await expect(driver.getByRole('heading', { name: 'เริ่มงานแล้ว · ยังไม่ออกจากต้นทาง', exact: true })).toBeVisible()
    expect((await state()).started_at).toBeTruthy()
    await citizen.reload()
    await expect(citizen.getByRole('heading', { name: 'สถานะการจอง', exact: true })).toBeVisible()
    await expect(citizen.getByRole('button', { name: 'ยกเลิกการจอง', exact: true })).toHaveCount(0)
    await milestone('ออกจากต้นทางไปรับผู้ป่วย', 'PICKING_UP')
    control.now = schedule.pickup_at.toISOString()
    if (outcome === 'aborted') {
      await milestone('รับผู้ป่วยขึ้นรถแล้ว', 'PICKED_UP')
      // A second real driver session holds an older confirmation across the incident.
      const staleDriver = await staff('driver', `driver/status?booking=${bookingId}`)
      await staleDriver.getByRole('button', { name: 'ออกเดินทางไปโรงพยาบาล', exact: true }).click()
      await driver.getByRole('button', { name: 'รายงานเหตุขัดข้อง', exact: true }).click()
      await driver.getByLabel('เหตุผลที่รายงาน').fill('รถขัดข้องหลังรับผู้ป่วย ต้องจัดการรับช่วงต่อ')
      const reported = driver.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
      await driver.getByRole('button', { name: 'ยืนยันรายงานเหตุขัดข้อง', exact: true }).click()
      expect((await reported).status()).toBe(200)
      await expect(driver.getByRole('button', { name: 'ออกเดินทางไปโรงพยาบาล', exact: true })).toBeDisabled()
      const staleResponse = staleDriver.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
      await staleDriver.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
      const rejected = await staleResponse
      expect(rejected.status()).toBe(409)
      await expect(staleDriver.getByRole('alert')).toContainText('ข้อมูลหรือความพร้อมเปลี่ยนแล้ว')
      expect(await state()).toMatchObject({ status: 'PICKED_UP', incident_open: true, resource_hold: true })
      const current = (await pool.query('SELECT revision,execution_version FROM patient_transfer.bookings WHERE id=$1', [bookingId])).rows[0]
      // Current revisions cannot bypass either the incident or dispatcher-only ABORT authority.
      for (const type of ['DEPART_FOR_HOSPITAL', 'ABORT']) {
        const result = await driver.request.post(`${base}/api/bookings/${bookingId}/commands`, {
          headers: { authorization: rejected.request().headers().authorization },
          data: { eventId: crypto.randomUUID(), expectedRevision: Number(current.revision), expectedExecutionVersion: current.execution_version,
            command: type === 'ABORT' ? { type, reason: 'ตรวจสิทธิ์', endedAt: control.now, location: 'จุดปลอดภัย', disposition: 'ผู้ดูแลรับช่วง' } : { type } },
        })
        expect(result.status()).toBe(type === 'ABORT' ? 403 : 409)
        expect((await result.json()).error).toBe(type === 'ABORT' ? 'Dispatcher authority required' : 'Dispatcher must resolve the incident before normal progression')
      }
      dispatch = await staff('dispatcher', `dispatcher/tracking?booking=${bookingId}&dialog=tracking`)
      await dispatch.getByLabel(/^การดำเนินการ/).selectOption('ABORT')
      await dispatch.getByLabel('เหตุผล', { exact: true }).fill('ยุติการรับส่งจริงหลังรถขัดข้อง')
      const bangkokEnd = new Date(Date.parse(control.now) + 7 * 3600000).toISOString().slice(0, 16)
      await dispatch.getByLabel('เวลาจบการเดินทางจริง (เวลาไทย)').fill(bangkokEnd)
      await dispatch.getByLabel('สถานที่จบการเดินทาง', { exact: true }).fill('จุดปลอดภัยในหมู่บ้าน')
      await dispatch.getByLabel('การส่งมอบผู้ป่วยหรือแผนรับช่วงต่อ').fill('ส่งมอบให้ผู้ดูแลและรถรับช่วงที่ยืนยันแล้ว')
      await dispatch.getByRole('checkbox', { name: 'ตรวจสอบสถานการณ์จริงและยืนยันการดำเนินการนี้แล้ว', exact: true }).check()
      const aborted = dispatch.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST')
      await dispatch.getByRole('button', { name: 'ยืนยันการดำเนินการ', exact: true }).click()
      expect((await aborted).status()).toBe(200)
      expect(await state()).toMatchObject({ status: 'ABORTED', incident_open: true, resource_hold: true })
      await driver.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
      await driver.getByRole('link', { name: /ประวัติ/ }).click()
    } else if (outcome === 'handover') {
      await milestone('รับผู้ป่วยขึ้นรถแล้ว', 'PICKED_UP')
      await milestone('ออกเดินทางไปโรงพยาบาล', 'IN_TRANSIT')
      control.now = schedule.arrival_at.toISOString()
      await milestone('ส่งถึงโรงพยาบาลแล้ว', 'COMPLETED')
    } else {
      await driver.getByRole('button', { name: 'รับผู้ป่วยไม่ได้', exact: true }).click()
      await driver.getByLabel('เหตุผลที่รายงาน').fill('ตรวจจุดรับแล้วไม่พบผู้ป่วย')
      await driver.getByRole('button', { name: 'ยืนยันรายงานรับไม่ได้', exact: true }).click()
    }
    await expect(driver).toHaveURL(/driver\/history$/)
    await expect(driver.getByText('ผู้ป่วยสังเคราะห์')).toHaveCount(0)
    await expect(driver.locator('a[href^="tel:"]')).toHaveCount(0)
    await citizen.reload()
    await expect(citizen.getByText(outcome === 'aborted' ? 'ไม่ได้ส่งถึงโรงพยาบาล กรุณาติดต่อเทศบาลเพื่อทราบการจัดการต่อ' : outcome === 'handover' ? 'ผู้ป่วยเดินทางถึงโรงพยาบาลแล้ว' : 'การยกเลิกได้รับการบันทึกแล้ว', { exact: true })).toBeVisible()
    if (outcome === 'aborted') await expect(citizen.getByText('ผู้ป่วยเดินทางถึงโรงพยาบาลแล้ว', { exact: true })).toHaveCount(0)
    expect(await state()).toMatchObject({ status: outcome === 'aborted' ? 'ABORTED' : outcome === 'handover' ? 'COMPLETED' : 'CANCELLED', resource_hold: true })
    control.now = schedule.ready_at.toISOString()
    // Intake and execution are days apart; the original staff session has expired.
    dispatch = await staff('dispatcher', 'dispatcher/tracking')
    for (const resource of [`vehicles/${ids.vehicle}`, `drivers/${ids.driver}`]) {
      await dispatch.getByText('ยืนยันตำแหน่งและความพร้อมรถหรือคนขับ', { exact: true }).click()
      await dispatch.getByLabel('ทรัพยากรที่ตรวจสอบ').selectOption(resource)
      await dispatch.getByLabel('ตำแหน่งปัจจุบันที่ยืนยันแล้ว').selectOption(outcome === 'handover' ? '20000000-0000-4000-8000-000000000002' : ids.depot)
      await dispatch.getByLabel('เหตุผลและผลตรวจสอบ', { exact: true }).fill('ตรวจตำแหน่งและความพร้อมจริงแล้ว')
      await dispatch.getByRole('checkbox', { name: 'ยืนยันตำแหน่งจริงและความพร้อมของทรัพยากรนี้แล้ว', exact: true }).check()
      const response = dispatch.waitForResponse(r => r.url().includes('/readiness') && r.request().method() === 'POST')
      const refreshed = dispatch.waitForResponse(r => r.url().endsWith('/catalog'))
      await dispatch.getByRole('button', { name: 'ยืนยันความพร้อมทรัพยากรนี้', exact: true }).click()
      expect((await response).status()).toBe(200)
      await refreshed
      await expect(dispatch.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
      if (resource.startsWith('vehicles')) expect((await state()).resource_hold).toBe(true)
      if (outcome === 'aborted') {
        expect((await state()).incident_open).toBe(resource.startsWith('vehicles'))
        const incident = (await pool.query('SELECT * FROM patient_transfer.trip_incidents WHERE booking_id=$1', [bookingId])).rows
        expect(incident).toHaveLength(1)
        expect(incident[0].reason).toBe('รถขัดข้องหลังรับผู้ป่วย ต้องจัดการรับช่วงต่อ')
        expect(!!incident[0].resolved_at).toBe(resource.startsWith('drivers'))
      }
    }
    expect((await state()).resource_hold).toBe(false)
    const commands = (await pool.query('SELECT command FROM patient_transfer.trip_events WHERE booking_id=$1 ORDER BY sequence', [bookingId])).rows.map(row => row.command)
    expect(commands).toEqual(outcome === 'handover'
      ? ['APPROVE', 'CONFIRM_SCHEDULE', 'ASSIGN', 'START_TRIP', 'DEPART_ORIGIN', 'CONFIRM_PICKUP', 'DEPART_FOR_HOSPITAL', 'CONFIRM_HANDOVER']
      : outcome === 'aborted' ? ['APPROVE', 'CONFIRM_SCHEDULE', 'ASSIGN', 'START_TRIP', 'DEPART_ORIGIN', 'CONFIRM_PICKUP', 'REPORT_INCIDENT', 'ABORT']
      : ['APPROVE', 'CONFIRM_SCHEDULE', 'ASSIGN', 'START_TRIP', 'DEPART_ORIGIN', 'FAILED_PICKUP'])
    if (outcome === 'aborted') {
      const disposition = (await pool.query('SELECT * FROM patient_transfer.trip_dispositions WHERE booking_id=$1', [bookingId])).rows[0]
      expect(disposition.end_location).toBe('จุดปลอดภัยในหมู่บ้าน')
      expect(disposition.patient_arrangement).toBe('ส่งมอบให้ผู้ดูแลและรถรับช่วงที่ยืนยันแล้ว')
      expect(disposition.ended_at.toISOString()).toBe(schedule.pickup_at.toISOString())
      await citizen.reload()
      await expect(citizen.getByText('ไม่ได้ส่งถึงโรงพยาบาล กรุณาติดต่อเทศบาลเพื่อทราบการจัดการต่อ', { exact: true })).toBeVisible()
    }
  } finally {
    for (const context of contexts) {
      for (const page of context.pages()) await page.unrouteAll({ behavior: 'wait' })
      await context.close()
    }
  }
}
