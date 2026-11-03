import { AdminPage } from './pages/AdminPage'
import { Route, Routes } from 'react-router'
import { DemoLayout } from './layouts/DemoLayout'
import { LandingPage } from './pages/LandingPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { BookingPage } from './pages/BookingPage'
import { DispatcherPage } from './pages/DispatcherPage'
import { DriverPage } from './pages/DriverPage'

export function App() {
  return <Routes><Route path="admin/*" element={<AdminPage />} /><Route path="driver/*" element={<DriverPage />} /><Route path="dispatcher/*" element={<DispatcherPage />} /><Route path="booking/*" element={<BookingPage />} /><Route element={<DemoLayout />}><Route index element={<LandingPage />} /><Route path="*" element={<NotFoundPage />} /></Route></Routes>
}
