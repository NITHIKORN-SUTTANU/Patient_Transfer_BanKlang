import { test } from 'node:test'
import assert from 'node:assert/strict'
import { open, unlink, readFile, writeFile } from 'node:fs/promises'
import { temporaryProbeJournal } from './helpers/probe-journal-temp.mjs'
import { collectProbe, criticalProbeChecks } from '../scripts/operations/probe-journal.mjs'
import { evaluateProbeAlerts } from '../scripts/operations/probe-alerts.mjs'

const policy = { label: 'provisional-synthetic-v1', cadenceMs: 60000, maxAgeMs: 120000 }
const duty = { label: 'provisional-local-alerts-v1', mode: 'always_for_rehearsal', publishedOpenDates: [] }
const at = ms => new Date(Date.parse('2030-01-14T23:00:00Z') + ms).toISOString()
const healthy = () => ({ state: 'available', failure: null, databaseHealthOk: true,
  checks: criticalProbeChecks.map(name => ({ name, ok: true, failure: null })) })
const failed = (check = 'dispatcher_schedule', code = 'http_503') => ({ state: 'unavailable', failure: { check, code }, databaseHealthOk: true,
  checks: criticalProbeChecks.map(name => ({ name, ok: name !== check, failure: name === check ? code : null })) })
async function sample(journal, start, end, result = healthy()) {
  const times = [at(start), at(end)]
  return collectProbe({ path: journal.path, policy, clock: () => times.shift(), run: async () => result })
}
const evaluate = (journal, ms, previous, selectedDuty = duty) => evaluateProbeAlerts({ path: journal.path, policy, duty: selectedDuty, at: at(ms), previous })

test('failure/repeated evidence/restart/recovery have stable episode and transition identities', async () => {
  const journal = await temporaryProbeJournal()
  try {
    await sample(journal, 0, 1000, failed())
    const first = await evaluate(journal, 1000)
    assert.equal(first.events.length, 1)
    assert.equal(first.events[0].category, 'service_check')
    assert.equal(first.events[0].confirmedServiceOutage, false)
    const repeated = await evaluate(journal, 2000, JSON.parse(JSON.stringify(first.state)))
    assert.equal(repeated.events.length, 0)
    await sample(journal, 10000, 11000, failed('driver_record', 'http_422'))
    const evidence = await evaluate(journal, 11000, repeated.state)
    assert.equal(evidence.events.length, 0)
    assert.equal(evidence.state.active[0].id, first.state.active[0].id)
    const recovery = await sample(journal, 20000, 21000)
    const resolved = await evaluate(journal, 21000, evidence.state)
    assert.equal(resolved.state.active.length, 0)
    assert.equal(resolved.events.length, 1)
    assert.equal(resolved.events[0].transition, 'recovered')
    assert.equal(resolved.events[0].source.hash, recovery.hash)
    assert.equal(resolved.events[0].actor, 'synthetic-evaluator-v1')
    assert.equal((await evaluate(journal, 22000, resolved.state)).events.length, 0)
  } finally { await journal.close() }
})

test('credential/endpoint findings remain separate from service-check evidence', async () => {
  const journal = await temporaryProbeJournal()
  try {
    await sample(journal, 0, 1000, failed('driver_jobs', 'http_401'))
    const denied = await evaluate(journal, 1000)
    assert.deepEqual(denied.state.active.map(row => row.key), ['probe_configuration'])
    await sample(journal, 10000, 11000, failed('line_identity', 'invalid_json'))
    const malformed = await evaluate(journal, 11000, denied.state)
    assert.equal(malformed.events.length, 0)
    await sample(journal, 20000, 21000, failed('line_identity', 'http_503'))
    const provider = await evaluate(journal, 21000, malformed.state)
    assert.deepEqual(provider.state.active.map(row => row.key), ['probe_configuration', 'service_check'])
    assert.ok(provider.events.every(row => row.confirmedServiceOutage === false))
  } finally { await journal.close() }
})

test('unknown, stale and green-health-only records cannot clear an unresolved failure', async () => {
  const journal = await temporaryProbeJournal()
  try {
    await sample(journal, 0, 1000, failed())
    const first = await evaluate(journal, 1000)
    await sample(journal, 10000, 11000, { state: 'available', databaseHealthOk: true, failure: null, checks: [] })
    const unknown = await evaluate(journal, 11000, first.state)
    assert.deepEqual(unknown.state.active.map(row => row.key), ['collector', 'service_check'])
    const stale = await evaluate(journal, 131000, unknown.state)
    assert.deepEqual(stale.state.active.map(row => row.key), ['collector', 'observations', 'service_check'])
    assert.ok(stale.events.every(row => row.transition !== 'recovered'))
    await sample(journal, 140000, 141000)
    const recovered = await evaluate(journal, 141000, stale.state)
    assert.equal(recovered.events.filter(row => row.transition === 'recovered').length, 3)
    assert.equal(recovered.state.active.length, 0)
  } finally { await journal.close() }
})

test('storage failures need a post-failure fresh canary, not merely a readable old journal', async () => {
  const journal = await temporaryProbeJournal()
  try {
    await sample(journal, 0, 1000)
    const lock = await open(`${journal.path}.lock`, 'wx')
    const broken = await evaluate(journal, 2000)
    assert.equal(broken.state.active[0].key, 'journal_access')
    const again = await evaluate(journal, 5000, broken.state)
    assert.equal(again.events.length, 0)
    await lock.close(); await unlink(`${journal.path}.lock`)
    const readable = await evaluate(journal, 6000, again.state)
    assert.equal(readable.events.length, 0)
    assert.equal(readable.state.active.length, 1)
    await sample(journal, 7000, 8000)
    const recovered = await evaluate(journal, 8000, readable.state)
    assert.equal(recovered.events.length, 1)
    assert.equal(recovered.events[0].transition, 'recovered')
  } finally { await journal.close() }
})

test('missed horizons reconcile one gap and one fresh recovery, including when evaluator was offline', async () => {
  const journal = await temporaryProbeJournal()
  try {
    await sample(journal, 0, 1000)
    await sample(journal, 240000, 241000)
    const result = await evaluate(journal, 241000)
    assert.deepEqual(result.events.map(row => [row.category, row.transition]), [['observations', 'opened'], ['observations', 'recovered']])
    assert.equal(result.events[0].occurredAt, at(121000))
    assert.equal(result.state.active.length, 0)
    assert.equal((await evaluate(journal, 242000, result.state)).events.length, 0)
  } finally { await journal.close() }
})

test('published service hours gate new alerts but closing time never clears existing findings', async () => {
  const journal = await temporaryProbeJournal()
  const published = { label: 'provisional-local-alerts-v1', mode: 'published_hours_only', publishedOpenDates: ['2030-01-15'] }
  try {
    await sample(journal, -3600000, -3599000, failed())
    const early = await evaluate(journal, -3599000, null, published)
    assert.equal(early.events.length, 0)
    await sample(journal, 35998000, 35999000, failed()) // 15:59:59 Bangkok
    const open = await evaluate(journal, 35999000, early.state, published)
    assert.ok(open.state.active.some(row => row.key === 'service_check'))
    const closed = await evaluate(journal, 36000000, open.state, published)
    assert.equal(closed.evaluation.inDuty, false)
    assert.equal(closed.events.length, 0)
    assert.equal(closed.state.active.length, open.state.active.length)
    await sample(journal, 36010000, 36011000)
    const recovered = await evaluate(journal, 36011000, closed.state, published)
    assert.equal(recovered.state.active.length, 0, 'Fresh complete recovery may resolve findings outside duty hours')
  } finally { await journal.close() }
})

test('anchored rollback, invalid prior state and future samples cannot silently clear alerts', async () => {
  const journal = await temporaryProbeJournal()
  try {
    const first = await sample(journal, 0, 1000)
    await sample(journal, 10000, 11000, failed())
    const opened = await evaluate(journal, 11000)
    const original = await readFile(journal.path, 'utf8')
    await writeFile(journal.path, `${original.split('\n')[0]}\n`)
    const rollback = await evaluate(journal, 12000, opened.state)
    assert.ok(rollback.state.active.some(row => row.key === 'journal_access'))
    assert.ok(rollback.state.active.some(row => row.key === 'service_check'))
    assert.ok(rollback.events.every(row => row.transition !== 'recovered'))
    await writeFile(journal.path, original)
    const future = await sample(journal, 30000, 31000)
    const clockFinding = await evaluate(journal, 20000, rollback.state)
    assert.ok(clockFinding.state.active.some(row => row.reason === 'future_observation'))
    const caughtUp = await evaluate(journal, 31000, clockFinding.state)
    assert.ok(caughtUp.state.active.some(row => row.key === 'probe_configuration'), 'A formerly future sample cannot clear its own finding')
    await sample(journal, 40000, 41000)
    const fixed = await evaluate(journal, 41000, caughtUp.state)
    assert.equal(fixed.state.active.length, 0)
    await assert.rejects(evaluate(journal, 42000, { ...fixed.state, head: { sequence: 1, hash: first.hash } }))
    assert.notEqual(future.hash, first.hash)
  } finally { await journal.close() }
})

test('missing observations, collector exceptions and policy changes are explicit and sanitized', async () => {
  const journal = await temporaryProbeJournal()
  try {
    const missing = await evaluate(journal, 0)
    assert.equal(missing.events[0].reason, 'observations_missing')
    const times = [at(10000), at(11000)]
    await collectProbe({ path: journal.path, policy, clock: () => times.shift(), run: async () => { throw new Error('PRIVATE_PASSWORD') } })
    const result = await evaluate(journal, 11000, missing.state)
    assert.ok(result.state.active.some(row => row.key === 'collector'))
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
    await assert.rejects(evaluateProbeAlerts({ path: journal.path, policy: { ...policy, maxAgeMs: 180000 }, duty, at: at(12000), previous: result.state }))
    await assert.rejects(evaluate(journal, 1000, result.state))
  } finally { await journal.close() }
})

test('historical backfill cannot lower a future-observation recovery barrier', async () => {
  const journal = await temporaryProbeJournal()
  try {
    await sample(journal, 0, 1000, failed('driver_jobs', 'http_401'))
    await sample(journal, 10000, 11000)
    const first = await evaluate(journal, 500)
    const laterFuture = await evaluate(journal, 2000, first.state)
    assert.equal(laterFuture.state.active[0].evidenceSequence, 2)
    const caughtUp = await evaluate(journal, 11000, laterFuture.state)
    assert.ok(caughtUp.state.active.some(row => row.key === 'probe_configuration'))
    assert.ok(caughtUp.events.every(row => row.transition !== 'recovered'))
    await sample(journal, 12000, 13000)
    assert.equal((await evaluate(journal, 13000, caughtUp.state)).state.active.length, 0)
  } finally { await journal.close() }
})
