import { useEffect, useMemo, useRef, useState } from 'react'
import { BAN_KLANG_DEPOT, SUPPORTED_HOSPITALS } from '../data/realisticSeed'
import type { Booking } from '../data/seed'
import {
  bangkokDateFromMs,
  computeBackwardBlockedWindow,
  isNonTerminalBooking,
  mobilityThaiLabel,
  normalizeMobilityCode,
} from '../domain/capacity'
import { statusLabels } from '../services/dispatcherApi'
import { dispatchDate, dispatchTime } from '../services/dispatch'
import { ServiceSymbol } from './ServiceSymbol'

function pinStatusColor(b: Booking): { tone: string; hex: string; statusText: string } {
  if (b.status === 'pending') return { tone: 'pending', hex: '#b45309', statusText: statusLabels[b.apiStatus || 'REQUESTED'] || 'รอตรวจสอบ' }
  if (b.status === 'approved' && !b.schedule) return { tone: 'approved', hex: '#1d4ed8', statusText: 'อนุมัติแล้ว · รอจัดรถ' }
  if (b.status === 'in_transit' || b.status === 'approved') return { tone: 'active', hex: '#166534', statusText: statusLabels[b.apiStatus || 'ASSIGNED'] || 'มอบหมาย / กำลังเดินทาง' }
  if (b.status === 'completed') return { tone: 'completed', hex: '#047857', statusText: 'เสร็จสิ้น' }
  return { tone: 'closed', hex: '#64748b', statusText: statusLabels[b.apiStatus || 'CANCELLED'] || 'ยกเลิก / ปฏิเสธ' }
}

export function DailyDispatchMapView({
  bookings,
  defaultDate,
  onOpenDetails,
  onGoAssign,
}: {
  bookings: Booking[]
  defaultDate: string
  onOpenDetails: (booking: Booking) => void
  onGoAssign: (booking: Booking) => void
}) {
  const activeDates = useMemo(() => {
    const counts = new Map<string, number>()
    for (const b of bookings) {
      const ms = Date.parse(b.schedule?.pickupAt || b.appointmentAt)
      if (!Number.isFinite(ms)) continue
      const d = bangkokDateFromMs(ms)
      counts.set(d, (counts.get(d) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }))
  }, [bookings])

  const [dateSelection, setDateSelection] = useState<'ALL' | string>('ALL')
  const [statusFilter, setStatusFilter] = useState<'all' | 'non_terminal'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState(false)

  const isAllDays = dateSelection === 'ALL'
  const effectiveDate = isAllDays
    ? ''
    : dateSelection ||
      (activeDates.some(item => item.date === defaultDate)
        ? defaultDate
        : activeDates.find(item => item.date >= defaultDate)?.date ||
          activeDates[activeDates.length - 1]?.date ||
          defaultDate)

  const dateScopedTotal = useMemo(() => {
    if (isAllDays) return bookings.length
    return bookings.filter(b => {
      const ms = Date.parse(b.schedule?.pickupAt || b.appointmentAt)
      return Number.isFinite(ms) && bangkokDateFromMs(ms) === effectiveDate
    }).length
  }, [bookings, isAllDays, effectiveDate])

  const dayBookings = useMemo(() => {
    return bookings
      .filter(b => {
        const ms = Date.parse(b.schedule?.pickupAt || b.appointmentAt)
        if (!Number.isFinite(ms)) return false
        if (!isAllDays && bangkokDateFromMs(ms) !== effectiveDate) return false
        if (statusFilter === 'non_terminal' && !isNonTerminalBooking(b)) return false
        return true
      })
      .sort((a, b) => Date.parse(b.appointmentAt) - Date.parse(a.appointmentAt))
  }, [bookings, isAllDays, effectiveDate, statusFilter])

  const mapMarkersSource = useMemo(() => dayBookings.slice(0, 60), [dayBookings])

  const selectedBooking = dayBookings.find(b => b.id === selectedId) ?? dayBookings[0] ?? null
  const selectedWindow = selectedBooking
    ? computeBackwardBlockedWindow(selectedBooking.appointmentAt, {
        hospitalName: selectedBooking.details?.hospital,
        existingSchedule: selectedBooking.schedule,
      })
    : null

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('maplibre-gl').Map | null>(null)
  const markersRef = useRef<import('maplibre-gl').Marker[]>([])

  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) return
    let cancelled = false

    async function initMap() {
      try {
        const maplibregl = await import('maplibre-gl')
        await import('maplibre-gl/dist/maplibre-gl.css')
        if (cancelled || !container) return

        const map = new maplibregl.Map({
          container,
          center: [BAN_KLANG_DEPOT.longitude, BAN_KLANG_DEPOT.latitude],
          zoom: 12.2,
          attributionControl: false,
          style: {
            version: 8,
            sources: {
              osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '© OpenStreetMap contributors',
              },
            },
            layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
          },
        })
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
        mapRef.current = map
        setMapReady(true)
      } catch {
        if (!cancelled) setMapError(true)
      }
    }

    void initMap()
    return () => {
      cancelled = true
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    let active = true

    async function syncMarkers() {
      try {
        const maplibregl = await import('maplibre-gl')
        const currentMap = mapRef.current
        if (!active || !currentMap) return

        markersRef.current.forEach(m => m.remove())
        markersRef.current = []

        // Municipal depot marker
        const depotEl = document.createElement('div')
        depotEl.className = 'dispatch-map-marker depot'
        depotEl.textContent = 'ศูนย์รถ'
        depotEl.title = BAN_KLANG_DEPOT.name
        markersRef.current.push(
          new maplibregl.Marker({ element: depotEl })
            .setLngLat([BAN_KLANG_DEPOT.longitude, BAN_KLANG_DEPOT.latitude])
            .addTo(currentMap),
        )

        // Plot each booking pickup pin (capped at 60 pins in All-Days overview for crisp performance)
        for (const b of mapMarkersSource) {
          const lat = b.details?.pickup?.latitude
          const lng = b.details?.pickup?.longitude
          if (typeof lat !== 'number' || typeof lng !== 'number') continue
          const mob = normalizeMobilityCode(b.details?.assistance)
          const color = pinStatusColor(b)
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.className = `dispatch-map-marker pin ${color.tone} ${selectedBooking?.id === b.id ? 'selected' : ''}`
          btn.style.backgroundColor = color.hex
          btn.setAttribute('aria-label', `เลือกหมุด ${b.id} (${b.patientName})`)
          btn.textContent = mob === 'stretcher' ? 'เปล' : mob === 'wheelchair' ? 'เข็น' : 'ทั่วไป'
          btn.addEventListener('click', () => setSelectedId(b.id))
          btn.addEventListener('mouseenter', () => setSelectedId(b.id))

          const marker = new maplibregl.Marker({ element: btn }).setLngLat([lng, lat]).addTo(currentMap)
          markersRef.current.push(marker)
        }
      } catch {
        // Map markers fallback cleanly to interactive list inspector.
      }
    }

    void syncMarkers()
    return () => { active = false }
  }, [mapMarkersSource, mapReady, selectedBooking?.id])

  useEffect(() => {
    const map = mapRef.current
    const lat = selectedBooking?.details?.pickup?.latitude
    const lng = selectedBooking?.details?.pickup?.longitude
    if (map && mapReady && typeof lat === 'number' && typeof lng === 'number') {
      try {
        map.easeTo({ center: [lng, lat], duration: 350 })
      } catch {
        // Ignore transition errors if map not painted yet.
      }
    }
  }, [mapReady, selectedBooking])

  return (
    <section className="dispatch-panel dispatch-map-view" aria-labelledby="daily-map-view-title">
      <div className="dispatch-map-toolbar">
        <div className="dispatch-map-heading">
          <h2 id="daily-map-view-title">แผนที่จัดรถรับ–ส่งรายวัน (Daily Dispatch Map · OSM)</h2>
          <p className="dispatch-muted">
            แสดงพิกัดจุดรับผู้ป่วยทั้งตำบลบ้านกลาง พร้อมสีสถานะ ประเภทอุปกรณ์ และช่วงเวลาปิดรถ ({isAllDays ? 'ภาพรวมทุกวัน' : dispatchDate(effectiveDate)} · {dayBookings.length} งาน)
          </p>
        </div>

        <div className="dispatch-map-controls-locked">
          <label className="dispatch-date-filter dispatch-map-date-control">
            <span>{isAllDays ? 'ทุกวัน · เลือกวัน' : 'วันที่บนแผนที่'}</span>
            <input
              type="date"
              aria-label="วันที่แสดงแผนที่รายวัน"
              value={effectiveDate}
              onChange={e => {
                setDateSelection(e.target.value ? e.target.value : 'ALL')
                setSelectedId(null)
              }}
            />
          </label>
          <div className="dispatch-timeline-date-chips dispatch-map-status-chips" role="group" aria-label="กรองสถานะบนแผนที่">
            <button
              type="button"
              className={`dispatch-date-chip ${statusFilter === 'all' ? 'active' : ''}`}
              aria-pressed={statusFilter === 'all'}
              onClick={() => setStatusFilter('all')}
            >
              ทุกสถานะ ({dateScopedTotal})
            </button>
            <button
              type="button"
              className={`dispatch-date-chip ${statusFilter === 'non_terminal' ? 'active' : ''}`}
              aria-pressed={statusFilter === 'non_terminal'}
              onClick={() => setStatusFilter('non_terminal')}
            >
              เฉพาะงานเปิดอยู่
            </button>
          </div>
        </div>
      </div>

      <div className="dispatch-map-date-strip" role="group" aria-label="เลือกวันที่มีงานรับส่ง">
        <span className="dispatch-small">วันที่มีงาน:</span>
        <button
          type="button"
          className={`dispatch-date-chip dispatch-date-chip-all ${isAllDays ? 'active' : ''}`}
          aria-pressed={isAllDays}
          onClick={() => { setDateSelection('ALL'); setSelectedId(null) }}
        >
          ทุกวัน ({bookings.length})
        </button>
        {activeDates.slice(-6).reverse().map(item => {
          const active = !isAllDays && effectiveDate === item.date
          return (
            <button
              key={item.date}
              type="button"
              className={`dispatch-date-chip ${active ? 'active' : ''}`}
              aria-pressed={active}
              title={active ? 'แตะอีกครั้งเพื่อกลับไปดูทุกวัน' : `ดูงานวันที่ ${dispatchDate(item.date)}`}
              onClick={() => {
                setDateSelection(active ? 'ALL' : item.date)
                setSelectedId(null)
              }}
            >
              {item.date.slice(8, 10)}/{item.date.slice(5, 7)} ({item.count})
            </button>
          )
        })}
      </div>

      <div className="dispatch-map-legend" aria-label="คำอธิบายสีหมุด">
        <span className="dispatch-legend-item pending">รอตรวจสอบ</span>
        <span className="dispatch-legend-item approved">รอจัดรถ</span>
        <span className="dispatch-legend-item active">มอบหมาย / กำลังรับส่ง</span>
        <span className="dispatch-legend-item completed">เสร็จสิ้น</span>
        <span className="dispatch-legend-item depot">ศูนย์รถ ทต.บ้านกลาง</span>
      </div>

      <div className="dispatch-map-layout">
        <div className="dispatch-map-canvas-wrap">
          <div
            ref={mapContainerRef}
            className="dispatch-map-canvas"
            role="region"
            aria-label="แผนที่จุดรับผู้ป่วยรายวันตำบลบ้านกลาง"
          />
          {mapError && (
            <p className="dispatch-small dispatch-map-fallback-note">
              โหมดแผนที่แบบกริดข้อความ (ไม่สามารถโหลดแผนที่ OpenStreetMap ได้ในขณะนี้) — เลือกหมุดงานจากรายการด้านข้างได้ตามปกติ
            </p>
          )}

          {selectedBooking && selectedWindow && (
            <article className="dispatch-map-popup-card" aria-live="polite" aria-label={`ข้อมูลจุดรับ ${selectedBooking.id}`}>
              <header>
                <div>
                  <strong>{selectedBooking.id} · {selectedBooking.patientName}</strong>
                  <span className={`dispatch-mobility-badge ${normalizeMobilityCode(selectedBooking.details?.assistance)}`}>
                    <ServiceSymbol kind={normalizeMobilityCode(selectedBooking.details?.assistance) === 'stretcher' ? 'bed' : normalizeMobilityCode(selectedBooking.details?.assistance) === 'wheelchair' ? 'wheel' : 'walk'} />
                    {mobilityThaiLabel(normalizeMobilityCode(selectedBooking.details?.assistance))}
                  </span>
                </div>
                <span className={`dispatch-status ${selectedBooking.status}`}>{pinStatusColor(selectedBooking).statusText}</span>
              </header>
              <dl className="dispatch-map-inspector-grid">
                <div>
                  <dt>โรงพยาบาลปลายทาง</dt>
                  <dd>{selectedBooking.details?.hospital || SUPPORTED_HOSPITALS[0].name}</dd>
                </div>
                <div>
                  <dt>จุดรับ</dt>
                  <dd>{selectedBooking.details?.pickup?.label || selectedBooking.details?.pickupAddress || 'ต.บ้านกลาง'}</dd>
                </div>
                <div>
                  <dt>ระยะเวลาเดินทางโดยประมาณ</dt>
                  <dd>
                    ศูนย์ฯ→จุดรับ {selectedWindow.deadheadMinutes} นาที · จุดรับ→รพ. {selectedWindow.returnMinutes} นาที
                    (รวม {selectedWindow.deadheadMinutes + selectedWindow.returnMinutes} นาที/เที่ยว)
                  </dd>
                </div>
                <div>
                  <dt>เวลานัดหมาย / เวลารับ</dt>
                  <dd>
                    นัด {dispatchTime(selectedBooking.appointmentAt)} น. · รับ ~{selectedWindow.pickupClock} น.
                  </dd>
                </div>
                <div className="full-span">
                  <dt>ช่วงเวลาปิดรถ (Blocked Window)</dt>
                  <dd className="dispatch-window-tag">{selectedWindow.windowLabel}</dd>
                </div>
              </dl>
              <div className="dispatch-row-actions">
                <button
                  type="button"
                  className="booking-button booking-secondary dispatch-map-action-btn"
                  onClick={() => onOpenDetails(selectedBooking)}
                >
                  ดูรายละเอียด →
                </button>
                {selectedBooking.status === 'approved' && !selectedBooking.schedule && (
                  <button
                    type="button"
                    className="dispatch-quick-approve-btn"
                    onClick={() => onGoAssign(selectedBooking)}
                  >
                    จัดรถและคนขับ →
                  </button>
                )}
              </div>
            </article>
          )}
        </div>

        <aside className="dispatch-map-pin-list" aria-label="รายการหมุดงานประจำวัน">
          <h3>{isAllDays ? `งานรับ–ส่งทั้งหมด (${dayBookings.length})` : `งานรับ–ส่งวันที่ ${dispatchDate(effectiveDate)} (${dayBookings.length})`}</h3>
          {dayBookings.length === 0 ? (
            <p className="dispatch-empty">ไม่มีงานรับ–ส่งในวันที่เลือก กรุณาเลือกวันอื่นจากแถบด้านบน</p>
          ) : (
            <ul>
              {dayBookings.slice(0, 50).map(b => {
                const mob = normalizeMobilityCode(b.details?.assistance)
                const win = computeBackwardBlockedWindow(b.appointmentAt, {
                  hospitalName: b.details?.hospital,
                  existingSchedule: b.schedule,
                })
                const color = pinStatusColor(b)
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      className={`dispatch-map-list-item ${selectedBooking?.id === b.id ? 'selected' : ''}`}
                      aria-pressed={selectedBooking?.id === b.id}
                      onClick={() => setSelectedId(b.id)}
                    >
                      <div className="dispatch-map-list-head">
                        <span className="dispatch-map-dot" style={{ backgroundColor: color.hex }} aria-hidden="true" />
                        <strong>{b.id}</strong>
                        <span className={`dispatch-mobility-badge ${mob}`}>
                          <ServiceSymbol kind={mob === 'stretcher' ? 'bed' : mob === 'wheelchair' ? 'wheel' : 'walk'} />
                          {mobilityThaiLabel(mob)}
                        </span>
                      </div>
                      <span className="dispatch-job-patient">{b.patientName}</span>
                      <span className="dispatch-small">{b.details?.hospital || 'ไม่ระบุโรงพยาบาล'}</span>
                      {win && (
                        <span className="dispatch-small">
                          รับ ~{win.pickupClock} น. · {win.windowLabel}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
      </div>
    </section>
  )
}
