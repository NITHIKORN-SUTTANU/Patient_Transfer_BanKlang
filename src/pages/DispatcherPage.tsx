import { MunicipalLogo } from '../components/MunicipalLogo'
import { ResponsiveNavigation } from '../components/ResponsiveNavigation'
import { RoleSelectionLink } from '../components/RoleSelectionLink'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import type { Booking } from '../data/seed'
import { bangkokDate } from '../services/booking'
import { bookingReviewIssue, dispatchDate, dispatchStatus, dispatchTime, initializeDispatcherResources, reviewBooking } from '../services/dispatch'
import { useDemoState } from '../services/demoStore'
import { DispatchAssignment } from '../components/DispatchAssignment'
import { DispatchButton, DispatchModal } from '../components/DispatcherUI'
import { ServiceTable } from '../components/ServiceTable'
import { ServiceSymbol } from '../components/ServiceSymbol'
import '../booking.css'
import { ScheduleReview } from '../components/ScheduleReview'
import '../dispatcher.css'

const nav = [{ path: '/dispatcher', label: 'แดชบอร์ดงานรับส่ง' }, { path: '/dispatcher/assignment', label: 'จัดตารางและมอบหมาย' }, { path: '/dispatcher/tracking', label: 'ติดตามงานรับส่ง' }]
const headers = { dashboard: ['ภาพรวมงานรับส่ง', 'ตรวจสอบคำขอ จัดรถ และติดตามการเดินทาง'], assignment: ['จัดรถและคนขับ', 'เลือกงาน ตรวจสอบเวลาและทรัพยากร ก่อนยืนยันการมอบหมาย'], tracking: ['ติดตามงานรับส่ง', 'ดูความคืบหน้าและรายละเอียดของงานที่มอบหมายแล้ว'] }
export function DispatcherPage() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const screen = pathname.replace(/\/$/, '').split('/')[2] || 'dashboard'
  const { state, storageAvailable } = useDemoState()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [search, setSearch] = useState('')
  const [date, setDate] = useState('')
  const [trackingScope, setTrackingScope] = useState<'today' | 'all'>('all')
  const [filter, setFilter] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const main = useRef<HTMLElement>(null)
  useEffect(() => { initializeDispatcherResources() }, [])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  useEffect(() => { window.scrollTo(0, 0); main.current?.querySelector<HTMLHeadingElement>('h1')?.focus() }, [pathname])
  const today = bangkokDate(now)
  const queue = state.bookings.filter(b => b.status === 'pending' || b.status === 'approved' && !b.schedule)
    .sort((a, b) => Date.parse(a.appointmentAt) - Date.parse(b.appointmentAt) || a.id.localeCompare(b.id))
  const waiting = state.bookings.filter(b => b.status === 'approved' && !b.schedule)
  const assigned = state.bookings.filter(b => !!b.schedule && ['approved', 'in_transit', 'completed', 'cancelled'].includes(b.status))
  const todaysJobs = assigned.filter(b => bangkokDate(Date.parse(b.schedule!.pickupAt)) === today)
  const selectedId = params.get('booking')
  const selected = selectedId ? waiting.find(b => b.id === selectedId) : waiting[0]
  const modalBooking = state.bookings.find(b => b.id === selectedId)
  const dialog = params.get('dialog')
  const previousDialog = useRef(dialog)
  useLayoutEffect(() => {
    if (dialog === 'approve') document.getElementById('approval-back')?.focus()
    else if (dialog === 'details' && previousDialog.current === 'approve') document.getElementById('approval-start')?.focus()
    previousDialog.current = dialog
  }, [dialog])
  const closeModal = () => { setError(''); setParams(screen === 'assignment' && selectedId ? { booking: selectedId } : {}, { replace: true }) }
  function openDetails(b: Booking) { setError(''); setReason(''); setParams({ booking: b.id, dialog: screen === 'tracking' ? 'tracking' : 'details' }) }
  function openDecision(decision: 'approve' | 'reject') { setError(''); setParams({ booking: selectedId!, dialog: decision }, { replace: true }) }
  function decide(decision: 'approved' | 'rejected') {
    if (!modalBooking) return
    try { reviewBooking(modalBooking.id, decision, reason); closeModal(); setNotice(decision === 'approved' ? `อนุมัติคำขอ ${modalBooking.id} แล้ว กรุณาจัดรถและคนขับ` : `ปฏิเสธคำขอ ${modalBooking.id} แล้ว`) }
    catch (e) { setError((e as Error).message); if (decision === 'rejected') requestAnimationFrame(() => document.getElementById('rejection-reason')?.focus()) }
  }
  function rowAction(b: Booking, index: number) {
    return b.status === 'approved' && !b.schedule ? <DispatchButton secondary onClick={() => navigate(`/dispatcher/assignment?booking=${encodeURIComponent(b.id)}`)}>จัดรถและคนขับ →</DispatchButton> : <DispatchButton secondary={index !== 0} onClick={() => openDetails(b)}>ดูรายละเอียด →</DispatchButton>
  }
  const monitoring = assigned.filter(b => {
    const needle = search.trim().toLocaleLowerCase()
    const driver = state.drivers.find(d => d.id === b.driverId)?.name || ''
    const pickupDay = bangkokDate(Date.parse(b.schedule!.pickupAt))
    const matchesDay = date ? pickupDay === date : trackingScope === 'today' ? pickupDay === today : true
    return matchesDay && (!filter || b.status === filter) && (!needle || `${b.id} ${b.patientName} ${driver}`.toLocaleLowerCase().includes(needle))
  }).sort((a, b) => {
    const dayA = bangkokDate(Date.parse(a.schedule!.pickupAt))
    const dayB = bangkokDate(Date.parse(b.schedule!.pickupAt))
    if (dayA !== dayB) return dayA === today ? -1 : dayB === today ? 1 : dayA.localeCompare(dayB)
    const priority = { in_transit: 0, approved: 1, completed: 2, cancelled: 3, pending: 4, rejected: 4 }
    return priority[a.status] - priority[b.status] || Date.parse(a.schedule!.pickupAt) - Date.parse(b.schedule!.pickupAt) || a.id.localeCompare(b.id)
  })
  if (!Object.hasOwn(headers, screen)) return <Navigate to="/dispatcher" replace />
  const [title, subtitle] = headers[screen as keyof typeof headers]
  return <div className={`dispatch-shell ${sidebarCollapsed ? 'dispatch-sidebar-collapsed' : ''}`}><a className="skip-link" href="#dispatcher-main">ข้ามไปยังเนื้อหา</a>
    <aside id="dispatcher-sidebar" className="dispatch-sidebar"><div className="dispatch-sidebar-tools"><MunicipalLogo /></div><div className="workspace-nav-heading">ระบบรับส่งผู้ป่วย</div><p className="workspace-role-label">เจ้าหน้าที่จัดรถ</p><ResponsiveNavigation id="dispatcher-navigation" label="เมนูเจ้าหน้าที่จัดรถ">{nav.map(item => <NavLink end to={item.path} key={item.path} aria-label={item.label} title={item.label}><ServiceSymbol kind={item.path.endsWith('assignment') ? 'calendar' : item.path.endsWith('tracking') ? 'route' : 'home'} /><span>{item.label}</span></NavLink>)}</ResponsiveNavigation><button type="button" className="dispatch-sidebar-toggle" aria-label={sidebarCollapsed ? 'ขยายเมนูด้านข้าง' : 'ย่อเมนูด้านข้าง'} title={sidebarCollapsed ? 'ขยายเมนูด้านข้าง' : 'ย่อเมนูด้านข้าง'} aria-expanded={!sidebarCollapsed} aria-controls="dispatcher-sidebar" onClick={() => setSidebarCollapsed(hidden => !hidden)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={sidebarCollapsed ? "m5 6 6 6-6 6m8-12 6 6-6 6" : "m11 6-6 6 6 6m8-12-6 6 6 6"} /></svg></button></aside>
    <main tabIndex={-1} ref={main} id="dispatcher-main" className={`dispatch-main dispatch-${screen}`}><header className="dispatch-page-header"><h1 tabIndex={-1}>{title}</h1><p>{subtitle}</p></header>
      <ScheduleReview state={state} />{notice && <div role="status" className="dispatch-notice"><p>{notice}</p><button aria-label="ปิดข้อความ" type="button" onClick={() => setNotice('')}>×</button></div>}
      {!storageAvailable && <p className="dispatch-alert" role="alert">ไม่สามารถบันทึกในเบราว์เซอร์ได้ การเปลี่ยนแปลงอยู่ในหน่วยความจำและจะหายเมื่อรีเฟรช</p>}
      {screen === 'dashboard' && <>
        <section className="dispatch-metrics" aria-label="ภาพรวมคำขอ"><article><p>คำขอรอตรวจสอบ</p><strong>{state.bookings.filter(b => b.status === 'pending').length}</strong><button type="button" onClick={() => { document.getElementById('dispatch-queue')?.scrollIntoView(); document.getElementById('queue-title')?.focus() }}>ตรวจสอบคำขอ →</button></article><article><p>รอจัดรถและคนขับ</p><strong>{waiting.length}</strong><Link to="/dispatcher/assignment">จัดตาราง →</Link></article><article><p>งานรับส่งวันนี้</p><strong>{todaysJobs.length}</strong><Link to="/dispatcher/tracking">ดูงานทั้งหมด →</Link></article></section>
        <section id="dispatch-queue" className="dispatch-queue"><h2 id="queue-title" tabIndex={-1}>คิวคำขอที่ต้องดำเนินการ</h2><p>เลือกงานเพื่อเปิดรายละเอียด ตรวจสอบ และดำเนินการ</p><ServiceTable headings={['รหัสคำขอ', 'วันนัด / เวลา', 'ปลายทาง', 'สถานะ', 'ดำเนินการ']} label="ตารางงานรับส่ง">{queue.length ? queue.map((b, i) => <tr key={b.id}><th scope="row">{b.id}</th><td>{dispatchDate(b.appointmentAt)} · {dispatchTime(b.appointmentAt)}</td><td>{b.details?.hospital || 'ไม่มีข้อมูลโรงพยาบาล'}</td><td><span className={`dispatch-status ${b.status}`}>{dispatchStatus(b)}</span></td><td>{rowAction(b, i)}</td></tr>) : <tr><td colSpan={5} className="dispatch-empty">ไม่มีคำขอที่ต้องดำเนินการ</td></tr>}</ServiceTable></section>
      </>}
      {screen === 'assignment' && <div className="dispatch-assignment-grid"><section className="dispatch-panel dispatch-waiting"><h2>1 เลือกงานที่รอจัดตาราง</h2><p>เลือกงาน แล้วจัดรถและคนขับ</p><div className="dispatch-waiting-list">{waiting.map(b => <article key={b.id} className={selected?.id === b.id ? 'selected' : ''}><button type="button" aria-pressed={selected?.id === b.id} onClick={() => { setError(''); setParams({ booking: b.id }) }}><strong>{b.id}</strong><b>{dispatchDate(b.appointmentAt)} · นัด {dispatchTime(b.appointmentAt)} น.</b><span>{b.details?.hospital || 'ไม่มีข้อมูลโรงพยาบาล'}</span><span className="dispatch-status approved">รอจัดตาราง</span></button><button type="button" className="dispatch-details-link" onClick={() => openDetails(b)}>ดูรายละเอียด</button></article>)}</div>{!waiting.length && <p className="dispatch-empty">ไม่มีงานรอจัดตาราง กรุณาอนุมัติคำขอจากแดชบอร์ดก่อน</p>}<p className="dispatch-small">แสดงเฉพาะงานที่ยังไม่ได้จัดรถ</p></section>{selected ? <DispatchAssignment key={selected.id} booking={selected} state={state} onAssigned={() => { setNotice(`มอบหมายงาน ${selected.id} แล้ว`); navigate('/dispatcher/tracking') }} /> : <section className="dispatch-panel dispatch-empty"><h2>{selectedId ? 'ไม่พบงานที่รอจัดตารางนี้' : 'เลือกงานที่รอจัดตาราง'}</h2><p>งานอาจถูกมอบหมายแล้ว หรือยังไม่ได้รับอนุมัติ</p><Link to="/dispatcher">กลับแดชบอร์ด</Link></section>}</div>}
      {screen === 'tracking' && <>
        <section className="dispatch-metrics dispatch-tracking-metrics" aria-label="ภาพรวมการรับส่งวันนี้">{[['งานทั้งหมดวันนี้', todaysJobs.length], ['อยู่ระหว่างรับส่ง', todaysJobs.filter(b => b.status === 'in_transit').length], ['ดำเนินการเสร็จแล้ว', todaysJobs.filter(b => b.status === 'completed').length]].map(([label, value]) => <article key={label}><p>{label}</p><strong>{value}</strong>{label === 'งานทั้งหมดวันนี้' && <span className="dispatch-tracking-secondary">{dispatchDate(new Date(now).toISOString())}</span>}</article>)}</section>
        <div className="dispatch-tracking-scopes" role="group" aria-label="ช่วงเวลาของงานรับส่ง">{([['all', 'ทั้งหมด'], ['today', 'วันนี้']] as const).map(([scope, label]) => <button type="button" key={scope} aria-pressed={!date && trackingScope === scope} onClick={() => { setTrackingScope(scope); setDate('') }}>{label}</button>)}</div>
        <div className="dispatch-filters"><label className="dispatch-search"><span className="sr-only">ค้นหารหัสงาน ชื่อผู้ป่วย หรือคนขับ</span><input type="search" value={search} placeholder="⌕ ค้นหารหัสงาน ชื่อผู้ป่วย หรือคนขับ" onChange={e => setSearch(e.target.value)} /></label><label className="dispatch-date-filter"><span>วันรับผู้ป่วย</span><input type="date" aria-label="วันรับผู้ป่วย" value={date} onChange={e => setDate(e.target.value)} /></label><label><span className="sr-only">กรองสถานะ</span><select aria-label="กรองสถานะ" value={filter} onChange={e => setFilter(e.target.value)}><option value="">สถานะทั้งหมด</option><option value="approved">มอบหมายแล้ว</option><option value="in_transit">กำลังเดินทาง</option><option value="completed">เสร็จสิ้น</option><option value="cancelled">ยกเลิกแล้ว</option></select></label></div>
        <section className="dispatch-panel dispatch-monitoring"><h2>{date ? dispatchDate(date) : trackingScope === 'today' ? 'รายการงานวันนี้' : 'รายการงานรับส่งทั้งหมด'} · {monitoring.length} งาน</h2><p className="dispatch-muted">งานกำลังเดินทางและงานรอรับแสดงก่อนงานที่จบแล้วในแต่ละวัน</p><ServiceTable headings={['งาน / ผู้ป่วย', 'วัน / เวลารับ', 'โรงพยาบาล', 'รถ / คนขับ', 'สถานะ', 'รายละเอียด']} label="ตารางงานรับส่ง">{monitoring.length ? monitoring.map(b => <tr key={b.id}><th scope="row">{b.id}<span className="dispatch-tracking-secondary">{b.patientName}</span></th><td><strong>{dispatchTime(b.schedule!.pickupAt)} น.</strong><span className="dispatch-tracking-secondary">{dispatchDate(b.schedule!.pickupAt)}</span></td><td>{b.details?.hospital || 'ไม่มีข้อมูลโรงพยาบาล'}</td><td>{state.vehicles.find(v => v.id === b.vehicleId)?.label || b.vehicleId} · {state.drivers.find(d => d.id === b.driverId)?.name || b.driverId}</td><td><span className={`dispatch-status-badge ${b.status}`}>{dispatchStatus(b)}</span></td><td><DispatchButton secondary onClick={() => openDetails(b)}>{b.status === 'completed' ? 'ดูรายละเอียด →' : 'ดูสถานะ →'}</DispatchButton></td></tr>) : <tr><td colSpan={6} className="dispatch-empty">{!date && trackingScope === 'today' && !search && !filter ? 'ไม่มีงานรับส่งวันนี้ เลือกทั้งหมดเพื่อดูงานวันอื่น' : 'ไม่พบงานรับส่งที่ตรงกับตัวกรอง'}</td></tr>}</ServiceTable><p className="dispatch-small">สถานะอัปเดตเมื่อคนขับกดยืนยัน</p></section>
      </>}
    <RoleSelectionLink /></main>
    {dialog && !modalBooking && <DispatchModal title="ไม่พบคำขอนี้" onClose={closeModal}><p>รายการนี้ไม่มีอยู่แล้ว กรุณาตรวจสอบรายการล่าสุด</p><DispatchButton secondary onClick={closeModal}>กลับไปตรวจสอบ</DispatchButton></DispatchModal>}
    {(dialog === 'details' || dialog === 'approve') && modalBooking && <DispatchModal title="รายละเอียดงาน" kind="dispatch-details-modal" onClose={closeModal}><div className="dispatch-details-heading"><p>{modalBooking.id}</p><span>{dispatchStatus(modalBooking)}</span></div><section className="dispatch-appointment"><p>นัดหมาย</p><div><strong>{dispatchDate(modalBooking.appointmentAt)}</strong><b>{dispatchTime(modalBooking.appointmentAt)} น.</b></div><h3>{modalBooking.details?.hospital || 'ไม่มีข้อมูลโรงพยาบาล'}</h3></section><section className="dispatch-detail-section"><h3>ผู้รับบริการและผู้ติดต่อ</h3><dl><div><dt>ชื่อผู้รับบริการ</dt><dd>{modalBooking.patientName}</dd>{modalBooking.details?.bookingFor === 'other' && <dd>{modalBooking.details.contactName} · {modalBooking.details.relationship}</dd>}</div><div><dt>เบอร์ติดต่อ</dt><dd>{modalBooking.details?.phone || 'ไม่มีข้อมูล'}</dd></div></dl></section><section className="dispatch-detail-section"><h3>การรับผู้ป่วย</h3><dl><div><dt>จุดรับ</dt><dd>{modalBooking.details?.pickup?.label || 'ไม่มีจุดรับ'}</dd></div><div><dt>ความช่วยเหลือ</dt><dd>{modalBooking.details?.assistance || 'ไม่มีข้อมูล'}</dd><dd>{modalBooking.details?.extras.join(' · ')}</dd></div></dl></section>{modalBooking.status === 'pending' && <><p className="dispatch-small">จองล่วงหน้าอย่างน้อย 48 ชั่วโมงนับจากเวลาส่งคำขอ · {modalBooking.createdAt ? `${dispatchDate(modalBooking.createdAt)} ${dispatchTime(modalBooking.createdAt)}` : 'ไม่พบเวลาส่งคำขอ'}</p>{dialog !== 'approve' && <div className="dispatch-dialog-actions"><DispatchButton id="approval-start" onClick={() => openDecision('approve')}>อนุมัติคำขอ</DispatchButton><DispatchButton secondary danger onClick={() => openDecision('reject')}>ปฏิเสธคำขอ</DispatchButton></div>}</>}{dialog === 'approve' && <><p className="dispatch-muted" aria-live="polite">ตรวจสอบข้อมูลแล้ว ยืนยันอนุมัติคำขอนี้หรือไม่?</p>{bookingReviewIssue(modalBooking, now) && <p role="alert" className="dispatch-alert">{bookingReviewIssue(modalBooking, now)}</p>}{error && <p className="dispatch-alert" role="alert">{error}</p>}<div className="dispatch-dialog-actions"><DispatchButton disabled={!!bookingReviewIssue(modalBooking, now) || modalBooking.status !== 'pending'} onClick={() => decide('approved')}>ยืนยันอนุมัติ</DispatchButton><DispatchButton id="approval-back" secondary onClick={() => { setError(''); setParams({ booking: modalBooking.id, dialog: 'details' }, { replace: true }) }}>กลับไปตรวจสอบ</DispatchButton></div></>}{dialog !== 'approve' && modalBooking.status === 'approved' && !modalBooking.schedule && <DispatchButton onClick={() => { setError(''); navigate(`/dispatcher/assignment?booking=${encodeURIComponent(modalBooking.id)}`) }}>ไปจัดรถและคนขับ →</DispatchButton>}</DispatchModal>}
    {dialog === 'reject' && modalBooking && <DispatchModal title="ปฏิเสธคำขอ" kind="dispatch-reject-modal" onClose={closeModal}>
      <p id="rejection-consequence" className="dispatch-danger-notice">คำขอ {modalBooking.id} จะไม่ถูกจัดรถ ผู้จองจะเห็นเหตุผลที่คุณระบุ</p>
      <form id="dispatcher-reject-form" noValidate onSubmit={e => { e.preventDefault(); decide('rejected') }}>
        <label className="dispatch-rejection-label" htmlFor="rejection-reason">เหตุผลการปฏิเสธ</label>
        <input id="rejection-reason" required value={reason} maxLength={500} placeholder="ระบุเหตุผลให้ผู้จองทราบ" aria-invalid={!!error} aria-describedby={error ? 'rejection-consequence rejection-error' : 'rejection-consequence'} onChange={e => { setReason(e.target.value); setError('') }} />
        {error && <p id="rejection-error" role="alert" className="dispatch-alert">{error}</p>}
      </form>
      <div className="dispatch-dialog-actions"><DispatchButton secondary data-initial-focus onClick={() => { setError(''); setParams({ booking: modalBooking.id, dialog: 'details' }, { replace: true }) }}>กลับไปตรวจสอบ</DispatchButton><DispatchButton danger type="submit" form="dispatcher-reject-form" disabled={modalBooking.status !== 'pending'}>ยืนยันปฏิเสธคำขอ</DispatchButton></div>
    </DispatchModal>}
    {dialog === 'tracking' && modalBooking && <DispatchModal title="ติดตามสถานะงานรับส่ง" kind="dispatch-tracking-modal" onClose={closeModal}><p className="dispatch-muted">{modalBooking.id} · {dispatchDate(modalBooking.appointmentAt)}</p><section className="dispatch-result-card"><h3>{dispatchStatus(modalBooking)}</h3><p>เวลารับตามแผน {modalBooking.schedule ? dispatchTime(modalBooking.schedule.pickupAt) : 'ยังไม่ได้มอบหมาย'} น. · {state.vehicles.find(v => v.id === modalBooking.vehicleId)?.label || 'ยังไม่มีรถ'}</p><p>{state.drivers.find(d => d.id === modalBooking.driverId)?.name || 'ยังไม่มีคนขับ'} · {modalBooking.details?.hospital}</p></section><h3>ความคืบหน้าของงาน</h3>{modalBooking.cancellation && <p className="dispatch-alert">ยกเลิกแล้ว · {modalBooking.cancellation.reason}</p>}<ol className="dispatch-tracking-steps"><li>✓ มอบหมายงานแล้ว</li><li>{['in_transit', 'completed'].includes(modalBooking.status) ? '✓ คนขับเริ่มออกเดินทาง' : '○ รอคนขับเริ่มออกเดินทาง'}</li><li className={modalBooking.status === 'in_transit' ? 'current' : ''}>{modalBooking.status === 'completed' ? '✓ ถึงโรงพยาบาล / เสร็จสิ้น' : modalBooking.status === 'in_transit' ? '● กำลังเดินทาง (สถานะปัจจุบัน)' : '○ รอถึงโรงพยาบาล / เสร็จสิ้น'}</li></ol><p className="dispatch-small">สถานะล่าสุดที่คนขับรายงาน</p><DispatchButton secondary onClick={closeModal}>ปิดรายละเอียด</DispatchButton></DispatchModal>}
  </div>
}
