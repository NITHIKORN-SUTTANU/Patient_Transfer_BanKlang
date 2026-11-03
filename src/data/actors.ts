export const actors = [
  { id: 'ACT-01', name: 'ผู้ป่วย / ผู้ดูแล', english: 'Patient / Caregiver', description: 'ขอใช้บริการรถรับส่งไปโรงพยาบาล และติดตามสถานะการจอง', tasks: 'จองรถ · เลือกจุดรับ · ติดตามคำขอ', number: '01' },
  { id: 'ACT-02', name: 'เจ้าหน้าที่จัดรถ', english: 'Dispatcher', description: 'ตรวจสอบคำขอ จัดรถและคนขับ พร้อมติดตามงานรับส่ง', tasks: 'ตรวจสอบคำขอ · มอบหมาย · ติดตามงาน', number: '02' },
  { id: 'ACT-03', name: 'พนักงานขับรถ', english: 'Driver', description: 'ดูงานที่ได้รับมอบหมาย และอัปเดตสถานะการเดินทาง', tasks: 'งานวันนี้ · รายละเอียดงาน · สถานะ', number: '03' },
  { id: 'ACT-04', name: 'ผู้ดูแลระบบ', english: 'Admin', description: 'ดูแลบัญชีผู้ใช้งาน รถ คนขับ และการตั้งค่าระบบ', tasks: 'บัญชีและสิทธิ์ · ทรัพยากร · ประวัติ', number: '04' },
] as const

export type ActorId = typeof actors[number]['id']
export type Actor = typeof actors[number]
export const accountRoleLabels = { Dispatcher: 'เจ้าหน้าที่จัดรถ', Driver: 'พนักงานขับรถ', Admin: 'ผู้ดูแลระบบ' } as const
export const actorRoutes: Record<ActorId, string> = { 'ACT-01': '/booking', 'ACT-02': '/dispatcher', 'ACT-03': '/driver', 'ACT-04': '/admin' }
export function isActorId(value: unknown): value is ActorId {
  return actors.some(actor => actor.id === value)
}
