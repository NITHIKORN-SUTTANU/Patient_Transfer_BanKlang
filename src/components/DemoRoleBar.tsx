import { useEffect, useRef, useState } from 'react'
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
  const [collapsed, setCollapsed] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)

  // Strictly invisible outside Interactive Demo Mode so API & Playwright suites remain untouched.
  const visible = demo.active && pathname !== '/'

  useEffect(() => {
    const root = document.documentElement
    if (!visible) {
      root.style.setProperty('--demo-bar-height', '0px')
      return
    }
    const element = barRef.current
    if (!element) return
    const syncHeight = () => {
      root.style.setProperty('--demo-bar-height', `${element.getBoundingClientRect().height}px`)
    }
    syncHeight()
    if (typeof ResizeObserver === 'undefined') {
      return () => { root.style.setProperty('--demo-bar-height', '0px') }
    }
    const observer = new ResizeObserver(syncHeight)
    observer.observe(element)
    return () => {
      observer.disconnect()
      root.style.setProperty('--demo-bar-height', '0px')
    }
  }, [visible, collapsed])

  if (!visible) return null

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
    <div
      ref={barRef}
      className={`demo-role-bar ${collapsed ? 'is-collapsed' : ''}`}
      role="region"
      aria-label="แถบสลับบทบาทโหมดสาธิต"
    >
      <div className="demo-role-bar-head">
        <span className="demo-role-pill-badge">โหมดสาธิต</span>
        <button
          type="button"
          className="demo-role-toggle"
          aria-expanded={!collapsed}
          aria-controls="demo-role-nav"
          onClick={() => setCollapsed(prev => !prev)}
        >
          {collapsed ? 'ขยายแถบสลับบทบาท ▾' : 'ย่อแถบ ▴'}
        </button>
      </div>
      {!collapsed && (
        <nav id="demo-role-nav" className="demo-role-nav" aria-label="สลับบทบาททดลองใช้งาน">
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
      )}
    </div>
  )
}
