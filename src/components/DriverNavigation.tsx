import { useEffect, useRef, useState } from 'react'
import { BookingButton } from './BookingUI'

export function DriverNavigation({ latitude, longitude }: { latitude: number; longitude: number }) {
  const [origin, setOrigin] = useState<{ latitude: number; longitude: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const request = useRef(0)
  useEffect(() => () => { request.current += 1 }, [])
  const valid = Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
  const params = new URLSearchParams({ api: '1', destination: `${latitude},${longitude}`, travelmode: 'driving', dir_action: 'navigate' })
  if (origin) params.set('origin', `${origin.latitude},${origin.longitude}`)
  function locate() {
    if (loading) return
    if (origin) {
      setOrigin(null)
      setMessage('ยกเลิกจุดเริ่มต้นแล้ว กรุณาเลือกจุดเริ่มต้นใน Google Maps')
      return
    }
    if (!window.isSecureContext || !navigator.geolocation) {
      setMessage('ไม่สามารถใช้ GPS ได้ กรุณาเลือกจุดเริ่มต้นใน Google Maps')
      return
    }
    const current = ++request.current
    setLoading(true); setMessage('กำลังค้นหาตำแหน่งคนขับ กรุณาอนุญาตการเข้าถึงตำแหน่ง')
    navigator.geolocation.getCurrentPosition(position => {
      if (current !== request.current) return
      setOrigin({ latitude: position.coords.latitude, longitude: position.coords.longitude })
      setLoading(false); setMessage('ตั้งจุดเริ่มต้นแล้ว กดนำทางด้วย Google Maps เพื่อเปิดเส้นทาง')
    }, error => {
      if (current !== request.current) return
      setLoading(false)
      setMessage(error.code === 1 ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง กรุณาอนุญาต GPS หรือเลือกจุดเริ่มต้นใน Google Maps' : 'หาตำแหน่งคนขับไม่สำเร็จ กรุณาลองใหม่ หรือเลือกจุดเริ่มต้นใน Google Maps')
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
  }
  if (!valid) return <p role="alert">พิกัดจุดรับไม่ถูกต้อง กรุณาติดต่อผู้จองเพื่อยืนยันจุดรับ</p>
  return <section aria-label="นำทางไปจุดรับ">
    <BookingButton secondary className="driver-button driver-origin-toggle" aria-pressed={!!origin} disabled={loading} onClick={locate}>{loading ? 'กำลังค้นหาจุดเริ่มต้น…' : origin ? <><span aria-hidden="true">✓</span><span>ใช้ตำแหน่งของคุณแล้ว · <span className="driver-origin-cancel">ยกเลิก</span></span></> : 'ใช้ตำแหน่งของฉันเป็นจุดเริ่มต้น'}</BookingButton>
    {message && <p role="status" className="driver-helper">{message}</p>}
    <a className="booking-button driver-button" href={`https://www.google.com/maps/dir/?${params}`} target="_blank" rel="noopener noreferrer">นำทางด้วย Google Maps</a>
    <p className="driver-helper">หาก Google Maps ไม่พบตำแหน่งของคุณ ให้เลือกจุดเริ่มต้น · การนำทางแบบเสียงให้เปิดในแอป Google Maps บนโทรศัพท์</p>
  </section>
}
