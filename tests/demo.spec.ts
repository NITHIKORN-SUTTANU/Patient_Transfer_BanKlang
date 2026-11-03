import { expect, test } from '@playwright/test'

const roles = [
  ['ACT-01', '/booking'], ['ACT-02', '/dispatcher'], ['ACT-03', '/driver'], ['ACT-04', '/admin'],
] as const
const key = 'ban-klang-transit:demo:v1'

test('one click opens each role, shares the latest role, and reset requires confirmation', async ({ page, context }) => {
  await page.goto('/')
  const otherTab = await context.newPage()
  await otherTab.goto('/')
  for (const [actor, path] of roles) {
    await page.locator(`[data-actor-id="${actor}"]`).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(otherTab.locator(`[data-actor-id="${actor}"]`)).toContainText('ใช้ล่าสุด')
    await page.reload()
    expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!).selectedActor, key)).toBe(actor)
    await page.goto('/')
  }
  const before = await page.evaluate(k => localStorage.getItem(k), key)
  await page.getByRole('button', { name: 'เริ่มการสาธิตใหม่', exact: true }).click()
  await expect(page.getByRole('button', { name: 'เก็บข้อมูลไว้' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBe(before)
  await page.getByRole('button', { name: 'เริ่มการสาธิตใหม่', exact: true }).click()
  await page.getByRole('button', { name: 'ล้างข้อมูลและเริ่มใหม่' }).click()
  await expect(page.locator('.actor-last-used')).toHaveCount(0)
  await page.reload()
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key)).toEqual({ version: 1, selectedActor: null, bookings: [], vehicles: [], drivers: [] })
})

test('mobile layout, keyboard entry, corrupted storage and unknown routes recover', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.evaluate(k => localStorage.setItem(k, '{invalid'), key)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.locator('[data-actor-id="ACT-01"]').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/booking$/)
  await page.goto('/')
  await expect(page.locator('[data-actor-id="ACT-01"]')).toContainText('ใช้ล่าสุด')
  await page.screenshot({ path: 'test-results/landing-mobile.png', fullPage: true })
  await page.goto('/unknown')
  await expect(page.getByRole('heading', { name: 'ไม่พบหน้านี้' })).toBeVisible()
  await page.getByRole('link', { name: 'กลับหน้าหลัก' }).click()
  await expect(page.locator('[data-actor-id="ACT-01"]')).toContainText('ใช้ล่าสุด')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'test-results/landing-desktop.png', fullPage: true })
})

test('switching roles preserves changes saved before a tab notification arrives', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(k => {
    const state = { version: 1, selectedActor: null, bookings: [], vehicles: [{ id: 'V-TEST', label: 'รถทดสอบ', active: true }], drivers: [] }
    localStorage.setItem(k, JSON.stringify(state))
  }, key)
  await page.locator('[data-actor-id="ACT-01"]').click()
  await expect(page).toHaveURL(/\/booking$/)
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!).vehicles[0].id, key)).toBe('V-TEST')
})