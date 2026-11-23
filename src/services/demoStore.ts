import { useSyncExternalStore } from 'react'
import type { ActorId } from '../data/actors'
import { SEED_DRIVERS, SEED_VEHICLES } from '../data/realisticSeed'
import { createSeedState, type Booking, type DemoState, type Driver, type Vehicle } from '../data/seed'
import { isDemoState } from '../utils/validateDemoState'

const KEY = 'ban-klang-transit:demo:v1'
const listeners = new Set<() => void>()
let storageAvailable = true
function readState(): DemoState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isDemoState(parsed)) return parsed
    }
  } catch { storageAvailable = false }
  return createSeedState()
}
let state = readState()
function emit() { listeners.forEach(listener => listener()) }
function latestState(): DemoState {
  if (!storageAvailable) return state
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isDemoState(parsed)) return parsed
    }
  } catch { storageAvailable = false }
  return state
}
function persist(next: DemoState) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)); storageAvailable = true }
  catch { storageAvailable = false }
  emit()
}
window.addEventListener('storage', event => {
  if (event.key === KEY || event.key === null) { state = readState(); emit() }
})
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export const demoStore = {
  getState: () => state,
  selectActor: (selectedActor: ActorId) => persist({ ...latestState(), selectedActor }),
  reset: () => persist(createSeedState()),
  importSeedBookings: (bookings: Booking[], options?: { replace?: boolean; vehicles?: Vehicle[]; drivers?: Driver[] }) => {
    const current = latestState()
    const existingIds = new Set(bookings.map(b => b.id))
    const mergedBookings = options?.replace
      ? [...bookings]
      : [...current.bookings.filter(b => !existingIds.has(b.id)), ...bookings]
    const vehicles = current.vehicles.length ? current.vehicles : (options?.vehicles ?? SEED_VEHICLES)
    const drivers = current.drivers.length ? current.drivers : (options?.drivers ?? SEED_DRIVERS)
    const next: DemoState = {
      ...current,
      bookings: mergedBookings,
      vehicles,
      drivers,
      dispatcherResourcesInitialized: true,
    }
    if (!isDemoState(next)) throw new Error('ข้อมูลที่นำเข้าไม่ผ่านการตรวจสอบโครงสร้างระบบ')
    persist(next)
  },
  clearSeedBookings: () => {
    const current = latestState()
    const next: DemoState = {
      ...current,
      bookings: [],
    }
    if (!isDemoState(next)) throw new Error('ล้างข้อมูลจำลองไม่สำเร็จ')
    persist(next)
  },
  update: (update: (current: DemoState) => DemoState) => {
    // Recheck persisted data even before another tab's storage event arrives.
    // Preserve the existing in-memory fallback when storage is unavailable.
    const next = update(latestState())
    if (!isDemoState(next)) throw new Error('Invalid demo state')
    persist(next)
  },
}
export function useDemoState() {
  const current = useSyncExternalStore(subscribe, demoStore.getState)
  return { state: current, storageAvailable }
}
