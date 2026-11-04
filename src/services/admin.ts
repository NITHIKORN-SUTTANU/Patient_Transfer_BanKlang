import type { AdminAccount, AdminSettings, AuditEvent, DemoState, Driver, Vehicle } from '../data/seed'
import { demoStore } from './demoStore'
import { initializeDispatcherResources } from './dispatch'

export const defaultSettings: AdminSettings = { center: 'ศูนย์รถเทศบาลตำบลบ้านกลาง', serviceArea: 'เทศบาลตำบลบ้านกลาง', opensAt: '08:00', closesAt: '16:30' }
export function initializeAdmin() {
  initializeDispatcherResources()
  if (demoStore.getState().accounts) return
  demoStore.update(state => state.accounts ? state : ({ ...state, accounts: [
    { id: 'USR-001', name: 'เจ้าหน้าที่ A', username: 'dispatcher.demo', role: 'Dispatcher', active: true },
    { id: 'USR-ADMIN', name: 'ผู้ดูแลระบบ A', username: 'admin.demo', role: 'Admin', active: true },
    ...state.drivers.map((d, i): AdminAccount => ({ id: d.accountId || `USR-DRV-${i + 1}`, name: d.name, username: `driver${i + 1}.demo`, role: 'Driver', active: d.active })),
  ], drivers: state.drivers.map((d, i) => ({ ...d, accountId: d.accountId || `USR-DRV-${i + 1}` })), settings: state.settings || defaultSettings, auditEvents: state.auditEvents || [] }))
}
type Entity = AdminAccount | Vehicle | Driver | AdminSettings
export type AdminCategory = AuditEvent['category']
const required = (value: string, label: string) => { if (!value.trim()) throw new Error(`กรุณากรอก${label}`); if (value.length > 200) throw new Error(`${label}ยาวเกิน 200 ตัวอักษร`) }
export function saveAdmin(category: AdminCategory, next: Entity, previous?: Entity, reason = '') {
  demoStore.update(state => {
    const id = 'id' in next ? next.id : 'CFG'
    const existing = category === 'settings' ? state.settings || defaultSettings : (state[category] as { id: string }[] | undefined)?.find(r => r.id === id)
    if (previous ? JSON.stringify(existing) !== JSON.stringify(previous) : !!existing) throw new Error('ข้อมูลเปลี่ยนจากอีกหน้าต่าง กรุณาปิดแล้วเปิดรายการใหม่')
    if ('active' in next && !next.active && (!previous || !('active' in previous) || previous.active)) required(reason, 'เหตุผลในการระงับ / ปิดใช้งาน')
    const statusOnly = previous && 'active' in next && JSON.stringify({ ...previous, active: next.active }) === JSON.stringify(next)
    if (category === 'drivers' && (next as Driver).active && (next as Driver).accountId) {
      const linked = state.accounts?.find(a => a.id === (next as Driver).accountId)
      if (!linked?.active || linked.role !== 'Driver') throw new Error('บัญชีที่เลือกถูกระงับ กรุณาเปิดใช้งานบัญชีก่อน')
    }
    if (category === 'accounts') {
      const account = next as AdminAccount
      required(account.name, 'ชื่อ–นามสกุล'); required(account.username, 'ชื่อผู้ใช้งาน')
      if (!['Dispatcher', 'Driver', 'Admin'].includes(account.role)) throw new Error('กรุณาเลือกบทบาท')
      if (state.accounts?.some(a => a.id !== id && a.username.toLowerCase() === account.username.toLowerCase())) throw new Error('ชื่อผู้ใช้งานนี้มีอยู่แล้ว')
      if (state.drivers.some(d => d.accountId === id) && account.role !== 'Driver') throw new Error('บัญชีนี้เชื่อมกับคนขับ กรุณาคงบทบาท Driver หรือเปลี่ยนบัญชีที่เชื่อมก่อน')
    } else if (category === 'vehicles' && !statusOnly) {
      const vehicle = next as Vehicle
      required(vehicle.label, 'รหัสรถ / ทะเบียนรถ'); required(vehicle.vehicleType || '', 'ประเภทรถ'); required(vehicle.support || '', 'อุปกรณ์รองรับ')
      if (state.vehicles.some(v => v.id !== id && v.label.toLowerCase() === vehicle.label.toLowerCase())) throw new Error('รหัสรถ / ทะเบียนรถนี้มีอยู่แล้ว')
    } else if (category === 'drivers' && !statusOnly) {
      const driver = next as Driver
      required(driver.name, 'ชื่อคนขับ')
      if (!/^0\d{8,9}$/.test(driver.phone || '')) throw new Error('กรุณากรอกเบอร์ติดต่อ 9–10 หลัก เริ่มด้วย 0')
      const account = state.accounts?.find(a => a.id === driver.accountId && a.role === 'Driver')
      if (!account) throw new Error('กรุณาเลือกบัญชี Role: Driver')
      if (state.drivers.some(d => d.id !== id && d.accountId === driver.accountId)) throw new Error('บัญชีนี้เชื่อมกับคนขับอื่นแล้ว')
      if (driver.active && !account.active) throw new Error('บัญชีที่เลือกถูกระงับ กรุณาเปิดใช้งานบัญชีก่อน')
    } else if (category === 'settings') {
      const settings = next as AdminSettings
      required(settings.center, 'ตำแหน่งศูนย์รถ'); required(settings.serviceArea, 'พื้นที่ให้บริการ')
      if (settings.parking && (!Number.isFinite(settings.parking.latitude) || !Number.isFinite(settings.parking.longitude) || Math.abs(settings.parking.latitude) > 90 || Math.abs(settings.parking.longitude) > 180)) throw new Error('พิกัดจุดจอดรถไม่ถูกต้อง')
      if (![settings.opensAt, settings.closesAt].every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || settings.opensAt >= settings.closesAt) throw new Error('เวลาเปิดต้องอยู่ก่อนเวลาปิดบริการ')
    }
    const action = !previous ? 'เพิ่มข้อมูล' : 'active' in next && 'active' in previous && next.active !== previous.active ? next.active ? 'เปิดใช้งาน' : 'ระงับ / ปิดใช้งาน' : 'แก้ไขข้อมูล'
    const event: AuditEvent = { id: crypto.randomUUID(), at: new Date().toISOString(), actor: 'ผู้ดูแลระบบ', category, action, recordId: id, reason: reason.trim() || undefined, before: previous ? JSON.stringify(previous) : undefined, after: JSON.stringify(next) }
    const updated: DemoState = category === 'settings' ? { ...state, settings: next as AdminSettings } : { ...state, [category]: existing ? (state[category] as { id: string }[]).map(r => r.id === id ? next : r) : [...(state[category] || []), next] }
    const geospatialChanged = category === 'settings' && previous && ((previous as AdminSettings).center !== (next as AdminSettings).center || (previous as AdminSettings).serviceArea !== (next as AdminSettings).serviceArea || JSON.stringify((previous as AdminSettings).parking) !== JSON.stringify((next as AdminSettings).parking))
    return { ...updated, bookings: geospatialChanged ? updated.bookings.map(b => b.status === 'approved' && b.schedule ? { ...b, scheduleReview: { requestedAt: event.at } } : b) : updated.bookings, auditEvents: [event, ...(state.auditEvents || [])] }
  })
}
