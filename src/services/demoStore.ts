import { useSyncExternalStore } from 'react'
import type { ActorId } from '../data/actors'
import { createSeedState, type DemoState } from '../data/seed'
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
