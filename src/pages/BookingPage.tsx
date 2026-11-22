import { PickupMap } from '../components/LocationMap'
import { BookingSummaryCard } from '../components/BookingSummaryCard'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { BookingTripTimeline } from '../components/BookingTripTimeline'
import { AppointmentPicker } from '../components/AppointmentPicker'
import { BookingButton, BookingCard, BookingHeader, BookingIcon, BookingModal, BookingProgress, EmergencyLink } from '../components/BookingUI'
import { appointmentTimestamp, emptyBooking, formatPickupSummary, meetsLeadTime, thaiDate, validatePatient, validatePickup } from '../services/booking'
import type { BookingDetails } from '../services/booking'
import { dispatchTime } from '../services/dispatch'
import { statusLabels } from '../services/dispatcherApi'
import { bookingPages } from '../services/bookingPages'
import { citizenRequest, citizenError, enterDemoCitizen, initializeCitizen, refreshCitizenConfig, useCitizenSession } from '../services/citizenSession'
import { ApiError } from '../services/api'
import { applyProfile, canCitizenCancel, citizenBooking, intakeFields, profileFields, type CitizenBooking, type CitizenCatalog, type PatientProfile } from '../services/citizenApi'
import { checkCitizenSlotCapacity, type CapacityBookingInput, type CapacityCheckResult } from '../domain/capacity'
import { seedOverlay, useSeedOverlay } from '../services/seedOverlay'
import { isInteractiveDemoActive } from '../services/interactiveDemo'
import '../booking.css'

const initialBookingForm = (): BookingDetails => ({ ...emptyBooking(), pickupAddress: '', villageId: '', landmark: '' })
export function BookingPage() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const path = pathname.replace(/^\/booking\/?/, '').split('/')
  const screen = path[0]
  const session = useCitizenSession()
  const overlay = useSeedOverlay()
  const [catalog, setCatalog] = useState<CitizenCatalog>({ hospitals: [], villages: [] })
  const [rows, setRows] = useState<CitizenBooking[]>([])
  const [capacitySuggestionTimes, setCapacitySuggestionTimes] = useState<string[]>([])
  const [profiles, setProfiles] = useState<PatientProfile[]>([])
  const [loadedKey, setLoadedKey] = useState('')
  const [loadError, setLoadError] = useState('')
  const [version, setVersion] = useState(0)
  const [listRange, setListRange] = useState({ owner: '', pages: 1 })
  const [hasMore, setHasMore] = useState(false)
  const [consent, setConsent] = useState<{ id: string; version: string; owner: string } | null>(null)
  const [consentBusy, setConsentBusy] = useState(false)
  const [consentError, setConsentError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [saveProfile, setSaveProfile] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState('')
  const detailId = path[1]
  const pages = listRange.owner === session.user?.id ? listRange.pages : 1
  const requestKey = `${session.user?.id ?? ''}/${detailId ?? ''}/${detailId || screen === 'bookings' ? screen : ''}/${version}/${pages}`
  const loading = loadedKey !== requestKey
  const state = { bookings: rows.map(row => citizenBooking(row, catalog)) }
  const [draft, setDraft] = useState<BookingDetails>(initialBookingForm)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [picker, setPicker] = useState<'date' | 'time' | null>(null)
  const [cancelError, setCancelError] = useState('')
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [consentDeclined, setConsentDeclined] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [locatingPath, setLocatingPath] = useState<string | null>(null)
  const locating = locatingPath === pathname
  const locationRequest = useRef(0)
  const gpsActive = draft.pickup?.accuracy !== undefined
  const [sending, setSending] = useState(false)
  const [intakeUncertain, setIntakeUncertain] = useState(false)
  const [saveError, setSaveError] = useState('')
  const sendingRef = useRef(false)
  const submittedId = useRef<string | null>(null)
  const pendingIntake = useRef<(ReturnType<typeof intakeFields> & { requestId: string }) | null>(null)
  const root = useRef<HTMLElement>(null)
  const errorFocusPending = useRef(false)
  const saved = state.bookings.find(b => b.id === path[1])
  const savedRow = rows.find(row => row.id === path[1])
  const citizenCanCancel = () => canCitizenCancel(savedRow)
  const currentConsent = consent?.owner === session.user?.id && consent?.version === session.config?.noticeVersion ? consent : null
  const previousOwner = useRef<string | null>(null)
  const hasFleetCatalog = catalog.vehicles !== undefined || overlay.active
  const effectiveVehicles = catalog.vehicles !== undefined ? catalog.vehicles : overlay.vehicles
  const effectiveHospitalName = catalog.hospitals.find(h => h.id === draft.hospital)?.name
  const effectiveBookings: CapacityBookingInput[] = (() => {
    const byId = new Map<string, CapacityBookingInput>()
    for (const b of catalog.activeBookings ?? []) {
      if (b.id) byId.set(b.id, b)
    }
    for (const b of overlay.active ? overlay.bookings : []) {
      byId.set(b.id, {
        id: b.id,
        appointmentAt: b.appointmentAt,
        status: b.apiStatus || b.status,
        mobility: b.details?.assistance,
        hospitalName: b.details?.hospital,
        vehicleId: b.vehicleId,
        schedule: b.schedule,
      })
    }
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        appointmentAt: r.appointmentAt,
        status: r.status,
        hospitalId: r.hospitalId,
        hospitalName: r.hospitalName,
        mobility: r.mobility,
        vehicleId: r.vehicleId,
        schedule: r.schedule,
      })
    }
    return Array.from(byId.values())
  })()
  const validClockSelection = Boolean(
    draft.date &&
    draft.time &&
    /^\d{4}-\d{2}-\d{2}$/.test(draft.date) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time) &&
    draft.time >= '06:20' &&
    draft.time <= '15:50' &&
    meetsLeadTime(draft.date, draft.time),
  )
  const slotCapacity: CapacityCheckResult | null = hasFleetCatalog && validClockSelection
    ? checkCitizenSlotCapacity({
        appointmentAt: new Date(appointmentTimestamp(draft.date, draft.time)).toISOString(),
        hospitalId: draft.hospital,
        hospitalName: effectiveHospitalName,
        mobility: draft.assistance || 'เดินได้',
        vehicles: effectiveVehicles,
        existingBookings: effectiveBookings,
      })
    : null
  useEffect(() => { void initializeCitizen() }, [])
  useEffect(() => {
    if (!session.user) return
    if (previousOwner.current && previousOwner.current !== session.user.id) {
      setDraft(initialBookingForm()); setConsent(null); submittedId.current = null; pendingIntake.current = null; setIntakeUncertain(false)
    }
    previousOwner.current = session.user.id
  }, [session.user])
  useEffect(() => {
    if (!session.user) return
    let active = true
    Promise.all([citizenRequest<CitizenCatalog>('/catalog'), bookingPages<CitizenBooking>(citizenRequest, '/bookings', pages), citizenRequest<{ profiles: PatientProfile[] }>('/profiles'),
      detailId ? citizenRequest<CitizenBooking>(`/bookings/${encodeURIComponent(detailId)}`) : Promise.resolve(null)]).then(([master, bookings, savedProfiles, detail]) => {
      if (!active) return
      setLoadError(''); setCatalog(master); setProfiles(savedProfiles.profiles)
      setHasMore(bookings.hasMore)
      setRows(detail ? [...bookings.bookings.filter(row => row.id !== detail.id), detail] : bookings.bookings)
      setLastSyncedAt(new Date().toISOString())
    }).catch(error => { if (active) { setRows([]); setLoadError(citizenError(error)) } }).finally(() => { if (active) setLoadedKey(requestKey) })
    return () => { active = false }
  // Revalidate each detail/status/cancellation entry, without reloading on draft edits.
  }, [session.user, detailId, requestKey, pages])
  const shouldAutoPollStatus = Boolean(
    session.user &&
    screen === 'status' &&
    detailId &&
    saved &&
    !['completed', 'cancelled', 'rejected'].includes(saved.status) &&
    !isInteractiveDemoActive(),
  )
  useEffect(() => {
    if (!shouldAutoPollStatus || !detailId) return
    let active = true
    const timer = window.setInterval(() => {
      void citizenRequest<CitizenBooking>(`/bookings/${encodeURIComponent(detailId)}`)
        .then(detail => {
          if (!active) return
          setRows(current => [...current.filter(row => row.id !== detail.id), detail])
          setLastSyncedAt(new Date().toISOString())
        })
        .catch(() => undefined)
    }, 25000)
    return () => { active = false; window.clearInterval(timer) }
  }, [shouldAutoPollStatus, detailId])
  const go = (next = '') => { setErrors({}); navigate(`/booking${next ? `/${next}` : ''}`) }
  const update = <K extends keyof BookingDetails>(key: K, value: BookingDetails[K]) => {
    setDraft(d => ({ ...d, [key]: value }))
    setErrors(e => { const next = { ...e }; delete next[key]; return next })
  }
  useEffect(() => { window.scrollTo(0, 0); root.current?.querySelector<HTMLHeadingElement>('h1')?.focus() }, [pathname])
  useEffect(() => {
    if (!sending && errorFocusPending.current) {
      const invalid = root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      if (invalid) { errorFocusPending.current = false; invalid.focus() }
    }
  }, [errors, sending, pathname])
  useEffect(() => {
    return () => { locationRequest.current += 1 }
  }, [pathname])
  function useCurrentLocation() {
    if (locating) return
    setLocationError('')
    if (!window.isSecureContext || !navigator.geolocation) {
      setLocationError('อุปกรณ์หรือการเชื่อมต่อนี้ไม่รองรับตำแหน่ง กรุณาเปิดผ่าน HTTPS หรือเลือกจุดรับเอง')
      return
    }
    const request = ++locationRequest.current
    setLocatingPath(pathname)
    navigator.geolocation.getCurrentPosition(position => {
      if (request !== locationRequest.current) { setLocatingPath(null); return }
      setLocatingPath(null)
      const { latitude, longitude, accuracy } = position.coords
      const pickup = { x: 50, y: 50, latitude, longitude, accuracy, label: `ตำแหน่งปัจจุบัน (${latitude.toFixed(6)}, ${longitude.toFixed(6)})` }
      update('pickup', pickup)
    }, error => {
      if (request !== locationRequest.current) { setLocatingPath(null); return }
      setLocatingPath(null)
      setLocationError(error.code === 1 ? 'กรุณาอนุญาตให้เว็บไซต์เข้าถึงตำแหน่งในการตั้งค่าเบราว์เซอร์ หรือเลือกจุดรับเอง' : error.code === 3 ? 'ใช้เวลาค้นหาตำแหน่งนานเกินไป กรุณาลองอีกครั้ง หรือเลือกจุดรับเอง' : 'ไม่สามารถรับตำแหน่งจากอุปกรณ์ได้ กรุณาลองอีกครั้ง หรือเลือกจุดรับเอง')
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  }
  function showErrors(next: Record<string, string>) {
    errorFocusPending.current = true
    setErrors(next)
  }
  function showFieldError(error: unknown) {
    if (error instanceof ApiError && error.field) {
      const field = ({ contactPhone: 'phone', requesterName: 'contactName', latitude: 'pickup', longitude: 'pickup', hospitalId: 'hospital', mobility: 'assistance', assistance: 'extras' } as Record<string, string>)[error.field] ?? error.field
      go(['patientName', 'contactName', 'phone', 'hospital'].includes(field) ? 'patient' : 'assistance')
      showErrors({ [field]: 'กรุณาตรวจสอบข้อมูลในช่องนี้อีกครั้ง' })
    }
  }
  function patientNext() {
    const next = validatePatient(draft)
    if (Object.keys(next).length) showErrors(next)
    else if (slotCapacity && !slotCapacity.available) showErrors({ time: slotCapacity.message })
    else go('assistance')
  }
  function assistanceNext() {
    const next = validatePickup(draft)
    if (Object.keys(next).length) { showErrors(next); return }
    if (slotCapacity && !slotCapacity.available) { showErrors({ assistance: slotCapacity.message }); return }
    go('review')
  }
  async function submit() {
    if (sendingRef.current) return
    if (submittedId.current) { go(`submitted/${submittedId.current}`); return }
    if (!pendingIntake.current) {
      const next = validatePatient(draft)
      if (Object.keys(next).length) { go('patient'); showErrors(next); return }
      if (!currentConsent) { go('privacy'); return }
      const pickupErrors = validatePickup(draft)
      if (Object.keys(pickupErrors).length) { go('assistance'); showErrors(pickupErrors); return }
      if (slotCapacity && !slotCapacity.available) {
        setSaveError(slotCapacity.message)
        setCapacitySuggestionTimes(slotCapacity.alternativeTimes)
        return
      }
    }
    sendingRef.current = true
    setSending(true)
    setSaveError('')
    setCapacitySuggestionTimes([])
    // Yield a paint so the reference's submitting state is announced before the local save.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    try {
      if (!pendingIntake.current) {
        if (!currentConsent) { go('privacy'); return }
        const latestErrors = validatePatient(draft)
        if (Object.keys(latestErrors).length) { go('patient'); showErrors(latestErrors); return }
        const config = await refreshCitizenConfig()
        if (config.noticeVersion !== currentConsent.version) { setConsent(null); update('acknowledged', false); go('privacy'); return }
        let submission = draft
        if (saveProfile) {
          const profile = await citizenRequest<PatientProfile>(draft.patientProfileId ? `/profiles/${draft.patientProfileId}` : '/profiles', { ...profileFields(draft), consentId: currentConsent.id })
          setProfiles(current => [...current.filter(row => row.id !== profile.id), profile])
          update('patientProfileId', profile.id)
          submission = { ...draft, patientProfileId: profile.id }
        }
        pendingIntake.current = { ...intakeFields(submission, currentConsent.id), requestId: crypto.randomUUID() }
      }
      const booking = await citizenRequest<CitizenBooking>('/bookings', pendingIntake.current)
      pendingIntake.current = null; setIntakeUncertain(false)
      setRows(current => [...current.filter(row => row.id !== booking.id), booking])
      if (overlay.active && !isInteractiveDemoActive()) {
        seedOverlay.addBooking(citizenBooking(booking, catalog))
      }
      submittedId.current = booking.id
      go(`submitted/${booking.id}`)
    } catch (error) {
      if (error instanceof ApiError && [400,403,404,409,415,422].includes(error.status)) pendingIntake.current = null
      setIntakeUncertain(!!pendingIntake.current)
      setSaveError(citizenError(error))
      if (error instanceof ApiError && error.code === 'CAPACITY_FULL') {
        setCapacitySuggestionTimes(error.alternativeTimes ?? slotCapacity?.alternativeTimes ?? [])
      }
      if (error instanceof ApiError && error.field === 'consentId') {
        setConsent(null); update('acknowledged', false); setConsentError('กรุณาอ่านประกาศและบันทึกการตัดสินใจล่าสุดอีกครั้ง')
        await refreshCitizenConfig().catch(() => undefined)
        go('privacy'); return
      }
      showFieldError(error)
    }
    finally { setSending(false); sendingRef.current = false }
  }
  const field = (key: 'patientName' | 'contactName' | 'phone', label: string, placeholder: string) => <div className="booking-field"><label htmlFor={key}>{label} *</label><input id={key} name={key} required value={draft[key]} type={key === 'phone' ? 'tel' : 'text'} inputMode={key === 'phone' ? 'tel' : 'text'} autoComplete={key === 'phone' ? 'tel' : key === 'contactName' || draft.bookingFor === 'self' ? 'name' : 'off'} placeholder={placeholder}  aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${key}-error` : undefined} onChange={e => update(key, e.target.value)} />{error(key)}</div>
  const error = (key: string) => errors[key] ? <span className="booking-error" id={`${key}-error`} role="alert">{errors[key]}</span> : null
  const selection = (key: 'hospital' | 'relationship', label: string, placeholder: string, values: string[]) => <div className="booking-field"><label htmlFor={key}>{label} *</label><select id={key} required value={draft[key]} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${key}-error` : undefined} onChange={e => update(key, e.target.value)}><option value="">{placeholder}</option>{values.map(value => <option key={value}>{value}</option>)}</select>{error(key)}</div>
  const edit = (target: string, label: string) => <button type="button" disabled={sending || intakeUncertain} className="booking-edit" aria-label={`แก้ไข ${label}`} onClick={() => go(target)}>แก้ไข</button>
  function start() {
    const next = initialBookingForm()
    submittedId.current = null
    pendingIntake.current = null
    setIntakeUncertain(false)
    setDraft(next)
    setLocationError('')
    setConsent(null); setSaveProfile(false); setSaveError('')
    go('privacy')
  }
  function openPin() { root.current?.querySelector<HTMLElement>('.pickup-map-frame')?.focus() }
  function selectPoint(latitude: number, longitude: number, label?: string) {
    locationRequest.current += 1
    setLocatingPath(null)
    update('pickup', { x: 50, y: 50, latitude, longitude, label: label || 'จุดรับที่เลือกบนแผนที่' })
  }
  async function decideConsent(accepted: boolean) {
    if (consentBusy || !session.config || !session.user) return
    setConsentBusy(true); setConsentError('')
    try {
      const config = await refreshCitizenConfig()
      if (!config || config.noticeVersion !== session.config.noticeVersion || config.noticeText !== session.config.noticeText) {
        setConsent(null); update('acknowledged', false); setConsentError('ประกาศเปลี่ยนแล้ว กรุณาอ่านประกาศล่าสุดและยืนยันอีกครั้ง'); return
      }
      const result = await citizenRequest<{ id: string }>('/consents', { accepted, noticeVersion: config.noticeVersion })
      if (accepted) { setConsent({ id: result.id, version: config.noticeVersion, owner: session.user.id }); go('patient') }
      else { setConsent(null); update('acknowledged', false); setConsentDeclined(true) }
    } catch (error) { setConsentError(citizenError(error)) }
    finally { setConsentBusy(false) }
  }
  async function cancelOwn() {
    if (!savedRow || cancelling || !canCitizenCancel(savedRow)) return
    setCancelling(true); setCancelError('')
    try {
      const result = await citizenRequest<CitizenBooking>(`/bookings/${savedRow.id}/commands`, { eventId: crypto.randomUUID(), expectedRevision: savedRow.revision, expectedExecutionVersion: savedRow.executionVersion, command: { type: 'CANCEL', reason: 'ผู้จองยกเลิกก่อนคนขับเริ่มงาน' } })
      setRows(current => current.map(row => row.id === result.id ? result : row)); go(`status/${result.id}`)
    } catch (error) { setCancelError(citizenError(error)) }
    finally { setCancelling(false) }
  }
  let content: ReactNode
  if (!session.user || session.busy) return <div className="booking-shell"><main className="booking-screen"><BookingHeader title="จองรถไปโรงพยาบาล" /><p role="status">{session.busy ? 'กำลังยืนยันตัวตนผ่าน LINE…' : session.error}</p><p className="booking-notice">บริการรับส่งตามนัดหมาย ไม่ใช่บริการฉุกเฉิน</p><EmergencyLink />{!session.busy && <><BookingButton onClick={() => void initializeCitizen(true)}>ลองเชื่อมต่อ LINE อีกครั้ง</BookingButton><BookingButton secondary onClick={() => void enterDemoCitizen()}>เข้าใช้งานโหมดสาธิต (ไม่ใช้ LINE)</BookingButton></>}{session.config?.contactPhone && <a className="booking-home-link" href={`tel:${session.config.contactPhone}`}>ติดต่อเทศบาล {session.config.contactPhone}</a>}</main></div>
  if (['patient', 'assistance', 'pickup', 'review'].includes(screen) && !currentConsent) return <Navigate to="/booking/privacy" replace />
  if (['submitted', 'status', 'cancel'].includes(screen) && !saved && !loading && !loadError) return <Navigate to="/booking/bookings" replace />
  if (loading || loadError) content = <><BookingHeader title="รายการจองรถ" /><p role={loadError ? 'alert' : 'status'}>{loadError || 'กำลังโหลดข้อมูล…'}</p><BookingButton disabled={loading} onClick={() => setVersion(value => value + 1)}>โหลดข้อมูลล่าสุด</BookingButton></>
  else if (screen === '') content = <>
    <BookingHeader title="จองรถไปโรงพยาบาล" />
    <section className="booking-hero"><div className="booking-hero-icons"><BookingIcon name="medical" /><BookingIcon name="ambulance" /><BookingIcon name="pin" /></div><h2>จองรถรับส่งผู้ป่วย</h2><p>จองง่ายใน 3 ขั้นตอน</p></section>
    <BookingButton onClick={start}>เริ่มจองรถ →</BookingButton><BookingButton secondary onClick={() => go('bookings')}>ดูสถานะการจอง</BookingButton>
    <ol className="booking-entry-steps">{['กรอกข้อมูล', 'เลือกจุดรับ', 'รอการยืนยัน'].map((label, i) => <li key={label}><strong>{i + 1}</strong><span>{label}</span></li>)}</ol><p className="booking-notice">จองล่วงหน้า 2 วัน (48 ชั่วโมง)</p>
  </>
  else if (screen === 'privacy') content = <>
    <BookingHeader title="ข้อมูลส่วนบุคคล" subtitle="ขอใช้ข้อมูลเพื่อจัดรถให้คุณ" />
    <section className="booking-hero"><BookingIcon name="shield" /><h2>ดูแลข้อมูลส่วนบุคคล</h2></section><h2 className="booking-section-title">ข้อมูลที่จำเป็น</h2>
    <BookingCard icon="user" title="ข้อมูลผู้ป่วย"><p>ชื่อและเบอร์ติดต่อ</p></BookingCard><BookingCard icon="smallPin" title="จุดรับผู้ป่วย"><p>สำหรับวางแผนการรับส่ง</p></BookingCard><BookingCard icon="smallMedical" title="ข้อมูลการเดินทาง"><p>วันนัดและความช่วยเหลือ</p></BookingCard>
    <p className="booking-small">ไม่ต้องกรอกโรคหรือประวัติการรักษา</p><button type="button" className="booking-text-link" onClick={() => setPrivacyOpen(true)}>อ่านประกาศความเป็นส่วนตัว</button><label className="booking-checkbox"><input type="checkbox" checked={draft.acknowledged} onChange={e => update('acknowledged', e.target.checked)} /><span>รับทราบการใช้ข้อมูล<span className="booking-consent-detail">ยินยอมให้ใช้เพื่อจัดรถรับส่ง</span></span></label>
    <p className="booking-info" style={{ whiteSpace: 'pre-wrap' }}>{session.config?.noticeText || 'ประกาศความเป็นส่วนตัวยังไม่พร้อม กรุณาติดต่อเทศบาล'}</p>
    <p className="booking-small">ฉบับ {session.config?.noticeVersion}</p>
    {consentError && <p role="alert" className="booking-error-box">{consentError}</p>}
    <BookingButton disabled={!draft.acknowledged || consentBusy || !session.config?.noticeText.trim()} aria-busy={consentBusy} onClick={() => void decideConsent(true)}>{consentBusy ? 'กำลังบันทึก…' : 'รับทราบและถัดไป'}</BookingButton>
    <BookingButton secondary className="booking-decline-btn" disabled={consentBusy} aria-busy={consentBusy} onClick={() => void decideConsent(false)}>ไม่ยินยอมใช้ข้อมูล</BookingButton><Link className="booking-home-link" to="/booking" onClick={() => setErrors({})}>กลับหน้าหลัก</Link>
  </>
  else if (screen === 'patient') content = <>
    <BookingHeader title="ข้อมูลผู้ป่วย" subtitle="ใครต้องการใช้รถรับส่ง?" /><BookingProgress step={1} />
    <div className="booking-tabs" role="group" aria-label="ประเภทการจอง">{(['self', 'other'] as const).map(value => <button type="button" aria-pressed={draft.bookingFor === value} key={value} onClick={() => { update('bookingFor', value); setErrors({}) }}>{value === 'self' ? 'จองให้ตนเอง' : 'จองให้ผู้อื่น'}</button>)}</div>
    <p className="booking-small">ช่องที่มี * จำเป็นต้องกรอก</p><form className="booking-form" noValidate onSubmit={e => { e.preventDefault(); patientNext() }}>
      {profiles.length > 0 && <label className="booking-field">ข้อมูลผู้ป่วยที่บันทึกไว้<select value={draft.patientProfileId ?? ''} onChange={event => { const profile = profiles.find(row => row.id === event.target.value); locationRequest.current += 1; setDraft(current => profile ? applyProfile(current, profile) : { ...current, patientProfileId: undefined }) }}><option value="">กรอกข้อมูลเอง</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.patientName}</option>)}</select><span className="booking-small">โปรดตรวจสอบข้อมูลก่อนส่งคำขอ</span></label>}
      {field('patientName', 'ชื่อผู้ป่วย', 'ชื่อและนามสกุล')}
      {draft.bookingFor === 'other' && field('contactName', 'ชื่อผู้ดูแล / ผู้ติดต่อ', 'ชื่อผู้จองหรือผู้ดูแล')}
      {field('phone', draft.bookingFor === 'self' ? 'เบอร์โทรศัพท์ของคุณ' : 'เบอร์โทรศัพท์ผู้ติดต่อ', '08X-XXX-XXXX')}
      {draft.bookingFor === 'other' && selection('relationship', 'ความสัมพันธ์กับผู้ป่วย', 'เลือกความสัมพันธ์ เช่น บุตร / ญาติ / ผู้ดูแล', ['บุตร', 'ญาติ', 'ผู้ดูแล'])}
      <div className="booking-field"><label htmlFor="hospital">โรงพยาบาล *</label><select id="hospital" value={draft.hospital} required aria-invalid={!!errors.hospital} onChange={event => update('hospital', event.target.value)}><option value="">เลือกโรงพยาบาล</option>{catalog.hospitals.map(hospital => <option key={hospital.id} value={hospital.id}>{hospital.name}</option>)}</select>{error('hospital')}</div>
      {(['date', 'time'] as const).map(kind => <div className="booking-field" key={kind}><label id={`${kind}-label`}>{kind === 'date' ? 'วันนัดหมาย' : 'เวลานัดหมาย'} *</label><button type="button" className="booking-input-trigger" aria-labelledby={`${kind}-label ${kind}-value`} aria-haspopup="dialog" aria-invalid={!!errors[kind]} aria-describedby={errors[kind] ? `${kind}-error` : undefined} onClick={() => setPicker(kind)}><span id={`${kind}-value`}>{kind === 'date' ? draft.date ? thaiDate(draft.date, true) : '📅 เลือกวันนัดหมาย' : draft.time ? `${draft.time} น.` : '◷ เลือกชั่วโมงและนาที'}</span><span aria-hidden="true">›</span></button>{error(kind)}</div>)}
      {slotCapacity && !slotCapacity.available && <div className="booking-capacity-alert" role="alert"><strong>ช่วงเวลาเต็ม / รถไม่ว่าง</strong><p>{slotCapacity.message}</p><p className="booking-capacity-window">ช่วงเวลาทำงานของรถที่คำนวณ: {slotCapacity.window.windowLabel} (เวลารับประมาณ {slotCapacity.window.pickupClock} น.)</p>{slotCapacity.alternativeTimes.length > 0 && <div className="booking-capacity-suggestions"><span>เลือกเวลานัดอื่นที่ว่าง:</span><div className="booking-capacity-alt-buttons">{slotCapacity.alternativeTimes.map(timeSlot => <button type="button" key={timeSlot} className="booking-capacity-alt-btn" onClick={() => { update('time', timeSlot); setSaveError(''); setCapacitySuggestionTimes([]) }}>เลือกเวลา {timeSlot} น.</button>)}</div></div>}</div>}
      <p className="booking-notice">จองล่วงหน้า 2 วัน (48 ชั่วโมง)</p><BookingButton type="submit">ถัดไป →</BookingButton>
    </form><BookingButton secondary onClick={() => go('privacy')}>ย้อนกลับ</BookingButton>
  </>
  else if (screen === 'assistance') content = <>
    <BookingHeader title="การช่วยเหลือและจุดรับ" subtitle="ผู้ป่วยเดินทางแบบไหน?" /><BookingProgress step={2} /><h2 className="booking-section-title">การช่วยเหลือ</h2>
    <div className="booking-assistance" role="group" aria-label="การช่วยเหลือ" tabIndex={errors.assistance ? -1 : undefined} aria-invalid={!!errors.assistance} aria-describedby={errors.assistance ? 'assistance-error' : undefined}>{(['เดินได้', 'รถเข็น', 'เปลนอน'] as const).map((label, i) => <button type="button" key={label} aria-pressed={draft.assistance === label} onClick={() => update('assistance', label)}><BookingIcon name={(['walk', 'wheel', 'bed'] as const)[i]} />{label}</button>)}</div>{error('assistance')}
    {slotCapacity && !slotCapacity.available && <div className="booking-capacity-alert" role="alert"><strong>ช่วงเวลาเต็ม / รถไม่ว่าง</strong><p>{slotCapacity.message}</p><p className="booking-capacity-window">ช่วงเวลาทำงานของรถที่คำนวณ: {slotCapacity.window.windowLabel}</p><div className="booking-capacity-suggestions">{slotCapacity.alternativeTimes.length > 0 && <div className="booking-capacity-alt-buttons">{slotCapacity.alternativeTimes.map(timeSlot => <button type="button" key={timeSlot} className="booking-capacity-alt-btn" onClick={() => { update('time', timeSlot); setSaveError(''); setCapacitySuggestionTimes([]) }}>เลือกเวลา {timeSlot} น.</button>)}</div>}<button type="button" className="booking-capacity-alt-btn secondary" onClick={() => go('patient')}>เปลี่ยนวัน/เวลานัดหมาย</button></div></div>}
    <h2 className="booking-section-title">ต้องการให้ช่วยอะไรอีก?</h2>
    <div className="booking-extras" role="group" aria-label="ความช่วยเหลือเพิ่มเติม" tabIndex={errors.extras ? -1 : undefined} aria-invalid={!!errors.extras} aria-describedby={errors.extras ? 'extras-error' : undefined}><label className="booking-checkbox"><input type="checkbox" checked={draft.extras.length === 0} onChange={() => update('extras', [])} />ไม่ต้องการความช่วยเหลือเพิ่มเติม</label>{['ต้องการผู้ช่วยพยุงขึ้น-ลงรถ', 'มีผู้ดูแลเดินทางไปด้วย'].map(label => <label className="booking-checkbox" key={label}><input type="checkbox" checked={draft.extras.includes(label)} onChange={e => update('extras', e.target.checked ? [...draft.extras, label] : draft.extras.filter(x => x !== label))} />{label}</label>)}</div>{error('extras')}
    <h2 className="booking-section-title">จุดรับผู้ป่วย</h2>
    <div className="booking-location-controls"><PickupMap value={draft.pickup} onChange={selectPoint} />
    <BookingButton secondary className="booking-location-button" aria-pressed={gpsActive} disabled={locating} onClick={useCurrentLocation}>{locating ? 'กำลังค้นหาตำแหน่ง…' : gpsActive ? '✓ ใช้ตำแหน่งปัจจุบันแล้ว' : 'ใช้ตำแหน่งปัจจุบัน'}</BookingButton>
    </div>
    <label className="booking-field">หมู่บ้านในเขตบริการ *<select value={draft.villageId ?? ''} aria-invalid={!!errors.villageId} onChange={event => update('villageId', event.target.value)}><option value="">เลือกหมู่บ้าน</option>{catalog.villages.map(village => <option key={village.id} value={village.id}>หมู่ {village.number} · {village.name}</option>)}</select>{error('villageId')}</label>
    <label className="booking-field">ที่อยู่จุดรับ *<input value={draft.pickupAddress ?? ''} autoComplete="street-address" placeholder="บ้านเลขที่ หมู่บ้าน ตำบล" aria-invalid={!!errors.pickupAddress} onChange={event => update('pickupAddress', event.target.value)} />{error('pickupAddress')}</label>
    <label className="booking-field">จุดสังเกต<input value={draft.landmark ?? ''} aria-invalid={!!errors.landmark} onChange={event => update('landmark', event.target.value)} />{error('landmark')}</label>
    <details className="booking-address-fallback"><summary>เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง</summary><p className="booking-small">ที่อยู่ต้องมีพิกัดและอยู่ในหมู่บ้านที่ให้บริการ หากไม่ทราบพิกัด กรุณาติดต่อเทศบาล</p>{(['latitude', 'longitude'] as const).map(key => <label key={key} className="booking-field">{key === 'latitude' ? 'ละติจูด' : 'ลองจิจูด'}<input type="number" step="any" value={draft.pickup?.[key] ?? ''} onChange={event => { locationRequest.current += 1; setLocatingPath(null); const value = event.target.value === '' ? undefined : Number(event.target.value); update('pickup', { x: 50, y: 50, label: 'จุดรับที่ระบุพิกัดเอง', ...draft.pickup, [key]: value, accuracy: undefined }) }} /></label>)}</details>
    <section className="booking-pickup-value" tabIndex={errors.pickup ? -1 : undefined} aria-invalid={!!errors.pickup} aria-describedby={errors.pickup ? 'pickup-error' : undefined}><p>จุดรับที่เลือก</p>{(draft.pickup || !errors.pickup) && <strong>{draft.pickup ? formatPickupSummary(draft.pickupAddress, draft.pickup.label) : 'กรุณาเลือกจุดรับก่อนดำเนินการ'}</strong>}{error('pickup')}</section>
    <p className="booking-info">ตรวจสอบจุดรับบนแผนที่ หรือที่อยู่ที่ระบุ ก่อนดำเนินการต่อ</p>
    <div className="booking-pickup-actions"><BookingButton onClick={assistanceNext}>ถัดไป →</BookingButton><BookingButton secondary onClick={() => go('patient')}>ย้อนกลับ</BookingButton></div>
  </>
  else if (screen === 'pickup') return <Navigate to="/booking/assistance" replace />
  else if (screen === 'review') content = sending ? <><BookingHeader title="กำลังส่งคำขอ" subtitle="กรุณารอสักครู่" /><section className="booking-hero" role="status"><h2>กำลังส่งคำขอจองรถ</h2><p>โปรดอย่ากดส่งซ้ำ</p></section><BookingButton disabled>กำลังส่งคำขอ…</BookingButton></> : <>
    <BookingHeader title="ตรวจสอบข้อมูล" subtitle="ถูกต้องแล้ว กดส่งคำขอได้เลย" /><BookingProgress step={3} />
    <section className="booking-review-section"><header><h2>ข้อมูลผู้ป่วย</h2>{edit('patient', 'ข้อมูลผู้ป่วย')}</header><dl>
      <div><dt>ชื่อผู้ป่วย</dt><dd>{draft.patientName}</dd></div>
      <div><dt>{draft.bookingFor === 'self' ? 'เบอร์โทรศัพท์' : 'เบอร์โทรศัพท์ผู้ติดต่อ'}</dt><dd>{draft.phone}</dd></div>
      {draft.bookingFor === 'other' && <><div><dt>ชื่อผู้ดูแล / ผู้ติดต่อ</dt><dd>{draft.contactName}</dd></div><div><dt>ความสัมพันธ์กับผู้ป่วย</dt><dd>{draft.relationship}</dd></div></>}
    </dl></section>
    <section className="booking-review-section booking-review-appointment"><header><h2>วันนัดหมาย</h2>{edit('patient', 'วันนัดหมาย')}</header><dl>
      <div><dt>โรงพยาบาล</dt><dd>{catalog.hospitals.find(row => row.id === draft.hospital)?.name}</dd></div>
      <div><dt>วันที่นัดหมาย</dt><dd>{thaiDate(draft.date)}</dd></div>
      <div><dt>เวลานัดหมาย</dt><dd className="booking-review-time">{draft.time} น.</dd></div>
    </dl></section>
    <section className="booking-review-section"><header><h2>ความช่วยเหลือ</h2>{edit('assistance', 'ความช่วยเหลือ')}</header><dl>
      <div><dt>การเดินทางของผู้ป่วย</dt><dd>{draft.assistance}</dd></div>
      <div><dt>ความช่วยเหลือเพิ่มเติม</dt><dd>{draft.extras.length ? <ul>{draft.extras.map(extra => <li key={extra}>{extra}</li>)}</ul> : 'ไม่ต้องการความช่วยเหลือเพิ่มเติม'}</dd></div>
    </dl></section>
    <section className="booking-review-section"><header><h2>จุดรับผู้ป่วย</h2>{edit('assistance', 'จุดรับผู้ป่วย')}</header><dl><div><dt>สถานที่รับ</dt><dd>{formatPickupSummary(draft.pickupAddress, draft.pickup?.label)}</dd></div><div><dt>หมู่บ้าน</dt><dd>{catalog.villages.find(row => row.id === draft.villageId)?.name}</dd></div>{draft.landmark && <div><dt>จุดสังเกต</dt><dd>{draft.landmark}</dd></div>}</dl></section>
    <div className="booking-profile-save-group">
      <label className="booking-checkbox"><input type="checkbox" checked={saveProfile} onChange={event => setSaveProfile(event.target.checked)} />บันทึกข้อมูลผู้ป่วยไว้ใช้ครั้งต่อไป</label>
      <p className="booking-profile-hint">ระบบจะบันทึกหรืออัปเดตข้อมูลนี้ให้อัตโนมัติเมื่อกดยืนยันคำขอ</p>
    </div>
    {slotCapacity && !slotCapacity.available && !saveError && <div className="booking-capacity-alert" role="alert"><strong>ช่วงเวลาเต็ม / รถไม่ว่าง</strong><p>{slotCapacity.message}</p>{slotCapacity.alternativeTimes.length > 0 && <div className="booking-capacity-alt-buttons">{slotCapacity.alternativeTimes.map(timeSlot => <button type="button" key={timeSlot} className="booking-capacity-alt-btn" onClick={() => { update('time', timeSlot); setSaveError(''); setCapacitySuggestionTimes([]) }}>เลือกเวลา {timeSlot} น.</button>)}</div>}</div>}
    {saveError && <><div role="alert" className="booking-error-box"><p>{saveError}</p>{capacitySuggestionTimes.length > 0 && <div className="booking-capacity-alt-buttons">{capacitySuggestionTimes.map(timeSlot => <button type="button" key={timeSlot} className="booking-capacity-alt-btn" onClick={() => { update('time', timeSlot); setSaveError(''); setCapacitySuggestionTimes([]) }}>เปลี่ยนเป็นเวลา {timeSlot} น.</button>)}</div>}</div><BookingButton secondary onClick={() => go('bookings')}>ตรวจสอบรายการจองล่าสุดก่อนส่งซ้ำ</BookingButton></>}
    {intakeUncertain && <p role="status" className="booking-small">กำลังตรวจสอบคำขอก่อนหน้า การลองอีกครั้งจะใช้คำขอเดิมเพื่อป้องกันรายการซ้ำ</p>}
    <BookingButton disabled={sending} aria-busy={sending} onClick={() => void submit()}>{saveError ? 'ลองส่งคำขออีกครั้ง' : 'ยืนยันและส่งคำขอ'}</BookingButton><BookingButton secondary disabled={intakeUncertain} onClick={() => go('assistance')}>ย้อนกลับ</BookingButton>
  </>
  else if (screen === 'submitted' && saved) content = <>
    <BookingHeader title="ส่งคำขอแล้ว" subtitle="เก็บหมายเลขคำขอไว้เพื่อติดตามสถานะ" />
    <BookingSummaryCard booking={saved} statusLabel={statusLabels[saved.apiStatus!]} />
    <p className="booking-small">แจ้งผลการพิจารณาและเวลารับผ่าน LINE</p>
    <BookingButton onClick={() => go(`status/${saved.id}`)}>ดูสถานะการจอง</BookingButton><Link className="booking-home-link" to="/booking" onClick={() => setErrors({})}>กลับหน้าหลัก</Link>
  </>
  else if (screen === 'bookings') {
    const sortedBookings = [...state.bookings].sort((a, b) => {
      const createdA = a.createdAt ? Date.parse(a.createdAt) : Number.NaN
      const createdB = b.createdAt ? Date.parse(b.createdAt) : Number.NaN
      if (Number.isFinite(createdA) && Number.isFinite(createdB) && createdA !== createdB) return createdB - createdA
      if (Number.isFinite(createdA) !== Number.isFinite(createdB)) return Number.isFinite(createdB) ? 1 : -1
      const apptA = Date.parse(a.appointmentAt)
      const apptB = Date.parse(b.appointmentAt)
      if (Number.isFinite(apptA) && Number.isFinite(apptB) && apptA !== apptB) return apptB - apptA
      return b.id.localeCompare(a.id)
    })
    content = <>
      <BookingHeader title="รายการจองของฉัน" subtitle={sortedBookings.length ? 'ดูสถานะและรายละเอียดการจอง' : 'ไม่มีคำขอจองรถในขณะนี้'} />
      <div className="booking-list-toolbar">
        <Link className="booking-home-link booking-list-back" to="/booking" onClick={() => setErrors({})}>← กลับหน้าหลัก</Link>
        <button type="button" className="booking-compact-refresh" disabled={loading} aria-busy={loading} onClick={() => setVersion(value => value + 1)}><span aria-hidden="true">↻</span> โหลดข้อมูลล่าสุด</button>
      </div>
      {sortedBookings.length ? <><div className="booking-list-title"><h2>รายการจองล่าสุด</h2><span>{sortedBookings.length} {hasMore ? 'รายการที่โหลดแล้ว' : 'รายการ'}</span></div>{sortedBookings.map(b => <BookingSummaryCard key={b.id} booking={b} statusLabel={statusLabels[b.apiStatus!]} to={`/booking/status/${b.id}`} />)}{hasMore && <><p className="booking-small">ยังมีรายการจองอื่น กดโหลดรายการเพิ่มเติมเพื่อดูครบ</p><BookingButton secondary disabled={loading} aria-busy={loading} onClick={() => setListRange({ owner: session.user!.id, pages: pages + 1 })}>โหลดรายการเพิ่มเติม</BookingButton></>}</> : <><section className="booking-empty"><span aria-hidden="true">▱</span><h2>ยังไม่มีรายการจอง</h2><p>เริ่มส่งคำขอจองรถได้เลย</p></section><BookingButton onClick={start}>เริ่มจองรถ</BookingButton></>}
    </>
  }
  else if (screen === 'cancel' && saved) content = <>
    <div className="booking-header-with-action">
      <BookingHeader title="ยกเลิกการจอง" subtitle="ตรวจสอบข้อมูลก่อนยืนยันการยกเลิก" />
      <button type="button" className="booking-compact-refresh" disabled={cancelling} onClick={() => setVersion(value => value + 1)}><span aria-hidden="true">↻</span> โหลดข้อมูลล่าสุด</button>
    </div>
    <BookingCard title="หมายเลขการจอง"><p>{saved.reference} · {saved.details?.hospital || 'นัดหมายโรงพยาบาล'}</p></BookingCard>
    <BookingCard title="สถานะที่ยกเลิกได้"><p>ก่อนคนขับเริ่มงานเท่านั้น</p></BookingCard>
    <BookingCard title="หลังยืนยัน"><p>รายการจะถูกยกเลิกและคืนการจองรถและคนขับ</p></BookingCard>
    {!citizenCanCancel() && <p className="booking-error-box" role="alert">ไม่สามารถยกเลิกได้ กรุณาติดต่อเทศบาล</p>}
    {cancelError && <p className="booking-error-box" role="alert">{cancelError}</p>}
    <BookingButton danger disabled={!citizenCanCancel() || cancelling} aria-busy={cancelling} onClick={() => void cancelOwn()}>{cancelling ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิกการจอง'}</BookingButton>
    <BookingButton secondary disabled={cancelling} onClick={() => go(`status/${saved.id}`)}>กลับไปดูรายละเอียด</BookingButton>
  </>
  else if (screen === 'status' && saved) content = <>
    <div className="booking-header-with-action booking-status-header">
      <BookingHeader title="สถานะการจอง" />
      <div className="booking-slip-sync">
        <button type="button" className="booking-compact-refresh" disabled={loading} aria-busy={loading} onClick={() => setVersion(value => value + 1)}>
          <span aria-hidden="true">↻</span> โหลดข้อมูลล่าสุด
        </button>
        {lastSyncedAt && <span className="booking-sync-time">อัปเดตล่าสุด {dispatchTime(lastSyncedAt)} น.</span>}
      </div>
    </div>
    <BookingSummaryCard booking={saved} statusLabel={statusLabels[saved.apiStatus!]} />
    {saved.apiStatus === 'ABORTED' ? <BookingCard title="ยุติการเดินทาง"><p>ไม่ได้ส่งถึงโรงพยาบาล กรุณาติดต่อเทศบาลเพื่อทราบการจัดการต่อ</p></BookingCard> : saved.status === 'cancelled' ? <BookingCard title="ยกเลิกการจองแล้ว"><p>{saved.cancellation?.reason}</p><p>การยกเลิกได้รับการบันทึกแล้ว</p></BookingCard> : saved.status === 'rejected' ? <BookingCard title="ผลการพิจารณา"><p>ไม่อนุมัติคำขอนี้</p><p>เหตุผล: {saved.rejectionReason || 'ยังไม่มีเหตุผลที่บันทึกไว้'}</p><p>หากต้องการความช่วยเหลือ กรุณาติดต่อเทศบาล</p></BookingCard> : saved.status === 'completed' ? <BookingCard title="ผลการเดินทาง"><p>ผู้ป่วยเดินทางถึงโรงพยาบาลแล้ว</p><p>หมายเลขการจอง {saved.reference}</p></BookingCard> : <><h2 className="booking-section-title">ความคืบหน้า</h2><BookingTripTimeline booking={saved} /></>}
    <div className="booking-status-actions">
      {citizenCanCancel() && <BookingButton secondary danger onClick={() => { setCancelError(''); go(`cancel/${saved.id}`) }}>ยกเลิกการจอง</BookingButton>}
      <BookingButton secondary onClick={() => go('bookings')}>รายการจองของฉัน</BookingButton>
    </div>
    <Link className="booking-home-link" to="/booking" onClick={() => setErrors({})}>กลับหน้าหลัก</Link>
  </>
  else return <Navigate to="/booking" replace />
  return <div className="booking-shell"><a className="skip-link" href="#booking-main">ข้ามไปยังเนื้อหา</a><div className="booking-workspace"><main tabIndex={-1} ref={root} id="booking-main" className={`booking-screen booking-screen-${screen || 'entry'} ${screen === 'status' ? `booking-state-${saved?.status}` : ''} ${screen === 'patient' && draft.bookingFor === 'other' ? 'booking-caregiver' : ''}`}>
    {content}
    <p className="booking-notice">บริการรับส่งตามนัดหมาย ไม่ใช่บริการฉุกเฉิน</p><EmergencyLink />
    {session.config?.contactPhone && <a className="booking-home-link" href={`tel:${session.config.contactPhone}`}>ติดต่อเทศบาล {session.config.contactPhone}</a>}
  </main></div>
    {picker && (
      <AppointmentPicker
        kind={picker}
        date={draft.date}
        time={draft.time}
        onClose={() => setPicker(null)}
        onConfirm={value => { update(picker, value); setPicker(null) }}
        onJumpDateTime={(nextDate, nextTime) => {
          setDraft(current => ({ ...current, date: nextDate, time: nextTime }))
          setErrors(current => ({ ...current, date: '', time: '' }))
          setPicker(null)
        }}
      />
    )}
    {consentDeclined && <BookingModal title="ติดต่อเทศบาลเพื่อจองทางโทรศัพท์" onClose={() => setConsentDeclined(false)}><p>คุณเลือกไม่ยินยอมใช้ข้อมูลผ่านระบบออนไลน์ จึงยังไม่สามารถกรอกแบบฟอร์มจองรถได้</p><p>หากต้องการขอรับบริการรถรับ–ส่งผู้ป่วย สามารถโทรติดต่อเจ้าหน้าที่เทศบาลตำบลบ้านกลางเพื่อแจ้งนัดหมายทางโทรศัพท์ได้โดยตรงในเวลาทำการ (06:00–16:00 น.)</p>{session.config?.contactPhone ? <a className="booking-home-link" href={`tel:${session.config.contactPhone}`}>ติดต่อเทศบาล {session.config.contactPhone}</a> : <p>ยังไม่ได้ตั้งค่าหมายเลขเทศบาล กรุณาติดต่อผ่าน LINE OA</p>}<Link className="booking-home-link" to="/booking" onClick={() => { setConsentDeclined(false); setErrors({}) }}>กลับหน้าหลัก</Link></BookingModal>}
    {privacyOpen && <BookingModal title="ข้อมูลส่วนบุคคล" onClose={() => setPrivacyOpen(false)}><p style={{ whiteSpace: 'pre-wrap' }}>{session.config?.noticeText}</p><BookingButton onClick={() => setPrivacyOpen(false)}>ปิด</BookingButton></BookingModal>}
    {locationError && <BookingModal title="ไม่พบตำแหน่งปัจจุบัน" onClose={() => setLocationError('')}><p>ยังจองรถต่อได้โดยปักหมุดเอง</p><section className="booking-empty"><h3>ไม่สามารถดึงตำแหน่งได้</h3><p>{locationError}</p></section><p className="booking-info">เลือกจุดรับบนแผนที่แทนได้</p><BookingButton onClick={() => { setLocationError(''); openPin() }}>เลือกจุดรับบนแผนที่</BookingButton><BookingButton secondary onClick={() => setLocationError('')}>ย้อนกลับ</BookingButton></BookingModal>}
  </div>
}
