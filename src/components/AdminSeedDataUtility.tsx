import { useRef, useState } from 'react'
import { BAN_KLANG_VILLAGES, generateRealisticSeedBookings } from '../data/realisticSeed'
import { ApiError } from '../services/api'
import { statusLabels } from '../services/dispatcherApi'
import { isDemoModeAllowed } from '../services/interactiveDemo'
import { seedOverlay, useSeedOverlay } from '../services/seedOverlay'
import { staffRequest } from '../services/staffSession'
import { generateRealisticSeedCSV, parseSeedBookingsCSV } from '../utils/seedCsvImport'
import { AdminButton, AdminField } from './AdminForms'
import { BookingModal } from './BookingUI'
import { PaginationControls } from './PaginationControls'
import { ServiceTable } from './ServiceTable'

const PAGE_SIZE = 50

export function AdminSeedDataUtility({ onChanged }: { onChanged?: () => void }) {
  const overlay = useSeedOverlay()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)

  async function tryBackendSync(path: string, body: unknown): Promise<'synced' | 'offline' | 'auth-error'> {
    try {
      await staffRequest(path, body)
      return 'synced'
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        return 'auth-error'
      }
      return 'offline'
    }
  }

  async function applyImportedBookings(bookings: ReturnType<typeof generateRealisticSeedBookings>, label: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const sync = await tryBackendSync('/admin/seed-import', { bookings, replace: true })
      if (sync === 'auth-error') {
        setError('เซสชันหมดอายุหรือไม่มีสิทธิ์ผู้ดูแลระบบ กรุณาเข้าสู่ระบบใหม่')
        return
      }
      seedOverlay.importBookings(bookings, label, true)
      setPage(1)
      setNotice(`นำเข้าข้อมูลสำเร็จ ${bookings.length} รายการ (${label})${sync === 'synced' ? ' · บันทึกลงฐานข้อมูลแล้ว' : ' · พร้อมใช้งานในโหมดทดลอง'}`)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'นำเข้าข้อมูลไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    setNotice('')
    try {
      const text = await file.text()
      const parsed = parseSeedBookingsCSV(text)
      if (!parsed.bookings.length) {
        setError(parsed.errors[0] || 'ไม่พบข้อมูลการจองที่ถูกต้องในไฟล์ CSV')
        return
      }
      await applyImportedBookings(parsed.bookings, `ไฟล์ ${file.name}`)
      if (parsed.errors.length > 0) {
        setNotice(prev => `${prev} (ข้าม ${parsed.errors.length} แถวที่ไม่สมบูรณ์)`)
      }
    } catch {
      setError('ไม่สามารถอ่านไฟล์ CSV ได้ กรุณาตรวจสอบการเข้ารหัส UTF-8')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleLoad320() {
    const generated = generateRealisticSeedBookings(320)
    await applyImportedBookings(generated, 'ชุดข้อมูลจำลอง 320 รายการ (18 เดือน / 12 หมู่บ้าน)')
  }

  function handleDownloadSampleCsv() {
    const bookings = overlay.active && overlay.bookings.length > 0 ? overlay.bookings : generateRealisticSeedBookings(320)
    const csv = generateRealisticSeedCSV(bookings)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'seed-bookings-banklang-320.csv'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice(`ส่งออกไฟล์ CSV ตัวอย่างแล้ว (${bookings.length} รายการ)`)
  }

  async function handleReset() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const sync = await tryBackendSync('/admin/seed-reset', { confirm: true })
      if (sync === 'auth-error') {
        setError('เซสชันหมดอายุหรือไม่มีสิทธิ์ผู้ดูแลระบบ')
        return
      }
      seedOverlay.reset()
      setConfirmReset(false)
      setShowPreview(false)
      setPage(1)
      setNotice('ล้างข้อมูลจำลองเรียบร้อยแล้ว ระบบพร้อมสำหรับการส่งมอบเทศบาล')
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ล้างข้อมูลจำลองไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const filtered = overlay.bookings.filter(b => {
    const needle = search.trim().toLowerCase()
    const village = BAN_KLANG_VILLAGES.find(v => v.id === b.details?.villageId)
    const villageText = village ? `หมู่ ${village.number} ${village.name}` : ''
    const matchesSearch = !needle || `${b.id} ${b.details?.hospital || ''} ${villageText} ${b.details?.date || ''}`.toLowerCase().includes(needle)
    const matchesStatus = !statusFilter || (b.apiStatus || b.status) === statusFilter
    return matchesSearch && matchesStatus
  })

  const pagedRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Strictly hidden in production builds unless Demo Mode is explicitly allowed.
  if (!isDemoModeAllowed()) {
    return null
  }

  return (
    <details className="admin-panel admin-seed-panel" open aria-labelledby="admin-seed-title">
      <summary className="admin-seed-summary">
        <span id="admin-seed-title">นำเข้าข้อมูลทดสอบ (.csv) — เฉพาะโหมดสาธิต</span>
        <span className="admin-seed-count-badge">
          {overlay.active ? `ข้อมูลจำลองในระบบ: ${overlay.bookings.length} รายการ` : 'ยังไม่มีชุดข้อมูลจำลอง'}
        </span>
      </summary>
      <p className="admin-muted">
        นำเข้าไฟล์ CSV ข้อมูลจำลอง 250–500+ รายการสำหรับทดสอบความจุและสถิติ หรือล้างข้อมูลจำลองก่อนส่งมอบระบบจริง (ไม่แสดงข้อมูลส่วนบุคคลผู้ป่วย)
      </p>

      <div className="admin-seed-actions">
        <div className="admin-seed-upload-wrap">
          <label className="admin-field" htmlFor="admin-seed-csv-input">
            นำเข้าข้อมูลจากไฟล์ CSV (UTF-8)
            <input
              ref={fileInputRef}
              id="admin-seed-csv-input"
              type="file"
              accept=".csv,text/csv"
              aria-label="อัปโหลดไฟล์ CSV ข้อมูลการจอง"
              disabled={busy}
              onChange={e => void handleFileChange(e)}
            />
          </label>
        </div>
        <div className="admin-seed-buttons">
          <AdminButton disabled={busy} onClick={() => void handleLoad320()}>
            {busy ? 'กำลังประมวลผล…' : 'โหลดข้อมูลตัวอย่าง 320 รายการ'}
          </AdminButton>
          <AdminButton secondary disabled={busy} onClick={handleDownloadSampleCsv}>
            ดาวน์โหลด CSV ตัวอย่าง
          </AdminButton>
          <AdminButton
            secondary
            disabled={busy || !overlay.active}
            className="admin-seed-reset-btn"
            onClick={() => setConfirmReset(true)}
          >
            ล้างข้อมูลจำลอง / รีเซ็ตระบบ
          </AdminButton>
        </div>
      </div>

      {error && <p role="alert" className="admin-error">{error}</p>}
      {notice && <p role="status" className="admin-notice">{notice}</p>}

      {overlay.active && overlay.bookings.length > 0 && (
        <div className="admin-seed-preview-wrap">
          <div className="admin-seed-preview-header">
            <p className="admin-muted">แหล่งข้อมูล: {overlay.sourceLabel}</p>
            <AdminButton secondary onClick={() => setShowPreview(v => !v)}>
              {showPreview ? 'ซ่อนตารางตรวจสอบชุดข้อมูล' : `ดูตารางตรวจสอบชุดข้อมูล (${overlay.bookings.length} รายการ)`}
            </AdminButton>
          </div>

          {showPreview && (
            <>
              <div className="admin-filters">
                <AdminField label="ค้นหารหัส / หมู่บ้าน / โรงพยาบาล">
                  <input
                    type="search"
                    placeholder="เช่น BK-SEED-1001, บ้านกลาง, ลำพูน"
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1) }}
                  />
                </AdminField>
                <AdminField label="กรองสถานะ">
                  <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}>
                    <option value="">ทุกสถานะ</option>
                    {Object.entries(statusLabels).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </AdminField>
              </div>

              <ServiceTable headings={['รหัสอ้างอิง', 'วัน/เวลานัด', 'หมู่บ้าน (ต.บ้านกลาง)', 'โรงพยาบาล', 'อุปกรณ์', 'สถานะ']} label="ตารางข้อมูลจำลองแบบสรุป">
                {pagedRows.length ? pagedRows.map(b => {
                  const village = BAN_KLANG_VILLAGES.find(v => v.id === b.details?.villageId)
                  const st = b.apiStatus || b.status
                  return (
                    <tr key={b.id}>
                      <th scope="row">{b.reference || b.id}</th>
                      <td>{b.details?.date || '-'} · {b.details?.time || '-'} น.</td>
                      <td>{village ? `หมู่ ${village.number} ${village.name}` : '-'}</td>
                      <td>{b.details?.hospital || '-'}</td>
                      <td>{b.details?.assistance || 'เดินได้'}</td>
                      <td>{statusLabels[st] || st}</td>
                    </tr>
                  )
                }) : (
                  <tr><td colSpan={6} className="admin-empty">ไม่พบข้อมูลที่ตรงกับเงื่อนไข</td></tr>
                )}
              </ServiceTable>

              <PaginationControls
                totalItems={filtered.length}
                pageSize={PAGE_SIZE}
                page={page}
                onPageChange={setPage}
                label="แบ่งหน้าตารางข้อมูลจำลอง"
              />
            </>
          )}
        </div>
      )}

      {confirmReset && (
        <BookingModal title="ยืนยันล้างข้อมูลจำลอง / รีเซ็ตระบบ" className="admin-modal" onClose={() => { if (!busy) setConfirmReset(false) }}>
          <p>การดำเนินการนี้จะลบรายการจองจำลองทั้งหมด ({overlay.bookings.length} รายการ) เพื่อเตรียมความพร้อมก่อนส่งมอบให้เทศบาล</p>
          <div className="admin-form-actions">
            <AdminButton secondary disabled={busy} onClick={() => setConfirmReset(false)}>ยกเลิก</AdminButton>
            <AdminButton disabled={busy} onClick={() => void handleReset()}>
              {busy ? 'กำลังล้างข้อมูล…' : 'ยืนยันล้างข้อมูลจำลอง'}
            </AdminButton>
          </div>
        </BookingModal>
      )}
    </details>
  )
}
