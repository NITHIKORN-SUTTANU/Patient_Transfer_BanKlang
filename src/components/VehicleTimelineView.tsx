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
import { ServiceSymbol } from './ServiceSymbol'

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

function assignTimelineLanes(trips: TimelineTrip[]): { items: (TimelineTrip & { lane: number })[]; laneCount: number } {
  const laneEnds: number[] = []
  const items = trips.map(trip => {
    let lane = laneEnds.findIndex(endMs => endMs <= trip.window.startMs)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(trip.window.endMs)
    } else {
      laneEnds[lane] = trip.window.endMs
    }
    return { ...trip, lane }
  })
  return { items, laneCount: Math.max(1, laneEnds.length) }
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
  const [todayDate] = useState(() => bangkokDateFromMs(Date.now()))

  // Collect dates with scheduled/assigned trips first, falling back to any non-terminal dates.
  const { scheduledDates, activeDates } = useMemo(() => {
    const scheduled = new Set<string>()
    const all = new Set<string>()
    for (const b of bookings) {
      if (!isNonTerminalBooking(b)) continue
      const ms = Date.parse(b.schedule?.pickupAt || b.appointmentAt)
      if (!Number.isFinite(ms)) continue
      const day = bangkokDateFromMs(ms)
      all.add(day)
      if (b.vehicleId) scheduled.add(day)
    }
    return {
      scheduledDates: Array.from(scheduled).sort(),
      activeDates: Array.from(all).sort(),
    }
  }, [bookings])

  // Default to today's date when it has scheduled trips, otherwise defaultDate (if active) or nearest active date.
  const resolvedDefaultDate = useMemo(() => {
    if (scheduledDates.includes(todayDate)) return todayDate
    if (defaultDate && scheduledDates.includes(defaultDate)) return defaultDate
    if (scheduledDates.length > 0) {
      return scheduledDates.find(d => d >= todayDate) ?? scheduledDates[scheduledDates.length - 1]
    }
    if (activeDates.includes(todayDate)) return todayDate
    if (defaultDate && activeDates.includes(defaultDate)) return defaultDate
    return activeDates.find(d => d >= todayDate) ?? activeDates[0] ?? defaultDate ?? todayDate
  }, [scheduledDates, activeDates, todayDate, defaultDate])

  const [dateSelection, setDateSelection] = useState<'AUTO' | 'ALL' | string>('AUTO')
  const isAllDays = dateSelection === 'ALL'
  const selectedDate = isAllDays ? '' : dateSelection === 'AUTO' ? resolvedDefaultDate : dateSelection

  const chipDates = useMemo(() => {
    const source = scheduledDates.length > 0 ? scheduledDates : activeDates
    // Prioritize today and upcoming dates first so older historical dates never crowd out today's schedule.
    const upcoming = source.filter(d => d >= todayDate)
    const pastRecent = source.filter(d => d < todayDate).reverse()
    const prioritized = [...upcoming, ...pastRecent]
    const ordered: string[] = []
    if (selectedDate && !prioritized.includes(selectedDate)) ordered.push(selectedDate)
    for (const d of prioritized) {
      if (!ordered.includes(d)) ordered.push(d)
      if (ordered.length >= 4) break
    }
    if (selectedDate && !ordered.includes(selectedDate)) {
      ordered.splice(ordered.length - 1, 1, selectedDate)
    }
    return ordered
  }, [scheduledDates, activeDates, todayDate, selectedDate])

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
      if (!isAllDays && day !== selectedDate) continue
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
  }, [bookings, fleetList, isAllDays, selectedDate])

  const totalTimelineTrips = useMemo(() => {
    let total = 0
    for (const bucket of tripsByVehicle.values()) total += bucket.length
    return total
  }, [tripsByVehicle])

  if (fleetList.length === 0) return null

  return (
    <section className="dispatch-panel dispatch-timeline-panel" aria-labelledby="vehicle-timeline-title">
      <div className="dispatch-timeline-header">
        <div>
          <h2 id="vehicle-timeline-title">ไทม์ไลน์รถและช่วงเวลาว่าง (Backward-Scheduled Timeline)</h2>
          <p className="dispatch-muted">
            แสดงช่วงเวลาที่รถและคนขับถูกใช้งานจริงรวมเวลาตีรถและพักเตรียมรถ 30 นาที ({isAllDays ? `ภาพรวมทุกวัน · ${totalTimelineTrips} งาน` : `${dispatchDate(selectedDate)} · ${totalTimelineTrips} งาน`})
          </p>
        </div>
        <div className="dispatch-timeline-controls">
          <label className="dispatch-date-filter">
            <span>{isAllDays ? 'ทุกวัน · เลือกวัน' : 'วันที่ดูไทม์ไลน์'}</span>
            <input
              type="date"
              aria-label="วันที่ดูไทม์ไลน์รถ"
              value={selectedDate}
              onChange={e => setDateSelection(e.target.value ? e.target.value : 'ALL')}
            />
          </label>
          <div className="dispatch-timeline-date-chips" role="group" aria-label="วันที่มีงาน">
            <button
              type="button"
              className={`dispatch-date-chip dispatch-date-chip-all ${isAllDays ? 'active' : ''}`}
              aria-pressed={isAllDays}
              onClick={() => setDateSelection('ALL')}
            >
              ทุกวัน
            </button>
            {chipDates.map(d => {
              const active = !isAllDays && selectedDate === d
              return (
                <button
                  key={d}
                  type="button"
                  className={`dispatch-date-chip ${active ? 'active' : ''}`}
                  aria-pressed={active}
                  title={active ? 'แตะอีกครั้งเพื่อสลับไปดูภาพรวมทุกวัน' : `ดูไทม์ไลน์วันที่ ${dispatchDate(d)}`}
                  onClick={() => setDateSelection(active ? 'ALL' : d)}
                >
                  {d.slice(8, 10)}/{d.slice(5, 7)}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {isAllDays ? (
        <p className="dispatch-timeline-all-days-note" role="status">
          เลือกวันที่ด้านบนเพื่อดูแถบช่วงเวลารายวัน (06:00–18:00 น.) — ด้านล่างแสดงสรุปรายการงานแยกตามรถและวันที่โดยไม่ซ้อนแถบเวลาต่างวันกัน
        </p>
      ) : (
        <div className="dispatch-timeline-scale" aria-hidden="true">
          <span>06:00</span>
          <span>09:00</span>
          <span>12:00</span>
          <span>15:00</span>
          <span>18:00 น.</span>
        </div>
      )}

      <div className="dispatch-timeline-rows">
        {fleetList.map(v => {
          const dayTrips = tripsByVehicle.get(v.id) ?? []
          const latestFree = dayTrips.length > 0 ? dayTrips[dayTrips.length - 1].window.freeClock : ''
          const statusLabel = !v.active
            ? 'ปิดใช้งาน'
            : v.held
            ? 'รอยืนยันความพร้อม'
            : dayTrips.length > 0
            ? isAllDays
              ? `มี ${dayTrips.length} งานตามแผน`
              : `ว่างอีกครั้ง ${latestFree} น.`
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
                      <ServiceSymbol kind={cap === 'stretcher' ? 'bed' : cap === 'wheelchair' ? 'wheel' : 'walk'} />
                      {capabilityBadgeText(cap)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="dispatch-timeline-track-area">
                {!isAllDays && (() => {
                  const { items: lanedTrips, laneCount } = assignTimelineLanes(dayTrips.slice(0, 12))
                  const trackHeight = laneCount > 1 ? laneCount * 28 + (laneCount - 1) * 4 + 6 : 32
                  return (
                    <div className="dispatch-timeline-track" style={{ height: `${trackHeight}px` }} aria-hidden="true">
                      {lanedTrips.map(({ booking, window, lane }) => {
                        const leftPct = pctFromClock(window.departureClock)
                        const rightPct = pctFromClock(window.freeClock)
                        const widthPct = Math.max(8, rightPct - leftPct)
                        return (
                          <div
                            key={booking.id}
                            className="dispatch-timeline-block"
                            style={{ left: `${leftPct}%`, width: `${widthPct}%`, top: `${3 + lane * 32}px`, height: '26px' }}
                            title={`${booking.id} · ${window.windowLabel}`}
                          >
                            <span>{window.departureClock}–{window.freeClock}</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}

                {dayTrips.length > 0 ? (
                  <ul className="dispatch-timeline-trip-list">
                    {dayTrips.slice(0, 10).map(({ booking, window, mobility }) => {
                      const tripDay = bangkokDateFromMs(Date.parse(booking.schedule?.pickupAt || booking.appointmentAt))
                      return (
                        <li key={booking.id} className="dispatch-timeline-trip-pill">
                          <span className="dispatch-timeline-trip-copy">
                            {isAllDays && <span className="dispatch-timeline-day-tag">{tripDay.slice(8, 10)}/{tripDay.slice(5, 7)}</span>}{' '}
                            <strong>{booking.id}</strong> · {booking.details?.hospital || 'ไม่ระบุโรงพยาบาล'} ·{' '}
                            <span className="dispatch-window-tag">{window.windowLabel}</span> · รับ {window.pickupClock} น.
                          </span>
                          <div className="dispatch-timeline-trip-actions">
                            <span className={`dispatch-mobility-badge ${mobility}`}>
                              <ServiceSymbol kind={mobility === 'stretcher' ? 'bed' : mobility === 'wheelchair' ? 'wheel' : 'walk'} />
                              {capabilityBadgeText(mobility)}
                            </span>
                            {onSelectBooking && (
                              <button type="button" className="dispatch-mini-link" onClick={() => onSelectBooking(booking)}>
                                รายละเอียด →
                              </button>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="dispatch-timeline-empty-note">{isAllDays ? 'ไม่มีงานมอบหมายค้างอยู่ — รถว่างพร้อมใช้งาน' : 'ไม่มีงานมอบหมายในวันที่เลือก — รถว่างตลอดวัน (06:00–18:00 น.)'}</p>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
