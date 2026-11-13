import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { staffRequest } from '../services/staffSession'
import { adminError } from '../services/adminApi'
import { AdminButton, AdminField } from './AdminForms'
import { BookingModal } from './BookingUI'
import { ServiceTable } from './ServiceTable'

interface Master { id?: string; name?: string; active?: boolean; latitude?: number | null; longitude?: number | null; revision: number; number?: number; shape?: 'circle' | 'polygon'; radiusMetres?: number | null; geometry?: unknown; date?: string; reason?: string }
interface ServiceData { hospitals: Master[]; villages: Master[]; settings: Master | null; closures: Master[]; pendingReviewCount: number }
type Editor = {kind: 'hospital' | 'village' | 'depot' | 'closure'; previous?: Master}

export function AdminServiceSettings({ onChanged }: {onChanged: () => void}) {
  const [data, setData] = useState<ServiceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [version, setVersion] = useState(0)
  const [tab, setTab] = useState('settings')
  const [editor, setEditor] = useState<Editor | null>(null)
  useEffect(() => {
    let active = true
    staffRequest<ServiceData>('/admin/service-data').then(result => {if (active) setData(result)}).catch(error => {if (active) {setData(null);setError(adminError(error))}}).finally(() => {if (active) setLoading(false)})
    return () => {active = false}
  }, [version])
  function reload() {setLoading(true);setError('');setVersion(current => current + 1)}
  return <section className="admin-panel">
    <div className="admin-panel-heading"><div><h2>ข้อมูลการตั้งค่า</h2><p className="admin-muted">ข้อมูลพื้นที่และวันให้บริการ การเปลี่ยนแปลงตารางต้องได้รับการยืนยันจากเจ้าหน้าที่จัดรถ</p></div><AdminButton secondary disabled={loading} onClick={reload}>โหลดการตั้งค่าล่าสุด</AdminButton></div>
    <div className="admin-tabs"><button aria-pressed={tab === 'settings'} onClick={() => setTab('settings')}>การตั้งค่า</button><button aria-pressed={tab === 'fixed'} onClick={() => setTab('fixed')}>เงื่อนไขคงที่</button></div>
    {loading && <p role="status">กำลังโหลดการตั้งค่า…</p>}{error && <p role="alert" className="admin-error">{error}</p>}{notice && <p role="status" className="admin-notice">{notice}</p>}
    {tab === 'fixed' ? <div className="admin-details"><p>ให้บริการ 06:00–16:00 น. ตามเวลาไทย</p><p>จองล่วงหน้าอย่างน้อย 48 ชั่วโมง โดยไม่จำกัดระยะจองสูงสุด</p><p>ถึงโรงพยาบาลก่อนนัด 20 นาที และเตรียมพร้อมที่โรงพยาบาล 30 นาที</p><p>ข้อกำหนดเหล่านี้แก้ไขไม่ได้</p></div> : data && !loading && <>
      {data.pendingReviewCount > 0 && <p className="admin-warning">ข้อเสนอที่รอเจ้าหน้าที่จัดรถตรวจสอบ {data.pendingReviewCount} รายการ ตารางเดิมยังมีผล</p>}
      <ServiceTable headings={['รายการ','ค่าปัจจุบัน','ดำเนินการ']}><tr><th scope="row">ศูนย์รถ</th><td>{data.settings?.name ?? 'ยังไม่ได้ตั้งค่า'}<small>{data.settings?.latitude}, {data.settings?.longitude}</small></td><td><AdminButton secondary onClick={() => setEditor({kind:'depot',previous:data.settings ?? undefined})}>จัดการศูนย์รถ</AdminButton></td></tr><tr><th scope="row">เวลาให้บริการ</th><td>06:00–16:00 น.</td><td>เงื่อนไขคงที่</td></tr></ServiceTable>
      <div className="admin-panel-heading"><h2>โรงพยาบาล</h2><AdminButton onClick={() => setEditor({kind:'hospital'})}>+ เพิ่มโรงพยาบาล</AdminButton></div>
      <ServiceTable headings={['ชื่อ','พิกัด','สถานะ','ดำเนินการ']}>{data.hospitals.map(row => <tr key={row.id}><th scope="row">{row.name}</th><td>{row.latitude}, {row.longitude}</td><td>{row.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</td><td><AdminButton secondary onClick={() => setEditor({kind:'hospital',previous:row})}>จัดการโรงพยาบาล</AdminButton></td></tr>)}</ServiceTable>
      <div className="admin-panel-heading"><h2>หมู่บ้านในเขตบริการ</h2><AdminButton disabled={data.villages.length >= 12} onClick={() => setEditor({kind:'village'})}>+ เพิ่มหมู่บ้าน</AdminButton></div>
      <ServiceTable headings={['หมู่','ชื่อ','ขอบเขต','สถานะ','ดำเนินการ']}>{data.villages.map(row => <tr key={row.id}><th scope="row">{row.number}</th><td>{row.name}</td><td>{row.shape === 'circle' ? `รัศมี ${row.radiusMetres} เมตร` : 'พื้นที่รูปหลายเหลี่ยม'}</td><td>{row.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</td><td><AdminButton secondary onClick={() => setEditor({kind:'village',previous:row})}>จัดการหมู่บ้าน</AdminButton></td></tr>)}</ServiceTable>
      <div className="admin-panel-heading"><h2>วันปิดบริการ</h2><AdminButton onClick={() => setEditor({kind:'closure'})}>+ เพิ่มวันปิดบริการ</AdminButton></div>
      <ServiceTable headings={['วันที่','สถานะ','เหตุผล','ดำเนินการ']}>{data.closures.map(row => <tr key={row.date}><th scope="row">{row.date}</th><td>{row.active ? 'ปิดบริการ' : 'เปิดบริการอีกครั้ง'}</td><td>{row.reason}</td><td><AdminButton secondary onClick={() => setEditor({kind:'closure',previous:row})}>จัดการวันปิดบริการ</AdminButton></td></tr>)}</ServiceTable>
    </>}
    {editor && <ServiceForm editor={editor} onClose={() => setEditor(null)} onSaved={affected => {setEditor(null);setNotice(`บันทึกข้อมูลแล้ว มี ${affected} งานที่ต้องตรวจสอบ ตารางเดิมยังมีผลจนกว่าจะยืนยันใหม่`);reload();onChanged()}} />}
  </section>
}

function ServiceForm({ editor, onClose, onSaved }: {editor: Editor; onClose: () => void; onSaved: (affected: number) => void}) {
  const previous = editor.previous
  const [name, setName] = useState(previous?.name ?? '')
  const [latitude, setLatitude] = useState(String(previous?.latitude ?? ''))
  const [longitude, setLongitude] = useState(String(previous?.longitude ?? ''))
  const [active, setActive] = useState(previous?.active ?? true)
  const [number, setNumber] = useState(String(previous?.number ?? ''))
  const [shape, setShape] = useState(previous?.shape ?? 'circle')
  const [radius, setRadius] = useState(String(previous?.radiusMetres ?? ''))
  const [geometry, setGeometry] = useState(previous?.geometry ? JSON.stringify(previous.geometry, null, 2) : '')
  const [date, setDate] = useState(previous?.date ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const {kind} = editor
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    let polygon: unknown
    if (kind === 'village' && shape === 'polygon') {
      try {polygon = JSON.parse(geometry)} catch {setError('กรุณาตรวจสอบข้อมูลขอบเขต GeoJSON');return}
    }
    pending.current = true;setBusy(true);setError('')
    try {
      const path = kind === 'depot' ? '/admin/depot' : kind === 'closure' ? '/admin/closures' : `/admin/${kind === 'hospital' ? 'hospitals' : 'villages'}${previous?.id ? `/${previous.id}` : ''}`
      const body = kind === 'closure' ? {date,active,reason,expectedRevision:previous?.revision ?? 0}
        : {name,reason,...(previous || kind === 'depot' ? {expectedRevision:previous?.revision ?? 0} : {}),...(kind !== 'depot' ? {active} : {}),
          ...(kind === 'village' ? {number:Number(number),shape,...(shape === 'polygon' ? {geometry:polygon} : {latitude:Number(latitude),longitude:Number(longitude),radiusMetres:Number(radius)})} : {latitude:Number(latitude),longitude:Number(longitude)})}
      const result = await staffRequest<{affectedCount: number}>(path,body)
      onSaved(result.affectedCount)
    } catch (error) {setError(adminError(error))}
    finally {pending.current = false;setBusy(false)}
  }
  const title = {hospital:'จัดการโรงพยาบาล',village:'จัดการหมู่บ้าน',depot:'จัดการศูนย์รถ',closure:'จัดการวันปิดบริการ'}[kind]
  return <BookingModal title={title} className="admin-modal admin-editor-modal" onClose={() => {if (!pending.current) onClose()}}><p className="admin-muted">ใช้ข้อมูลที่เทศบาลอนุมัติแล้ว การเปลี่ยนพิกัดจะสร้างข้อเสนอให้เจ้าหน้าที่จัดรถตรวจสอบ โดยไม่เปลี่ยนปลายทางของงานที่เริ่มแล้ว</p><form className="admin-form" onSubmit={event => void submit(event)} aria-busy={busy}><fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
    {kind === 'closure' ? <AdminField label="วันที่ปิดบริการ"><input type="date" required readOnly={!!previous} value={date} onChange={event => setDate(event.target.value)} /></AdminField> : <AdminField label="ชื่อ"><input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></AdminField>}
    {kind === 'village' && <><AdminField label="หมู่ที่ (1–12)"><input type="number" min="1" max="12" step="1" required value={number} onChange={event => setNumber(event.target.value)} /></AdminField><AdminField label="รูปแบบขอบเขต"><select value={shape} onChange={event => setShape(event.target.value as 'circle' | 'polygon')}><option value="circle">จุดศูนย์กลางและรัศมี</option><option value="polygon">รูปหลายเหลี่ยม GeoJSON</option></select></AdminField></>}
    {kind !== 'closure' && (kind !== 'village' || shape === 'circle') && <><AdminField label="ละติจูด"><input type="number" step="any" min="-90" max="90" required value={latitude} onChange={event => setLatitude(event.target.value)} /></AdminField><AdminField label="ลองจิจูด"><input type="number" step="any" min="-180" max="180" required value={longitude} onChange={event => setLongitude(event.target.value)} /></AdminField></>}
    {kind === 'village' && (shape === 'circle' ? <AdminField label="รัศมี (เมตร)"><input type="number" step="any" min="0.001" required value={radius} onChange={event => setRadius(event.target.value)} /></AdminField> : <AdminField label="ขอบเขต GeoJSON MultiPolygon"><textarea required rows={7} value={geometry} onChange={event => setGeometry(event.target.value)} /></AdminField>)}
    {kind !== 'depot' && <AdminField label="สถานะ"><select value={String(active)} onChange={event => setActive(event.target.value === 'true')}><option value="true">{kind === 'closure' ? 'ปิดบริการ' : 'เปิดใช้งาน'}</option><option value="false">{kind === 'closure' ? 'เปิดบริการอีกครั้ง' : 'ปิดใช้งาน'}</option></select></AdminField>}
    <AdminField label="เหตุผลในการเปลี่ยนแปลง"><input required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></AdminField>
    {error && <p role="alert" className="admin-error">{error}</p>}<div className="admin-form-actions"><AdminButton secondary onClick={onClose}>ยกเลิก</AdminButton><AdminButton type="submit">{busy ? 'กำลังบันทึก…' : 'บันทึก'}</AdminButton></div>
  </fieldset></form></BookingModal>
}
