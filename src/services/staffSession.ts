import { useSyncExternalStore } from 'react'
import { SEED_DRIVERS } from '../data/realisticSeed'
import { apiRequest, apiDownload, ApiError } from './api'
import { activateInteractiveDemo, getDemoDriverId, isDemoModeAllowed, setDemoDriverId } from './interactiveDemo'

export interface StaffIdentity { id: string; role: 'admin' | 'dispatcher' | 'driver'; name: string; driverId: string | null }
interface Session { user: StaffIdentity | null; busy: boolean; error: string }
let state: Session = { user: null, busy: false, error: '' }
// Memory only: refreshing the page requires login again.
let token: string | undefined
const listeners = new Set<() => void>()
function publish(next: Session) { state = next; listeners.forEach(listener => listener()) }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function clear(error = '') { token = undefined; publish({ user: null, busy: false, error }) }
function message(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือเซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'
    if (error.status === 403) return 'บัญชีนี้ไม่มีสิทธิ์ใช้งาน'
    if (error.status === 429) return 'เข้าสู่ระบบหลายครั้งเกินไป กรุณารอแล้วลองใหม่'
  }
  return 'เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่'
}
export async function staffRequest<T>(path: string, body?: unknown): Promise<T> {
  if (!token) throw new ApiError(401)
  const requestToken = token
  try { return await apiRequest<T>(path, { token: requestToken, body }) }
  catch (error) {
    if (error instanceof ApiError && error.status === 401 && token === requestToken) clear(message(error))
    throw error
  }
}
export async function staffDownload(path:string,body:unknown) {
  if(!token)throw new ApiError(401)
  const requestToken=token
  try{return await apiDownload(path,{token:requestToken,body})}
  catch(error){if(error instanceof ApiError&&error.status===401&&token===requestToken)clear(message(error));throw error}
}
export const staffSession = {
  enterDemoRole(role: 'admin' | 'dispatcher' | 'driver', driverId?: string) {
    if (!isDemoModeAllowed()) return
    activateInteractiveDemo(role)
    if (role === 'driver') {
      const targetDriverId = driverId || getDemoDriverId()
      const matched = SEED_DRIVERS.find(d => d.id === targetDriverId) ?? SEED_DRIVERS[0]
      setDemoDriverId(matched.id)
      token = matched.id === 'demo-driver-A' ? 'demo-token-driver' : `demo-token-driver:${matched.id}`
      publish({
        user: {
          id: matched.accountId || 'USR-DRV-1',
          role: 'driver',
          name: matched.name,
          driverId: matched.id,
        },
        busy: false,
        error: '',
      })
      return
    }
    token = `demo-token-${role}`
    const user: StaffIdentity = role === 'admin'
      ? { id: 'USR-ADM-1', role: 'admin', name: 'ผู้ดูแลระบบ (โหมดสาธิต)', driverId: null }
      : { id: 'USR-DSP-1', role: 'dispatcher', name: 'เจ้าหน้าที่จัดรถ (โหมดสาธิต)', driverId: null }
    publish({ user, busy: false, error: '' })
  },
  clearLocal() {
    clear()
  },
  async login(username: string, password: string) {
    if (state.busy || state.user) return
    publish({ user: null, busy: true, error: '' })
    try {
      const result = await apiRequest<{ token: string }>('/auth/login', { body: { username, password } })
      token = result.token
      const user = await staffRequest<StaffIdentity>('/auth/me')
      if (!['admin', 'dispatcher', 'driver'].includes(user.role)) throw new ApiError(403)
      publish({ user, busy: false, error: '' })
    } catch (error) { clear(message(error)) }
  },
  async refresh(): Promise<StaffIdentity | null> {
    if (state.busy || !state.user) return state.user
    publish({ ...state, busy: true, error: '' })
    try {
      const user = await staffRequest<StaffIdentity>('/auth/me')
      publish({ user, busy: false, error: '' })
      return user
    } catch (error) {
      clear(message(error))
      return null
    }
  },
  async logout() {
    if (state.busy) return
    publish({ ...state, busy: true, error: '' })
    try { await staffRequest('/auth/logout', {}); clear() }
    catch (error) {
      // Keep session on network failure so server revocation can be retried.
      if (state.user) publish({ ...state, busy: false, error: message(error) })
    }
  },
}
export function useStaffSession() { return useSyncExternalStore(subscribe, () => state) }
