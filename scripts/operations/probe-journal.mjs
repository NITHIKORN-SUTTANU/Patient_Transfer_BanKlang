import { open, readFile, stat, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { availabilityReport } from './availability.mjs'

export const criticalProbeChecks = Object.freeze(['line_identity', 'citizen_identity', 'current_consent', 'citizen_booking',
  'citizen_status', 'dispatcher_login', 'dispatcher_review', 'dispatcher_approval', 'dispatcher_schedule',
  'dispatcher_assignment', 'driver_login', 'driver_jobs', 'driver_record', 'citizen_reauthentication', 'citizen_current_status'])
const checks = new Set([...criticalProbeChecks, 'database_health', 'collector'])
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const genesis = '0'.repeat(64), maxBytes = 4 * 1024 * 1024
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === allowed.length && allowed.every(key => Object.hasOwn(value, key))
const sampleKeys = ['id', 'scope', 'clockKind', 'policy', 'observedAt', 'finishedAt', 'state', 'databaseHealthOk', 'failure']
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Canonical UTC probe timestamp required')
  return Date.parse(value)
}
function policyValue(policy) {
  if (!keys(policy, ['label', 'cadenceMs', 'maxAgeMs']) || policy.label !== 'provisional-synthetic-v1' ||
    !Number.isSafeInteger(policy.cadenceMs) || policy.cadenceMs < 1 || !Number.isSafeInteger(policy.maxAgeMs) ||
    policy.maxAgeMs < policy.cadenceMs || policy.maxAgeMs > 3600000) throw new Error('Explicit bounded provisional sampling policy required')
  return { label: policy.label, cadenceMs: policy.cadenceMs, maxAgeMs: policy.maxAgeMs }
}
export function validateProbePolicy(policy) { return policyValue(policy) }
const validFailure = failure => keys(failure, ['check', 'code']) && typeof failure.check === 'string' && typeof failure.code === 'string' && checks.has(failure.check) &&
  /^(transport|timeout|invalid_content_type|invalid_json|invalid_result|collector_error|http_[1-5]\d{2})$/.test(failure.code)
function sampleValue(value) {
  if (!keys(value, sampleKeys) || typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.id) || value.scope !== 'synthetic-only' ||
    !['system', 'controlled'].includes(value.clockKind) || timestamp(value.observedAt) > timestamp(value.finishedAt) ||
    !['available', 'unavailable', 'unknown'].includes(value.state) ||
    ![null, true, false].includes(value.databaseHealthOk) ||
    (value.state === 'available' ? value.failure !== null : !validFailure(value.failure)) ||
    (value.state === 'unavailable' && !criticalProbeChecks.includes(value.failure.check)) ||
    (value.state === 'unknown' && (value.failure.check !== 'collector' || !['collector_error', 'invalid_result'].includes(value.failure.code)))) {
    throw new Error('Invalid sanitized probe record')
  }
  return { id: value.id, scope: value.scope, clockKind: value.clockKind, policy: policyValue(value.policy),
    observedAt: value.observedAt, finishedAt: value.finishedAt, state: value.state,
    databaseHealthOk: value.databaseHealthOk, failure: value.failure && { check: value.failure.check, code: value.failure.code } }
}
function verify(records) {
  let previousHash = genesis, previous
  const ids = new Set()
  for (const [index, row] of records.entries()) {
    if (!keys(row, ['version', 'sequence', ...sampleKeys, 'previousHash', 'hash'])) throw new Error('Invalid probe journal envelope')
    const sample = sampleValue(Object.fromEntries(sampleKeys.map(key => [key, row[key]])))
    const envelope = { version: 1, sequence: index + 1, ...sample, previousHash }
    if (row.version !== 1 || row.sequence !== index + 1 || row.previousHash !== previousHash || row.hash !== digest(envelope) || ids.has(row.id) ||
      previous && (timestamp(row.observedAt) < timestamp(previous.finishedAt) || row.finishedAt === previous.finishedAt || row.clockKind !== previous.clockKind || digest(row.policy) !== digest(previous.policy))) {
      throw new Error('Probe journal chain, identity, chronology or policy conflict')
    }
    previousHash = row.hash; previous = row; ids.add(row.id)
  }
  return records
}
async function locked(path, work) {
  let lock
  try { lock = await open(`${path}.lock`, 'wx', 0o600) }
  catch { throw new Error('Probe journal unavailable or already locked; reconcile before retry') }
  try { return await work() }
  finally { await lock.close(); await unlink(`${path}.lock`) }
}
async function readUnlocked(path) {
  let data
  try {
    if ((await stat(path)).size > maxBytes) throw new Error('Probe journal size limit reached')
    data = await readFile(path, 'utf8')
  } catch (error) { if (error.code === 'ENOENT') return []; throw new Error('Probe journal cannot be read within its size limit') }
  if (Buffer.byteLength(data) > maxBytes || data && !data.endsWith('\n')) throw new Error('Probe journal is oversized or has an incomplete tail; reconcile without truncating')
  let records
  try { records = data ? data.slice(0, -1).split('\n').map(line => JSON.parse(line)) : [] }
  catch { throw new Error('Invalid probe journal JSON; reconcile without rewriting') }
  return verify(records)
}
export async function readProbeJournal(path, { expectedHead } = {}) {
  return locked(path, async () => {
    const records = await readUnlocked(path)
    if (expectedHead && (records.at(-1)?.sequence !== expectedHead.sequence || records.at(-1)?.hash !== expectedHead.hash)) throw new Error('Probe journal differs from supplied head anchor')
    return records
  })
}
export async function appendProbeSample(path, input) {
  const sample = sampleValue(input)
  return locked(path, async () => {
    const records = await readUnlocked(path), existing = records.find(row => row.id === sample.id)
    if (existing) {
      if (sampleKeys.some(key => JSON.stringify(existing[key]) !== JSON.stringify(sample[key]))) throw new Error('Probe sample identity reused with different content')
      return existing
    }
    const envelope = { version: 1, sequence: records.length + 1, ...sample, previousHash: records.at(-1)?.hash ?? genesis }
    const record = { ...envelope, hash: digest(envelope) }
    verify([...records, record])
    const line = `${JSON.stringify(record)}\n`
    if (Buffer.byteLength(line) + (records.length ? (await stat(path)).size : 0) > maxBytes) throw new Error('Probe journal size limit reached')
    const file = await open(path, 'a', 0o600)
    try { await file.writeFile(line); await file.sync() } finally { await file.close() }
    return record
  })
}

function sanitizedResult(result) {
  const health = typeof result?.databaseHealthOk === 'boolean' ? result.databaseHealthOk : null
  const observed = Array.isArray(result?.checks) ? result.checks : []
  if (new Set(observed.map(row => row?.name)).size !== observed.length || observed.some(row =>
    !row || !checks.has(row.name) || typeof row.ok !== 'boolean' || (row.ok ? row.failure !== null : !validFailure({ check: row.name, code: row.failure })))) {
    return { state: 'unknown', databaseHealthOk: health, failure: { check: 'collector', code: 'invalid_result' } }
  }
  const healthy = result?.state === 'available' && result.failure === null && criticalProbeChecks.every(name => observed.some(row => row.name === name && row.ok === true))
  if (healthy) return { state: 'available', databaseHealthOk: health, failure: null }
  if (result?.state === 'unavailable' && validFailure(result.failure) && result.failure.check !== 'collector' && result.failure.check !== 'database_health' &&
    observed.some(row => row.name === result.failure.check && row.ok === false && row.failure === result.failure.code)) {
    return { state: 'unavailable', databaseHealthOk: health, failure: { check: result.failure.check, code: result.failure.code } }
  }
  return { state: 'unknown', databaseHealthOk: health, failure: { check: 'collector', code: 'invalid_result' } }
}
export async function collectProbe({ path, policy, run, clock, id = randomUUID() }) {
  const sampling = policyValue(policy), now = clock ?? (() => new Date().toISOString())
  const observedAt = now(); timestamp(observedAt)
  let outcome
  try { outcome = sanitizedResult(await run()) }
  catch { outcome = { state: 'unknown', databaseHealthOk: null, failure: { check: 'collector', code: 'collector_error' } } }
  const finishedAt = now(); timestamp(finishedAt)
  return appendProbeSample(path, { id, scope: 'synthetic-only', clockKind: clock ? 'controlled' : 'system', policy: sampling,
    observedAt, finishedAt, ...outcome })
}

export function probeIntervals(records, { policy, observationStart, observationEnd }) {
  const sampling = policyValue(policy), from = timestamp(observationStart), until = timestamp(observationEnd)
  if (from >= until) throw new Error('Positive probe replay window required')
  verify(records)
  if (records.some(row => digest(row.policy) !== digest(sampling))) throw new Error('Replay sampling policy differs from recorded policy')
  const intervals = []
  let cursor = from
  function add(start, end, state) {
    if (start >= end) return
    const previous = intervals.at(-1)
    if (previous?.state === state && Date.parse(previous.end) === start) previous.end = new Date(end).toISOString()
    else intervals.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), state })
  }
  for (const [index, row] of records.entries()) {
    const completed = timestamp(row.finishedAt)
    const start = Math.max(from, completed), end = Math.min(until, completed + sampling.maxAgeMs,
      records[index + 1] ? timestamp(records[index + 1].observedAt) : Infinity)
    if (start >= end) continue
    add(cursor, start, 'unknown'); add(start, end, row.state); cursor = end
  }
  add(cursor, until, 'unknown')
  return intervals
}
export async function replayProbeJournal({ path, policy, expectedHead, ...window }) {
  // Validate calendar/window before canonicalizing offset timestamps for replay.
  availabilityReport({ ...window, intervals: [] })
  const records = await readProbeJournal(path, { expectedHead })
  const intervals = probeIntervals(records, { policy, observationStart: new Date(window.observationStart).toISOString(), observationEnd: new Date(window.observationEnd).toISOString() })
  return { ...availabilityReport({ ...window, intervals }), intervals,
    provenance: { scope: 'synthetic-only; bounded forward inference, not exact incident times',
      recordCount: records.length, headHash: records.at(-1)?.hash ?? genesis, policy: policyValue(policy),
      clockKind: records[0]?.clockKind ?? null } }
}
