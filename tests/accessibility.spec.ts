import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { DemoState } from '../src/data/seed'

const details = { bookingFor: 'self' as const, patientName: 'ผู้ทดสอบ จำลอง', contactName: '', phone: '0800000000', relationship: '', hospital: 'โรงพยาบาลทดสอบ', date: '2026-10-30', time: '13:10', assistance: 'เดินได้', extras: [], pickup: { x: 50, y: 50, label: 'จุดรับทดสอบ' }, acknowledged: true }
const state: DemoState = {
  version: 1, selectedActor: null, dispatcherResourcesInitialized: true,
  accounts: [{ id: 'U-1', name: 'คนขับทดสอบ', username: 'driver.demo', role: 'Driver', active: true }],
  vehicles: [{ id: 'V-1', label: 'รถทดสอบ', active: true }], drivers: [{ id: 'D-1', name: 'คนขับทดสอบ', active: true, accountId: 'U-1', phone: '0800000000' }],
  settings: { center: 'ศูนย์ทดสอบ', serviceArea: 'บ้านกลาง', opensAt: '08:00', closesAt: '16:30' }, auditEvents: [],
  bookings: [
    { id: 'BK-0001', patientName: details.patientName, status: 'pending', appointmentAt: '2026-10-30T06:10:00.000Z', createdAt: '2026-10-26T03:30:00.000Z', details },
    { id: 'BK-0002', patientName: details.patientName, status: 'approved', appointmentAt: '2026-10-30T06:10:00.000Z', createdAt: '2026-10-26T03:30:00.000Z', details, driverId: 'D-1', vehicleId: 'V-1', schedule: { departureAt: '2026-10-30T04:45:00.000Z', pickupAt: '2026-10-30T05:15:00.000Z', arrivalAt: '2026-10-30T05:50:00.000Z', endsAt: '2026-10-30T06:10:00.000Z', centerToPickupMinutes: 30, pickupToHospitalMinutes: 35, preparationMinutes: 20, calculation: 'demo-manual-v1' } },
    { id: 'BK-0003', patientName: details.patientName, status: 'approved', appointmentAt: '2026-10-30T06:10:00.000Z', createdAt: '2026-10-26T03:30:00.000Z', details },
  ],
}
const routes = ['/', '/booking', '/booking/privacy', '/booking/bookings', '/booking/status/BK-0001', '/booking/status/BK-0002', '/dispatcher', '/dispatcher/assignment', '/dispatcher/tracking', '/driver', '/driver/details?booking=BK-0002', '/driver/status?booking=BK-0002', '/driver/history', '/admin', '/admin/accounts', '/admin/vehicles', '/admin/drivers', '/admin/history', '/admin/settings', '/admin/audit']

async function audit(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))))
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([])
}

async function expectReflow(page: Page) {
  const overflow = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= innerWidth + 1) return null
    return { width: innerWidth, actual: document.documentElement.scrollWidth, elements: [...document.querySelectorAll<HTMLElement>('body *')].filter(el => el.checkVisibility() && el.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(el => ({ tag: el.tagName, class: el.getAttribute('class'), right: el.getBoundingClientRect().right })) }
  })
  expect(overflow).toBeNull()
  const horizontalScrollers = await page.locator('body *').evaluateAll(elements => elements.filter(el => {
    if (!(el instanceof HTMLElement) || !el.checkVisibility()) return false
    return ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1
  }).map(el => ({ tag: el.tagName, class: el.getAttribute('class') })))
  expect(horizontalScrollers).toEqual([])
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.setFixedTime(new Date('2026-10-26T03:30:00Z'))
  await page.addInitScript(value => {
    localStorage.setItem('ban-klang-transit:demo:v1', JSON.stringify(value))
    sessionStorage.setItem('ban-klang-transit:driver', 'D-1')
  }, state)
})

test('screens have no horizontal page or nested scrolling from 320px to desktop', async ({ page }) => {
  test.setTimeout(180000)
  for (const width of [320, 375, 640, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of routes) {
      await test.step(`${width}px ${route}`, async () => {
        await page.goto(route)
        await page.evaluate(() => document.fonts.ready)
        await expectReflow(page)
      })
    }
  }
})

for (const width of [320, 1280]) {
  test(`WCAG automated scan of all role screens at ${width}px`, async ({ page }) => {
    test.setTimeout(180000)
    await page.setViewportSize({ width, height: 900 })
    for (const route of routes) {
      await test.step(route, async () => { await page.goto(route); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await audit(page) })
    }
  })

  test(`reflow, increased text spacing and 200 percent text at ${width}px`, async ({ page }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width, height: 900 })
    for (const route of routes) {
      await test.step(route, async () => {
        await page.goto(route)
        await page.evaluate(() => document.fonts.ready)
        await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' })
        await expectReflow(page)
        // Double the actual authored text sizes, without doubling spacing or icons.
        await page.evaluate(() => {
          const nodes = [...document.querySelectorAll<HTMLElement>('body *:not(svg):not(svg *)')].filter(el => el.checkVisibility())
          const sizes = nodes.map(el => parseFloat(getComputedStyle(el).fontSize) * 2)
          nodes.forEach((el, i) => { el.style.setProperty('font-size', `${sizes[i]}px`, 'important') })
        })
        await expectReflow(page)
        const clipped = await page.locator('a, button, label, summary, h1, h2, h3').evaluateAll(elements => elements.filter(el => {
          if (!(el instanceof HTMLElement) || !el.checkVisibility()) return false
          const css = getComputedStyle(el)
          return ['hidden', 'clip'].includes(css.overflowY) && el.scrollHeight > el.clientHeight + 2
        }).map(el => el.textContent?.trim().slice(0, 60)))
        expect(clipped).toEqual([])
        if (width === 320 && ['/', '/booking', '/driver/status?booking=BK-0002'].includes(route)) await page.screenshot({ path: `test-results/a11y-resized-${route === '/' ? 'roles' : route.startsWith('/driver') ? 'driver' : 'booking'}.png`, fullPage: true })
      })
    }
  })
}

test('citizen forms, validation messages, and picker dialogs pass automated checks', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/booking/privacy')
  await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
  await page.getByRole('button', { name: 'รับทราบและถัดไป' }).click()
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await audit(page)
  await page.getByRole('button', { name: /วันนัดหมาย \*/ }).click()
  await audit(page)
  await page.getByRole('button', { name: /30 ตุลาคม 2569$/, exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันวันที่', exact: true }).click()
  await page.getByRole('button', { name: /เวลานัดหมาย \*/ }).click()
  await audit(page)
  await page.getByRole('button', { name: 'ยืนยันเวลา', exact: true }).click()
  await page.getByLabel('ชื่อผู้ป่วย *', { exact: true }).fill(details.patientName)
  await page.getByLabel('เบอร์โทรศัพท์ของคุณ *', { exact: true }).fill(details.phone)
  await page.getByLabel('โรงพยาบาล *', { exact: true }).selectOption('โรงพยาบาลลำพูน')
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await audit(page)
  await page.getByRole('region', { name: 'แผนที่จุดรับ' }).focus()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('button', { name: 'ถัดไป →', exact: true }).click()
  await audit(page)
})

test('staff dialogs and keyboard focus remain usable', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/admin/accounts')
  const add = page.getByRole('button', { name: '+ เพิ่มบัญชี', exact: true })
  await add.click()
  await audit(page)
  await page.keyboard.press('Escape')
  await expect(add).toBeFocused()
  await page.goto('/dispatcher/assignment?booking=BK-0003')
  await page.getByRole('button', { name: /^รถรับส่ง:/ }).click()
  await audit(page)
  await page.keyboard.press('Escape')
  await page.goto('/dispatcher?booking=BK-0001&dialog=details')
  await page.getByRole('button', { name: 'ปฏิเสธคำขอ', exact: true }).click()
  await expect(page.getByRole('button', { name: 'กลับไปตรวจสอบ', exact: true })).toBeFocused()
  await audit(page)
  await page.keyboard.press('Escape')
  await page.goto('/driver/status?booking=BK-0002')
  const action = page.locator('.driver-action').getByRole('button')
  await action.click()
  await audit(page)
  await page.keyboard.press('Escape')
  await expect(action).toBeFocused()
  await expect(action).toBeInViewport()
})

test('controls meet AA target sizes and keyboard focus is visible across roles', async ({ page }) => {
  test.setTimeout(90000)
  await page.setViewportSize({ width: 320, height: 640 })
  for (const route of ['/', '/booking', '/dispatcher/tracking', '/driver/details?booking=BK-0002', '/admin/accounts']) {
    await test.step(route, async () => {
      await page.goto(route)
      await page.evaluate(() => document.fonts.ready)
      const undersized = await page.locator('a, button, input:not([type=checkbox]), select, summary').evaluateAll(nodes => nodes.filter(node => {
        if (!(node instanceof HTMLElement) || !node.checkVisibility() || node.matches(':disabled')) return false
        const r = node.getBoundingClientRect()
        return r.width < 24 || r.height < 24
      }).map(node => node.textContent?.trim().slice(0, 60) || node.getAttribute('aria-label')))
      expect(undersized).toEqual([])
      for (let i = 0; i < 16; i++) {
        await page.keyboard.press('Tab')
        await page.evaluate(() => new Promise(requestAnimationFrame))
        const focus = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement
          if (element === document.body) return null
          const r = element.getBoundingClientRect()
          const x = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2))
          const y = Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2))
          const covering = document.elementFromPoint(x, y)
          let indicator = false
          // Native segmented date/time inputs can focus their shadow controls;
          // the visible focus ring may be on their containing field instead.
          for (let marker: HTMLElement | null = element; marker && marker !== document.body; marker = marker.parentElement) {
            const css = getComputedStyle(marker)
            if ((marker.matches(':focus-visible') || marker.matches(':focus-within')) && css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) >= 2) indicator = true
          }
          return { name: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 50), visible: r.bottom > 0 && r.top < innerHeight && !!covering && (element.contains(covering) || covering === element), indicator }
        })
        if (focus) { expect(focus.visible, focus.name || 'focused control').toBe(true); expect(focus.indicator, focus.name || 'focus indicator').toBe(true) }
      }
    })
  }
})

test('picker controls remain reachable in a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 320 })
  await page.goto('/booking/privacy')
  await page.getByRole('checkbox', { name: /รับทราบการใช้ข้อมูล/ }).check()
  await page.getByRole('button', { name: 'รับทราบและถัดไป' }).click()
  const date = page.getByRole('button', { name: /วันนัดหมาย \*/ })
  await date.click()
  const confirm = page.getByRole('button', { name: 'ยืนยันวันที่', exact: true })
  await confirm.focus()
  await expect(confirm).toBeInViewport()
  await expectReflow(page)
  await page.keyboard.press('Escape')
  await expect(date).toBeFocused()
})
