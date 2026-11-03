import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router'

export function ResponsiveNavigation({ id, label, className = '', children }: { id: string; label: string; className?: string; children: ReactNode }) {
  const { pathname } = useLocation()
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width:767px)').matches)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const open = mobile && expandedPath === pathname
  function close() { setExpandedPath(null); trigger.current?.focus() }
  useEffect(() => {
    const media = window.matchMedia('(max-width:767px)')
    const change = () => { setExpandedPath(null); setMobile(media.matches) }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useLayoutEffect(() => {
    const drawer = dialog.current
    if (!drawer || !open) { drawer?.close(); return }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    drawer.showModal()
    return () => { drawer.close(); document.body.style.overflow = previousOverflow }
  }, [open, mobile])
  const navigation = <nav id={id} aria-label={label} className={`${className} responsive-navigation`} onClick={event => { if ((event.target as HTMLElement).closest('a')) close() }}>{children}</nav>
  return <>
    <button ref={trigger} type="button" className={`navigation-toggle ${id}-toggle`} aria-label={label} aria-controls={id} aria-expanded={open} aria-haspopup="dialog" onClick={() => setExpandedPath(open ? null : pathname)}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
    {mobile ? createPortal(<dialog ref={dialog} className="navigation-drawer" aria-labelledby={`${id}-heading`} onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }} onKeyDown={event => {
      if (event.key !== 'Tab') return
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')]
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <div className="navigation-drawer-content"><header><h2 id={`${id}-heading`}>{label}</h2><button type="button" aria-label="ปิดเมนู" onClick={close}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button></header>{navigation}</div>
    </dialog>, document.body) : navigation}
  </>
}
