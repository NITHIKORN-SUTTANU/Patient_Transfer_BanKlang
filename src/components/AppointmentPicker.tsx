import { TimeWheel } from './TimeWheel'
import { useEffect, useRef, useState } from 'react'
import { appointmentTimestamp, bangkokDate, LEAD_TIME_MS, meetsLeadTime, thaiDate } from '../services/booking'
import { BookingButton, BookingModal } from './BookingUI'

const pad = (n: number) => String(n).padStart(2, '0')
const weekdays = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']

function bangkokThreshold(nowMs: number) {
  // Round up to the next whole minute so the returned clock passes meetsLeadTime cleanly.
  const thresholdMs = Math.ceil((nowMs + LEAD_TIME_MS) / 60_000) * 60_000
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(thresholdMs)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00'
  const date = `${get('year')}-${get('month')}-${get('day')}`
  const hour = Number(get('hour'))
  const minute = Number(get('minute'))
  return { date, hour, minute, clock: `${pad(hour)}:${pad(minute)}`, thresholdMs }
}

function addDaysBkk(dateStr: string, days: number): string {
  const base = Date.parse(`${dateStr}T12:00:00+07:00`)
  return bangkokDate(base + days * 24 * 3600_000)
}

function initialClockFor(date: string, time: string, nowMs: number): [number, number] {
  const candidate = time || '10:30'
  if (!date || meetsLeadTime(date, candidate, nowMs)) {
    return [Number(candidate.slice(0, 2)), Number(candidate.slice(3))]
  }
  const threshold = bangkokThreshold(nowMs)
  if (date === threshold.date) {
    return [threshold.hour, threshold.minute]
  }
  return [8, 0]
}

export function AppointmentPicker({
  kind,
  date,
  time,
  onConfirm,
  onJumpDateTime,
  onClose,
}: {
  kind: 'date' | 'time'
  date: string
  time: string
  onConfirm: (value: string) => void
  onJumpDateTime?: (nextDate: string, nextTime: string) => void
  onClose: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const threshold = bangkokThreshold(now)
  const minimum = threshold.date
  const [selectedDate, setSelectedDate] = useState(date || minimum)
  const [month, setMonth] = useState((date || minimum).slice(0, 7))
  const calendar = useRef<HTMLDivElement>(null)
  useEffect(() => { calendar.current?.querySelector<HTMLButtonElement>('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest' }) }, [month, selectedDate])
  const [initialHour, initialMinute] = initialClockFor(date, time, now)
  const [hour, setHour] = useState(initialHour)
  const [minute, setMinute] = useState(initialMinute)
  const selectedTime = `${pad(hour)}:${pad(minute)}`
  const invalid = kind === 'date'
    ? selectedDate < minimum || (!!time && !meetsLeadTime(selectedDate, time, now))
    : !!date && !meetsLeadTime(date, selectedTime, now)
  const [year, monthNumber] = month.split('-').map(Number)
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay()
  const thresholdAfterServiceHours = threshold.clock > '16:00'
  const nextMorningDate = addDaysBkk(date && date >= threshold.date ? date : threshold.date, 1)

  function moveMonth(delta: number) {
    const d = new Date(Date.UTC(year, monthNumber - 1 + delta, 1))
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`)
  }
  function confirm() {
    const currentTime = Date.now()
    const valid = kind === 'date' ? selectedDate >= bangkokDate(currentTime + LEAD_TIME_MS) && (!time || meetsLeadTime(selectedDate, time, currentTime)) : !date || meetsLeadTime(date, selectedTime, currentTime)
    if (!valid) { setNow(currentTime); return }
    onConfirm(kind === 'date' ? selectedDate : selectedTime)
  }
  return <BookingModal title={kind === 'date' ? 'เลือกวันนัดหมาย' : 'เลือกเวลานัดหมาย'} onClose={onClose} footer={<><p className="booking-picker-value" aria-live="polite">{kind === 'date' ? thaiDate(selectedDate, true) : `${selectedTime} น.`}</p><div className="booking-modal-actions"><BookingButton secondary onClick={onClose}>ยกเลิก</BookingButton><BookingButton disabled={invalid} onClick={confirm}>{kind === 'date' ? 'ยืนยันวันที่' : 'ยืนยันเวลา'}</BookingButton></div></>}>
    <p className="booking-picker-hint">{kind === 'date' ? 'เลือกวันและเวลาให้ห่างอย่างน้อย 48 ชม.' : 'เลื่อนขึ้น–ลงเพื่อเลือกเวลา (00:00–23:59)'}</p>
    {kind === 'date' ? <><div className="booking-calendar-month"><button type="button" aria-label="เดือนก่อนหน้า" onClick={() => moveMonth(-1)}>‹</button><h3 aria-live="polite">{new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`))}</h3><button type="button" aria-label="เดือนถัดไป" onClick={() => moveMonth(1)}>›</button></div><div ref={calendar} className="booking-calendar" role="group" aria-label="วันที่นัดหมาย">{['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((d, i) => <span className="weekday" key={i}>{d}</span>)}{Array.from({ length: firstDay }, (_, n) => <span key={`blank-${n}`} />)}{Array.from({ length: dayCount }, (_, n) => { const value = `${month}-${pad(n + 1)}`; const disabled = appointmentTimestamp(value, '23:59') < now + LEAD_TIME_MS; return <button type="button" key={value} disabled={disabled} aria-label={`${weekdays[(firstDay + n) % 7]} ${thaiDate(value, true)}`} aria-pressed={selectedDate === value} className={selectedDate === value ? 'selected' : ''} onClick={() => setSelectedDate(value)}><span className="booking-calendar-day" aria-hidden="true">{weekdays[(firstDay + n) % 7]}</span>{' '}{n + 1}</button> })}</div></> : <div className="booking-time-fields"><TimeWheel label="ชั่วโมง" value={hour} maximum={24} onChange={setHour} /><span aria-hidden="true">:</span><TimeWheel label="นาที" value={minute} maximum={60} onChange={setMinute} /></div>}
    {invalid && (
      <div role="alert" className="booking-error-box booking-picker-lead-alert">
        {kind === 'date' ? (
          <p>วัน/เวลานัดต้องห่างอย่างน้อย 48 ชั่วโมง</p>
        ) : date === threshold.date && !thresholdAfterServiceHours ? (
          <>
            <p>ต้องจองล่วงหน้า 48 ชม. (วันนี้เลือกได้ตั้งแต่ {threshold.clock} น. เป็นต้นไป)</p>
            <button
              type="button"
              className="booking-picker-jump-btn"
              onClick={() => { setHour(threshold.hour); setMinute(threshold.minute) }}
            >
              ไปเวลาแรกที่จองได้ ({threshold.clock} น.)
            </button>
          </>
        ) : (
          <>
            <p>ต้องจองล่วงหน้า 48 ชม. ({date === threshold.date ? `วันนี้เลือกได้ตั้งแต่ ${threshold.clock} น. ซึ่งเลยเวลาทำการ 16:00 น. แล้ว` : 'วันที่เลือกไม่ผ่านเงื่อนไข 48 ชั่วโมง'})</p>
            <div className="booking-picker-jump-actions">
              {onJumpDateTime && (
                <button
                  type="button"
                  className="booking-picker-jump-btn"
                  onClick={() => onJumpDateTime(nextMorningDate, '08:00')}
                >
                  ไปเช้าวันถัดไป (08:00 น.)
                </button>
              )}
              {date === threshold.date && (
                <button
                  type="button"
                  className="booking-picker-jump-btn secondary"
                  onClick={() => { setHour(threshold.hour); setMinute(threshold.minute) }}
                >
                  ไปเวลาแรกที่จองได้ ({threshold.clock} น.)
                </button>
              )}
            </div>
          </>
        )}
      </div>
    )}
  </BookingModal>
}

