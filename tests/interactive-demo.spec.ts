import { expect, test } from '@playwright/test'
import { setPickerTime } from './time-picker'

test('interactive demo mode works end-to-end across all 4 roles and all 5 phases without any backend API or LINE LIFF', async ({ page }) => {
  // Block external map tiles/LINE CDN so test proves 100% offline/local interactive demo works without any backend route mock!
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line).*/, route => route.abort())

  // 1. Open landing page `/` and enter Admin directly by clicking the Admin role card (no /staff/login block).
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'เลือกบทบาทเพื่อทดลอง' })).toBeVisible()
  await page.locator('[data-actor-id="ACT-04"]').click()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.locator('#admin-main')).toBeVisible()
  await expect(page.locator('.demo-role-bar')).toBeVisible()

  // Phase 1 & Phase 4: Load 320 realistic seed bookings and check Executive Analytics 12-village dashboard.
  await page.getByRole('button', { name: 'โหลดข้อมูลตัวอย่าง 320 รายการ' }).first().click()
  await expect(page.getByText('ข้อมูลจำลองในระบบ: 320 รายการ')).toBeVisible()
  const analytics = page.locator('.admin-analytics-panel')
  await expect(analytics).toContainText('หมู่ 1 บ้านกลาง')
  await expect(analytics).toContainText('หมู่ 12 บ้านใหม่สันป่ายาง')

  // Reset seed data cleanly before running the 2-vehicle capacity overlap check.
  await page.getByRole('button', { name: 'ล้างข้อมูลจำลอง / รีเซ็ตระบบ' }).click()
  await page.getByRole('button', { name: 'ยืนยันล้างข้อมูลจำลอง' }).click()
  await expect(page.getByText('ยังไม่มีชุดข้อมูลจำลอง')).toBeVisible()

  // Phase 2 prep in Admin: Disable 3 vehicles leaving ONLY 2 active vehicles.
  await page.getByRole('link', { name: 'รถรับส่ง', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/vehicles$/)
  for (const id of ['demo-vehicle-3', 'demo-vehicle-4', 'demo-vehicle-5']) {
    const row = page.locator('tr', { hasText: id })
    await row.getByRole('button', { name: 'จัดการรถ' }).click()
    await page.getByLabel('สถานะรถ').selectOption('false')
    await page.getByLabel('เหตุผลในการเปลี่ยนแปลง').fill('ลดจำนวนรถเพื่อทดสอบความจุ')
    await page.getByRole('button', { name: 'บันทึก' }).click()
    await page.getByRole('button', { name: 'บันทึก' }).click()
    await expect(row.getByText('ปิดใช้งาน')).toBeVisible()
  }

  // 2. Switch to Citizen via DemoRoleBar (no real LINE LIFF required) and test 2-vehicle overlap blocking!
  await page.locator('.demo-role-bar').getByRole('button', { name: 'ผู้ป่วย / จองรถ' }).click()
  await expect(page).toHaveURL(/\/booking$/)
  await expect(page.getByRole('button', { name: 'เริ่มจองรถ →' })).toBeVisible()

  async function bookCitizenAt1330(name: string, phone: string, expectBlocked = false) {
    await page.getByRole('button', { name: 'เริ่มจองรถ →' }).click()
    await page.getByLabel(/รับทราบการใช้ข้อมูล/).check()
    await page.getByRole('button', { name: 'รับทราบและถัดไป' }).click()

    await page.getByLabel(/ชื่อผู้ป่วย/).fill(name)
    await page.getByLabel(/เบอร์โทรศัพท์ของคุณ/).fill(phone)
    await page.getByLabel(/โรงพยาบาล/).selectOption('hospital-lamphun')

    await page.locator('button.booking-input-trigger').first().click()
    await page.getByRole('button', { name: 'เดือนถัดไป', exact: true }).click()
    await page.locator('.booking-calendar button:not([disabled])', { hasText: /^\s*(?:[อาพพฤศส]\.\s*)?15$/ }).first().click()
    await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()

    await page.locator('button.booking-input-trigger').nth(1).click()
    await setPickerTime(page, 'ชั่วโมง', '13')
    await setPickerTime(page, 'นาที', '30')
    await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()

    if (expectBlocked) {
      await expect(page.locator('.booking-capacity-alert')).toContainText('ช่วงเวลาเต็ม / รถไม่ว่าง')
      return
    }

    await page.getByRole('button', { name: 'ถัดไป →' }).click()
    await page.getByRole('button', { name: 'เดินได้', exact: true }).click()
    await page.getByRole('checkbox', { name: 'ไม่ต้องการความช่วยเหลือเพิ่มเติม' }).check()
    await page.getByLabel(/หมู่บ้านในเขตบริการ/).selectOption('village-01')
    await page.getByLabel(/ที่อยู่จุดรับ/).fill('12 หมู่ 1 บ้านกลาง')
    await page.getByText('เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง').click()
    await page.getByLabel('ละติจูด').fill('18.5835')
    await page.getByLabel('ลองจิจูด').fill('99.0422')
    await page.getByRole('button', { name: 'ถัดไป →' }).click()
    await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ' }).click()
    await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'กลับหน้าหลัก' }).click()
  }

  await bookCitizenAt1330('นางสมศรี สาธิต 1', '0810000001')
  await bookCitizenAt1330('นายบุญมี สาธิต 2', '0810000002')
  await bookCitizenAt1330('นายสมชาย สาธิต 3', '0810000003', true)

  // 3. Switch to Dispatcher via DemoRoleBar — verify Phase 3 UI + Phase 5 Daily Map View + Approve & Assign!
  await page.locator('.demo-role-bar').getByRole('button', { name: 'เจ้าหน้าที่จัดรถ' }).click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  await expect(page.locator('.dispatch-fleet-bar')).toContainText('2 / 5 คัน')
  await expect(page.locator('.dispatch-window-chip').first()).toContainText('รถออก')
  await expect(page.locator('.dispatch-timeline-panel')).toContainText('ไทม์ไลน์รถและช่วงเวลาว่าง')

  // Verify Phase 5 Daily Dispatch Map View tab.
  await page.getByRole('button', { name: /มุมมองแผนที่รายวัน/ }).click()
  await expect(page.locator('.dispatch-map-view')).toBeVisible()
  await expect(page.locator('.dispatch-map-popup-card')).toContainText('ช่วงเวลาปิดรถ')
  await page.getByRole('button', { name: 'มุมมองตารางงาน', exact: true }).click()

  // Approve 1st citizen booking with 1-click quick approve and assign to Vehicle 01 + Driver A.
  await page.getByRole('button', { name: 'อนุมัติทันที' }).first().click()
  await expect(page.locator('.dispatch-notice')).toContainText('อนุมัติคำขอ')
  await page.getByRole('link', { name: 'จัดตารางและมอบหมาย', exact: true }).click()
  await page.getByRole('button', { name: 'รถรับส่ง: เลือกรถ', exact: true }).click()
  await page.getByRole('option', { name: /รถคันที่ 01/ }).click()
  await page.getByRole('button', { name: 'คนขับ: เลือกคนขับ', exact: true }).click()
  await page.getByRole('option', { name: /นายสมชาย/ }).click()
  await page.getByRole('button', { name: 'ตรวจสอบและยืนยันตาราง', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันตาราง', exact: true }).click()
  await page.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันการมอบหมาย', exact: true }).click()
  await expect(page).toHaveURL(/\/dispatcher\/tracking$/)

  // 4. Switch to Driver via DemoRoleBar and execute assigned trip through COMPLETED!
  await page.locator('.demo-role-bar').getByRole('button', { name: 'พนักงานขับรถ' }).click()
  await expect(page).toHaveURL(/\/driver$/)
  await page.getByRole('button', { name: /ดูรายละเอียด/ }).first().click()
  for (const label of [
    'เริ่มงาน',
    'ออกจากต้นทางไปรับผู้ป่วย',
    'รับผู้ป่วยขึ้นรถแล้ว',
    'ออกเดินทางไปโรงพยาบาล',
    'ส่งถึงโรงพยาบาลแล้ว',
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  }
  await expect(page).toHaveURL(/\/driver\/history$/)
})

test('staff login page offers 1-click demo role entry when backend is not running', async ({ page }) => {
  await page.goto('/staff/login')
  await page.getByRole('button', { name: 'ทดลองใช้งาน: เจ้าหน้าที่จัดรถ (Dispatcher)' }).click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  await expect(page.locator('#dispatcher-main')).toBeVisible()
})

test('UI/UX polish: DemoRoleBar offset/collapse, Admin layout, bounded lists, citizen review/sort & driver notice', async ({ page }) => {
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line).*/, route => route.abort())
  await page.setViewportSize({ width: 1280, height: 900 })

  // 1. Admin layout alignment, DemoRoleBar non-overlap + collapse/expand, and /admin vs /admin/history focus
  await page.goto('/')
  await page.locator('[data-actor-id="ACT-04"]').click()
  await expect(page).toHaveURL(/\/admin$/)
  const demoBar = page.locator('.demo-role-bar')
  const adminSidebar = page.locator('#admin-sidebar')
  const adminMain = page.locator('#admin-main')

  const expandedBarBox = (await demoBar.boundingBox())!
  const expandedSidebarBox = (await adminSidebar.boundingBox())!
  const expandedMainBox = (await adminMain.boundingBox())!
  expect(expandedSidebarBox.y).toBeGreaterThanOrEqual(expandedBarBox.y + expandedBarBox.height - 1)
  expect(expandedSidebarBox.width).toBe(250)
  expect(expandedMainBox.x).toBeGreaterThanOrEqual(250)

  // Collapse & expand DemoRoleBar
  await demoBar.getByRole('button', { name: /ย่อแถบ/ }).click()
  await expect(page.locator('#demo-role-nav')).toBeHidden()
  const collapsedBarBox = (await demoBar.boundingBox())!
  expect(collapsedBarBox.height).toBeLessThanOrEqual(expandedBarBox.height)
  await demoBar.getByRole('button', { name: /ขยายแถบสลับบทบาท/ }).click()
  await expect(page.locator('#demo-role-nav')).toBeVisible()

  // Load 320 seed rows on /admin, then verify /admin/history avoids duplicating analytics/seed panels
  await page.getByRole('button', { name: 'โหลดข้อมูลตัวอย่าง 320 รายการ' }).first().click()
  await expect(page.getByText('ข้อมูลจำลองในระบบ: 320 รายการ')).toBeVisible()
  await adminSidebar.getByRole('link', { name: 'ประวัติการรับ–ส่ง', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/history$/)
  await expect(page.locator('.admin-analytics-panel')).toHaveCount(0)
  await expect(page.locator('.admin-seed-panel')).toHaveCount(0)
  // Collapse Admin sidebar and verify main content realigns cleanly without collision
  await adminSidebar.getByRole('button', { name: 'ย่อเมนูด้านข้าง', exact: true }).click()
  expect((await adminSidebar.boundingBox())!.width).toBe(80)
  expect((await adminMain.boundingBox())!.x).toBe(80)

  // 2. Dispatcher bounded scroll containers with 320 seeded bookings
  await demoBar.getByRole('button', { name: 'เจ้าหน้าที่จัดรถ' }).click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  const queueWrapBox = (await page.locator('#dispatch-queue .service-table-wrap').boundingBox())!
  expect(queueWrapBox.height).toBeLessThanOrEqual(485)
  const assignQueueBox = (await page.locator('#dispatch-assignment-queue .service-table-wrap').boundingBox())!
  expect(assignQueueBox.height).toBeLessThanOrEqual(485)

  await page.locator('#dispatcher-sidebar').getByRole('link', { name: 'จัดตารางและมอบหมาย', exact: true }).click()
  await expect(page).toHaveURL(/\/dispatcher\/assignment$/)
  const waitingListBox = (await page.locator('.dispatch-waiting-list').boundingBox())!
  expect(waitingListBox.height).toBeLessThanOrEqual(485)

  await page.locator('#dispatcher-sidebar').getByRole('link', { name: 'ติดตามงานรับส่ง', exact: true }).click()
  await expect(page).toHaveURL(/\/dispatcher\/tracking$/)
  const monitoringWrapBox = (await page.locator('.dispatch-monitoring .service-table-wrap').boundingBox())!
  expect(monitoringWrapBox.height).toBeLessThanOrEqual(545)

  // 3. Citizen /booking/review profile update stays checked + clean pickup formatting + newest-first booking sort
  await demoBar.getByRole('button', { name: 'ผู้ป่วย / จองรถ' }).click()
  await expect(page).toHaveURL(/\/booking$/)
  await page.getByRole('button', { name: 'เริ่มจองรถ →' }).click()
  await page.getByLabel(/รับทราบการใช้ข้อมูล/).check()
  await page.getByRole('button', { name: 'รับทราบและถัดไป' }).click()
  await page.getByLabel(/ชื่อผู้ป่วย/).fill('นายทดสอบ จัดเรียงล่าสุด')
  await page.getByLabel(/เบอร์โทรศัพท์ของคุณ/).fill('0891112233')
  await page.getByLabel(/โรงพยาบาล/).selectOption('hospital-lamphun')
  await page.locator('button.booking-input-trigger').first().click()
  await page.getByRole('button', { name: 'เดือนถัดไป', exact: true }).click()
  await page.locator('.booking-calendar button:not([disabled])', { hasText: /^\s*(?:[\u0E00-\u0E7F]+\.\s*)?20$/ }).first().click()
  await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()
  await page.locator('button.booking-input-trigger').nth(1).click()
  await setPickerTime(page, 'ชั่วโมง', '10')
  await setPickerTime(page, 'นาที', '00')
  await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
  await page.getByRole('button', { name: 'ถัดไป →' }).click()
  await page.getByRole('button', { name: 'เดินได้', exact: true }).click()
  await page.getByRole('checkbox', { name: 'ไม่ต้องการความช่วยเหลือเพิ่มเติม' }).check()
  await page.getByLabel(/หมู่บ้านในเขตบริการ/).selectOption('village-01')
  await page.getByLabel(/ที่อยู่จุดรับ/).fill('82, 13,')
  await page.getByText('เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง').click()
  await page.getByLabel('ละติจูด').fill('18.5835')
  await page.getByLabel('ลองจิจูด').fill('99.0422')
  await page.getByRole('button', { name: 'ถัดไป →' }).click()

  // Pickup summary should strip trailing comma and avoid generic map label
  await expect(page.locator('.booking-review-section').last()).toContainText('82, 13')
  await expect(page.locator('.booking-review-section').last()).not.toContainText('82, 13,')
  await expect(page.locator('.booking-review-section').last()).not.toContainText('จุดรับที่ระบุพิกัดเอง')

  // Profile checkbox auto-saves on booking submit (no redundant separate save/update button)
  const saveCheckbox = page.getByLabel('บันทึกข้อมูลผู้ป่วยไว้ใช้ครั้งต่อไป')
  await saveCheckbox.check()
  await expect(saveCheckbox).toBeChecked()
  await expect(page.locator('.booking-profile-hint')).toContainText('ระบบจะบันทึกหรืออัปเดตข้อมูลนี้ให้อัตโนมัติเมื่อกดยืนยันคำขอ')
  await expect(page.getByRole('button', { name: 'บันทึกข้อมูลผู้ป่วย' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'อัปเดตข้อมูลผู้ป่วยที่บันทึกไว้' })).toHaveCount(0)

  // Submit and verify newest booking appears first in รายการจองของฉัน, and compact appointment slip on status view
  await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ' }).click()
  await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toBeVisible()
  const newBookingRef = (await page.locator('.booking-summary-id').textContent())?.trim() ?? ''
  expect(newBookingRef.length).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'ดูสถานะการจอง', exact: true }).click()
  await expect(page.locator('.booking-appointment-slip')).toBeVisible()
  await expect(page.locator('.booking-status-header .booking-compact-refresh')).toBeVisible()
  await page.getByRole('button', { name: 'รายการจองของฉัน', exact: true }).click()
  await expect(page.locator('.booking-summary-id').first()).toHaveText(newBookingRef)

  // 4. Driver toolbar compact refresh button & spacing next to account link
  await demoBar.getByRole('button', { name: 'พนักงานขับรถ' }).click()
  await expect(page).toHaveURL(/\/driver$/)
  const driverRefreshBtn = page.locator('.driver-refresh-button')
  const driverAccountLink = page.locator('.driver-account-link')
  const refreshBox = (await driverRefreshBtn.boundingBox())!
  const accountBox = (await driverAccountLink.boundingBox())!
  expect(refreshBox.width).toBeLessThan(260)
  expect(accountBox.x).toBeGreaterThanOrEqual(refreshBox.x + refreshBox.width)
})

test('UX clarity elevation: disabled reasons, hospital origin helper, edit-proposal feedback, desktop drawer & admin driver/history clarity', async ({ page }) => {
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line).*/, route => route.abort())
  await page.setViewportSize({ width: 1280, height: 900 })

  // 1. Dispatcher case detail drawer shows appointment & contact side-by-side on desktop
  await page.goto('/')
  await page.locator('[data-actor-id="ACT-02"]').click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  await page.getByRole('button', { name: 'ดูรายละเอียด →' }).first().click()
  const apptBox = (await page.locator('.dispatch-details-summary-grid .dispatch-appointment').boundingBox())!
  const contactBox = (await page.locator('.dispatch-details-summary-grid .dispatch-detail-contact').boundingBox())!
  expect(contactBox.x).toBeGreaterThanOrEqual(apptBox.x + apptBox.width - 1)
  await page.getByRole('button', { name: 'ปิด' }).click()

  // 2. Assignment disabled-reason banner, mobility mismatch check, hospital origin helper & edit-proposal toggle
  await page.locator('#dispatcher-sidebar').getByRole('link', { name: 'จัดตารางและมอบหมาย', exact: true }).click()
  await expect(page).toHaveURL(/\/dispatcher\/assignment$/)
  // Default waiting job BK-DEMO-1002 requires stretcher; no vehicle/driver selected yet
  await expect(page.locator('.dispatch-disabled-reason')).toContainText('กรุณาเลือกรถรับส่งและคนขับให้ครบก่อนตรวจสอบและยืนยันตาราง')

  // Selecting standard/wheelchair-only vehicle (คันที่ 02) for a stretcher job shows explicit mobility mismatch reason
  await page.getByRole('button', { name: 'รถรับส่ง: เลือกรถ', exact: true }).click()
  await page.getByRole('option', { name: /รถคันที่ 02/ }).click()
  await page.getByRole('button', { name: 'คนขับ: เลือกคนขับ', exact: true }).click()
  await page.getByRole('option', { name: /นายสมชาย/ }).click()
  await expect(page.locator('.dispatch-disabled-reason')).toContainText('รถที่เลือกไม่รองรับประเภทการเดินทางของผู้ป่วย')

  // Pick stretcher-capable vehicle (คันที่ 01), then switch ต้นทาง to a hospital with no prior job (รพ.หริภุญชัย)
  await page.getByRole('button', { name: /รถรับส่ง:/ }).click()
  await page.getByRole('option', { name: /รถคันที่ 01/ }).click()
  await page.locator('#dispatch-origin-select').selectOption({ index: 3 })
  await expect(page.locator('.dispatch-origin-helper')).toContainText('ไม่พบงานก่อนหน้าของรถและคนขับคู่นี้ที่โรงพยาบาลดังกล่าว')
  await expect(page.locator('.dispatch-disabled-reason')).toContainText('กรุณาเลือก "งานก่อนหน้าที่โรงพยาบาล"')

  // Click helper button to switch back to municipal depot -> disabled reason clears
  await page.getByRole('button', { name: 'เปลี่ยนต้นทางเป็นศูนย์รถเทศบาล' }).click()
  await expect(page.locator('.dispatch-disabled-reason')).toHaveCount(0)

  // Confirm schedule -> SCHEDULED state -> click แก้ไขข้อเสนอตารางและทรัพยากร -> verify unmistakable banner & highlight
  await page.getByRole('button', { name: 'ตรวจสอบและยืนยันตาราง', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันตาราง', exact: true }).click()
  const editProposalBtn = page.getByRole('button', { name: 'แก้ไขข้อเสนอตารางและทรัพยากร', exact: true })
  await expect(editProposalBtn).toBeVisible()
  await editProposalBtn.click()
  await expect(page.locator('.dispatch-edit-proposal-banner')).toContainText('กำลังแก้ไขข้อเสนอ')
  await expect(page.locator('fieldset.is-editing-proposal')).toBeVisible()

  // 3. Admin /admin/drivers เพิ่มคนขับ modal helper & (ผูกข้อมูลคนขับแล้ว) option labels
  await page.locator('.demo-role-bar').getByRole('button', { name: 'ผู้ดูแลระบบ' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await page.locator('#admin-sidebar').getByRole('link', { name: 'คนขับ', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/drivers$/)
  await page.getByRole('button', { name: '+ เพิ่มคนขับ', exact: true }).click()
  await expect(page.locator('.admin-field-hint')).toContainText('ผู้ใช้งานและสิทธิ์')
  const linkedOptionCount = await page.locator('select option[disabled]', { hasText: '(ผูกข้อมูลคนขับแล้ว)' }).count()
  expect(linkedOptionCount).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click()

  // 4. Admin /admin/history: NotificationFailures collapsed by default, MonthlyReportExport open & ready
  await page.locator('#admin-sidebar').getByRole('link', { name: 'ประวัติการรับ–ส่ง', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/history$/)
  const notifDetails = page.locator('details', { hasText: 'ปัญหาการส่งข้อความ' })
  await expect(notifDetails).not.toHaveAttribute('open', '')
  const monthlyDetails = page.locator('details.admin-report-panel')
  await expect(monthlyDetails).toHaveAttribute('open', '')
  await expect(monthlyDetails.getByRole('button', { name: 'ดาวน์โหลดรายงานรายเดือน (.xlsx)' })).toBeEnabled()
})

test('Field-readiness & layout geometry audit across 1440px, 1280px, and 390px viewports', async ({ page }) => {
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line).*/, route => route.abort())

  // --- A. Dispatcher Desktop (1280px): Live Fleet Strip, Request Review Modal feedback + button spacing, Daily Map ทุกวัน toggle + zero CLS ---
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page.locator('[data-actor-id="ACT-02"]').click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // Live Fleet Status Strip visible with active vehicle status pills
  const fleetStrip = page.locator('.dispatch-fleet-live-strip')
  await expect(fleetStrip).toBeVisible()
  await expect(fleetStrip).toContainText('ว่างพร้อมรับงาน')
  await expect(fleetStrip).toContainText('กำลังวิ่งงาน')

  // Request Review modal: duplicate check gives unmistakable green confirmation + non-touching footer buttons inside modal
  await page.getByRole('button', { name: 'ดูรายละเอียด →' }).first().click()
  const reviewDialog = page.getByRole('dialog')
  await expect(reviewDialog).toBeVisible()
  await reviewDialog.getByRole('button', { name: 'ตรวจรายการอาจซ้ำ / โหลดประวัติล่าสุด' }).click()
  await expect(reviewDialog.locator('.dispatch-dup-clear')).toContainText('✓ ตรวจสอบแล้ว: ไม่พบรายการซ้ำ')

  const dialogBox = (await reviewDialog.boundingBox())!
  const footerButtons = reviewDialog.locator('.dispatch-dialog-actions button')
  const footerCount = await footerButtons.count()
  expect(footerCount).toBeGreaterThanOrEqual(3)
  const boxes = []
  for (let i = 0; i < footerCount; i++) {
    const b = (await footerButtons.nth(i).boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(dialogBox.x - 1)
    expect(b.x + b.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1)
    boxes.push(b)
  }
  for (let i = 0; i < boxes.length - 1; i++) {
    const sameRow = Math.abs(boxes[i].y - boxes[i + 1].y) < 10
    if (sameRow) {
      expect(boxes[i + 1].x - (boxes[i].x + boxes[i].width)).toBeGreaterThanOrEqual(8)
    } else {
      expect(boxes[i + 1].y - (boxes[i].y + boxes[i].height)).toBeGreaterThanOrEqual(8)
    }
  }
  await reviewDialog.getByRole('button', { name: 'ปิด' }).click()

  // Daily Map View: ทุกวัน first chip, toggle single-day & back to ทุกวัน, zero CLS shift on toolbar controls
  await page.getByRole('button', { name: /มุมมองแผนที่รายวัน/ }).click()
  const mapView = page.locator('.dispatch-map-view')
  await expect(mapView).toBeVisible()
  const allDaysChip = mapView.locator('.dispatch-date-chip-all')
  await expect(allDaysChip).toContainText('ทุกวัน')
  const statusChips = mapView.locator('.dispatch-map-status-chips')
  const beforeAllToggle = (await statusChips.boundingBox())!

  // Click a specific day chip -> filter to that day -> verify toolbar doesn't jump horizontally
  const specificDayChip = mapView.locator('.dispatch-map-date-strip .dispatch-date-chip').nth(1)
  await specificDayChip.click()
  await expect(specificDayChip).toHaveAttribute('aria-pressed', 'true')
  await expect(allDaysChip).toHaveAttribute('aria-pressed', 'false')
  const afterSingleDay = (await statusChips.boundingBox())!
  expect(Math.abs(afterSingleDay.x - beforeAllToggle.x)).toBeLessThanOrEqual(2)

  // Clicking the active day chip again toggles cleanly back to ทุกวัน overview
  await specificDayChip.click()
  await expect(allDaysChip).toHaveAttribute('aria-pressed', 'true')
  await expect(mapView).toContainText('ภาพรวมทุกวัน')

  // --- B. Driver Desktop & Mobile (390px): Upfront mobility pill + outdoor quick-reason chips + zero horizontal overflow ---
  const demoBar = page.locator('.demo-role-bar')
  await demoBar.getByRole('button', { name: 'พนักงานขับรถ' }).click()
  await expect(page).toHaveURL(/\/driver$/)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.locator('.driver-mobility-pill').first()).toBeVisible()

  await page.getByRole('button', { name: /ดูรายละเอียด/ }).first().click()
  await expect(page).toHaveURL(/\/driver\/details/)
  await page.getByRole('button', { name: 'เริ่มงาน', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  await expect(page).toHaveURL(/\/driver\/status/)
  await expect(page.locator('.driver-mobility-pill').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // Quick-reason chips & caution box on /driver/incident
  await page.getByRole('button', { name: 'รายงานเหตุขัดข้อง', exact: true }).click()
  await expect(page).toHaveURL(/\/driver\/incident/)
  await expect(page.locator('.driver-caution-box')).toBeVisible()
  const quickChip = page.locator('.driver-reason-chip').first()
  await expect(quickChip).toBeVisible()
  const chipLabel = (await quickChip.textContent())?.trim() ?? ''
  await quickChip.click()
  await expect(page.getByLabel('เหตุผลที่รายงาน')).toHaveValue(chipLabel)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // --- C. Admin Desktop (1440px & 1280px): Side-by-side non-touching row actions, differentiated driver pills, guards & analytics ---
  await page.setViewportSize({ width: 1440, height: 900 })
  await demoBar.getByRole('button', { name: 'ผู้ดูแลระบบ' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // Collapsible demo-only CSV seed utility + municipal peak windows & ranked hospitals analytics
  const seedPanel = page.locator('details.admin-seed-panel')
  await expect(seedPanel.locator('summary')).toContainText('นำเข้าข้อมูลทดสอบ (.csv) — เฉพาะโหมดสาธิต')
  await page.getByRole('button', { name: 'โหลดข้อมูลตัวอย่าง 320 รายการ' }).first().click()
  const analytics = page.locator('.admin-analytics-panel')
  await expect(analytics).toContainText('06:00–09:00 น.')
  await expect(analytics).toContainText('09:00–12:00 น.')
  await expect(analytics).toContainText('12:00–16:00 น.')
  await expect(analytics).toContainText('โรงพยาบาลปลายทางยอดนิยม')

  // /admin/drivers at 1440px & 1280px: distinct account vs work status pills, shift summary, horizontal non-touching action buttons, empty-state shortcut
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.locator('#admin-sidebar').getByRole('link', { name: 'คนขับ', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/drivers$/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    const firstRow = page.locator('.admin-drivers-table tbody tr').first()
    await expect(firstRow).toContainText('บัญชีปกติ')
    await expect(firstRow).toContainText('พร้อมปฏิบัติงาน')
    await expect(firstRow.locator('.admin-shift-summary')).toContainText('06:00–16:00 น.')

    const manageBtn = firstRow.getByRole('button', { name: 'จัดการคนขับ', exact: true })
    const windowBtn = firstRow.getByRole('button', { name: 'ช่วงเวลาคนขับ', exact: true })
    const b1 = (await manageBtn.boundingBox())!
    const b2 = (await windowBtn.boundingBox())!
    expect(Math.abs(b1.y - b2.y)).toBeLessThanOrEqual(4)
    expect(b2.x - (b1.x + b1.width)).toBeGreaterThanOrEqual(6)
  }

  // Empty-state shortcut in + เพิ่มคนขับ when all demo driver accounts are already linked -> jumps to /admin/accounts
  await page.getByRole('button', { name: '+ เพิ่มคนขับ', exact: true }).click()
  const emptyCallout = page.locator('.admin-empty-driver-callout')
  await expect(emptyCallout).toBeVisible()
  await emptyCallout.getByRole('button', { name: 'ไปสร้างบัญชีพนักงานขับรถ →' }).click()
  await expect(page).toHaveURL(/\/admin\/accounts$/)

  // Last-active-Admin lockout guard on /admin/accounts
  const adminRow = page.locator('.admin-accounts-table tbody tr', { hasText: 'USR-ADM-1' })
  await adminRow.getByRole('button', { name: 'จัดการบัญชี', exact: true }).click()
  const accountDialog = page.getByRole('dialog')
  await accountDialog.getByRole('combobox', { name: 'สถานะบัญชี', exact: true }).selectOption('false')
  await expect(accountDialog).toContainText('ไม่สามารถปิดใช้งานหรือลดสิทธิ์ผู้ดูแลระบบคนสุดท้ายได้')
  await expect(accountDialog.getByRole('button', { name: 'บันทึก', exact: true })).toBeDisabled()
  await accountDialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click()

  // Active-trip impact warning on /admin/vehicles (demo-vehicle-1 has active assigned trip BK-DEMO-1003) + horizontal row buttons
  await page.locator('#admin-sidebar').getByRole('link', { name: 'รถรับส่ง', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/vehicles$/)
  const v1Row = page.locator('.admin-vehicles-table tbody tr', { hasText: 'demo-vehicle-1' })
  const vBtn1 = (await v1Row.getByRole('button', { name: 'จัดการรถ', exact: true }).boundingBox())!
  const vBtn2 = (await v1Row.getByRole('button', { name: 'ช่วงเวลารถ', exact: true }).boundingBox())!
  expect(Math.abs(vBtn1.y - vBtn2.y)).toBeLessThanOrEqual(4)
  expect(vBtn2.x - (vBtn1.x + vBtn1.width)).toBeGreaterThanOrEqual(6)

  await v1Row.getByRole('button', { name: 'จัดการรถ', exact: true }).click()
  const vehicleDialog = page.getByRole('dialog')
  await vehicleDialog.getByRole('combobox', { name: 'สถานะรถ', exact: true }).selectOption('false')
  await expect(vehicleDialog).toContainText('พบงานมอบหมายที่ยังไม่เสร็จสิ้น')
  await vehicleDialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click()

  // --- D. Citizen Mobile (390px): Compact appointment slip + zero horizontal overflow ---
  await page.setViewportSize({ width: 390, height: 844 })
  await demoBar.getByRole('button', { name: 'ผู้ป่วย / จองรถ' }).click()
  await expect(page).toHaveURL(/\/booking$/)
  await page.getByRole('button', { name: 'ดูสถานะการจอง' }).click()
  await expect(page).toHaveURL(/\/booking\/bookings$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.locator('a.booking-summary-card').first().click()
  await expect(page).toHaveURL(/\/booking\/status\//)
  await expect(page.locator('.booking-appointment-slip')).toBeVisible()
  const slipBox = (await page.locator('.booking-appointment-slip').boundingBox())!
  expect(slipBox.height).toBeLessThan(460)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('Master operational visibility: Live Fleet Matrix, upfront dropdown readiness, Driver->Dispatcher incident loop, 48h smart time picker, staff session card & admin header alignment', async ({ page }) => {
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line).*/, route => route.abort())

  // 1. Live Fleet Matrix & Upfront Dispatch Dropdown Readiness (1280px)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page.locator('[data-actor-id="ACT-02"]').click()
  await expect(page).toHaveURL(/\/dispatcher$/)

  const matrix = page.locator('.dispatch-fleet-matrix')
  await expect(matrix).toBeVisible()
  await expect(page.locator('.dispatch-fleet-source-note')).toContainText('ตำแหน่งอ้างอิงจากสถานะงานล่าสุด')
  await expect(matrix).toContainText('รถคันที่ 01')
  await expect(matrix).toContainText('เปลนอน')
  await expect(matrix).toContainText('นายสมชาย ใจดี')
  await expect(matrix).toContainText('กำลังรับ-ส่ง · ปลายทาง รพ.ลำพูน')
  await expect(matrix).toContainText('ประจำที่ศูนย์รถ ทต.บ้านกลาง')
  await expect(matrix).toContainText('ว่างอีกครั้ง')

  // Dispatcher sidebar pending & awaiting-assignment amber badges (aria-hidden keeps accessible names exact)
  const dispSidebar = page.locator('#dispatcher-sidebar')
  await expect(dispSidebar.getByRole('link', { name: 'แดชบอร์ดงานรับส่ง', exact: true }).locator('.nav-badge-count.amber')).toHaveAttribute('aria-hidden', 'true')
  await expect(dispSidebar.getByRole('link', { name: 'จัดตารางและมอบหมาย', exact: true }).locator('.nav-badge-count.amber')).toHaveAttribute('aria-hidden', 'true')

  // Upfront dropdown readiness on /dispatcher/assignment (BK-DEMO-1002 needs stretcher)
  await dispSidebar.getByRole('link', { name: 'จัดตารางและมอบหมาย', exact: true }).click()
  await expect(page).toHaveURL(/\/dispatcher\/assignment$/)
  await page.getByRole('button', { name: 'รถรับส่ง: เลือกรถ', exact: true }).click()
  await expect(page.getByRole('option', { name: /รถคันที่ 01/ })).toContainText('เปลนอน')
  await page.getByRole('option', { name: /รถคันที่ 02/ }).click()
  await expect(page.locator('.dispatch-selected-meta-pills').first()).toContainText('ไม่รองรับ เปลนอน')

  await page.getByRole('button', { name: /รถรับส่ง:/ }).click()
  await page.getByRole('option', { name: /รถคันที่ 01/ }).click()
  await expect(page.locator('.dispatch-selected-meta-pills').first()).toContainText('✓ รองรับเคสนี้')
  await expect(page.locator('#dispatch-origin-select')).toContainText('ไม่มีงานก่อนหน้า')

  // 2. Driver -> Dispatcher Incident Alert Loop + Driver top-right header clipping guard
  const demoBar = page.locator('.demo-role-bar')
  await demoBar.getByRole('button', { name: 'พนักงานขับรถ' }).click()
  await expect(page).toHaveURL(/\/driver$/)
  await page.getByRole('button', { name: /ดูรายละเอียด/ }).first().click()
  await expect(page).toHaveURL(/\/driver\/details/)

  // Check zero right-edge clipping on /driver/details at both 1280px desktop and 390px mobile
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(vp)
    const linkBox = (await page.locator('.driver-account-link').boundingBox())!
    expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(vp.width - 8)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }

  // Report incident on BK-DEMO-1003 and verify structured Driver incident status card
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: 'เริ่มงาน', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  await expect(page).toHaveURL(/\/driver\/status/)
  await page.getByRole('button', { name: 'รายงานเหตุขัดข้อง', exact: true }).click()
  await expect(page).toHaveURL(/\/driver\/incident/)
  await page.getByLabel('เหตุผลที่รายงาน').fill('รถเสียระหว่างทาง ต้องการรถทดแทน')
  await page.getByRole('button', { name: 'ยืนยันรายงานเหตุขัดข้อง', exact: true }).click()
  await expect(page).toHaveURL(/\/driver\/status/)
  const driverIncCard = page.locator('.driver-incident-status-card')
  await expect(driverIncCard).toBeVisible()
  await expect(driverIncCard).toContainText('รถเสียระหว่างทาง ต้องการรถทดแทน')
  await expect(driverIncCard).toContainText('ส่งแจ้งเจ้าหน้าที่จัดรถแล้ว — กำลังรอการจัดรถทดแทน')

  // Switch back to Dispatcher: verify sticky Incident Alert Banner, red sidebar badge, matrix red card, and 1-click open to tracking!
  await demoBar.getByRole('button', { name: 'เจ้าหน้าที่จัดรถ' }).click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  const incidentBanner = page.locator('.dispatch-incident-banner')
  await expect(incidentBanner).toBeVisible()
  await expect(incidentBanner).toContainText('BK-DEMO-1003')
  await expect(incidentBanner).toContainText('รถเสียระหว่างทาง ต้องการรถทดแทน')
  await expect(dispSidebar.getByRole('link', { name: 'ติดตามงานรับส่ง', exact: true }).locator('.nav-badge-count.danger')).toHaveAttribute('aria-hidden', 'true')
  await expect(page.locator('.dispatch-fleet-matrix .dispatch-fleet-unit.is-incident')).toContainText('มีเหตุขัดข้อง · งาน BK-DEMO-1003')

  await incidentBanner.getByRole('button', { name: 'เปิดเคส / จัดรถทดแทน →' }).click()
  await expect(page).toHaveURL(/\/dispatcher\/tracking/)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'ปิดรายละเอียด', exact: true }).click()
  await expect(page.getByRole('button', { name: /เฉพาะเหตุขัดข้อง \(1\)/ })).toBeVisible()
  await expect(page.locator('.dispatch-monitoring tbody tr').first()).toContainText('มีเหตุขัดข้อง — รอจัดรถใหม่')

  // 3. Admin top-right header centerline alignment + Staff Session Card vertical gap & inline verification feedback
  await demoBar.getByRole('button', { name: 'ผู้ดูแลระบบ' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const refreshBox = (await page.locator('.admin-refresh-btn').boundingBox())!
    const shortcutBox = (await page.locator('.admin-heading-actions .role-selection-shortcut').boundingBox())!
    const center1 = refreshBox.y + refreshBox.height / 2
    const center2 = shortcutBox.y + shortcutBox.height / 2
    expect(Math.abs(center1 - center2)).toBeLessThanOrEqual(2)
    expect(shortcutBox.x - (refreshBox.x + refreshBox.width)).toBeGreaterThanOrEqual(8)
  }

  // Open /staff/login from Admin header shortcut -> check session card button spacing & inline verify feedback
  await page.locator('.admin-heading-actions .role-selection-shortcut').click()
  await expect(page).toHaveURL(/\/staff\/login$/)
  const sessionActions = page.locator('.staff-session-actions > *')
  await expect(sessionActions).toHaveCount(3)
  const sBox0 = (await sessionActions.nth(0).boundingBox())!
  const sBox1 = (await sessionActions.nth(1).boundingBox())!
  const sBox2 = (await sessionActions.nth(2).boundingBox())!
  expect(sBox1.y - (sBox0.y + sBox0.height)).toBeGreaterThanOrEqual(10)
  expect(sBox2.y - (sBox1.y + sBox1.height)).toBeGreaterThanOrEqual(10)

  await page.getByRole('button', { name: 'ตรวจสอบเซสชัน', exact: true }).click()
  await expect(page.locator('.staff-session-verified')).toContainText('✓ เซสชันใช้งานได้ปกติ')
})

test('Citizen 48-hour smart time picker default & 1-click jump + muted PDPA decline button hierarchy', async ({ page }) => {
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line).*/, route => route.abort())
  // Freeze clock at 2030-01-12 14:20 BKK -> 48h boundary day is 2030-01-14 at 14:20 BKK
  await page.clock.install({ time: new Date('2030-01-12T07:20:00Z') })

  await page.goto('/')
  await page.locator('[data-actor-id="ACT-01"]').click()
  await expect(page).toHaveURL(/\/booking$/)
  await page.getByRole('button', { name: 'เริ่มจองรถ →' }).click()
  await expect(page).toHaveURL(/\/booking\/privacy$/)

  // Muted decline button keeps exact accessible name & opens calm municipal phone instruction
  const declineBtn = page.getByRole('button', { name: 'ไม่ยินยอมใช้ข้อมูล', exact: true })
  await expect(declineBtn).toHaveClass(/booking-decline-btn/)
  await declineBtn.click()
  await expect(page.getByRole('dialog')).toContainText('โทรติดต่อเจ้าหน้าที่เทศบาลตำบลบ้านกลาง')
  await page.getByRole('button', { name: 'ปิด' }).click()

  await page.getByLabel(/รับทราบการใช้ข้อมูล/).check()
  await page.getByRole('button', { name: 'รับทราบและถัดไป' }).click()
  await expect(page).toHaveURL(/\/booking\/patient$/)

  // Select boundary date (14 Jan 2030 — exactly +48h day)
  await page.locator('button.booking-input-trigger').first().click()
  await page.getByRole('button', { name: /14 มกราคม/ }).click()
  await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()

  // Open time picker -> should default to a valid >=48h time (14:20) with NO red alert and enabled confirm!
  await page.locator('button.booking-input-trigger').nth(1).click()
  await expect(page.locator('.booking-picker-lead-alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'ยืนยันเวลา', exact: true })).toBeEnabled()

  // Scroll back to an invalid <48h time (09:00) -> exact earliest time alert + 1-click jump button recovers cleanly!
  await setPickerTime(page, 'ชั่วโมง', '09')
  await setPickerTime(page, 'นาที', '00')
  await expect(page.locator('.booking-picker-lead-alert')).toContainText(/วันนี้เลือกได้ตั้งแต่ 14:2[01] น\. เป็นต้นไป/)
  await expect(page.getByRole('button', { name: 'ยืนยันเวลา', exact: true })).toBeDisabled()

  await page.locator('.booking-picker-jump-btn').click()
  await expect(page.locator('.booking-picker-lead-alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'ยืนยันเวลา', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
  await expect(page.locator('#time-value')).toContainText(/14:2[01] น\./)
})
