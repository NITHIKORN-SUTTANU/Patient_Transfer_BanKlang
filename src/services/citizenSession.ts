import { useSyncExternalStore } from 'react'
import { apiRequest, ApiError } from './api'

export interface CitizenConfig { liffId: string; lineEnabled: boolean; noticeVersion: string; noticeText: string; contactPhone: string }
export interface CitizenIdentity { id: string; role: 'citizen'; name: string }
interface Session { user: CitizenIdentity | null; config: CitizenConfig | null; busy: boolean; error: string }
let state: Session = { user: null, config: null, busy: true, error: '' }
let token: string | undefined
let initialization: Promise<void> | undefined
const listeners = new Set<() => void>()
function publish(next: Session) { state = next; listeners.forEach(listener => listener()) }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function citizenError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'เซสชันหมดอายุ กรุณายืนยันตัวตนผ่าน LINE อีกครั้ง'
    if (error.status === 403 || error.status === 404) return 'ไม่มีสิทธิ์เข้าถึงรายการนี้ หรือไม่พบรายการ'
    if (error.status === 409) return 'สถานะเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนทำรายการอีกครั้ง'
    if (error.status === 400 || error.status === 422) return 'ข้อมูลไม่ผ่านเงื่อนไข กรุณาตรวจสอบข้อมูล จุดรับ และประกาศความเป็นส่วนตัวล่าสุด'
  }
  return 'เชื่อมต่อบริการไม่ได้ ข้อมูลที่กรอกยังอยู่ กรุณาตรวจสอบรายการจองล่าสุดก่อนส่งซ้ำ'
}
export async function citizenRequest<T>(path: string, body?: unknown): Promise<T> {
  if (!token) throw new ApiError(401)
  const requestToken = token
  try {
    const result = await apiRequest<T>(path, { token: requestToken, body })
    if (token !== requestToken) throw new ApiError(401)
    return result
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && token === requestToken) {
      token = undefined
      publish({ ...state, user: null, busy: false, error: citizenError(error) })
    }
    throw error
  }
}
export async function refreshCitizenConfig() {
  const config = await apiRequest<CitizenConfig>('/config')
  publish({ ...state, config })
  return config
}
export function initializeCitizen() {
  if (initialization) return initialization
  if (state.user) return Promise.resolve()
  publish({ ...state, busy: true, error: '' })
  initialization = (async () => {
    try {
      const config = await apiRequest<CitizenConfig>('/config')
      publish({ ...state, config })
      if (!config.lineEnabled || !config.liffId) {
        publish({ ...state, busy: false, error: 'บริการจองผ่าน LINE ยังไม่พร้อม กรุณาติดต่อเทศบาล' }); return
      }
      const { lineIdToken } = await import('./lineClient')
      const idToken = await lineIdToken(config.liffId)
      const result = await apiRequest<{ token: string }>('/auth/line', { body: { idToken } })
      token = result.token
      const user = await citizenRequest<CitizenIdentity>('/auth/me')
      if (user.role !== 'citizen') throw new ApiError(403)
      publish({ config, user, busy: false, error: '' })
    } catch (error) {
      token = undefined
      publish({ ...state, user: null, busy: false, error: citizenError(error) })
    }
  })().finally(() => { initialization = undefined })
  return initialization
}
export function useCitizenSession() { return useSyncExternalStore(subscribe, () => state) }
