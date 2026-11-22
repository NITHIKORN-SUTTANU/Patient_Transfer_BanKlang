import { useMemo } from 'react'
import { BAN_KLANG_VILLAGES, SUPPORTED_HOSPITALS } from '../data/realisticSeed'
import {
  bangkokClockFromMs,
  bangkokDateFromMs,
  computeBackwardBlockedWindow,
  normalizeMobilityCode,
} from '../domain/capacity'
import { isInteractiveDemoActive } from '../services/interactiveDemo'
import { seedOverlay, useSeedOverlay } from '../services/seedOverlay'
import { staffRequest } from '../services/staffSession'
import { AdminButton } from './AdminForms'

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

function formatThaiMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return `${THAI_MONTHS[m - 1] ?? m} ${String((y + 543) % 100).padStart(2, '0')}`
}

export function ExecutiveAnalyticsDashboard({
  summaryStatuses,
  totalVehicles,
  activeVehicles,
  onLoadedSeed,
}: {
  summaryStatuses: { status: string; count: number }[]
  totalVehicles: number
  activeVehicles: number
  onLoadedSeed?: () => void
}) {
  const overlay = useSeedOverlay()
  const bookings = overlay.active ? overlay.bookings : []

  const analytics = useMemo(() => {
    const activeBookings = overlay.active ? overlay.bookings : []
    const statusMap = new Map<string, number>()
    for (const row of summaryStatuses) {
      statusMap.set(row.status, row.count)
    }

    const totalFromStatuses = Array.from(statusMap.values()).reduce((sum, n) => sum + n, 0)
    const total = Math.max(totalFromStatuses, activeBookings.length)
    const completed = statusMap.get('COMPLETED') ?? activeBookings.filter(b => (b.apiStatus || b.status) === 'COMPLETED' || b.status === 'completed').length
    const cancelled = (statusMap.get('CANCELLED') ?? 0)
    const rejected = (statusMap.get('REJECTED') ?? 0)
    const aborted = (statusMap.get('ABORTED') ?? 0)
    const cancelledOrRejected = cancelled + rejected + aborted

    const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0
    const dropoutRate = total > 0 ? Math.round((cancelledOrRejected / total) * 1000) / 10 : 0

    // Monthly & daily trends
    const monthlyMap = new Map<string, number>()
    const daySet = new Set<string>()
    const hourMap = new Map<string, number>()
    for (let h = 6; h <= 15; h++) {
      hourMap.set(`${String(h).padStart(2, '0')}:00`, 0)
    }

    const villageCounts = new Map<string, number>(BAN_KLANG_VILLAGES.map(v => [v.id, 0]))
    const mobilityCounts = { standard: 0, wheelchair: 0, stretcher: 0 }
    const hospitalCounts = new Map<string, number>(SUPPORTED_HOSPITALS.map(h => [h.name, 0]))

    let blockedMinutesTotal = 0

    for (const b of activeBookings) {
      const apptMs = Date.parse(b.appointmentAt)
      if (Number.isFinite(apptMs)) {
        const bkkDate = bangkokDateFromMs(apptMs)
        daySet.add(bkkDate)
        const ym = bkkDate.slice(0, 7)
        monthlyMap.set(ym, (monthlyMap.get(ym) ?? 0) + 1)

        const clock = bangkokClockFromMs(apptMs)
        const hourBucket = `${clock.slice(0, 2)}:00`
        if (hourMap.has(hourBucket)) {
          hourMap.set(hourBucket, (hourMap.get(hourBucket) ?? 0) + 1)
        }
      }

      const vId = b.details?.villageId
      if (vId && villageCounts.has(vId)) {
        villageCounts.set(vId, (villageCounts.get(vId) ?? 0) + 1)
      }

      const mob = normalizeMobilityCode(b.details?.assistance)
      mobilityCounts[mob] += 1

      const hospName = b.details?.hospital
      if (hospName) {
        hospitalCounts.set(hospName, (hospitalCounts.get(hospName) ?? 0) + 1)
      }

      const st = b.apiStatus || b.status
      if (st !== 'CANCELLED' && st !== 'REJECTED' && st !== 'cancelled' && st !== 'rejected') {
        const win = computeBackwardBlockedWindow(b.appointmentAt, {
          hospitalName: b.details?.hospital,
          existingSchedule: b.schedule,
        })
        if (win) {
          blockedMinutesTotal += Math.max(60, Math.round((win.endMs - win.startMs) / 60_000))
        }
      }
    }

    const fleetDenominator = Math.max(1, activeVehicles || totalVehicles || overlay.vehicles.filter(v => v.active).length || 5)
    const activeServiceDays = Math.max(1, daySet.size)
    // 10 operating hours (06:00-16:00) per active vehicle per active service day
    const availableCapacityMinutes = fleetDenominator * activeServiceDays * 10 * 60
    const utilizationRate = activeBookings.length > 0
      ? Math.min(100, Math.round((blockedMinutesTotal / availableCapacityMinutes) * 1000) / 10)
      : 0

    const monthlySeries = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([ym, count]) => ({ ym, label: formatThaiMonth(ym), count }))

    const maxMonth = Math.max(1, ...monthlySeries.map(m => m.count))

    const peakHours = Array.from(hourMap.entries()).map(([hour, count]) => ({ hour, count }))
    const maxHour = Math.max(1, ...peakHours.map(h => h.count))
    const topPeakHour = [...peakHours].sort((a, b) => b.count - a.count)[0]

    const earlyCount = peakHours.filter(h => h.hour < '09:00').reduce((s, h) => s + h.count, 0)
    const morningCount = peakHours.filter(h => h.hour >= '09:00' && h.hour < '12:00').reduce((s, h) => s + h.count, 0)
    const afternoonCount = peakHours.filter(h => h.hour >= '12:00').reduce((s, h) => s + h.count, 0)
    const peakWindowsTotal = Math.max(1, earlyCount + morningCount + afternoonCount)
    const peakWindows = [
      { key: 'early', label: '06:00–09:00 น.', count: earlyCount, pct: Math.round((earlyCount / peakWindowsTotal) * 1000) / 10 },
      { key: 'morning', label: '09:00–12:00 น.', count: morningCount, pct: Math.round((morningCount / peakWindowsTotal) * 1000) / 10 },
      { key: 'afternoon', label: '12:00–16:00 น.', count: afternoonCount, pct: Math.round((afternoonCount / peakWindowsTotal) * 1000) / 10 },
    ]
    const maxPeakWindow = Math.max(1, ...peakWindows.map(w => w.count))

    const villages = BAN_KLANG_VILLAGES.map(v => {
      const count = villageCounts.get(v.id) ?? 0
      return {
        id: v.id,
        number: v.number,
        name: v.name,
        count,
        pct: activeBookings.length > 0 ? Math.round((count / activeBookings.length) * 1000) / 10 : 0,
      }
    })
    const maxVillage = Math.max(1, ...villages.map(v => v.count))

    const totalMob = mobilityCounts.standard + mobilityCounts.wheelchair + mobilityCounts.stretcher
    const mobilityBreakdown = [
      { code: 'standard', label: 'เดินได้ (ทั่วไป)', count: mobilityCounts.standard, pct: totalMob ? Math.round((mobilityCounts.standard / totalMob) * 1000) / 10 : 0 },
      { code: 'wheelchair', label: 'รถเข็น (Wheelchair)', count: mobilityCounts.wheelchair, pct: totalMob ? Math.round((mobilityCounts.wheelchair / totalMob) * 1000) / 10 : 0 },
      { code: 'stretcher', label: 'เปลนอน (Stretcher)', count: mobilityCounts.stretcher, pct: totalMob ? Math.round((mobilityCounts.stretcher / totalMob) * 1000) / 10 : 0 },
    ]

    const topHospitals = Array.from(hospitalCounts.entries())
      .map(([name, count]) => ({
        name,
        count,
        pct: activeBookings.length > 0 ? Math.round((count / activeBookings.length) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count)
    const maxHospital = Math.max(1, ...topHospitals.map(h => h.count))

    return {
      total,
      completed,
      cancelledOrRejected,
      completionRate,
      dropoutRate,
      utilizationRate,
      activeDays: daySet.size,
      dailyAverage: daySet.size > 0 ? Math.round((activeBookings.length / daySet.size) * 10) / 10 : 0,
      monthlySeries,
      maxMonth,
      peakHours,
      maxHour,
      topPeakHour,
      peakWindows,
      maxPeakWindow,
      villages,
      maxVillage,
      mobilityBreakdown,
      topHospitals,
      maxHospital,
    }
  }, [activeVehicles, overlay, summaryStatuses, totalVehicles])

  return (
    <section className="admin-panel admin-analytics-panel" aria-labelledby="exec-analytics-title">
      <div className="admin-panel-heading">
        <div>
          <h2 id="exec-analytics-title">แดชบอร์ดวิเคราะห์เชิงนโยบายสำหรับผู้บริหาร (Executive Analytics)</h2>
          <p className="admin-muted">
            สถิติภาพรวมแบบไม่ระบุตัวตนผู้ป่วย เพื่อวางแผนกำลังรถ งบประมาณ และการจัดสรรอุปกรณ์ 12 หมู่บ้านตำบลบ้านกลาง
          </p>
        </div>
        {!bookings.length && (
          <AdminButton
            onClick={() => {
              const generated = seedOverlay.loadRealisticSeed(320)
              if (isInteractiveDemoActive()) {
                void staffRequest('/admin/seed-import', { bookings: generated, replace: true })
                  .catch(() => undefined)
                  .finally(() => onLoadedSeed?.())
              } else {
                onLoadedSeed?.()
              }
            }}
          >
            โหลดข้อมูลจำลอง 320 รายการเพื่อดูแนวโน้ม
          </AdminButton>
        )}
      </div>

      <div className="admin-analytics-kpis" role="region" aria-label="ตัวชี้วัดหลักการเดินรถ">
        <article className="admin-kpi-card">
          <span>คำขอรับส่งสะสม</span>
          <strong>{analytics.total} รายการ</strong>
          <small>{bookings.length > 0 ? `เฉลี่ย ${analytics.dailyAverage} เที่ยว/วัน (${analytics.activeDays} วันให้บริการ)` : 'อ้างอิงจากยอดสรุประบบ'}</small>
        </article>
        <article className="admin-kpi-card success">
          <span>อัตราเดินทางสำเร็จ</span>
          <strong>{analytics.completionRate}%</strong>
          <small>เสร็จสิ้น {analytics.completed} จาก {analytics.total} รายการ</small>
        </article>
        <article className="admin-kpi-card warn">
          <span>อัตรายกเลิก / ปฏิเสธ</span>
          <strong>{analytics.dropoutRate}%</strong>
          <small>ยกเลิก ปฏิเสธ และยุติงานรวม {analytics.cancelledOrRejected} รายการ</small>
        </article>
        <article className="admin-kpi-card info">
          <span>อัตราการใช้กำลังรถ</span>
          <strong>{analytics.utilizationRate}%</strong>
          <small>คำนวณจากช่วงเวลาปิดรถจริงเทียบกับ {activeVehicles || totalVehicles || 5} คัน</small>
        </article>
      </div>

      {bookings.length > 0 ? (
        <div className="admin-analytics-grid">
          <section className="admin-chart-card" aria-labelledby="chart-monthly-title">
            <h3 id="chart-monthly-title">แนวโน้มปริมาณงานรับ–ส่งรายเดือน (12 เดือนล่าสุด)</h3>
            <ul className="admin-bar-list">
              {analytics.monthlySeries.map(item => (
                <li key={item.ym} className="admin-bar-row">
                  <span className="admin-bar-label">{item.label}</span>
                  <span className="admin-bar-track" aria-hidden="true">
                    <span className="admin-bar-fill primary" style={{ width: `${Math.max(4, Math.round((item.count / analytics.maxMonth) * 100))}%` }} />
                  </span>
                  <span className="admin-bar-val">{item.count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="admin-chart-card" aria-labelledby="chart-peak-title">
            <h3 id="chart-peak-title">
              ช่วงเวลานัดหมายหนาแน่น (Peak Appointment Hours){analytics.topPeakHour?.count ? ` · พีคสุด ${analytics.topPeakHour.hour} น.` : ''}
            </h3>
            <ul className="admin-bar-list compact" aria-label="สรุปตามช่วงเวลาหลัก">
              {analytics.peakWindows.map(win => (
                <li key={win.key} className="admin-bar-row">
                  <span className="admin-bar-label">{win.label}</span>
                  <span className="admin-bar-track" aria-hidden="true">
                    <span className={`admin-bar-fill ${win.count === analytics.maxPeakWindow && win.count > 0 ? 'peak' : 'primary'}`} style={{ width: `${win.count > 0 ? Math.max(4, Math.round((win.count / analytics.maxPeakWindow) * 100)) : 0}%` }} />
                  </span>
                  <span className="admin-bar-val">{win.count} ({win.pct}%)</span>
                </li>
              ))}
            </ul>
            <h4 className="admin-subchart-heading">รายละเอียดรายชั่วโมง</h4>
            <ul className="admin-bar-list compact">
              {analytics.peakHours.map(item => (
                <li key={item.hour} className="admin-bar-row">
                  <span className="admin-bar-label">{item.hour} น.</span>
                  <span className="admin-bar-track" aria-hidden="true">
                    <span
                      className={`admin-bar-fill ${item.count === analytics.topPeakHour?.count && item.count > 0 ? 'peak' : 'secondary'}`}
                      style={{ width: `${item.count > 0 ? Math.max(4, Math.round((item.count / analytics.maxHour) * 100)) : 0}%` }}
                    />
                  </span>
                  <span className="admin-bar-val">{item.count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="admin-chart-card" aria-labelledby="chart-village-title">
            <h3 id="chart-village-title">การกระจายตัวตามเขตพื้นที่ 12 หมู่บ้าน (ต.บ้านกลาง)</h3>
            <ul className="admin-bar-list compact">
              {analytics.villages.map(v => (
                <li key={v.id} className="admin-bar-row">
                  <span className="admin-bar-label">หมู่ {v.number} {v.name}</span>
                  <span className="admin-bar-track" aria-hidden="true">
                    <span className="admin-bar-fill primary" style={{ width: `${v.count > 0 ? Math.max(4, Math.round((v.count / analytics.maxVillage) * 100)) : 0}%` }} />
                  </span>
                  <span className="admin-bar-val">{v.count} ({v.pct}%)</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="admin-chart-card" aria-labelledby="chart-equipment-title">
            <h3 id="chart-equipment-title">สัดส่วนประเภทผู้ป่วย และโรงพยาบาลปลายทางยอดนิยม</h3>
            <ul className="admin-bar-list">
              {analytics.mobilityBreakdown.map(m => (
                <li key={m.code} className="admin-bar-row">
                  <span className="admin-bar-label">{m.label}</span>
                  <span className="admin-bar-track" aria-hidden="true">
                    <span className={`admin-bar-fill mob-${m.code}`} style={{ width: `${m.pct > 0 ? Math.max(4, m.pct) : 0}%` }} />
                  </span>
                  <span className="admin-bar-val">{m.count} ({m.pct}%)</span>
                </li>
              ))}
            </ul>
            <h4 className="admin-subchart-heading">โรงพยาบาลปลายทางยอดนิยม</h4>
            <ul className="admin-bar-list compact">
              {analytics.topHospitals.map(h => (
                <li key={h.name} className="admin-bar-row">
                  <span className="admin-bar-label" title={h.name}>{h.name}</span>
                  <span className="admin-bar-track" aria-hidden="true">
                    <span className="admin-bar-fill secondary" style={{ width: `${h.count > 0 ? Math.max(4, Math.round((h.count / analytics.maxHospital) * 100)) : 0}%` }} />
                  </span>
                  <span className="admin-bar-val">{h.count} เที่ยว ({h.pct}%)</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <p className="admin-muted admin-analytics-hint">
          ยังไม่มีข้อมูลเชิงลึกรายเที่ยวในชุดข้อมูลจำลอง — กด &quot;โหลดข้อมูลจำลอง 320 รายการเพื่อดูแนวโน้ม&quot; หรือนำเข้า CSV ด้านบน เพื่อดูกราฟรายเดือน ชั่วโมงเร่งด่วน และสถิติครบทั้ง 12 หมู่บ้าน
        </p>
      )}
    </section>
  )
}
