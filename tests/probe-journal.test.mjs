import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, open, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { temporaryProbeJournal } from './helpers/probe-journal-temp.mjs'
import { collectProbe, appendProbeSample, readProbeJournal, replayProbeJournal, criticalProbeChecks } from '../scripts/operations/probe-journal.mjs'

const policy = { label: 'provisional-synthetic-v1', cadenceMs: 60000, maxAgeMs: 120000 }
const point = value => `2030-01-14T23:${value}.000Z`
const healthy = () => ({ state: 'available', databaseHealthOk: true, failure: null,
  checks: criticalProbeChecks.map(name => ({ name, ok: true, failure: null })) })
const failed = () => ({ state: 'unavailable', databaseHealthOk: true, failure: { check: 'dispatcher_schedule', code: 'http_503' },
  checks: criticalProbeChecks.map(name => ({ name, ok: name !== 'dispatcher_schedule', failure: name === 'dispatcher_schedule' ? 'http_503' : null })) })
const window = { month: '2030-01', calendarLabel: 'Controlled synthetic journal test', publishedOpenDates: ['2030-01-15'],
  observationStart: point('00:00'), observationEnd: point('07:30') }
async function sample(path, start, end, result = healthy()) {
  const times = [start, end]
  return collectProbe({ path, policy, clock: () => times.shift(), run: async () => result })
}

test('collector persists sanitized chained records, idempotent append and restart replay', async () => {
  const journal = await temporaryProbeJournal()
  try {
    const first = await sample(journal.path, point('00:00'), point('00:10'), { ...healthy(), token: 'PRIVATE_TOKEN', body: 'PRIVATE_PATIENT' })
    const prefix = await readFile(journal.path, 'utf8')
    const second = await sample(journal.path, point('01:00'), point('01:05'), failed())
    assert.ok((await readFile(journal.path, 'utf8')).startsWith(prefix))
    const { version, sequence, previousHash, hash, ...same } = first
    assert.equal(version, 1); assert.equal(sequence, 1); assert.equal(previousHash.length, 64)
    assert.deepEqual(await appendProbeSample(journal.path, same), first)
    assert.equal((await readProbeJournal(journal.path)).length, 2)
    assert.equal(second.previousHash, hash)
    assert.equal((await readFile(journal.path, 'utf8')).includes('PRIVATE'), false)
    const restarted = await readProbeJournal(journal.path, { expectedHead: { sequence: second.sequence, hash: second.hash } })
    assert.deepEqual(restarted, [first, second])
  } finally { await journal.close() }
})

test('missed cadence, in-flight probes, failure/recovery and stale tail produce explicit unknown gaps', async () => {
  const journal = await temporaryProbeJournal()
  try {
    await sample(journal.path, point('00:00'), point('00:10'))
    await sample(journal.path, point('01:00'), point('01:05'), failed())
    await sample(journal.path, point('05:00'), point('05:10'))
    const report = await replayProbeJournal({ path: journal.path, policy, ...window })
    assert.equal(report.windowServiceMinutes, 7.5)
    assert.equal(report.availableMinutes * 60000, 170000)
    assert.equal(report.unavailableMinutes * 60000, 120000)
    assert.equal(report.unknownMinutes * 60000, 160000)
    assert.equal(report.availabilityPercent, null)
    assert.equal(report.monthlyTargetMet, null)
    assert.equal(report.provenance.clockKind, 'controlled')
    assert.deepEqual(report.intervals.at(-1), { start: point('07:10'), end: point('07:30'), state: 'unknown' })
  } finally { await journal.close() }
})

test('incomplete/contradictory probes and unexpected errors cannot become successful samples or leak errors', async () => {
  const journal = await temporaryProbeJournal()
  try {
    await sample(journal.path, point('00:00'), point('00:01'), { state: 'available', databaseHealthOk: true, failure: null, checks: [] })
    const duplicate = healthy(); duplicate.checks.push({ name: criticalProbeChecks[0], ok: false, failure: 'http_500' })
    await sample(journal.path, point('01:00'), point('01:01'), duplicate)
    const times = [point('02:00'), point('02:01')]
    await collectProbe({ path: journal.path, policy, clock: () => times.shift(), run: async () => { throw new Error('PRIVATE_CREDENTIAL') } })
    const rows = await readProbeJournal(journal.path)
    assert.ok(rows.every(row => row.state === 'unknown'))
    assert.equal(rows.at(-1).failure.code, 'collector_error')
    assert.equal((await readFile(journal.path, 'utf8')).includes('PRIVATE'), false)
  } finally { await journal.close() }
})

test('identity, chronology, overlapping probes and policy changes are refused without modifying prior bytes', async () => {
  const journal = await temporaryProbeJournal()
  try {
    const row = await sample(journal.path, point('00:00'), point('00:10'))
    const value = Object.fromEntries(Object.entries(row).filter(([key]) => !['version', 'sequence', 'previousHash', 'hash'].includes(key)))
    const before = await readFile(journal.path, 'utf8')
    for (const change of [{ state: 'unavailable', failure: failed().failure },
      { id: randomUUID(), observedAt: point('01:00'), finishedAt: point('01:10'), state: 'unavailable', failure: { check: 'database_health', code: 'http_500' } },
      { id: randomUUID(), observedAt: point('00:05') },
      { id: randomUUID(), observedAt: point('01:00'), finishedAt: point('01:10'), policy: { ...policy, maxAgeMs: 180000 } },
      { id: randomUUID(), observedAt: point('01:00'), finishedAt: point('01:10'), clockKind: 'system' }]) {
      await assert.rejects(appendProbeSample(journal.path, { ...value, ...change }))
      assert.equal(await readFile(journal.path, 'utf8'), before)
    }
    const times = [point('02:00'), point('01:00')]
    await assert.rejects(collectProbe({ path: journal.path, policy, clock: () => times.shift(), run: async () => healthy() }))
    assert.equal(await readFile(journal.path, 'utf8'), before)
  } finally { await journal.close() }
})

test('busy/crash lock, corrupt/truncated records and altered tails fail closed without automatic repair', async () => {
  const journal = await temporaryProbeJournal()
  try {
    await sample(journal.path, point('00:00'), point('00:10'))
    const second = await sample(journal.path, point('01:00'), point('01:10'))
    const original = await readFile(journal.path, 'utf8')
    const lock = await open(`${journal.path}.lock`, 'wx')
    await assert.rejects(readProbeJournal(journal.path), /locked/)
    await lock.close(); await unlink(`${journal.path}.lock`)
    const mutated = original.replace('"state":"available"', '"state":"unknown"')
    for (const bad of [mutated, original.replace('"databaseHealthOk":true', '"databaseHealthOk":false'),
      `${original}{"partial":`, `${original.trimEnd().split('\n').reverse().join('\n')}\n`]) {
      await writeFile(journal.path, bad)
      await assert.rejects(readProbeJournal(journal.path))
      assert.equal(await readFile(journal.path, 'utf8'), bad)
    }
    // A hash chain alone cannot detect deletion of complete tail records without an external head anchor.
    await writeFile(journal.path, `${original.split('\n')[0]}\n`)
    assert.equal((await readProbeJournal(journal.path)).length, 1)
    await assert.rejects(readProbeJournal(journal.path, { expectedHead: { sequence: second.sequence, hash: second.hash } }), /anchor/)
  } finally { await journal.close() }
})

test('concurrent writers fail closed and an empty journal yields unknown service time', async () => {
  const journal = await temporaryProbeJournal()
  try {
    const empty = await replayProbeJournal({ path: journal.path, policy, ...window })
    assert.equal(empty.unknownMinutes, 7.5)
    const attempts = await Promise.allSettled([
      sample(journal.path, point('00:00'), point('00:10')),
      sample(journal.path, point('01:00'), point('01:10')),
    ])
    assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1)
    assert.equal((await readProbeJournal(journal.path)).length, 1)
  } finally { await journal.close() }
})
