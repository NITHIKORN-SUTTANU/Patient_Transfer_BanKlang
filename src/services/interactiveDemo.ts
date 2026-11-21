import { useSyncExternalStore } from 'react'

export type DemoRole = 'citizen' | 'dispatcher' | 'driver' | 'admin'

const DEMO_ACTIVE_KEY = 'ban-klang-transit:interactive-demo-active:v1'
const DEMO_ROLE_KEY = 'ban-klang-transit:interactive-demo-role:v1'

export interface InteractiveDemoSnapshot {
  active: boolean
  role: DemoRole | null
  envLocked: boolean
}

const listeners = new Set<() => void>()

export function isEnvDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === 'true'
}

function readRole(): DemoRole | null {
  try {
    const raw = sessionStorage.getItem(DEMO_ROLE_KEY)
    if (raw === 'citizen' || raw === 'dispatcher' || raw === 'driver' || raw === 'admin') {
      return raw
    }
  } catch {
    // Ignore storage restriction.
  }
  return null
}

function detectInitialSnapshot(): InteractiveDemoSnapshot {
  const envLocked = isEnvDemoMode()
  if (typeof window !== 'undefined') {
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.get('demo') === '1') {
        sessionStorage.setItem(DEMO_ACTIVE_KEY, '1')
      }
    } catch {
      // Ignore URL parse error.
    }
  }

  let sessionActive = false
  try {
    sessionActive = sessionStorage.getItem(DEMO_ACTIVE_KEY) === '1'
  } catch {
    sessionActive = false
  }

  return {
    active: envLocked || sessionActive,
    role: readRole(),
    envLocked,
  }
}

let snapshot: InteractiveDemoSnapshot = detectInitialSnapshot()

function emit() {
  listeners.forEach(listener => listener())
}

export function isInteractiveDemoActive(): boolean {
  if (snapshot.active) return true
  if (typeof window !== 'undefined') {
    try {
      if (new URL(window.location.href).searchParams.get('demo') === '1') {
        activateInteractiveDemo()
        return true
      }
    } catch {
      // Ignore URL parse error.
    }
  }
  return false
}

export function activateInteractiveDemo(role?: DemoRole) {
  const nextRole = role ?? snapshot.role
  try {
    sessionStorage.setItem(DEMO_ACTIVE_KEY, '1')
    if (nextRole) sessionStorage.setItem(DEMO_ROLE_KEY, nextRole)
  } catch {
    // Ignore storage failure and keep in-memory state.
  }
  snapshot = {
    active: true,
    role: nextRole,
    envLocked: isEnvDemoMode(),
  }
  emit()
}

export function setInteractiveDemoRole(role: DemoRole) {
  activateInteractiveDemo(role)
}

export function deactivateInteractiveDemo() {
  const envLocked = isEnvDemoMode()
  try {
    sessionStorage.removeItem(DEMO_ACTIVE_KEY)
    sessionStorage.removeItem(DEMO_ROLE_KEY)
  } catch {
    // Ignore storage failure.
  }
  snapshot = {
    active: envLocked,
    role: null,
    envLocked,
  }
  emit()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useInteractiveDemo(): InteractiveDemoSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot)
}
