import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

export async function setPickerTime(page: Page, label: string, value: string) {
  const option = page.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: value.padStart(2, '0'), exact: true })
  await option.click()
  await expect(option).toHaveAttribute('aria-selected', 'true')
}
