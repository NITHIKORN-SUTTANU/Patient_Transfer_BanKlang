import { Link } from 'react-router'
import { createPortal } from 'react-dom'
import { ServiceSymbol } from './ServiceSymbol'

export function RoleSelectionLink() {
  return createPortal(<nav aria-label="เลือกบทบาท"><Link className="role-selection-shortcut" to="/" aria-label="กลับเลือกบทบาท" title="กลับเลือกบทบาท"><ServiceSymbol kind="people" /></Link></nav>, document.body)
}
