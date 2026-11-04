import { DriverNavigation } from '../components/DriverNavigation'
import { PickupMap } from '../components/LocationMap'
import { MunicipalLogo } from '../components/MunicipalLogo'
import { ResponsiveNavigation } from '../components/ResponsiveNavigation'
import { RoleSelectionLink } from '../components/RoleSelectionLink'
import { driverAvailable } from '../services/resources'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import type { Booking, DriverStage } from '../data/seed'
import { BookingButton, BookingModal } from '../components/BookingUI'
import { useDemoState } from '../services/demoStore'
import { bangkokDate } from '../services/booking'
import { dispatchDate, dispatchTime, initializeDispatcherResources } from '../services/dispatch'
import { advanceDriverTrip, driverLabels, driverStage, driverStages } from '../services/driver'
import { ServiceSymbol } from '../components/ServiceSymbol'
import { cancelBooking } from '../services/cancellation'
import '../booking.css'
import '../driver.css'

function savedIdentity() { try { return sessionStorage.getItem('ban-klang-transit:driver') || '' } catch { return '' } }
export function DriverPage() {
  const { state, storageAvailable } = useDemoState()
  const [identity] = useState(savedIdentity)
  const [params] = useSearchParams()
  const { pathname, search: locationSearch, state: navigationState } = useLocation()
  const source = (navigationState as { from?: unknown } | null)?.from
  const detailsReturn = typeof source === 'string' && /^\/driver(?:\/(?:status|history))?(?:\?.*)?$/.test(source) ? source : '/driver'
  const navigate = useNavigate()
  const screen = pathname.replace(/\/$/, '').split('/')[2] || 'dashboard'
  const [confirmation, setConfirmation] = useState<{ id: string; driverId: string; stage: DriverStage } | null>(null)
  const [failedReason, setFailedReason] = useState('')
  const [mapId, setMapId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [now, setNow] = useState(Date.now)
  const main = useRef<HTMLElement>(null)
  useEffect(() => { initializeDispatcherResources() }, [])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  useEffect(() => { window.scrollTo(0, 0); main.current?.querySelector('h1')?.focus() }, [pathname])
  // Direct entry uses the first test account. Suspension must not switch identity.
  const effectiveIdentity = identity || state.drivers[0]?.id || ''
  const driver = state.drivers.find(d => d.id === effectiveIdentity && driverAvailable(state, d))
  const jobs = state.bookings.filter(b => driver && b.driverId === driver.id && b.schedule && ['approved', 'in_transit', 'completed', 'cancelled'].includes(b.status)).sort((a, b) => Date.parse(a.schedule!.pickupAt) - Date.parse(b.schedule!.pickupAt))
  const open = jobs.filter(b => !['completed', 'cancelled'].includes(b.status))
  const today = bangkokDate(now)
  const todays = open.filter(b => bangkokDate(Date.parse(b.schedule!.pickupAt)) === today || b.status === 'in_transit')
  const future = open.filter(b => !todays.includes(b))
  const history = jobs.filter(b => ['completed', 'cancelled'].includes(b.status)).reverse()
  const activeJob = open.find(b => b.status === 'in_transit')
  const selected = screen === 'status' ? activeJob : params.has('booking') ? jobs.find(b => b.id === params.get('booking')) : open.find(b => b.status === 'in_transit') || todays[0] || open[0]
  const current = selected ? driverStage(selected) : 'assigned'
  const currentIndex = driverStages.indexOf(current)
  const next = driverStages[currentIndex + 1]
  const nextAction = { assigned: 'เริ่มงานและออกไปรับผู้ป่วย', going_to_pickup: 'รับผู้ป่วยขึ้นรถแล้ว', patient_onboard: 'ออกเดินทางไปโรงพยาบาล', going_to_hospital: 'ส่งถึงโรงพยาบาลแล้ว', delivered: '' }[current]
  const modalBooking = confirmation ? jobs.find(b => b.id === confirmation.id) : undefined
  const startBlocked = current === 'assigned' && !!activeJob && activeJob.id !== selected?.id
  const confirmationBlocked = confirmation?.stage === 'assigned' && !!activeJob && activeJob.id !== confirmation.id
  const stale = !!confirmation && (!modalBooking || driverStage(modalBooking) !== confirmation.stage || effectiveIdentity !== confirmation.driverId || confirmationBlocked)
  const mapBooking = jobs.find(b => b.id === mapId)
  function confirmTrip() {
    if (!confirmation) return
    try { advanceDriverTrip(confirmation.id, confirmation.driverId, confirmation.stage); setConfirmation(null); setNotice('บันทึกสถานะงานแล้ว'); navigate(`/driver/status?booking=${encodeURIComponent(confirmation.id)}`) }
    catch (e) { setError((e as Error).message) }
  }
  function requestUpdate() { if (selected && driver) { setError(''); setConfirmation({ id: selected.id, driverId: driver.id, stage: current }) } }
  function tripCard(b: Booking, primary = false) {
    const active = b.status === 'in_transit'
    return <article className={`driver-card driver-trip ${b.status === 'cancelled' ? 'is-cancelled' : ''} ${active ? 'is-active' : ''} ${primary ? 'is-primary' : ''}`} key={b.id}>
      <div className="driver-card-top"><span className="driver-trip-state">{active ? driverLabels[driverStage(b)] : b.status === 'approved' ? 'รอเริ่มงาน' : b.status === 'completed' ? 'เสร็จสิ้น' : 'ยกเลิกแล้ว'}</span><span>{b.id}</span></div><span className="driver-pickup-label">เวลารับผู้ป่วย</span>
      <strong className="driver-time">{dispatchTime(b.schedule!.pickupAt)} น.</strong>
      {b.status === 'cancelled' && b.cancellation?.reason && <p className="driver-helper">เหตุผล: {b.cancellation.reason}</p>}
      <p className="driver-patient-name"><ServiceSymbol kind="person" />{b.patientName}</p><dl><div><dt>จุดรับ</dt><dd>{b.details?.pickup?.label || 'ไม่มีข้อมูลจุดรับ'}</dd></div><div><dt>ปลายทาง</dt><dd>{b.details?.hospital || 'ไม่มีข้อมูลโรงพยาบาล'}</dd></div></dl>
      <BookingButton className="driver-button" secondary={!primary} onClick={() => navigate(`/driver/${active && primary ? 'status' : 'details'}?booking=${encodeURIComponent(b.id)}`, { state: { from: pathname + locationSearch } })}>{active && primary ? 'ติดตามสถานะงาน' : primary ? 'ดูรายละเอียดงาน' : 'ดูรายละเอียด'} <span aria-hidden="true">→</span></BookingButton>
    </article>
  }
  if (!['dashboard', 'details', 'status', 'history', 'failed-pickup'].includes(screen)) return <Navigate to="/driver" replace />
  const title = { dashboard: 'งานวันนี้', details: 'รายละเอียดงาน', status: 'สถานะงาน', history: 'ประวัติงาน', 'failed-pickup': 'สถานะงาน' }[screen]
  return <div className={`driver-shell ${sidebarCollapsed ? 'driver-sidebar-collapsed' : ''}`}><a className="skip-link" href="#driver-main">ข้ามไปยังเนื้อหา</a>

    <aside className="dispatch-sidebar driver-sidebar" id="driver-sidebar"><div className="dispatch-sidebar-tools"><MunicipalLogo /></div><div className="workspace-nav-heading">ระบบรับส่งผู้ป่วย</div><p className="workspace-role-label">คนขับรถ</p><ResponsiveNavigation id="driver-navigation" className="driver-nav" label="เมนูคนขับ">{[['/driver', '▦', 'งานวันนี้'], ['/driver/status', '◉', 'สถานะงาน'], ['/driver/history', '▤', 'ประวัติ']].map(([path, icon, label]) => <NavLink end key={path} to={path} aria-label={label} title={path === '/driver/status' && activeJob ? 'สถานะงาน · มีงานกำลังดำเนินการ' : label} className={({ isActive }) => isActive || path === '/driver' && screen === 'details' || path === '/driver/status' && screen === 'failed-pickup' ? 'active' : ''}><ServiceSymbol kind={icon === '▦' ? 'home' : icon === '◉' ? 'route' : 'history'} /><span>{label}</span>{path === '/driver/status' && activeJob && <i className="driver-status-indicator" role="img" aria-label="มีงานกำลังดำเนินการ" />}</NavLink>)}</ResponsiveNavigation><button type="button" className="dispatch-sidebar-toggle" aria-label={sidebarCollapsed ? 'ขยายเมนูด้านข้าง' : 'ย่อเมนูด้านข้าง'} title={sidebarCollapsed ? 'ขยายเมนูด้านข้าง' : 'ย่อเมนูด้านข้าง'} aria-expanded={!sidebarCollapsed} aria-controls="driver-sidebar" onClick={() => setSidebarCollapsed(value => !value)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={sidebarCollapsed ? 'm5 6 6 6-6 6m8-12 6 6-6 6' : 'm11 6-6 6 6 6m8-12-6 6 6 6'} /></svg></button></aside>
    <main tabIndex={-1} id="driver-main" className={`driver-${screen}-page`} ref={main}><header className="driver-header">{screen === 'details' && <Link className="driver-back-link" to={detailsReturn}><span aria-hidden="true">←</span> กลับหน้าก่อนหน้า</Link>}{screen === 'dashboard' && <p>งานรับส่งผู้ป่วย</p>}<h1 tabIndex={-1}>{title}</h1><p>{screen === 'dashboard' ? `งานที่ได้รับมอบหมาย • ${todays.length} งาน` : screen === 'history' ? `งานรับส่งที่เสร็จสิ้นแล้ว • ${history.length} งาน` : selected ? `${selected.id} • ${selected.status === 'cancelled' ? 'ยกเลิกแล้ว' : screen === 'details' && current === 'assigned' ? `นัดรับ ${dispatchTime(selected.schedule!.pickupAt)} น.` : driverLabels[current]}` : screen === 'status' ? 'ยังไม่มีงานที่เริ่มแล้ว' : 'เลือกงานที่ได้รับมอบหมาย'}</p></header>
      <div className="driver-content">
        {!storageAvailable && <p role="alert" className="driver-error">ไม่สามารถบันทึกในเบราว์เซอร์ได้ ข้อมูลจะหายเมื่อรีเฟรช</p>}
        {notice && <p role="status" className="driver-notice">{notice}</p>}
        {!driver ? <section className="driver-card driver-empty"><h2>บัญชีนี้ยังไม่พร้อมใช้งาน</h2><p>กรุณาติดต่อเจ้าหน้าที่จัดรถเพื่อตรวจสอบบัญชี</p></section> : <>
          {screen === 'dashboard' && <><div className="driver-grid"><section><div className="driver-section-heading"><h2>งานที่ต้องทำ</h2>{todays.some(b => b.status === 'in_transit') && <span className="driver-badge active">● กำลังดำเนินการ</span>}</div>{todays.length ? tripCard(todays.find(b => b.status === 'in_transit') || todays[0], true) : <div className="driver-card driver-empty"><ServiceSymbol kind="check" /><h3>ไม่มีงานรับส่งวันนี้</h3><p>งานใหม่จะแสดงที่นี่เมื่อเจ้าหน้าที่มอบหมาย</p></div>}</section>{todays.length > 1 && <section><h2>งานถัดไป</h2>{todays.filter(b => b.id !== (todays.find(b => b.status === 'in_transit') || todays[0]).id).map(b => tripCard(b))}</section>}</div>{future.length > 0 && <section><h2>งานที่ได้รับมอบหมายวันอื่น</h2><div className="driver-grid">{future.map(b => <div key={b.id}><h3>{dispatchDate(b.schedule!.pickupAt)}</h3>{tripCard(b)}</div>)}</div></section>}</>}
          {screen === 'history' && (history.length ? <div className="driver-grid">{history.map(b => <section key={b.id}><h2>{dispatchDate(b.schedule!.pickupAt)}</h2>{tripCard(b)}</section>)}</div> : <section className="driver-card driver-empty"><h2>ยังไม่มีประวัติงาน</h2><p>งานที่ส่งถึงโรงพยาบาลแล้วจะแสดงที่นี่</p></section>)}
          {screen === 'failed-pickup' && <section className="driver-failed"><h2>รับผู้ป่วยไม่ได้</h2><p className="driver-helper">รายงานก่อนรับผู้ป่วยขึ้นรถ</p><div className="driver-card"><h3>หมายเลขงาน</h3><p>{selected?.id || 'ไม่พบงาน'} · {selected?.details?.pickup?.label}</p></div><form onSubmit={e => { e.preventDefault(); try { if (!selected || !driver) throw new Error('ไม่พบงาน'); cancelBooking(selected.id, 'driver', failedReason, driver.id); setNotice('บันทึกรายงานแล้ว · รายการถูกยกเลิกและคืนการจองรถและคนขับ'); navigate('/driver/history') } catch(e) { setError((e as Error).message) } }}><label className="booking-field">เหตุผลที่รับผู้ป่วยไม่ได้<select value={failedReason} onChange={e => setFailedReason(e.target.value)} required><option value="">เลือกเหตุผล</option>{['ไม่พบผู้ป่วย', 'ติดต่อผู้ป่วยไม่ได้', 'เหตุขัดข้องอื่น'].map(reason => <option key={reason}>{reason}</option>)}</select></label><div className="driver-card"><h3>เมื่อยืนยัน</h3><p>งานจะถูกยกเลิกและแสดงผลในหน้าผู้จองและเจ้าหน้าที่จัดรถ</p></div>{error && <p role="alert" className="driver-error">{error}</p>}<BookingButton danger type="submit" className="driver-button" disabled={!selected || selected.status !== 'in_transit' || current !== 'going_to_pickup'}>ยืนยันรายงานรับไม่ได้</BookingButton></form><BookingButton secondary className="driver-button" onClick={() => navigate(`/driver/status?booking=${selected?.id || ''}`)}>กลับไปที่งาน</BookingButton></section>}
          {['details', 'status'].includes(screen) && (!selected ? <section className="driver-card driver-empty"><h2>{screen === 'status' ? 'ยังไม่มีงานที่เริ่มแล้ว' : params.has('booking') ? 'ไม่พบงานที่มอบหมายให้คนขับนี้' : 'ยังไม่มีงานที่ได้รับมอบหมาย'}</h2><Link to="/driver">กลับไปดูงาน</Link></section> : <>
            {screen === 'details' && <div className="driver-grid driver-details"><section><h2>จุดรับผู้ป่วย</h2><div className="driver-card driver-lines"><div className="driver-location-icon"><ServiceSymbol kind="pin" /></div><p>จุดรับ • {selected.details?.pickup?.label || 'ไม่มีข้อมูล'}</p><p className="driver-detail-patient">ผู้รับบริการ • {selected.patientName}</p><p>{selected.details?.phone ? <a className="driver-call" href={`tel:${selected.details.phone.replace(/[^0-9+]/g, '')}`}><ServiceSymbol kind="phone" />โทรหาผู้ติดต่อ · {selected.details.phone}</a> : 'ไม่มีเบอร์ติดต่อ'}</p><BookingButton secondary className="driver-button" onClick={() => setMapId(selected.id)}><ServiceSymbol kind="pin" />เปิดแผนที่ไปจุดรับ</BookingButton></div></section><div><section><h2>ปลายทาง</h2><div className="driver-card driver-lines"><div className="driver-location-icon"><ServiceSymbol kind="hospital" /></div><p>{selected.details?.hospital || 'ไม่มีข้อมูล'}</p><p>เวลานัดหมาย • {dispatchTime(selected.appointmentAt)} น.</p></div></section><section><h2>การช่วยเหลือ</h2><div className="driver-card driver-lines"><p>การเดินทาง • {selected.details?.assistance || 'ไม่มีข้อมูล'}</p><p>{selected.details?.extras.join(' · ') || 'ไม่มีรายการเพิ่มเติม'}</p></div></section></div></div>}
            {selected.status === 'cancelled' && <section className="driver-card"><h2>ยกเลิกแล้ว</h2><p>{selected.cancellation?.reason}</p></section>}{screen === 'status' && selected.status !== 'cancelled' && <div className="driver-grid"><section><h2>สถานะปัจจุบัน</h2><div className="driver-card driver-current"><span className="driver-step-count">ขั้นตอนที่ {currentIndex + 1} จาก {driverStages.length}</span><h3>{driverLabels[current]}</h3><p className="driver-current-person">{selected.patientName}</p><div className="driver-trip-time-range" role="group" aria-label="ช่วงเวลางานตามแผน"><div><span>ออกศูนย์ตามแผน</span><time dateTime={selected.schedule!.departureAt}>{dispatchTime(selected.schedule!.departureAt)} น.</time></div><span className="driver-trip-time-arrow" aria-hidden="true">→</span><div><span>เวลานัดหมาย</span><time dateTime={selected.appointmentAt}>{dispatchTime(selected.appointmentAt)} น.</time></div></div><div className="driver-current-location"><ServiceSymbol kind={current === 'patient_onboard' || current === 'going_to_hospital' || current === 'delivered' ? 'hospital' : 'pin'} /><div><span>{current === 'patient_onboard' || current === 'going_to_hospital' || current === 'delivered' ? 'โรงพยาบาล' : 'จุดรับผู้ป่วย'}</span><strong>{current === 'patient_onboard' || current === 'going_to_hospital' || current === 'delivered' ? selected.details?.hospital || 'ไม่มีข้อมูล' : selected.details?.pickup?.label || 'ไม่มีข้อมูลจุดรับ'}</strong></div></div>{['assigned', 'going_to_pickup'].includes(current) && <div className="driver-quick-actions">{selected.details?.phone && <a className="driver-contact-action" href={`tel:${selected.details.phone.replace(/[^0-9+]/g, '')}`}><ServiceSymbol kind="phone" />โทรหาผู้ติดต่อ</a>}<BookingButton secondary className="driver-button" onClick={() => setMapId(selected.id)}><ServiceSymbol kind="pin" />ดูจุดรับ</BookingButton></div>}{next && <p className="driver-next">ขั้นตอนถัดไป · {driverLabels[next]}</p>}</div><Link className="driver-detail-link" to={`/driver/details?booking=${encodeURIComponent(selected.id)}`} state={{ from: pathname + locationSearch }}>ดูรายละเอียดงาน →</Link></section><section><h2>ความคืบหน้าของงาน</h2><ol className="driver-card driver-timeline">{driverStages.map((stage, index) => <li key={stage} className={index <= currentIndex ? index === currentIndex ? 'current' : 'done' : ''} aria-current={index === currentIndex ? 'step' : undefined}><span aria-hidden="true">{index < currentIndex ? '✓' : index === currentIndex ? '●' : index + 1}</span><div>{driverLabels[stage]}{selected.driverProgress?.events.find(e => e.stage === stage) && <small>{dispatchDate(selected.driverProgress.events.find(e => e.stage === stage)!.at)} · {dispatchTime(selected.driverProgress.events.find(e => e.stage === stage)!.at)}</small>}</div></li>)}</ol></section></div>}
            {screen === 'details' && <section className="driver-schedule"><h2>ตารางที่ได้รับมอบหมาย</h2><div className="driver-card"><p>{dispatchDate(selected.schedule!.pickupAt)} · {state.vehicles.find(v => v.id === selected.vehicleId)?.label || selected.vehicleId}</p><dl>{[['ออกศูนย์', selected.schedule!.departureAt], ['รับผู้ป่วย', selected.schedule!.pickupAt], ['ถึงโรงพยาบาลตามแผน', selected.schedule!.arrivalAt], ['นัดหมาย', selected.appointmentAt]].map(([label, time]) => <div key={label}><dt>{label}</dt><dd>{dispatchTime(time)} น.</dd></div>)}</dl><p className="driver-helper">ถึงโรงพยาบาลก่อนนัด 20 นาที</p></div></section>}{screen === 'status' && selected.status === 'in_transit' && current === 'going_to_pickup' && <button className="driver-report-link" type="button" onClick={() => { setFailedReason(''); setError(''); navigate(`/driver/failed-pickup?booking=${selected.id}`) }}>รับผู้ป่วยไม่ได้</button>}
            <div className="driver-action">{startBlocked && <p className="driver-helper" role="status">กรุณาจบงาน {activeJob!.id} ก่อนเริ่มงานใหม่ · <Link to="/driver/status">กลับไปงานที่กำลังทำ</Link></p>}{selected.status === 'cancelled' ? <Link className="driver-button booking-button" to="/driver/history">ดูประวัติงาน</Link> : screen === 'details' ? <BookingButton className="driver-button" disabled={startBlocked} onClick={() => current === 'assigned' ? requestUpdate() : navigate(`/driver/status?booking=${encodeURIComponent(selected.id)}`)}>{current === 'assigned' ? 'ไปเริ่มรับผู้ป่วย' : 'ดูสถานะงาน'}</BookingButton> : next ? <BookingButton className="driver-button" onClick={requestUpdate}>{nextAction}</BookingButton> : <Link className="driver-button booking-button" to="/driver/history">ดูประวัติงาน</Link>}</div>

          </>)}
        </>}
      </div>
    </main><RoleSelectionLink />

    {confirmation && <BookingModal title="ยืนยันการอัปเดตสถานะ" className="driver-modal" onClose={() => { setConfirmation(null); setError('') }}><p className="driver-helper">สถานะปัจจุบัน</p><strong>{driverLabels[confirmation.stage]}</strong><p className="driver-arrow" aria-hidden="true">↓</p><h3>{driverLabels[driverStages[driverStages.indexOf(confirmation.stage) + 1]]}</h3>{(error || stale) && <p role="alert" className="driver-error">{error || (confirmationBlocked ? `กรุณาจบงาน ${activeJob!.id} ก่อนเริ่มงานใหม่` : 'งานหรือสถานะเปลี่ยนแล้ว กรุณาปิดหน้าต่างและตรวจสอบข้อมูลล่าสุด')}</p>}<BookingButton className="driver-button" disabled={stale} onClick={confirmTrip}>ยืนยันการอัปเดต</BookingButton><BookingButton className="driver-button" secondary danger data-initial-focus onClick={() => setConfirmation(null)}>ยกเลิก</BookingButton></BookingModal>}
    {mapId && <BookingModal title="จุดรับผู้ป่วย" className="driver-modal driver-map-modal" onClose={() => setMapId(null)} footer={mapBooking?.details?.pickup?.latitude !== undefined && mapBooking.details.pickup.longitude !== undefined ? <DriverNavigation key={mapBooking.id} latitude={mapBooking.details.pickup.latitude} longitude={mapBooking.details.pickup.longitude} /> : undefined}>{mapBooking?.details?.pickup ? <><p>{mapBooking.details.pickup.label}</p>{mapBooking.details.pickup.latitude !== undefined && mapBooking.details.pickup.longitude !== undefined ? <><p className="driver-helper">แผนที่แสดงจุดรับผู้ป่วย · เปิด Google Maps เพื่อดูเส้นทางจากตำแหน่งของคุณ</p><PickupMap value={mapBooking.details.pickup} /></> : <p className="driver-helper">จุดรับเดิมไม่มีพิกัด GPS กรุณาติดต่อผู้จองเพื่อยืนยันจุดรับ</p>}</> : <p>ไม่พบข้อมูลจุดรับของงานนี้</p>}</BookingModal>}
  </div>
}
