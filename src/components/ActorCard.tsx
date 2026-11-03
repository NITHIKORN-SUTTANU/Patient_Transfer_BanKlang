import { Link } from 'react-router'
import { actorRoutes, type Actor } from '../data/actors'
import { ServiceSymbol } from './ServiceSymbol'

interface Props { actor: Actor; selected: boolean; onSelect: () => void }
export function ActorCard({ actor, selected, onSelect }: Props) {
  return <Link to={actorRoutes[actor.id]} onClick={onSelect} data-actor-id={actor.id} className={`actor-card group ${selected ? 'actor-card-selected' : ''}`}>
    <span className="actor-symbol"><ServiceSymbol kind={actor.id === 'ACT-01' ? 'person' : actor.id === 'ACT-02' ? 'calendar' : actor.id === 'ACT-03' ? 'vehicle' : 'settings'} /></span>
    <span className="actor-copy"><strong>{actor.name}</strong><span>{actor.id === 'ACT-01' ? 'จองรถ · ดูสถานะ' : actor.id === 'ACT-02' ? 'ตรวจคำขอ · จัดรถ' : actor.id === 'ACT-03' ? 'ดูงาน · เริ่มเดินทาง' : 'บัญชี · รถ · คนขับ'}</span>{selected && <span className="actor-last-used">ใช้ล่าสุด</span>}</span>
    <span className="actor-select" aria-hidden="true">→</span>
  </Link>
}
