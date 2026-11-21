import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useInteractiveDemo } from '../services/interactiveDemo'
import { staffSession, useStaffSession } from '../services/staffSession'
import { BookingHeader } from './BookingUI'

export function RequireStaff({ role, children }: { role: 'dispatcher' | 'driver' | 'admin'; children: ReactNode }) {
  const session = useStaffSession()
  const demo = useInteractiveDemo()
  const location = useLocation()
  const needsDemoAutoLogin = demo.active && (!session.user || session.user.role !== role)

  useEffect(() => {
    if (needsDemoAutoLogin) {
      staffSession.enterDemoRole(role)
    }
  }, [needsDemoAutoLogin, role])

  if (needsDemoAutoLogin) {
    return <div className="booking-shell"><main className="booking-screen"><p role="status">กำลังเปิดโหมดสาธิต…</p></main></div>
  }
  if (!session.user) return <Navigate to={`/staff/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (session.user.role !== role) return <div className="booking-shell"><main className="booking-screen"><BookingHeader title="ไม่มีสิทธิ์เข้าถึงหน้านี้" /><a href="/staff/login">กลับไปบัญชีเจ้าหน้าที่</a></main></div>
  return children
}
