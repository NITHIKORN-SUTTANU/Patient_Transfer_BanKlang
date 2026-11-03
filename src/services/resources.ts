import type { DemoState, Driver } from '../data/seed'

export function driverAvailable(state: DemoState, driver: Driver | undefined): boolean {
  if (!driver?.active) return false
  if (!driver.accountId) return true // Older records do not require an account link.
  const account = state.accounts?.find(a => a.id === driver.accountId)
  return !!account?.active && account.role === 'Driver'
}
