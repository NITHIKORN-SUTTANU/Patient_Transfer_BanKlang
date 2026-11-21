import { useMemo, useState } from 'react'
import type { Booking, Vehicle } from '../data/seed'
import {
  bangkokDateFromMs,
  computeBackwardBlockedWindow,
  isNonTerminalBooking,
  normalizeMobilityCode,
  parseVehicleCapabilities,
  type BackwardBlockedWindow,
} from '../domain/capacity'
import type { Catalog } from '../services/dispatcherApi'
import { dispatchDate } from '../services/dispatch'

const DAY_START_MIN = 6 * 60 // 06:00
const DAY_END_MIN = 18 * 60 // 18:00
const DAY_SPAN_MIN = DAY_END_MIN - DAY_START_MIN

function clockToMinutes(clock: string): number {
  const [h, m] = clock.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function pctFromClock(clock: string): number {
  const mins = clockToMinutes(clock)
  return Math.max(0, Math.min(100, ((mins - DAY_START_MIN) / DAY_SPAN_MIN) * 100))
}

function capabilityBadgeText(code: 'standard' | 'wheelchair' | 'stretcher') {
  if (code === 'stretcher') return 'เปลนอน'
  if (code === 'wheelchair') return 'รถเข็น'
  return 'ทั่วไป'
}

interface TimelineTrip {
  booking: Booking
  window: BackwardBlockedWindow
  mobility: 'standard' | 'wheelchair' | 'stretcher'
}

export function VehicleTimelineView({
  bookings,
  vehicles,
  catalogVehicles,
  defaultDate,
  onSelectBooking,
}: {
  bookings: Booking[]
  vehicles: Vehicle[]
  catalogVehicles?: Catalog['vehicles']
  defaultDate: string
  onSelectBooking?: (booking: Booking) => void
}) {
  // Prefer defaultDate when it has scheduled/assigned trips, otherwise fall back to nearest day with work.
  const activeDates = useMemo(() => {
    const dates = new Set<string>()
    for (const b of bookings) {
      if (!isNonTerminalBooking(b)) continue
      const ms = Date.parse(b.schedule?.pickupAt || b.appointmentAt)
      if (Number.isFinite(ms)) dates.add(bangkokDateFromMs(ms))
    }
    return Array.from(dates).sort()
  }, [bookings])

  const [manualDate, setManualDate] = useState('')
  const selectedDate =
    manualDate ||
    (activeDates.includes(defaultDate) ? defaultDate : activeDates[0] || defaultDate)

  const fleetList = useMemo(() => {
    if (catalogVehicles && catalogVehicles.length > 0) {
      const catIds = new Set(catalogVehicles.map(v => v.id))
      const extra = vehicles.filter(v => !catIds.has(v.id)).map(v => ({
        id: v.id,
        label: v.label,
        active: v.active,
        held: false,
        capabilities: parseVehicleCapabilities(v),
      }))
      return [
        ...catalogVehicles.map(v => ({
          id: v.id,
          label: `${v.name} · ${v.plate}`,
          active: v.active,
          held: v.held,
          capabilities: parseVehicleCapabilities({ capabilities: v.capabilities }),
        })),
        ...extra,
      ]
    }
    return vehicles.map(v => ({
      id: v.id,
      label: v.label,
      active: v.active,
      held: false,
      capabilities: parseVehicleCapabilities(v),
    }))
  }, [catalogVehicles, vehicles])

  const tripsByVehicle = useMemo(() => {
    const map = new Map<string, TimelineTrip[]>()
    for (const v of fleetList) map.set(v.id, [])

    for (const b of bookings) {
      if (!isNonTerminalBooking(b) || !b.vehicleId) continue
      const day = bangkokDateFromMs(Date.parse(b.schedule?.pickupAt || b.appointmentAt))
      if (day !== selectedDate) continue
      const win = computeBackwardBlockedWindow(b.appointmentAt, {
        hospitalName: b.details?.hospital,
        existingSchedule: b.schedule,
      })
      if (!win) continue
      const bucket = map.get(b.vehicleId)
      if (bucket) {
        bucket.push({
          booking: b,
          window: win,
          mobility: normalizeMobilityCode(b.details?.assistance),
        })
      }
    }

    for (const bucket of map.values()) {
      bucket.sort((a, b) => a.window.startMs - b.window.startMs)
    }
    return map
  }, [bookings, fleetList, selectedDate])

  if (fleetList.length === 0) return null

  return (
    <section className="dispatch-panel dispatch-timeline-panel" aria-labelledby="vehicle-timeline-title">
      <div className="dispatch-timeline-header">
        <div>
          <h2 id="vehicle-timeline-title">ไทม์ไลน์รถและช่วงเวลาว่าง (Backward-Scheduled Timeline)</h2>
          <p className="dispatch-muted">
            แสดงช่วงเวลาที่รถและคนขับถูกใช้งานจริงรวมเวลาตีรถและพักเตรียมรถ 30 นาที ({dispatchDate(selectedDate)})
          </p>
        </div>
        <div className="dispatch-timeline-controls">
          <label className="dispatch-date-filter">
            <span>วันที่ดูไทม์ไลน์</span>
            <input
              type="date"
              aria-label="วันที่ดูไทม์ไลน์รถ"
              value={selectedDate}
              onChange={e => setManualDate(e.target.value)}
            />
          </label>
          {activeDates.length > 0 && (
            <div className="dispatch-timeline-date-chips" role="group" aria-label="วันที่มีงาน">
              {activeDates.slice(0, 4).map(d => (
                <button
                  key={d}
                  type="button"
                  className={`dispatch-date-chip ${selectedDate === d ? 'active' : ''}`}
                  aria-pressed={selectedDate === d}
                  onClick={() => setManualDate(d)}
                >
                  {d.slice(8, 10)}/{d.slice(5, 7)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="dispatch-timeline-scale" aria-hidden="true">
        <span>06:00</span>
        <span>09:00</span>
        <span>12:00</span>
        <span>15:00</span>
        <span>18:00 น.</span>
      </div>

      <div className="dispatch-timeline-rows">
        {fleetList.map(v => {
          const dayTrips = tripsByVehicle.get(v.id) ?? []
          const latestFree = dayTrips.length > 0 ? dayTrips[dayTrips.length - 1].window.freeClock : ''
          const statusLabel = !v.active
            ? 'ปิดใช้งาน'
            : v.held
            ? 'รอยืนยันความพร้อม'
            : dayTrips.length > 0
            ? `ว่างอีกครั้ง ${latestFree} น.`
            : 'พร้อมใช้งานทันที'

          return (
            <article key={v.id} className={`dispatch-timeline-row ${!v.active || v.held ? 'inactive' : ''}`}>
              <div className="dispatch-timeline-vehicle-info">
                <div className="dispatch-timeline-vehicle-head">
                  <strong>{v.label}</strong>
                  <span className={`dispatch-free-badge ${dayTrips.length > 0 ? 'busy' : !v.active || v.held ? 'off' : 'free'}`}>
                    {statusLabel}
                  </span>
                </div>
                <div className="dispatch-mobility-chips">
                  {v.capabilities.map(cap => (
                    <span key={cap} className={`dispatch-mobility-badge ${cap}`}>
                      {capabilityBadgeText(cap)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="dispatch-timeline-track-area">
                <div className="dispatch-timeline-track" aria-hidden="true">
                  {dayTrips.map(({ booking, window }) => {
                    const leftPct = pctFromClock(window.departureClock)
                    const rightPct = pctFromClock(window.freeClock)
                    const widthPct = Math.max(8, rightPct - leftPct)
                    return (
                      <div
                        key={booking.id}
                        className="dispatch-timeline-block"
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                        title={`${booking.id} · ${window.windowLabel}`}
                      >
                        <span>{window.departureClock}–{window.freeClock}</span>
                      </div>
                    )
                  })}
                </div>

                {dayTrips.length > 0 ? (
                  <ul className="dispatch-timeline-trip-list">
                    {dayTrips.map(({ booking, window, mobility }) => (
                      <li key={booking.id} className="dispatch-timeline-trip-pill">
                        <span>
                          <strong>{booking.id}</strong> · {booking.details?.hospital || 'ไม่ระบุโรงพยาบาล'} ·{' '}
                          <span className="dispatch-window-tag">{window.windowLabel}</span> · รับ {window.pickupClock} น.
                        </span>
                        <span className={`dispatch-mobility-badge ${mobility}`}>{capabilityBadgeText(mobility)}</span>
                        {onSelectBooking && (
                          <button type="button" className="dispatch-mini-link" onClick={() => onSelectBooking(booking)}>
                            รายละเอียด →
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="dispatch-timeline-empty-note">ไม่มีงานมอบหมายในวันที่เลือก — รถว่างตลอดวัน (06:00–18:00 น.)</p>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
