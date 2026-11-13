import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { AdminAccount } from '../data/seed'
import type { AdminCatalog, AdminResource } from '../services/adminApi'
import { adminError } from '../services/adminApi'
import { staffRequest } from '../services/staffSession'
import { AdminButton, AdminField } from './AdminForms'
import { BookingModal } from './BookingUI'

const support = { standard: 'เดินได้', wheelchair: 'รถเข็น', stretcher: 'เปลนอน' }
export function AdminResourceForm({ kind, previous, catalog, accounts, onClose, onSaved }: {
  kind: 'vehicles' | 'drivers'; previous?: AdminResource; catalog: AdminCatalog; accounts: AdminAccount[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(previous?.name ?? '')
  const [plate, setPlate] = useState(previous?.plate ?? '')
  const [vehicleType, setVehicleType] = useState(previous?.vehicleType ?? '')
  const [userId, setUserId] = useState(previous?.accountId ?? '')
  const [phone, setPhone] = useState(previous?.phone ?? '')
  const [sameDriverConfirmed, setSameDriverConfirmed] = useState(false)
  const [active, setActive] = useState(previous?.rosterActive ?? previous?.active ?? true)
  const [capabilities, setCapabilities] = useState(previous?.capabilities ?? ['standard'])
  const [locationId, setLocationId] = useState('')
  const [availableAt, setAvailableAt] = useState('')
  const [initialConfirmed, setInitialConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const noun = kind === 'vehicles' ? 'รถ' : 'คนขับ'
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    if (!capabilities.length) { setError('กรุณาเลือกการรองรับอย่างน้อยหนึ่งรายการ'); return }
    if (previous && (previous.rosterActive ?? previous.active) && !active && !confirmation) { setConfirmation(true); return }
    pending.current = true; setBusy(true); setError('')
    try {
      await staffRequest(previous ? `/admin/resources/${kind}/${previous.id}` : `/admin/resources/${kind}`, {
        name, active, capabilities, reason,
        ...(kind === 'vehicles' ? { plate, vehicleType } : { userId, phone }),
        ...(previous ? { expectedRevision: previous.revision } : { locationId, availableAt: `${availableAt}:00+07:00`, initialPositionConfirmed: initialConfirmed }),
        ...(previous && kind === 'drivers' && userId !== previous.accountId ? { sameDriverConfirmed } : {}),
      })
      onSaved()
    } catch (error) { setError(adminError(error)) }
    finally { pending.current = false; setBusy(false) }
  }
  return <BookingModal title={`${previous ? 'แก้ไข' : 'เพิ่ม'}${noun}`} className="admin-modal admin-editor-modal" onClose={() => { if (!pending.current) onClose() }}>
    <form className="admin-form" onSubmit={event => void submit(event)} aria-busy={busy}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <AdminField label={kind === 'vehicles' ? 'ชื่อรถ' : 'ชื่อ–นามสกุลคนขับ'}><input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></AdminField>
        {kind === 'vehicles' ? <>
          <AdminField label="ทะเบียนรถ"><input required maxLength={120} value={plate} onChange={event => setPlate(event.target.value)} /></AdminField>
          <AdminField label="ประเภทรถ"><input required maxLength={120} value={vehicleType} onChange={event => setVehicleType(event.target.value)} /></AdminField>
        </> : <>
          <AdminField label="บัญชีผู้ใช้งาน Role: Driver"><select required value={userId} onChange={event => { setUserId(event.target.value); setSameDriverConfirmed(false); const account = accounts.find(account => account.id === event.target.value); if (account) setName(account.name) }}><option value="">เลือกบัญชีคนขับ</option>{accounts.filter(account => account.role === 'Driver').map(account => <option key={account.id} value={account.id} disabled={catalog.drivers.some(driver => driver.id !== previous?.id && driver.accountId === account.id)}>{account.name} · {account.username}{!account.active ? ' (ระงับ)' : ''}</option>)}</select></AdminField>
          <AdminField label="เบอร์ติดต่อ"><input required type="tel" value={phone} onChange={event => setPhone(event.target.value)} /></AdminField>
          {previous && userId !== previous.accountId && <label className="booking-checkbox"><input type="checkbox" required checked={sameDriverConfirmed} onChange={event => setSameDriverConfirmed(event.target.checked)} />ยืนยันว่าเป็นคนขับรายเดิม เปลี่ยนเฉพาะบัญชีเข้าสู่ระบบ</label>}
        </>}
        <div role="group" aria-label="การรองรับ">{Object.entries(support).map(([code, label]) => <label className="booking-checkbox" key={code}><input type="checkbox" checked={capabilities.includes(code)} onChange={event => setCapabilities(current => event.target.checked ? [...current, code] : current.filter(value => value !== code))} />{label}</label>)}</div>
        <AdminField label={kind === 'vehicles' ? 'สถานะรถ' : 'สถานะคนขับ'}><select value={String(active)} onChange={event => { setActive(event.target.value === 'true'); setConfirmation(false) }}><option value="true">เปิดใช้งาน</option><option value="false">ปิดใช้งาน</option></select></AdminField>
        {!previous ? <>
          <AdminField label="ตำแหน่งเริ่มต้นที่ตรวจสอบแล้ว"><select required value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">เลือกศูนย์รถหรือโรงพยาบาล</option>{catalog.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></AdminField>
          <AdminField label="พร้อมตั้งแต่ (เวลาไทย)"><input required type="datetime-local" value={availableAt} onChange={event => setAvailableAt(event.target.value)} /></AdminField>
          <label className="booking-checkbox"><input type="checkbox" required checked={initialConfirmed} onChange={event => setInitialConfirmed(event.target.checked)} />ตรวจสอบตำแหน่งและความพร้อมเริ่มต้นจริงแล้ว</label>
          <p className="admin-muted">เพิ่มช่วงเวลาปฏิบัติงานหลังบันทึก ก่อนนำไปมอบหมายงาน</p>
        </> : <p className="admin-muted">ตำแหน่งและสถานะรอยืนยันความพร้อมยังคงเดิม เจ้าหน้าที่จัดรถเป็นผู้ยืนยันความพร้อมเดินรถ</p>}
        <AdminField label="เหตุผลในการเปลี่ยนแปลง"><input required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></AdminField>
        {confirmation && <p className="admin-warning">กดบันทึกอีกครั้งเพื่อยืนยันการปิดใช้งาน งานที่ยังไม่เสร็จต้องได้รับการจัดการก่อน</p>}
        {error && <p role="alert" className="admin-error">{error}</p>}
        <div className="admin-form-actions"><AdminButton secondary onClick={onClose}>ยกเลิก</AdminButton><AdminButton type="submit">{busy ? 'กำลังบันทึก…' : 'บันทึก'}</AdminButton></div>
      </fieldset>
    </form>
  </BookingModal>
}
