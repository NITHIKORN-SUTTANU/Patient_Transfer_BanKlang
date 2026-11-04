import { expect, test } from '@playwright/test'

test('dispatcher navbar keeps layout and active styling across pages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dispatcher')
  const sidebar = page.locator('#dispatcher-sidebar')
  const links = sidebar.locator('nav a')
  const initial = await links.evaluateAll(nodes => nodes.map(node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height } }))
  for (const name of ['จัดตารางและมอบหมาย', 'ติดตามงานรับส่ง', 'แดชบอร์ดงานรับส่ง']) {
    const link = sidebar.getByRole('link', { name, exact: true })
    await link.click()
    await expect(link).toHaveAttribute('aria-current', 'page')
    await expect(link).toHaveCSS('font-weight', '600')
    await expect(link).toHaveCSS('background-color', 'rgb(215, 243, 236)')
    expect(await links.evaluateAll(nodes => nodes.map(node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height } }))).toEqual(initial)
  }
  await sidebar.getByRole('button', { name: 'ย่อเมนูด้านข้าง', exact: true }).click()
  await sidebar.getByRole('link', { name: 'จัดตารางและมอบหมาย', exact: true }).click()
  expect((await sidebar.boundingBox())!.width).toBe(80)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'เมนูเจ้าหน้าที่จัดรถ', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'เมนูเจ้าหน้าที่จัดรถ', exact: true })
  const active = drawer.getByRole('link', { name: 'จัดตารางและมอบหมาย', exact: true })
  await expect(active).toHaveAttribute('aria-current', 'page')
  await expect(active).toHaveCSS('font-weight', '600')
  await expect(active).toHaveCSS('background-color', 'rgb(236, 249, 245)')
})

test('mobile navbar height stays same on assignment and other pages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const heights: number[] = []
  for (const route of ['/dispatcher', '/dispatcher/assignment', '/dispatcher/tracking']) {
    await page.goto(route)
    heights.push((await page.locator('#dispatcher-sidebar').boundingBox())!.height)
  }
  expect(heights[1]).toBe(heights[0])
  expect(heights[2]).toBe(heights[0])
})
