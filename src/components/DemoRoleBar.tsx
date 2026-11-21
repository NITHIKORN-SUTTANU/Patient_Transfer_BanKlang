import { useLocation, useNavigate } from 'react-router'
import { enterDemoCitizen } from '../services/citizenSession'
import { deactivateInteractiveDemo, useInteractiveDemo, type DemoRole } from '../services/interactiveDemo'
import { staffSession } from '../services/staffSession'

const ROLE_LINKS: { role: DemoRole; label: string; path: string }[] = [
  { role: 'citizen', label: 'ผู้ป่วย / จองรถ', path: '/booking' },
  { role: 'dispatcher', label: 'เจ้าหน้าที่จัดรถ', path: '/dispatcher' },
  { role: 'driver', label: 'พนักงานขับรถ', path: '/driver' },
  { role: 'admin', label: 'ผู้ดูแลระบบ', path: '/admin' },
]

export function DemoRoleBar() {
  const demo = useInteractiveDemo()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Strictly invisible outside Interactive Demo Mode so API & Playwright suites remain untouched.
  if (!demo.active || pathname === '/') return null

  function switchRole(role: DemoRole, path: string) {
    if (role === 'citizen') {
      void enterDemoCitizen()
    } else {
      staffSession.enterDemoRole(role)
    }
    navigate(path)
  }

  function exitDemo() {
    deactivateInteractiveDemo()
    staffSession.clearLocal()
    navigate('/')
  }

  return (
    <div className="demo-role-bar" role="region" aria-label="แถบสลับบทบาทโหมดสาธิต">
      <span className="demo-role-pill-badge">โหมดสาธิต</span>
      <nav className="demo-role-nav" aria-label="สลับบทบาททดลองใช้งาน">
        {ROLE_LINKS.map(item => {
          const current = pathname.startsWith(item.path)
          return (
            <button
              key={item.role}
              type="button"
              className={`demo-role-btn ${current ? 'active' : ''}`}
              aria-current={current ? 'page' : undefined}
              onClick={() => switchRole(item.role, item.path)}
            >
              {item.label}
            </button>
          )
        })}
        <button type="button" className="demo-role-btn ghost" onClick={() => navigate('/')}>
          หน้าหลัก
        </button>
        {!demo.envLocked && (
          <button type="button" className="demo-role-btn ghost" onClick={exitDemo}>
            ออกโหมดสาธิต
          </button>
        )}
      </nav>
    </div>
  )
}
