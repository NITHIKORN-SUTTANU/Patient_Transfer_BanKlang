import { useSyncExternalStore } from 'react'
import { generateRealisticSeedBookings, SEED_DRIVERS, SEED_VEHICLES } from '../data/realisticSeed'
import type { Booking, Driver, Vehicle } from '../data/seed'
import { demoStore } from './demoStore'

const OVERLAY_KEY = 'ban-klang-transit:seed-overlay:v1'

export interface SeedOverlayState {
  active: boolean
  sourceLabel: string
  importedAt: string
  bookings: Booking[]
  vehicles: Vehicle[]
  drivers: Driver[]
}

const emptyOverlay = (): SeedOverlayState => ({
  active: false,
  sourceLabel: '',
  importedAt: '',
  bookings: [],
  vehicles: [],
  drivers: [],
})

const listeners = new Set<() => void>()

function readOverlay(): SeedOverlayState {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SeedOverlayState>
      if (parsed && parsed.active === true && Array.isArray(parsed.bookings)) {
        return {
          active: true,
          sourceLabel: typeof parsed.sourceLabel === 'string' ? parsed.sourceLabel : 'Seed CSV',
          importedAt: typeof parsed.importedAt === 'string' ? parsed.importedAt : '',
          bookings: parsed.bookings,
          vehicles: Array.isArray(parsed.vehicles) && parsed.vehicles.length ? parsed.vehicles : SEED_VEHICLES,
          drivers: Array.isArray(parsed.drivers) && parsed.drivers.length ? parsed.drivers : SEED_DRIVERS,
        }
      }
    }
  } catch {
    // Ignore unavailable storage and use in-memory fallback.
  }
  return emptyOverlay()
}

let overlayState: SeedOverlayState = readOverlay()

function emit() {
  listeners.forEach(listener => listener())
}

function saveOverlay(next: SeedOverlayState) {
  overlayState = next
  try {
    if (next.active) {
      localStorage.setItem(OVERLAY_KEY, JSON.stringify(next))
    } else {
      localStorage.removeItem(OVERLAY_KEY)
    }
  } catch {
    // Ignore storage quota errors cleanly.
  }
  emit()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === OVERLAY_KEY || event.key === null) {
      overlayState = readOverlay()
      emit()
    }
  })
}

export const seedOverlay = {
  getState: () => overlayState,
  importBookings: (bookings: Booking[], sourceLabel: string, replace = true) => {
    const current = overlayState
    const existingIds = new Set(bookings.map(b => b.id))
    const merged = replace
      ? [...bookings]
      : [...current.bookings.filter(b => !existingIds.has(b.id)), ...bookings]
    const vehicles = current.vehicles.length ? current.vehicles : SEED_VEHICLES
    const drivers = current.drivers.length ? current.drivers : SEED_DRIVERS
    demoStore.importSeedBookings(merged, { replace: true, vehicles, drivers })
    saveOverlay({
      active: true,
      sourceLabel,
      importedAt: new Date().toISOString(),
      bookings: merged,
      vehicles,
      drivers,
    })
  },
  loadRealisticSeed: (count = 320) => {
    const bookings = generateRealisticSeedBookings(count)
    seedOverlay.importBookings(bookings, `ชุดข้อมูลจำลอง ${bookings.length} รายการ (อ.เมืองลำพูน / 12 หมู่บ้าน)`, true)
    return bookings
  },
  addBooking: (booking: Booking) => {
    if (!overlayState.active) return
    const next = [...overlayState.bookings.filter(b => b.id !== booking.id), booking]
    demoStore.importSeedBookings(next, { replace: true, vehicles: overlayState.vehicles, drivers: overlayState.drivers })
    saveOverlay({ ...overlayState, bookings: next })
  },
  updateBooking: (booking: Booking) => {
    if (!overlayState.active) return
    const next = overlayState.bookings.map(b => b.id === booking.id ? booking : b)
    demoStore.importSeedBookings(next, { replace: true, vehicles: overlayState.vehicles, drivers: overlayState.drivers })
    saveOverlay({ ...overlayState, bookings: next })
  },
  setVehicles: (vehicles: Vehicle[]) => {
    if (!overlayState.active) return
    saveOverlay({ ...overlayState, vehicles })
  },
  reset: () => {
    demoStore.clearSeedBookings()
    saveOverlay(emptyOverlay())
  },
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSeedOverlay(): SeedOverlayState {
  return useSyncExternalStore(subscribe, seedOverlay.getState)
}
