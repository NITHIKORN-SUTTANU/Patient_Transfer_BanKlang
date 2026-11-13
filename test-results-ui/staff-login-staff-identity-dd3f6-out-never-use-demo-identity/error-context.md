# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: staff-login.spec.ts >> staff identity comes from API; invalid login, revocation and logout never use demo identity
- Location: tests\staff-login.spec.ts:3:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/staff/login
Call log:
  - navigating to "http://127.0.0.1:4173/staff/login", waiting until "load"

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test('staff identity comes from API; invalid login, revocation and logout never use demo identity', async ({ page }) => {
  4  |   let rejected = true
  5  |   let revoked = false
  6  |   let loggedOut = false
  7  |   await page.route('**/api/auth/**', async route => {
  8  |     const request = route.request()
  9  |     if (request.url().endsWith('/login')) {
  10 |       expect(request.postDataJSON()).toEqual({ username: 'staff', password: 'synthetic-password' })
  11 |       return route.fulfill({ status: rejected ? 401 : 200, json: rejected ? { error: 'Invalid credentials' } : { token: 'synthetic-token' } })
  12 |     }
  13 |     expect(request.headers().authorization).toBe('Bearer synthetic-token')
  14 |     if (request.url().endsWith('/logout')) { loggedOut = true; return route.fulfill({ json: { loggedOut: true } }) }
  15 |     return route.fulfill({ status: revoked ? 401 : 200, json: revoked ? {} : { id: 'staff-id', role: 'dispatcher', name: 'เจ้าหน้าที่ทดสอบ', driverId: null } })
  16 |   })
> 17 |   await page.goto('/staff/login')
     |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/staff/login
  18 |   async function login() {
  19 |     await page.getByLabel('ชื่อผู้ใช้').fill('staff')
  20 |     await page.getByLabel('รหัสผ่าน').fill('synthetic-password')
  21 |     await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  22 |   }
  23 |   await login()
  24 |   await expect(page.getByRole('alert')).toBeVisible()
  25 |   await expect(page.getByLabel('ชื่อผู้ใช้')).toHaveValue('staff')
  26 |   await expect(page.getByLabel('รหัสผ่าน')).toHaveValue('')
  27 |   rejected = false
  28 |   await login()
  29 |   await expect(page.getByRole('heading', { name: 'เจ้าหน้าที่ทดสอบ' })).toBeVisible()
  30 |   expect(await page.evaluate(() => Object.values(localStorage).join('') + Object.values(sessionStorage).join(''))).not.toContain('synthetic-token')
  31 |   revoked = true
  32 |   await page.getByRole('button', { name: 'ตรวจสอบเซสชัน' }).click()
  33 |   await expect(page.getByLabel('ชื่อผู้ใช้')).toBeVisible()
  34 |   await expect(page.getByRole('alert')).toBeVisible()
  35 |   revoked = false
  36 |   await login()
  37 |   await page.getByRole('button', { name: 'ออกจากระบบ' }).click()
  38 |   await expect(page.getByLabel('ชื่อผู้ใช้')).toBeVisible()
  39 |   expect(loggedOut).toBe(true)
  40 | })
  41 | 
  42 | test('network failure preserves username and does not fabricate a staff session', async ({ page }) => {
  43 |   await page.route('**/api/auth/login', route => route.abort())
  44 |   await page.goto('/staff/login')
  45 |   await page.getByLabel('ชื่อผู้ใช้').fill('staff')
  46 |   await page.getByLabel('รหัสผ่าน').fill('synthetic-password')
  47 |   await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  48 |   await expect(page.getByRole('alert')).toContainText('เชื่อมต่อระบบไม่ได้')
  49 |   await expect(page.getByLabel('ชื่อผู้ใช้')).toHaveValue('staff')
  50 |   await expect(page.getByRole('button', { name: 'ออกจากระบบ' })).toHaveCount(0)
  51 | })
  52 | 
```