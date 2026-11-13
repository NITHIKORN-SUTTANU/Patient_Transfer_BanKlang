import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { AdminResource, AvailabilityWindow } from '../services/adminApi'
import { adminError } from '../services/adminApi'
import { staffRequest } from '../services/staffSession'
import { AdminButton, AdminField } from './AdminForms'
import { BookingModal } from './BookingUI'

const thaiInput = (value: string) => new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 16)
export function AdminAvailability({ kind, resource, windows, onClose, onSaved }: {
  kind: 'vehicles' | 'drivers'; resource: AdminResource; windows: AvailabilityWindow[]; onClose: () => void; onSaved: () => void;
}) {
  const [selected, setSelected] = useState<AvailabilityWindow | null>(null)
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const own = windows.filter(window => kind === 'vehicles' ? window.vehicleId === resource.id : window.driverId === resource.id)
  async function write(retire = false) {
    if (pending.current) return
    if (!reason.trim()) { setError('กรุณาระบุเหตุผลในการเปลี่ยนแปลง'); return }
    pending.current = true; setBusy(true); setError('')
    try {
      await staffRequest(selected ? `/admin/availability/${selected.id}${retire ? '/retire' : ''}` : `/admin/resources/${kind}/${resource.id}/windows`, {
        expectedResourceRevision: resource.revision, ...(selected ? { expectedRevision: selected.revision } : {}), reason,
        ...(!retire ? { startsAt: `${startsAt}:00+07:00`, endsAt: `${endsAt}:00+07:00` } : {}),
      })
      onSaved()
    } catch (error) { setError(adminError(error)) }
    finally { pending.current = false; setBusy(false) }
  }
  function submit(event: FormEvent) { event.preventDefault(); void write() }
  return <BookingModal title="ช่วงเวลาปฏิบัติงาน" className="admin-modal admin-editor-modal" onClose={() => { if (!pending.current) onClose() }}>
    <p>{resource.name}</p><p className="admin-muted">เวลาไทย ช่วงเวลาต้องครอบคลุมการเดินทางจนพร้อมใช้งานครั้งถัดไป การปิดช่วงเวลาจะเก็บประวัติไว้</p>
    <form className="admin-form" onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <AdminField label="ช่วงเวลาที่บันทึกไว้"><select value={selected?.id ?? ''} onChange={event => { const window = own.find(window => window.id === event.target.value) ?? null; setSelected(window); setStartsAt(window ? thaiInput(window.startsAt) : ''); setEndsAt(window ? thaiInput(window.endsAt) : ''); setError('') }}><option value="">เพิ่มช่วงเวลาใหม่</option>{own.map(window => <option key={window.id} value={window.id}>{thaiInput(window.startsAt).replace('T', ' ')} – {thaiInput(window.endsAt).replace('T', ' ')}</option>)}</select></AdminField>
        <AdminField label="เริ่มช่วงเวลา (เวลาไทย)"><input type="datetime-local" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></AdminField>
        <AdminField label="สิ้นสุดช่วงเวลา (เวลาไทย)"><input type="datetime-local" required value={endsAt} onChange={event => setEndsAt(event.target.value)} /></AdminField>
        <AdminField label="เหตุผลในการเปลี่ยนแปลง"><input required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></AdminField>
        {error && <p role="alert" className="admin-error">{error}</p>}
        <div className="admin-form-actions"><AdminButton secondary onClick={onClose}>ยกเลิก</AdminButton><AdminButton type="submit">{busy ? 'กำลังบันทึก…' : 'บันทึกช่วงเวลา'}</AdminButton></div>
        {selected && <AdminButton secondary danger onClick={() => void write(true)}>ปิดช่วงเวลานี้</AdminButton>}
      </fieldset>
    </form>
  </BookingModal>
}
