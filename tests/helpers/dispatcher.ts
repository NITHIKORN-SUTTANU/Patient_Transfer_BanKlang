import { expect, type Page } from '@playwright/test'

export const emptyCatalog = { hospitals: [], vehicles: [], drivers: [], locations: [], depotLocationId: null }
export async function mockDispatcherLogin(page: Page, role = 'dispatcher') {
  await page.route('**/api/dispatcher-alerts**', route => route.fulfill({json:{alerts:[],unread:0,nextCursor:null}}))
  await page.route('**/api/notification-failures**', route => route.fulfill({json:{failures:[],total:0,pending:0,nextCursor:null}}))
  await page.route('**/api/admin/notification-failures**', route => route.fulfill({json:{failures:[],total:0,pending:0,nextCursor:null,service:{configured:false,deliveryEnabled:false}}}))
  await page.route('**/api/auth/**', route => route.fulfill({ json: route.request().url().endsWith('/login') ? { token: 'synthetic-token' } : { id: 'staff-id', role, name: 'เจ้าหน้าที่ทดสอบ', driverId: role === 'driver' ? 'driver-id' : null } }))
}
async function enterStaff(page: Page, path: string, label: string, main: string) {
  await page.goto(`/staff/login?next=${encodeURIComponent(path)}`)
  await page.getByLabel('ชื่อผู้ใช้').fill('staff')
  await page.getByLabel('รหัสผ่าน').fill('synthetic-password')
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await page.getByRole('link', { name: label }).click()
  await expect(page.locator(main)).toBeVisible()
  await expect(page.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
}
export function enterDispatcher(page: Page, path = '/dispatcher') { return enterStaff(page, path, 'เปิดหน้าจัดรถ', '#dispatcher-main') }
export function enterDriver(page: Page, path = '/driver') { return enterStaff(page, path, 'เปิดหน้าคนขับ', '#driver-main') }
export function enterAdmin(page: Page, path = '/admin') { return enterStaff(page, path, 'เปิดหน้าผู้ดูแลระบบ', '#admin-main') }
