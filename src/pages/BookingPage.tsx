import { PickupMap } from '../components/LocationMap'
import { BookingSummaryCard } from '../components/BookingSummaryCard'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { BookingTripTimeline } from '../components/BookingTripTimeline'
import { AppointmentPicker } from '../components/AppointmentPicker'
import { BookingButton, BookingCard, BookingHeader, BookingIcon, BookingModal, BookingProgress, EmergencyLink } from '../components/BookingUI'
import { emptyBooking, thaiDate, validatePatient, validatePickup } from '../services/booking'
import type { BookingDetails } from '../services/booking'
import { statusLabels } from '../services/dispatcherApi'
import { bookingPages } from '../services/bookingPages'
import { citizenRequest, citizenError, initializeCitizen, refreshCitizenConfig, useCitizenSession } from '../services/citizenSession'
import { ApiError } from '../services/api'
import { applyProfile, canCitizenCancel, citizenBooking, intakeFields, profileFields, type CitizenBooking, type CitizenCatalog, type PatientProfile } from '../services/citizenApi'
import '../booking.css'

const initialBookingForm = (): BookingDetails => ({ ...emptyBooking(), pickupAddress: '', villageId: '', landmark: '' })
export function BookingPage() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const path = pathname.replace(/^\/booking\/?/, '').split('/')
  const screen = path[0]
  const session = useCitizenSession()
  const [catalog, setCatalog] = useState<CitizenCatalog>({ hospitals: [], villages: [] })
  const [rows, setRows] = useState<CitizenBooking[]>([])
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
  const [profileError, setProfileError] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
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
  const [saveError, setSaveError] = useState('')
  const sendingRef = useRef(false)
  const submittedId = useRef<string | null>(null)
  const root = useRef<HTMLElement>(null)
  const saved = state.bookings.find(b => b.id === path[1])
  const savedRow = rows.find(row => row.id === path[1])
  const citizenCanCancel = () => canCitizenCancel(savedRow)
  const currentConsent = consent?.owner === session.user?.id && consent?.version === session.config?.noticeVersion ? consent : null
  const previousOwner = useRef<string | null>(null)
  useEffect(() => { void initializeCitizen() }, [])
  useEffect(() => {
    if (!session.user) return
    if (previousOwner.current && previousOwner.current !== session.user.id) {
      setDraft(initialBookingForm()); setConsent(null); submittedId.current = null
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
    }).catch(error => { if (active) { setRows([]); setLoadError(citizenError(error)) } }).finally(() => { if (active) setLoadedKey(requestKey) })
    return () => { active = false }
  // Revalidate each detail/status/cancellation entry, without reloading on draft edits.
  }, [session.user, detailId, requestKey, pages])
  const go = (next = '') => { setErrors({}); navigate(`/booking${next ? `/${next}` : ''}`) }
  const update = <K extends keyof BookingDetails>(key: K, value: BookingDetails[K]) => {
    setDraft(d => ({ ...d, [key]: value }))
    setErrors(e => { const next = { ...e }; delete next[key]; return next })
  }
  useEffect(() => { window.scrollTo(0, 0); root.current?.querySelector<HTMLHeadingElement>('h1')?.focus() }, [pathname])
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
    setErrors(next)
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
  }
  function patientNext() {
    const next = validatePatient(draft)
    if (Object.keys(next).length) showErrors(next)
    else go('assistance')
  }
  function assistanceNext() {
    const next = validatePickup(draft)
    if (Object.keys(next).length) { showErrors(next); return }
    go('review')
  }
  async function submit() {
    if (sendingRef.current) return
    if (submittedId.current) { go(`submitted/${submittedId.current}`); return }
    const next = validatePatient(draft)
    if (Object.keys(next).length) { go('patient'); showErrors(next); return }
    if (!currentConsent) { go('privacy'); return }
    const pickupErrors = validatePickup(draft)
    if (Object.keys(pickupErrors).length) { go('assistance'); showErrors(pickupErrors); return }
    sendingRef.current = true
    setSending(true)
    setSaveError('')
    // Yield a paint so the reference's submitting state is announced before the local save.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    try {
      const latestErrors = validatePatient(draft)
      if (Object.keys(latestErrors).length) { go('patient'); showErrors(latestErrors); return }
      const config = await refreshCitizenConfig()
      if (config.noticeVersion !== currentConsent.version) { setConsent(null); update('acknowledged', false); go('privacy'); return }
      let submission = draft
      if (saveProfile) {
        const profile = await citizenRequest<PatientProfile>(draft.patientProfileId ? `/profiles/${draft.patientProfileId}` : '/profiles', { ...profileFields(draft), consentId: currentConsent.id })
        setProfiles(current => [...current.filter(row => row.id !== profile.id), profile])
        update('patientProfileId', profile.id); setSaveProfile(false)
        submission = { ...draft, patientProfileId: profile.id }
      }
      const booking = await citizenRequest<CitizenBooking>('/bookings', intakeFields(submission, currentConsent.id))
      setRows(current => [...current.filter(row => row.id !== booking.id), booking])
      submittedId.current = booking.id
      go(`submitted/${booking.id}`)
    } catch (error) {
      setSaveError(citizenError(error))
      if (error instanceof ApiError && error.field === 'consentId') {
        setConsent(null); update('acknowledged', false); setConsentError('กรุณาอ่านประกาศและบันทึกการตัดสินใจล่าสุดอีกครั้ง'); go('privacy'); return
      }
      if (error instanceof ApiError && error.field) {
        const field = ({ contactPhone: 'phone', requesterName: 'contactName', latitude: 'pickup', longitude: 'pickup', hospitalId: 'hospital' } as Record<string, string>)[error.field] ?? error.field
        go(['patientName', 'contactName', 'phone', 'hospital'].includes(field) ? 'patient' : 'assistance')
        showErrors({ [field]: 'กรุณาตรวจสอบข้อมูลในช่องนี้อีกครั้ง' })
      }
    }
    finally { setSending(false); sendingRef.current = false }
  }
  const field = (key: 'patientName' | 'contactName' | 'phone', label: string, placeholder: string) => <div className="booking-field"><label htmlFor={key}>{label} *</label><input id={key} name={key} required value={draft[key]} type={key === 'phone' ? 'tel' : 'text'} inputMode={key === 'phone' ? 'tel' : 'text'} autoComplete={key === 'phone' ? 'tel' : key === 'contactName' || draft.bookingFor === 'self' ? 'name' : 'off'} placeholder={placeholder}  aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${key}-error` : undefined} onChange={e => update(key, e.target.value)} />{error(key)}</div>
  const error = (key: string) => errors[key] ? <span className="booking-error" id={`${key}-error`} role="alert">{errors[key]}</span> : null
  const selection = (key: 'hospital' | 'relationship', label: string, placeholder: string, values: string[]) => <div className="booking-field"><label htmlFor={key}>{label} *</label><select id={key} required value={draft[key]} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${key}-error` : undefined} onChange={e => update(key, e.target.value)}><option value="">{placeholder}</option>{values.map(value => <option key={value}>{value}</option>)}</select>{error(key)}</div>
  const edit = (target: string, label: string) => <button type="button" disabled={profileBusy || sending} className="booking-edit" aria-label={`แก้ไข ${label}`} onClick={() => go(target)}>แก้ไข</button>
  function start() {
    const next = initialBookingForm()
    submittedId.current = null
    setDraft(next)
    setLocationError('')
    setConsent(null); setSaveProfile(false); setProfileError(''); setSaveError('')
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
  async function persistProfile() {
    if (profileBusy || !currentConsent) return
    setProfileBusy(true); setProfileError('')
    try {
      const profile = await citizenRequest<PatientProfile>(draft.patientProfileId ? `/profiles/${draft.patientProfileId}` : '/profiles', { ...profileFields(draft), consentId: currentConsent.id })
      setProfiles(current => [...current.filter(row => row.id !== profile.id), profile]); update('patientProfileId', profile.id)
      setSaveProfile(false)
    } catch (error) {
      setProfileError(citizenError(error))
      if (error instanceof ApiError && error.field === 'consentId') {
        setConsent(null); update('acknowledged', false); go('privacy')
      }
    }
    finally { setProfileBusy(false) }
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
  if (!session.user || session.busy) return <div className="booking-shell"><main className="booking-screen"><BookingHeader title="จองรถไปโรงพยาบาล" /><p role="status">{session.busy ? 'กำลังยืนยันตัวตนผ่าน LINE…' : session.error}</p><p className="booking-notice">บริการรับส่งตามนัดหมาย ไม่ใช่บริการฉุกเฉิน</p><EmergencyLink />{!session.busy && <BookingButton onClick={() => void initializeCitizen()}>ลองเชื่อมต่อ LINE อีกครั้ง</BookingButton>}{session.config?.contactPhone && <a className="booking-home-link" href={`tel:${session.config.contactPhone}`}>ติดต่อเทศบาล {session.config.contactPhone}</a>}</main></div>
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
    <BookingButton disabled={!draft.acknowledged || consentBusy || !session.config?.noticeText.trim()} onClick={() => void decideConsent(true)}>รับทราบและถัดไป</BookingButton>
    <BookingButton secondary disabled={consentBusy} onClick={() => void decideConsent(false)}>ไม่ยินยอมใช้ข้อมูล</BookingButton><Link className="booking-home-link" to="/booking" onClick={() => setErrors({})}>กลับหน้าหลัก</Link>
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
      <p className="booking-notice">จองล่วงหน้า 2 วัน (48 ชั่วโมง)</p><BookingButton type="submit">ถัดไป →</BookingButton>
    </form><BookingButton secondary onClick={() => go('privacy')}>ย้อนกลับ</BookingButton>
  </>
  else if (screen === 'assistance') content = <>
    <BookingHeader title="การช่วยเหลือและจุดรับ" subtitle="ผู้ป่วยเดินทางแบบไหน?" /><BookingProgress step={2} /><h2 className="booking-section-title">การช่วยเหลือ</h2>
    <div className="booking-assistance" role="group" aria-label="การช่วยเหลือ">{(['เดินได้', 'รถเข็น', 'เปลนอน'] as const).map((label, i) => <button type="button" key={label} aria-pressed={draft.assistance === label} onClick={() => update('assistance', label)}><BookingIcon name={(['walk', 'wheel', 'bed'] as const)[i]} />{label}</button>)}</div>
    <h2 className="booking-section-title">ต้องการให้ช่วยอะไรอีก?</h2>
    <div className="booking-extras"><label className="booking-checkbox"><input type="checkbox" checked={draft.extras.length === 0} onChange={() => update('extras', [])} />ไม่ต้องการความช่วยเหลือเพิ่มเติม</label>{['ต้องการผู้ช่วยพยุงขึ้น-ลงรถ', 'มีผู้ดูแลเดินทางไปด้วย'].map(label => <label className="booking-checkbox" key={label}><input type="checkbox" checked={draft.extras.includes(label)} onChange={e => update('extras', e.target.checked ? [...draft.extras, label] : draft.extras.filter(x => x !== label))} />{label}</label>)}</div>
    <h2 className="booking-section-title">จุดรับผู้ป่วย</h2>
    <div className="booking-location-controls"><PickupMap value={draft.pickup} onChange={selectPoint} />
    <BookingButton secondary className="booking-location-button" aria-pressed={gpsActive} disabled={locating} onClick={useCurrentLocation}>{locating ? 'กำลังค้นหาตำแหน่ง…' : gpsActive ? '✓ ใช้ตำแหน่งปัจจุบันแล้ว' : 'ใช้ตำแหน่งปัจจุบัน'}</BookingButton>
    </div>
    <label className="booking-field">หมู่บ้านในเขตบริการ *<select value={draft.villageId ?? ''} aria-invalid={!!errors.villageId} onChange={event => update('villageId', event.target.value)}><option value="">เลือกหมู่บ้าน</option>{catalog.villages.map(village => <option key={village.id} value={village.id}>หมู่ {village.number} · {village.name}</option>)}</select>{error('villageId')}</label>
    <label className="booking-field">ที่อยู่จุดรับ *<input value={draft.pickupAddress ?? ''} autoComplete="street-address" placeholder="บ้านเลขที่ หมู่บ้าน ตำบล" aria-invalid={!!errors.pickupAddress} onChange={event => update('pickupAddress', event.target.value)} />{error('pickupAddress')}</label>
    <label className="booking-field">จุดสังเกต<input value={draft.landmark ?? ''} aria-invalid={!!errors.landmark} onChange={event => update('landmark', event.target.value)} />{error('landmark')}</label>
    <details className="booking-address-fallback"><summary>เลือกจุดบนแผนที่ไม่ได้? ระบุพิกัดด้วยตนเอง</summary><p className="booking-small">ที่อยู่ต้องมีพิกัดและอยู่ในหมู่บ้านที่ให้บริการ หากไม่ทราบพิกัด กรุณาติดต่อเทศบาล</p>{(['latitude', 'longitude'] as const).map(key => <label key={key} className="booking-field">{key === 'latitude' ? 'ละติจูด' : 'ลองจิจูด'}<input type="number" step="any" value={draft.pickup?.[key] ?? ''} onChange={event => { locationRequest.current += 1; setLocatingPath(null); const value = event.target.value === '' ? undefined : Number(event.target.value); update('pickup', { x: 50, y: 50, label: 'จุดรับที่ระบุพิกัดเอง', ...draft.pickup, [key]: value, accuracy: undefined }) }} /></label>)}</details>
    <section className="booking-pickup-value" tabIndex={errors.pickup ? -1 : undefined} aria-invalid={!!errors.pickup} aria-describedby={errors.pickup ? 'pickup-error' : undefined}><p>จุดรับที่เลือก</p>{(draft.pickup || !errors.pickup) && <strong>{draft.pickup?.label || 'กรุณาเลือกจุดรับก่อนดำเนินการ'}</strong>}{error('pickup')}</section>
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
    <section className="booking-review-section"><header><h2>จุดรับผู้ป่วย</h2>{edit('assistance', 'จุดรับผู้ป่วย')}</header><dl><div><dt>สถานที่รับ</dt><dd>{draft.pickupAddress} · {draft.pickup?.label}</dd></div><div><dt>หมู่บ้าน</dt><dd>{catalog.villages.find(row => row.id === draft.villageId)?.name}</dd></div>{draft.landmark && <div><dt>จุดสังเกต</dt><dd>{draft.landmark}</dd></div>}</dl></section>
    <label className="booking-checkbox"><input type="checkbox" checked={saveProfile} onChange={event => setSaveProfile(event.target.checked)} />บันทึกข้อมูลผู้ป่วยไว้ใช้ครั้งต่อไป</label>
    {saveProfile && <BookingButton secondary disabled={profileBusy} onClick={() => void persistProfile()}>{profileBusy ? 'กำลังบันทึก…' : draft.patientProfileId ? 'อัปเดตข้อมูลผู้ป่วยที่บันทึกไว้' : 'บันทึกข้อมูลผู้ป่วย'}</BookingButton>}
    {profileError && <p role="alert" className="booking-error-box">{profileError}</p>}
    {saveError && <><p role="alert" className="booking-error-box">{saveError}</p><BookingButton secondary onClick={() => go('bookings')}>ตรวจสอบรายการจองล่าสุดก่อนส่งซ้ำ</BookingButton></>}
    <BookingButton disabled={profileBusy} onClick={() => void submit()}>{saveError ? 'ลองส่งคำขออีกครั้ง' : 'ยืนยันและส่งคำขอ'}</BookingButton><BookingButton secondary disabled={profileBusy} onClick={() => go('assistance')}>ย้อนกลับ</BookingButton>
  </>
  else if (screen === 'submitted' && saved) content = <>
    <BookingHeader title="ส่งคำขอแล้ว" subtitle="เก็บหมายเลขคำขอไว้เพื่อติดตามสถานะ" />
    <BookingSummaryCard booking={saved} statusLabel={statusLabels[saved.apiStatus!]} />
    <p className="booking-small">แจ้งผลการพิจารณาและเวลารับผ่าน LINE</p>
    <BookingButton onClick={() => go(`status/${saved.id}`)}>ดูสถานะการจอง</BookingButton><Link className="booking-home-link" to="/booking" onClick={() => setErrors({})}>กลับหน้าหลัก</Link>
  </>
  else if (screen === 'bookings') content = <>
    <BookingHeader title="รายการจองของฉัน" subtitle={state.bookings.length ? 'ดูสถานะและรายละเอียดการจอง' : 'ไม่มีคำขอจองรถในขณะนี้'} />
    <Link className="booking-home-link booking-list-back" to="/booking" onClick={() => setErrors({})}>← กลับหน้าหลัก</Link>
    <BookingButton secondary onClick={() => setVersion(value => value + 1)}>โหลดข้อมูลล่าสุด</BookingButton>
    {state.bookings.length ? <><div className="booking-list-title"><h2>รายการจองล่าสุด</h2><span>{state.bookings.length} {hasMore ? 'รายการที่โหลดแล้ว' : 'รายการ'}</span></div>{[...state.bookings].reverse().map(b => <BookingSummaryCard key={b.id} booking={b} statusLabel={statusLabels[b.apiStatus!]} to={`/booking/status/${b.id}`} />)}{hasMore && <><p className="booking-small">ยังมีรายการจองอื่น กดโหลดรายการเพิ่มเติมเพื่อดูครบ</p><BookingButton secondary disabled={loading} onClick={() => setListRange({ owner: session.user!.id, pages: pages + 1 })}>โหลดรายการเพิ่มเติม</BookingButton></>}</> : <><section className="booking-empty"><span aria-hidden="true">▱</span><h2>ยังไม่มีรายการจอง</h2><p>เริ่มส่งคำขอจองรถได้เลย</p></section><BookingButton onClick={start}>เริ่มจองรถ</BookingButton></>}
  </>
  else if (screen === 'cancel' && saved) content = <>
    <BookingHeader title="ยกเลิกการจอง" subtitle="ตรวจสอบข้อมูลก่อนยืนยันการยกเลิก" />
    <BookingCard title="หมายเลขการจอง"><p>{saved.reference} · {saved.details?.hospital || 'นัดหมายโรงพยาบาล'}</p></BookingCard>
    <BookingCard title="สถานะที่ยกเลิกได้"><p>ก่อนคนขับเริ่มงานเท่านั้น</p></BookingCard>
    <BookingCard title="หลังยืนยัน"><p>รายการจะถูกยกเลิกและคืนการจองรถและคนขับ</p></BookingCard>
    {!citizenCanCancel() && <p className="booking-error-box" role="alert">ไม่สามารถยกเลิกได้ กรุณาติดต่อเทศบาล</p>}
    {cancelError && <p className="booking-error-box" role="alert">{cancelError}</p>}
    <BookingButton secondary disabled={cancelling} onClick={() => setVersion(value => value + 1)}>โหลดข้อมูลล่าสุด</BookingButton>
    <BookingButton danger disabled={!citizenCanCancel() || cancelling} onClick={() => void cancelOwn()}>{cancelling ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิกการจอง'}</BookingButton>
    <BookingButton secondary disabled={cancelling} onClick={() => go(`status/${saved.id}`)}>กลับไปดูรายละเอียด</BookingButton>
  </>
  else if (screen === 'status' && saved) content = <>
    <BookingHeader title="สถานะการจอง" /><BookingSummaryCard booking={saved} statusLabel={statusLabels[saved.apiStatus!]} />
    <BookingButton secondary onClick={() => setVersion(value => value + 1)}>โหลดข้อมูลล่าสุด</BookingButton>
    {saved.apiStatus === 'ABORTED' ? <BookingCard title="ยุติการเดินทาง"><p>ไม่ได้ส่งถึงโรงพยาบาล กรุณาติดต่อเทศบาลเพื่อทราบการจัดการต่อ</p></BookingCard> : saved.status === 'cancelled' ? <BookingCard title="ยกเลิกการจองแล้ว"><p>{saved.cancellation?.reason}</p><p>การยกเลิกได้รับการบันทึกแล้ว</p></BookingCard> : saved.status === 'rejected' ? <BookingCard title="ผลการพิจารณา"><p>ไม่อนุมัติคำขอนี้</p><p>เหตุผล: {saved.rejectionReason || 'ยังไม่มีเหตุผลที่บันทึกไว้'}</p><p>หากต้องการความช่วยเหลือ กรุณาติดต่อเทศบาล</p></BookingCard> : saved.status === 'completed' ? <BookingCard title="ผลการเดินทาง"><p>ผู้ป่วยเดินทางถึงโรงพยาบาลแล้ว</p><p>หมายเลขการจอง {saved.reference}</p></BookingCard> : <><h2 className="booking-section-title">ความคืบหน้า</h2><BookingTripTimeline booking={saved} /></>}
    {citizenCanCancel() && <BookingButton secondary danger onClick={() => { setCancelError(''); go(`cancel/${saved.id}`) }}>ยกเลิกการจอง</BookingButton>}<BookingButton secondary onClick={() => go('bookings')}>รายการจองของฉัน</BookingButton><Link className="booking-home-link" to="/booking" onClick={() => setErrors({})}>กลับหน้าหลัก</Link>
  </>
  else return <Navigate to="/booking" replace />
  return <div className="booking-shell"><a className="skip-link" href="#booking-main">ข้ามไปยังเนื้อหา</a><div className="booking-workspace"><main tabIndex={-1} ref={root} id="booking-main" className={`booking-screen booking-screen-${screen || 'entry'} ${screen === 'status' ? `booking-state-${saved?.status}` : ''} ${screen === 'patient' && draft.bookingFor === 'other' ? 'booking-caregiver' : ''}`}>
    {content}
    <p className="booking-notice">บริการรับส่งตามนัดหมาย ไม่ใช่บริการฉุกเฉิน</p><EmergencyLink />
    {session.config?.contactPhone && <a className="booking-home-link" href={`tel:${session.config.contactPhone}`}>ติดต่อเทศบาล {session.config.contactPhone}</a>}
  </main></div>
    {picker && <AppointmentPicker kind={picker} date={draft.date} time={draft.time} onClose={() => setPicker(null)} onConfirm={value => { update(picker, value); setPicker(null) }} />}
    {consentDeclined && <BookingModal title="ติดต่อเทศบาลเพื่อจองทางโทรศัพท์" onClose={() => setConsentDeclined(false)}><p>คุณยังไม่ได้ยินยอมใช้ข้อมูล จึงยังไม่สามารถกรอกแบบฟอร์มจองรถได้</p>{session.config?.contactPhone ? <a className="booking-home-link" href={`tel:${session.config.contactPhone}`}>ติดต่อเทศบาล {session.config.contactPhone}</a> : <p>ยังไม่ได้ตั้งค่าหมายเลขเทศบาล กรุณาติดต่อผ่าน LINE OA</p>}<Link className="booking-home-link" to="/booking" onClick={() => { setConsentDeclined(false); setErrors({}) }}>กลับหน้าหลัก</Link></BookingModal>}
    {privacyOpen && <BookingModal title="ข้อมูลส่วนบุคคล" onClose={() => setPrivacyOpen(false)}><p style={{ whiteSpace: 'pre-wrap' }}>{session.config?.noticeText}</p><BookingButton onClick={() => setPrivacyOpen(false)}>ปิด</BookingButton></BookingModal>}
    {locationError && <BookingModal title="ไม่พบตำแหน่งปัจจุบัน" onClose={() => setLocationError('')}><p>ยังจองรถต่อได้โดยปักหมุดเอง</p><section className="booking-empty"><h3>ไม่สามารถดึงตำแหน่งได้</h3><p>{locationError}</p></section><p className="booking-info">เลือกจุดรับบนแผนที่แทนได้</p><BookingButton onClick={() => { setLocationError(''); openPin() }}>เลือกจุดรับบนแผนที่</BookingButton><BookingButton secondary onClick={() => setLocationError('')}>ย้อนกลับ</BookingButton></BookingModal>}
  </div>
}
