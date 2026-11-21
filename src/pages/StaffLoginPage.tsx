import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { BookingButton, BookingHeader } from '../components/BookingUI'
import { enterDemoCitizen } from '../services/citizenSession'
import { staffSession, useStaffSession } from '../services/staffSession'
import '../booking.css'

export function StaffLoginPage() {
  const session = useStaffSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')
  const destinationFor = (role: 'admin' | 'dispatcher' | 'driver') => role === 'driver'
    ? next && /^\/driver(?:\/(?:details|status|history|failed-pickup|incident))?(?:\?.*)?$/.test(next) ? next : '/driver'
    : role === 'admin'
      ? next && /^\/admin(?:\/(?:accounts|vehicles|drivers|history|settings|audit))?(?:\?.*)?$/.test(next) ? next : '/admin'
      : next && /^\/dispatcher(?:\/(?:assignment|tracking))?(?:\?.*)?$/.test(next) ? next : '/dispatcher'
  const destination = session.user ? destinationFor(session.user.role) : '/dispatcher'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const roles = { admin: 'ผู้ดูแลระบบ', dispatcher: 'เจ้าหน้าที่จัดรถ', driver: 'คนขับรถ' }

  function enterDemo(role: 'admin' | 'dispatcher' | 'driver') {
    staffSession.enterDemoRole(role)
    navigate(destinationFor(role))
  }

  return <div className="booking-shell"><main className="booking-screen">
    <BookingHeader title="เข้าสู่ระบบเจ้าหน้าที่" />
    {session.user ? <section className="booking-card"><div className="booking-card-copy">
      <h2>{session.user.name}</h2><p>{roles[session.user.role]}</p>
      {session.user.role === 'dispatcher' && <Link className="booking-button" to={destination}>เปิดหน้าจัดรถ</Link>}
      {session.user.role === 'driver' && <Link className="booking-button" to={destination}>เปิดหน้าคนขับ</Link>}
      {session.user.role === 'admin' && <Link className="booking-button" to={destination}>เปิดหน้าผู้ดูแลระบบ</Link>}
      <BookingButton disabled={session.busy} onClick={() => void staffSession.refresh()}>ตรวจสอบเซสชัน</BookingButton>
      <BookingButton secondary disabled={session.busy} onClick={() => void staffSession.logout()}>ออกจากระบบ</BookingButton>
    </div></section> : <>
      <form onSubmit={event => { event.preventDefault(); void staffSession.login(username.trim(), password).finally(() => setPassword('')) }}>
        <label className="booking-field">ชื่อผู้ใช้<input name="username" autoComplete="username" required maxLength={120} value={username} disabled={session.busy} onChange={event => setUsername(event.target.value)} /></label>
        <label className="booking-field">รหัสผ่าน<input name="password" type="password" autoComplete="current-password" required maxLength={512} value={password} disabled={session.busy} onChange={event => setPassword(event.target.value)} /></label>
        <BookingButton type="submit" disabled={session.busy}>{session.busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</BookingButton>
      </form>
      <section className="staff-demo-panel" aria-labelledby="staff-demo-heading">
        <h2 id="staff-demo-heading">ทดลองใช้งานทันที (โหมดสาธิต)</h2>
        <p className="booking-small">สำหรับทดสอบ UI ทุกบทบาทโดยไม่ต้องเปิด PostgreSQL หรือ LINE LIFF</p>
        <div className="staff-demo-buttons">
          <BookingButton secondary onClick={() => enterDemo('admin')}>ทดลองใช้งาน: ผู้ดูแลระบบ (Admin)</BookingButton>
          <BookingButton secondary onClick={() => enterDemo('dispatcher')}>ทดลองใช้งาน: เจ้าหน้าที่จัดรถ (Dispatcher)</BookingButton>
          <BookingButton secondary onClick={() => enterDemo('driver')}>ทดลองใช้งาน: พนักงานขับรถ (Driver)</BookingButton>
          <BookingButton secondary onClick={() => { void enterDemoCitizen(); navigate('/booking') }}>ทดลองใช้งาน: ผู้ป่วย / จองรถ (Citizen)</BookingButton>
        </div>
      </section>
    </>}
    {session.error && <p role="alert" className="booking-error-box">{session.error}</p>}
  </main></div>
}
