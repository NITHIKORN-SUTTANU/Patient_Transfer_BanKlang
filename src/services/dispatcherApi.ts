import { useEffect, useState } from 'react'
import { createSeedState, type Booking, type DemoState } from '../data/seed'
import { ApiError } from './api'
import { staffRequest, useStaffSession } from './staffSession'
import { bookingPages } from './bookingPages'

export interface Schedule { departureAt: string; pickupAt: string; arrivalAt: string; readyAt: string; pickupWaitingMinutes: number; originLocationId: string; originKind: string; previousBookingId?: string }
export interface ApiBooking {
  destinationRevision?: DestinationRevision | null;
  destinationHistory?: {version: number; hospitalName: string; arrivalAt: string; readyAt: string; reason: string; recordedAt: string; routingSource: string}[];
  id: string; reference: string; status: string; revision: number; executionVersion: number;
  patientName: string; appointmentAt: string; hospitalId: string; contactPhone: string; pickupAddress: string;
  latitude: number; longitude: number; mobility: string; vehicleId: string | null; driverId: string | null;
  startedAt: string | null; incidentOpen: boolean; resourceHold: boolean; scheduleReviewRequired: boolean;
  originName?: string; vehicleName?: string;
  hospitalName?: string; hospitalLocationId?: string; depotLocationId?: string;
  configurationChanges?: {id: string; type: string; proposed: {name?: string; date?: string; active?: boolean; latitude?: number; longitude?: number; radiusMetres?: number}}[];
  assistance?: string[]; landmark?: string; requesterName?: string; bookingFor?: 'self' | 'other' | null;
  cancellationLocked?: boolean;
  schedule: Schedule | null; proposedSchedule: (Schedule & { vehicleId: string; driverId: string }) | null;
}
export interface DestinationRevision { version: number; arrivalAt: string; readyAt: string; latenessSeconds: number; appointmentLatenessSeconds: number; originalHospitalName: string; originalArrivalAt: string; recordedAt: string }
export interface Catalog {
  hospitals: { id: string; name: string; location_id?: string }[];
  vehicles: { id: string; name: string; plate: string; active: boolean; held: boolean }[];
  drivers: { id: string; name: string; active: boolean; held: boolean }[];
  locations: { id: string; name: string; kind: string }[]; depotLocationId: string | null;
  configurationRevision?: number;
}
export const statusLabels: Record<string, string> = {
  REQUESTED: 'รอตรวจสอบ', APPROVED: 'อนุมัติแล้ว · รอจัดตาราง', SCHEDULED: 'ยืนยันตารางแล้ว · รอมอบหมาย',
  ASSIGNED: 'มอบหมายแล้ว', PICKING_UP: 'กำลังไปรับผู้ป่วย', PICKED_UP: 'รับผู้ป่วยขึ้นรถแล้ว',
  IN_TRANSIT: 'กำลังเดินทางไปโรงพยาบาล', COMPLETED: 'ส่งถึงโรงพยาบาลแล้ว', CANCELLED: 'ยกเลิกแล้ว', REJECTED: 'ปฏิเสธแล้ว', ABORTED: 'ยุติการเดินทางโดยไม่ส่งถึงโรงพยาบาล',
}
export function dispatcherError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'ข้อมูลหรือความพร้อมเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดและตรวจสอบอีกครั้ง'
    if (error.status === 503) return 'บริการคำนวณเส้นทางยังไม่พร้อม ไม่มีการยืนยันตารางใหม่'
    if (error.status === 401) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'
    if (error.status === 403) return 'ไม่มีสิทธิ์ดำเนินการนี้'
    if (error.status === 404) return 'ไม่พบรายการนี้ กรุณาตรวจสอบรายการล่าสุด'
    if (error.status === 422 || error.status === 400) return 'ข้อมูลไม่ผ่านเงื่อนไข กรุณาตรวจสอบข้อมูลและความพร้อมของทรัพยากร'
  }
  return 'เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่และตรวจสอบสถานะล่าสุดก่อนทำรายการซ้ำ'
}
export function viewBooking(row: ApiBooking, catalog: Catalog): Booking {
  const status: Booking['status'] = row.status === 'REQUESTED' ? 'pending' : row.status === 'REJECTED' ? 'rejected' : row.status === 'COMPLETED' ? 'completed' : ['CANCELLED', 'ABORTED'].includes(row.status) ? 'cancelled' : ['PICKING_UP', 'PICKED_UP', 'IN_TRANSIT'].includes(row.status) ? 'in_transit' : 'approved'
  return {
    id: row.id, patientName: row.patientName, appointmentAt: row.appointmentAt, status, apiStatus: row.status,
    revision: row.revision, executionVersion: row.executionVersion, incidentOpen: row.incidentOpen, resourceHold: row.resourceHold,
    startedAt: row.startedAt, originName: row.originName, vehicleName: row.vehicleName,
    destinationRevision: row.destinationRevision ?? undefined,
    vehicleId: row.vehicleId ?? undefined, driverId: row.driverId ?? undefined,
    details: { bookingFor: row.bookingFor ?? 'unknown', patientName: row.patientName, contactName: row.requesterName ?? '', phone: row.contactPhone, relationship: '',
      hospital: row.hospitalName ?? catalog.hospitals.find(h => h.id === row.hospitalId)?.name ?? row.hospitalId, date: '', time: '',
      assistance: ({ standard: 'เดินได้', wheelchair: 'รถเข็น', stretcher: 'เปลนอน' } as Record<string, string>)[row.mobility] ?? row.mobility,
      extras: (row.assistance ?? []).map(code => ({ boarding_support: 'ต้องการผู้ช่วยพยุงขึ้น-ลงรถ', caregiver_accompanies: 'มีผู้ดูแลเดินทางไปด้วย' } as Record<string, string>)[code]).filter(Boolean),
      pickup: { x: 50, y: 50, label: [row.pickupAddress, row.landmark].filter(Boolean).join(' · '), latitude: row.latitude, longitude: row.longitude }, acknowledged: false },
    // The existing summary needs only these timestamps. Never recalculate production times in the browser.
    ...(row.schedule ? { schedule: { departureAt: row.schedule.departureAt, pickupAt: row.schedule.pickupAt, arrivalAt: row.schedule.arrivalAt, endsAt: row.schedule.readyAt,
      calculation: 'server-verified-v1' } as const } : {}),
  }
}
export function useDispatcherData(bookingId?: string) {
  const session = useStaffSession()
  const [data, setData] = useState<{ state: DemoState; catalog: Catalog; rows: ApiBooking[] } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const [pages, setPages] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  useEffect(() => {
    let active = true
    Promise.all([bookingPages<ApiBooking>(staffRequest, '/bookings', pages), staffRequest<Catalog>('/catalog')]).then(async ([result, catalog]) => {
      if (bookingId && !result.bookings.some(row => row.id === bookingId)) {
        const focused = await staffRequest<ApiBooking>(`/bookings/${encodeURIComponent(bookingId)}`)
        if (focused.id !== bookingId) throw new ApiError(404)
        result.bookings.push(focused)
      }
      if (!active) return
      setHasMore(result.hasMore)
      setData({ catalog, rows: result.bookings, state: { ...createSeedState(), bookings: result.bookings.map(row => viewBooking(row, catalog)),
        vehicles: catalog.vehicles.map(v => ({ id: v.id, label: `${v.name} · ${v.plate}`, active: v.active && !v.held })),
        drivers: catalog.drivers.map(d => ({ id: d.id, name: d.name, active: d.active && !d.held })) } })
    }).catch(error => { if (active) { setData(null); setError(dispatcherError(error)) } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [session.user?.id, version, bookingId, pages])
  return { data, error, loading, hasMore, loadMore: () => { if (!loading) { setLoading(true); setError(''); setPages(p => p + 1) } }, reload: () => { setLoading(true); setError(''); setVersion(v => v + 1) } }
}
export function bookingCommand(row: Booking, command: Record<string, unknown>) {
  return staffRequest(`/bookings/${encodeURIComponent(row.id)}/commands`, { eventId: crypto.randomUUID(), expectedRevision: row.revision, expectedExecutionVersion: row.executionVersion, command })
}
