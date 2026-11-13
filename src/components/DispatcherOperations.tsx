import { useRef, useState } from 'react'
import type { ApiBooking, Catalog } from '../services/dispatcherApi'
import { dispatcherError } from '../services/dispatcherApi'
import { staffRequest } from '../services/staffSession'
import { DispatchButton } from './DispatcherUI'
import { ApiDispatchAssignment } from './ApiDispatchAssignment'
import { DestinationRevisionForm } from './DestinationRevisionForm'
import { DestinationRevisionSummary } from './DestinationRevisionSummary'
import { dispatchDate, dispatchTime } from '../services/dispatch'

export function DispatcherOperations({ booking, catalog, rows, onSaved, onBusyChange }: { booking: ApiBooking; catalog: Catalog; rows: ApiBooking[]; onSaved: () => void; onBusyChange: (busy: boolean) => void }) {
  const [action, setAction] = useState('')
  const [reason, setReason] = useState('')
  const [endedAt, setEndedAt] = useState('')
  const [location, setLocation] = useState('')
  const [disposition, setDisposition] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const active = ['ASSIGNED', 'PICKING_UP', 'PICKED_UP', 'IN_TRANSIT'].includes(booking.status)
  const correction = booking.status === 'PICKING_UP' ? 'ASSIGNED' : booking.status === 'IN_TRANSIT' ? 'PICKED_UP' : ''
  const actions = [
    ...(['PICKED_UP','IN_TRANSIT'].includes(booking.status)?[{value:'destination',label:'เปลี่ยนโรงพยาบาลหลังรับผู้ป่วย'}]:[]),
    ...(['ASSIGNED', 'PICKING_UP'].includes(booking.status) ? [{ value: 'modify', label: 'เปลี่ยนรถ คนขับ หรือตารางก่อนรับผู้ป่วย' }] : []),
    ...(active && !booking.incidentOpen ? [{ value: 'REPORT_INCIDENT', label: 'รายงานเหตุขัดข้อง' }] : []),
    ...(active && booking.incidentOpen ? [{ value: 'RESOLVE_INCIDENT', label: 'ยืนยันคลี่คลายเหตุขัดข้องและพร้อมเดินทางต่อ' }] : []),
    ...(['PICKED_UP', 'IN_TRANSIT'].includes(booking.status) ? [{ value: 'ABORT', label: 'ยุติการเดินทางโดยไม่ส่งถึงโรงพยาบาล' }] : []),
    ...(correction && !booking.incidentOpen ? [{ value: 'CORRECT_MILESTONE', label: 'แก้สถานะที่บันทึกผิดกลับหนึ่งขั้น' }] : []),
  ]
  async function submit() {
    if (pending.current || !reason.trim() || !confirmed || !actions.some(item => item.value === action)) return
    pending.current = true; setBusy(true); onBusyChange(true); setError('')
    try {
      const command = { type: action, reason: reason.trim(),
        ...(action === 'CORRECT_MILESTONE' ? { target: correction, physicalStateConfirmed: confirmed } : {}),
        ...(action === 'ABORT' ? { endedAt: new Date(endedAt + '+07:00').toISOString(), location: location.trim(), disposition: disposition.trim() } : {}),
      }
      await staffRequest(`/bookings/${encodeURIComponent(booking.id)}/commands`, { eventId: crypto.randomUUID(), expectedRevision: booking.revision, expectedExecutionVersion: booking.executionVersion, command })
      onSaved()
    } catch (error) { setError(dispatcherError(error)) }
    finally { pending.current = false; setBusy(false); onBusyChange(false) }
  }
  if (!actions.length) return booking.resourceHold ? <p className="dispatch-alert">งานจบแล้ว แต่ทรัพยากรยังไม่พร้อม กรุณายืนยันตำแหน่งและความพร้อมรถกับคนขับในหน้าติดตามงาน</p> : null
  return <section className="dispatch-detail-section"><h3>ดำเนินการโดยเจ้าหน้าที่จัดรถ</h3><DestinationRevisionSummary revision={booking.destinationRevision} />
    {!!booking.destinationHistory?.length && <details><summary>ประวัติการเปลี่ยนโรงพยาบาล</summary>{booking.destinationHistory.map(leg=><p key={leg.version}>ครั้งที่ {leg.version} · {leg.hospitalName} · คาดถึง {dispatchDate(leg.arrivalAt)} {dispatchTime(leg.arrivalAt)} น. · {leg.reason}</p>)}</details>}
    <label className="booking-field">การดำเนินการ<select disabled={busy} value={action} onChange={event => { setAction(event.target.value); setConfirmed(false); setError('') }}><option value="">เลือกการดำเนินการ</option>{actions.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
    {action === 'destination' ? <DestinationRevisionForm key={booking.revision} booking={booking} catalog={catalog} onSaved={onSaved} onBusyChange={onBusyChange} /> : action === 'modify' ? <ApiDispatchAssignment key={booking.revision} booking={booking} catalog={catalog} previousJobs={rows} reload={onSaved} onAssigned={onSaved} onBusyChange={onBusyChange} /> : action && <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <fieldset disabled={busy}><label className="booking-field">เหตุผล<textarea required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      {action === 'ABORT' && <><p className="dispatch-alert">ผลลัพธ์นี้คือ ABORTED ไม่ใช่ส่งถึงโรงพยาบาล และยังไม่ปล่อยความพร้อมรถหรือคนขับ</p><label className="booking-field">เวลาจบการเดินทางจริง (เวลาไทย)<input required type="datetime-local" value={endedAt} onChange={event => setEndedAt(event.target.value)} /></label><label className="booking-field">สถานที่จบการเดินทาง<input required maxLength={1000} value={location} onChange={event => setLocation(event.target.value)} /></label><label className="booking-field">การส่งมอบผู้ป่วยหรือแผนรับช่วงต่อ<textarea required maxLength={1000} value={disposition} onChange={event => setDisposition(event.target.value)} /></label></>}
      {action === 'CORRECT_MILESTONE' && <p>แก้เฉพาะสถานะที่บันทึกผิดหนึ่งขั้น ไม่ย้อนการรับผู้ป่วยจริง และไม่ลบประวัติเดิม</p>}
      <label className="booking-checkbox"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>ตรวจสอบสถานการณ์จริงและยืนยันการดำเนินการนี้แล้ว</span></label></fieldset>
      {error && <p role="alert" className="dispatch-alert">{error}</p>}<DispatchButton type="submit" disabled={busy || !reason.trim() || !confirmed}>{busy ? 'กำลังบันทึก…' : 'ยืนยันการดำเนินการ'}</DispatchButton>
    </form>}
  </section>
}

export function ResourceReadiness({ catalog, onSaved }: { catalog: Catalog; onSaved: () => void }) {
  const [resource, setResource] = useState('')
  const [locationId, setLocationId] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState('')
  const resources = [...catalog.vehicles.filter(v => v.held).map(v => ({ value: `vehicles/${v.id}`, label: `รถ: ${v.name}` })), ...catalog.drivers.filter(d => d.held).map(d => ({ value: `drivers/${d.id}`, label: `คนขับ: ${d.name}` }))]
  async function submit() {
    if (pending.current || !resources.some(item => item.value === resource) || !confirmed) return
    pending.current = true; setBusy(true); setError('')
    try { await staffRequest(`/resources/${resource}/readiness`, { locationId, reason: reason.trim() }); onSaved() }
    catch (error) { setError(dispatcherError(error)) }
    finally { pending.current = false; setBusy(false) }
  }
  if (!resources.length) return null
  return <details className="dispatch-panel"><summary>ยืนยันตำแหน่งและความพร้อมรถหรือคนขับ</summary><p>ยืนยันแยกแต่ละทรัพยากร ระบบจะตรวจงานที่ยังดำเนินอยู่และเวลาพักเตรียมพร้อมก่อนปล่อยการระงับ</p><form onSubmit={event => { event.preventDefault(); void submit() }}><fieldset disabled={busy}>
    <label className="booking-field">ทรัพยากรที่ตรวจสอบ<select required value={resource} onChange={event => setResource(event.target.value)}><option value="">เลือกทรัพยากร</option>{resources.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <label className="booking-field">ตำแหน่งปัจจุบันที่ยืนยันแล้ว<select required value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">เลือกตำแหน่ง</option>{catalog.locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className="booking-field">เหตุผลและผลตรวจสอบ<textarea required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label><label className="booking-checkbox"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>ยืนยันตำแหน่งจริงและความพร้อมของทรัพยากรนี้แล้ว</span></label></fieldset>
    {error && <p role="alert" className="dispatch-alert">{error}</p>}<DispatchButton type="submit" disabled={busy || !confirmed || !reason.trim() || !resource || !locationId}>{busy ? 'กำลังบันทึก…' : 'ยืนยันความพร้อมทรัพยากรนี้'}</DispatchButton></form></details>
}
