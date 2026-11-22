import { useState } from 'react'
import { actors, actorRoutes, type ActorId } from '../data/actors'
import { ActorCard } from '../components/ActorCard'
import { BookingButton, BookingModal } from '../components/BookingUI'
import { enterDemoCitizen } from '../services/citizenSession'
import { demoStore, useDemoState } from '../services/demoStore'
import { activateInteractiveDemo, isDemoModeAllowed } from '../services/interactiveDemo'
import { staffSession } from '../services/staffSession'

export function LandingPage() {
  const { state, storageAvailable } = useDemoState()
  const [resetOpen, setResetOpen] = useState(false)
  const demoAllowed = isDemoModeAllowed()
  const hasData = demoAllowed && (state.selectedActor !== null || state.bookings.length > 0 || state.vehicles.length > 0 || state.drivers.length > 0 || !!state.accounts)

  function targetRoute(id: ActorId): string {
    if (demoAllowed || id === 'ACT-01') return actorRoutes[id]
    return `/staff/login?next=${encodeURIComponent(actorRoutes[id])}`
  }

  function selectActor(id: ActorId) {
    if (!demoAllowed) return
    demoStore.selectActor(id)
    if (id === 'ACT-01') {
      activateInteractiveDemo('citizen')
      void enterDemoCitizen()
    } else if (id === 'ACT-02') {
      staffSession.enterDemoRole('dispatcher')
    } else if (id === 'ACT-03') {
      staffSession.enterDemoRole('driver')
    } else {
      staffSession.enterDemoRole('admin')
    }
  }

  return <>
    <section aria-labelledby="actor-heading" className="service-roles service-role-entry">
      <div className="service-section-heading">
        <h1 id="actor-heading">{demoAllowed ? 'เลือกบทบาทเพื่อทดลอง' : 'เลือกช่องทางเข้าสู่ระบบ'}</h1>
        <p>{demoAllowed ? 'แตะบทบาทเพื่อเริ่มใช้งานทันทีในโหมดสาธิต (ไม่ต้องต่อฐานข้อมูลหรือ LINE)' : 'ประชาชนเข้าใช้งานผ่าน LINE LIFF ส่วนเจ้าหน้าที่เข้าสู่ระบบด้วยบัญชีที่ได้รับอนุมัติ'}</p>
      </div>
      <div className="service-role-grid">{actors.map(actor => <ActorCard key={actor.id} actor={actor} to={targetRoute(actor.id)} selected={demoAllowed && state.selectedActor === actor.id} onSelect={() => selectActor(actor.id)} />)}</div>
      {hasData && <div className="service-reset"><button type="button" onClick={() => setResetOpen(true)}>เริ่มการสาธิตใหม่</button></div>}
    </section>
    {demoAllowed && !storageAvailable && <p role="alert" className="mt-3 text-error">บันทึกข้อมูลไม่ได้ ข้อมูลจะหายเมื่อปิดหรือรีเฟรชหน้านี้</p>}
    {demoAllowed && resetOpen && <BookingModal title="เริ่มการสาธิตใหม่?" onClose={() => setResetOpen(false)} className="service-reset-modal">
      <p>รายการจองและข้อมูลที่แก้ไขในเบราว์เซอร์นี้จะถูกล้าง</p>
      <BookingButton secondary data-initial-focus onClick={() => setResetOpen(false)}>เก็บข้อมูลไว้</BookingButton>
      <BookingButton onClick={() => { demoStore.reset(); void import('../services/demoApiBackend').then(m => m.resetDemoApiBackend()); setResetOpen(false) }}>ล้างข้อมูลและเริ่มใหม่</BookingButton>
    </BookingModal>}
  </>
}