import { Link } from 'react-router'
import { actors, type ActorId } from '../data/actors'
import { ServiceSymbol } from './ServiceSymbol'

export function ProductHeader({ role }: { role?: ActorId }) {
  const actor = actors.find(actor => actor.id === role)
  return <header className="product-header">
    <div className="product-header-inner">
      <Link to="/" className="product-brand" title="กลับเลือกบทบาท"><span className="product-brand-mark"><ServiceSymbol /></span><span><strong>บ้านกลาง</strong><span>บริการรถรับส่งผู้ป่วย</span></span></Link>
      <div className="product-header-actions">{actor ? <><span className="product-role">{actor.name}</span><Link to="/" className="product-role-switch">เปลี่ยนบทบาท <span aria-hidden="true">↗</span></Link></> : <span className="product-prototype">ต้นแบบทดสอบ</span>}</div>
    </div>
  </header>
}
