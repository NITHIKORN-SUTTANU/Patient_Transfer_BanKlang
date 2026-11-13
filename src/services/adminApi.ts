import { useEffect, useState } from 'react'
import type { AdminAccount, AuditEvent, DemoState } from '../data/seed'
import { ApiError } from './api'
import { staffRequest, useStaffSession } from './staffSession'

export interface StaffAccount { id: string; name: string; username: string; role: 'admin' | 'dispatcher' | 'driver'; active: boolean; revision: number }
export interface AdminResource { id: string; name: string; active: boolean; capabilities: string[]; revision: number; locationId: string; availableAt: string; held: boolean; plate?: string; vehicleType?: string; phone?: string; accountId?: string; rosterActive?: boolean }
export interface AvailabilityWindow { id: string; vehicleId: string | null; driverId: string | null; startsAt: string; endsAt: string; revision: number }
export interface AdminCatalog {
  vehicles: AdminResource[];
  drivers: AdminResource[];
  locations: {id: string; name: string; kind: string}[];
  villages: { id: string; number: number; name: string }[];
  settings: { center: string; latitude: number; longitude: number; opensAt: string; closesAt: string } | null;
}
interface AdminAudit { id: string; action: string; entityType: string; entityId?: string; recordedAt: string; actor: string | null; reason?: string; before?: unknown; after?: unknown }
export interface AdminSummary { statuses: { status: string; count: number }[] }
export const roles = { admin: 'Admin', dispatcher: 'Dispatcher', driver: 'Driver' } as const
export function accountView(account: StaffAccount): AdminAccount { return { ...account, role: roles[account.role] } }
export function adminError(error: unknown) {
  if (error instanceof ApiError) {
    const message = ({ LAST_ACTIVE_ADMIN: 'ต้องเหลือผู้ดูแลระบบที่ใช้งานได้อย่างน้อยหนึ่งบัญชี', LINKED_DRIVER_ROLE: 'บัญชีนี้เชื่อมกับคนขับ ต้องคงบทบาทคนขับไว้', UNFINISHED_DRIVER_WORK: 'คนขับมีงานที่ยังไม่เสร็จ จึงยังระงับบัญชีไม่ได้', USERNAME_IN_USE: 'ชื่อผู้ใช้งานนี้มีอยู่แล้ว', RESOURCE_UNFINISHED_WORK: 'ทรัพยากรนี้มีงานที่ยังไม่เสร็จ จึงเปลี่ยนข้อมูลสำคัญหรือปิดใช้งานไม่ได้', RESOURCE_HELD: 'คนขับยังมีสถานะรอยืนยันความพร้อม จึงยังเปลี่ยนบัญชีที่เชื่อมไม่ได้', PLATE_IN_USE: 'ทะเบียนรถนี้มีอยู่แล้ว', DRIVER_ALREADY_LINKED: 'บัญชีนี้เชื่อมกับคนขับอื่นแล้ว', ASSIGNMENT_WINDOW_REQUIRED: 'ช่วงเวลานี้ยังจำเป็นสำหรับงานที่ยืนยันแล้ว กรุณาประสานเจ้าหน้าที่จัดรถ' } as Record<string, string>)[error.code ?? '']
    if (message) return message
    if (error.status === 409) return 'ข้อมูลเปลี่ยนหรือมีงานที่ยังไม่เสร็จ กรุณาโหลดข้อมูลล่าสุดและตรวจสอบอีกครั้ง'
    if (error.status === 400 || error.status === 422) return 'ข้อมูลไม่ผ่านเงื่อนไข กรุณาตรวจสอบข้อมูล บัญชี การรองรับ และช่วงเวลา'
    if (error.status === 403) return 'ไม่มีสิทธิ์ดำเนินการนี้'
    if (error.status === 401) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'
  }
  return 'เชื่อมต่อระบบไม่ได้ กรุณาโหลดข้อมูลล่าสุดเพื่อตรวจสอบผลก่อนทำรายการซ้ำ'
}
export function useAdminData() {
  const session = useStaffSession()
  const [data, setData] = useState<{ state: DemoState; summary: AdminSummary; catalog: AdminCatalog; windows: AvailabilityWindow[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let active = true
    Promise.all([staffRequest<{ accounts: StaffAccount[] }>('/admin/accounts'), staffRequest<AdminCatalog>('/catalog'),
      staffRequest<{ events: AdminAudit[] }>('/admin/audit'), staffRequest<AdminSummary>('/admin/summary'), staffRequest<{windows: AvailabilityWindow[]}>('/admin/availability')]).then(([accounts, catalog, audit, summary, availability]) => {
      if (!active) return
      const events: AuditEvent[] = audit.events.map(event => ({ id: event.id, action: ({ CREATE_STAFF_ACCOUNT: 'เพิ่มบัญชี', UPDATE_STAFF_ACCOUNT: 'แก้ไขบัญชี', CREATE_RESOURCE: 'เพิ่มทรัพยากร', UPDATE_RESOURCE: 'แก้ไขทรัพยากร', CREATE_AVAILABILITY: 'เพิ่มช่วงเวลาปฏิบัติงาน', UPDATE_AVAILABILITY: 'ปรับช่วงเวลาปฏิบัติงาน', RETIRE_AVAILABILITY: 'ปิดช่วงเวลาปฏิบัติงาน' } as Record<string, string>)[event.action] ?? event.action, at: event.recordedAt, actor: event.actor === 'citizen' ? 'ผู้ใช้บริการ' : event.actor ?? 'ไม่ระบุผู้ดำเนินการ',
        category: event.entityType === 'staff_account' ? 'accounts' : event.entityType === 'vehicles' ? 'vehicles' : event.entityType === 'drivers' ? 'drivers' : 'settings',
        recordId: event.entityId ?? event.entityType, reason: event.reason,
        before: event.before ? JSON.stringify(event.before, null, 2) : event.entityType === 'staff_account' ? undefined : 'รายละเอียดจำกัดตามสิทธิ์',
        after: event.after ? JSON.stringify(event.after, null, 2) : 'รายละเอียดจำกัดตามสิทธิ์' }))
      setData({ summary, catalog, windows: availability.windows ?? [], state: { version: 1, selectedActor: null, bookings: [], accounts: accounts.accounts.map(accountView),
        vehicles: catalog.vehicles.map(vehicle => ({ id: vehicle.id, label: `${vehicle.name} · ${vehicle.plate}`, active: vehicle.active, vehicleType: vehicle.vehicleType,
          support: vehicle.capabilities.map(code => ({ standard: 'เดินได้', wheelchair: 'รถเข็น', stretcher: 'เปลนอน' } as Record<string, string>)[code] ?? code).join(' / ') })),
        drivers: catalog.drivers.map(driver => ({ id: driver.id, name: driver.name, active: driver.rosterActive ?? driver.active, accountId: driver.accountId, phone: driver.phone })),
        settings: catalog.settings ? { center: catalog.settings.center, parking: { latitude: catalog.settings.latitude, longitude: catalog.settings.longitude },
          serviceArea: `${catalog.villages.length} หมู่บ้านที่เปิดให้บริการ`, opensAt: catalog.settings.opensAt, closesAt: catalog.settings.closesAt } : undefined,
        auditEvents: events } })
    }).catch(error => { if (active) { setData(null); setError(adminError(error)) } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [session.user?.id, version])
  return { data, loading, error, reload: () => { setLoading(true); setError(''); setVersion(value => value + 1) } }
}
