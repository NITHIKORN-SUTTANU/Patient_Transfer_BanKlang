import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availabilityReport } from '../scripts/operations/availability.mjs'

const base = { month: '2030-01', calendarLabel: 'Synthetic calendar only', publishedOpenDates: ['2030-01-15'],
  observationStart: '2030-01-01T00:00:00+07:00', observationEnd: '2030-02-01T00:00:00+07:00' }
const interval = (start, end, state) => ({ start, end, state })
test('Bangkok open-day boundaries count every outage cause and exclude closed dates/outside hours', () => {
  const report = availabilityReport({ ...base, intervals: [
    interval('2030-01-14T00:00:00+07:00', '2030-01-15T06:03:00+07:00', 'unavailable'),
    interval('2030-01-15T06:03:00+07:00', '2030-01-15T16:00:00+07:00', 'available'),
    interval('2030-01-15T16:00:00+07:00', '2030-01-16T12:00:00+07:00', 'unavailable'),
  ] })
  assert.equal(report.windowServiceMinutes, 600)
  assert.equal(report.unavailableMinutes, 3)
  assert.equal(report.availabilityPercent, 99.5)
  assert.equal(report.monthlyTargetMet, true)
  const missed = availabilityReport({ ...base, intervals: [
    interval('2030-01-15T06:00:00+07:00', '2030-01-15T06:03:00.001+07:00', 'unavailable'),
    interval('2030-01-15T06:03:00.001+07:00', '2030-01-15T16:00:00+07:00', 'available'),
  ] })
  assert.equal(missed.monthlyTargetMet, false, 'Do not round a missed target into a pass')
})

test('gaps and explicit unknown intervals never become successful availability', () => {
  const report = availabilityReport({ ...base, intervals: [
    interval('2030-01-15T06:00:00+07:00', '2030-01-15T07:00:00+07:00', 'available'),
    interval('2030-01-15T08:00:00+07:00', '2030-01-15T09:00:00+07:00', 'unknown'),
  ] })
  assert.equal(report.availableMinutes, 60)
  assert.equal(report.unknownMinutes, 540)
  assert.equal(report.coveragePercent, 10)
  assert.equal(report.availabilityPercent, null)
  assert.equal(report.monthlyTargetMet, null)
  assert.equal(report.status, 'incomplete')
})

test('maintenance and provider interruptions both count as downtime during published hours', () => {
  const report = availabilityReport({ ...base, intervals: [
    interval('2030-01-15T06:00:00+07:00', '2030-01-15T08:00:00+07:00', 'available'),
    { ...interval('2030-01-15T08:00:00+07:00', '2030-01-15T08:01:00+07:00', 'unavailable'), cause: 'maintenance' },
    { ...interval('2030-01-15T08:01:00+07:00', '2030-01-15T08:03:00+07:00', 'unavailable'), cause: 'provider' },
    interval('2030-01-15T08:03:00+07:00', '2030-01-15T16:00:00+07:00', 'available'),
  ] })
  assert.equal(report.unavailableMinutes, 3)
  assert.equal(report.availabilityPercent, 99.5)
  assert.deepEqual(report.publishedOpenDates, base.publishedOpenDates)
})

test('partial-month windows and zero service minutes cannot establish monthly acceptance', () => {
  const partial = availabilityReport({ ...base, observationStart: '2030-01-15T06:00:00+07:00', observationEnd: '2030-01-15T07:00:00+07:00',
    intervals: [interval('2030-01-15T06:00:00+07:00', '2030-01-15T07:00:00+07:00', 'available')] })
  assert.equal(partial.availabilityPercent, 100)
  assert.equal(partial.periodKind, 'partial_month')
  assert.equal(partial.monthlyTargetMet, null)
  assert.equal(partial.outsideObservationWindowServiceMinutes, 540)
  const closed = availabilityReport({ ...base, publishedOpenDates: [], intervals: [] })
  assert.equal(closed.availabilityPercent, 'N/A')
  assert.equal(closed.monthlyTargetMet, null)
})

test('month rollover/leap day and timezone-equivalent instants remain exact', () => {
  for (const [month, date, end] of [['2032-02', '2032-02-29', '2032-03-01'], ['2030-12', '2030-12-31', '2031-01-01']]) {
    const report = availabilityReport({ ...base, month, publishedOpenDates: [date], observationStart: `${month}-01T00:00:00+07:00`,
      observationEnd: `${end}T00:00:00+07:00`, intervals: [interval(`${date}T00:00:00Z`, `${date}T09:00:00Z`, 'available'),
        interval(`${date}T06:00:00+07:00`, `${date}T07:00:00+07:00`, 'unavailable')] })
    assert.equal(report.unavailableMinutes, 60)
    assert.equal(report.availableMinutes, 540)
    assert.equal(report.unknownMinutes, 0)
  }
})

test('ambiguous overlapping observations and malformed calendars/timestamps fail closed', () => {
  const valid = { ...base, intervals: [] }
  for (const fields of [{ publishedOpenDates: ['2030-02-01'] }, { publishedOpenDates: ['2030-02-30'] },
    { publishedOpenDates: ['2030-01-15', '2030-01-15'] }, { observationStart: '2030-01-01T00:00:00' },
    { observationEnd: '2030-02-01T24:00:00+07:00' }, { calendarLabel: '' }, { month: '2030-13' },
    { intervals: [interval('2030-01-15T08:00:00+07:00', '2030-01-15T06:00:00+07:00', 'available')] },
    { intervals: [interval('2030-01-15T06:00:00+07:00', '2030-01-15T08:00:00+07:00', 'available'),
      interval('2030-01-15T07:00:00+07:00', '2030-01-15T09:00:00+07:00', 'unavailable')] }]) {
    assert.throws(() => availabilityReport({ ...valid, ...fields }))
  }
})
