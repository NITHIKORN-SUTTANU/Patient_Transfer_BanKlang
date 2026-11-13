# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: navigation.spec.ts >> /driver navigation collapses, supports keyboard, and adapts to resizing
- Location: tests\navigation.spec.ts:102:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/staff/login?next=%2Fdriver
Call log:
  - navigating to "http://127.0.0.1:4173/staff/login?next=%2Fdriver", waiting until "load"

```

# Test source

```ts
  1  | import { expect, type Page } from '@playwright/test'
  2  | 
  3  | export const emptyCatalog = { hospitals: [], vehicles: [], drivers: [], locations: [], depotLocationId: null }
  4  | export async function mockDispatcherLogin(page: Page, role = 'dispatcher') {
  5  |   await page.route('**/api/auth/**', route => route.fulfill({ json: route.request().url().endsWith('/login') ? { token: 'synthetic-token' } : { id: 'staff-id', role, name: 'เจ้าหน้าที่ทดสอบ', driverId: role === 'driver' ? 'driver-id' : null } }))
  6  | }
  7  | async function enterStaff(page: Page, path: string, label: string, main: string) {
> 8  |   await page.goto(`/staff/login?next=${encodeURIComponent(path)}`)
     |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/staff/login?next=%2Fdriver
  9  |   await page.getByLabel('ชื่อผู้ใช้').fill('staff')
  10 |   await page.getByLabel('รหัสผ่าน').fill('synthetic-password')
  11 |   await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  12 |   await page.getByRole('link', { name: label }).click()
  13 |   await expect(page.locator(main)).toBeVisible()
  14 |   await expect(page.getByText('กำลังโหลดข้อมูล…', { exact: true })).toHaveCount(0)
  15 | }
  16 | export function enterDispatcher(page: Page, path = '/dispatcher') { return enterStaff(page, path, 'เปิดหน้าจัดรถ', '#dispatcher-main') }
  17 | export function enterDriver(page: Page, path = '/driver') { return enterStaff(page, path, 'เปิดหน้าคนขับ', '#driver-main') }
  18 | export function enterAdmin(page: Page, path = '/admin') { return enterStaff(page, path, 'เปิดหน้าผู้ดูแลระบบ', '#admin-main') }
  19 | 
```