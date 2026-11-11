import type { Booking } from '../data/seed'

export function exportBookingsToCSV(bookings: Booking[], filenamePrefix = 'รายงานรับส่งผู้ป่วย_ทต_บ้านกลาง') {
  const headers = [
    'รหัสคำขอ',
    'วันเวลานัดหมอ',
    'เวลารับผู้ป่วย',
    'ชื่อผู้ป่วย',
    'เบอร์โทรศัพท์',
    'จุดรับผู้ป่วย',
    'โรงพยาบาลปลายทาง',
    'ความช่วยเหลือ',
    'รหัสรถ',
    'รหัสคนขับ',
    'สถานะ',
  ]

  const rows = bookings.map(b => [
    b.id,
    b.appointmentAt || '-',
    b.schedule?.pickupAt || '-',
    `"${(b.patientName || '-').replace(/"/g, '""')}"`,
    `"${b.details?.phone || '-'}"`,
    `"${(b.details?.pickup?.label || '-').replace(/"/g, '""')}"`,
    `"${(b.details?.hospital || '-').replace(/"/g, '""')}"`,
    `"${(b.details?.assistance || '-').replace(/"/g, '""')}"`,
    b.vehicleId || '-',
    b.driverId || '-',
    b.status || '-',
  ])

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const today = new Date().toISOString().slice(0, 10)
  link.href = url
  link.setAttribute('download', `${filenamePrefix}_${today}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
