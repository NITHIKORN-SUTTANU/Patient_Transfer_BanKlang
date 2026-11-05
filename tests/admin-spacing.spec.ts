import { expect, test } from '@playwright/test'

test('admin content stays close to the expanded and collapsed sidebar across desktop widths', async ({ page }) => {
  for (const width of [768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/admin')
    for (const collapsed of [false, true]) {
      if (collapsed) await page.getByRole('button', { name: 'ย่อเมนูด้านข้าง', exact: true }).click()
      const gap = await page.evaluate(() => {
        const sidebar = document.querySelector('#admin-sidebar')!.getBoundingClientRect()
        const heading = document.querySelector('.admin-heading')!.getBoundingClientRect()
        return heading.left - sidebar.right
      })
      expect(gap, `${width}px, ${collapsed ? 'collapsed' : 'expanded'} sidebar`).toBeGreaterThanOrEqual(16)
      expect(gap, `${width}px, ${collapsed ? 'collapsed' : 'expanded'} sidebar`).toBeLessThanOrEqual(48)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (width === 1920) await page.screenshot({ path: `test-results/admin-spacing-${collapsed ? 'collapsed' : 'expanded'}.png`, fullPage: true })
    }
  }
})
