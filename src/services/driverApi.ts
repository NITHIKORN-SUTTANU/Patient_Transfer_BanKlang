import { useEffect, useState } from 'react'
import type { Booking } from '../data/seed'
import { dispatcherError, viewBooking, type ApiBooking, type Catalog } from './dispatcherApi'
import { staffRequest, useStaffSession } from './staffSession'
import { bookingPages } from './bookingPages'

export interface DriverHistory { id: string; reference: string; status: string; appointmentAt: string }
export type DriverPhase = 'assigned' | 'started' | 'going_to_pickup' | 'patient_onboard' | 'going_to_hospital' | 'delivered'
export const driverStages: DriverPhase[] = ['assigned', 'started', 'going_to_pickup', 'patient_onboard', 'going_to_hospital', 'delivered']
export const driverLabels: Record<DriverPhase, string> = { assigned: 'ได้รับมอบหมาย', started: 'เริ่มงานแล้ว · ยังไม่ออกจากต้นทาง', going_to_pickup: 'กำลังไปรับผู้ป่วย', patient_onboard: 'รับผู้ป่วยขึ้นรถแล้ว', going_to_hospital: 'กำลังเดินทางไปโรงพยาบาล', delivered: 'ส่งถึงโรงพยาบาล' }
export function driverStage(booking: Booking): DriverPhase {
  return booking.apiStatus === 'ASSIGNED' ? booking.startedAt ? 'started' : 'assigned' : booking.apiStatus === 'PICKING_UP' ? 'going_to_pickup' : booking.apiStatus === 'PICKED_UP' ? 'patient_onboard' : booking.apiStatus === 'IN_TRANSIT' ? 'going_to_hospital' : 'delivered'
}
export function nextDriverCommand(phase: DriverPhase) {
  return { assigned: 'START_TRIP', started: 'DEPART_ORIGIN', going_to_pickup: 'CONFIRM_PICKUP', patient_onboard: 'DEPART_FOR_HOSPITAL', going_to_hospital: 'CONFIRM_HANDOVER', delivered: '' }[phase]
}
export function driverCommand(booking: Booking, type: string, reason?: string) {
  return staffRequest(`/bookings/${encodeURIComponent(booking.id)}/commands`, { eventId: crypto.randomUUID(), expectedRevision: booking.revision, expectedExecutionVersion: booking.executionVersion, command: { type, ...(reason ? { reason } : {}) } })
}
export function useDriverData() {
  const session = useStaffSession()
  const [data, setData] = useState<{ jobs: Booking[]; history: DriverHistory[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [pages, setPages] = useState(1)
  const [historyPages, setHistoryPages] = useState(1)
  const [more, setMore] = useState({ jobs: false, history: false })
  useEffect(() => {
    let active = true
    Promise.all([bookingPages<ApiBooking>(staffRequest, '/bookings', pages), bookingPages<DriverHistory>(staffRequest, '/driver/history', historyPages), staffRequest<Pick<Catalog, 'hospitals'>>('/catalog')]).then(([jobs, history, catalog]) => {
      if (!active) return
      setMore({ jobs: jobs.hasMore, history: history.hasMore })
      setData({ jobs: jobs.bookings.filter(row => row.driverId === session.user?.driverId && row.schedule && ['ASSIGNED', 'PICKING_UP', 'PICKED_UP', 'IN_TRANSIT'].includes(row.status)).map(row => viewBooking(row, { ...catalog, vehicles: [], drivers: [], locations: [], depotLocationId: null })),
        // Whitelist history fields: never retain patient/contact/location data in history state.
        history: history.bookings.map(row => ({ id: row.id, reference: row.reference, status: row.status, appointmentAt: row.appointmentAt })) })
    }).catch(error => { if (active) { setData(null); setError(dispatcherError(error)) } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [session.user?.driverId, version, pages, historyPages])
  return { data, loading, error, more, loadMore: (history = false) => { if (!loading) { setLoading(true); setError(''); (history ? setHistoryPages : setPages)(p => p + 1) } }, reload: () => { setLoading(true); setError(''); setVersion(v => v + 1) } }
}
