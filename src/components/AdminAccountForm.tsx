import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { AdminAccount } from '../data/seed'
import { accountRoleLabels } from '../data/actors'
import { AdminButton, AdminField } from './AdminForms'
import { BookingModal } from './BookingUI'
import { adminError, type StaffAccount } from '../services/adminApi'
import { staffRequest, staffSession, useStaffSession } from '../services/staffSession'

export function AdminAccountForm({ previous, onClose, onSaved }: { previous?: AdminAccount; onClose: () => void; onSaved: () => void }) {
  const session = useStaffSession()
  const [name, setName] = useState(previous?.name ?? '')
  const [username, setUsername] = useState(previous?.username ?? '')
  const [role, setRole] = useState(previous?.role ?? 'Dispatcher')
  const [active, setActive] = useState(previous?.active ?? true)
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState('')
  const accessChange = previous && (previous.role !== role || previous.active && !active || password.length > 0)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    if (accessChange && !confirmed) { setConfirmed(true); return }
    pending.current = true; setBusy(true); setError('')
    try {
      const result = await staffRequest<StaffAccount>(previous ? `/admin/accounts/${previous.id}` : '/admin/accounts', {
        name, username, role: role.toLowerCase(), active, reason,
        ...(previous ? { expectedRevision: previous.revision } : {}), ...(!previous || password ? { password } : {}) })
      setPassword('')
      if (result.id === session.user?.id) await staffSession.refresh()
      onSaved()
    } catch (error) { setError(adminError(error)) }
    finally { pending.current = false; setBusy(false) }
  }
  return <BookingModal title={previous ? 'แก้ไขบัญชี' : 'เพิ่มบัญชี'} className="admin-modal admin-editor-modal" onClose={() => { if (!pending.current) onClose() }}>
    <p className="admin-muted">ตรวจสอบข้อมูลให้ครบถ้วนก่อนบันทึก</p>
    <form className="admin-form" onSubmit={event => void submit(event)} aria-busy={busy}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <AdminField label="ชื่อ–นามสกุล"><input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></AdminField>
        <AdminField label="ชื่อผู้ใช้งาน"><input required autoComplete="off" maxLength={120} value={username} onChange={event => setUsername(event.target.value)} /></AdminField>
        <AdminField label="บทบาทและสิทธิ์"><select value={role} onChange={event => { setRole(event.target.value as AdminAccount['role']); setConfirmed(false) }}>{(['Dispatcher', 'Driver', 'Admin'] as const).map(value => <option key={value} value={value}>{accountRoleLabels[value]}</option>)}</select></AdminField>
        <AdminField label={previous ? 'รหัสผ่านใหม่ (เว้นว่างเพื่อคงเดิม)' : 'รหัสผ่านเริ่มต้น'}><input type="password" autoComplete="new-password" required={!previous} minLength={12} maxLength={512} value={password} onChange={event => { setPassword(event.target.value); setConfirmed(false) }} /></AdminField>
        <AdminField label="สถานะบัญชี"><select value={String(active)} onChange={event => { setActive(event.target.value === 'true'); setConfirmed(false) }}><option value="true">ใช้งานอยู่</option><option value="false">ระงับการใช้งาน</option></select></AdminField>
        <AdminField label="เหตุผลในการเปลี่ยนแปลง"><input required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></AdminField>
        {confirmed && <p className="admin-warning">การเปลี่ยนสิทธิ์ ระงับบัญชี หรือเปลี่ยนรหัสผ่าน จะยกเลิกเซสชันเดิม กดบันทึกอีกครั้งเพื่อยืนยัน</p>}
        {error && <p role="alert" className="admin-error">{error}</p>}
        <div className="admin-form-actions"><AdminButton secondary onClick={onClose}>ยกเลิก</AdminButton><AdminButton type="submit">{busy ? 'กำลังบันทึก…' : 'บันทึก'}</AdminButton></div>
      </fieldset>
    </form>
  </BookingModal>
}
