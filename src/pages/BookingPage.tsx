import { PickupMap } from '../components/LocationMap'
import { BookingSummaryCard } from '../components/BookingSummaryCard'
import { RoleSelectionLink } from '../components/RoleSelectionLink'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { BookingTripTimeline } from '../components/BookingTripTimeline'
import { AppointmentPicker } from '../components/AppointmentPicker'
import { BookingButton, BookingCard, BookingHeader, BookingIcon, BookingModal, BookingProgress, EmergencyLink } from '../components/BookingUI'
import { appointmentTimestamp, emptyBooking, thaiDate, validatePatient } from '../services/booking'
import type { BookingDetails } from '../services/booking'
import { demoStore, useDemoState } from '../services/demoStore'
import type { Booking, BookingStatus } from '../data/seed'
import { cancelBooking, citizenCanCancel } from '../services/cancellation'
import '../booking.css'

const statusLabels: Record<BookingStatus, string> = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', in_transit: 'กำลังเดินทาง', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิกแล้ว' }
const initialBookingForm = (): BookingDetails => {
  // Submitted bookings already persist in this browser. Reuse the latest details,
  // but require a fresh appointment and acknowledgement for every new request.
  const previous = [...demoStore.getState().bookings].reverse().find(booking => booking.details)?.details
  return {
    ...emptyBooking(),
    hospital: 'โรงพยาบาลลำพูน',
    ...previous,
    extras: previous ? [...previous.extras] : [],
    pickup: previous?.pickup ? { ...previous.pickup } : null,
    date: '',
    time: '',
    acknowledged: false,
  }
}
export function BookingPage() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const path = pathname.replace(/^\/booking\/?/, '').split('/')
  const screen = path[0]
  const { state, storageAvailable } = useDemoState()
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
  const [pickupAddress, setPickupAddress] = useState(() => draft.pickup?.latitude === undefined ? draft.pickup?.label || '' : '')
  const gpsActive = draft.pickup?.accuracy !== undefined
  const [sending, setSending] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const sendingRef = useRef(false)
  const submittedId = useRef<string | null>(null)
  const root = useRef<HTMLElement>(null)
  const saved = state.bookings.find(b => b.id === path[1])
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
      setPickupAddress('')
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
    if (!draft.pickup) { showErrors({ pickup: 'กรุณาเลือกจุดรับก่อนดำเนินการ' }); return }
    go('review')
  }
  async function submit() {
    if (sendingRef.current) return
    if (submittedId.current) { go(`submitted/${submittedId.current}`); return }
    const next = validatePatient(draft)
    if (Object.keys(next).length) { go('patient'); showErrors(next); return }
    if (!draft.acknowledged) { go('privacy'); return }
    if (!draft.pickup) { go('assistance'); showErrors({ pickup: 'กรุณาเลือกจุดรับก่อนดำเนินการ' }); return }
    sendingRef.current = true
    setSending(true)
    setSaveError(false)
    // Yield a paint so the reference's submitting state is announced before the local save.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    try {
      const latestErrors = validatePatient(draft)
      if (Object.keys(latestErrors).length) { go('patient'); showErrors(latestErrors); return }
      let id = ''
      demoStore.update(current => {
        const serial = current.bookings.reduce((max, b) => Math.max(max, Number(b.id.replace('BK-', '')) || 0), 0) + 1
        id = `BK-${String(serial).padStart(4, '0')}`
        const details = { ...draft, patientName: draft.patientName.trim(), contactName: draft.bookingFor === 'self' ? '' : draft.contactName.trim(), relationship: draft.bookingFor === 'self' ? '' : draft.relationship, phone: draft.phone.replace(/[\s-]/g, ''), extras: [...draft.extras] }
        const booking: Booking = { id, patientName: details.patientName, appointmentAt: new Date(appointmentTimestamp(draft.date, draft.time)).toISOString(), status: 'pending', details, createdAt: new Date().toISOString() }
        return { ...current, bookings: [...current.bookings, booking] }
      })
      submittedId.current = id
      go(`submitted/${id}`)
    } catch { setSaveError(true) }
    finally { setSending(false); sendingRef.current = false }
  }
  const field = (key: 'patientName' | 'contactName' | 'phone', label: string, placeholder: string) => <div className="booking-field"><label htmlFor={key}>{label} *</label><input id={key} name={key} required value={draft[key]} type={key === 'phone' ? 'tel' : 'text'} inputMode={key === 'phone' ? 'tel' : 'text'} autoComplete={key === 'phone' ? 'tel' : key === 'contactName' || draft.bookingFor === 'self' ? 'name' : 'off'} placeholder={placeholder} maxLength={key === 'phone' ? 20 : 120} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${key}-error` : undefined} onChange={e => update(key, e.target.value)} />{error(key)}</div>
  const error = (key: string) => errors[key] ? <span className="booking-error" id={`${key}-error`} role="alert">{errors[key]}</span> : null
  const selection = (key: 'hospital' | 'relationship', label: string, placeholder: string, values: string[]) => <div className="booking-field"><label htmlFor={key}>{label} *</label><select id={key} required value={draft[key]} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${key}-error` : undefined} onChange={e => update(key, e.target.value)}><option value="">{placeholder}</option>{values.map(value => <option key={value}>{value}</option>)}</select>{error(key)}</div>
  const edit = (target: string, label: string) => <button type="button" className="booking-edit" aria-label={`แก้ไข ${label}`} onClick={() => go(target)}>แก้ไข</button>
  function start() {
    const next = initialBookingForm()
    submittedId.current = null
    setDraft(next)
    setLocationError('')
    setPickupAddress(next.pickup?.latitude === undefined ? next.pickup?.label || '' : '')
    go('privacy')
  }
  function openPin() { root.current?.querySelector<HTMLElement>('.pickup-map-frame')?.focus() }
  function selectPoint(latitude: number, longitude: number, label?: string) {
    setPickupAddress('')
    update('pickup', { x: 50, y: 50, latitude, longitude, label: label || 'จุดรับที่เลือกบนแผนที่' })
  }
  let content: ReactNode
  if (['patient', 'assistance', 'pickup', 'review'].includes(screen) && !draft.acknowledged) return <Navigate to="/booking/privacy" replace />
  if (['submitted', 'status'].includes(screen) && !saved) return <Navigate to="/booking/bookings" replace />
  if (screen === '') content = <>
    <BookingHeader title="จองรถไปโรงพยาบาล" /><EmergencyLink />
    <section className="booking-hero"><div className="booking-hero-icons"><BookingIcon name="medical" /><BookingIcon name="ambulance" /><BookingIcon name="pin" /></div><h2>จองรถรับส่งผู้ป่วย</h2><p>จองง่ายใน 3 ขั้นตอน</p></section>
    <BookingButton onClick={start}>เริ่มจองรถ →</BookingButton><BookingButton secondary onClick={() => go('bookings')}>ดูสถานะการจอง</BookingButton>
    <ol className="booking-entry-steps">{['กรอกข้อมูล', 'เลือกจุดรับ', 'รอการยืนยัน'].map((label, i) => <li key={label}><strong>{i + 1}</strong><span>{label}</span></li>)}</ol><p className="booking-notice">จองล่วงหน้า 2 วัน (48 ชั่วโมง)</p>
  </>
  else if (screen === 'privacy') content = <>
    <BookingHeader title="ข้อมูลส่วนบุคคล" subtitle="ขอใช้ข้อมูลเพื่อจัดรถให้คุณ" />
    <section className="booking-hero"><BookingIcon name="shield" /><h2>ดูแลข้อมูลส่วนบุคคล</h2></section><h2 className="booking-section-title">ข้อมูลที่จำเป็น</h2>
    <BookingCard icon="user" title="ข้อมูลผู้ป่วย"><p>ชื่อและเบอร์ติดต่อ</p></BookingCard><BookingCard icon="smallPin" title="จุดรับผู้ป่วย"><p>สำหรับวางแผนการรับส่ง</p></BookingCard><BookingCard icon="smallMedical" title="ข้อมูลการเดินทาง"><p>วันนัดและความช่วยเหลือ</p></BookingCard>
    <p className="booking-small">ไม่ต้องกรอกโรคหรือประวัติการรักษา</p><button type="button" className="booking-text-link" onClick={() => setPrivacyOpen(true)}>อ่านประกาศความเป็นส่วนตัว</button><label className="booking-checkbox"><input type="checkbox" checked={draft.acknowledged} onChange={e => update('acknowledged', e.target.checked)} /><span>รับทราบการใช้ข้อมูล<span className="booking-consent-detail">ยินยอมให้ใช้เพื่อจัดรถรับส่ง</span></span></label>
    <BookingButton disabled={!draft.acknowledged} onClick={() => go('patient')}>รับทราบและถัดไป</BookingButton>
    <BookingButton secondary onClick={() => { setDraft(initialBookingForm()); setConsentDeclined(true) }}>ไม่ยินยอมใช้ข้อมูล</BookingButton><Link className="booking-home-link" to="/booking" onClick={() => { setDraft(initialBookingForm()); setErrors({}) }}>กลับหน้าหลัก</Link>
  </>
  else if (screen === 'patient') content = <>
    <BookingHeader title="ข้อมูลผู้ป่วย" subtitle="ใครต้องการใช้รถรับส่ง?" /><BookingProgress step={1} />
    <div className="booking-tabs" role="group" aria-label="ประเภทการจอง">{(['self', 'other'] as const).map(value => <button type="button" aria-pressed={draft.bookingFor === value} key={value} onClick={() => { update('bookingFor', value); setErrors({}) }}>{value === 'self' ? 'จองให้ตนเอง' : 'จองให้ผู้อื่น'}</button>)}</div>
    <p className="booking-small">ช่องที่มี * จำเป็นต้องกรอก</p><form className="booking-form" noValidate onSubmit={e => { e.preventDefault(); patientNext() }}>
      {field('patientName', 'ชื่อผู้ป่วย', 'ชื่อและนามสกุล')}
      {draft.bookingFor === 'other' && field('contactName', 'ชื่อผู้ดูแล / ผู้ติดต่อ', 'ชื่อผู้จองหรือผู้ดูแล')}
      {field('phone', draft.bookingFor === 'self' ? 'เบอร์โทรศัพท์ของคุณ' : 'เบอร์โทรศัพท์ผู้ติดต่อ', '08X-XXX-XXXX')}
      {draft.bookingFor === 'other' && selection('relationship', 'ความสัมพันธ์กับผู้ป่วย', 'เลือกความสัมพันธ์ เช่น บุตร / ญาติ / ผู้ดูแล', ['บุตร', 'ญาติ', 'ผู้ดูแล'])}
      {selection('hospital', 'โรงพยาบาล', 'เลือกโรงพยาบาล', ['โรงพยาบาลลำพูน'])}
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
    <details className="booking-address-fallback"><summary>เลือกจุดบนแผนที่ไม่ได้? ระบุที่อยู่แทน</summary><p className="booking-small">กรอกที่อยู่ให้ชัดเจน เพื่อให้เจ้าหน้าที่ติดต่อยืนยันจุดรับ</p><label className="booking-field">ที่อยู่จุดรับ<input value={pickupAddress} maxLength={200} autoComplete="street-address" placeholder="บ้านเลขที่ หมู่บ้าน ตำบล และจุดสังเกต" onChange={e => { setPickupAddress(e.target.value); update('pickup', e.target.value.trim() ? { x: 50, y: 50, label: e.target.value.trim() } : null) }} /></label></details>
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
      <div><dt>โรงพยาบาล</dt><dd>{draft.hospital}</dd></div>
      <div><dt>วันที่นัดหมาย</dt><dd>{thaiDate(draft.date)}</dd></div>
      <div><dt>เวลานัดหมาย</dt><dd className="booking-review-time">{draft.time} น.</dd></div>
    </dl></section>
    <section className="booking-review-section"><header><h2>ความช่วยเหลือ</h2>{edit('assistance', 'ความช่วยเหลือ')}</header><dl>
      <div><dt>การเดินทางของผู้ป่วย</dt><dd>{draft.assistance}</dd></div>
      <div><dt>ความช่วยเหลือเพิ่มเติม</dt><dd>{draft.extras.length ? <ul>{draft.extras.map(extra => <li key={extra}>{extra}</li>)}</ul> : 'ไม่ต้องการความช่วยเหลือเพิ่มเติม'}</dd></div>
    </dl></section>
    <section className="booking-review-section"><header><h2>จุดรับผู้ป่วย</h2>{edit('assistance', 'จุดรับผู้ป่วย')}</header><dl><div><dt>สถานที่รับ</dt><dd>{draft.pickup?.label}</dd></div></dl></section>
    {saveError && <p role="alert" className="booking-error-box">ส่งคำขอไม่สำเร็จ กรุณาลองส่งคำขออีกครั้ง</p>}
    <BookingButton onClick={() => void submit()}>{saveError ? 'ลองส่งคำขออีกครั้ง' : 'ยืนยันและส่งคำขอ'}</BookingButton><BookingButton secondary onClick={() => go('assistance')}>ย้อนกลับ</BookingButton>
  </>
  else if (screen === 'submitted' && saved) content = <>
    <BookingHeader title="ส่งคำขอแล้ว" subtitle="เก็บหมายเลขคำขอไว้เพื่อติดตามสถานะ" />
    <BookingSummaryCard booking={saved} statusLabel={statusLabels[saved.status]} />
    <p className="booking-small">แจ้งผลการพิจารณาและเวลารับผ่าน LINE</p>
    <BookingButton onClick={() => go(`status/${saved.id}`)}>ดูสถานะการจอง</BookingButton><Link className="booking-home-link" to="/booking" onClick={() => setErrors({})}>กลับหน้าหลัก</Link>
  </>
  else if (screen === 'bookings') content = <>
    <BookingHeader title="รายการจองของฉัน" subtitle={state.bookings.length ? 'ดูสถานะและรายละเอียดการจอง' : 'ไม่มีคำขอจองรถในขณะนี้'} />
    <Link className="booking-home-link booking-list-back" to="/booking" onClick={() => setErrors({})}>← กลับหน้าหลัก</Link>
    {state.bookings.length ? <><div className="booking-list-title"><h2>รายการจองทั้งหมด</h2><span>{state.bookings.length} รายการ</span></div>{[...state.bookings].reverse().map(b => <BookingSummaryCard key={b.id} booking={b} statusLabel={statusLabels[b.status]} to={`/booking/status/${b.id}`} />)}</> : <><section className="booking-empty"><span aria-hidden="true">▱</span><h2>ยังไม่มีรายการจอง</h2><p>เริ่มส่งคำขอจองรถได้เลย</p></section><BookingButton onClick={start}>เริ่มจองรถ</BookingButton></>}
  </>
  else if (screen === 'cancel' && saved) content = <>
    <BookingHeader title="ยกเลิกการจอง" subtitle="ตรวจสอบข้อมูลก่อนยืนยันการยกเลิก" />
    <BookingCard title="หมายเลขการจอง"><p>{saved.id} · {saved.details?.hospital || 'นัดหมายโรงพยาบาล'}</p></BookingCard>
    <BookingCard title="สถานะที่ยกเลิกได้"><p>ก่อนคนขับเริ่มงานเท่านั้น</p></BookingCard>
    <BookingCard title="หลังยืนยัน"><p>รายการจะถูกยกเลิกและคืนการจองรถและคนขับ</p></BookingCard>
    {!citizenCanCancel(saved) && <p className="booking-error-box" role="alert">ไม่สามารถยกเลิกได้ กรุณาติดต่อเทศบาล</p>}
    {cancelError && <p className="booking-error-box" role="alert">{cancelError}</p>}
    <BookingButton danger disabled={!citizenCanCancel(saved)} onClick={() => { try { cancelBooking(saved.id, 'citizen'); go(`status/${saved.id}`) } catch(e) { setCancelError((e as Error).message) } }}>ยืนยันยกเลิกการจอง</BookingButton>
    <BookingButton secondary onClick={() => go(`status/${saved.id}`)}>กลับไปดูรายละเอียด</BookingButton>
  </>
  else if (screen === 'status' && saved) content = <>
    <BookingHeader title="สถานะการจอง" /><BookingSummaryCard booking={saved} statusLabel={statusLabels[saved.status]} />
    {saved.status === 'cancelled' ? <BookingCard title="ยกเลิกการจองแล้ว"><p>{saved.cancellation?.reason}</p><p>คืนการจองรถและคนขับแล้ว</p></BookingCard> : saved.status === 'rejected' ? <BookingCard title="ผลการพิจารณา"><p>ไม่อนุมัติคำขอนี้</p><p>เหตุผล: {saved.rejectionReason || 'ยังไม่มีเหตุผลที่บันทึกไว้'}</p><p>หากต้องการความช่วยเหลือ กรุณาติดต่อเทศบาล</p></BookingCard> : saved.status === 'completed' ? <BookingCard title="ผลการเดินทาง"><p>ผู้ป่วยเดินทางถึงโรงพยาบาลแล้ว</p><p>หมายเลขการจอง {saved.id}</p></BookingCard> : <><h2 className="booking-section-title">ความคืบหน้า</h2><BookingTripTimeline booking={saved} /></>}
    {citizenCanCancel(saved) && <BookingButton secondary danger onClick={() => { setCancelError(''); go(`cancel/${saved.id}`) }}>ยกเลิกการจอง</BookingButton>}<BookingButton secondary onClick={() => go('bookings')}>รายการจองของฉัน</BookingButton><Link className="booking-home-link" to="/booking" onClick={() => setErrors({})}>กลับหน้าหลัก</Link>
  </>
  else return <Navigate to="/booking" replace />
  return <div className="booking-shell"><a className="skip-link" href="#booking-main">ข้ามไปยังเนื้อหา</a><div className="booking-workspace"><main tabIndex={-1} ref={root} id="booking-main" className={`booking-screen booking-screen-${screen || 'entry'} ${screen === 'status' ? `booking-state-${saved?.status}` : ''} ${screen === 'patient' && draft.bookingFor === 'other' ? 'booking-caregiver' : ''}`}>
    {content}
    {!storageAvailable && <p role="alert" className="booking-error-box">เบราว์เซอร์ไม่อนุญาตให้บันทึกข้อมูล การจองนี้อยู่ในหน่วยความจำและจะหายเมื่อรีเฟรช</p>}
  </main></div><RoleSelectionLink />
    {picker && <AppointmentPicker kind={picker} date={draft.date} time={draft.time} onClose={() => setPicker(null)} onConfirm={value => { update(picker, value); setPicker(null) }} />}
    {consentDeclined && <BookingModal title="ติดต่อเทศบาลเพื่อจองทางโทรศัพท์" onClose={() => setConsentDeclined(false)}><p>คุณยังไม่ได้ยินยอมใช้ข้อมูล จึงยังไม่สามารถกรอกแบบฟอร์มจองรถได้</p><p>หากต้องการจองทางโทรศัพท์ กรุณาติดต่อเทศบาลตำบลบ้านกลางผ่านช่องทางติดต่อของเทศบาล</p><Link className="booking-home-link" to="/booking" onClick={() => { setConsentDeclined(false); setErrors({}) }}>กลับหน้าหลัก</Link></BookingModal>}
    {privacyOpen && <BookingModal title="ข้อมูลส่วนบุคคล" onClose={() => setPrivacyOpen(false)}><p>ใช้ข้อมูลเพื่อจัดบริการรับส่ง</p><ul><li>ข้อมูลผู้ป่วย: ชื่อและเบอร์ติดต่อ</li><li>จุดรับผู้ป่วย: สำหรับวางแผนการรับส่ง</li><li>ข้อมูลการเดินทาง: วันนัดและความช่วยเหลือ</li></ul><p className="booking-info">ต้นแบบบันทึกข้อมูลในเบราว์เซอร์นี้เท่านั้น ยังไม่มีการส่งข้อความ LINE หรือข้อมูลไปยังโรงพยาบาล</p><BookingButton onClick={() => setPrivacyOpen(false)}>ปิด</BookingButton></BookingModal>}
    {locationError && <BookingModal title="ไม่พบตำแหน่งปัจจุบัน" onClose={() => setLocationError('')}><p>ยังจองรถต่อได้โดยปักหมุดเอง</p><section className="booking-empty"><h3>ไม่สามารถดึงตำแหน่งได้</h3><p>{locationError}</p></section><p className="booking-info">เลือกจุดรับบนแผนที่แทนได้</p><BookingButton onClick={() => { setLocationError(''); openPin() }}>เลือกจุดรับบนแผนที่</BookingButton><BookingButton secondary onClick={() => setLocationError('')}>ย้อนกลับ</BookingButton></BookingModal>}
  </div>
}
