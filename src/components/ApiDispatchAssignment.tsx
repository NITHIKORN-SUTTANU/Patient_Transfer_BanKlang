import { vehicleLabel } from '../services/vehicleLabel'
import { useRef, useState } from 'react'
import type { ApiBooking, Catalog, Schedule } from '../services/dispatcherApi'
import { dispatcherScheduleError } from '../services/dispatcherApi'
import { staffRequest } from '../services/staffSession'
import { dispatchDate, dispatchTime } from '../services/dispatch'
import { DispatchButton, DispatchModal, ResourcePicker } from './DispatcherUI'

export function ApiDispatchAssignment({ booking, catalog, reload, refreshing = false, onAssigned, onBusyChange }: { booking: ApiBooking; catalog: Catalog; reload: () => void; refreshing?: boolean; onAssigned: () => void; onBusyChange?: (busy: boolean) => void }) {
  const modifying = ['ASSIGNED', 'PICKING_UP'].includes(booking.status)
  const baselineProposal = booking.proposedSchedule ?? (modifying && booking.schedule ? { ...booking.schedule, vehicleId: booking.vehicleId ?? '', driverId: booking.driverId ?? '' } : null)
  const scheduled = booking.status === 'SCHEDULED'
  const [vehicleId, setVehicleId] = useState(baselineProposal?.vehicleId ?? '')
  const [driverId, setDriverId] = useState(baselineProposal?.driverId ?? '')
  const depotId = booking.depotLocationId ?? catalog.depotLocationId ?? ''
  const [originId, setOriginId] = useState(modifying && booking.startedAt ? baselineProposal?.originLocationId ?? depotId : depotId)
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
  const scheduleOriginId = needsHandoff ? originId : acceptConfiguration ? catalog.depotLocationId ?? '' : depotId
  const assigning = scheduled && !acceptConfiguration && !!baselineProposal &&
    baselineProposal.originKind === 'depot' && baselineProposal.originLocationId === scheduleOriginId &&
    baselineProposal.vehicleId === vehicleId && baselineProposal.driverId === driverId &&
    baselineProposal.pickupWaitingMinutes === Number(waiting)
  const checkingSchedule = !modifying && !assigning && !acceptConfiguration
  const checking = busy || refreshing
  const signature = JSON.stringify({vehicleId,driverId,scheduleOriginId,waiting,acceptConfiguration})
  const currentPreview = acceptConfiguration && configurationPreview?.signature === signature ? configurationPreview : null
  const proposal = currentPreview?.schedule ?? (modifying || assigning ? baselineProposal : null)
  async function preview() {
    if (pending.current) return
    pending.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try {
      const result = await staffRequest<{configurationRevision: number; schedule: Schedule & {vehicleId: string; driverId: string}}>(`/bookings/${booking.id}/configuration-preview`, {
        expectedRevision: booking.revision, vehicleId, driverId, originLocationId: scheduleOriginId, originKind: 'depot',
        pickupWaitingMinutes: Number(waiting),
      })
      setConfigurationPreview({...result,signature})
    } catch (error) {setConfigurationPreview(null);setError(dispatcherScheduleError(error))}
    finally {pending.current = false;setBusy(false);onBusyChange?.(false)}
  }
  async function submit() {
    if (pending.current) return
    pending.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try {
      await staffRequest(`/bookings/${encodeURIComponent(booking.id)}/${modifying ? 'modification' : assigning ? 'assignment' : 'schedule'}`, {
        eventId: crypto.randomUUID(), expectedRevision: booking.revision, vehicleId, driverId,
        originLocationId: scheduleOriginId, originKind: needsHandoff ? 'handoff' : 'depot',
        pickupWaitingMinutes: Number(waiting),
        ...(modifying || acceptConfiguration ? { reason: reason.trim() } : {}),
        ...(acceptConfiguration && currentPreview ? {acceptConfiguration: true, expectedConfigurationRevision: currentPreview.configurationRevision} : {}),
        ...(needsHandoff ? { arrangement: { locationId: originId, confirmedAt, note: arrangementNote.trim() } } : {}),
      })
      setConfirm(false)
      if (modifying || assigning) onAssigned()
      else reload()
    } catch (error) { setError(dispatcherScheduleError(error)) }
    finally { pending.current = false; setBusy(false); onBusyChange?.(false) }
  }
  return <section className="dispatch-panel dispatch-assignment-form">
    <div className="dispatch-selected-job"><span>งานที่เลือก · {booking.reference}</span><strong>{booking.patientName}</strong><p>{booking.hospitalName ?? catalog.hospitals.find(h => h.id === booking.hospitalId)?.name}</p></div>
    {booking.scheduleReviewRequired && !booking.startedAt && <section className="dispatch-alert"><p>มีการตั้งค่าที่เปลี่ยนแปลง ตารางเดิมยังมีผลจนกว่ายืนยันใหม่</p>{booking.configurationChanges?.map(change => <p key={change.id}>{({hospital:'โรงพยาบาล',village:'พื้นที่บริการ',depot:'ศูนย์รถ',closure:'วันปิดบริการ'} as Record<string,string>)[change.type]} · {change.proposed.name ?? change.proposed.date}{change.proposed.latitude !== undefined ? ` · ${change.proposed.latitude}, ${change.proposed.longitude}` : ''}{change.proposed.active === false ? ' · ปิดใช้งาน / เปิดบริการอีกครั้ง' : ''}</p>)}<label className="booking-checkbox"><input type="checkbox" disabled={busy} checked={acceptConfiguration} onChange={event => {setAcceptConfiguration(event.target.checked);setConfigurationPreview(null)}} />ตรวจสอบและนำการตั้งค่าปัจจุบันมาคำนวณใหม่</label></section>}
    <h2>2. ตารางเวลาเดินทางที่ระบบคำนวณ</h2>
    {proposal ? <div className="dispatch-schedule-summary"><p>นัด {dispatchDate(booking.appointmentAt)} · {dispatchTime(booking.appointmentAt)} น.</p><ol className="dispatch-assignment-timeline" aria-label="กำหนดการเดินทาง">
      <li><span>ออกจากต้นทาง</span><strong>{dispatchTime(proposal.departureAt)}</strong></li><li><span>รับผู้ป่วย</span><strong>{dispatchTime(proposal.pickupAt)}</strong></li><li><span>ถึงโรงพยาบาล</span><strong>{dispatchTime(proposal.arrivalAt)}</strong></li>
    </ol><p>{modifying ? 'ตารางเดิมยังมีผลจนกว่าระบบยืนยันการเปลี่ยนแปลงสำเร็จ' : 'ยืนยันตารางแล้ว ยังไม่จองรถหรือคนขับจนกว่าจะยืนยันการมอบหมาย'}</p></div> : <div className="dispatch-schedule-summary">
      <strong>รอคำนวณเวลาเดินทาง</strong>
      <p>เลือกรถและคนขับ แล้วกด “ตรวจสอบ” เพื่อคำนวณเวลาเดินทาง</p>
    </div>}
    <p className="dispatch-small">ข้อมูลเส้นทาง © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> / OSRM · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">แก้ไขแผนที่</a></p>
    <fieldset disabled={checking}>
      <h2>3. เลือกรถและคนขับ</h2><div className="dispatch-resource-row"><ResourcePicker label="รถรับส่ง" placeholder="เลือกรถ" value={vehicleId} options={catalog.vehicles.map(v => ({ id: v.id, label: vehicleLabel(v), active: v.active && (!v.held || (modifying && v.id === booking.vehicleId)) }))} onChange={id => { setVehicleId(id); setError('') }} /><ResourcePicker label="คนขับ" placeholder="เลือกคนขับ" value={driverId} options={catalog.drivers.map(d => ({ id: d.id, label: d.name, active: d.active && (!d.held || (modifying && d.id === booking.driverId)) }))} onChange={id => { setDriverId(id); setError('') }} /></div>
      {needsHandoff ? <label className="booking-field">ต้นทาง<select value={originId} onChange={event => { setOriginId(event.target.value); setConfirmedAt('') }}><option value="">เลือกต้นทาง</option>{catalog.locations.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label> : <p className="dispatch-small">ต้นทาง · {catalog.locations.find(location => location.id === scheduleOriginId)?.name ?? 'ศูนย์รถ'}</p>}
      <label className="booking-field">เวลารอที่จุดรับเพิ่มเติม (นาที)<input type="number" min="0" step="1" value={waiting} onChange={event => { setWaiting(event.target.value); setError('') }} /></label>
      {(modifying || acceptConfiguration) && <label className="booking-field">เหตุผลการเปลี่ยนแปลง<textarea required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>}
      {needsHandoff && <><p className="dispatch-alert">เริ่มงานแล้ว ต้องตรวจสอบตำแหน่งและการรับช่วงก่อนรับผู้ป่วย รถหรือคนขับเดิมที่ปล่อยออกจะยังไม่พร้อมจนกว่าจะยืนยันความพร้อมแยกต่างหาก</p><label className="booking-field">การยืนยันต้นทางและการรับช่วง<textarea required maxLength={1000} value={arrangementNote} onChange={event => { setArrangementNote(event.target.value); setConfirmedAt('') }} /></label><label className="booking-checkbox"><input type="checkbox" checked={!!confirmedAt} onChange={event => setConfirmedAt(event.target.checked ? new Date().toISOString() : '')} /><span>ยืนยันตำแหน่งและแผนรับช่วงจริงแล้ว (ต้องยืนยันภายใน 5 นาที)</span></label></>}
    </fieldset>
    {acceptConfiguration && <><DispatchButton secondary disabled={busy || !vehicleId || !driverId || !scheduleOriginId} onClick={() => void preview()}>คำนวณข้อเสนอใหม่โดยยังไม่เปลี่ยนตาราง</DispatchButton>{currentPreview && <p className="dispatch-small">ข้อเสนอคำนวณจากเส้นทางที่ตรวจสอบแล้ว กรุณาตรวจเวลาข้างต้นก่อนยืนยัน</p>}</>}
    {error && !confirm && <p role="alert" className="dispatch-alert">{error}</p>}
    <DispatchButton disabled={checking || (booking.scheduleReviewRequired && !booking.startedAt && !acceptConfiguration) || (acceptConfiguration && (!currentPreview || !reason.trim())) || !vehicleId || !driverId || !scheduleOriginId || !Number.isFinite(Number(waiting)) || Number(waiting) < 0 || (modifying && !reason.trim()) || (needsHandoff && (!confirmedAt || !arrangementNote.trim()))} onClick={() => {
      if (checkingSchedule) void submit()
      else { setError(''); setConfirm(true) }
    }}>{checkingSchedule ? checking ? 'กำลังตรวจสอบ…' : 'ตรวจสอบ' : modifying ? 'ตรวจสอบและยืนยันการเปลี่ยนแปลง' : assigning ? 'ยืนยัน' : 'ตรวจสอบและยืนยันตาราง'}</DispatchButton>
    {confirm && <DispatchModal title={modifying ? 'ยืนยันการเปลี่ยนแปลง' : assigning ? 'ยืนยันการมอบหมาย' : 'ยืนยันตารางเวลา'} onClose={() => { if (!pending.current) setConfirm(false) }}><p>{modifying ? 'ระบบจะตรวจความพร้อมใหม่และเก็บประวัติตารางเดิม หากไม่ผ่านจะคงตารางเดิมไว้' : assigning ? 'ระบบจะตรวจความพร้อมล่าสุดและจองรถกับคนขับเมื่อสำเร็จ' : 'ระบบจะคำนวณเส้นทางและยืนยันตาราง โดยยังไม่จองรถหรือคนขับ'}</p>{error && <p role="alert" className="dispatch-alert">{error}</p>}<DispatchButton disabled={busy} onClick={() => void submit()}>{busy ? 'กำลังตรวจสอบ…' : modifying ? 'ยืนยันการเปลี่ยนแปลง' : assigning ? 'ยืนยันการมอบหมาย' : 'ยืนยันตาราง'}</DispatchButton><DispatchButton secondary disabled={busy} onClick={() => setConfirm(false)}>กลับไปตรวจสอบ</DispatchButton></DispatchModal>}
  </section>
}

