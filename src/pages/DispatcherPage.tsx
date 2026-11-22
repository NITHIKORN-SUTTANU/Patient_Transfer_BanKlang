import { MunicipalLogo } from '../components/MunicipalLogo'
import { ResponsiveNavigation } from '../components/ResponsiveNavigation'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import type { Booking } from '../data/seed'
import { bangkokDate, formatPickupSummary } from '../services/booking'
import { dispatchDate, dispatchTime } from '../services/dispatch'
import { ScheduleSummary } from '../components/DispatchAssignment'
import { ApiDispatchAssignment } from '../components/ApiDispatchAssignment'
import { NotificationFailures } from '../components/NotificationFailures'
import {DispatchReview} from '../components/DispatchReview'
import {CapacityEvidence} from '../components/CapacityEvidence'
import { MonthlyReportExport } from '../components/MonthlyReportExport'
import {DispatcherAlerts} from '../components/DispatcherAlerts'
import {DailyManifestExport} from '../components/DailyManifestExport'
import { DispatcherOperations, ResourceReadiness } from '../components/DispatcherOperations'
import { bookingCommand, dispatcherError, statusLabels, useDispatcherData } from '../services/dispatcherApi'
import { createSeedState } from '../data/seed'

import { DispatcherPickupMap } from '../components/DispatcherPickupMap'
import { DispatchButton, DispatchModal } from '../components/DispatcherUI'
import { ServiceTable } from '../components/ServiceTable'
import { ServiceSymbol } from '../components/ServiceSymbol'
import { PaginationControls } from '../components/PaginationControls'
import { VehicleTimelineView } from '../components/VehicleTimelineView'
import { DailyDispatchMapView } from '../components/DailyDispatchMapView'
import {
  bangkokDateFromMs,
  checkCitizenSlotCapacity,
  computeBackwardBlockedWindow,
  isNonTerminalBooking,
  normalizeMobilityCode,
  parseVehicleCapabilities,
  type CapacityBookingInput,
  type CapacityVehicleInput,
} from '../domain/capacity'
import '../booking.css'
import '../dispatcher.css'

const nav = [{ path: '/dispatcher', label: 'แดชบอร์ดงานรับส่ง' }, { path: '/dispatcher/assignment', label: 'จัดตารางและมอบหมาย' }, { path: '/dispatcher/tracking', label: 'ติดตามงานรับส่ง' }]
const headers = { dashboard: ['ภาพรวมงานรับส่ง', 'ตรวจสอบคำขอ จัดรถ และติดตามการเดินทาง'], assignment: ['จัดรถและคนขับ', 'เลือกงาน ตรวจสอบเวลาและทรัพยากร ก่อนยืนยันการมอบหมาย'], tracking: ['ติดตามงานรับส่ง', 'ดูความคืบหน้าและรายละเอียดของงานที่มอบหมายแล้ว'] }
const dispatchStatus = (booking: Booking) => statusLabels[booking.apiStatus || ''] || booking.apiStatus || 'ไม่ทราบสถานะ'
export function DispatcherPage() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const screen = pathname.replace(/\/$/, '').split('/')[2] || 'dashboard'
  const remote = useDispatcherData(params.get('booking') ?? undefined)
  const state = remote.data?.state ?? createSeedState()
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [rejectionKind,setRejectionKind]=useState<'other'|'capacity'>('other')
  const [capacityCheckId,setCapacityCheckId]=useState<string|null>(null)
  const [search, setSearch] = useState('')
  const [date, setDate] = useState('')
  const [trackingScope, setTrackingScope] = useState<'today' | 'all' | 'incidents'>('all')
  const [filter, setFilter] = useState('')
  const [queuePage, setQueuePage] = useState(1)
  const [waitingPage, setWaitingPage] = useState(1)
  const monitoringFilterKey = `${search}|${date}|${trackingScope}|${filter}`
  const [monitoringPageState, setMonitoringPageState] = useState({ key: monitoringFilterKey, page: 1 })
  const monitoringPage = monitoringPageState.key === monitoringFilterKey ? monitoringPageState.page : 1
  const setMonitoringPage = (nextPage: number) => setMonitoringPageState({ key: monitoringFilterKey, page: nextPage })
  const [dashboardView, setDashboardView] = useState<'board' | 'map'>('board')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [fleetMatrixExpanded, setFleetMatrixExpanded] = useState(false)
  const fleetRailRef = useRef<HTMLDivElement>(null)
  const trackingSectionRef = useRef<HTMLElement>(null)
  const [readinessFeedback, setReadinessFeedback] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const main = useRef<HTMLElement>(null)
  function scrollToTrackingTop() {
    requestAnimationFrame(() => {
      const el = trackingSectionRef.current
      if (!el) return
      const wrap = el.querySelector<HTMLElement>('.service-table-wrap')
      if (wrap) wrap.scrollTop = 0
      const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    })
  }
  const reloadRef = useRef(remote.silentReload)
  useEffect(() => { reloadRef.current = remote.silentReload }, [remote.silentReload])
  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timeout)
  }, [notice])
  useEffect(() => {
    if (!readinessFeedback) return
    const timeout = window.setTimeout(() => setReadinessFeedback(''), 10000)
    return () => window.clearTimeout(timeout)
  }, [readinessFeedback])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    if (window.location.search.includes('focus=readiness')) return
    window.scrollTo(0, 0)
    main.current?.querySelector<HTMLHeadingElement>('h1')?.focus()
  }, [pathname])
  const today = bangkokDate(now)
  const queue = state.bookings.filter(b => b.status === 'pending')
    .sort((a, b) => Date.parse(a.appointmentAt) - Date.parse(b.appointmentAt) || a.id.localeCompare(b.id))
  const waiting = state.bookings.filter(b => b.status === 'approved' && !b.schedule)
    .sort((a, b) => Date.parse(a.appointmentAt) - Date.parse(b.appointmentAt) || a.id.localeCompare(b.id))
  const assigned = state.bookings.filter(b => !['REQUESTED', 'APPROVED', 'SCHEDULED', 'REJECTED'].includes(b.apiStatus || ''))
  const isActiveIncident = (b: Booking) => Boolean((b.incidentOpen || b.resourceHold) && !['COMPLETED', 'CANCELLED', 'REJECTED', 'ABORTED'].includes(b.apiStatus || ''))
  const activeIncidentBookings = state.bookings
    .filter(isActiveIncident)
    .sort((a, b) => Number(Boolean(b.incidentOpen)) - Number(Boolean(a.incidentOpen)) || Date.parse(a.schedule?.pickupAt || a.appointmentAt) - Date.parse(b.schedule?.pickupAt || b.appointmentAt))
  const inProgressTripsCount = assigned.filter(b => b.status === 'in_transit' || (b.apiStatus === 'ASSIGNED' && Boolean(b.startedAt))).length
  const todaysJobs = assigned.filter(b => bangkokDate(Date.parse((b.schedule?.pickupAt || b.appointmentAt))) === today)
  const selectedId = params.get('booking')
  const selected = selectedId ? waiting.find(b => b.id === selectedId) : waiting[0]
  const modalBooking = state.bookings.find(b => b.id === selectedId)
  const dialog = params.get('dialog')
  useEffect(() => {
    if (busy || dialog) return
    const timer = window.setInterval(() => {
      if (!submitting.current && document.visibilityState === 'visible') {
        reloadRef.current()
      }
    }, 25_000)
    return () => window.clearInterval(timer)
  }, [busy, dialog])
  const previousDialog = useRef(dialog)
  useLayoutEffect(() => {
    if (dialog === 'approve') document.getElementById('approval-back')?.focus()
    else if (dialog === 'details' && previousDialog.current === 'approve') document.getElementById('approval-start')?.focus()
    previousDialog.current = dialog
  }, [dialog])
  const closeModal = () => { if (submitting.current) return; setError(''); setParams(screen === 'assignment' && selectedId ? { booking: selectedId } : {}, { replace: true }) }
  function openDetails(b: Booking) { setError(''); setReason(''); setParams({ booking: b.id, dialog: screen === 'tracking' ? 'tracking' : 'details' }) }
  function openDecision(decision: 'approve' | 'reject') { if(submitting.current)return; setError('');setCapacityCheckId(null);setRejectionKind('other'); setParams({ booking: selectedId!, dialog: decision }, { replace: true }) }
  async function decide(decision: 'approved' | 'rejected') {
    if (!modalBooking || submitting.current || remote.loading) return
    if (decision === 'rejected' && !reason.trim()) { setError('กรุณาระบุเหตุผลการปฏิเสธ'); return }
    if(decision==='rejected'&&rejectionKind==='capacity'&&!capacityCheckId){setError('กรุณาบันทึกหลักฐานกำลังรถที่เป็นปัจจุบันก่อนปฏิเสธ');return}
    submitting.current = true; setBusy(true); setError('')
    try {
      await bookingCommand(modalBooking, decision === 'approved' ? { type: 'APPROVE' } : { type: 'REJECT', reason: reason.trim(),rejectionKind,...(rejectionKind==='capacity'?{capacityCheckId}:{}) })
      submitting.current = false; closeModal(); remote.reload(); setNotice(decision === 'approved' ? `อนุมัติคำขอ ${modalBooking.id} แล้ว กรุณาจัดรถและคนขับ` : `ปฏิเสธคำขอ ${modalBooking.id} แล้ว`)
    }
    catch (e) { setError(dispatcherError(e)); if (decision === 'rejected') requestAnimationFrame(() => document.getElementById('rejection-reason')?.focus()) }
    finally { submitting.current = false; setBusy(false) }
  }
  async function quickApprove(b: Booking, goAssign = false) {
    if (submitting.current || remote.loading || b.status !== 'pending') return
    submitting.current = true; setBusy(true); setError('')
    try {
      await bookingCommand(b, { type: 'APPROVE' })
      submitting.current = false
      remote.reload()
      if (goAssign) {
        setNotice(`อนุมัติคำขอ ${b.id} แล้ว กำลังไปยังหน้าจัดรถ`)
        navigate(`/dispatcher/assignment?booking=${encodeURIComponent(b.id)}`)
      } else {
        setNotice(`อนุมัติคำขอ ${b.id} แล้ว กรุณาจัดรถและคนขับ`)
      }
    } catch (e) {
      setError(dispatcherError(e))
    } finally {
      submitting.current = false; setBusy(false)
    }
  }
  function rowAction(b: Booking, index: number) {
    if (b.status === 'pending') {
      return (
        <div className="dispatch-row-actions">
          <DispatchButton secondary={index !== 0} onClick={() => openDetails(b)}>ดูรายละเอียด →</DispatchButton>
          <button
            type="button"
            className="dispatch-quick-approve-btn"
            disabled={busy || remote.loading}
            aria-busy={busy}
            onClick={() => void quickApprove(b)}
          >
            อนุมัติทันที
          </button>
        </div>
      )
    }
    return b.status === 'approved' && !b.schedule
      ? <DispatchButton secondary onClick={() => navigate(`/dispatcher/assignment?booking=${encodeURIComponent(b.id)}`)}>จัดรถและคนขับ →</DispatchButton>
      : <DispatchButton secondary={index !== 0} onClick={() => openDetails(b)}>ดูรายละเอียด →</DispatchButton>
  }
  const effectiveTrackingScope = trackingScope === 'incidents' && activeIncidentBookings.length === 0 ? 'all' : trackingScope
  const monitoring = assigned.filter(b => {
    const needle = search.trim().toLocaleLowerCase()
    const driver = state.drivers.find(d => d.id === b.driverId)?.name || ''
    const pickupDay = bangkokDate(Date.parse((b.schedule?.pickupAt || b.appointmentAt)))
    const matchesScope = effectiveTrackingScope === 'incidents'
      ? isActiveIncident(b)
      : date
      ? pickupDay === date
      : effectiveTrackingScope === 'today'
      ? pickupDay === today
      : true
    return matchesScope && (!filter || b.apiStatus === filter) && (!needle || `${b.id} ${b.patientName} ${driver}`.toLocaleLowerCase().includes(needle))
  }).sort((a, b) => {
    const incA = isActiveIncident(a) ? 0 : 1
    const incB = isActiveIncident(b) ? 0 : 1
    if (incA !== incB) return incA - incB
    const dayA = bangkokDate(Date.parse((a.schedule?.pickupAt || a.appointmentAt)))
    const dayB = bangkokDate(Date.parse((b.schedule?.pickupAt || b.appointmentAt)))
    if (dayA !== dayB) return dayA === today ? -1 : dayB === today ? 1 : dayA.localeCompare(dayB)
    const priority = { in_transit: 0, approved: 1, completed: 2, cancelled: 3, pending: 4, rejected: 4 }
    return priority[a.status] - priority[b.status] || Date.parse((a.schedule?.pickupAt || a.appointmentAt)) - Date.parse((b.schedule?.pickupAt || b.appointmentAt)) || a.id.localeCompare(b.id)
  })
  const DISPATCHER_PAGE_SIZE = 50
  const pagedQueue = queue.slice((queuePage - 1) * DISPATCHER_PAGE_SIZE, queuePage * DISPATCHER_PAGE_SIZE)
  const pagedWaiting = waiting.slice((waitingPage - 1) * DISPATCHER_PAGE_SIZE, waitingPage * DISPATCHER_PAGE_SIZE)
  const pagedMonitoring = monitoring.slice((monitoringPage - 1) * DISPATCHER_PAGE_SIZE, monitoringPage * DISPATCHER_PAGE_SIZE)

  // Compute compact fleet capacity & per-date conflict lookup once for rendered rows.
  const fleetVehiclesForCap: CapacityVehicleInput[] = remote.data?.catalog.vehicles?.length
    ? remote.data.catalog.vehicles.map(v => ({ ...v, label: `${v.name} · ${v.plate}` }))
    : state.vehicles
  const totalFleetCount = fleetVehiclesForCap.length
  const activeFleetVehicles = fleetVehiclesForCap.filter(v => v.active && !v.held)
  const matrixVehicles = fleetVehiclesForCap.filter(v => v.active)
  const focusDate = selected
    ? bangkokDateFromMs(Date.parse(selected.appointmentAt))
    : queue[0]
    ? bangkokDateFromMs(Date.parse(queue[0].appointmentAt))
    : today
  const busyVehicleIdsOnFocusDate = new Set(
    state.bookings
      .filter(b => isNonTerminalBooking(b) && b.vehicleId && (bangkokDateFromMs(Date.parse(b.schedule?.pickupAt || b.appointmentAt)) === today || bangkokDateFromMs(Date.parse(b.schedule?.pickupAt || b.appointmentAt)) === focusDate))
      .map(b => b.vehicleId!),
  )
  const shortHospital = (name?: string) => (name ? name.replace(/^โรงพยาบาล/, 'รพ.') : 'โรงพยาบาล')
  const driverLabelFor = (driverId?: string) =>
    driverId ? (state.drivers.find(d => d.id === driverId)?.name || remote.data?.catalog.drivers.find(d => d.id === driverId)?.name || driverId) : ''

  const activeFleetLiveStatus = matrixVehicles.map(v => {
    const incidentTrip = state.bookings.find(b => isActiveIncident(b) && b.vehicleId === v.id)
    const activeTrips = state.bookings
      .filter(b => isNonTerminalBooking(b) && b.vehicleId === v.id && (bangkokDateFromMs(Date.parse(b.schedule?.pickupAt || b.appointmentAt)) === today || bangkokDateFromMs(Date.parse(b.schedule?.pickupAt || b.appointmentAt)) === focusDate))
      .sort((a, b) => Date.parse(a.schedule?.pickupAt || a.appointmentAt) - Date.parse(b.schedule?.pickupAt || b.appointmentAt))
    const currentTrip = activeTrips.find(b => b.status === 'in_transit') ?? activeTrips[0]
    const completedTodayTrip = state.bookings
      .filter(b => b.vehicleId === v.id && b.status === 'completed' && bangkokDateFromMs(Date.parse(b.schedule?.arrivalAt || b.appointmentAt)) === today)
      .sort((a, b) => Date.parse(b.schedule?.endsAt || b.appointmentAt) - Date.parse(a.schedule?.endsAt || a.appointmentAt))[0]
    const referenceTrip = incidentTrip ?? currentTrip ?? completedTodayTrip
    const win = currentTrip
      ? computeBackwardBlockedWindow(currentTrip.appointmentAt, { hospitalName: currentTrip.details?.hospital, existingSchedule: currentTrip.schedule })
      : null
    const capabilities = parseVehicleCapabilities(v)
    const hasIncident = Boolean(incidentTrip || v.held)
    const statusKind: 'incident' | 'busy' | 'free' = hasIncident ? 'incident' : currentTrip ? 'busy' : 'free'
    const statusText = statusKind === 'incident' ? 'มีเหตุขัดข้อง' : statusKind === 'busy' ? 'กำลังวิ่งงาน' : 'ว่างพร้อมรับงาน'
    const locationText = hasIncident
      ? incidentTrip
        ? `มีเหตุขัดข้อง · งาน ${incidentTrip.reference ?? incidentTrip.id}`
        : 'มีเหตุขัดข้อง · รอยืนยันความพร้อม'
      : currentTrip
      ? `กำลังรับ-ส่ง · ปลายทาง ${shortHospital(currentTrip.details?.hospital)}`
      : completedTodayTrip
      ? `จบงานล่าสุดที่ ${shortHospital(completedTodayTrip.details?.hospital)} (พร้อมต่อรอบ)`
      : 'ประจำที่ศูนย์รถ ทต.บ้านกลาง'
    const locationTone: 'incident' | 'active' | 'completed' | 'depot' = hasIncident
      ? 'incident'
      : currentTrip
      ? 'active'
      : completedTodayTrip
      ? 'completed'
      : 'depot'
    return {
      id: v.id,
      label: v.label || v.id,
      capabilities,
      driverName: driverLabelFor(referenceTrip?.driverId) || 'ยังไม่ระบุคนขับ',
      statusKind,
      statusText,
      locationText,
      locationTone,
      tripId: (incidentTrip ?? currentTrip)?.id ?? '',
      tripRef: (incidentTrip ?? currentTrip)?.reference ?? (incidentTrip ?? currentTrip)?.id ?? '',
      freeClock: !hasIncident && currentTrip ? (win?.freeClock ?? '') : '',
    }
  })
  const fleetInUseCount = busyVehicleIdsOnFocusDate.size
  const fleetAvailableCount = Math.max(0, activeFleetVehicles.length - fleetInUseCount)
  const wheelchairCapCount = activeFleetVehicles.filter(v => parseVehicleCapabilities(v).includes('wheelchair')).length
  const stretcherCapCount = activeFleetVehicles.filter(v => parseVehicleCapabilities(v).includes('stretcher')).length
  const bookingsByDay = (() => {
    const map = new Map<string, CapacityBookingInput[]>()
    for (const row of state.bookings) {
      if (!isNonTerminalBooking(row)) continue
      const ms = Date.parse(row.appointmentAt)
      if (!Number.isFinite(ms)) continue
      const day = bangkokDateFromMs(ms)
      const list = map.get(day) ?? []
      list.push({
        id: row.id,
        appointmentAt: row.appointmentAt,
        status: row.apiStatus || row.status,
        mobility: row.details?.assistance,
        hospitalName: row.details?.hospital,
        vehicleId: row.vehicleId,
        schedule: row.schedule,
      })
      map.set(day, list)
    }
    return map
  })()

  function renderDecisionBadges(b: Booking) {
    const mob = normalizeMobilityCode(b.details?.assistance)
    const mobText = mob === 'stretcher' ? 'เปลนอน' : mob === 'wheelchair' ? 'รถเข็น' : 'ทั่วไป'
    const mobIcon = mob === 'stretcher' ? 'bed' : mob === 'wheelchair' ? 'wheel' : 'walk'
    const win = computeBackwardBlockedWindow(b.appointmentAt, {
      hospitalName: b.details?.hospital,
      existingSchedule: b.schedule,
    })
    const day = win ? bangkokDateFromMs(Date.parse(win.appointmentAt)) : ''
    const dayPeers = day ? bookingsByDay.get(day) ?? [] : []
    const cap = fleetVehiclesForCap.length > 0 && win
      ? checkCitizenSlotCapacity({
          appointmentAt: b.appointmentAt,
          hospitalName: b.details?.hospital,
          mobility: mob,
          vehicles: fleetVehiclesForCap,
          existingBookings: dayPeers,
          excludeBookingId: b.id,
        })
      : null
    const remainingAfterThis = cap ? cap.compatibleVehiclesCount - cap.occupiedCompatibleCount - 1 : null
    const nearCapacity = cap && (!cap.available || (remainingAfterThis !== null && remainingAfterThis <= 0))

    return (
      <div className="dispatch-decision-badges">
        <span className={`dispatch-mobility-badge ${mob}`}><ServiceSymbol kind={mobIcon} />{mobText}</span>
        {win && (
          <>
            <span className="dispatch-pickup-chip">รับ ~{win.pickupClock} น.</span>
            <span className="dispatch-window-chip">{win.windowLabel}</span>
          </>
        )}
        {nearCapacity && (
          <span className={`dispatch-warning-badge ${!cap?.available ? 'full' : 'near'}`}>
            {!cap?.available ? '⚠ คิวทับซ้อน / รถเต็ม' : '⚠ ใกล้เต็มกำลังรถ'}
          </span>
        )}
      </div>
    )
  }

  if (!Object.hasOwn(headers, screen)) return <Navigate to="/dispatcher" replace />
  const [title, subtitle] = headers[screen as keyof typeof headers]
  const heldVehiclesCount = remote.data?.catalog.vehicles.filter(v => v.held).length ?? 0
  const heldDriversCount = remote.data?.catalog.drivers.filter(d => d.held).length ?? 0
  const sidebarIncidentCount = Math.max(activeIncidentBookings.length, heldVehiclesCount, heldDriversCount)

  const renderSidebarIndicator = (path: string) => {
    if (path === '/dispatcher') {
      return queue.length > 0 ? <i className="nav-badge-count amber" aria-hidden="true">{queue.length > 99 ? '99+' : queue.length}</i> : null
    }
    if (path.endsWith('assignment')) {
      return waiting.length > 0 ? <i className="nav-badge-count amber" aria-hidden="true">{waiting.length > 99 ? '99+' : waiting.length}</i> : null
    }
    if (path.endsWith('tracking')) {
      if (sidebarIncidentCount > 0) {
        return <i className="nav-badge-count danger" aria-hidden="true">{sidebarIncidentCount > 99 ? '99+' : sidebarIncidentCount}</i>
      }
      if (inProgressTripsCount > 0) {
        return <i className="nav-status-dot active" aria-hidden="true" />
      }
    }
    return null
  }
  const mobileMenuDot: 'danger' | 'amber' | null =
    sidebarIncidentCount > 0
      ? 'danger'
      : (screen !== 'dashboard' && queue.length > 0) || (screen !== 'assignment' && waiting.length > 0)
      ? 'amber'
      : null
  return <div className={`dispatch-shell ${sidebarCollapsed ? 'dispatch-sidebar-collapsed' : ''}`}><a className="skip-link" href="#dispatcher-main">ข้ามไปยังเนื้อหา</a>
    <aside id="dispatcher-sidebar" className="dispatch-sidebar"><div className="dispatch-sidebar-tools"><MunicipalLogo /></div><div className="workspace-nav-heading">ระบบรับส่งผู้ป่วย</div><p className="workspace-role-label">เจ้าหน้าที่จัดรถ</p><ResponsiveNavigation id="dispatcher-navigation" label="เมนูเจ้าหน้าที่จัดรถ" statusDot={mobileMenuDot}>{nav.map(item => <NavLink end to={item.path} key={item.path} aria-label={item.label} title={item.label}><ServiceSymbol kind={item.path.endsWith('assignment') ? 'calendar' : item.path.endsWith('tracking') ? 'route' : 'home'} /><span>{item.label}</span>{renderSidebarIndicator(item.path)}</NavLink>)}</ResponsiveNavigation><button type="button" className="dispatch-sidebar-toggle" aria-label={sidebarCollapsed ? 'ขยายเมนูด้านข้าง' : 'ย่อเมนูด้านข้าง'} title={sidebarCollapsed ? 'ขยายเมนูด้านข้าง' : 'ย่อเมนูด้านข้าง'} aria-expanded={!sidebarCollapsed} aria-controls="dispatcher-sidebar" onClick={() => setSidebarCollapsed(hidden => !hidden)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={sidebarCollapsed ? "m5 6 6 6-6 6m8-12 6 6-6 6" : "m11 6-6 6 6 6m8-12-6 6 6 6"} /></svg></button></aside>
    <main tabIndex={-1} ref={main} id="dispatcher-main" className={`dispatch-main dispatch-${screen}`}>
      {activeIncidentBookings.length > 0 && (
        <section className="dispatch-incident-banner" role="status" aria-label="แจ้งเตือนเหตุขัดข้องเร่งด่วน">
          <div className="dispatch-incident-banner-head">
            <span className="dispatch-incident-pill">⚠ เหตุขัดข้องเร่งด่วน ({activeIncidentBookings.length})</span>
            <strong>
              {activeIncidentBookings[0].reference ?? activeIncidentBookings[0].id} ·{' '}
              {state.vehicles.find(v => v.id === activeIncidentBookings[0].vehicleId)?.label || activeIncidentBookings[0].vehicleId || 'ไม่ระบุรถ'} ·{' '}
              {driverLabelFor(activeIncidentBookings[0].driverId) || 'ไม่ระบุคนขับ'}
            </strong>
          </div>
          <p className="dispatch-incident-banner-desc">
            {activeIncidentBookings[0].incidentReason || (activeIncidentBookings[0].incidentOpen ? 'คนขับรายงานเหตุขัดข้องระหว่างปฏิบัติงาน กรุณาตรวจสอบและจัดรถทดแทน' : 'ทรัพยากรถูกระงับความพร้อมชั่วคราว กรุณาตรวจสอบสถานะงาน')}
          </p>
          <div className="dispatch-incident-banner-actions">
            <button
              type="button"
              className="dispatch-incident-cta"
              onClick={() => navigate(`/dispatcher/tracking?booking=${encodeURIComponent(activeIncidentBookings[0].id)}&dialog=tracking`)}
            >
              เปิดเคส / จัดรถทดแทน →
            </button>
            {activeIncidentBookings.length > 1 && (
              <button
                type="button"
                className="dispatch-incident-secondary"
                onClick={() => { setTrackingScope('incidents'); setDate(''); navigate('/dispatcher/tracking') }}
              >
                ดูทั้งหมด ({activeIncidentBookings.length} เคส)
              </button>
            )}
          </div>
        </section>
      )}
      <header className="dispatch-page-header"><h1 tabIndex={-1}>{title}</h1><p>{subtitle}</p></header>
      <DispatcherAlerts /><NotificationFailures />{screen === 'tracking' && <><DailyManifestExport /><MonthlyReportExport /></>}<div className="dispatch-toolbar-actions"><button type="button" className="dispatch-refresh-icon-btn" aria-label="โหลดข้อมูลล่าสุด" title="โหลดข้อมูลล่าสุด" disabled={remote.loading || busy} aria-busy={remote.loading} onClick={remote.reload}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" /></svg></button><Link className="dispatch-account-link" to="/staff/login">บัญชีเจ้าหน้าที่ / ออกจากระบบ</Link></div>{remote.loading && <p role="status">กำลังโหลดข้อมูล…</p>}{remote.error && <p className="dispatch-alert" role="alert">{remote.error}</p>}{remote.data?.rows.some(row => row.scheduleReviewRequired) && <p className="dispatch-alert">มีตารางที่ต้องตรวจสอบหลังเปลี่ยนการตั้งค่า ตารางเดิมยังมีผล</p>}{notice && <div role="status" className="dispatch-notice"><p>{notice}</p><button aria-label="ปิดข้อความ" type="button" onClick={() => setNotice('')}>×</button></div>}

      {remote.data && remote.hasMore && <div className="dispatch-dialog-actions"><p>จำนวนและตัวกรองครอบคลุมเฉพาะรายการที่โหลดแล้ว</p><DispatchButton secondary disabled={remote.loading || busy} onClick={remote.loadMore}>โหลดรายการเพิ่มเติม</DispatchButton></div>}

      {(screen === 'dashboard' || screen === 'assignment') && totalFleetCount > 0 && (
        <section className="dispatch-fleet-bar" aria-label="สถานะรถรับส่งทั้งหมด">
          <div className="dispatch-fleet-bar-top">
            <div className="dispatch-fleet-pill">
              <span>รถทั้งหมด / เปิดใช้งาน</span>
              <strong>{activeFleetVehicles.length} / {totalFleetCount} คัน</strong>
            </div>
            <div className="dispatch-fleet-pill busy">
              <span>กำลังใช้งาน</span>
              <strong>{fleetInUseCount} คัน</strong>
            </div>
            <div className="dispatch-fleet-pill free">
              <span>ว่างพร้อมจัด</span>
              <strong>{fleetAvailableCount} คัน</strong>
            </div>
            <div className="dispatch-fleet-caps">
              <span className="dispatch-mobility-badge wheelchair"><ServiceSymbol kind="wheel" />รถเข็น {wheelchairCapCount} คัน</span>
              <span className="dispatch-mobility-badge stretcher"><ServiceSymbol kind="bed" />เปลนอน {stretcherCapCount} คัน</span>
            </div>
          </div>
          {screen === 'dashboard' && activeFleetLiveStatus.length > 0 && (
            <div className="dispatch-fleet-matrix-wrap">
              <div className="dispatch-fleet-matrix-head">
                <div className="dispatch-fleet-matrix-title-group">
                  <strong>สถานะรถปฏิบัติงานจริง (Live Fleet Matrix)</strong>
                  <span className="dispatch-fleet-source-note">ตำแหน่งอ้างอิงจากสถานะงานล่าสุด</span>
                </div>
                <div className="dispatch-fleet-matrix-controls">
                  {!fleetMatrixExpanded && activeFleetLiveStatus.length > 5 && (
                    <div className="dispatch-fleet-scroll-btns" role="group" aria-label="เลื่อนดูสถานะรถรับส่ง">
                      <button
                        type="button"
                        className="dispatch-fleet-scroll-btn"
                        aria-label="เลื่อนดูรถก่อนหน้า"
                        title="เลื่อนดูรถก่อนหน้า"
                        onClick={() => fleetRailRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className="dispatch-fleet-scroll-btn"
                        aria-label="เลื่อนดูรถถัดไป"
                        title="เลื่อนดูรถถัดไป"
                        onClick={() => fleetRailRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
                      >
                        ›
                      </button>
                    </div>
                  )}
                  {activeFleetLiveStatus.length > 4 && (
                    <button
                      type="button"
                      className="dispatch-fleet-toggle-btn"
                      aria-expanded={fleetMatrixExpanded}
                      onClick={() => setFleetMatrixExpanded(prev => !prev)}
                    >
                      {fleetMatrixExpanded ? 'ย่อเป็นแถวเดียว' : `ดูทั้งหมด (${activeFleetLiveStatus.length})`}
                    </button>
                  )}
                </div>
              </div>
              <div
                ref={fleetRailRef}
                className={`dispatch-fleet-live-strip dispatch-fleet-matrix ${fleetMatrixExpanded ? 'is-expanded' : ''}`}
                aria-label="สถานะความพร้อมรถแต่ละคัน"
              >
                {activeFleetLiveStatus.map(unit => (
                  <article key={unit.id} className={`dispatch-fleet-unit is-${unit.statusKind}`}>
                    <div className="dispatch-fleet-unit-head">
                      <strong>{unit.label}</strong>
                      <span className={`dispatch-unit-badge ${unit.statusKind}`}>{unit.statusText}</span>
                    </div>
                    <div className="dispatch-fleet-unit-caps" aria-label="อุปกรณ์ที่รองรับ">
                      {unit.capabilities.map(cap => (
                        <span key={cap} className={`dispatch-unit-cap ${cap}`}>
                          <ServiceSymbol kind={cap === 'stretcher' ? 'bed' : cap === 'wheelchair' ? 'wheel' : 'walk'} />
                          {cap === 'stretcher' ? 'เปลนอน' : cap === 'wheelchair' ? 'รถเข็น' : 'เดินได้'}
                        </span>
                      ))}
                    </div>
                    <div className="dispatch-fleet-unit-details">
                      <span className="dispatch-fleet-driver"><ServiceSymbol kind="person" />{unit.driverName}</span>
                      <span className={`dispatch-fleet-loc tone-${unit.locationTone}`}>{unit.locationText}</span>
                    </div>
                    {unit.statusKind === 'incident' ? (
                      <>
                        <p className="dispatch-fleet-unit-meta">
                          ระงับคิวชั่วคราวจนกว่าเจ้าหน้าที่จะคลี่คลายเหตุและยืนยันความพร้อม
                        </p>
                        <button
                          type="button"
                          className="dispatch-fleet-action-btn is-incident"
                          onClick={() => navigate(`/dispatcher/tracking?focus=readiness&resource=${encodeURIComponent(`vehicles/${unit.id}`)}`)}
                        >
                          คลี่คลายเหตุ / ยืนยันความพร้อม →
                        </button>
                      </>
                    ) : unit.statusKind === 'busy' && unit.tripId ? (
                      <p className="dispatch-fleet-unit-meta">
                        <button
                          type="button"
                          className="dispatch-fleet-trip-link"
                          onClick={() => navigate(`/dispatcher/tracking?booking=${encodeURIComponent(unit.tripId)}&dialog=tracking`)}
                        >
                          งาน {unit.tripRef} →
                        </button>
                        {unit.freeClock ? ` · ว่างอีกครั้ง ${unit.freeClock} น.` : ''}
                      </p>
                    ) : (
                      <p className="dispatch-fleet-unit-meta">
                        พร้อมจัดคิวรับ–ส่งทันที
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {screen === 'dashboard' && <>
        <div className="dispatch-view-switcher" role="group" aria-label="รูปแบบการแสดงผลงานจัดรถ">
          <button
            type="button"
            className={`dispatch-view-btn ${dashboardView === 'board' ? 'active' : ''}`}
            aria-pressed={dashboardView === 'board'}
            onClick={() => setDashboardView('board')}
          >
            มุมมองตารางงาน
          </button>
          <button
            type="button"
            className={`dispatch-view-btn ${dashboardView === 'map' ? 'active' : ''}`}
            aria-pressed={dashboardView === 'map'}
            onClick={() => setDashboardView('map')}
          >
            มุมมองแผนที่รายวัน ({state.bookings.length})
          </button>
        </div>

        {dashboardView === 'map' ? (
          <DailyDispatchMapView
            bookings={state.bookings}
            defaultDate={focusDate}
            onOpenDetails={openDetails}
            onGoAssign={b => navigate(`/dispatcher/assignment?booking=${encodeURIComponent(b.id)}`)}
          />
        ) : <>
        <section className="dispatch-metrics" aria-label="ภาพรวมคำขอ"><article><p>คำขอรอตรวจสอบ</p><strong>{state.bookings.filter(b => b.status === 'pending').length}</strong><button type="button" onClick={() => { document.getElementById('dispatch-queue')?.scrollIntoView(); document.getElementById('queue-title')?.focus() }}>ตรวจสอบคำขอ →</button></article><article><p>รอจัดรถและคนขับ</p><strong>{waiting.length}</strong><Link to="/dispatcher/assignment">จัดตาราง →</Link></article><article><p>งานรับส่งวันนี้</p><strong>{todaysJobs.length}</strong><Link to="/dispatcher/tracking">ดูงานรับส่งทั้งหมด →</Link></article></section>
        <div className="dispatch-dashboard-queues">
          {[
            { id: 'dispatch-queue', titleId: 'queue-title', title: 'คำขอรอตรวจสอบ', description: 'ตรวจสอบข้อมูล แล้วอนุมัติหรือปฏิเสธคำขอ', jobs: queue, pagedJobs: pagedQueue, page: queuePage, onPageChange: setQueuePage, paginationLabel: 'แบ่งหน้าคำขอรอตรวจสอบ', empty: 'ไม่มีคำขอรอตรวจสอบ', status: 'pending' },
            { id: 'dispatch-assignment-queue', titleId: 'assignment-queue-title', title: 'รอจัดรถและคนขับ', description: 'อนุมัติแล้ว เลือกรถและคนขับเพื่อยืนยันงาน', jobs: waiting, pagedJobs: pagedWaiting, page: waitingPage, onPageChange: setWaitingPage, paginationLabel: 'แบ่งหน้ารายการรอจัดรถ', empty: 'ไม่มีงานรอจัดรถและคนขับ', status: 'approved' },
          ].map(panel => <section key={panel.id} id={panel.id} className={`dispatch-queue dispatch-dashboard-queue ${panel.status}`} aria-labelledby={panel.titleId}>
            <header><h2 id={panel.titleId} tabIndex={-1}>{panel.title}</h2><span className="dispatch-queue-count">{panel.jobs.length} รายการ</span></header>
            <p>{panel.description}</p>
            <ServiceTable headings={['คำขอ / ผู้ป่วย / อุปกรณ์', 'นัดหมาย / ช่วงเวลารถ', 'ดำเนินการ']} label={panel.title}>
              {panel.pagedJobs.length ? panel.pagedJobs.map((b, i) => <tr key={b.id}>
                <th scope="row"><span>{b.id}</span><span className="dispatch-dashboard-patient">{b.patientName}</span><span className={`dispatch-status ${b.status}`}>{dispatchStatus(b)}</span></th>
                <td><strong>{dispatchDate(b.appointmentAt)} · นัด {dispatchTime(b.appointmentAt)} น.</strong><span className="dispatch-dashboard-secondary">{b.details?.hospital || 'ไม่มีข้อมูลโรงพยาบาล'}</span>{renderDecisionBadges(b)}</td>
                <td>{rowAction(b, i)}</td>
              </tr>) : <tr><td colSpan={3} className="dispatch-empty">{panel.empty}</td></tr>}
            </ServiceTable>
            <PaginationControls totalItems={panel.jobs.length} pageSize={DISPATCHER_PAGE_SIZE} page={panel.page} onPageChange={panel.onPageChange} label={panel.paginationLabel} />
          </section>)}
        </div>
        <VehicleTimelineView bookings={state.bookings} vehicles={state.vehicles} catalogVehicles={remote.data?.catalog.vehicles} defaultDate={focusDate} onSelectBooking={openDetails} />
        </>}
      </>}
      {screen === 'assignment' && <><div className="dispatch-assignment-grid"><section className="dispatch-panel dispatch-waiting"><h2>1. เลือกงานที่รอจัดตาราง</h2><p>เลือกงาน แล้วจัดรถและคนขับ</p><div className="dispatch-waiting-list" tabIndex={0} role="region" aria-label="รายการงานที่รอจัดตาราง">{pagedWaiting.map(b => <article key={b.id} className={selected?.id === b.id ? 'selected' : ''}><button type="button" aria-pressed={selected?.id === b.id} onClick={() => { setError(''); setParams({ booking: b.id }) }}><div className="dispatch-job-card-heading"><strong>{b.id}</strong><span>{selected?.id === b.id ? '✓ เลือกแล้ว' : 'เลือกงานนี้ →'}</span></div><span className="dispatch-job-patient">{b.patientName}</span><b>{dispatchDate(b.appointmentAt)} · นัด {dispatchTime(b.appointmentAt)} น.</b><span>{b.details?.hospital || 'ไม่มีข้อมูลโรงพยาบาล'}</span>{renderDecisionBadges(b)}<span className="dispatch-status approved">รอจัดตาราง</span></button><button type="button" className="dispatch-details-link" onClick={() => openDetails(b)}>ดูรายละเอียด</button></article>)}</div><PaginationControls totalItems={waiting.length} pageSize={DISPATCHER_PAGE_SIZE} page={waitingPage} onPageChange={setWaitingPage} label="แบ่งหน้างานที่รอจัดตาราง" />{!waiting.length && <p className="dispatch-empty">ไม่มีงานรอจัดตาราง กรุณาอนุมัติคำขอจากแดชบอร์ดก่อน</p>}<p className="dispatch-small">แสดงเฉพาะงานที่ยังไม่ได้จัดรถ</p></section>{selected ? <ApiDispatchAssignment key={`${selected.id}:${selected.revision}`} booking={remote.data!.rows.find(row => row.id === selected.id)!} catalog={remote.data!.catalog} previousJobs={remote.data!.rows} reload={remote.reload} onAssigned={() => { remote.reload(); setNotice(`มอบหมายงาน ${selected.id} แล้ว`); navigate('/dispatcher/tracking') }} /> : <section className="dispatch-panel dispatch-empty"><h2>{selectedId ? 'ไม่พบงานที่รอจัดตารางนี้' : 'เลือกงานที่รอจัดตาราง'}</h2><p>งานอาจถูกมอบหมายแล้ว หรือยังไม่ได้รับอนุมัติ</p><Link to="/dispatcher">กลับแดชบอร์ด</Link></section>}</div><VehicleTimelineView bookings={state.bookings} vehicles={state.vehicles} catalogVehicles={remote.data?.catalog.vehicles} defaultDate={selected ? bangkokDateFromMs(Date.parse(selected.appointmentAt)) : focusDate} onSelectBooking={openDetails} /></>}
      {screen === 'tracking' && <>{remote.data && <ResourceReadiness key="resource-readiness" catalog={remote.data.catalog} initialResource={params.get('resource') ?? undefined} autoFocusPanel={params.get('focus') === 'readiness'} feedbackMessage={readinessFeedback} onSaved={(releasedLabel, remaining) => { remote.reload(); setNotice('ยืนยันความพร้อมทรัพยากรแล้ว'); setReadinessFeedback(remaining > 0 ? `ยืนยันความพร้อม "${releasedLabel}" แล้ว — เหลือทรัพยากรรอคลี่คลายอีก ${remaining} รายการ` : `ยืนยันความพร้อม "${releasedLabel}" แล้ว — ปล่อยการระงับครบทุกรายการ`) }} />}
        <section className="dispatch-metrics dispatch-tracking-metrics" aria-label="ภาพรวมการรับส่งวันนี้">{[['งานทั้งหมดวันนี้', todaysJobs.length], ['อยู่ระหว่างรับส่ง', todaysJobs.filter(b => b.status === 'in_transit').length], ['ดำเนินการเสร็จแล้ว', todaysJobs.filter(b => b.status === 'completed').length]].map(([label, value]) => <article key={label}><p>{label}</p><strong>{value}</strong>{label === 'งานทั้งหมดวันนี้' && <span className="dispatch-tracking-secondary">{dispatchDate(new Date(now).toISOString())}</span>}</article>)}</section>
        <div className="dispatch-tracking-scopes" role="group" aria-label="ช่วงเวลาของงานรับส่ง">
          {([['all', 'ทั้งหมด'], ['today', 'วันนี้']] as const).map(([scope, label]) => (
            <button type="button" key={scope} aria-pressed={!date && effectiveTrackingScope === scope} onClick={() => { setTrackingScope(scope); setDate(''); scrollToTrackingTop() }}>{label}</button>
          ))}
          {activeIncidentBookings.length > 0 && (
            <button
              type="button"
              className="dispatch-scope-incident"
              aria-pressed={!date && effectiveTrackingScope === 'incidents'}
              onClick={() => { setTrackingScope('incidents'); setDate(''); scrollToTrackingTop() }}
            >
              เฉพาะเหตุขัดข้อง ({activeIncidentBookings.length})
            </button>
          )}
        </div>
        <div className="dispatch-filters"><label className="dispatch-search"><span className="sr-only">ค้นหารหัสงาน ชื่อผู้ป่วย หรือคนขับ</span><input type="search" value={search} placeholder="⌕ ค้นหารหัสงาน ชื่อผู้ป่วย หรือคนขับ" onChange={e => { setSearch(e.target.value); scrollToTrackingTop() }} /></label><label className="dispatch-date-filter"><span>วันรับผู้ป่วย</span><input type="date" aria-label="วันรับผู้ป่วย" value={date} onChange={e => { setDate(e.target.value); scrollToTrackingTop() }} /></label><label><span className="sr-only">กรองสถานะ</span><select aria-label="กรองสถานะ" value={filter} onChange={e => { setFilter(e.target.value); scrollToTrackingTop() }}><option value="">สถานะทั้งหมด</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <section ref={trackingSectionRef} className="dispatch-panel dispatch-monitoring"><h2>{effectiveTrackingScope === 'incidents' ? 'รายการที่มีเหตุขัดข้องเร่งด่วน' : date ? dispatchDate(date) : effectiveTrackingScope === 'today' ? 'รายการงานวันนี้' : 'รายการงานรับส่งทั้งหมด'} · {monitoring.length} งาน</h2><p className="dispatch-muted">งานที่มีเหตุขัดข้องแสดงบนสุด ตามด้วยงานกำลังเดินทางและงานรอรับในแต่ละวัน</p><ServiceTable headings={['งาน / ผู้ป่วย', 'วัน / เวลารับ', 'โรงพยาบาล', 'รถ / คนขับ', 'สถานะ', 'รายละเอียด']} label="ตารางงานรับส่ง">{pagedMonitoring.length ? pagedMonitoring.map(b => { const activeInc = isActiveIncident(b); return <tr key={b.id} className={activeInc ? 'dispatch-row-incident' : undefined}><th scope="row">{b.id}<span className="dispatch-tracking-secondary">{b.patientName}</span></th><td><strong>{b.schedule ? dispatchTime(b.schedule.pickupAt) + ' น.' : 'ไม่มีเวลารับที่ยืนยัน'}</strong><span className="dispatch-tracking-secondary">{b.schedule ? dispatchDate(b.schedule.pickupAt) : 'นัด ' + dispatchDate(b.appointmentAt)}</span></td><td>{b.details?.hospital || 'ไม่มีข้อมูลโรงพยาบาล'}</td><td>{state.vehicles.find(v => v.id === b.vehicleId)?.label || b.vehicleId} · {state.drivers.find(d => d.id === b.driverId)?.name || b.driverId}</td><td><div className="dispatch-status-stack"><span className={`dispatch-status-badge ${b.status}`}><span aria-hidden="true">{b.status === 'completed' ? '✓ ' : b.status === 'cancelled' ? '× ' : b.status === 'in_transit' ? '→ ' : '◷ '}</span>{dispatchStatus(b)}</span>{activeInc && <span className="dispatch-incident-row-badge">มีเหตุขัดข้อง — รอจัดรถใหม่</span>}</div></td><td><DispatchButton secondary onClick={() => openDetails(b)}>{b.status === 'completed' ? 'ดูรายละเอียด →' : 'ดูสถานะ →'}</DispatchButton></td></tr> }) : <tr><td colSpan={6} className="dispatch-empty">{!date && effectiveTrackingScope === 'today' && !search && !filter ? 'ไม่มีงานรับส่งวันนี้ เลือกทั้งหมดเพื่อดูงานวันอื่น' : 'ไม่พบงานรับส่งที่ตรงกับตัวกรอง'}</td></tr>}</ServiceTable><PaginationControls totalItems={monitoring.length} pageSize={DISPATCHER_PAGE_SIZE} page={monitoringPage} onPageChange={nextPage => { setMonitoringPage(nextPage); scrollToTrackingTop() }} label="แบ่งหน้าตารางติดตามงานรับส่ง" /><p className="dispatch-small">โหลดข้อมูลล่าสุดเพื่อดูสถานะปัจจุบัน · แสดงหน้าละ {DISPATCHER_PAGE_SIZE} รายการ</p></section>
      </>}
    </main>
    {dialog && !modalBooking && <DispatchModal title="ไม่พบคำขอนี้" onClose={closeModal}><p>รายการนี้ไม่มีอยู่แล้ว กรุณาตรวจสอบรายการล่าสุด</p><DispatchButton secondary onClick={closeModal}>กลับไปตรวจสอบ</DispatchButton></DispatchModal>}
    {(dialog === 'details' || dialog === 'approve') && modalBooking && <DispatchModal title="รายละเอียดงาน" kind="dispatch-details-modal" onClose={closeModal}>{screen === 'tracking' && <button type="button" className="dispatch-details-link" onClick={() => setParams({ booking: modalBooking.id, dialog: 'tracking' })}>← กลับไปติดตามสถานะ</button>}<div className="dispatch-details-heading"><p>{modalBooking.id}</p><span>{dispatchStatus(modalBooking)}</span></div><div className="dispatch-details-summary-grid"><section className="dispatch-appointment"><p>นัดหมาย</p><div><strong>{dispatchDate(modalBooking.appointmentAt)}</strong><b>{dispatchTime(modalBooking.appointmentAt)} น.</b></div><h3>{modalBooking.details?.hospital || 'ไม่มีข้อมูลโรงพยาบาล'}</h3></section><section className="dispatch-detail-section dispatch-detail-contact"><h3>ผู้รับบริการและผู้ติดต่อ</h3><dl><div><dt>ชื่อผู้รับบริการ</dt><dd>{modalBooking.patientName}</dd>{modalBooking.details?.bookingFor === 'other' && <dd>{modalBooking.details.contactName} · {modalBooking.details.relationship}</dd>}</div><div><dt>เบอร์ติดต่อ</dt><dd>{modalBooking.details?.phone || 'ไม่มีข้อมูล'}</dd></div></dl></section></div><section className="dispatch-detail-section"><h3>การรับผู้ป่วย</h3><dl><div><dt>จุดรับ</dt><dd>{formatPickupSummary(modalBooking.details?.pickup?.label) || 'ไม่มีจุดรับ'}</dd></div><div><dt>ความช่วยเหลือ</dt><dd>{modalBooking.details?.assistance || 'ไม่มีข้อมูล'}</dd><dd>{modalBooking.details?.extras.join(' · ')}</dd></div></dl><DispatcherPickupMap key={modalBooking.id} pickup={modalBooking.details?.pickup} /></section>{modalBooking.schedule && <section className="dispatch-detail-section"><h3>รถและคนขับที่ได้รับมอบหมาย</h3><p>{state.vehicles.find(v => v.id === modalBooking.vehicleId)?.label || modalBooking.vehicleId} · {state.drivers.find(d => d.id === modalBooking.driverId)?.name || modalBooking.driverId}</p><ScheduleSummary booking={modalBooking} schedule={modalBooking.schedule} /></section>}<DispatchReview key={modalBooking.id} bookingId={modalBooking.id} onBusyChange={value => { submitting.current = value; setBusy(value) }} />{modalBooking.status === 'pending' && <><p className="dispatch-small">จองล่วงหน้าอย่างน้อย 48 ชั่วโมง · {modalBooking.createdAt ? `${dispatchDate(modalBooking.createdAt)} ${dispatchTime(modalBooking.createdAt)}` : 'ไม่พบเวลาส่งคำขอ'}</p>{dialog !== 'approve' && <div className="dispatch-dialog-actions"><DispatchButton id="approval-start" disabled={busy} onClick={() => openDecision('approve')}>อนุมัติคำขอ</DispatchButton><DispatchButton secondary disabled={busy || remote.loading} aria-busy={busy} onClick={() => void quickApprove(modalBooking, true)}>อนุมัติและไปจัดรถ →</DispatchButton><DispatchButton secondary danger disabled={busy} onClick={() => openDecision('reject')}>ปฏิเสธคำขอ</DispatchButton></div>}</>}{dialog === 'approve' && <><p className="dispatch-muted" aria-live="polite">ตรวจสอบข้อมูลแล้ว ยืนยันอนุมัติคำขอนี้หรือไม่?</p>{error && <p className="dispatch-alert" role="alert">{error}</p>}<div className="dispatch-dialog-actions"><DispatchButton disabled={busy || remote.loading || modalBooking.status !== 'pending'} aria-busy={busy} onClick={() => decide('approved')}>{busy ? 'กำลังบันทึก…' : 'ยืนยันอนุมัติ'}</DispatchButton><DispatchButton id="approval-back" secondary disabled={busy} onClick={() => { setError(''); setParams({ booking: modalBooking.id, dialog: 'details' }, { replace: true }) }}>กลับไปตรวจสอบ</DispatchButton></div></>}{dialog !== 'approve' && modalBooking.status === 'approved' && !modalBooking.schedule && <DispatchButton onClick={() => { setError(''); navigate(`/dispatcher/assignment?booking=${encodeURIComponent(modalBooking.id)}`) }}>ไปจัดรถและคนขับ →</DispatchButton>}</DispatchModal>}
    {dialog === 'reject' && modalBooking && <DispatchModal title="ปฏิเสธคำขอ" kind="dispatch-reject-modal" onClose={closeModal}>
      <p id="rejection-consequence" className="dispatch-danger-notice">คำขอ {modalBooking.id} จะไม่ถูกจัดรถ ผู้จองจะเห็นเหตุผลที่คุณระบุ</p>
      <label className="booking-field">ประเภทเหตุผลการปฏิเสธ<select value={rejectionKind} disabled={busy} onChange={e=>{setRejectionKind(e.target.value as 'other'|'capacity');setCapacityCheckId(null)}}><option value="other">เหตุอื่นที่ไม่ใช่กำลังรถ</option><option value="capacity">ทรัพยากรไม่เพียงพอ</option></select></label>
      {rejectionKind==='capacity'&&remote.data&&<CapacityEvidence key={modalBooking.id} bookingId={modalBooking.id} revision={modalBooking.revision??0} catalog={remote.data.catalog} onEvidence={setCapacityCheckId} onBusyChange={value=>{submitting.current=value;setBusy(value)}} />}
      <form id="dispatcher-reject-form" noValidate onSubmit={e => { e.preventDefault(); decide('rejected') }}>
        <label className="dispatch-rejection-label" htmlFor="rejection-reason">เหตุผลการปฏิเสธ</label>
        <input id="rejection-reason" required disabled={busy} value={reason} maxLength={500} placeholder="ระบุเหตุผลให้ผู้จองทราบ" aria-invalid={!!error} aria-describedby={error ? 'rejection-consequence rejection-error' : 'rejection-consequence'} onChange={e => { setReason(e.target.value); setError('') }} />
        {error && <p id="rejection-error" role="alert" className="dispatch-alert">{error}</p>}
      </form>
      <div className="dispatch-dialog-actions"><DispatchButton secondary disabled={busy} data-initial-focus onClick={() => { setError(''); setParams({ booking: modalBooking.id, dialog: 'details' }, { replace: true }) }}>กลับไปตรวจสอบ</DispatchButton><DispatchButton danger disabled={busy || remote.loading || modalBooking.status !== 'pending'} aria-busy={busy} type="submit" form="dispatcher-reject-form">{busy ? 'กำลังบันทึก…' : 'ยืนยันปฏิเสธคำขอ'}</DispatchButton></div>
    </DispatchModal>}
    {dialog === 'tracking' && modalBooking && <DispatchModal title="ติดตามสถานะงานรับส่ง" kind="dispatch-tracking-modal" onClose={closeModal}><p className="dispatch-muted">{modalBooking.id} · {dispatchDate(modalBooking.appointmentAt)}</p><section className="dispatch-result-card"><h3>{dispatchStatus(modalBooking)}</h3><p>เวลารับตามแผน {modalBooking.schedule ? dispatchTime(modalBooking.schedule.pickupAt) : 'ยังไม่ได้มอบหมาย'} น. · {state.vehicles.find(v => v.id === modalBooking.vehicleId)?.label || 'ยังไม่มีรถ'}</p><p>{state.drivers.find(d => d.id === modalBooking.driverId)?.name || 'ยังไม่มีคนขับ'} · {modalBooking.details?.hospital}</p></section><h3>ความคืบหน้าของงาน</h3>{modalBooking.cancellation && <p className="dispatch-alert">ยกเลิกแล้ว · {modalBooking.cancellation.reason}</p>}<ol className="dispatch-tracking-steps"><li>{dispatchStatus(modalBooking)}</li>{modalBooking.incidentOpen && <li>มีเหตุขัดข้องที่ยังไม่คลี่คลาย</li>}{modalBooking.resourceHold && <li>รถหรือคนขับยังถูกระงับความพร้อม</li>}</ol><p className="dispatch-small">สถานะล่าสุดที่คนขับรายงาน</p><DispatchButton secondary onClick={() => setParams({ booking: modalBooking.id, dialog: 'details' })}>ดูรายละเอียดงาน →</DispatchButton><DispatchButton secondary onClick={closeModal}>ปิดรายละเอียด</DispatchButton>{remote.data && <DispatcherOperations key={`${modalBooking.id}:${modalBooking.revision}`} booking={remote.data.rows.find(row => row.id === modalBooking.id)!} catalog={remote.data.catalog} rows={remote.data.rows} onBusyChange={value => { submitting.current = value; setBusy(value) }} onSaved={() => { submitting.current = false; setBusy(false); closeModal(); remote.reload(); setNotice("บันทึกการดำเนินการแล้ว") }} />}</DispatchModal>}
  </div>
}
