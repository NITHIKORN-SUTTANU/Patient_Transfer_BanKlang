import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { readFile, writeFile, unlink, open, readdir } from 'node:fs/promises'
import { temporaryProbeJournal } from './helpers/probe-journal-temp.mjs'
import { initializeBackupRehearsal, runScheduledBackup, backupReadiness, readVerifiedBackup, backupHourMs, postgresBackupCapture } from '../scripts/database/backup-readiness.mjs'

const source = { connectionString: 'postgres://synthetic:PRIVATE_PASSWORD@localhost:54329/postgres', database: `pt_test_${'a'.repeat(32)}` }
const at = ms => new Date(Date.parse('2030-01-01T00:00:00Z') + ms).toISOString()
async function fixture() {
  const temp = await temporaryProbeJournal(), directory = join(dirname(temp.path), 'backups')
  await initializeBackupRehearsal({ directory, source, anchorAt: at(0), clockKind: 'controlled' })
  return { ...temp, directory }
}
const tick = (f, time, options = {}) => {
  const times = [at(time), at(time + 100)]
  return runScheduledBackup({ directory: f.directory, source, at: at(time), clock: () => times.shift(),
    capture: async () => ({ archive: Buffer.from('synthetic archive only'), recoveryPointAt: at(time + 10) }), ...options })
}
const status = (f, time) => backupReadiness({ directory: f.directory, source, at: at(time) })

test('hourly slots are idempotent and freshness uses recovery-point time, not job completion', async () => {
  const f = await fixture()
  try {
    assert.ok((await status(f, 0)).findings.some(row => row.code === 'NO_RECOVERY_POINT'))
    const first = await tick(f, 0)
    assert.equal(first.manifest.status, 'SUCCESS')
    assert.equal((await tick(f, 1000, { capture: async () => { throw new Error('Must not run') } })).committed, false)
    const exact = await status(f, backupHourMs + 10)
    assert.equal(exact.recoveryPointAgeMs, backupHourMs)
    assert.equal(exact.findings.some(row => row.code === 'STALE_RECOVERY_POINT'), false)
    assert.ok((await status(f, backupHourMs + 11)).findings.some(row => row.code === 'STALE_RECOVERY_POINT'))
    assert.ok(exact.findings.some(row => row.code === 'MISSED_SCHEDULE'))
    const second = await tick(f, backupHourMs + 1000)
    assert.equal(second.manifest.slot, 1)
    assert.equal((await status(f, backupHourMs + 1100)).healthy, true)
    const verified = await readVerifiedBackup({ directory: f.directory, source, slot: 0 })
    assert.equal(verified.archive.toString(), 'synthetic archive only')
    assert.equal(first.manifest.hash, verified.manifest.hash)
  } finally { await f.close() }
})

test('missed slots stay visible without fabricated catch-up recovery points', async () => {
  const f = await fixture()
  try {
    await tick(f, 0)
    const missing = await status(f, 2 * backupHourMs + 1)
    assert.deepEqual(missing.missedSlots, [1, 2])
    await tick(f, 2 * backupHourMs + 1000)
    const recovered = await status(f, 2 * backupHourMs + 1100)
    assert.equal(recovered.healthy, true)
    assert.deepEqual(recovered.missedSlots, [1])
    assert.equal((await readdir(f.directory)).includes('000000000001'), false)
    assert.equal(recovered.successfulRuns, 2)
  } finally { await f.close() }
})

test('capture failure is sanitized/persisted and later verified success retains all history', async () => {
  const f = await fixture()
  try {
    await tick(f, 0)
    const failure = await tick(f, backupHourMs, { capture: async () => { throw new Error('PRIVATE_PROVIDER_CREDENTIAL') } })
    assert.equal(failure.manifest.status, 'FAILED')
    const failed = await status(f, backupHourMs + 100)
    assert.ok(failed.findings.some(row => row.code === 'LAST_RUN_FAILED'))
    assert.equal(failed.latestRecoveryPointAt, at(10))
    const ids = failed.findings.map(row => row.id)
    assert.deepEqual((await status(f, backupHourMs + 101)).findings.map(row => row.id), ids)
    const bytes = await readFile(join(f.directory, '000000000001', 'manifest.json'), 'utf8')
    assert.equal(bytes.includes('PRIVATE'), false)
    assert.equal((await readFile(join(f.directory, 'metadata.json'), 'utf8')).includes('PRIVATE'), false)
    await tick(f, 2 * backupHourMs)
    const recovered = await status(f, 2 * backupHourMs + 100)
    assert.equal(recovered.healthy, true)
    assert.equal(recovered.failedRuns, 1)
    assert.equal(await readFile(join(f.directory, '000000000001', 'manifest.json'), 'utf8'), bytes)
  } finally { await f.close() }
})

test('storage interruption never publishes partial success; committed lost responses are idempotent', async () => {
  for (const stage of ['after_archive_write', 'before_publish', 'after_publish']) {
    const f = await fixture()
    try {
      await tick(f, 0)
      await assert.rejects(tick(f, backupHourMs, { fault: point => { if (point === stage) throw new Error('storage outage') } }), /STORAGE/)
      const report = await status(f, backupHourMs + 100)
      if (stage === 'after_publish') {
        assert.equal(report.healthy, true)
        assert.equal((await tick(f, backupHourMs + 1000)).committed, false)
      } else {
        assert.equal(report.healthy, false)
        assert.equal(report.latestRecoveryPointAt, at(10))
        assert.ok(report.findings.some(row => row.code === 'UNPUBLISHED_ARTIFACTS'))
      }
    } finally { await f.close() }
  }
})

test('missing/corrupt archives, tampered metadata and storage locks never report healthy backup', async () => {
  const f = await fixture()
  try {
    await tick(f, 0)
    const path = join(f.directory, '000000000000', 'archive.dump')
    await writeFile(path, 'corrupt')
    const bad = await status(f, 100)
    assert.ok(bad.findings.some(row => row.code === 'ARCHIVE_UNVERIFIED'))
    await assert.rejects(readVerifiedBackup({ directory: f.directory, source, slot: 0 }), /UNVERIFIED/)
    await assert.rejects(tick(f, 1000), /UNVERIFIED/)
    await unlink(path)
    assert.equal((await status(f, 100)).healthy, false)
    const lock = await open(join(f.directory, '.backup.lock'), 'wx')
    assert.equal((await status(f, 100)).findings[0].code, 'STORE_UNAVAILABLE')
    await lock.close(); await unlink(join(f.directory, '.backup.lock'))
    const metadataPath = join(f.directory, 'metadata.json')
    await writeFile(metadataPath, '{}')
    assert.equal((await status(f, 100)).findings[0].code, 'STORE_UNAVAILABLE')
  } finally { await f.close() }
})

test('invalid capture clocks/source targets and backward run clocks cannot create a recovery point', async () => {
  const f = await fixture()
  try {
    const bad = await tick(f, 0, { capture: async () => ({ archive: Buffer.from('synthetic'), recoveryPointAt: at(101) }) })
    assert.equal(bad.manifest.failureCode, 'INVALID_CAPTURE')
    assert.equal((await status(f, 100)).latestRecoveryPointAt, null)
    const times = [at(backupHourMs), at(backupHourMs - 1)]
    await assert.rejects(tick(f, backupHourMs, { clock: () => times.shift() }), /backwards/)
    for (const invalid of [{ ...source, database: 'patient_transfer' }, { ...source, connectionString: 'postgres://user@remote:54329/postgres' },
      { ...source, connectionString: 'PRIVATE_PASSWORD_not_a_url' }]) {
      await assert.rejects(initializeBackupRehearsal({ directory: join(dirname(f.path), 'invalid'), source: invalid, anchorAt: at(0) }),
        error => !error.message.includes('PRIVATE') && !JSON.stringify(error).includes('PRIVATE'))
    }
    assert.ok((await status(f, 99)).findings.some(row => row.code === 'CLOCK_CONFLICT'))
  } finally { await f.close() }
})

test('on-disk staging corruption is rejected before success publication', async () => {
  const f = await fixture()
  try {
    await assert.rejects(tick(f, 0, { fault: async point => {
      if (point === 'before_publish') {
        const stage = (await readdir(f.directory)).find(name => name.startsWith('stage-'))
        await writeFile(join(f.directory, stage, 'archive.dump'), 'corrupt before publication')
      }
    } }), /STORAGE/)
    assert.equal((await status(f, 100)).successfulRuns, 0)
    assert.equal((await readdir(f.directory)).includes('000000000000'), false)
  } finally { await f.close() }
})

test('capture refuses a mismatched pool database and releases even when rollback fails', async () => {
  let released = false
  const capture = postgresBackupCapture({ source, pool: { async connect() {
    return { async query(sql) {
      if (sql === 'ROLLBACK') throw new Error('Synthetic connection loss')
      return { rows: [{ name: 'patient_transfer' }] }
    }, release() { released = true } }
  } } })
  await assert.rejects(capture())
  assert.equal(released, true)
})
