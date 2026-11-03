import type { Page } from '@playwright/test'

// Set the test account as fixture state; role screens expose no account switcher.
export async function selectTestDriver(page: Page, value: string | { label: string }) {
  await page.evaluate(selection => {
    const state = JSON.parse(localStorage.getItem('ban-klang-transit:demo:v1')!)
    const id = typeof selection === 'string' ? selection : state.drivers.find((driver: { name: string; id: string }) => driver.name === selection.label)?.id
    if (!id) throw new Error('Test driver not found')
    sessionStorage.setItem('ban-klang-transit:driver', id)
  }, value)
  const url = new URL(page.url())
  url.search = ''
  await page.goto(url.toString())
}
