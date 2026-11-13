const minute = 60000
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
function instant(value) {
  if (typeof value !== 'string' || !validDate(value.slice(0, 10)) ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))) throw new Error('Valid timezone-aware observation timestamp required')
  return Date.parse(value)
}

// Input intervals describe system-wide critical-service state, not separate component totals.
// Missing coverage remains unknown. No weekday/holiday calendar or maintenance exemption is invented.
export function availabilityReport({ month, calendarLabel, publishedOpenDates, observationStart, observationEnd, intervals }) {
  if (!/^\d{4}-\d{2}$/.test(month ?? '') || !validDate(`${month}-01`)) throw new Error('Valid reporting month required')
  if (typeof calendarLabel !== 'string' || !calendarLabel.trim() || calendarLabel.length > 120) throw new Error('Explicit calendar label required')
  if (!Array.isArray(publishedOpenDates) || new Set(publishedOpenDates).size !== publishedOpenDates.length ||
    publishedOpenDates.some(date => !validDate(date) || !date.startsWith(`${month}-`))) throw new Error('Unique published open dates within reporting month required')
  const [year, monthNumber] = month.split('-').map(Number)
  const nextMonth = monthNumber === 12 ? `${String(year + 1).padStart(4, '0')}-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}`
  const periodStart = `${month}-01T00:00:00+07:00`, periodEnd = `${nextMonth}-01T00:00:00+07:00`
  const start = instant(observationStart), end = instant(observationEnd)
  if (start >= end || start < instant(periodStart) || end > instant(periodEnd)) throw new Error('Observation window must be positive and within reporting month')
  if (!Array.isArray(intervals)) throw new Error('Observation intervals required')
  const states = intervals.map(row => {
    if (!['available', 'unavailable', 'unknown'].includes(row.state)) throw new Error('Invalid service observation state')
    const from = instant(row.start), until = instant(row.end)
    if (from >= until) throw new Error('Positive observation interval required')
    return { from, until, state: row.state }
  }).sort((a, b) => a.from - b.from)
  for (let index = 1; index < states.length; index++) if (states[index].from < states[index - 1].until) throw new Error('Overlapping system-wide observations must be reconciled before accounting')
  let scheduledMs = 0, availableMs = 0, unavailableMs = 0
  for (const date of publishedOpenDates) {
    const from = Math.max(start, instant(`${date}T06:00:00+07:00`)), until = Math.min(end, instant(`${date}T16:00:00+07:00`))
    if (from >= until) continue
    scheduledMs += until - from
    for (const row of states) {
      const overlap = Math.max(0, Math.min(until, row.until) - Math.max(from, row.from))
      if (row.state === 'available') availableMs += overlap
      if (row.state === 'unavailable') unavailableMs += overlap
    }
  }
  const unknownMs = scheduledMs - availableMs - unavailableMs
  const availabilityPercent = scheduledMs === 0 ? 'N/A' : unknownMs > 0 ? null : 100 * (scheduledMs - unavailableMs) / scheduledMs
  const fullMonth = start === instant(periodStart) && end === instant(periodEnd)
  return { month, calendarLabel: calendarLabel.trim(), timezone: 'Asia/Bangkok', periodStart, periodEnd,
    publishedOpenDates: [...publishedOpenDates].sort(), opensAt: '06:00', closesAt: '16:00',
    observationStart, observationEnd, periodKind: fullMonth ? 'full_month' : 'partial_month',
    status: scheduledMs === 0 ? 'no_service_minutes' : unknownMs ? 'incomplete' : 'measured',
    publishedMonthServiceMinutes: publishedOpenDates.length * 600,
    windowServiceMinutes: scheduledMs / minute, availableMinutes: availableMs / minute,
    unavailableMinutes: unavailableMs / minute, unknownMinutes: unknownMs / minute,
    outsideObservationWindowServiceMinutes: publishedOpenDates.length * 600 - scheduledMs / minute,
    coveragePercent: scheduledMs ? 100 * (availableMs + unavailableMs) / scheduledMs : 'N/A',
    availabilityPercent, monthlyAvailabilityPercent: fullMonth ? availabilityPercent : null,
    targetPercent: 99.5, monthlyTargetMet: fullMonth && typeof availabilityPercent === 'number' ? availabilityPercent >= 99.5 : null }
}
