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
