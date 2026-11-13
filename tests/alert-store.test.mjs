import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { readFile, writeFile, readdir, unlink, open } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { temporaryProbeJournal } from './helpers/probe-journal-temp.mjs'
import { collectProbe, criticalProbeChecks } from '../scripts/operations/probe-journal.mjs'
import { initializeAlertStore, readAlertStore, recoverAlertStore, evaluateAndPersistAlerts } from '../scripts/operations/alert-store.mjs'

const policy = { label: 'provisional-synthetic-v1', cadenceMs: 60000, maxAgeMs: 120000 }
const duty = { label: 'provisional-local-alerts-v1', mode: 'always_for_rehearsal', publishedOpenDates: [] }
const at = ms => new Date(Date.parse('2030-01-14T23:00:00Z') + ms).toISOString()
const healthy = () => ({ state: 'available', databaseHealthOk: true, failure: null,
  checks: criticalProbeChecks.map(name => ({ name, ok: true, failure: null })) })
const failed = () => ({ state: 'unavailable', databaseHealthOk: true, failure: { check: 'dispatcher_schedule', code: 'http_503' },
  checks: criticalProbeChecks.map(name => ({ name, ok: name !== 'dispatcher_schedule', failure: name === 'dispatcher_schedule' ? 'http_503' : null })) })
async function fixture() {
  const temp = await temporaryProbeJournal(), directory = join(dirname(temp.path), 'alerts')
  await initializeAlertStore({ directory })
  return { ...temp, directory }
}
async function sample(f, start, finish, result = failed()) {
  const times = [at(start), at(finish)]
  return collectProbe({ path: f.path, policy, clock: () => times.shift(), run: async () => result })
}
const evaluate = (f, time, extra = {}) => evaluateAndPersistAlerts({ directory: f.directory, path: f.path, policy, duty, at: at(time), ...extra })

test('committed alert history/checkpoint survive restart and deduplicate repeated evidence and recovery', async () => {
  const f = await fixture()
  try {
    const record = await sample(f, 0, 1000, { ...failed(), token: 'PRIVATE_CREDENTIAL' })
    const opened = await evaluate(f, 1000)
    assert.equal(opened.newEvents.length, 1)
    const restart = await readAlertStore({ directory: f.directory, expectedHead: opened.head })
    assert.equal(restart.state.active.length, 1)
    assert.equal(restart.state.head.hash, record.hash)
    assert.equal(restart.checkpointStatus, 'current')
    const same = await evaluate(f, 1000)
    assert.equal(same.committed, false)
    await sample(f, 10000, 11000)
    const repeated = await evaluate(f, 11000)
    assert.equal(repeated.newEvents.length, 0)
    assert.equal(repeated.state.active[0].id, opened.state.active[0].id)
    await sample(f, 20000, 21000, healthy())
    const recovered = await evaluate(f, 21000)
    assert.equal(recovered.newEvents[0].transition, 'recovered')
    assert.equal(recovered.events.length, 2)
    assert.equal(recovered.state.active.length, 0)
    assert.equal((await evaluate(f, 21000)).newEvents.length, 0)
    for (const name of await readdir(f.directory)) if (name.endsWith('.json')) {
      assert.equal((await readFile(join(f.directory, name), 'utf8')).includes('PRIVATE'), false)
    }
  } finally { await f.close() }
})

test('interruption boundaries preserve one committed history and recover derived checkpoint safely', async t => {
  for (const stage of ['after_commit_stage', 'after_commit_publish', 'before_checkpoint_replace', 'after_checkpoint_replace']) {
    await t.test(stage, async () => {
      const f = await fixture()
      try {
        await sample(f, 0, 1000); await evaluate(f, 1000)
        await sample(f, 10000, 11000, healthy())
        await assert.rejects(evaluate(f, 11000, { fault: point => { if (point === stage) throw new Error('Injected interruption') } }), /interruption/)
        const published = stage !== 'after_commit_stage'
        const observed = await readAlertStore({ directory: f.directory })
        assert.equal(observed.events.length, published ? 2 : 1)
        assert.equal(observed.state.active.length, published ? 0 : 1)
        assert.equal(observed.checkpointStatus, ['after_commit_publish', 'before_checkpoint_replace'].includes(stage) ? 'stale' : 'current')
        if (stage !== 'after_checkpoint_replace') assert.ok(observed.stagingArtifacts > 0)
        const repaired = await recoverAlertStore({ directory: f.directory, expectedHead: observed.head })
        assert.equal(repaired.checkpointStatus, 'current')
        assert.equal(repaired.checkpointRebuilt, observed.checkpointStatus !== 'current')
        await evaluate(f, 11000)
        const final = await readAlertStore({ directory: f.directory })
        assert.equal(final.head.sequence, 2)
        assert.equal(final.events.length, 2)
        assert.equal(new Set(final.events.map(row => row.id)).size, 2)
        assert.equal(final.state.active.length, 0)
        assert.equal((await evaluate(f, 11000)).committed, false)
      } finally { await f.close() }
    })
  }
})

test('missing derived cache is rebuilt while contradictory cache, initialization and published corruption fail closed', async () => {
  const f = await fixture()
  try {
    await assert.rejects(initializeAlertStore({ directory: f.directory }))
    await assert.rejects(readAlertStore({ directory: join(f.directory, 'missing') }))
    await sample(f, 0, 1000); await evaluate(f, 1000)
    const cachePath = join(f.directory, 'checkpoint.json'), commitPath = join(f.directory, '000000000001.commit.json')
    const goodCache = await readFile(cachePath, 'utf8'), goodCommit = await readFile(commitPath, 'utf8')
    await unlink(cachePath)
    assert.equal((await readAlertStore({ directory: f.directory })).checkpointStatus, 'missing')
    assert.equal((await recoverAlertStore({ directory: f.directory })).state.active.length, 1)
    for (const [path, bytes, restore] of [[cachePath, goodCache.replace('"eventCount":1', '"eventCount":9'), goodCache],
      [commitPath, goodCommit.slice(0, -20), goodCommit]]) {
      await writeFile(path, bytes)
      await assert.rejects(readAlertStore({ directory: f.directory }))
      await assert.rejects(evaluate(f, 2000))
      assert.equal(await readFile(path, 'utf8'), bytes)
      await writeFile(path, restore)
    }
    await unlink(commitPath)
    await assert.rejects(recoverAlertStore({ directory: f.directory }), /cache/)
  } finally { await f.close() }
})

test('probe-prefix rollback preserves active findings until a new verified recovery', async () => {
  const f = await fixture()
  try {
    await sample(f, 0, 1000); await evaluate(f, 1000)
    await sample(f, 10000, 11000); await evaluate(f, 11000)
    const bytes = await readFile(f.path, 'utf8')
    await writeFile(f.path, `${bytes.split('\n')[0]}\n`)
    const conflict = await evaluate(f, 12000)
    assert.ok(conflict.state.active.some(row => row.key === 'journal_access'))
    assert.ok(conflict.state.active.some(row => row.key === 'service_check'))
    await writeFile(f.path, bytes)
    assert.equal((await evaluate(f, 13000)).newEvents.length, 0)
    await sample(f, 14000, 15000, healthy())
    const recovered = await evaluate(f, 15000)
    assert.equal(recovered.state.active.length, 0)
    assert.equal(recovered.events.filter(row => row.transition === 'recovered').length, 2)
  } finally { await f.close() }
})

test('store rollback anchors, generation gaps, foreign artifacts and changed policies never reset history', async () => {
  const f = await fixture()
  try {
    await sample(f, 0, 1000); const first = await evaluate(f, 1000)
    await sample(f, 10000, 11000); const second = await evaluate(f, 11000)
    await assert.rejects(readAlertStore({ directory: f.directory, expectedHead: first.head }))
    await assert.rejects(evaluate(f, 12000, { policy: { ...policy, maxAgeMs: 180000 } }))
    await assert.rejects(evaluate(f, 1000))
    const foreign = join(f.directory, 'preserve-this.txt')
    await writeFile(foreign, 'Owned test artifact')
    await assert.rejects(readAlertStore({ directory: f.directory }), /artifact/)
    assert.equal(await readFile(foreign, 'utf8'), 'Owned test artifact')
    await unlink(foreign)
    await unlink(join(f.directory, '000000000001.commit.json'))
    await assert.rejects(readAlertStore({ directory: f.directory }), /gap/)
    assert.equal(second.events.length, 1)
  } finally { await f.close() }
})

test('cooperating writers and stale locks cannot duplicate committed transitions', async () => {
  const f = await fixture()
  try {
    await sample(f, 0, 1000)
    const lock = await open(join(f.directory, '.writer.lock'), 'wx')
    await assert.rejects(evaluate(f, 1000), /locked/)
    await lock.close(); await unlink(join(f.directory, '.writer.lock'))
    const attempts = await Promise.allSettled([evaluate(f, 1000), evaluate(f, 1000)])
    assert.equal(attempts.filter(row => row.status === 'fulfilled' && row.value.committed).length, 1)
    const stored = await readAlertStore({ directory: f.directory })
    assert.equal(stored.head.sequence, 1)
    assert.equal(stored.events.length, 1)
    assert.equal((await recoverAlertStore({ directory: f.directory })).checkpointRebuilt, false)
  } finally { await f.close() }
})

test('abrupt child-process exit preserves the committed transition and requires explicit stale-lock reconciliation', async () => {
  const f = await fixture()
  try {
    await sample(f, 0, 1000); await evaluate(f, 1000)
    await sample(f, 10000, 11000, healthy())
    const moduleUrl = new URL('../scripts/operations/alert-store.mjs', import.meta.url).href
    const source = `import { evaluateAndPersistAlerts } from ${JSON.stringify(moduleUrl)};
      let input=''; for await (const chunk of process.stdin) input+=chunk;
      await evaluateAndPersistAlerts({...JSON.parse(input),fault:stage=>{if(stage==='after_commit_publish')process.exit(73)}});`
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] })
    const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
    child.stdin.end(JSON.stringify({ directory: f.directory, path: f.path, policy, duty, at: at(11000) }))
    assert.equal(await exited, 73)
    await assert.rejects(readAlertStore({ directory: f.directory }), /locked/)
    // Test-owner reconciliation only after the exact writer process is confirmed exited.
    await unlink(join(f.directory, '.writer.lock'))
    const persisted = await readAlertStore({ directory: f.directory })
    assert.equal(persisted.events.length, 2)
    assert.equal(persisted.state.active.length, 0)
    assert.equal(persisted.checkpointStatus, 'stale')
    await recoverAlertStore({ directory: f.directory, expectedHead: persisted.head })
    assert.equal((await evaluate(f, 11000)).committed, false)
    assert.equal((await readAlertStore({ directory: f.directory })).events.length, 2)
  } finally { await f.close() }
})
