import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useStaffSession } from '../services/staffSession'
import { BookingHeader } from './BookingUI'

export function RequireStaff({ role, children }: { role: 'dispatcher' | 'driver' | 'admin'; children: ReactNode }) {
  const session = useStaffSession()
  const location = useLocation()
  if (!session.user) return <Navigate to={`/staff/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (session.user.role !== role) return <div className="booking-shell"><main className="booking-screen"><BookingHeader title="ไม่มีสิทธิ์เข้าถึงหน้านี้" /><a href="/staff/login">กลับไปบัญชีเจ้าหน้าที่</a></main></div>
  return children
}
