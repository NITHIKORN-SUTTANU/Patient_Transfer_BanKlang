import { Outlet } from 'react-router'
import { ProductHeader } from '../components/ProductHeader'

export function DemoLayout() {
  return <div className="service-home min-h-screen bg-canvas text-ink">
    <a className="skip-link" href="#main">ข้ามไปยังเนื้อหา</a>
    <ProductHeader />
    <main tabIndex={-1} id="main" className="mx-auto max-w-6xl px-6 py-10 sm:py-16"><Outlet /></main>
    <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-6 pb-8 text-base text-muted"><p>ต้นแบบทดสอบ · ไม่ใช่การจองรถจริง</p><p>ใช้ชื่อและเบอร์โทรสมมติ</p></footer>
  </div>
}
