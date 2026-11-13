import { createHash } from 'node:crypto'
import { readProbeJournal, validateProbePolicy } from './probe-journal.mjs'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === allowed.length && allowed.every(key => Object.hasOwn(value, key))
const categories = ['service_check', 'probe_configuration', 'collector', 'journal_access', 'observations']
const reasons = ['critical_check_failed', 'probe_access_denied', 'probe_response_invalid', 'collector_error',
  'collector_result_invalid', 'journal_unavailable', 'journal_anchor_conflict', 'sampling_policy_conflict',
  'observations_missing', 'observation_stale', 'sampling_gap', 'future_observation']
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
function stamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Canonical alert evaluation timestamp required')
  return Date.parse(value)
}
function dutyValue(input) {
  if (!keys(input, ['label', 'mode', 'publishedOpenDates']) || input.label !== 'provisional-local-alerts-v1' ||
    !['published_hours_only', 'always_for_rehearsal'].includes(input.mode) || !Array.isArray(input.publishedOpenDates) ||
    new Set(input.publishedOpenDates).size !== input.publishedOpenDates.length || input.publishedOpenDates.some(date =>
      typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) throw new Error('Explicit provisional alert duty policy required')
  return { label: input.label, mode: input.mode, publishedOpenDates: [...input.publishedOpenDates].sort() }
}
function inDuty(at, duty) {
  if (duty.mode === 'always_for_rehearsal') return true
  const local = new Date(at + 7 * 3600000).toISOString()
  return duty.publishedOpenDates.includes(local.slice(0, 10)) && local.slice(11, 16) >= '06:00' && local.slice(11, 16) < '16:00'
}
function firstDuty(from, until, duty) {
  if (from >= until) return null
  if (duty.mode === 'always_for_rehearsal') return from
  for (const date of duty.publishedOpenDates) {
    const start = Math.max(from, Date.parse(`${date}T06:00:00+07:00`))
    if (start < Math.min(until, Date.parse(`${date}T16:00:00+07:00`))) return start
  }
  return null
}
const stateFields = ['version', 'scope', 'policyHash', 'dutyHash', 'evaluatedAt', 'head', 'active', 'checksum']
const alertFields = ['key', 'id', 'openedAt', 'evidenceAt', 'evidenceSequence', 'evidenceHash', 'reason']
function previousState(previous, policyHash, dutyHash, now) {
  if (!previous) return { head: null, active: [] }
  if (!keys(previous, stateFields)) throw new Error('Invalid prior local alert state')
  const { checksum, ...body } = previous
  if (previous.version !== 1 || previous.scope !== 'synthetic-only' || previous.policyHash !== policyHash || previous.dutyHash !== dutyHash ||
    hash(body) !== checksum || stamp(previous.evaluatedAt) > now || !Array.isArray(previous.active) ||
    previous.head !== null && (!keys(previous.head, ['sequence', 'hash']) || !Number.isSafeInteger(previous.head.sequence) || previous.head.sequence < 1 || !hex(previous.head.hash))) {
    throw new Error('Prior alert state integrity, time or policy conflict')
  }
  const seen = new Set()
  for (const alert of previous.active) {
    if (!keys(alert, alertFields) || !categories.includes(alert.key) || !hex(alert.id) || !hex(alert.evidenceHash) ||
      !reasons.includes(alert.reason) || !Number.isSafeInteger(alert.evidenceSequence) || alert.evidenceSequence < 0 ||
      stamp(alert.openedAt) > stamp(alert.evidenceAt) || stamp(alert.evidenceAt) > now || seen.has(alert.key)) throw new Error('Invalid prior local alert evidence')
    seen.add(alert.key)
  }
  return { head: previous.head && { ...previous.head }, active: previous.active.map(alert => ({ ...alert })) }
}
export function validateProbeAlertResult(result) {
  if (!keys(result, ['state', 'events', 'evaluation']) || !result.state ||
    !hex(result.state.policyHash) || !hex(result.state.dutyHash) || !hex(result.state.checksum)) throw new Error('Invalid alert result envelope')
  previousState(result.state, result.state.policyHash, result.state.dutyHash, stamp(result.state.evaluatedAt))
  const evaluation = result.evaluation
  if (!keys(evaluation, ['scope', 'at', 'inDuty', 'journalReadableAndTrusted', 'activeCount', 'confirmedServiceOutage']) ||
    evaluation.scope !== 'synthetic-only; local findings require operational reconciliation' || evaluation.at !== result.state.evaluatedAt ||
    typeof evaluation.inDuty !== 'boolean' || typeof evaluation.journalReadableAndTrusted !== 'boolean' ||
    evaluation.activeCount !== result.state.active.length || evaluation.confirmedServiceOutage !== false || !Array.isArray(result.events)) throw new Error('Invalid alert evaluation metadata')
  const ids = new Set()
  for (const event of result.events) {
    if (!keys(event, ['version', 'scope', 'id', 'transition', 'alertId', 'category', 'reason', 'occurredAt', 'evaluatedAt', 'source', 'actor', 'confirmedServiceOutage']) ||
      event.version !== 1 || event.scope !== 'synthetic-only' || !['opened', 'recovered'].includes(event.transition) ||
      !hex(event.alertId) || !categories.includes(event.category) || !reasons.includes(event.reason) || event.evaluatedAt !== evaluation.at ||
      stamp(event.occurredAt) > stamp(evaluation.at) || !keys(event.source, ['sequence', 'hash']) || !hex(event.source.hash) ||
      !Number.isSafeInteger(event.source.sequence) || event.source.sequence < 0 || event.actor !== 'synthetic-evaluator-v1' || event.confirmedServiceOutage !== false ||
      event.id !== hash([event.transition, event.alertId, event.transition === 'recovered' ? event.source.hash : null]) || ids.has(event.id)) throw new Error('Invalid sanitized alert transition')
    ids.add(event.id)
  }
  return result
}

// Local synthetic reconciliation only: no notification sender, municipal owner or confirmed-incident authority.
export async function evaluateProbeAlerts({ path, policy, duty: dutyInput, at, previous = null }) {
  const sampling = validateProbePolicy(policy), duty = dutyValue(dutyInput), now = stamp(at)
  const policyHash = hash(sampling), dutyHash = hash(duty), state = previousState(previous, policyHash, dutyHash, now)
  const active = new Map(state.active.map(alert => [alert.key, alert])), events = []
  let head = state.head
  const source = row => ({ sequence: row?.sequence ?? head?.sequence ?? 0, hash: row?.hash ?? head?.hash ?? '0'.repeat(64) })
  function event(transition, alert, occurredAt, evidence) {
    events.push({ version: 1, scope: 'synthetic-only', id: hash([transition, alert.id, transition === 'recovered' ? evidence.hash : null]),
      transition, alertId: alert.id, category: alert.key, reason: alert.reason, occurredAt, evaluatedAt: at,
      source: evidence, actor: 'synthetic-evaluator-v1', confirmedServiceOutage: false })
  }
  function openAlert(key, reason, time, row) {
    if (!inDuty(time, duty)) return
    const evidence = source(row), evidenceAt = new Date(time).toISOString(), existing = active.get(key)
    if (existing) {
      const currentFinding = ['journal_unavailable', 'journal_anchor_conflict', 'sampling_policy_conflict', 'observations_missing', 'observation_stale', 'future_observation'].includes(reason)
      if (evidence.sequence > existing.evidenceSequence || evidence.hash !== existing.evidenceHash || currentFinding && time > stamp(existing.evidenceAt)) {
        const oldSequence = existing.evidenceSequence, oldTime = stamp(existing.evidenceAt)
        existing.evidenceAt = new Date(Math.max(oldTime, time)).toISOString()
        existing.evidenceSequence = Math.max(oldSequence, evidence.sequence)
        if (evidence.sequence >= oldSequence) { existing.evidenceHash = evidence.hash; existing.reason = reason }
        else if (currentFinding && time >= oldTime) existing.reason = reason
      }
      return
    }
    const alert = { key, id: hash([key, evidence, reason, evidenceAt]), openedAt: evidenceAt,
      evidenceAt, evidenceSequence: evidence.sequence, evidenceHash: evidence.hash, reason }
    active.set(key, alert); event('opened', alert, evidenceAt, evidence)
  }
  function recover(row) {
    if (now - stamp(row.finishedAt) >= sampling.maxAgeMs) return
    for (const [key, alert] of active) {
      if (row.sequence > alert.evidenceSequence && stamp(row.observedAt) >= stamp(alert.evidenceAt) && stamp(row.finishedAt) > stamp(alert.evidenceAt)) {
        event('recovered', alert, row.finishedAt, source(row)); active.delete(key)
      }
    }
  }
  let records, readOk = false
  try { records = await readProbeJournal(path); readOk = true }
  catch { openAlert('journal_access', 'journal_unavailable', now) }
  if (readOk) {
    if (head && records[head.sequence - 1]?.hash !== head.hash) {
      openAlert('journal_access', 'journal_anchor_conflict', now); readOk = false
    } else if (records.some(row => hash(row.policy) !== policyHash)) {
      openAlert('probe_configuration', 'sampling_policy_conflict', now); readOk = false
    } else if (records.some(row => stamp(row.finishedAt) > now)) {
      const future = records.find(row => stamp(row.finishedAt) > now)
      openAlert('probe_configuration', 'future_observation', now, future); readOk = false
    }
  }
  if (readOk) {
    let predecessor = head ? records[head.sequence - 1] : null
    for (const row of records.slice(head?.sequence ?? 0)) {
      if (predecessor) {
        const gap = firstDuty(stamp(predecessor.finishedAt) + sampling.maxAgeMs, stamp(row.observedAt), duty)
        if (gap !== null) openAlert('observations', 'sampling_gap', gap, predecessor)
      }
      const finished = stamp(row.finishedAt)
      if (row.state === 'available') recover(row)
      else if (row.state === 'unknown') openAlert('collector', row.failure.code === 'collector_error' ? 'collector_error' : 'collector_result_invalid', finished, row)
      else {
        const access = /^http_40[13]$/.test(row.failure.code)
        const malformed = ['invalid_content_type', 'invalid_json', 'invalid_result'].includes(row.failure.code)
        openAlert(access || malformed ? 'probe_configuration' : 'service_check',
          access ? 'probe_access_denied' : malformed ? 'probe_response_invalid' : 'critical_check_failed', finished, row)
      }
      head = { sequence: row.sequence, hash: row.hash }; predecessor = row
    }
    const latest = records.at(-1)
    if (!latest) openAlert('observations', 'observations_missing', now)
    else if (now - stamp(latest.finishedAt) >= sampling.maxAgeMs) openAlert('observations', 'observation_stale', now, latest)
  }
  const body = { version: 1, scope: 'synthetic-only', policyHash, dutyHash, evaluatedAt: at, head,
    active: [...active.values()].sort((a, b) => a.key.localeCompare(b.key)) }
  return { state: { ...body, checksum: hash(body) }, events,
    evaluation: { scope: 'synthetic-only; local findings require operational reconciliation', at, inDuty: inDuty(now, duty),
      journalReadableAndTrusted: readOk, activeCount: active.size, confirmedServiceOutage: false } }
}
