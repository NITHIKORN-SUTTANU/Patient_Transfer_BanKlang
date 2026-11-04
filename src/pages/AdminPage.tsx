import { MunicipalLogo } from '../components/MunicipalLogo'
import { ResponsiveNavigation } from '../components/ResponsiveNavigation'
import { driverLabels } from '../services/driver'
import { RoleSelectionLink } from '../components/RoleSelectionLink'
import { RecalculationPending } from '../components/ScheduleReview'
import { accountRoleLabels } from '../data/actors'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { AdminButton, AdminField, AdminForm } from '../components/AdminForms'
import type { AdminEditor } from '../components/AdminForms'
import { BookingModal } from '../components/BookingUI'
import { useDemoState } from '../services/demoStore'
import { defaultSettings, initializeAdmin } from '../services/admin'
import { dispatchDate, dispatchStatus, dispatchTime } from '../services/dispatch'
import { bangkokDate } from '../services/booking'
import { driverAvailable } from '../services/resources'
import { ServiceTable } from '../components/ServiceTable'
import { ServiceSymbol } from '../components/ServiceSymbol'
import '../booking.css'
import '../admin.css'

const navigation = [['', 'ภาพรวม'], ['accounts', 'ผู้ใช้งานและสิทธิ์'], ['vehicles', 'รถและคนขับ'], ['history', 'ประวัติการรับ–ส่ง'], ['settings', 'การตั้งค่าระบบ'], ['audit', 'บันทึกกิจกรรม']]
const headers: Record<string, [string, string]> = {
  dashboard: ['ภาพรวมระบบ', 'ดูข้อมูลภาพรวมและเลือกหมวดงาน'], accounts: ['บัญชีผู้ใช้งานและสิทธิ์', 'เพิ่มบัญชี แก้ไขข้อมูล และกำหนดสิทธิ์'], vehicles: ['รถรับส่ง', 'จัดการข้อมูลและสถานะรถรับส่ง'], drivers: ['จัดการคนขับรถ', 'จัดการรายชื่อและสถานะคนขับ'], history: ['ประวัติการรับ–ส่งผู้ป่วย', 'ค้นหาและตรวจสอบงานรับ–ส่งย้อนหลังตามรถ คนขับ และวันที่'], settings: ['การตั้งค่าระบบ', 'จัดการข้อมูลพื้นที่และเวลาทำการ'], audit: ['บันทึกกิจกรรม', 'ตรวจสอบการเปลี่ยนแปลงข้อมูลและการดำเนินการของเจ้าหน้าที่'],
}
function Metrics({ values }: { values: [string, ReactNode][] }) { return <div className="admin-metrics">{values.map(([label, value]) => <article key={label}><p>{label}</p><strong>{value}</strong></article>)}</div> }
function Table({ headings, children, empty }: { headings: string[]; children: ReactNode; empty?: boolean }) {
  return <ServiceTable headings={headings}>{empty ? <tr><td colSpan={headings.length} className="admin-empty">ไม่พบข้อมูลที่ตรงกับเงื่อนไข</td></tr> : children}</ServiceTable>
}
function Badge({ active, yes = 'ใช้งานอยู่', no = 'ระงับการใช้งาน' }: { active: boolean; yes?: string; no?: string }) { return <span className={`admin-badge ${active ? '' : 'inactive'}`}>{active ? yes : no}</span> }
export function AdminPage() {
  const { state, storageAvailable } = useDemoState()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const screen = pathname.replace(/\/$/, '').split('/')[2] || 'dashboard'
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [driver, setDriver] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [category, setCategory] = useState('')
  const [settingsTab, setSettingsTab] = useState('settings')
  const [editor, setEditor] = useState<AdminEditor | null>(null)
  const [tripId, setTripId] = useState<string | null>(null)
  const [auditId, setAuditId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const main = useRef<HTMLElement>(null)
  useEffect(() => { initializeAdmin() }, [])
  useEffect(() => { window.scrollTo(0, 0); main.current?.querySelector('h1')?.focus() }, [pathname])
  const accounts = state.accounts || []
  const settings = state.settings || defaultSettings
  const events = state.auditEvents || []
  const matches = (...values: (string | undefined)[]) => values.join(' ').toLowerCase().includes(search.trim().toLowerCase())
  const statusMatch = (active: boolean) => !status || String(active) === status
  const accountRows = accounts.filter(a => matches(a.id, a.name, a.username) && statusMatch(a.active) && (!role || role === a.role))
  const vehicleRows = state.vehicles.filter(v => matches(v.id, v.label, v.vehicleType, v.support) && statusMatch(v.active))
  const driverRows = state.drivers.filter(d => matches(d.id, d.name, d.phone) && statusMatch(driverAvailable(state, d)))
  const bookings = state.bookings.slice().sort((a, b) => Date.parse(b.appointmentAt) - Date.parse(a.appointmentAt))
  const trips = bookings.filter(b => matches(b.id, b.patientName, b.details?.hospital) && (!status || status === b.status) && (!vehicle || vehicle === b.vehicleId) && (!driver || driver === b.driverId) && (!from || bangkokDate(Date.parse(b.appointmentAt)) >= from) && (!to || bangkokDate(Date.parse(b.appointmentAt)) <= to))
  const auditRows = events.filter(e => matches(e.recordId, e.action, e.actor, e.reason) && (!category || category === e.category))
  const selectedTrip = bookings.find(b => b.id === tripId)
  const selectedEvent = events.find(e => e.id === auditId)
  const vehicleLabel = (id?: string) => state.vehicles.find(v => v.id === id)?.label || id || 'ยังไม่มอบหมาย'
  const driverLabel = (id?: string) => state.drivers.find(d => d.id === id)?.name || id || 'ยังไม่มอบหมาย'
  function openEditor(value: AdminEditor) { setNotice(''); setEditor(value) }
  function go(path: string) { setSearch(''); setStatus(''); setRole(''); setNotice(''); setEditor(null); setTripId(null); setAuditId(null); navigate(`/admin${path ? `/${path}` : ''}`) }
  function resourceTabs() { return <div className="admin-tabs" aria-label="ประเภทรัพยากร"><button aria-pressed={screen === 'vehicles'} onClick={() => go('vehicles')}>รถรับส่ง</button><button aria-pressed={screen === 'drivers'} onClick={() => go('drivers')}>คนขับ</button></div> }
  function searchFilter() { return <div className="admin-filters"><AdminField label="ค้นหา"><input type="search" placeholder="ค้นหารหัสหรือชื่อ" value={search} onChange={e => setSearch(e.target.value)} /></AdminField><AdminField label="สถานะ"><select value={status} onChange={e => setStatus(e.target.value)}><option value="">ทุกสถานะ</option><option value="true">ใช้งานอยู่ / พร้อมใช้งาน</option><option value="false">ระงับ / ไม่พร้อมใช้งาน</option></select></AdminField>{screen === 'accounts' && <AdminField label="บทบาท"><select value={role} onChange={e => setRole(e.target.value)}><option value="">ทุกบทบาท</option>{(['Dispatcher', 'Driver', 'Admin'] as const).map(r => <option key={r} value={r}>{accountRoleLabels[r]}</option>)}</select></AdminField>}</div> }
  if (!headers[screen]) return <Navigate to="/admin" replace />
  return <div className={`admin-shell admin-screen-${screen} ${sidebarCollapsed ? 'admin-sidebar-collapsed' : ''}`}><a className="skip-link" href="#admin-main">ข้ามไปยังเนื้อหา</a>
    <aside id="admin-sidebar" className="dispatch-sidebar admin-sidebar"><div className="dispatch-sidebar-tools"><MunicipalLogo /></div><div className="admin-brand"><strong>ระบบรับส่งผู้ป่วย</strong><p>ผู้ดูแลระบบ</p></div><ResponsiveNavigation id="admin-navigation" label="เมนูผู้ดูแลระบบ">{navigation.map(([path, label]) => <Link key={path} aria-label={label} title={label} aria-current={(path || 'dashboard') === screen || path === 'vehicles' && screen === 'drivers' ? 'page' : undefined} to={`/admin${path ? `/${path}` : ''}`} className={(path || 'dashboard') === screen || path === 'vehicles' && screen === 'drivers' ? 'active' : ''} onClick={e => { e.preventDefault(); go(path) }}><ServiceSymbol kind={path === 'accounts' ? 'people' : path === 'vehicles' ? 'vehicle' : path === 'history' ? 'history' : path === 'settings' ? 'settings' : path === 'audit' ? 'shield' : 'home'} /><span>{label}</span></Link>)}</ResponsiveNavigation><button type="button" className="dispatch-sidebar-toggle" aria-label={sidebarCollapsed ? 'ขยายเมนูด้านข้าง' : 'ย่อเมนูด้านข้าง'} title={sidebarCollapsed ? 'ขยายเมนูด้านข้าง' : 'ย่อเมนูด้านข้าง'} aria-expanded={!sidebarCollapsed} aria-controls="admin-sidebar" onClick={() => setSidebarCollapsed(value => !value)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={sidebarCollapsed ? 'm5 6 6 6-6 6m8-12 6 6-6 6' : 'm11 6-6 6 6 6m8-12-6 6 6 6'} /></svg></button></aside>
    <main tabIndex={-1} id="admin-main" ref={main}><header className="admin-heading"><h1 tabIndex={-1}>{headers[screen][0]}</h1><p>{headers[screen][1]}</p></header>
      {!storageAvailable && <p role="alert" className="admin-error">ไม่สามารถบันทึกในเบราว์เซอร์ได้ ข้อมูลจะหายเมื่อรีเฟรช</p>}{notice && <p role="status" className="admin-notice">{notice}</p>}
      {screen === 'dashboard' && <>
        <Metrics values={[[ 'บัญชีผู้ใช้งาน', accounts.length], ['รถในระบบ', state.vehicles.length], ['คนขับ', state.drivers.length]]} />
        <section className="admin-panel"><h2>งานดูแลระบบ</h2><p className="admin-muted">เลือกหมวดงานที่ต้องการจัดการ</p><Table headings={['หมวด', 'รายละเอียด', 'ดำเนินการ']}>{[['ผู้ใช้งานและสิทธิ์', 'จัดการบัญชีและสิทธิ์', 'จัดการผู้ใช้งาน', 'accounts'], ['ข้อมูลรถและคนขับ', 'จัดการข้อมูลรถและคนขับ', 'จัดการรถและคนขับ', 'vehicles'], ['ตั้งค่าการให้บริการ', 'ตำแหน่งศูนย์รถและพื้นที่บริการ', 'ดูการตั้งค่า', 'settings'], ['ประวัติการทำรายการ', 'ตรวจสอบกิจกรรมและการเปลี่ยนแปลง', 'ดูประวัติการทำรายการ', 'audit']].map(([label, description, action, path]) => <tr key={path}><th scope="row">{label}</th><td>{description}</td><td><AdminButton secondary onClick={() => go(path)}>{action}</AdminButton></td></tr>)}</Table></section>

      </>}
      {screen === 'accounts' && <><Metrics values={[[ 'บัญชีทั้งหมด', accounts.length], ['ใช้งานอยู่', accounts.filter(a => a.active).length], ['ระงับการใช้งาน', accounts.filter(a => !a.active).length]]} /><section className="admin-panel"><div className="admin-panel-heading"><div><h2>รายชื่อผู้ใช้งาน</h2><p className="admin-muted">ค้นหาบัญชี เลือกดูสิทธิ์ และจัดการสถานะ</p></div><AdminButton onClick={() => openEditor({ category: 'accounts' })}>+ เพิ่มบัญชี</AdminButton></div>{searchFilter()}<Table headings={['รหัส', 'ชื่อ', 'บทบาท', 'สถานะ', 'การดำเนินการ']} empty={!accountRows.length}>{accountRows.map(a => <tr key={a.id}><th scope="row">{a.id}</th><td>{a.name}<small>{a.username}</small></td><td>{accountRoleLabels[a.role]}</td><td><Badge active={a.active} /></td><td><AdminButton secondary onClick={() => openEditor({ category: 'accounts', previous: a })}>จัดการบัญชี</AdminButton></td></tr>)}</Table></section></>}
      {(screen === 'vehicles' || screen === 'drivers') && <>
        {screen === 'vehicles' && <Metrics values={[[ 'รถทั้งหมด', state.vehicles.length], ['พร้อมใช้งาน', state.vehicles.filter(v => v.active).length], ['ปิดใช้งาน', state.vehicles.filter(v => !v.active).length]]} />}
        <section className="admin-panel"><div className="admin-panel-heading"><div><h2>{screen === 'vehicles' ? 'รายการรถรับส่ง' : 'รายชื่อคนขับ'}</h2><p className="admin-muted">จัดการข้อมูลและสถานะการใช้งาน</p></div><AdminButton onClick={() => openEditor({ category: screen })}>{screen === 'vehicles' ? '+ เพิ่มรถ' : '+ เพิ่มคนขับ'}</AdminButton></div>{resourceTabs()}{searchFilter()}
          {screen === 'vehicles' ? <Table headings={['รหัส', 'ชื่อ', 'ประเภท / รองรับ', 'สถานะ', 'การดำเนินการ']} empty={!vehicleRows.length}>{vehicleRows.map(v => <tr key={v.id}><th scope="row">{v.id}</th><td>{v.label}</td><td>{v.vehicleType || 'ไม่ได้ระบุ'}<small>{v.support}</small></td><td><Badge active={v.active} yes="พร้อมใช้งาน" no="ปิดใช้งาน" /></td><td><AdminButton secondary onClick={() => openEditor({ category: 'vehicles', previous: v })}>จัดการรถ</AdminButton></td></tr>)}</Table> : <Table headings={['รหัส', 'ชื่อคนขับ', 'สถานะบัญชี', 'สถานะพร้อมใช้งาน', 'การดำเนินการ']} empty={!driverRows.length}>{driverRows.map(d => <tr key={d.id}><th scope="row">{d.id}</th><td>{d.name}<small>{d.phone}</small></td><td>{d.accountId ? <Badge active={!!accounts.find(a => a.id === d.accountId && a.role === 'Driver')?.active} /> : 'บัญชีเดิม (ยังไม่เชื่อม)'}</td><td><Badge active={driverAvailable(state, d)} yes="พร้อมใช้งาน" no="ไม่พร้อมใช้งาน" /></td><td><AdminButton secondary onClick={() => openEditor({ category: 'drivers', previous: d })}>จัดการคนขับ</AdminButton></td></tr>)}</Table>}
          <p className="admin-muted admin-footnote">ตรวจสอบตารางรถและคนขับก่อนมอบหมายงาน</p>
        </section>
      </>}
      {screen === 'history' && <><Metrics values={[[ 'งานรับ–ส่งทั้งหมด', bookings.length], ['เสร็จสิ้น', bookings.filter(b => b.status === 'completed').length], ['ไม่อนุมัติ', bookings.filter(b => b.status === 'rejected').length]]} /><section className="admin-panel"><h2>ประวัติการเดินรถและรับ–ส่งผู้ป่วย</h2><p className="admin-muted">กรองข้อมูลตามช่วงวันที่ รถรับส่ง คนขับ หรือสถานะงาน</p>
        <div className="admin-filters admin-history-filters"><AdminField label="ตั้งแต่วันที่"><input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></AdminField><AdminField label="ถึงวันที่"><input type="date" min={from || undefined} value={to} onChange={e => setTo(e.target.value)} /></AdminField><AdminField label="รถรับส่ง"><select value={vehicle} onChange={e => setVehicle(e.target.value)}><option value="">รถทุกคัน</option>{[...new Set([...state.vehicles.map(v => v.id), ...bookings.flatMap(b => b.vehicleId ? [b.vehicleId] : [])])].map(id => <option key={id} value={id}>{vehicleLabel(id)}</option>)}</select></AdminField><AdminField label="คนขับ"><select value={driver} onChange={e => setDriver(e.target.value)}><option value="">คนขับทุกคน</option>{[...new Set([...state.drivers.map(d => d.id), ...bookings.flatMap(b => b.driverId ? [b.driverId] : [])])].map(id => <option key={id} value={id}>{driverLabel(id)}</option>)}</select></AdminField><AdminField label="สถานะงาน"><select value={status} onChange={e => setStatus(e.target.value)}><option value="">ทุกสถานะ</option>{[['pending', 'รอตรวจสอบ'], ['approved', 'อนุมัติ / มอบหมาย'], ['in_transit', 'กำลังเดินทาง'], ['completed', 'เสร็จสิ้น'], ['rejected', 'ไม่อนุมัติ'], ['cancelled', 'ยกเลิกแล้ว']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></AdminField><AdminField label="ค้นหางาน"><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="รหัสงาน / ชื่อ / ปลายทาง" /></AdminField></div><AdminButton secondary onClick={() => { setFrom(''); setTo(''); setVehicle(''); setDriver(''); setStatus(''); setSearch('') }}>ล้างตัวกรอง</AdminButton>
        {from && to && from > to && <p role="alert" className="admin-error">วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด</p>}<Table headings={['วันที่ / เวลา', 'รหัสงาน', 'รถรับส่ง', 'คนขับ', 'ปลายทาง', 'สถานะ']} empty={!trips.length}>{trips.map(b => <tr key={b.id}><td>{dispatchDate(b.appointmentAt)} {dispatchTime(b.appointmentAt)}</td><th scope="row"><button className="admin-text-button" onClick={() => setTripId(b.id)} aria-label={`ดูรายละเอียด ${b.id}`}>{b.id}</button></th><td>{vehicleLabel(b.vehicleId)}</td><td>{driverLabel(b.driverId)}</td><td>{b.details?.hospital || 'ไม่มีข้อมูล'}</td><td>{dispatchStatus(b)}</td></tr>)}</Table></section></>}
      {screen === 'settings' && <><RecalculationPending state={state} /><Metrics values={[[ 'จองล่วงหน้า', '48 ชั่วโมง'], ['เวลาเตรียมรถ', '20 นาที'], ['ศูนย์รถ', '1 จุด']]} /><section className="admin-panel"><div className="admin-panel-heading"><div><h2>ข้อมูลการตั้งค่า</h2><p className="admin-muted">ตรวจสอบข้อมูลและเงื่อนไขการให้บริการ</p></div></div><div className="admin-tabs"><button aria-pressed={settingsTab === 'settings'} onClick={() => setSettingsTab('settings')}>การตั้งค่า</button><button aria-pressed={settingsTab === 'fixed'} onClick={() => setSettingsTab('fixed')}>เงื่อนไขคงที่</button></div>
        {settingsTab === 'fixed' ? <div className="admin-details"><p>จองล่วงหน้าอย่างน้อย 48 ชั่วโมงนับจากเวลาส่งคำขอ</p><p>เผื่อเวลาเตรียมรถ / ความปลอดภัยก่อนนัด 20 นาที</p><p>ตรวจสอบตารางรถและคนขับซ้อนกันก่อนมอบหมายทุกครั้ง</p><p>ข้อกำหนดเหล่านี้แก้ไขไม่ได้</p></div> : <Table headings={['รหัส', 'ชื่อ', 'ค่า', 'สถานะ', 'การดำเนินการ']}>{[['CFG-01', 'ตำแหน่งศูนย์รถเทศบาล', settings.center], ['CFG-02', 'พื้นที่ให้บริการ', settings.serviceArea], ['CFG-03', 'เวลาเปิดให้บริการ', `${settings.opensAt}–${settings.closesAt}`], ['CFG-04', 'เงื่อนไขการจอง', '48 ชั่วโมง / 20 นาที']].map(([id, label, value]) => <tr key={id}><th scope="row">{id}</th><td>{label}</td><td>{value}</td><td><Badge active yes="ตั้งค่าแล้ว" /></td><td><AdminButton secondary onClick={() => id === 'CFG-04' ? setSettingsTab('fixed') : openEditor({ category: 'settings', previous: settings, settingsSection: id === 'CFG-01' ? 'center' : id === 'CFG-02' ? 'serviceArea' : 'hours' })}>{id === 'CFG-04' ? 'ดูเงื่อนไข' : 'จัดการ'}</AdminButton></td></tr>)}</Table>}</section></>}
      {screen === 'audit' && <section className="admin-panel"><div className="admin-filters"><AdminField label="ค้นหากิจกรรม"><input type="search" value={search} onChange={e => setSearch(e.target.value)} /></AdminField><AdminField label="ประเภทกิจกรรม"><select value={category} onChange={e => setCategory(e.target.value)}><option value="">ทุกประเภทกิจกรรม</option>{[['accounts', 'บัญชี'], ['vehicles', 'รถ'], ['drivers', 'คนขับ'], ['settings', 'การตั้งค่า']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></AdminField></div><Table headings={['เวลา', 'ผู้ดำเนินการ', 'กิจกรรม', 'ผลลัพธ์']} empty={!auditRows.length}>{auditRows.map(e => <tr key={e.id}><td>{dispatchDate(e.at)} {dispatchTime(e.at)}</td><td>{e.actor}</td><td><button className="admin-text-button" onClick={() => setAuditId(e.id)}>{e.action} {e.recordId}</button>{e.reason && <small>{e.reason}</small>}</td><td><Badge active yes="สำเร็จ" /></td></tr>)}</Table></section>}
    <RoleSelectionLink /></main>
    {editor && <AdminForm editor={editor} state={state} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice('บันทึกข้อมูลและกิจกรรมแล้ว') }} />}
    {tripId && <BookingModal title="รายละเอียดงานรับ–ส่ง" className="admin-modal" onClose={() => setTripId(null)}>{selectedTrip ? <dl className="admin-details">{[['รหัสงาน', selectedTrip.id], ['ผู้รับบริการ', selectedTrip.patientName], ['วันนัดหมาย', `${dispatchDate(selectedTrip.appointmentAt)} ${dispatchTime(selectedTrip.appointmentAt)}`], ['รถรับส่ง', vehicleLabel(selectedTrip.vehicleId)], ['คนขับ', driverLabel(selectedTrip.driverId)], ['ปลายทาง', selectedTrip.details?.hospital || 'ไม่มีข้อมูล'], ['สถานะ', dispatchStatus(selectedTrip)], ['เหตุผล', selectedTrip.rejectionReason || '—']].map(([l, v]) => <div key={l}><dt>{l}</dt><dd>{v}</dd></div>)}{selectedTrip.schedule && <p>ออกศูนย์ {dispatchTime(selectedTrip.schedule.departureAt)} · รับ {dispatchTime(selectedTrip.schedule.pickupAt)} · ถึง รพ. {dispatchTime(selectedTrip.schedule.arrivalAt)} · เผื่อ 20 นาที</p>}{selectedTrip.driverProgress?.events.map(e => <p key={e.stage}>{driverLabels[e.stage]} · {dispatchDate(e.at)} {dispatchTime(e.at)}</p>)}</dl> : <p>ไม่พบงานนี้ในข้อมูลล่าสุด</p>}<AdminButton secondary onClick={() => setTripId(null)}>ปิดรายละเอียด</AdminButton></BookingModal>}
    {auditId && <BookingModal title="รายละเอียดกิจกรรม" className="admin-modal" onClose={() => setAuditId(null)}>{selectedEvent ? <><p>{selectedEvent.action} · {selectedEvent.recordId}</p><p>{selectedEvent.at} · {selectedEvent.actor}</p>{selectedEvent.reason && <p>เหตุผล: {selectedEvent.reason}</p>}<h3>ก่อนเปลี่ยนแปลง</h3><pre>{selectedEvent.before || 'รายการใหม่'}</pre><h3>หลังเปลี่ยนแปลง</h3><pre>{selectedEvent.after}</pre></> : <p>ไม่พบกิจกรรมนี้</p>}<AdminButton secondary onClick={() => setAuditId(null)}>ปิดรายละเอียด</AdminButton></BookingModal>}
  </div>
}
