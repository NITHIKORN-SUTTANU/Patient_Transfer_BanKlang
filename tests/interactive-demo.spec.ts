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

  // Save/update profile keeps checkbox checked and shows Thai confirmation
  const saveCheckbox = page.getByLabel('บันทึกข้อมูลผู้ป่วยไว้ใช้ครั้งต่อไป')
  await saveCheckbox.check()
  await page.getByRole('button', { name: 'บันทึกข้อมูลผู้ป่วย' }).click()
  await expect(saveCheckbox).toBeChecked()
  await expect(page.locator('.booking-success-notice')).toContainText('✓ บันทึกข้อมูลผู้ป่วยเรียบร้อยแล้ว')
  await page.getByRole('button', { name: 'อัปเดตข้อมูลผู้ป่วยที่บันทึกไว้' }).click()
  await expect(saveCheckbox).toBeChecked()
  await expect(page.locator('.booking-success-notice')).toContainText('✓ อัปเดตข้อมูลผู้ป่วยเรียบร้อยแล้ว')

  // Submit and verify newest booking appears first in รายการจองของฉัน
  await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ' }).click()
  await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว', exact: true })).toBeVisible()
  const newBookingRef = (await page.locator('.booking-summary-id').textContent())?.trim() ?? ''
  expect(newBookingRef.length).toBeGreaterThan(0)
  await page.getByRole('link', { name: 'กลับหน้าหลัก' }).click()
  await page.getByRole('button', { name: 'ดูสถานะการจอง' }).click()
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
