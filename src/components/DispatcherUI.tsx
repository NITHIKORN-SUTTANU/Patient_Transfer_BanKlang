import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BookingButton, BookingModal } from './BookingUI'

export function DispatchButton(props: Parameters<typeof BookingButton>[0]) {
  return <BookingButton {...props} className={`dispatch-button ${props.className || ''}`} />
}
export function DispatchModal({ title, children, onClose, kind = '' }: { title: string; children: ReactNode; onClose: () => void; kind?: string }) {
  return <BookingModal title={title} onClose={onClose} className={`dispatch-modal ${kind}`}>{children}</BookingModal>
}
export function ResourcePicker({ label, placeholder, value, options, onChange }: { label: string; placeholder: string; value: string; options: { id: string; label: string; active: boolean }[]; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  function close() { setOpen(false); trigger.current?.focus() }
  // Preserve focus during option mousedown: Safari otherwise focuses the
  // surrounding main element and closes the list before click can select.
  return <div ref={root} className="dispatch-resource" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }} onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      const choices = [...root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')]
      if (!choices.length) return
      const index = choices.indexOf(document.activeElement as HTMLButtonElement)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length
      choices[next].focus()
    }
  }}>
    <button ref={trigger} type="button" className="dispatch-resource-trigger" aria-label={`${label}: ${options.find(o => o.id === value)?.label || placeholder}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}><span>{label}:</span>{' '}<strong>{options.find(o => o.id === value)?.label || placeholder}<span aria-hidden="true"> ▾</span></strong></button>
    {open && <div role="listbox" aria-label={label} className="dispatch-resource-options">{options.length ? options.map(option => <button type="button" role="option" key={option.id} disabled={!option.active} aria-selected={value === option.id} onMouseDown={event => event.preventDefault()} onClick={() => { onChange(option.id); close() }}><strong>{option.label}</strong><span>{option.active ? 'แตะเพื่อเลือก' : 'ไม่พร้อมใช้งาน'}</span></button>) : <p>ไม่มี{label}ที่พร้อมใช้งาน</p>}</div>}
  </div>
}
