import { useRef, useState } from 'react'
import type { ApiBooking, Catalog, Schedule } from '../services/dispatcherApi'
import { dispatcherError } from '../services/dispatcherApi'
import { staffRequest } from '../services/staffSession'
import { dispatchDate, dispatchTime } from '../services/dispatch'
import { DispatchButton, DispatchModal, ResourcePicker } from './DispatcherUI'

export function ApiDispatchAssignment({ booking, catalog, previousJobs, reload, onAssigned, onBusyChange }: { booking: ApiBooking; catalog: Catalog; previousJobs: ApiBooking[]; reload: () => void; onAssigned: () => void; onBusyChange?: (busy: boolean) => void }) {
  const modifying = ['ASSIGNED', 'PICKING_UP'].includes(booking.status)
  const baselineProposal = booking.proposedSchedule ?? (modifying && booking.schedule ? { ...booking.schedule, vehicleId: booking.vehicleId ?? '', driverId: booking.driverId ?? '' } : null)
  const scheduled = booking.status === 'SCHEDULED'
  const [vehicleId, setVehicleId] = useState(baselineProposal?.vehicleId ?? '')
  const [driverId, setDriverId] = useState(baselineProposal?.driverId ?? '')
  const [originId, setOriginId] = useState(baselineProposal?.originLocationId ?? booking.depotLocationId ?? catalog.depotLocationId ?? '')
  const [previousId, setPreviousId] = useState(baselineProposal?.previousBookingId ?? '')
  const [waiting, setWaiting] = useState(String(baselineProposal?.pickupWaitingMinutes ?? 0))
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const [arrangementNote, setArrangementNote] = useState('')
  const [confirmedAt, setConfirmedAt] = useState('')
  const [acceptConfiguration, setAcceptConfiguration] = useState(false)
  const [configurationPreview, setConfigurationPreview] = useState<{signature: string; configurationRevision: number; schedule: Schedule & {vehicleId: string; driverId: string}} | null>(null)
  const needsHandoff = modifying && !!booking.startedAt
  const origin = catalog.locations.find(location => location.id === originId)
  const signature = JSON.stringify({vehicleId,driverId,originId,previousId,waiting,acceptConfiguration})
  const currentPreview = acceptConfiguration && configurationPreview?.signature === signature ? configurationPreview : null
  const proposal = currentPreview?.schedule ?? baselineProposal
  async function preview() {
    if (pending.current) return
    pending.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try {
      const result = await staffRequest<{configurationRevision: number; schedule: Schedule & {vehicleId: string; driverId: string}}>(`/bookings/${booking.id}/configuration-preview`, {
        expectedRevision: booking.revision, vehicleId, driverId, originLocationId: originId, originKind: origin?.kind === 'hospital' ? 'previous_hospital' : 'depot',
        ...(origin?.kind === 'hospital' ? {previousBookingId: previousId} : {}),pickupWaitingMinutes: Number(waiting),
      })
      setConfigurationPreview({...result,signature})
    } catch (error) {setConfigurationPreview(null);setError(dispatcherError(error))}
    finally {pending.current = false;setBusy(false);onBusyChange?.(false)}
  }
  async function submit() {
    if (pending.current) return
    pending.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try {
      await staffRequest(`/bookings/${encodeURIComponent(booking.id)}/${modifying ? 'modification' : scheduled && !acceptConfiguration ? 'assignment' : 'schedule'}`, {
        eventId: crypto.randomUUID(), expectedRevision: booking.revision, vehicleId, driverId,
        originLocationId: originId, originKind: needsHandoff ? 'handoff' : origin?.kind === 'hospital' ? 'previous_hospital' : 'depot',
        ...(!needsHandoff && origin?.kind === 'hospital' ? { previousBookingId: previousId } : {}), pickupWaitingMinutes: Number(waiting),
        ...(modifying || acceptConfiguration ? { reason: reason.trim() } : {}),
        ...(acceptConfiguration && currentPreview ? {acceptConfiguration: true, expectedConfigurationRevision: currentPreview.configurationRevision} : {}),
        ...(needsHandoff ? { arrangement: { locationId: originId, confirmedAt, note: arrangementNote.trim() } } : {}),
      })
      setConfirm(false)
      if (modifying || scheduled && !acceptConfiguration) onAssigned()
      else reload()
    } catch (error) { setError(dispatcherError(error)) }
    finally { pending.current = false; setBusy(false); onBusyChange?.(false) }
  }
  return <section className="dispatch-panel dispatch-assignment-form">
    <div className="dispatch-selected-job"><span>งานที่เลือก · {booking.reference}</span><strong>{booking.patientName}</strong><p>{booking.hospitalName ?? catalog.hospitals.find(h => h.id === booking.hospitalId)?.name}</p></div>
    {booking.scheduleReviewRequired && !booking.startedAt && <section className="dispatch-alert"><p>มีการตั้งค่าที่เปลี่ยนแปลง ตารางเดิมยังมีผลจนกว่ายืนยันใหม่</p>{booking.configurationChanges?.map(change => <p key={change.id}>{({hospital:'โรงพยาบาล',village:'พื้นที่บริการ',depot:'ศูนย์รถ',closure:'วันปิดบริการ'} as Record<string,string>)[change.type]} · {change.proposed.name ?? change.proposed.date}{change.proposed.latitude !== undefined ? ` · ${change.proposed.latitude}, ${change.proposed.longitude}` : ''}{change.proposed.active === false ? ' · ปิดใช้งาน / เปิดบริการอีกครั้ง' : ''}</p>)}<label className="booking-checkbox"><input type="checkbox" disabled={busy} checked={acceptConfiguration} onChange={event => {setAcceptConfiguration(event.target.checked);setConfigurationPreview(null);if (event.target.checked && origin?.kind === 'depot') setOriginId(catalog.depotLocationId ?? '')}} />ตรวจสอบและนำการตั้งค่าปัจจุบันมาคำนวณใหม่</label></section>}
    <h2>2. ตารางเวลาเดินทางที่ระบบคำนวณ</h2>
    {proposal ? <div className="dispatch-schedule-summary"><p>นัด {dispatchDate(booking.appointmentAt)} · {dispatchTime(booking.appointmentAt)} น.</p><ol className="dispatch-assignment-timeline" aria-label="กำหนดการเดินทาง">
      <li><span>ออกจากต้นทาง</span><strong>{dispatchTime(proposal.departureAt)}</strong></li><li><span>รับผู้ป่วย</span><strong>{dispatchTime(proposal.pickupAt)}</strong></li><li><span>ถึงโรงพยาบาล</span><strong>{dispatchTime(proposal.arrivalAt)}</strong></li>
    </ol><b>พร้อมรับงานต่อ {dispatchTime(proposal.readyAt)} น. · เตรียมพร้อมที่โรงพยาบาล 30 นาที</b><p>{modifying ? 'ตารางเดิมยังมีผลจนกว่าระบบยืนยันการเปลี่ยนแปลงสำเร็จ' : 'ยืนยันตารางแล้ว ยังไม่จองรถหรือคนขับจนกว่าจะยืนยันการมอบหมาย'}</p></div> : <p className="dispatch-small">ระบบจะคำนวณเส้นทางและตรวจความพร้อมก่อนยืนยันตาราง · ถึงก่อนนัด 20 นาที และเตรียมพร้อมที่โรงพยาบาล 30 นาที</p>}
    <fieldset disabled={busy || scheduled && !acceptConfiguration}>
      <h2>3. เลือกรถและคนขับ</h2><div className="dispatch-resource-row"><ResourcePicker label="รถรับส่ง" placeholder="เลือกรถ" value={vehicleId} options={catalog.vehicles.map(v => ({ id: v.id, label: `${v.name} · ${v.plate}`, active: v.active && (!v.held || (modifying && v.id === booking.vehicleId)) }))} onChange={setVehicleId} /><ResourcePicker label="คนขับ" placeholder="เลือกคนขับ" value={driverId} options={catalog.drivers.map(d => ({ id: d.id, label: d.name, active: d.active && (!d.held || (modifying && d.id === booking.driverId)) }))} onChange={setDriverId} /></div>
      <label className="booking-field">ต้นทาง<select value={originId} onChange={event => { setOriginId(event.target.value); setConfirmedAt('') }}><option value="">เลือกต้นทาง</option>{catalog.locations.filter(l => needsHandoff || l.id === catalog.depotLocationId || l.id === booking.depotLocationId || l.id === baselineProposal?.originLocationId || l.kind === 'hospital').map(l => <option value={l.id} key={l.id}>{l.name}</option>)}</select></label>
      {!needsHandoff && origin?.kind === 'hospital' && <label className="booking-field">งานก่อนหน้าที่โรงพยาบาล<select value={previousId} onChange={event => setPreviousId(event.target.value)}><option value="">เลือกงานก่อนหน้า</option>{previousJobs.filter(row => row.id !== booking.id && row.schedule && row.vehicleId === vehicleId && row.driverId === driverId && (row.hospitalLocationId ?? catalog.hospitals.find(h => h.id === row.hospitalId)?.location_id) === originId && !['CANCELLED', 'REJECTED', 'ABORTED'].includes(row.status)).map(row => <option value={row.id} key={row.id}>{row.reference} · {dispatchDate(row.appointmentAt)} {dispatchTime(row.appointmentAt)}</option>)}</select></label>}
      <label className="booking-field">เวลารอที่จุดรับเพิ่มเติม (นาที)<input type="number" min="0" step="1" value={waiting} onChange={event => setWaiting(event.target.value)} /></label>
      {(modifying || acceptConfiguration) && <label className="booking-field">เหตุผลการเปลี่ยนแปลง<textarea required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>}
      {needsHandoff && <><p className="dispatch-alert">เริ่มงานแล้ว ต้องตรวจสอบตำแหน่งและการรับช่วงก่อนรับผู้ป่วย รถหรือคนขับเดิมที่ปล่อยออกจะยังไม่พร้อมจนกว่าจะยืนยันความพร้อมแยกต่างหาก</p><label className="booking-field">การยืนยันต้นทางและการรับช่วง<textarea required maxLength={1000} value={arrangementNote} onChange={event => { setArrangementNote(event.target.value); setConfirmedAt('') }} /></label><label className="booking-checkbox"><input type="checkbox" checked={!!confirmedAt} onChange={event => setConfirmedAt(event.target.checked ? new Date().toISOString() : '')} /><span>ยืนยันตำแหน่งและแผนรับช่วงจริงแล้ว (ต้องยืนยันภายใน 5 นาที)</span></label></>}
    </fieldset>
    {acceptConfiguration && <><DispatchButton secondary disabled={busy || !vehicleId || !driverId || !originId} onClick={() => void preview()}>คำนวณข้อเสนอใหม่โดยยังไม่เปลี่ยนตาราง</DispatchButton>{currentPreview && <p className="dispatch-small">ข้อเสนอคำนวณจากเส้นทางที่ตรวจสอบแล้ว กรุณาตรวจเวลาข้างต้นก่อนยืนยัน</p>}</>}
    <h2>4. ตรวจสอบความพร้อม</h2><p className="dispatch-small">ตรวจรถและคนขับใหม่เมื่อยืนยัน รวมกะทำงาน วันปิด และงานก่อนหน้า</p>
    {error && !confirm && <p role="alert" className="dispatch-alert">{error}</p>}
    <DispatchButton disabled={busy || (booking.scheduleReviewRequired && !booking.startedAt && !acceptConfiguration) || (acceptConfiguration && (!currentPreview || !reason.trim())) || !vehicleId || !driverId || !originId || (!needsHandoff && origin?.kind === 'hospital' && !previousId) || !Number.isFinite(Number(waiting)) || Number(waiting) < 0 || (scheduled && !proposal) || (modifying && !reason.trim()) || (needsHandoff && (!confirmedAt || !arrangementNote.trim()))} onClick={() => { setError(''); setConfirm(true) }}>{modifying ? 'ตรวจสอบและยืนยันการเปลี่ยนแปลง' : scheduled && !acceptConfiguration ? 'ตรวจสอบซ้ำและยืนยันการมอบหมาย' : 'ตรวจสอบและยืนยันตาราง'}</DispatchButton>
    {confirm && <DispatchModal title={modifying ? 'ยืนยันการเปลี่ยนแปลง' : scheduled && !acceptConfiguration ? 'ยืนยันการมอบหมาย' : 'ยืนยันตารางเวลา'} onClose={() => { if (!pending.current) setConfirm(false) }}><p>{modifying ? 'ระบบจะตรวจความพร้อมใหม่และเก็บประวัติตารางเดิม หากไม่ผ่านจะคงตารางเดิมไว้' : scheduled && !acceptConfiguration ? 'ระบบจะตรวจความพร้อมล่าสุดและจองรถกับคนขับเมื่อสำเร็จ' : 'ระบบจะคำนวณเส้นทางและยืนยันตาราง โดยยังไม่จองรถหรือคนขับ'}</p>{error && <p role="alert" className="dispatch-alert">{error}</p>}<DispatchButton disabled={busy} onClick={() => void submit()}>{busy ? 'กำลังตรวจสอบ…' : modifying ? 'ยืนยันการเปลี่ยนแปลง' : scheduled && !acceptConfiguration ? 'ยืนยันการมอบหมาย' : 'ยืนยันตาราง'}</DispatchButton><DispatchButton secondary disabled={busy} onClick={() => setConfirm(false)}>กลับไปตรวจสอบ</DispatchButton></DispatchModal>}
  </section>
}

