import { accountRoleLabels } from '../data/actors'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { AdminAccount, AdminSettings, DemoState, Driver, Vehicle } from '../data/seed'
import { BookingButton, BookingModal } from './BookingUI'
import { defaultSettings, saveAdmin, type AdminCategory } from '../services/admin'
import { PickupMap } from './LocationMap'

export type AdminEntity = AdminAccount | AdminSettings | Driver | Vehicle
export interface AdminEditor { category: AdminCategory; previous?: AdminEntity; disable?: boolean; settingsSection?: 'center' | 'serviceArea' | 'hours' }
export function AdminButton(props: Parameters<typeof BookingButton>[0]) { return <BookingButton {...props} className={`admin-button ${props.className || ''}`} /> }
export function AdminField({ label, children }: { label: string; children: ReactNode }) { return <label className="admin-field"><span>{label}</span>{children}</label> }
export function AdminForm({ editor, state, onClose, onSaved }: { editor: AdminEditor; state: DemoState; onClose: () => void; onSaved: () => void }) {
  const { category, previous } = editor
  const settingsTitle = editor.settingsSection ? { center: 'แก้ไขตำแหน่งศูนย์รถเทศบาล', serviceArea: 'แก้ไขพื้นที่ให้บริการ', hours: 'แก้ไขเวลาเปิดให้บริการ' }[editor.settingsSection] : 'แก้ไขการตั้งค่า'
  const source = previous as (Partial<AdminAccount & AdminSettings & Driver & Vehicle> | undefined)
  const [name, setName] = useState(source?.name || source?.label || '')
  const [username, setUsername] = useState(source?.username || '')
  const [role, setRole] = useState(source?.role || 'Dispatcher')
  const [active, setActive] = useState(source?.active ?? true)
  const [vehicleType, setVehicleType] = useState(source?.vehicleType || 'รถรับส่งทั่วไป')
  const [support, setSupport] = useState(source?.support || 'รถรับส่งทั่วไป')
  const [accountId, setAccountId] = useState(source?.accountId || '')
  const [phone, setPhone] = useState(source?.phone || '')
  const [settings, setSettings] = useState<AdminSettings>(category === 'settings' && previous ? previous as AdminSettings : defaultSettings)
  const [reason, setReason] = useState('')
  const [confirmDisable, setConfirmDisable] = useState(editor.disable || false)
  const [disableOnly, setDisableOnly] = useState(editor.disable || false)
  const [error, setError] = useState('')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const locationRequest = useRef(0)
  useEffect(() => () => { locationRequest.current += 1 }, [])
  function selectParking(latitude: number, longitude: number) {
    locationRequest.current += 1
    setLocating(false)
    setLocationError('')
    setSettings(current => ({ ...current, parking: { latitude, longitude } }))
  }
  function locateParking() {
    if (locating) return
    setLocationError('')
    if (!window.isSecureContext || !navigator.geolocation) {
      setLocationError('อุปกรณ์หรือการเชื่อมต่อนี้ไม่รองรับตำแหน่ง กรุณาเปิดผ่าน HTTPS หรือเลือกจุดจอดรถบนแผนที่')
      return
    }
    const request = ++locationRequest.current
    setLocating(true)
    navigator.geolocation.getCurrentPosition(position => {
      if (request !== locationRequest.current) return
      selectParking(position.coords.latitude, position.coords.longitude)
    }, error => {
      if (request !== locationRequest.current) return
      setLocating(false)
      setLocationError(error.code === 1 ? 'กรุณาอนุญาตให้เว็บไซต์เข้าถึงตำแหน่ง หรือเลือกจุดจอดรถบนแผนที่' : error.code === 3 ? 'ค้นหาตำแหน่งนานเกินไป กรุณาลองอีกครั้ง หรือเลือกจุดจอดรถบนแผนที่' : 'ไม่สามารถค้นหาตำแหน่งได้ กรุณาลองอีกครั้ง หรือเลือกจุดจอดรถบนแผนที่')
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  }
  const entityId = source?.id
  const related = state.bookings.filter(b => category === 'vehicles' ? b.vehicleId === entityId : category === 'drivers' ? b.driverId === entityId : category === 'accounts' ? state.drivers.some(d => d.accountId === entityId && d.id === b.driverId) : false)
  const openJobs = related.filter(b => ['approved', 'in_transit'].includes(b.status))
  const noun = { accounts: 'บัญชี', vehicles: 'รถ', drivers: 'คนขับ', settings: 'การตั้งค่า' }[category]
  const title = confirmDisable ? category === 'vehicles' ? 'ปิดใช้งานรถ' : category === 'drivers' ? 'ระงับบัญชีคนขับ' : 'ระงับบัญชี' : category === 'settings' ? settingsTitle : `${previous ? 'แก้ไข' : 'เพิ่ม'}${noun}`
  function submit(e: FormEvent) {
    e.preventDefault(); setError('')
    if (locating) return
    if (!confirmDisable && !active && (source?.active ?? true)) { setConfirmDisable(true); return }
    const id = entityId || `${{ accounts: 'USR', vehicles: 'VEH', drivers: 'DRV', settings: 'CFG' }[category]}-${crypto.randomUUID().slice(0, 8)}`
    let next: AdminEntity
    if (confirmDisable && disableOnly && previous && 'active' in previous) next = { ...previous, active: false }
    else if (category === 'accounts') next = { id, name: name.trim(), username: username.trim(), role, active: confirmDisable ? false : active }
    else if (category === 'vehicles') next = { ...previous, id, label: name.trim(), vehicleType, support, active: confirmDisable ? false : active } as Vehicle
    else if (category === 'drivers') next = { ...previous, id, name: name.trim(), accountId, phone: phone.trim(), active: confirmDisable ? false : active } as Driver
    else next = { ...settings, center: settings.center.trim(), serviceArea: settings.serviceArea.trim(), opensAt: settings.opensAt, closesAt: settings.closesAt }
    try { saveAdmin(category, next, previous, reason); onSaved() } catch (e) { setError((e as Error).message) }
  }
  return <BookingModal title={title} onClose={onClose} className={`admin-modal admin-editor-modal${editor.settingsSection === 'center' ? ' admin-parking-modal' : ''}`}><p className="admin-muted">{confirmDisable ? 'ตรวจสอบข้อมูลและผลกระทบก่อนยืนยัน' : 'ตรวจสอบข้อมูลให้ครบถ้วนก่อนบันทึก'}</p>
    <form className="admin-form" onSubmit={submit}>
      {confirmDisable ? <>
        <AdminField label={`เลือก${noun}`}><input readOnly value={source?.label || source?.name || name} /></AdminField>
        <AdminField label="สถานะปัจจุบัน"><input readOnly value={source?.active ? 'ใช้งานอยู่' : 'ไม่พร้อมใช้งาน'} /></AdminField>
        <details className="admin-related"><summary>งานรับส่งที่เกี่ยวข้อง · {related.length} งาน ({openJobs.length} งานยังไม่เสร็จ)</summary>{related.length ? related.map(b => <p key={b.id}>{b.id} · {b.status}</p>) : <p>ไม่มีงานรับส่งที่เกี่ยวข้อง</p>}</details>
        <p className="admin-warning">หยุดการมอบหมายงานใหม่ งานเดิมและประวัติจะยังคงอยู่{category !== 'vehicles' && ' คนขับที่ถูกระงับจะอัปเดตงานไม่ได้จนกว่าจะเปิดใช้งานอีกครั้ง'} {openJobs.length > 0 && 'มีงานที่ยังไม่เสร็จ กรุณาประสานเจ้าหน้าที่ก่อนยืนยัน'}</p>
        <AdminField label="เหตุผลในการระงับ / ปิดใช้งาน"><input required maxLength={200} value={reason} onChange={e => setReason(e.target.value)} /></AdminField>
      </> : <>
        {category === 'settings' ? <>
          {(!editor.settingsSection || editor.settingsSection === 'center') && <AdminField label="ตำแหน่งศูนย์รถเทศบาล"><input required maxLength={200} value={settings.center} onChange={e => setSettings({ ...settings, center: e.target.value })} /></AdminField>}
          {editor.settingsSection === 'center' && <section className="admin-parking-location" aria-label="ตำแหน่งจุดจอดรถร่วม">
            <p className="admin-muted">จุดจอดรถร่วมสำหรับรถทุกคัน เลือกตำแหน่งจริงเพื่อใช้เป็นจุดเริ่มเดินทาง</p>
            <AdminButton secondary disabled={locating} onClick={locateParking}>{locating ? 'กำลังค้นหาตำแหน่ง…' : 'ใช้ตำแหน่งปัจจุบัน'}</AdminButton>
            {locationError && <p className="admin-error" role="alert">{locationError}</p>}
            <PickupMap locationName="จุดจอดรถ" value={settings.parking ? { ...settings.parking, x: 50, y: 50, label: settings.center } : null} onChange={selectParking} />
            <p className="admin-muted">{settings.parking ? `พิกัดจุดจอดรถ ${settings.parking.latitude.toFixed(6)}, ${settings.parking.longitude.toFixed(6)}` : 'ยังไม่ได้เลือกจุดจอดรถ'}</p>
          </section>}
          {(!editor.settingsSection || editor.settingsSection === 'serviceArea') && <AdminField label="พื้นที่ให้บริการ"><input required maxLength={200} value={settings.serviceArea} onChange={e => setSettings({ ...settings, serviceArea: e.target.value })} /></AdminField>}
          {(!editor.settingsSection || editor.settingsSection === 'hours') && <div className="admin-form-grid"><AdminField label="เวลาเปิดบริการ"><input required type="time" value={settings.opensAt} onChange={e => setSettings({ ...settings, opensAt: e.target.value })} /></AdminField><AdminField label="เวลาปิดบริการ"><input required type="time" value={settings.closesAt} onChange={e => setSettings({ ...settings, closesAt: e.target.value })} /></AdminField></div>}
          {!editor.settingsSection && <AdminField label="จองล่วงหน้า 48 ชม. / เตรียมรถ 20 นาที (แก้ไขไม่ได้)"><input readOnly value="48 ชั่วโมง / 20 นาที" /></AdminField>}
        </> : <>
          <AdminField label={category === 'vehicles' ? 'รหัสรถ / ทะเบียนรถ' : category === 'drivers' ? 'ชื่อ–นามสกุลคนขับ' : 'ชื่อ–นามสกุล'}><input required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></AdminField>
          {category === 'accounts' && <><AdminField label="ชื่อผู้ใช้งาน"><input required maxLength={200} value={username} onChange={e => setUsername(e.target.value)} /></AdminField><AdminField label="บทบาทและสิทธิ์"><select value={role} onChange={e => setRole(e.target.value as AdminAccount['role'])}>{(['Dispatcher', 'Driver', 'Admin'] as const).map(r => <option key={r} value={r}>{accountRoleLabels[r]}</option>)}</select></AdminField><p className="admin-muted">{role === 'Admin' ? 'ดูแลบัญชี ทรัพยากร การตั้งค่า และประวัติ' : role === 'Driver' ? 'ดูงานที่ได้รับมอบหมายและอัปเดตสถานะงาน' : 'ตรวจสอบคำขอ จัดรถและคนขับ และติดตามงาน'}</p></>}
          {category === 'vehicles' && <><AdminField label="ประเภทรถ"><input required maxLength={200} list="admin-vehicle-types" value={vehicleType} onChange={e => setVehicleType(e.target.value)} /><datalist id="admin-vehicle-types"><option value="รถรับส่งทั่วไป" />{[...new Set(state.vehicles.flatMap(v => v.vehicleType ? [v.vehicleType] : []))].map(t => <option key={t} value={t} />)}</datalist></AdminField><AdminField label="การรองรับรถเข็นหรือเปลนอน"><select value={support} onChange={e => setSupport(e.target.value)}>{['รถรับส่งทั่วไป', 'รองรับรถเข็น', 'รองรับเปลนอน'].map(t => <option key={t}>{t}</option>)}</select></AdminField></>}
          {category === 'drivers' && <><AdminField label="บัญชีผู้ใช้งาน Role: Driver"><select required value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">เลือกบัญชีคนขับ</option>{state.accounts?.filter(a => a.role === 'Driver').map(a => <option key={a.id} value={a.id} disabled={state.drivers.some(d => d.id !== entityId && d.accountId === a.id)}>{a.name} · {a.username}{!a.active ? ' (ระงับ)' : ''}</option>)}</select></AdminField><AdminField label="เบอร์ติดต่อ"><input required inputMode="tel" pattern="0[0-9]{8,9}" maxLength={10} value={phone} onChange={e => setPhone(e.target.value)} /></AdminField></>}
          <AdminField label={category === 'vehicles' ? 'สถานะรถ' : category === 'drivers' ? 'สถานะพร้อมปฏิบัติงาน' : 'สถานะบัญชี'}><select value={String(active)} onChange={e => setActive(e.target.value === 'true')}><option value="true">{category === 'accounts' ? 'ใช้งานอยู่' : 'พร้อมใช้งาน'}</option><option value="false">{category === 'vehicles' ? 'ปิดใช้งาน' : 'ระงับการใช้งาน'}</option></select></AdminField>
        </>}
      </>}
      {error && <p role="alert" className="admin-error">{error}</p>}
      <div className="admin-form-actions"><AdminButton secondary onClick={onClose}>ยกเลิก</AdminButton><AdminButton danger={confirmDisable} disabled={locating} type="submit">บันทึก</AdminButton></div>
      {previous && category === 'vehicles' && source?.active && !confirmDisable && <AdminButton secondary danger onClick={() => { setError(''); setDisableOnly(true); setConfirmDisable(true) }}>ปิดใช้งานรถ</AdminButton>}
      {previous && 'active' in previous && !previous.active && !confirmDisable && <AdminButton secondary onClick={() => { try { saveAdmin(category, { ...previous, active: true }, previous); onSaved() } catch (e) { setError((e as Error).message) } }}>เปิดใช้งานอีกครั้ง</AdminButton>}
    </form>
  </BookingModal>
}
