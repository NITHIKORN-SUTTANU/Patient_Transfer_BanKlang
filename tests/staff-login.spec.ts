import { test, expect } from '@playwright/test'

test('staff identity comes from API; invalid login, revocation and logout never use demo identity', async ({ page }) => {
  let rejected = true
  let revoked = false
  let loggedOut = false
  await page.route('**/api/auth/**', async route => {
    const request = route.request()
    if (request.url().endsWith('/login')) {
      expect(request.postDataJSON()).toEqual({ username: 'staff', password: 'synthetic-password' })
      return route.fulfill({ status: rejected ? 401 : 200, json: rejected ? { error: 'Invalid credentials' } : { token: 'synthetic-token' } })
    }
    expect(request.headers().authorization).toBe('Bearer synthetic-token')
    if (request.url().endsWith('/logout')) { loggedOut = true; return route.fulfill({ json: { loggedOut: true } }) }
    return route.fulfill({ status: revoked ? 401 : 200, json: revoked ? {} : { id: 'staff-id', role: 'dispatcher', name: 'เจ้าหน้าที่ทดสอบ', driverId: null } })
  })
  await page.goto('/staff/login')
  async function login() {
    await page.getByLabel('ชื่อผู้ใช้').fill('staff')
    await page.getByLabel('รหัสผ่าน').fill('synthetic-password')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  }
  await login()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('ชื่อผู้ใช้')).toHaveValue('staff')
  await expect(page.getByLabel('รหัสผ่าน')).toHaveValue('')
  rejected = false
  await login()
  await expect(page.getByRole('heading', { name: 'เจ้าหน้าที่ทดสอบ' })).toBeVisible()
  expect(await page.evaluate(() => Object.values(localStorage).join('') + Object.values(sessionStorage).join(''))).not.toContain('synthetic-token')
  revoked = true
  await page.getByRole('button', { name: 'ตรวจสอบเซสชัน' }).click()
  await expect(page.getByLabel('ชื่อผู้ใช้')).toBeVisible()
  await expect(page.getByRole('alert')).toBeVisible()
  revoked = false
  await login()
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click()
  await expect(page.getByLabel('ชื่อผู้ใช้')).toBeVisible()
  expect(loggedOut).toBe(true)
})

test('network failure preserves username and does not fabricate a staff session', async ({ page }) => {
  await page.route('**/api/auth/login', route => route.abort())
  await page.goto('/staff/login')
  await page.getByLabel('ชื่อผู้ใช้').fill('staff')
  await page.getByLabel('รหัสผ่าน').fill('synthetic-password')
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('เชื่อมต่อระบบไม่ได้')
  await expect(page.getByLabel('ชื่อผู้ใช้')).toHaveValue('staff')
  await expect(page.getByRole('button', { name: 'ออกจากระบบ' })).toHaveCount(0)
})
