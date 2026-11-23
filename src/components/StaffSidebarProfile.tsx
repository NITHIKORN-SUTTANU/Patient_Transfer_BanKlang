import { staffSession, useStaffSession } from '../services/staffSession'
import { ServiceSymbol } from './ServiceSymbol'

export function StaffSidebarProfile() {
  const { user, busy, error } = useStaffSession()
  if (!user) return null

  return <footer className="dispatch-sidebar-account">
    <div className="dispatch-sidebar-profile" aria-label={user.name} role="group" title={user.name}>
      <span className="dispatch-sidebar-avatar" aria-hidden="true"><ServiceSymbol kind="person" /></span>
      <span className="dispatch-sidebar-name">{user.name}</span>
    </div>
    <button type="button" className="dispatch-sidebar-logout" disabled={busy} onClick={() => void staffSession.logout()}>ออกจาก<wbr />ระบบ</button>
    {error && <div className="dispatch-alert" role="alert">{error}</div>}
  </footer>
}
