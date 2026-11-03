import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent } from 'react'

const ROW_HEIGHT = 48
const pad = (value: number) => String(value).padStart(2, '0')

export function TimeWheel({ label, value, maximum, onChange }: { label: string; value: number; maximum: number; onChange: (value: number) => void }) {
  const id = useId()
  const wheel = useRef<HTMLDivElement>(null)
  const initial = useRef(value)
  const rowHeight = useRef(ROW_HEIGHT)
  const digits = useRef({ text: '', at: 0 })
  useEffect(() => {
    const element = wheel.current!
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      event.preventDefault()
      const direction = Math.sign(event.deltaY)
      const current = Math.round(element.scrollTop / rowHeight.current)
      const next = Math.max(0, Math.min(maximum - 1, current + direction))
      element.scrollTo({ top: next * rowHeight.current, behavior: 'instant' })
      onChange(next)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [maximum, onChange])
  // The containing dialog opens in its layout effect, before this effect runs.
  useEffect(() => { if (wheel.current) wheel.current.scrollTop = initial.current * ROW_HEIGHT }, [])
  useEffect(() => {
    const element = wheel.current!
    const text = element.querySelector<HTMLElement>('[aria-selected=true] span')!
    const measure = () => {
      if (text.parentElement?.getAttribute('aria-selected') !== 'true') return
      const next = Math.max(ROW_HEIGHT, Math.ceil(text.getBoundingClientRect().height) + 8)
      if (next === rowHeight.current) return
      rowHeight.current = next
      element.parentElement!.style.setProperty('--time-row-height', `${next}px`)
      element.scrollTop = value * next
    }
    const observer = new ResizeObserver(measure)
    observer.observe(text)
    measure()
    return () => observer.disconnect()
  }, [value])
  function select(next: number) {
    const bounded = Math.max(0, Math.min(maximum - 1, next))
    wheel.current?.focus({ preventScroll: true })
    wheel.current?.scrollTo({ top: bounded * rowHeight.current, behavior: 'instant' })
    onChange(bounded)
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = { ArrowUp: value - 1, ArrowDown: value + 1, Home: 0, End: maximum - 1, PageUp: value - 5, PageDown: value + 5 }
    const next = keys[event.key]
    if (next !== undefined) { event.preventDefault(); digits.current.text = ''; select(next); return }
    if (/^\d$/.test(event.key)) {
      event.preventDefault()
      const now = event.timeStamp
      const entered = now - digits.current.at < 750 ? digits.current.text + event.key : event.key
      const text = entered.length <= 2 && Number(entered) < maximum ? entered : event.key
      digits.current = { text, at: now }
      select(Number(text))
    }
  }
  return <div className="booking-time-field"><span id={`${id}-label`} className="booking-time-label">{label}</span><div className="booking-time-wheel-frame"><span className="booking-time-selection" aria-hidden="true" /><div ref={wheel} className="booking-time-wheel" role="listbox" tabIndex={0} aria-labelledby={`${id}-label`} aria-orientation="vertical" aria-activedescendant={`${id}-${value}`} onKeyDown={onKeyDown} onScroll={event => {
    const nearest = Math.max(0, Math.min(maximum - 1, Math.round(event.currentTarget.scrollTop / rowHeight.current)))
    if (nearest !== value) onChange(nearest)
  }}>{Array.from({ length: maximum }, (_, option) => <div id={`${id}-${option}`} key={option} role="option" aria-selected={option === value} className="booking-time-option" onClick={() => select(option)}><span>{pad(option)}</span></div>)}</div></div></div>
}
