import { AdminPage } from './pages/AdminPage'
import { Route, Routes } from 'react-router'
import { DemoLayout } from './layouts/DemoLayout'
import { LandingPage } from './pages/LandingPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { BookingPage } from './pages/BookingPage'
import { DispatcherPage } from './pages/DispatcherPage'
import { DriverPage } from './pages/DriverPage'
import { StaffLoginPage } from './pages/StaffLoginPage'
import { RequireStaff } from './components/RequireStaff'

export function App() {
  return <Routes><Route path="staff/login" element={<StaffLoginPage />} /><Route path="admin/*" element={<RequireStaff role="admin"><AdminPage /></RequireStaff>} /><Route path="driver/*" element={<RequireStaff role="driver"><DriverPage /></RequireStaff>} /><Route path="dispatcher/*" element={<RequireStaff role="dispatcher"><DispatcherPage /></RequireStaff>} /><Route path="booking/*" element={<BookingPage />} /><Route element={<DemoLayout />}><Route index element={<LandingPage />} /><Route path="*" element={<NotFoundPage />} /></Route></Routes>
}
