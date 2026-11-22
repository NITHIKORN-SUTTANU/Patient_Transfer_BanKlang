import { MunicipalLogo } from '../components/MunicipalLogo'
import { ResponsiveNavigation } from '../components/ResponsiveNavigation'
import { accountRoleLabels } from '../data/actors'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { AdminButton, AdminField } from '../components/AdminForms'
import { AdminAccountForm } from '../components/AdminAccountForm'
import { AdminResourceForm } from '../components/AdminResourceForm'
import { AdminServiceSettings } from '../components/AdminServiceSettings'
import { NotificationFailures } from '../components/NotificationFailures'
import { MonthlyReportExport } from '../components/MonthlyReportExport'
import { AdminAvailability } from '../components/AdminAvailability'
import { AdminSeedDataUtility } from '../components/AdminSeedDataUtility'
import { ExecutiveAnalyticsDashboard } from '../components/ExecutiveAnalyticsDashboard'
import { PaginationControls } from '../components/PaginationControls'
import type { AdminEditor } from '../components/AdminForms'
import { BookingModal } from '../components/BookingUI'
import { useAdminData } from '../services/adminApi'
import { statusLabels } from '../services/dispatcherApi'
import { useSeedOverlay } from '../services/seedOverlay'
import { isInteractiveDemoActive } from '../services/interactiveDemo'
import { isNonTerminalBooking } from '../domain/capacity'
import type { DemoState, AdminAccount } from '../data/seed'
import { dispatchDate, dispatchTime } from '../services/dispatch'
import { driverAvailable } from '../services/resources'
import { ServiceTable } from '../components/ServiceTable'
import { ServiceSymbol } from '../components/ServiceSymbol'
import type { ServiceSymbolKind } from '../components/ServiceSymbol'
import '../booking.css'
import '../admin.css'

const navigation = [['', 'ภาพรวม'], ['accounts', 'ผู้ใช้งานและสิทธิ์'], ['vehicles', 'รถรับส่ง'], ['drivers', 'คนขับ'], ['history', 'ประวัติการรับ–ส่ง'], ['settings', 'การตั้งค่าระบบ'], ['audit', 'บันทึกกิจกรรม']]
const headers: Record<string, [string, string]> = {
  dashboard: ['ภาพรวมระบบ', 'ดูข้อมูลภาพรวมและเลือกหมวดงาน'], accounts: ['บัญชีผู้ใช้งานและสิทธิ์', 'เพิ่มบัญชี แก้ไขข้อมูล และกำหนดสิทธิ์'], vehicles: ['รถรับส่ง', 'จัดการข้อมูลและสถานะรถรับส่ง'], drivers: ['จัดการคนขับรถ', 'จัดการรายชื่อและสถานะคนขับ'], history: ['ประวัติการรับ–ส่งผู้ป่วย', 'ค้นหาและตรวจสอบงานรับ–ส่งย้อนหลังตามรถ คนขับ และวันที่'], settings: ['การตั้งค่าระบบ', 'จัดการข้อมูลพื้นที่และเวลาทำการ'], audit: ['บันทึกกิจกรรม', 'ตรวจสอบการเปลี่ยนแปลงข้อมูลและการดำเนินการของเจ้าหน้าที่'],
}
function Metrics({ values, icons = [] }: { values: [string, ReactNode][]; icons?: ServiceSymbolKind[] }) { return <div className="admin-metrics">{values.map(([label, value], index) => <article key={label}><p className={icons[index] ? 'admin-metric-label' : undefined}>{icons[index] && <span className="admin-dashboard-icon" aria-hidden="true"><ServiceSymbol kind={icons[index]} /></span>}{label}</p><strong>{value}</strong></article>)}</div> }
function Table({ headings, children, empty, className = '' }: { headings: string[]; children: ReactNode; empty?: boolean; className?: string }) {
  return <ServiceTable headings={headings} className={className}>{empty ? <tr><td colSpan={headings.length} className="admin-empty">ไม่พบข้อมูลที่ตรงกับเงื่อนไข</td></tr> : children}</ServiceTable>
}
function Badge({ active, yes = 'ใช้งานอยู่', no = 'ระงับการใช้งาน' }: { active: boolean; yes?: string; no?: string }) { return <span className={`admin-badge ${active ? '' : 'inactive'}`}>{active ? yes : no}</span> }
function readDemoActiveTrips(kind: 'vehicles' | 'drivers', resourceId: string): number {
  if (!isInteractiveDemoActive()) return 0
  try {
    const raw = localStorage.getItem('ban-klang-transit:interactive-demo-db:v1')
    if (!raw) return 0
    const parsed = JSON.parse(raw) as { bookings?: { status?: string; vehicleId?: string | null; driverId?: string | null }[] }
    if (!Array.isArray(parsed.bookings)) return 0
    return parsed.bookings.filter(b => {
      const st = b.status ?? ''
      if (['COMPLETED', 'CANCELLED', 'REJECTED', 'ABORTED'].includes(st)) return false
      return kind === 'vehicles' ? b.vehicleId === resourceId : b.driverId === resourceId
    }).length
  } catch {
    return 0
  }
}
export function AdminPage() {
  const remote = useAdminData()
  const state: DemoState = remote.data?.state ?? { version: 1, selectedActor: null, bookings: [], vehicles: [], drivers: [] }
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const screen = pathname.replace(/\/$/, '').split('/')[2] || 'dashboard'
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [category, setCategory] = useState('')
  const [editor, setEditor] = useState<AdminEditor | null>(null)
  const [windowEditor, setWindowEditor] = useState<{kind: 'vehicles' | 'drivers'; id: string} | null>(null)
  const [auditId, setAuditId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const overlay = useSeedOverlay()
  const filterKey = `${pathname}|${search}|${status}|${role}|${category}`
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 })
  const tablePage = pageState.key === filterKey ? pageState.page : 1
  const setTablePage = (nextPage: number) => setPageState({ key: filterKey, page: nextPage })
  const main = useRef<HTMLElement>(null)
  useEffect(() => { window.scrollTo(0, 0); main.current?.querySelector('h1')?.focus() }, [pathname])
  const accounts = state.accounts || []
  const events = state.auditEvents || []
  const matches = (...values: (string | undefined)[]) => values.join(' ').toLowerCase().includes(search.trim().toLowerCase())
  const statusMatch = (active: boolean) => !status || String(active) === status
  const accountRows = accounts.filter(a => matches(a.id, a.name, a.username) && statusMatch(a.active) && (!role || role === a.role))
  const vehicleRows = state.vehicles.filter(v => matches(v.id, v.label, v.vehicleType, v.support) && statusMatch(v.active))
  const driverRows = state.drivers.filter(d => matches(d.id, d.name, d.phone) && statusMatch(driverAvailable(state, d)))
  const auditRows = events.filter(e => matches(e.recordId, e.action, e.actor, e.reason) && (!category || category === e.category))
  const ADMIN_PAGE_SIZE = 50
  const pagedAccountRows = accountRows.slice((tablePage - 1) * ADMIN_PAGE_SIZE, tablePage * ADMIN_PAGE_SIZE)
  const pagedVehicleRows = vehicleRows.slice((tablePage - 1) * ADMIN_PAGE_SIZE, tablePage * ADMIN_PAGE_SIZE)
  const pagedDriverRows = driverRows.slice((tablePage - 1) * ADMIN_PAGE_SIZE, tablePage * ADMIN_PAGE_SIZE)
  const pagedAuditRows = auditRows.slice((tablePage - 1) * ADMIN_PAGE_SIZE, tablePage * ADMIN_PAGE_SIZE)
  const summaryStatuses = (() => {
    const base = remote.data?.summary.statuses ?? []
    if (isInteractiveDemoActive() || !overlay.active || overlay.bookings.length === 0) return base
    const counts = new Map<string, number>()
    for (const row of base) counts.set(row.status, row.count)
    for (const b of overlay.bookings) {
      const code = b.apiStatus || (
        b.status === 'pending' ? 'REQUESTED'
        : b.status === 'completed' ? 'COMPLETED'
        : b.status === 'cancelled' ? 'CANCELLED'
        : b.status === 'rejected' ? 'REJECTED'
        : b.status === 'in_transit' ? 'IN_TRANSIT'
        : b.schedule ? 'ASSIGNED' : 'APPROVED'
      )
      counts.set(code, (counts.get(code) ?? 0) + 1)
    }
    return Array.from(counts.entries()).map(([status, count]) => ({ status, count }))
  })()
  const selectedEvent = events.find(e => e.id === auditId)
  function openEditor(value: AdminEditor) {
    if (value.category === 'settings') { setNotice('ข้อมูลส่วนนี้อ่านได้เท่านั้น การแก้ไขจะเชื่อมต่อในขั้นถัดไป'); return }
    setNotice(''); setEditor(value)
  }
  function go(path: string) { setSearch(''); setStatus(''); setRole(''); setNotice(''); setEditor(null); setWindowEditor(null); setAuditId(null); navigate(`/admin${path ? `/${path}` : ''}`) }
  function saved() { setEditor(null); setWindowEditor(null); setNotice('บันทึกข้อมูลและกิจกรรมแล้ว'); remote.reload() }
  const windowResource = windowEditor ? remote.data?.catalog[windowEditor.kind].find(resource => resource.id === windowEditor.id) : undefined
  const editorId = editor?.previous && 'id' in editor.previous ? editor.previous.id : undefined
  const editingResource = editor?.category === 'vehicles' || editor?.category === 'drivers' ? remote.data?.catalog[editor.category].find(resource => resource.id === editorId) : undefined
  const editingActiveTrips = (() => {
    if (!editingResource || (editor?.category !== 'vehicles' && editor?.category !== 'drivers')) return 0
    const overlayCount = overlay.active
      ? overlay.bookings.filter(b => isNonTerminalBooking(b) && (editor.category === 'vehicles' ? b.vehicleId === editingResource.id : b.driverId === editingResource.id)).length
      : 0
    const demoCount = readDemoActiveTrips(editor.category, editingResource.id)
    return Math.max(overlayCount, demoCount)
  })()
  function driverShiftSummary(driverId: string) {
    const driverWindows = (remote.data?.windows ?? []).filter(w => w.driverId === driverId)
    if (!driverWindows.length) return <span className="admin-shift-empty">ยังไม่ตั้งช่วงเวลา</span>
    const first = driverWindows[0]
    return <span className="admin-shift-summary">{dispatchTime(first.startsAt)}–{dispatchTime(first.endsAt)} น.{driverWindows.length > 1 ? ` (+${driverWindows.length - 1})` : ''}</span>
  }
  function searchFilter() { return <div className="admin-filters"><AdminField label="ค้นหา"><input type="search" placeholder="ค้นหารหัสหรือชื่อ" value={search} onChange={e => setSearch(e.target.value)} /></AdminField><AdminField label="สถานะ"><select value={status} onChange={e => setStatus(e.target.value)}><option value="">ทุกสถานะ</option><option value="true">ใช้งานอยู่ / พร้อมใช้งาน</option><option value="false">ระงับ / ไม่พร้อมใช้งาน</option></select></AdminField>{screen === 'accounts' && <AdminField label="บทบาท"><select value={role} onChange={e => setRole(e.target.value)}><option value="">ทุกบทบาท</option>{(['Dispatcher', 'Driver', 'Admin'] as const).map(r => <option key={r} value={r}>{accountRoleLabels[r]}</option>)}</select></AdminField>}</div> }
  if (!headers[screen]) return <Navigate to="/admin" replace />
  return <div className={`admin-shell admin-screen-${screen} ${sidebarCollapsed ? 'admin-sidebar-collapsed' : ''}`}><a className="skip-link" href="#admin-main">ข้ามไปยังเนื้อหา</a>
    <aside id="admin-sidebar" className="dispatch-sidebar admin-sidebar"><div className="dispatch-sidebar-tools"><MunicipalLogo /></div><div className="admin-brand"><strong>ระบบรับส่งผู้ป่วย</strong><p>ผู้ดูแลระบบ</p></div><ResponsiveNavigation id="admin-navigation" label="เมนูผู้ดูแลระบบ">{navigation.map(([path, label]) => <Link key={path} aria-label={label} title={label} aria-current={(path || 'dashboard') === screen ? 'page' : undefined} to={`/admin${path ? `/${path}` : ''}`} className={(path || 'dashboard') === screen ? 'active' : ''} onClick={e => { e.preventDefault(); go(path) }}><ServiceSymbol kind={path === 'accounts' ? 'people' : path === 'vehicles' ? 'vehicle' : path === 'drivers' ? 'person' : path === 'history' ? 'history' : path === 'settings' ? 'settings' : path === 'audit' ? 'shield' : 'home'} /><span>{label}</span></Link>)}</ResponsiveNavigation><button type="button" className="dispatch-sidebar-toggle" aria-label={sidebarCollapsed ? 'ขยายเมนูด้านข้าง' : 'ย่อเมนูด้านข้าง'} title={sidebarCollapsed ? 'ขยายเมนูด้านข้าง' : 'ย่อเมนูด้านข้าง'} aria-expanded={!sidebarCollapsed} aria-controls="admin-sidebar" onClick={() => setSidebarCollapsed(value => !value)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={sidebarCollapsed ? 'm5 6 6 6-6 6m8-12 6 6-6 6' : 'm11 6-6 6 6 6m8-12-6 6 6 6'} /></svg></button></aside>
    <main tabIndex={-1} id="admin-main" ref={main}><header className="admin-heading"><div className="admin-heading-copy"><h1 tabIndex={-1}>{headers[screen][0]}</h1><p>{headers[screen][1]}</p></div><AdminButton secondary className="admin-refresh-btn" disabled={remote.loading} aria-busy={remote.loading} onClick={remote.reload}>{remote.loading ? 'กำลังโหลด…' : <><span aria-hidden="true">↻</span> โหลดข้อมูลล่าสุด</>}</AdminButton></header>
      <NotificationFailures admin key={`notif-${screen}`} />{screen === 'history' && <MonthlyReportExport admin defaultOpen />}
      {remote.loading && <p role="status">กำลังโหลดข้อมูล…</p>}{remote.error && <p role="alert" className="admin-error">{remote.error}</p>}
      {notice && <p role="status" className="admin-notice">{notice}</p>}
      {['vehicles','drivers'].includes(screen) && <p className="admin-muted">การเปิดใช้งานและช่วงเวลาปฏิบัติงานต้องผ่านการตรวจสอบสถานะงานและความพร้อมจากระบบก่อนมอบหมาย</p>}
      <div hidden={!remote.data || remote.loading}>
      {screen === 'dashboard' && <>
        <Metrics icons={['people', 'vehicle', 'person']} values={[[ 'บัญชีผู้ใช้งาน', accounts.length], ['รถในระบบ', state.vehicles.length], ['คนขับ', state.drivers.length]]} />
        <section className="admin-panel"><h2>งานดูแลระบบ</h2><p className="admin-muted">เลือกหมวดงานที่ต้องการจัดการ</p><Table headings={['หมวด', 'รายละเอียด', 'ดำเนินการ']}>{[['ผู้ใช้งานและสิทธิ์', 'จัดการบัญชีและสิทธิ์', 'จัดการผู้ใช้งาน', 'accounts'], ['รถรับส่ง', 'จัดการข้อมูลและสถานะรถรับส่ง', 'จัดการรถ', 'vehicles'], ['คนขับ', 'จัดการรายชื่อและสถานะคนขับ', 'จัดการคนขับ', 'drivers'], ['ตั้งค่าการให้บริการ', 'ตำแหน่งศูนย์รถและพื้นที่บริการ', 'ดูการตั้งค่า', 'settings'], ['ประวัติการทำรายการ', 'ตรวจสอบกิจกรรมและการเปลี่ยนแปลง', 'ดูประวัติการทำรายการ', 'audit']].map(([label, description, action, path]) => <tr key={path}><th scope="row"><span className="admin-dashboard-category"><span className="admin-dashboard-icon" aria-hidden="true"><ServiceSymbol kind={path === 'accounts' ? 'people' : path === 'vehicles' ? 'vehicle' : path === 'drivers' ? 'person' : path === 'settings' ? 'settings' : 'history'} /></span><span>{label}</span></span></th><td>{description}</td><td><AdminButton secondary onClick={() => go(path)}>{action}</AdminButton></td></tr>)}</Table></section>
        <ExecutiveAnalyticsDashboard summaryStatuses={summaryStatuses} totalVehicles={state.vehicles.length} activeVehicles={state.vehicles.filter(v => v.active).length} onLoadedSeed={remote.reload} />
        <AdminSeedDataUtility onChanged={remote.reload} />
      </>}
      {screen === 'accounts' && <><Metrics values={[[ 'บัญชีทั้งหมด', accounts.length], ['ใช้งานอยู่', accounts.filter(a => a.active).length], ['ระงับการใช้งาน', accounts.filter(a => !a.active).length]]} /><section className="admin-panel"><div className="admin-panel-heading"><div><h2>รายชื่อผู้ใช้งาน</h2><p className="admin-muted">ค้นหาบัญชี เลือกดูสิทธิ์ และจัดการสถานะ</p></div><AdminButton onClick={() => openEditor({ category: 'accounts' })}>+ เพิ่มบัญชี</AdminButton></div>{searchFilter()}<Table className="admin-accounts-table" headings={['รหัส', 'ชื่อ', 'บทบาท', 'สถานะ', 'การดำเนินการ']} empty={!accountRows.length}>{pagedAccountRows.map(a => <tr key={a.id}><th scope="row">{a.id}</th><td>{a.name}<small>{a.username}</small></td><td>{accountRoleLabels[a.role]}</td><td><Badge active={a.active} /></td><td><div className="admin-row-actions"><AdminButton secondary onClick={() => openEditor({ category: 'accounts', previous: a })}>จัดการบัญชี</AdminButton></div></td></tr>)}</Table><PaginationControls totalItems={accountRows.length} pageSize={ADMIN_PAGE_SIZE} page={tablePage} onPageChange={setTablePage} label="แบ่งหน้าตารางผู้ใช้งาน" /></section></>}
      {(screen === 'vehicles' || screen === 'drivers') && <>
        {screen === 'vehicles' && <Metrics values={[[ 'รถทั้งหมด', state.vehicles.length], ['เปิดใช้งาน', state.vehicles.filter(v => v.active).length], ['ปิดใช้งาน', state.vehicles.filter(v => !v.active).length]]} />}
        {screen === 'drivers' && <Metrics values={[[ 'คนขับทั้งหมด', state.drivers.length], ['พร้อมปฏิบัติงาน', state.drivers.filter(d => driverAvailable(state, d)).length], ['ปิดรับงาน / ไม่พร้อม', state.drivers.filter(d => !driverAvailable(state, d)).length]]} />}
        <section className="admin-panel"><div className="admin-panel-heading"><div><h2>{screen === 'vehicles' ? 'รายการรถรับส่ง' : 'รายชื่อคนขับ'}</h2><p className="admin-muted">จัดการข้อมูลและสถานะการใช้งาน</p></div><AdminButton onClick={() => openEditor({ category: screen })}>{screen === 'vehicles' ? '+ เพิ่มรถ' : '+ เพิ่มคนขับ'}</AdminButton></div>{searchFilter()}
          {screen === 'vehicles' ? <Table className="admin-vehicles-table" headings={['รหัส', 'ชื่อ', 'ประเภท / รองรับ', 'สถานะ', 'การดำเนินการ']} empty={!vehicleRows.length}>{pagedVehicleRows.map(v => <tr key={v.id}><th scope="row">{v.id}</th><td>{v.label}</td><td>{v.vehicleType || 'ไม่ได้ระบุ'}<small>{v.support}</small></td><td><Badge active={v.active} yes="เปิดใช้งาน" no="ปิดใช้งาน" /></td><td><div className="admin-row-actions"><AdminButton secondary onClick={() => openEditor({ category: 'vehicles', previous: v })}>จัดการรถ</AdminButton><AdminButton secondary onClick={() => setWindowEditor({ kind: 'vehicles', id: v.id })}>ช่วงเวลารถ</AdminButton></div></td></tr>)}</Table> : <Table className="admin-drivers-table" headings={['รหัส', 'ชื่อคนขับ', 'ช่วงเวลาปฏิบัติงาน', 'สถานะบัญชี', 'สถานะปฏิบัติงาน', 'การดำเนินการ']} empty={!driverRows.length}>{pagedDriverRows.map(d => { const linkedAccount = d.accountId ? accounts.find(a => a.id === d.accountId && a.role === 'Driver') : undefined; const available = driverAvailable(state, d); return <tr key={d.id}><th scope="row">{d.id}</th><td>{d.name}<small>{d.phone}</small></td><td>{driverShiftSummary(d.id)}</td><td>{d.accountId ? <span className={`admin-status-pill ${linkedAccount?.active ? 'account-ok' : 'danger'}`}>{linkedAccount?.active ? 'บัญชีปกติ' : 'ระงับบัญชี'}</span> : <span className="admin-status-pill neutral">ยังไม่ผูกบัญชี</span>}</td><td><span className={`admin-status-pill ${available ? 'ready' : 'off'}`}>{available ? 'พร้อมปฏิบัติงาน' : 'ปิดรับงาน'}</span></td><td><div className="admin-row-actions"><AdminButton secondary onClick={() => openEditor({ category: 'drivers', previous: d })}>จัดการคนขับ</AdminButton><AdminButton secondary onClick={() => setWindowEditor({ kind: 'drivers', id: d.id })}>ช่วงเวลาคนขับ</AdminButton></div></td></tr> })}</Table>}
          <PaginationControls totalItems={screen === 'vehicles' ? vehicleRows.length : driverRows.length} pageSize={ADMIN_PAGE_SIZE} page={tablePage} onPageChange={setTablePage} label={screen === 'vehicles' ? 'แบ่งหน้าตารางรถรับส่ง' : 'แบ่งหน้าตารางคนขับ'} />
          <p className="admin-muted admin-footnote">ตรวจสอบตารางรถและคนขับก่อนมอบหมายงาน</p>
        </section>
      </>}
      {screen === 'history' && <><Metrics values={[[ 'งานรับ–ส่งทั้งหมด', summaryStatuses.reduce((sum, row) => sum + row.count, 0)], ['เสร็จสิ้น', summaryStatuses.find(row => row.status === 'COMPLETED')?.count ?? 0], ['ยุติการเดินทาง', summaryStatuses.find(row => row.status === 'ABORTED')?.count ?? 0]]} /><section className="admin-panel"><h2>ประวัติการเดินรถแบบสรุป</h2><p className="admin-muted">สิทธิ์ผู้ดูแลระบบแสดงเฉพาะยอดรวม ไม่มีชื่อผู้ป่วย เบอร์ติดต่อ จุดรับ หรือรายละเอียดรายงาน</p><Table headings={['สถานะ', 'จำนวน']} empty={!summaryStatuses.length}>{summaryStatuses.map(row => <tr key={row.status}><th scope="row">{statusLabels[row.status] ?? row.status}</th><td>{row.count}</td></tr>)}</Table><div className="admin-history-link-note"><span className="admin-muted">ต้องการดูกราฟวิเคราะห์เชิงนโยบาย 12 หมู่บ้าน หรือจัดการชุดข้อมูลจำลอง?</span><AdminButton secondary onClick={() => go('')}>ไปหน้าภาพรวมระบบ →</AdminButton></div></section></>}
      {screen === 'settings' && <><Metrics values={[[ 'จองล่วงหน้า', '48 ชั่วโมง'], ['เวลาเตรียมรถ', '20 นาที'], ['ศูนย์รถ', '1 จุด']]} /><AdminServiceSettings onChanged={remote.reload} /></>}
      {screen === 'audit' && <section className="admin-panel"><div className="admin-filters"><AdminField label="ค้นหากิจกรรม"><input type="search" value={search} onChange={e => setSearch(e.target.value)} /></AdminField><AdminField label="ประเภทกิจกรรม"><select value={category} onChange={e => setCategory(e.target.value)}><option value="">ทุกประเภทกิจกรรม</option>{[['accounts', 'บัญชี'], ['vehicles', 'รถ'], ['drivers', 'คนขับ'], ['settings', 'การตั้งค่า']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></AdminField></div><Table headings={['เวลา', 'ผู้ดำเนินการ', 'กิจกรรม', 'ผลลัพธ์']} empty={!auditRows.length}>{pagedAuditRows.map(e => <tr key={e.id}><td>{dispatchDate(e.at)} {dispatchTime(e.at)}</td><td>{e.actor}</td><td><button className="admin-text-button" onClick={() => setAuditId(e.id)}>{e.action} {e.recordId}</button>{e.reason && <small>{e.reason}</small>}</td><td><Badge active yes="สำเร็จ" /></td></tr>)}</Table><PaginationControls totalItems={auditRows.length} pageSize={ADMIN_PAGE_SIZE} page={tablePage} onPageChange={setTablePage} label="แบ่งหน้าบันทึกกิจกรรม" /></section>}
      </div><Link className="role-selection-shortcut" to="/staff/login" aria-label="บัญชีเจ้าหน้าที่ / ออกจากระบบ" title="บัญชีเจ้าหน้าที่ / ออกจากระบบ"><ServiceSymbol kind="people" /></Link></main>
    {editor?.category === 'accounts' && <AdminAccountForm previous={editor.previous as AdminAccount | undefined} accounts={accounts} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice('บันทึกข้อมูลและกิจกรรมแล้ว'); remote.reload() }} />}
    {(editor?.category === 'vehicles' || editor?.category === 'drivers') && remote.data && <AdminResourceForm kind={editor.category} previous={editingResource} catalog={remote.data.catalog} accounts={accounts} activeTripCount={editingActiveTrips} onGoAccounts={() => { setEditor(null); go('accounts') }} onClose={() => setEditor(null)} onSaved={saved} />}
    {windowEditor && windowResource && remote.data && <AdminAvailability kind={windowEditor.kind} resource={windowResource} windows={remote.data.windows} onClose={() => setWindowEditor(null)} onSaved={saved} />}
    {auditId && <BookingModal title="รายละเอียดกิจกรรม" className="admin-modal" onClose={() => setAuditId(null)}>{selectedEvent ? <><p>{selectedEvent.action} · {selectedEvent.recordId}</p><p>{selectedEvent.at} · {selectedEvent.actor}</p>{selectedEvent.reason && <p>เหตุผล: {selectedEvent.reason}</p>}<h3>ก่อนเปลี่ยนแปลง</h3><pre>{selectedEvent.before || 'รายการใหม่'}</pre><h3>หลังเปลี่ยนแปลง</h3><pre>{selectedEvent.after}</pre></> : <p>ไม่พบกิจกรรมนี้</p>}<AdminButton secondary onClick={() => setAuditId(null)}>ปิดรายละเอียด</AdminButton></BookingModal>}
  </div>
}
