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
  const trackingInnerScroll = await page.locator('.dispatch-monitoring .service-table-wrap').evaluate(el => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }))
  expect(trackingInnerScroll.scrollHeight).toBeLessThanOrEqual(trackingInnerScroll.clientHeight + 2)

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
  await expect(page.locator('.dispatch-fleet-matrix')).toBeVisible()
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
  await expect(page.locator('.dispatch-fleet-matrix')).toBeVisible()
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
  await expect(page.locator('.dispatch-fleet-matrix')).toBeVisible()

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

test('Pre-UAT polish: pickup map auto-village & non-destructive suggestion pill, 390px overflow lock, hard overlap block, mismatch warning, timeline ทุกวัน toggle, fleet scroll row & driver history pagination', async ({ page }) => {
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line|photon).*/, route => route.abort())

  // 1. Mobile 390px overscroll/overflow lock + Pickup map non-destructive suggestion pill & auto-village hint
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.locator('[data-actor-id="ACT-01"]').click()
  await expect(page).toHaveURL(/\/booking$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehavior)).toBe('none')

  await page.getByRole('button', { name: 'เริ่มจองรถ →' }).click()
  await page.getByLabel(/รับทราบการใช้ข้อมูล/).check()
  await page.getByRole('button', { name: 'รับทราบและถัดไป' }).click()
  await page.getByLabel(/ชื่อผู้ป่วย/).fill('นางทดสอบ ปักหมุด')
  await page.getByLabel(/เบอร์โทรศัพท์ของคุณ/).fill('0892223344')
  await page.getByLabel(/โรงพยาบาล/).selectOption('hospital-lamphun')
  await page.locator('button.booking-input-trigger').first().click()
  await page.getByRole('button', { name: 'เดือนถัดไป', exact: true }).click()
  await page.locator('.booking-calendar button:not([disabled])', { hasText: /^\s*(?:[\u0E00-\u0E7F]+\.\s*)?22$/ }).first().click()
  await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()
  await page.locator('button.booking-input-trigger').nth(1).click()
  await setPickerTime(page, 'ชั่วโมง', '10')
  await setPickerTime(page, 'นาที', '30')
  await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
  await page.getByRole('button', { name: 'ถัดไป →' }).click()
  await expect(page).toHaveURL(/\/booking\/assistance$/)

  // Type manual house number first -> then trigger pin coordinates near หมู่ 1 บ้านกลาง -> manual input MUST NOT be overwritten!
  const addressInput = page.getByLabel(/ที่อยู่จุดรับ/)
  await addressInput.fill('82 13')
  await page.getByText('เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง').click()
  await page.getByLabel('ละติจูด').fill('18.5795')
  await page.getByLabel('ลองจิจูด').fill('99.0435')

  await expect(page.locator('.booking-village-auto-hint')).toContainText('อิงจากตำแหน่งบนแผนที่')
  await expect(page.getByLabel(/หมู่บ้านในเขตบริการ/)).toHaveValue('village-01')
  await expect(addressInput).toHaveValue('82 13')
  const suggestionPill = page.locator('.booking-address-suggestion')
  await expect(suggestionPill).toBeVisible()
  await expect(suggestionPill).toContainText('ใช้ที่อยู่นี้แทน:')
  await suggestionPill.click()
  await expect(addressInput).toHaveValue(/^ใกล้หมู่ 1 บ้านกลาง/)
  await expect(suggestionPill).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // 2. Desktop 1280px: Load 320 seed rows -> check Timeline ทุกวัน toggle, Live Fleet Matrix horizontal scroll row, & Driver History 12-item pagination + filters
  await page.setViewportSize({ width: 1280, height: 900 })
  const demoBar = page.locator('.demo-role-bar')
  await demoBar.getByRole('button', { name: 'ผู้ดูแลระบบ' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await page.getByRole('button', { name: 'โหลดข้อมูลตัวอย่าง 320 รายการ' }).first().click()
  await expect(page.getByText('ข้อมูลจำลองในระบบ: 320 รายการ')).toBeVisible()

  await demoBar.getByRole('button', { name: 'เจ้าหน้าที่จัดรถ' }).click()
  await expect(page).toHaveURL(/\/dispatcher$/)

  // Live Fleet Matrix horizontal flex scroll track on desktop >=1024px + expand toggle
  const matrix = page.locator('.dispatch-fleet-matrix')
  await expect(matrix).toBeVisible()
  expect(await matrix.evaluate(el => getComputedStyle(el).display)).toBe('flex')
  expect(await matrix.evaluate(el => getComputedStyle(el).flexWrap)).toBe('nowrap')
  expect(await matrix.locator('.dispatch-fleet-unit').count()).toBe(5)
  await page.getByRole('button', { name: 'ดูทั้งหมด (5)' }).click()
  expect(await matrix.evaluate(el => getComputedStyle(el).display)).toBe('grid')
  await page.getByRole('button', { name: 'ย่อเป็นแถวเดียว' }).click()
  expect(await matrix.evaluate(el => getComputedStyle(el).display)).toBe('flex')

  // Timeline date chips: defaults to single active day (no multi-day bar overlap) -> switch to ทุกวัน hides shared 06:00-18:00 track -> click date chip returns cleanly
  const timeline = page.locator('.dispatch-timeline-panel')
  const tlAllChip = timeline.locator('.dispatch-date-chip-all')
  await expect(tlAllChip).toHaveAttribute('aria-pressed', 'false')
  await expect(timeline.locator('.dispatch-timeline-scale')).toBeVisible()
  expect(await timeline.locator('.dispatch-timeline-track').count()).toBeGreaterThan(0)
  await tlAllChip.click()
  await expect(tlAllChip).toHaveAttribute('aria-pressed', 'true')
  await expect(timeline).toContainText('ภาพรวมทุกวัน')
  await expect(timeline.locator('.dispatch-timeline-all-days-note')).toContainText('เลือกวันที่ด้านบนเพื่อดูแถบช่วงเวลารายวัน (06:00–18:00 น.)')
  await expect(timeline.locator('.dispatch-timeline-track')).toHaveCount(0)
  const firstDateChip = timeline.locator('.dispatch-timeline-date-chips .dispatch-date-chip').nth(1)
  await firstDateChip.click()
  await expect(firstDateChip).toHaveAttribute('aria-pressed', 'true')
  await expect(tlAllChip).toHaveAttribute('aria-pressed', 'false')
  await expect(timeline.locator('.dispatch-timeline-scale')).toBeVisible()
  await firstDateChip.click()
  await expect(tlAllChip).toHaveAttribute('aria-pressed', 'true')
  await expect(timeline.locator('.dispatch-timeline-track')).toHaveCount(0)

  // Driver History 12-item progressive pagination, route summary, and quick filters
  await demoBar.getByRole('button', { name: 'พนักงานขับรถ' }).click()
  await expect(page).toHaveURL(/\/driver$/)
  await page.locator('#driver-sidebar').getByRole('link', { name: 'ประวัติ', exact: true }).click()
  await expect(page).toHaveURL(/\/driver\/history$/)
  await expect(page.locator('.driver-history-summary')).toContainText(/แสดง 12 จาก \d+ งาน/)
  expect(await page.locator('.driver-grid .driver-card').count()).toBe(12)
  await expect(page.locator('.driver-history-route').first()).toContainText('→')

  const loadMoreBtn = page.getByRole('button', { name: /แสดงเพิ่มเติม \(เหลืออีก \d+ งาน\)/ })
  await expect(loadMoreBtn).toBeVisible()
  await loadMoreBtn.click()
  expect(await page.locator('.driver-grid .driver-card').count()).toBeGreaterThan(12)

  // Quick search filter by booking ID & status chip
  const firstRef = (await page.locator('.driver-history-card-head h3').first().textContent())?.trim() ?? ''
  await page.getByLabel('ค้นหารหัสงาน').fill(firstRef)
  await expect(page.locator('.driver-grid .driver-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'ล้างตัวกรอง' }).click()
  await page.getByRole('button', { name: 'ส่งถึงโรงพยาบาลแล้ว', exact: true }).click()
  await expect(page.locator('.driver-history-summary')).toContainText(/แสดง \d+ จาก \d+ งาน/)
})

test('Hard-block double-booking overlap & vehicle/driver location mismatch warning on /dispatcher/assignment', async ({ page }) => {
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line).*/, route => route.abort())
  await page.setViewportSize({ width: 1280, height: 900 })

  await page.goto('/')
  await page.locator('[data-actor-id="ACT-02"]').click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  await expect(page.locator('.dispatch-fleet-matrix')).toBeVisible()

  // Inject an overlapping APPROVED booking (15m after BK-DEMO-1003 today) + completed trip for demo-driver-2 at รพ.สารภี
  await page.evaluate(() => {
    const key = 'ban-klang-transit:interactive-demo-db:v1'
    const raw = localStorage.getItem(key)
    if (!raw) return
    const db = JSON.parse(raw)
    const todayAssigned = db.bookings.find((b: { id: string }) => b.id === 'BK-DEMO-1003')
    if (!todayAssigned) return
    const overlapAppt = new Date(Date.parse(todayAssigned.appointmentAt) + 15 * 60000).toISOString()
    db.bookings.unshift({
      ...todayAssigned,
      id: 'BK-DEMO-OVERLAP',
      reference: 'BK-DEMO-OVERLAP',
      status: 'APPROVED',
      revision: 2,
      patientName: 'นายทดสอบ ซ้อนเวลา',
      mobility: 'standard',
      appointmentAt: overlapAppt,
      vehicleId: null,
      driverId: null,
      vehicleName: undefined,
      schedule: null,
      proposedSchedule: null,
    })
    const doneEarlier = new Date(Date.parse(todayAssigned.appointmentAt) - 180 * 60000).toISOString()
    db.bookings.push({
      ...todayAssigned,
      id: 'BK-DEMO-SARAPHI-DONE',
      reference: 'BK-DEMO-SARAPHI-DONE',
      status: 'COMPLETED',
      revision: 5,
      hospitalId: 'hospital-saraphi',
      hospitalName: 'โรงพยาบาลสารภี',
      hospitalLocationId: 'hospital-saraphi',
      appointmentAt: doneEarlier,
      vehicleId: 'demo-vehicle-2',
      driverId: 'demo-driver-2',
    })
    localStorage.setItem(key, JSON.stringify(db))
  })

  await page.locator('#dispatcher-sidebar').getByRole('link', { name: 'จัดตารางและมอบหมาย', exact: true }).click()
  await expect(page).toHaveURL(/\/dispatcher\/assignment$/)
  await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
  await page.locator('.dispatch-waiting-list article', { hasText: 'BK-DEMO-OVERLAP' }).locator('button').first().click()

  // Selecting demo-vehicle-1 (assigned to BK-DEMO-1003 at overlapping window) MUST show red blocking conflict & HARD-DISABLE submit!
  await page.getByRole('button', { name: 'รถรับส่ง: เลือกรถ', exact: true }).click()
  await page.getByRole('option', { name: /รถคันที่ 01/ }).click()
  // Also pick demo-driver-2 (at รพ.สารภี, conflicting with demo-vehicle-1 at รพ.ลำพูน!)
  await page.getByRole('button', { name: /คนขับ:/ }).click()
  await page.getByRole('option', { name: /นายประสิทธิ์/ }).click()

  await expect(page.locator('.dispatch-location-mismatch')).toContainText('ตำแหน่งล่าสุดไม่ตรงกัน')
  await expect(page.locator('.dispatch-blocking-conflict')).toContainText('BK-DEMO-1003')
  await expect(page.getByRole('button', { name: 'ตรวจสอบและยืนยันตาราง', exact: true })).toBeDisabled()
})

test('Stale-readiness confirmation modal disables confirm button and offers 1-click reload recovery', async ({ page }) => {
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/, route => route.abort())
  const row = {
    id: 'bk-stale-1',
    reference: 'BK-STALE-1',
    status: 'APPROVED',
    revision: 2,
    executionVersion: 0,
    startedAt: null,
    patientName: 'นางทดสอบ รีเฟรช',
    appointmentAt: '2030-01-15T03:00:00Z',
    hospitalId: 'hosp-1',
    contactPhone: '0811112222',
    pickupAddress: 'หมู่ 1 บ้านกลาง',
    latitude: 18.58,
    longitude: 99.04,
    mobility: 'standard',
    vehicleId: null,
    driverId: null,
    incidentOpen: false,
    resourceHold: false,
    scheduleReviewRequired: false,
    schedule: null,
    proposedSchedule: null,
  }
  let bookingsFetches = 0
  await page.route('**/api/auth/**', route =>
    route.fulfill({
      json: route.request().url().endsWith('/login')
        ? { token: 'synthetic-token' }
        : { id: 'dsp-1', role: 'dispatcher', name: 'เจ้าหน้าที่ทดสอบ', driverId: null },
    }),
  )
  await page.route('**/api/catalog', route =>
    route.fulfill({
      json: {
        hospitals: [{ id: 'hosp-1', name: 'โรงพยาบาลลำพูน' }],
        villages: [],
        vehicles: [{ id: 'veh-1', name: 'รถคันที่ 01', plate: 'กข 1101', active: true, held: false, capabilities: ['standard'] }],
        drivers: [{ id: 'drv-1', name: 'นายสมชาย', active: true, held: false }],
        locations: [{ id: 'depot', name: 'ศูนย์รถเทศบาลตำบลบ้านกลาง', kind: 'depot' }],
        depotLocationId: 'depot',
      },
    }),
  )
  await page.route('**/api/dispatcher-alerts**', route => route.fulfill({ json: { alerts: [], unread: 0, nextCursor: null } }))
  await page.route('**/api/notification-failures**', route => route.fulfill({ json: { failures: [], total: 0, pending: 0, nextCursor: null } }))
  await page.route('**/api/bookings**', route => {
    if (route.request().method() === 'GET') {
      bookingsFetches++
      return route.fulfill({ json: { bookings: [row] } })
    }
    return route.fulfill({ status: 409, json: { error: 'Changed' } })
  })

  await page.goto('/staff/login?next=%2Fdispatcher%2Fassignment')
  await page.getByLabel('ชื่อผู้ใช้').fill('dispatcher')
  await page.getByLabel('รหัสผ่าน').fill('pass')
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await page.getByRole('link', { name: 'เปิดหน้าจัดรถ' }).click()
  await expect(page).toHaveURL(/\/dispatcher\/assignment$/)

  await page.getByRole('button', { name: 'รถรับส่ง: เลือกรถ', exact: true }).click()
  await page.getByRole('option', { name: /รถคันที่ 01/ }).click()
  await page.getByRole('button', { name: 'คนขับ: เลือกคนขับ', exact: true }).click()
  await page.getByRole('option', { name: /นายสมชาย/ }).click()
  await page.getByRole('button', { name: 'ตรวจสอบและยืนยันตาราง', exact: true }).click()

  const dialog = page.getByRole('dialog')
  const confirmBtn = dialog.getByRole('button', { name: 'ยืนยันตาราง', exact: true })
  const beforeFetches = bookingsFetches
  await confirmBtn.click()

  await expect(dialog.getByRole('alert')).toContainText('ข้อมูลหรือความพร้อมเปลี่ยนแล้ว')
  await expect(confirmBtn).toBeDisabled()
  const reloadBtn = dialog.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true })
  await expect(reloadBtn).toBeVisible()
  await reloadBtn.click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => bookingsFetches).toBeGreaterThan(beforeFetches)
})

test('Desktop mouse-wheel scrolling works on /booking, /dispatcher, and /driver while preserving 390px mobile overflow containment', async ({ page }) => {
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line).*/, route => route.abort())
  await page.setViewportSize({ width: 1280, height: 680 })

  // 1. /booking (desktop 1280x680)
  await page.goto('/')
  await page.locator('[data-actor-id="ACT-01"]').click()
  await expect(page).toHaveURL(/\/booking$/)
  await expect(page.getByRole('button', { name: 'เริ่มจองรถ →' })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(640, 340)
  await page.mouse.wheel(0, 600)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  // Verify 390px mobile zero horizontal overflow on /booking
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // 2. /dispatcher (desktop 1280x680)
  await page.setViewportSize({ width: 1280, height: 680 })
  const demoBar = page.locator('.demo-role-bar')
  await demoBar.getByRole('button', { name: 'เจ้าหน้าที่จัดรถ' }).click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  await expect(page.locator('.dispatch-fleet-matrix')).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(700, 340)
  await page.mouse.wheel(0, 600)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  // 3. /driver (desktop 1280x680)
  await demoBar.getByRole('button', { name: 'พนักงานขับรถ' }).click()
  await expect(page).toHaveURL(/\/driver$/)
  await expect(page.getByRole('button', { name: /ดูรายละเอียด/ }).first()).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(700, 340)
  await page.mouse.wheel(0, 600)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
})

test('Final UX, Privacy & Layout Polish: sticky desktop sidebars, pin-driven village sync & clean address dedupe, citizen PDPA scope/pagination, and driver sticky CTA clearance', async ({ page }) => {
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line).*/, route => route.abort())
  await page.route('https://photon.komoot.io/reverse*', route =>
    route.fulfill({
      json: {
        features: [
          {
            properties: {
              name: 'ถนนรอบเมืองนอก',
              street: 'ถนนพระคงฤาษี',
              district: 'ในเมือง',
            },
          },
        ],
      },
    }),
  )

  // 1. Desktop sticky left sidebars with zero bottom white gap (/dispatcher, /driver, /admin)
  await page.setViewportSize({ width: 1280, height: 680 })
  await page.goto('/')
  await page.locator('[data-actor-id="ACT-02"]').click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  await expect(page.locator('.dispatch-fleet-matrix')).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(700, 340)
  await page.mouse.wheel(0, 600)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  const dispSidebarRect = await page.locator('#dispatcher-sidebar').evaluate(el => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, height: r.height }
  })
  expect(dispSidebarRect.top).toBeGreaterThanOrEqual(0)
  expect(dispSidebarRect.top).toBeLessThanOrEqual(64)
  expect(dispSidebarRect.bottom).toBeGreaterThanOrEqual(678)

  const demoBar = page.locator('.demo-role-bar')
  await demoBar.getByRole('button', { name: 'ผู้ดูแลระบบ' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(700, 340)
  await page.mouse.wheel(0, 600)
  const adminSidebarRect = await page.locator('#admin-sidebar').evaluate(el => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom }
  })
  expect(adminSidebarRect.top).toBeGreaterThanOrEqual(0)
  expect(adminSidebarRect.top).toBeLessThanOrEqual(64)
  expect(adminSidebarRect.bottom).toBeGreaterThanOrEqual(678)

  // Load 320 seed rows in Admin to verify Citizen PDPA scoping below
  await page.getByRole('button', { name: 'โหลดข้อมูลตัวอย่าง 320 รายการ' }).first().click()
  await expect(page.getByText('ข้อมูลจำลองในระบบ: 320 รายการ')).toBeVisible()

  // 2. Citizen PDPA own-bookings privacy scope + search, status chips & 10-item progressive pagination
  await demoBar.getByRole('button', { name: 'ผู้ป่วย / จองรถ' }).click()
  await expect(page).toHaveURL(/\/booking$/)
  await page.getByRole('button', { name: 'ดูสถานะการจอง' }).click()
  await expect(page).toHaveURL(/\/booking\/bookings$/)

  // Even with 320 seeded dispatcher trips loaded, citizen sees ONLY own 4 demo bookings (zero BK-SEED- leaks!)
  await expect(page.locator('.booking-list-title')).toContainText('แสดง 4 จาก 4 รายการ')
  await expect(page.locator('a.booking-summary-card')).toHaveCount(4)
  await expect(page.locator('body')).not.toContainText('BK-SEED-')

  // Inject 12 more own demo bookings so citizen owns 16 -> verify 10-item progressive pagination + filters
  await page.evaluate(() => {
    const key = 'ban-klang-transit:interactive-demo-db:v1'
    const raw = localStorage.getItem(key)
    if (!raw) return
    const db = JSON.parse(raw)
    const template = db.bookings[0]
    for (let i = 1; i <= 12; i++) {
      db.bookings.push({
        ...template,
        id: `BK-DEMO-20${String(i).padStart(2, '0')}`,
        reference: `BK-DEMO-20${String(i).padStart(2, '0')}`,
        status: i % 3 === 0 ? 'COMPLETED' : i % 3 === 1 ? 'REQUESTED' : 'ASSIGNED',
        submittedAt: new Date(Date.now() - (i + 10) * 3600_000).toISOString(),
      })
    }
    localStorage.setItem(key, JSON.stringify(db))
  })
  await page.getByRole('button', { name: /โหลดข้อมูลล่าสุด/ }).click()
  await expect(page.locator('.booking-list-title')).toContainText('แสดง 10 จาก 16 รายการ')
  await expect(page.locator('a.booking-summary-card')).toHaveCount(10)
  const loadMoreCitizen = page.getByRole('button', { name: 'แสดงเพิ่มเติม (เหลืออีก 6 รายการ)', exact: true })
  await expect(loadMoreCitizen).toBeVisible()
  await loadMoreCitizen.click()
  await expect(page.locator('.booking-list-title')).toContainText('แสดง 16 จาก 16 รายการ')
  await expect(page.locator('a.booking-summary-card')).toHaveCount(16)

  // Quick status filter chips & search by booking ID
  await page.getByRole('button', { name: 'เสร็จสิ้น', exact: true }).click()
  await expect(page.locator('.booking-list-title')).toContainText('แสดง 5 จาก 5 รายการ')
  await page.getByRole('button', { name: 'ทั้งหมด', exact: true }).click()
  await page.getByLabel('ค้นหารหัสการจอง').fill('BK-DEMO-1003')
  await expect(page.locator('a.booking-summary-card')).toHaveCount(1)
  await expect(page.locator('.booking-summary-id').first()).toHaveText('BK-DEMO-1003')

  // 3. Citizen Pickup Map: village auto-sync, clean road deduplication, out-of-zone amber notice & non-destructive manual input
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('link', { name: /กลับหน้าหลัก/ }).click()
  await page.getByRole('button', { name: 'เริ่มจองรถ →' }).click()
  await page.getByLabel(/รับทราบการใช้ข้อมูล/).check()
  await page.getByRole('button', { name: 'รับทราบและถัดไป' }).click()
  await page.getByLabel(/ชื่อผู้ป่วย/).fill('นางทดสอบ แผนที่')
  await page.getByLabel(/เบอร์โทรศัพท์ของคุณ/).fill('0893334455')
  await page.getByLabel(/โรงพยาบาล/).selectOption('hospital-lamphun')
  await page.locator('button.booking-input-trigger').first().click()
  await page.getByRole('button', { name: 'เดือนถัดไป', exact: true }).click()
  await page.locator('.booking-calendar button:not([disabled])', { hasText: /^\s*(?:[\u0E00-\u0E7F]+\.\s*)?23$/ }).first().click()
  await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()
  await page.locator('button.booking-input-trigger').nth(1).click()
  await setPickerTime(page, 'ชั่วโมง', '10')
  await setPickerTime(page, 'นาที', '00')
  await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
  await page.getByRole('button', { name: 'ถัดไป →' }).click()
  await expect(page).toHaveURL(/\/booking\/assistance$/)

  const addressInput = page.getByLabel(/ที่อยู่จุดรับ/)
  const villageSelect = page.getByLabel(/หมู่บ้านในเขตบริการ/)
  await page.getByText('เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง').click()

  // First pin inside Ban Klang Village 1 with empty address -> auto-selects village-01 & deduplicates road name cleanly!
  await page.getByLabel('ละติจูด').fill('18.5795')
  await page.getByLabel('ลองจิจูด').fill('99.0435')
  await expect(villageSelect).toHaveValue('village-01')
  await expect(page.locator('.booking-village-auto-hint')).toContainText('อิงจากตำแหน่งบนแผนที่')
  await expect(addressInput).toHaveValue('ถนนรอบเมืองนอก')
  expect(await addressInput.inputValue()).not.toContain('ถนนพระคงฤาษี')

  // Move pin to Ban Klang Village 4 after typing manual house number -> updates village to village-04, keeps manual address intact!
  await addressInput.fill('82 13')
  await page.getByLabel('ละติจูด').fill('18.5890')
  await page.getByLabel('ลองจิจูด').fill('99.0468')
  await expect(villageSelect).toHaveValue('village-04')
  await expect(addressInput).toHaveValue('82 13')
  await expect(page.locator('.booking-address-suggestion')).toContainText('ใช้ที่อยู่นี้แทน: ถนนรอบเมืองนอก')

  // Move pin OUTSIDE 8 km Ban Klang radius -> does NOT force another village, displays amber out-of-zone notice!
  await page.getByLabel('ละติจูด').fill('18.4500')
  await page.getByLabel('ลองจิจูด').fill('98.9000')
  await expect(page.locator('.booking-out-of-zone-notice')).toContainText('ตำแหน่งหมุดอยู่นอกเขตบริการหลัก กรุณาตรวจสอบหมู่บ้านอีกครั้ง')
  await expect(villageSelect).toHaveValue('village-04')
  await expect(page.locator('.booking-village-auto-hint')).toHaveCount(0)

  // 4. Driver Active Trip View: sticky CTA bottom clearance, full-width mobile CTA, live-sync hint & sticky desktop sidebar
  await demoBar.getByRole('button', { name: 'พนักงานขับรถ' }).click()
  await expect(page).toHaveURL(/\/driver$/)
  await expect(page.locator('.driver-trip').first()).toBeVisible()
  const trackActiveBtn = page.getByRole('button', { name: /ติดตามสถานะงาน/ }).first()
  if ((await trackActiveBtn.count()) > 0) {
    await trackActiveBtn.click()
  } else {
    await page.getByRole('button', { name: /ดูรายละเอียด/ }).first().click()
    await page.getByRole('button', { name: 'เริ่มงาน', exact: true }).click()
    await page.getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  }
  await expect(page).toHaveURL(/\/driver\/status/)
  await expect(page.locator('.driver-live-sync-hint')).toContainText('ไม่ใช้ GPS พื้นหลัง')

  // Mobile 390x844: zero overflow, full-width CTA, zero bottom overlap when scrolled to bottom
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const mobileCtaBox = (await page.locator('.driver-action').boundingBox())!
  const mobileCtaBtnBox = (await page.locator('.driver-action .driver-button').boundingBox())!
  const lastContentSelector = (await page.locator('.driver-next-preview').count()) > 0 ? '.driver-next-preview' : '.driver-timeline'
  const mobileLastCardBox = (await page.locator(lastContentSelector).boundingBox())!
  expect(mobileCtaBtnBox.x).toBeLessThanOrEqual(24)
  expect(mobileCtaBtnBox.width).toBeGreaterThanOrEqual(340)
  expect(mobileLastCardBox.y + mobileLastCardBox.height).toBeLessThanOrEqual(mobileCtaBox.y + 2)

  // Desktop 1280x680: sticky left sidebar zero white gap + sticky bottom CTA never obscures cards at scroll bottom
  await page.setViewportSize({ width: 1280, height: 680 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(700, 340)
  await page.mouse.wheel(0, 600)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  const driverSidebarRect = await page.locator('#driver-sidebar').evaluate(el => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom }
  })
  expect(driverSidebarRect.top).toBeGreaterThanOrEqual(0)
  expect(driverSidebarRect.top).toBeLessThanOrEqual(64)
  expect(driverSidebarRect.bottom).toBeGreaterThanOrEqual(678)

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const desktopCtaBox = (await page.locator('.driver-action').boundingBox())!
  const desktopLastCardBox = (await page.locator(lastContentSelector).boundingBox())!
  expect(desktopLastCardBox.y + desktopLastCardBox.height).toBeLessThanOrEqual(desktopCtaBox.y + 2)
})

test('Final Pre-UAT Visual & Navigation Polish: single-day timeline & unclipped actions, auto-expanded incident holds + actionable fleet cards, sticky mobile headers & driver mobile toolbar/focus', async ({ page }) => {
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line).*/, route => route.abort())
  await page.setViewportSize({ width: 1280, height: 800 })

  // 1. Dispatcher Timeline: defaults to single active day, unclipped รายละเอียด → button, ทุกวัน hides shared track
  await page.goto('/')
  await page.locator('[data-actor-id="ACT-02"]').click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  const timeline = page.locator('.dispatch-timeline-panel')
  await expect(timeline).toBeVisible()
  const tlAllChip = timeline.locator('.dispatch-date-chip-all')
  await expect(tlAllChip).toHaveAttribute('aria-pressed', 'false')
  await expect(timeline.locator('.dispatch-timeline-scale')).toBeVisible()
  expect(await timeline.locator('.dispatch-timeline-track').count()).toBeGreaterThan(0)

  // Verify รายละเอียด → button is completely visible & unclipped inside its timeline trip pill
  const firstPill = timeline.locator('.dispatch-timeline-trip-pill').first()
  const detailBtn = firstPill.locator('.dispatch-mini-link')
  await expect(detailBtn).toBeVisible()
  const pillBox = (await firstPill.boundingBox())!
  const btnBox = (await detailBtn.boundingBox())!
  expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(pillBox.x + pillBox.width + 1)
  expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(1280)

  // Switching to ทุกวัน hides the single-day 06:00–18:00 track so multi-date bars never overlap
  await tlAllChip.click()
  await expect(tlAllChip).toHaveAttribute('aria-pressed', 'true')
  await expect(timeline.locator('.dispatch-timeline-track')).toHaveCount(0)
  await expect(timeline.locator('.dispatch-timeline-all-days-note')).toContainText('เลือกวันที่ด้านบนเพื่อดูแถบช่วงเวลารายวัน (06:00–18:00 น.)')

  // 2. Actionable Live Fleet Matrix: clickable active trip ref -> /dispatcher/tracking modal
  const activeTripLink = page.locator('.dispatch-fleet-matrix .dispatch-fleet-trip-link').first()
  await expect(activeTripLink).toContainText('งาน BK-DEMO-1003')
  await activeTripLink.click()
  await expect(page).toHaveURL(/\/dispatcher\/tracking\?booking=BK-DEMO-1003&dialog=tracking/)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'ปิดรายละเอียด', exact: true }).click()

  // Trigger a resource hold via Driver FAILED_PICKUP (so demo-vehicle-1 & demo-driver-A are held without active trip)
  const demoBar = page.locator('.demo-role-bar')
  await demoBar.getByRole('button', { name: 'พนักงานขับรถ' }).click()
  await expect(page).toHaveURL(/\/driver$/)
  await page.getByRole('button', { name: /ดูรายละเอียด/ }).first().click()
  await page.getByRole('button', { name: 'เริ่มงาน', exact: true }).click()

  // Check clean single focus ring on secondary red ยกเลิก button inside confirmation modal (keyboard focus modality)
  const cancelModalBtn = page.getByRole('dialog').getByRole('button', { name: 'ยกเลิก', exact: true })
  await expect(cancelModalBtn).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(cancelModalBtn).toBeFocused()
  expect(await cancelModalBtn.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid')
  expect(await cancelModalBtn.evaluate(el => getComputedStyle(el).outlineOffset)).toBe('2px')

  await page.getByRole('dialog').getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  await page.getByRole('button', { name: 'ออกจากต้นทางไปรับผู้ป่วย', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  await page.getByRole('button', { name: 'รับผู้ป่วยไม่ได้', exact: true }).click()
  await page.getByLabel('เหตุผลที่รายงาน').fill('ติดต่อผู้ป่วยไม่ได้ที่จุดรับ')
  await page.getByRole('button', { name: 'ยืนยันรายงานรับไม่ได้', exact: true }).click()
  await expect(page).toHaveURL(/\/driver\/history$/)

  // Return to Dispatcher: verify red sidebar badge + actionable red incident card on Live Fleet Matrix -> auto-expanded readiness panel -> resolve holds clears red badge!
  await demoBar.getByRole('button', { name: 'เจ้าหน้าที่จัดรถ' }).click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  const trackingNavLink = page.locator('#dispatcher-sidebar').getByRole('link', { name: 'ติดตามงานรับส่ง', exact: true })
  await expect(trackingNavLink.locator('.nav-badge-count.danger')).toBeVisible()

  const resolveCardBtn = page.locator('.dispatch-fleet-unit.is-incident .dispatch-fleet-action-btn').first()
  await expect(resolveCardBtn).toContainText('คลี่คลายเหตุ / ยืนยันความพร้อม →')
  await resolveCardBtn.click()
  await expect(page).toHaveURL(/\/dispatcher\/tracking\?focus=readiness/)

  const readinessPanel = page.locator('#resource-readiness-panel')
  await expect(readinessPanel).toBeVisible()
  await expect(readinessPanel.locator('.dispatch-readiness-count-badge')).toContainText('รอคลี่คลาย 2 รายการ')
  // Vehicle is pre-selected from fleet card link & controls are immediately visible (not collapsed!)
  await expect(readinessPanel.getByLabel('ทรัพยากรที่ตรวจสอบ')).toHaveValue('vehicles/demo-vehicle-1')

  // Confirm readiness for vehicle (2 -> 1), then driver (1 -> 0, panel & red badge disappear!)
  await readinessPanel.getByLabel('ตำแหน่งปัจจุบันที่ยืนยันแล้ว').selectOption({ index: 1 })
  await readinessPanel.getByLabel('เหตุผลและผลตรวจสอบ').fill('ตรวจรถและกลับศูนย์พร้อมใช้งานแล้ว')
  await readinessPanel.getByLabel('ยืนยันตำแหน่งจริงและความพร้อมของทรัพยากรนี้แล้ว').check()
  await readinessPanel.getByRole('button', { name: 'ยืนยันความพร้อมทรัพยากรนี้' }).click()
  await expect(readinessPanel.locator('.dispatch-readiness-count-badge')).toContainText('รอคลี่คลาย 1 รายการ')

  await readinessPanel.getByLabel('ทรัพยากรที่ตรวจสอบ').selectOption('drivers/demo-driver-A')
  await readinessPanel.getByLabel('ตำแหน่งปัจจุบันที่ยืนยันแล้ว').selectOption({ index: 1 })
  await readinessPanel.getByLabel('เหตุผลและผลตรวจสอบ').fill('ยืนยันคนขับพร้อมปฏิบัติงานรอบถัดไป')
  await readinessPanel.getByLabel('ยืนยันตำแหน่งจริงและความพร้อมของทรัพยากรนี้แล้ว').check()
  await readinessPanel.getByRole('button', { name: 'ยืนยันความพร้อมทรัพยากรนี้' }).click()
  await expect(readinessPanel).toHaveCount(0)
  await expect(trackingNavLink.locator('.nav-badge-count.danger')).toHaveCount(0)

  // 3. Sticky compact mobile header (390px) on /driver, /dispatcher, /admin + single-row Driver mobile toolbar
  // Load 320 seed rows so pages are long enough to scroll down on 390px mobile
  await demoBar.getByRole('button', { name: 'ผู้ดูแลระบบ' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await page.getByRole('button', { name: 'โหลดข้อมูลตัวอย่าง 320 รายการ' }).first().click()
  await expect(page.getByText('ข้อมูลจำลองในระบบ: 320 รายการ')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  for (const check of [
    { btn: 'พนักงานขับรถ', url: /\/driver$/, sidebar: '#driver-sidebar', menu: 'เมนูคนขับ', ready: '.driver-refresh-button', minScroll: 80 },
    { btn: 'เจ้าหน้าที่จัดรถ', url: /\/dispatcher$/, sidebar: '#dispatcher-sidebar', menu: 'เมนูเจ้าหน้าที่จัดรถ', ready: '.dispatch-fleet-matrix', minScroll: 200 },
    { btn: 'ผู้ดูแลระบบ', url: /\/admin$/, sidebar: '#admin-sidebar', menu: 'เมนูผู้ดูแลระบบ', ready: '.admin-analytics-panel', minScroll: 200 },
  ]) {
    await demoBar.getByRole('button', { name: check.btn }).click()
    await expect(page).toHaveURL(check.url)
    await expect(page.locator(check.ready)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    if (check.sidebar === '#driver-sidebar') {
      // Single-row compact driver toolbar on 390px mobile
      const refreshBox = (await page.locator('.driver-refresh-button').boundingBox())!
      const accountBox = (await page.locator('.driver-account-link').boundingBox())!
      expect(Math.abs(refreshBox.y - accountBox.y)).toBeLessThanOrEqual(6)
    }

    await page.evaluate(() => window.scrollTo(0, 500))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(check.minScroll)
    const barBottom = await demoBar.evaluate(el => el.getBoundingClientRect().bottom)
    const headerRect = await page.locator(check.sidebar).evaluate(el => {
      const r = el.getBoundingClientRect()
      return { top: r.top, height: r.height }
    })
    expect(headerRect.top).toBeGreaterThanOrEqual(barBottom - 2)
    expect(headerRect.top).toBeLessThanOrEqual(barBottom + 2)
    expect(headerRect.height).toBeLessThanOrEqual(72)
    await expect(page.getByRole('button', { name: check.menu, exact: true })).toBeVisible()

    // Also verify long scrollable /driver/history keeps sticky green header + ☰ pinned after deep scroll
    if (check.sidebar === '#driver-sidebar') {
      await page.getByRole('button', { name: check.menu, exact: true }).click()
      await page.getByRole('dialog', { name: check.menu, exact: true }).getByRole('link', { name: 'ประวัติ', exact: true }).click()
      await expect(page).toHaveURL(/\/driver\/history$/)
      await expect(page.locator('.driver-grid .driver-card').first()).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 700))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
      const histHeaderRect = await page.locator('#driver-sidebar').evaluate(el => {
        const r = el.getBoundingClientRect()
        return { top: r.top, height: r.height }
      })
      expect(histHeaderRect.top).toBeGreaterThanOrEqual(barBottom - 2)
      expect(histHeaderRect.top).toBeLessThanOrEqual(barBottom + 2)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  }
})

test('Comprehensive Pre-UAT Bugfix & UX Pass: zero overlaps, 2-step hospital origin, dropdown geometry & BK-SEED-1005 reassign, readiness panel feedback, tracking pagination auto-scroll, address replace & mobile menu dot', async ({ page }) => {
  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line).*/, route => route.abort())
  let reverseHit = 0
  await page.route('https://photon.komoot.io/reverse*', route => {
    reverseHit += 1
    const road = reverseHit === 1 ? 'ถนนบ้านกลางสาย 1' : 'ถนนลำพูน-ป่าซาง'
    return route.fulfill({ json: { features: [{ properties: { name: road } }] } })
  })

  await page.setViewportSize({ width: 1280, height: 860 })
  await page.goto('/')
  await page.locator('[data-actor-id="ACT-02"]').click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  await expect(page.locator('.dispatch-fleet-matrix')).toBeVisible()

  // Helper to assert zero overlapping active trips on any vehicleId or driverId in localStorage demo DB
  const assertZeroOverlaps = async () => {
    const conflicts = await page.evaluate(() => {
      const raw = localStorage.getItem('ban-klang-transit:interactive-demo-db:v1')
      if (!raw) return []
      const db = JSON.parse(raw) as { bookings: { id: string; status: string; vehicleId: string | null; driverId: string | null; appointmentAt: string; schedule: { departureAt: string; readyAt: string } | null; proposedSchedule: { departureAt: string; readyAt: string } | null }[] }
      const active = db.bookings.filter(b => !['CANCELLED', 'REJECTED', 'ABORTED', 'COMPLETED'].includes(b.status) && (b.vehicleId || b.driverId))
      const spans = active.map(b => {
        const s = b.schedule ?? b.proposedSchedule
        const start = s ? Date.parse(s.departureAt) : Date.parse(b.appointmentAt) - 75 * 60_000
        const end = s ? Date.parse(s.readyAt) : Date.parse(b.appointmentAt) + 55 * 60_000
        return { id: b.id, v: b.vehicleId, d: b.driverId, start, end }
      })
      const found: string[] = []
      for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
          const a = spans[i]
          const b = spans[j]
          if (a.start < b.end && a.end > b.start) {
            if (a.v && b.v && a.v === b.v) found.push(`vehicle:${a.v}:${a.id}<->${b.id}`)
            if (a.d && b.d && a.d === b.d) found.push(`driver:${a.d}:${a.id}<->${b.id}`)
          }
        }
      }
      return found
    })
    expect(conflicts).toEqual([])
  }

  // 1a. Zero overlaps in initial Demo Mode
  await assertZeroOverlaps()

  // 2. 2-Step Hospital-Origin Scheduling Flow (same-day filter + preserved previousBookingId + custom dropdown non-overlap geometry)
  await page.evaluate(() => {
    const key = 'ban-klang-transit:interactive-demo-db:v1'
    const db = JSON.parse(localStorage.getItem(key)!)
    const target = db.bookings.find((b: { id: string }) => b.id === 'BK-DEMO-1002')
    const baseMs = Date.parse(target.appointmentAt)
    const sameDayAppt = new Date(baseMs - 3 * 3600_000).toISOString()
    const oldMonthAppt = new Date(baseMs - 30 * 86400_000).toISOString()
    const makePrior = (id: string, apptIso: string) => {
      const m = Date.parse(apptIso)
      return {
        ...target,
        id,
        reference: id,
        status: 'COMPLETED',
        revision: 4,
        patientName: `ผู้ป่วยรอบก่อนหน้า ${id}`,
        appointmentAt: apptIso,
        vehicleId: 'demo-vehicle-1',
        driverId: 'demo-driver-A',
        vehicleName: 'รถคันที่ 01 · กข 1101',
        schedule: {
          departureAt: new Date(m - 55 * 60_000).toISOString(),
          pickupAt: new Date(m - 35 * 60_000).toISOString(),
          arrivalAt: new Date(m - 20 * 60_000).toISOString(),
          readyAt: new Date(m + 10 * 60_000).toISOString(),
          pickupWaitingMinutes: 0,
          originLocationId: db.settings.id,
          originKind: 'depot',
        },
        proposedSchedule: null,
      }
    }
    db.bookings.push(makePrior('BK-DEMO-PRIOR-SAMEDAY', sameDayAppt))
    db.bookings.push(makePrior('BK-DEMO-PRIOR-OLDMONTH', oldMonthAppt))
    localStorage.setItem(key, JSON.stringify(db))
  })

  await page.locator('#dispatcher-sidebar').getByRole('link', { name: 'จัดตารางและมอบหมาย', exact: true }).click()
  await expect(page).toHaveURL(/\/dispatcher\/assignment$/)
  await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()

  // Verify custom dropdown options NEVER overlap vertically for Vehicle & Driver pickers
  const assertNoOptionOverlap = async (triggerName: RegExp) => {
    await page.getByRole('button', { name: triggerName }).click()
    const options = page.locator('.dispatch-resource-options [role="option"]')
    const count = await options.count()
    expect(count).toBeGreaterThanOrEqual(3)
    const rects = await options.evaluateAll(els => els.map(el => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom }
    }))
    for (let i = 0; i < rects.length - 1; i++) {
      expect(rects[i].bottom).toBeLessThanOrEqual(rects[i + 1].top + 1)
    }
  }

  await assertNoOptionOverlap(/^รถรับส่ง:/)
  await page.getByRole('option', { name: /รถคันที่ 01/ }).click()
  await assertNoOptionOverlap(/^คนขับ:/)
  await page.getByRole('option', { name: /นายสมชาย ใจดี/ }).click()

  // Hospital origin shows ONLY same-day prior job (excludes cross-month BK-DEMO-PRIOR-OLDMONTH)
  const originSelect = page.locator('#dispatch-origin-select')
  await originSelect.selectOption('hospital-hariphunchai')
  const prevSelect = page.locator('#dispatch-previous-job-select')
  await expect(prevSelect).toContainText('BK-DEMO-PRIOR-SAMEDAY')
  await expect(prevSelect).not.toContainText('BK-DEMO-PRIOR-OLDMONTH')
  await prevSelect.selectOption('BK-DEMO-PRIOR-SAMEDAY')

  // Step 1 -> confirms schedule and preserves previousBookingId in locked Section 3 -> Step 2 stays ENABLED and completes!
  await page.getByRole('button', { name: 'ตรวจสอบและยืนยันตาราง', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'ยืนยันตาราง', exact: true }).click()
  await expect(page.locator('.dispatch-locked-caption')).toContainText('ล็อกข้อมูลตามตารางที่ยืนยันแล้ว')
  await expect(prevSelect).toHaveValue('BK-DEMO-PRIOR-SAMEDAY')
  const step2Btn = page.getByRole('button', { name: 'ตรวจสอบซ้ำและยืนยันการมอบหมาย', exact: true })
  await expect(step2Btn).toBeEnabled()
  await step2Btn.click()
  await page.getByRole('dialog').getByRole('button', { name: 'ยืนยันการมอบหมาย', exact: true }).click()
  await expect(page).toHaveURL(/\/dispatcher\/tracking$/)

  // 1b + 3 + 5. Inject a preserved BK-DEMO booking on 2026-11-22 09:15-11:25 on demo-vehicle-1/demo-driver-A (exact collision with BK-SEED-1005!),
  // then load 320 seed rows -> verify ZERO overlaps across 320+ merged bookings, BK-SEED-1005 reassignable, tracking table no inner scrollbar + pagination auto-scroll!
  await page.evaluate(() => {
    const key = 'ban-klang-transit:interactive-demo-db:v1'
    const db = JSON.parse(localStorage.getItem(key)!)
    const base = db.bookings.find((b: { id: string }) => b.id === 'BK-DEMO-1003')
    if (base) {
      db.bookings.push({
        ...base,
        id: 'BK-DEMO-COLLIDE-1122',
        reference: 'BK-DEMO-COLLIDE-1122',
        status: 'ASSIGNED',
        appointmentAt: '2026-11-22T10:30:00+07:00',
        vehicleId: 'demo-vehicle-1',
        driverId: 'demo-driver-A',
        vehicleName: 'รถคันที่ 01 · กข 1101',
        schedule: {
          departureAt: '2026-11-22T09:15:00+07:00',
          pickupAt: '2026-11-22T09:45:00+07:00',
          arrivalAt: '2026-11-22T10:10:00+07:00',
          readyAt: '2026-11-22T11:25:00+07:00',
          pickupWaitingMinutes: 0,
          originLocationId: db.settings.id,
          originKind: 'depot',
        },
        proposedSchedule: null,
      })
      localStorage.setItem(key, JSON.stringify(db))
    }
  })
  const demoBar = page.locator('.demo-role-bar')
  await demoBar.getByRole('button', { name: 'ผู้ดูแลระบบ' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await page.getByRole('button', { name: 'โหลดข้อมูลตัวอย่าง 320 รายการ' }).first().click()
  await expect(page.getByText('ข้อมูลจำลองในระบบ: 320 รายการ')).toBeVisible()
  await assertZeroOverlaps()

  // Verify BK-SEED-1005 has at least 1 genuinely free wheelchair-compatible vehicle & free driver available in Demo Mode
  await demoBar.getByRole('button', { name: 'เจ้าหน้าที่จัดรถ' }).click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  await page.locator('#dispatcher-sidebar').getByRole('link', { name: 'ติดตามงานรับส่ง', exact: true }).click()
  await expect(page).toHaveURL(/\/dispatcher\/tracking$/)

  // Tracking table: NO inner vertical scroll trap & horizontal side-by-side pagination buttons & auto-scroll on ถัดไป →
  const wrapMetrics = await page.locator('.dispatch-monitoring .service-table-wrap').evaluate(el => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }))
  expect(wrapMetrics.scrollHeight).toBeLessThanOrEqual(wrapMetrics.clientHeight + 2)

  const prevPageBtn = page.locator('.dispatch-monitoring .service-pagination-btn').nth(0)
  const nextPageBtn = page.locator('.dispatch-monitoring .service-pagination-btn').nth(1)
  const prevBox = (await prevPageBtn.boundingBox())!
  const nextBox = (await nextPageBtn.boundingBox())!
  expect(Math.abs(prevBox.y - nextBox.y)).toBeLessThanOrEqual(4)
  await nextPageBtn.click()
  await expect(page.locator('.dispatch-monitoring .service-pagination-summary')).toContainText('หน้า 2/')
  await expect.poll(async () => page.locator('.dispatch-monitoring').evaluate(el => el.getBoundingClientRect().top)).toBeLessThanOrEqual(220)

  // Open BK-SEED-1005 -> choose 'modify' -> verify a genuinely free wheelchair vehicle + free driver exist!
  await page.getByPlaceholder(/ค้นหารหัสงาน/).fill('BK-SEED-1005')
  await page.locator('.dispatch-monitoring tbody tr', { hasText: 'BK-SEED-1005' }).getByRole('button', { name: /ดูสถานะ|ดูรายละเอียด/ }).click()
  const trackDialog = page.getByRole('dialog')
  await trackDialog.getByLabel('การดำเนินการ').selectOption('modify')
  await trackDialog.getByRole('button', { name: /^รถรับส่ง:/ }).click()
  const freeWheelchairOpt = trackDialog.locator('.dispatch-resource-options [role="option"]', { hasText: /ว่าง.*รถเข็น/ })
  expect(await freeWheelchairOpt.count()).toBeGreaterThanOrEqual(1)
  await freeWheelchairOpt.first().click()
  await trackDialog.getByRole('button', { name: /^คนขับ:/ }).click()
  const freeDriverOpt = trackDialog.locator('.dispatch-resource-options [role="option"]', { hasText: /ว่าง \(/ })
  expect(await freeDriverOpt.count()).toBeGreaterThanOrEqual(1)
  await freeDriverOpt.first().click()
  await trackDialog.getByRole('button', { name: 'ปิดรายละเอียด', exact: true }).click()

  // 4. Redesigned #resource-readiness-panel: held pills + quick-fill chip + inline hint + green confirmation feedback
  await page.evaluate(() => {
    const key = 'ban-klang-transit:interactive-demo-db:v1'
    const db = JSON.parse(localStorage.getItem(key)!)
    db.vehicles[0].held = true
    db.drivers[0].held = true
    localStorage.setItem(key, JSON.stringify(db))
  })
  await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click()
  const readiness = page.locator('#resource-readiness-panel')
  await expect(readiness).toBeVisible()
  await expect(readiness.locator('.dispatch-readiness-count-badge')).toContainText('รอคลี่คลาย 2 รายการ')
  await expect(readiness.locator('.dispatch-readiness-hint')).toContainText('กรุณาเลือกทรัพยากร')

  await readiness.locator('.dispatch-held-pill').first().click()
  await readiness.getByLabel(/ตำแหน่งปัจจุบันที่ยืนยันแล้ว/).selectOption({ index: 1 })
  await expect(readiness.locator('.dispatch-readiness-hint')).toContainText('กรุณากรอกเหตุผลและผลตรวจสอบ')
  await readiness.locator('.dispatch-readiness-chip', { hasText: 'กลับถึงศูนย์รถพร้อมใช้งานแล้ว' }).click()
  await readiness.getByLabel('ยืนยันตำแหน่งจริงและความพร้อมของทรัพยากรนี้แล้ว').check()
  await readiness.getByRole('button', { name: 'ยืนยันความพร้อมทรัพยากรนี้' }).click()
  await expect(readiness.locator('.dispatch-readiness-success')).toContainText('เหลือทรัพยากรรอคลี่คลายอีก 1 รายการ')
  await expect(readiness.locator('.dispatch-readiness-count-badge')).toContainText('รอคลี่คลาย 1 รายการ')

  // 7. Mobile 390px hamburger menu (☰) priority status dots (red on Dispatcher hold, green on Driver active trip on /driver/history)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('#dispatcher-sidebar .mobile-menu-status-dot.is-danger')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // Clear remaining hold so Dispatcher dot downgrades to amber on /dispatcher/tracking (pending/unassigned exist on other tabs)
  await readiness.locator('.dispatch-held-pill').first().click()
  await readiness.getByLabel(/ตำแหน่งปัจจุบันที่ยืนยันแล้ว/).selectOption({ index: 1 })
  await readiness.locator('.dispatch-readiness-chip').first().click()
  await readiness.getByLabel('ยืนยันตำแหน่งจริงและความพร้อมของทรัพยากรนี้แล้ว').check()
  await readiness.getByRole('button', { name: 'ยืนยันความพร้อมทรัพยากรนี้' }).click()
  await expect(page.locator('.dispatch-readiness-success')).toContainText('ปล่อยการระงับครบทุกรายการ')
  await expect(page.locator('#dispatcher-sidebar .mobile-menu-status-dot.is-amber')).toBeVisible()

  // Driver mobile 390px: active trip has NO dot on /driver/status and shows GREEN dot on ☰ when viewing /driver/history
  await demoBar.getByRole('button', { name: 'พนักงานขับรถ' }).click()
  await expect(page).toHaveURL(/\/driver$/)
  await expect(page.locator('.driver-trip').first()).toBeVisible()
  const trackActive = page.getByRole('button', { name: /ติดตามสถานะงาน/ }).first()
  if ((await trackActive.count()) > 0) {
    await expect(page.locator('#driver-sidebar .mobile-menu-status-dot.is-active')).toBeVisible()
    await trackActive.click()
  } else {
    await page.getByRole('button', { name: /ดูรายละเอียด/ }).first().click()
    await page.getByRole('button', { name: 'เริ่มงาน', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'ยืนยันการอัปเดต', exact: true }).click()
  }
  await expect(page).toHaveURL(/\/driver\/status/)
  await expect(page.locator('#driver-sidebar .mobile-menu-status-dot')).toHaveCount(0)
  await page.getByRole('button', { name: 'เมนูคนขับ', exact: true }).click()
  await page.getByRole('dialog', { name: 'เมนูคนขับ', exact: true }).getByRole('link', { name: 'ประวัติ', exact: true }).click()
  await expect(page).toHaveURL(/\/driver\/history$/)
  await expect(page.locator('#driver-sidebar .mobile-menu-status-dot.is-active')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // 6. Citizen Pickup Address: auto-fill replaces on pin move; manual edit shows ใช้ที่อยู่นี้แทน: and clicking replaces cleanly!
  await demoBar.getByRole('button', { name: 'ผู้ป่วย / จองรถ' }).click()
  await page.getByRole('button', { name: 'เริ่มจองรถ →' }).click()
  await page.getByLabel(/รับทราบการใช้ข้อมูล/).check()
  await page.getByRole('button', { name: 'รับทราบและถัดไป' }).click()
  await page.getByLabel(/ชื่อผู้ป่วย/).fill('นางทดสอบ แทนที่ที่อยู่')
  await page.getByLabel(/เบอร์โทรศัพท์ของคุณ/).fill('0894445566')
  await page.getByLabel(/โรงพยาบาล/).selectOption('hospital-lamphun')
  await page.locator('button.booking-input-trigger').first().click()
  await page.getByRole('button', { name: 'เดือนถัดไป', exact: true }).click()
  await page.locator('.booking-calendar button:not([disabled])', { hasText: /^\s*(?:[\u0E00-\u0E7F]+\.\s*)?24$/ }).first().click()
  await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()
  await page.locator('button.booking-input-trigger').nth(1).click()
  await setPickerTime(page, 'ชั่วโมง', '10')
  await setPickerTime(page, 'นาที', '30')
  await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
  await page.getByRole('button', { name: 'ถัดไป →' }).click()
  await expect(page).toHaveURL(/\/booking\/assistance$/)

  const addrInput = page.getByLabel(/ที่อยู่จุดรับ/)
  await page.getByText('เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง').click()
  await page.getByLabel('ละติจูด').fill('18.5795')
  await page.getByLabel('ลองจิจูด').fill('99.0435')
  await expect(addrInput).toHaveValue('ถนนบ้านกลางสาย 1')

  // Second pin move while still auto-filled cleanly replaces (never concatenates!)
  await page.getByLabel('ละติจูด').fill('18.5890')
  await page.getByLabel('ลองจิจูด').fill('99.0468')
  await expect(addrInput).toHaveValue('ถนนลำพูน-ป่าซาง')

  // Manual edit -> next pin move preserves manual text and renders ใช้ที่อยู่นี้แทน: -> clicking replaces entire value and hides pill!
  await addrInput.fill('99/1 ซอยบ้านฉัน')
  await page.getByLabel('ละติจูด').fill('18.5842')
  await page.getByLabel('ลองจิจูด').fill('99.0352')
  await expect(addrInput).toHaveValue('99/1 ซอยบ้านฉัน')
  const replacePill = page.locator('.booking-address-suggestion')
  await expect(replacePill).toContainText('ใช้ที่อยู่นี้แทน: ถนนลำพูน-ป่าซาง')
  await replacePill.click()
  await expect(addrInput).toHaveValue('ถนนลำพูน-ป่าซาง')
  await expect(replacePill).toHaveCount(0)
})

test('final UI polish: hug-tight form focus rings, incident modal spacing, and multi-viewport zero-overflow audit across all 4 roles', async ({ page }) => {
  test.setTimeout(120_000)

  const assertViewportClean = async (label: string) => {
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      htmlOverflowX: getComputedStyle(document.documentElement).overflowX,
      bodyOverflowX: getComputedStyle(document.body).overflowX,
    }))
    expect(metrics.scrollWidth, `${label}: horizontal overflow`).toBeLessThanOrEqual(metrics.innerWidth)
    expect(metrics.htmlOverflowX, `${label}: html overflow-x`).toBe('clip')
    expect(metrics.bodyOverflowX, `${label}: body overflow-x`).toBe('clip')
  }

  await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis|line).*/, route => route.abort())
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.locator('[data-actor-id="ACT-02"]').click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  await expect(page.locator('.dispatch-fleet-matrix')).toBeVisible()
  await assertViewportClean('dispatcher-desktop')

  // Verify Vehicle Timeline รายละเอียด → buttons are never clipped at the right edge of their card
  const timelineLinks = page.locator('.dispatch-timeline-trip-pill .dispatch-mini-link')
  if ((await timelineLinks.count()) > 0) {
    const firstClipCheck = await timelineLinks.first().evaluate(btn => {
      const card = btn.closest('.dispatch-timeline-trip-pill')!
      const b = btn.getBoundingClientRect()
      const c = card.getBoundingClientRect()
      return { btnRight: b.right, cardRight: c.right, viewportRight: window.innerWidth }
    })
    expect(firstClipCheck.btnRight).toBeLessThanOrEqual(firstClipCheck.cardRight + 1)
    expect(firstClipCheck.btnRight).toBeLessThanOrEqual(firstClipCheck.viewportRight)
  }

  // Navigate to Dispatcher Tracking -> open Incident Resolution Modal -> verify clean 14px/6px spacing & hug-tight focus ring
  await page.locator('#dispatcher-sidebar').getByRole('link', { name: 'ติดตามงานรับส่ง', exact: true }).click()
  await expect(page).toHaveURL(/\/dispatcher\/tracking$/)
  await assertViewportClean('dispatcher-tracking-desktop')

  const firstTrackBtn = page.locator('.dispatch-monitoring tbody tr').first().getByRole('button', { name: /ดูสถานะ|ดูรายละเอียด/ })
  await firstTrackBtn.click()
  const dialog = page.getByRole('dialog')
  const actionSelect = dialog.locator('.dispatch-operations-section > .booking-field > select')
  await actionSelect.selectOption('REPORT_INCIDENT')

  const reasonTextarea = dialog.getByLabel('เหตุผล')
  const confirmCheckboxWrap = dialog.locator('.dispatch-operations-form .booking-checkbox')
  const submitOpBtn = dialog.getByRole('button', { name: 'ยืนยันการดำเนินการ', exact: true })

  // Verify hug-tight WCAG focus ring on select and textarea (keyboard focus triggers :focus-visible)
  await reasonTextarea.focus()
  await page.keyboard.press('Shift+Tab') // back to select
  await page.keyboard.press('Tab') // keyboard-focus textarea
  const textareaFocus = await reasonTextarea.evaluate(el => {
    const cs = getComputedStyle(el)
    return {
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineOffset: cs.outlineOffset,
      boxShadow: cs.boxShadow,
    }
  })
  expect(textareaFocus.outlineStyle).toBe('solid')
  expect(textareaFocus.outlineWidth).toBe('2px')
  expect(textareaFocus.outlineOffset).toBe('0px')
  expect(textareaFocus.boxShadow).not.toBe('none')

  // Verify clean vertical spacing (gap >= 12px) between select, textarea, checkbox, and submit button
  const selectBox = (await actionSelect.boundingBox())!
  const reasonLabelBox = (await dialog.locator('.dispatch-operations-form .booking-field').first().boundingBox())!
  const textareaBox = (await reasonTextarea.boundingBox())!
  const checkboxBox = (await confirmCheckboxWrap.boundingBox())!
  const submitBox = (await submitOpBtn.boundingBox())!

  expect(reasonLabelBox.y - (selectBox.y + selectBox.height)).toBeGreaterThanOrEqual(12)
  expect(checkboxBox.y - (textareaBox.y + textareaBox.height)).toBeGreaterThanOrEqual(12)
  expect(submitBox.y - (checkboxBox.y + checkboxBox.height)).toBeGreaterThanOrEqual(12)

  await dialog.getByRole('button', { name: 'ปิดรายละเอียด', exact: true }).click()

  // Desktop audit across remaining roles
  const demoBar = page.locator('.demo-role-bar')
  await page.locator('#dispatcher-sidebar').getByRole('link', { name: 'จัดตารางและมอบหมาย', exact: true }).click()
  await expect(page).toHaveURL(/\/dispatcher\/assignment$/)
  await assertViewportClean('dispatcher-assignment-desktop')

  await demoBar.getByRole('button', { name: 'พนักงานขับรถ' }).click()
  await expect(page).toHaveURL(/\/driver$/)
  await assertViewportClean('driver-desktop')
  await page.locator('#driver-sidebar').getByRole('link', { name: 'ประวัติ', exact: true }).click()
  await expect(page).toHaveURL(/\/driver\/history$/)
  await assertViewportClean('driver-history-desktop')

  await demoBar.getByRole('button', { name: 'ผู้ดูแลระบบ' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await assertViewportClean('admin-desktop')
  await page.locator('#admin-sidebar').getByRole('link', { name: 'รถรับส่ง', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/vehicles$/)
  await assertViewportClean('admin-vehicles-desktop')
  await page.locator('#admin-sidebar').getByRole('link', { name: 'คนขับ', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/drivers$/)
  await assertViewportClean('admin-drivers-desktop')

  await demoBar.getByRole('button', { name: 'ผู้ป่วย / จองรถ' }).click()
  await expect(page).toHaveURL(/\/booking$/)
  await assertViewportClean('citizen-desktop')
  await page.getByRole('button', { name: 'ดูสถานะการจอง', exact: true }).click()
  await expect(page).toHaveURL(/\/booking\/bookings$/)
  await assertViewportClean('citizen-bookings-desktop')

  // Mobile 390x844 full-app sweep across all 4 workspaces + Admin modal single-column stacking + Driver CTA clearance
  await page.setViewportSize({ width: 390, height: 844 })
  await assertViewportClean('citizen-bookings-mobile')

  await demoBar.getByRole('button', { name: 'เจ้าหน้าที่จัดรถ' }).click()
  await expect(page).toHaveURL(/\/dispatcher$/)
  await assertViewportClean('dispatcher-mobile')

  await demoBar.getByRole('button', { name: 'พนักงานขับรถ' }).click()
  await expect(page).toHaveURL(/\/driver$/)
  await assertViewportClean('driver-mobile')
  // Open active or first job details -> verify bottom sticky CTA never covers bottom card when scrolled to end
  await page.getByRole('button', { name: /ดูรายละเอียด|ติดตามสถานะงาน/ }).first().click()
  await expect(page.locator('.driver-action')).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const clearance = await page.evaluate(() => {
    const cta = document.querySelector('.driver-action')!.getBoundingClientRect()
    const content = document.querySelector('.driver-content')!
    const children = Array.from(content.children).filter(el => !el.classList.contains('driver-action') && getComputedStyle(el).display !== 'none')
    const last = children[children.length - 1]
    return { lastBottom: last ? last.getBoundingClientRect().bottom : 0, ctaTop: cta.top }
  })
  expect(clearance.lastBottom).toBeLessThanOrEqual(clearance.ctaTop + 2)
  await assertViewportClean('driver-detail-mobile')

  await demoBar.getByRole('button', { name: 'ผู้ดูแลระบบ' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await assertViewportClean('admin-mobile')
  await page.getByRole('button', { name: 'เมนูผู้ดูแลระบบ', exact: true }).click()
  await page.getByRole('dialog', { name: 'เมนูผู้ดูแลระบบ', exact: true }).getByRole('link', { name: 'รถรับส่ง', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/vehicles$/)
  await assertViewportClean('admin-vehicles-mobile')
  await page.getByRole('button', { name: '+ เพิ่มรถ', exact: true }).click()
  const adminDialog = page.getByRole('dialog')
  await expect(adminDialog).toBeVisible()
  const adminInput = adminDialog.locator('input').first()
  await adminInput.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  const adminInputFocus = await adminInput.evaluate(el => {
    const cs = getComputedStyle(el)
    return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineOffset: cs.outlineOffset, boxShadow: cs.boxShadow }
  })
  expect(adminInputFocus.outlineStyle).toBe('solid')
  expect(adminInputFocus.outlineWidth).toBe('2px')
  expect(adminInputFocus.outlineOffset).toBe('0px')
  expect(adminInputFocus.boxShadow).not.toBe('none')
  await assertViewportClean('admin-modal-mobile')
  await adminDialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click()
})
