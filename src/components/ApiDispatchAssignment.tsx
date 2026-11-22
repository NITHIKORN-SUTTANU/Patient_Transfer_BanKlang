import { useRef, useState } from 'react'
import {
  bangkokClockFromMs,
  bangkokDateFromMs,
  computeBackwardBlockedWindow,
  normalizeMobilityCode,
  parseVehicleCapabilities,
} from '../domain/capacity'
import type { ApiBooking, Catalog, Schedule } from '../services/dispatcherApi'
import { dispatcherError } from '../services/dispatcherApi'
import { staffRequest } from '../services/staffSession'
import { dispatchDate, dispatchTime } from '../services/dispatch'
import { DispatchButton, DispatchModal, ResourcePicker } from './DispatcherUI'
import { ServiceSymbol } from './ServiceSymbol'

const MOBILITY_LABELS = { standard: 'ทั่วไป', wheelchair: 'รถเข็น', stretcher: 'เปลนอน' } as const
const MOBILITY_ICONS = { standard: 'walk', wheelchair: 'wheel', stretcher: 'bed' } as const

function shortHospital(name?: string | null): string {
  if (!name) return 'โรงพยาบาล'
  return name.replace(/^โรงพยาบาล/, 'รพ.')
}

export function ApiDispatchAssignment({ booking, catalog, previousJobs, reload, onAssigned, onBusyChange }: { booking: ApiBooking; catalog: Catalog; previousJobs: ApiBooking[]; reload: () => void; onAssigned: () => void; onBusyChange?: (busy: boolean) => void }) {
  const modifying = ['ASSIGNED', 'PICKING_UP'].includes(booking.status)
  const baselineProposal = booking.proposedSchedule ?? (modifying && booking.schedule ? { ...booking.schedule, vehicleId: booking.vehicleId ?? '', driverId: booking.driverId ?? '' } : null)
  const scheduled = booking.status === 'SCHEDULED'
  const [editingProposal, setEditingProposal] = useState(false)
  const [vehicleId, setVehicleId] = useState(baselineProposal?.vehicleId ?? '')
  const [driverId, setDriverId] = useState(baselineProposal?.driverId ?? '')
  const depotOriginId = booking.depotLocationId ?? catalog.depotLocationId ?? catalog.locations.find(location => location.kind === 'depot')?.id ?? ''
  const [originId, setOriginId] = useState(baselineProposal?.originLocationId ?? depotOriginId)
  const [previousId, setPreviousId] = useState(baselineProposal?.previousBookingId ?? '')
  const [waiting, setWaiting] = useState(String(baselineProposal?.pickupWaitingMinutes ?? 0))
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const resourceSectionRef = useRef<HTMLFieldSetElement>(null)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const [arrangementNote, setArrangementNote] = useState('')
  const [confirmedAt, setConfirmedAt] = useState('')
  const [acceptConfiguration, setAcceptConfiguration] = useState(false)
  const [configurationPreview, setConfigurationPreview] = useState<{signature: string; configurationRevision: number; schedule: Schedule & {vehicleId: string; driverId: string}} | null>(null)
  const assigning = scheduled && !acceptConfiguration && !editingProposal
  const needsHandoff = modifying && !!booking.startedAt
  const origin = catalog.locations.find(location => location.id === originId)
  const signature = JSON.stringify({vehicleId,driverId,originId,previousId,waiting,acceptConfiguration})
  const currentPreview = acceptConfiguration && configurationPreview?.signature === signature ? configurationPreview : null
  const proposal = currentPreview?.schedule ?? baselineProposal
  const requiredMobility = normalizeMobilityCode(booking.mobility)
  const selectedVehicle = catalog.vehicles.find(v => v.id === vehicleId)
  const incompatibleMobility = Boolean(
    selectedVehicle &&
      Array.isArray(selectedVehicle.capabilities) &&
      selectedVehicle.capabilities.length > 0 &&
      !selectedVehicle.capabilities.includes(requiredMobility),
  )
  const matchingPreviousJobs = previousJobs.filter(
    row =>
      row.id !== booking.id &&
      row.schedule &&
      row.vehicleId === vehicleId &&
      row.driverId === driverId &&
      (row.hospitalLocationId ?? catalog.hospitals.find(h => h.id === row.hospitalId)?.location_id) === originId &&
      !['CANCELLED', 'REJECTED', 'ABORTED'].includes(row.status),
  )
  const hospitalName = booking.hospitalName ?? catalog.hospitals.find(h => h.id === booking.hospitalId)?.name
  const outsideServiceHours = (() => {
    if (proposal) {
      const dep = bangkokClockFromMs(Date.parse(proposal.departureAt))
      const ready = bangkokClockFromMs(Date.parse(proposal.readyAt))
      return Boolean((dep && dep < '06:00') || (ready && ready > '16:00'))
    }
    const est = computeBackwardBlockedWindow(booking.appointmentAt, { hospitalName })
    return Boolean(est && (est.departureClock < '06:00' || est.freeClock > '16:00'))
  })()
  const currentWin = computeBackwardBlockedWindow(booking.appointmentAt, {
    hospitalName,
    existingSchedule: proposal,
  })
  const [todayBkk] = useState(() => bangkokDateFromMs(Date.now()))
  const resolveHospitalName = (row: ApiBooking) =>
    row.hospitalName ?? catalog.hospitals.find(h => h.id === row.hospitalId)?.name ?? 'โรงพยาบาล'

  const vehicleInsights = new Map(
    catalog.vehicles.map(v => {
      const caps = parseVehicleCapabilities({ capabilities: v.capabilities })
      const capText = caps.map(c => MOBILITY_LABELS[c]).join('/')
      const supportsCase = !Array.isArray(v.capabilities) || v.capabilities.length === 0 || caps.includes(requiredMobility)
      const incidentPeer = previousJobs.find(
        row => row.id !== booking.id && row.vehicleId === v.id && row.incidentOpen && !['COMPLETED', 'CANCELLED', 'REJECTED', 'ABORTED'].includes(row.status),
      )
      const heldOrIncident = Boolean(incidentPeer || (v.held && !(modifying && v.id === booking.vehicleId)))
      let overlapWin: ReturnType<typeof computeBackwardBlockedWindow> = null
      let overlapHospital = ''
      if (currentWin) {
        for (const peer of previousJobs) {
          if (peer.id === booking.id || peer.vehicleId !== v.id || ['CANCELLED', 'REJECTED', 'ABORTED', 'COMPLETED'].includes(peer.status)) continue
          const peerWin = computeBackwardBlockedWindow(peer.appointmentAt, {
            hospitalName: resolveHospitalName(peer),
            existingSchedule: peer.schedule,
          })
          if (peerWin && currentWin.startMs < peerWin.endMs && peerWin.startMs < currentWin.endMs) {
            overlapWin = peerWin
            overlapHospital = shortHospital(resolveHospitalName(peer))
            break
          }
        }
      }
      const activeTrip = previousJobs.find(
        row => row.id !== booking.id && row.vehicleId === v.id && ['PICKING_UP', 'PICKED_UP', 'IN_TRANSIT'].includes(row.status),
      ) ?? previousJobs.find(
        row => row.id !== booking.id && row.vehicleId === v.id && row.status === 'ASSIGNED' && bangkokDateFromMs(Date.parse(row.schedule?.pickupAt || row.appointmentAt)) === todayBkk,
      )
      const completedToday = previousJobs
        .filter(row => row.vehicleId === v.id && row.status === 'COMPLETED' && bangkokDateFromMs(Date.parse(row.schedule?.arrivalAt || row.appointmentAt)) === todayBkk)
        .sort((a, b) => Date.parse(b.schedule?.readyAt || b.appointmentAt) - Date.parse(a.schedule?.readyAt || a.appointmentAt))[0]

      const locationShort = activeTrip
        ? shortHospital(resolveHospitalName(activeTrip))
        : completedToday
        ? shortHospital(resolveHospitalName(completedToday))
        : 'ศูนย์รถฯ'
      const locationFull = activeTrip
        ? `ปลายทาง ${shortHospital(resolveHospitalName(activeTrip))}`
        : completedToday
        ? `จบงานล่าสุดที่ ${shortHospital(resolveHospitalName(completedToday))}`
        : 'ศูนย์รถ ทต.บ้านกลาง'

      let statusText = `ว่าง (${locationShort})`
      let badgeText = 'ว่างพร้อมจัด'
      let tone: 'free' | 'busy' | 'warn' | 'incident' | 'inactive' = supportsCase ? 'free' : 'warn'
      if (!v.active) {
        statusText = 'ปิดใช้งาน'
        badgeText = 'ปิดใช้งาน'
        tone = 'inactive'
      } else if (heldOrIncident) {
        statusText = 'มีเหตุขัดข้อง'
        badgeText = 'มีเหตุขัดข้อง / รอยืนยันความพร้อม'
        tone = 'incident'
      } else if (overlapWin) {
        statusText = `ติดงาน ${overlapWin.departureClock}–${overlapWin.freeClock} (${overlapHospital})`
        badgeText = `ติดงาน ${overlapWin.departureClock}–${overlapWin.freeClock}`
        tone = 'busy'
      }
      const meta = `${statusText} · ${capText}`
      return [v.id, { meta, statusText, badgeText, locationFull, supportsCase, tone, capText }] as const
    }),
  )

  const driverInsights = new Map(
    catalog.drivers.map(d => {
      const incidentPeer = previousJobs.find(
        row => row.id !== booking.id && row.driverId === d.id && row.incidentOpen && !['COMPLETED', 'CANCELLED', 'REJECTED', 'ABORTED'].includes(row.status),
      )
      const heldOrIncident = Boolean(incidentPeer || (d.held && !(modifying && d.id === booking.driverId)))
      let overlapWin: ReturnType<typeof computeBackwardBlockedWindow> = null
      if (currentWin) {
        for (const peer of previousJobs) {
          if (peer.id === booking.id || peer.driverId !== d.id || ['CANCELLED', 'REJECTED', 'ABORTED', 'COMPLETED'].includes(peer.status)) continue
          const peerWin = computeBackwardBlockedWindow(peer.appointmentAt, {
            hospitalName: resolveHospitalName(peer),
            existingSchedule: peer.schedule,
          })
          if (peerWin && currentWin.startMs < peerWin.endMs && peerWin.startMs < currentWin.endMs) {
            overlapWin = peerWin
            break
          }
        }
      }
      let statusText = 'ว่าง'
      let tone: 'free' | 'busy' | 'warn' | 'incident' | 'inactive' = 'free'
      if (!d.active) {
        statusText = 'ปิดใช้งาน'
        tone = 'inactive'
      } else if (heldOrIncident) {
        statusText = 'ติดเหตุขัดข้อง'
        tone = 'incident'
      } else if (overlapWin) {
        statusText = `ติดงาน ${overlapWin.departureClock}–${overlapWin.freeClock}`
        tone = 'busy'
      } else if (outsideServiceHours) {
        statusText = 'นอกกะเวลา'
        tone = 'warn'
      }
      return [d.id, { statusText, tone }] as const
    }),
  )

  const selectedVehicleInfo = vehicleId ? vehicleInsights.get(vehicleId) : undefined
  const selectedDriverInfo = driverId ? driverInsights.get(driverId) : undefined

  const countPriorJobsAtLocation = (locId: string) =>
    previousJobs.filter(
      row =>
        row.id !== booking.id &&
        row.schedule &&
        (!vehicleId || row.vehicleId === vehicleId) &&
        (!driverId || row.driverId === driverId) &&
        (row.hospitalLocationId ?? catalog.hospitals.find(h => h.id === row.hospitalId)?.location_id) === locId &&
        !['CANCELLED', 'REJECTED', 'ABORTED'].includes(row.status),
    ).length

  const resourceOverlapWarning = (() => {
    if (!vehicleId && !driverId) return ''
    if (!currentWin) return ''
    for (const peer of previousJobs) {
      if (peer.id === booking.id || ['CANCELLED', 'REJECTED', 'ABORTED', 'COMPLETED'].includes(peer.status)) continue
      const sameVehicle = Boolean(vehicleId && peer.vehicleId === vehicleId)
      const sameDriver = Boolean(driverId && peer.driverId === driverId)
      if (!sameVehicle && !sameDriver) continue
      const peerWin = computeBackwardBlockedWindow(peer.appointmentAt, {
        hospitalName: resolveHospitalName(peer),
        existingSchedule: peer.schedule,
      })
      if (!peerWin) continue
      if (currentWin.startMs < peerWin.endMs && peerWin.startMs < currentWin.endMs) {
        const who = sameVehicle && sameDriver ? 'รถรับส่งและคนขับ' : sameVehicle ? 'รถรับส่ง' : 'คนขับ'
        return `พบช่วงเวลาทับซ้อนของ${who}กับงาน ${peer.reference} (${peerWin.windowLabel}) — ระบบจะตรวจสอบซ้ำเมื่อยืนยัน`
      }
    }
    return ''
  })()

  const disabledReason = (() => {
    if (busy) return null
    if (booking.scheduleReviewRequired && !booking.startedAt && !acceptConfiguration) {
      return 'กรุณาติ๊กยืนยัน "ตรวจสอบและนำการตั้งค่าปัจจุบันมาคำนวณใหม่" ด้านบนก่อนดำเนินการ'
    }
    if (!vehicleId || !driverId) {
      return 'กรุณาเลือกรถรับส่งและคนขับให้ครบก่อนตรวจสอบและยืนยันตาราง'
    }
    if (incompatibleMobility) {
      return `รถที่เลือกไม่รองรับประเภทการเดินทางของผู้ป่วย (${MOBILITY_LABELS[requiredMobility]}) กรุณาเลือกรถคันอื่น`
    }
    if (!originId) {
      return 'กรุณาเลือกต้นทาง (เช่น ศูนย์รถเทศบาลตำบลบ้านกลาง) ก่อนดำเนินการ'
    }
    if (!needsHandoff && origin?.kind === 'hospital' && !previousId) {
      return 'กรุณาเลือก "งานก่อนหน้าที่โรงพยาบาล" เพื่อเชื่อมคิวต่อเนื่อง หรือเปลี่ยนต้นทางกลับเป็นศูนย์รถเทศบาลตำบลบ้านกลาง'
    }
    if (!Number.isFinite(Number(waiting)) || Number(waiting) < 0) {
      return 'กรุณาระบุเวลารอที่จุดรับเพิ่มเติมเป็นตัวเลขตั้งแต่ 0 นาทีขึ้นไป'
    }
    if (acceptConfiguration && !currentPreview) {
      return 'กรุณากด "คำนวณข้อเสนอใหม่โดยยังไม่เปลี่ยนตาราง" เพื่อให้ระบบคำนวณเวลาล่าสุดก่อนยืนยัน'
    }
    if ((modifying || acceptConfiguration) && !reason.trim()) {
      return 'กรุณาระบุเหตุผลการเปลี่ยนแปลงก่อนยืนยัน'
    }
    if (needsHandoff && (!confirmedAt || !arrangementNote.trim())) {
      return 'งานนี้เริ่มเดินทางแล้ว กรุณากรอกรายละเอียดการรับช่วงและติ๊กยืนยันตำแหน่งจริงก่อนยืนยัน'
    }
    if (scheduled && !proposal) {
      return 'การคำนวณตารางเวลายังไม่สมบูรณ์ กรุณากดคำนวณและยืนยันตารางใหม่อีกครั้ง'
    }
    return null
  })()

  function toggleEditProposal() {
    const next = !editingProposal
    setEditingProposal(next)
    setError('')
    setConfirm(false)
    setVehicleId(baselineProposal?.vehicleId ?? '')
    setDriverId(baselineProposal?.driverId ?? '')
    setOriginId(baselineProposal?.originLocationId ?? depotOriginId)
    setPreviousId(baselineProposal?.previousBookingId ?? '')
    setWaiting(String(baselineProposal?.pickupWaitingMinutes ?? 0))
    if (next) {
      requestAnimationFrame(() => {
        const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        resourceSectionRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' })
        resourceSectionRef.current?.querySelector<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled)')?.focus({ preventScroll: true })
      })
    }
  }

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
      await staffRequest(`/bookings/${encodeURIComponent(booking.id)}/${modifying ? 'modification' : assigning ? 'assignment' : 'schedule'}`, {
        eventId: crypto.randomUUID(), expectedRevision: booking.revision, vehicleId, driverId,
        originLocationId: originId, originKind: needsHandoff ? 'handoff' : origin?.kind === 'hospital' ? 'previous_hospital' : 'depot',
        ...(!needsHandoff && origin?.kind === 'hospital' ? { previousBookingId: previousId } : {}), pickupWaitingMinutes: Number(waiting),
        ...(modifying || acceptConfiguration ? { reason: reason.trim() } : {}),
        ...(acceptConfiguration && currentPreview ? {acceptConfiguration: true, expectedConfigurationRevision: currentPreview.configurationRevision} : {}),
        ...(needsHandoff ? { arrangement: { locationId: originId, confirmedAt, note: arrangementNote.trim() } } : {}),
      })
      setConfirm(false)
      if (modifying || assigning) onAssigned()
      else reload()
    } catch (error) { setError(dispatcherError(error)) }
    finally { pending.current = false; setBusy(false); onBusyChange?.(false) }
  }
  const confirmDisabled = busy || incompatibleMobility || (booking.scheduleReviewRequired && !booking.startedAt && !acceptConfiguration) || (acceptConfiguration && (!currentPreview || !reason.trim())) || !vehicleId || !driverId || !originId || (!needsHandoff && origin?.kind === 'hospital' && !previousId) || !Number.isFinite(Number(waiting)) || Number(waiting) < 0 || (scheduled && !proposal) || (modifying && !reason.trim()) || (needsHandoff && (!confirmedAt || !arrangementNote.trim()))
  return <section className="dispatch-panel dispatch-assignment-form">
    <div className="dispatch-selected-job">
      <div className="dispatch-selected-job-top">
        <span>งานที่เลือก · {booking.reference}</span>
        <span className={`dispatch-mobility-badge ${requiredMobility}`}>
          <ServiceSymbol kind={MOBILITY_ICONS[requiredMobility]} />
          {MOBILITY_LABELS[requiredMobility]}
        </span>
      </div>
      <strong>{booking.patientName}</strong>
      <p>{hospitalName}</p>
    </div>
    {booking.scheduleReviewRequired && !booking.startedAt && <section className="dispatch-alert"><p>มีการตั้งค่าที่เปลี่ยนแปลง ตารางเดิมยังมีผลจนกว่ายืนยันใหม่</p>{booking.configurationChanges?.map(change => <p key={change.id}>{({hospital:'โรงพยาบาล',village:'พื้นที่บริการ',depot:'ศูนย์รถ',closure:'วันปิดบริการ'} as Record<string,string>)[change.type]} · {change.proposed.name ?? change.proposed.date}{change.proposed.latitude !== undefined ? ` · ${change.proposed.latitude}, ${change.proposed.longitude}` : ''}{change.proposed.active === false ? ' · ปิดใช้งาน / เปิดบริการอีกครั้ง' : ''}</p>)}<label className="booking-checkbox"><input type="checkbox" disabled={busy} checked={acceptConfiguration} onChange={event => {setAcceptConfiguration(event.target.checked);setConfigurationPreview(null);if (event.target.checked && origin?.kind === 'depot') setOriginId(catalog.depotLocationId ?? '')}} />ตรวจสอบและนำการตั้งค่าปัจจุบันมาคำนวณใหม่</label></section>}
    <h2>2. ตารางเวลาเดินทางที่ระบบคำนวณ</h2>
    {proposal ? <div className="dispatch-schedule-summary"><p>นัด {dispatchDate(booking.appointmentAt)} · {dispatchTime(booking.appointmentAt)} น.</p><ol className="dispatch-assignment-timeline" aria-label="กำหนดการเดินทาง">
      <li><span>ออกจากต้นทาง</span><strong>{dispatchTime(proposal.departureAt)}</strong></li><li><span>รับผู้ป่วย</span><strong>{dispatchTime(proposal.pickupAt)}</strong></li><li><span>ถึงโรงพยาบาล</span><strong>{dispatchTime(proposal.arrivalAt)}</strong></li>
    </ol><b>พร้อมรับงานต่อ {dispatchTime(proposal.readyAt)} น. · เตรียมพร้อมที่โรงพยาบาล 30 นาที</b><p>{modifying ? 'ตารางเดิมยังมีผลจนกว่าระบบยืนยันการเปลี่ยนแปลงสำเร็จ' : 'ยืนยันตารางแล้ว ยังไม่จองรถหรือคนขับจนกว่าจะยืนยันการมอบหมาย'}</p></div> : <p className="dispatch-small">ระบบจะคำนวณเส้นทางและตรวจความพร้อมก่อนยืนยันตาราง · ถึงก่อนนัด 20 นาที และเตรียมพร้อมที่โรงพยาบาล 30 นาที</p>}
    {scheduled && !acceptConfiguration && (
      <div className="dispatch-edit-proposal-wrap">
        <DispatchButton
          secondary
          className={editingProposal ? 'dispatch-edit-proposal-btn is-active' : 'dispatch-edit-proposal-btn'}
          aria-pressed={editingProposal}
          disabled={busy}
          onClick={toggleEditProposal}
        >
          {editingProposal ? 'กลับไปใช้ข้อเสนอเดิม' : 'แก้ไขข้อเสนอตารางและทรัพยากร'}
        </DispatchButton>
        {editingProposal && (
          <p role="status" className="dispatch-edit-proposal-banner">
            กำลังแก้ไขข้อเสนอ — ปรับรถรับส่ง คนขับ ต้นทาง หรือเวลารอที่หัวข้อ "3. เลือกรถและคนขับ" ด้านล่าง จากนั้นกดยืนยันตารางใหม่ก่อนกด "ตรวจสอบซ้ำและยืนยันการมอบหมาย"
          </p>
        )}
      </div>
    )}
    <p className="dispatch-small">ข้อมูลเส้นทาง © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> / OSRM · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">แก้ไขแผนที่</a></p>
    <fieldset ref={resourceSectionRef} className={editingProposal ? 'is-editing-proposal' : undefined} disabled={busy || assigning}>
      <h2>3. เลือกรถและคนขับ</h2>
      <div className="dispatch-resource-row">
        <div className="dispatch-resource-col">
          <ResourcePicker
            label="รถรับส่ง"
            placeholder="เลือกรถ"
            value={vehicleId}
            options={catalog.vehicles.map(v => {
              const info = vehicleInsights.get(v.id)
              return {
                id: v.id,
                label: `${v.name} · ${v.plate}`,
                active: v.active && (!v.held || (modifying && v.id === booking.vehicleId)),
                selectable: true,
                meta: info?.meta,
                tone: info?.tone,
              }
            })}
            onChange={nextVehicleId => { setVehicleId(nextVehicleId); setPreviousId('') }}
          />
          {selectedVehicleInfo && (
            <div className="dispatch-selected-meta-pills" aria-label="สถานะรถที่เลือก">
              <span className={`dispatch-readiness-pill tone-${selectedVehicleInfo.tone}`}>{selectedVehicleInfo.badgeText}</span>
              <span className="dispatch-readiness-pill neutral">{selectedVehicleInfo.locationFull}</span>
              <span className={`dispatch-readiness-pill ${selectedVehicleInfo.supportsCase ? 'match' : 'mismatch'}`}>
                {selectedVehicleInfo.supportsCase ? '✓ รองรับเคสนี้' : `ไม่รองรับ ${MOBILITY_LABELS[requiredMobility]}`}
              </span>
            </div>
          )}
        </div>
        <div className="dispatch-resource-col">
          <ResourcePicker
            label="คนขับ"
            placeholder="เลือกคนขับ"
            value={driverId}
            options={catalog.drivers.map(d => {
              const info = driverInsights.get(d.id)
              return {
                id: d.id,
                label: d.name,
                active: d.active && (!d.held || (modifying && d.id === booking.driverId)),
                selectable: true,
                meta: info?.statusText,
                tone: info?.tone,
              }
            })}
            onChange={nextDriverId => { setDriverId(nextDriverId); setPreviousId('') }}
          />
          {selectedDriverInfo && (
            <div className="dispatch-selected-meta-pills" aria-label="สถานะคนขับที่เลือก">
              <span className={`dispatch-readiness-pill tone-${selectedDriverInfo.tone}`}>คนขับ: {selectedDriverInfo.statusText}</span>
            </div>
          )}
        </div>
      </div>
      <label className="booking-field">ต้นทาง
        <select
          id="dispatch-origin-select"
          value={originId}
          onChange={event => {
            setOriginId(event.target.value)
            setPreviousId('')
            setConfirmedAt('')
          }}
        >
          <option value="">เลือกต้นทาง</option>
          {catalog.locations.filter(l => needsHandoff || l.id === catalog.depotLocationId || l.id === booking.depotLocationId || l.id === baselineProposal?.originLocationId || l.kind === 'hospital').map(l => {
            if (l.kind !== 'hospital') return <option value={l.id} key={l.id}>{l.name}</option>
            const priorCount = countPriorJobsAtLocation(l.id)
            return <option value={l.id} key={l.id}>{l.name} ({priorCount > 0 ? `มี ${priorCount} งานก่อนหน้า` : 'ไม่มีงานก่อนหน้า'})</option>
          })}
        </select>
      </label>
      {!needsHandoff && origin?.kind === 'hospital' && (
        <div className="dispatch-chain-field">
          <label className="booking-field">งานก่อนหน้าที่โรงพยาบาล
            <select
              id="dispatch-previous-job-select"
              value={previousId}
              onChange={event => setPreviousId(event.target.value)}
            >
              <option value="">เลือกงานก่อนหน้า</option>
              {matchingPreviousJobs.map(row => <option value={row.id} key={row.id}>{row.reference} · {dispatchDate(row.appointmentAt)} {dispatchTime(row.appointmentAt)}</option>)}
            </select>
          </label>
          {matchingPreviousJobs.length === 0 && (
            <div className="dispatch-origin-helper" role="status">
              <p>ไม่พบงานก่อนหน้าของรถและคนขับคู่นี้ที่โรงพยาบาลดังกล่าว กรุณาเปลี่ยนต้นทางกลับเป็นศูนย์รถเทศบาลตำบลบ้านกลาง</p>
              {depotOriginId && depotOriginId !== originId && (
                <button
                  type="button"
                  className="dispatch-mini-link"
                  disabled={busy || assigning}
                  onClick={() => { setOriginId(depotOriginId); setPreviousId('') }}
                >
                  เปลี่ยนต้นทางเป็นศูนย์รถเทศบาล
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <label className="booking-field">เวลารอที่จุดรับเพิ่มเติม (นาที)<input type="number" min="0" step="1" value={waiting} onChange={event => setWaiting(event.target.value)} /></label>
      {(modifying || acceptConfiguration) && <label className="booking-field">เหตุผลการเปลี่ยนแปลง<textarea required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>}
      {needsHandoff && <><p className="dispatch-alert">เริ่มงานแล้ว ต้องตรวจสอบตำแหน่งและการรับช่วงก่อนรับผู้ป่วย รถหรือคนขับเดิมที่ปล่อยออกจะยังไม่พร้อมจนกว่าจะยืนยันความพร้อมแยกต่างหาก</p><label className="booking-field">การยืนยันต้นทางและการรับช่วง<textarea required maxLength={1000} value={arrangementNote} onChange={event => { setArrangementNote(event.target.value); setConfirmedAt('') }} /></label><label className="booking-checkbox"><input type="checkbox" checked={!!confirmedAt} onChange={event => setConfirmedAt(event.target.checked ? new Date().toISOString() : '')} /><span>ยืนยันตำแหน่งและแผนรับช่วงจริงแล้ว (ต้องยืนยันภายใน 5 นาที)</span></label></>}
    </fieldset>
    {acceptConfiguration && <><DispatchButton secondary disabled={busy || !vehicleId || !driverId || !originId} aria-busy={busy} onClick={() => void preview()}>{busy ? 'กำลังคำนวณ…' : 'คำนวณข้อเสนอใหม่โดยยังไม่เปลี่ยนตาราง'}</DispatchButton>{currentPreview && <p className="dispatch-small">ข้อเสนอคำนวณจากเส้นทางที่ตรวจสอบแล้ว กรุณาตรวจเวลาข้างต้นก่อนยืนยัน</p>}</>}
    <h2 className="dispatch-assignment-readiness-heading">4. ตรวจสอบความพร้อม</h2><p className="dispatch-small">ตรวจรถและคนขับใหม่เมื่อยืนยัน รวมกะทำงาน วันปิด และงานก่อนหน้า</p>
    {outsideServiceHours && <p role="status" className="dispatch-advisory-banner">หมายเหตุ: ช่วงเวลาเดินรถที่คำนวณอาจอยู่นอกเวลาทำการ (06:00–16:00 น.) ระบบจะตรวจสอบสิทธิ์และเวลาทำการอีกครั้งเมื่อยืนยัน</p>}
    {resourceOverlapWarning && <p role="status" className="dispatch-advisory-banner">{resourceOverlapWarning}</p>}
    {disabledReason && <div role="status" className="dispatch-disabled-reason"><strong>ยังไม่สามารถกดยืนยันได้:</strong> <span>{disabledReason}</span></div>}
    {error && !confirm && <p role="alert" className="dispatch-alert">{error}</p>}
    <DispatchButton disabled={confirmDisabled} aria-busy={busy} onClick={() => { setError(''); setConfirm(true) }}>{modifying ? 'ตรวจสอบและยืนยันการเปลี่ยนแปลง' : assigning ? 'ตรวจสอบซ้ำและยืนยันการมอบหมาย' : 'ตรวจสอบและยืนยันตาราง'}</DispatchButton>
    {confirm && <DispatchModal title={modifying ? 'ยืนยันการเปลี่ยนแปลง' : assigning ? 'ยืนยันการมอบหมาย' : 'ยืนยันตารางเวลา'} onClose={() => { if (!pending.current) setConfirm(false) }}><p>{modifying ? 'ระบบจะตรวจความพร้อมใหม่และเก็บประวัติตารางเดิม หากไม่ผ่านจะคงตารางเดิมไว้' : assigning ? 'ระบบจะตรวจความพร้อมล่าสุดและจองรถกับคนขับเมื่อสำเร็จ' : 'ระบบจะคำนวณเส้นทางและยืนยันตาราง โดยยังไม่จองรถหรือคนขับ'}</p>{error && <p role="alert" className="dispatch-alert">{error}</p>}<DispatchButton disabled={busy} aria-busy={busy} onClick={() => void submit()}>{busy ? 'กำลังตรวจสอบ…' : modifying ? 'ยืนยันการเปลี่ยนแปลง' : assigning ? 'ยืนยันการมอบหมาย' : 'ยืนยันตาราง'}</DispatchButton><DispatchButton secondary disabled={busy} onClick={() => setConfirm(false)}>กลับไปตรวจสอบ</DispatchButton></DispatchModal>}
  </section>
}

