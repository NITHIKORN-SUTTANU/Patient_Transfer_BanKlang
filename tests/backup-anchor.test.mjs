import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { readFile, writeFile, unlink, rename } from 'node:fs/promises'
import { temporaryProbeJournal } from './helpers/probe-journal-temp.mjs'
import { initializeBackupRehearsal, runScheduledBackup, createBackupAnchor, readAnchoredBackup, anchoredBackupReadiness } from '../scripts/database/backup-readiness.mjs'
const source = { connectionString: 'postgres://synthetic:PRIVATE_PASSWORD@localhost:54329/postgres', database: `pt_test_${'c'.repeat(32)}` }
const at = ms => new Date(Date.parse('2030-01-01T00:00:00Z') + ms).toISOString()
async function fixture() {
  const temp = await temporaryProbeJournal(), directory = join(dirname(temp.path), 'backups'), encryptionKey = randomBytes(32)
  const options = { directory, source, encryptionKey }
  await initializeBackupRehearsal({ ...options, anchorAt: at(0), clockKind: 'controlled' })
  const tick = async (slot, content = 'synthetic archive') => {
    const time = slot * 3600000, times = [at(time), at(time + 100)]
    return runScheduledBackup({ ...options, at: at(time), clock: () => times.shift(),
      capture: async () => ({ archive: Buffer.from(content), recoveryPointAt: at(time + 10) }) })
  }
  await tick(0)
  const trustedAnchor = await createBackupAnchor(options)
  return { ...temp, ...options, trustedAnchor, tick }
}
async function rejected(f) {
  await assert.rejects(readAnchoredBackup({ ...f, slot: 0 }), { message: 'BACKUP_TRUST_VERIFICATION_FAILED' })
  const report = await anchoredBackupReadiness({ ...f, at: at(101) })
  assert.equal(report.healthy, false); assert.equal(report.trusted, false)
  assert.equal(report.findings[0].code, 'BACKUP_TRUST_VERIFICATION_FAILED')
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false)
}
async function rewrite(path, change) {
  const { hash: oldHash, ...body } = JSON.parse(await readFile(path, 'utf8')); void oldHash
  change(body)
  await writeFile(path, JSON.stringify({ ...body, hash: createHash('sha256').update(JSON.stringify(body)).digest('hex') }))
}

test('independent anchor gates restore and freshness without storing keys or identity', async () => {
  const f = await fixture()
  try {
    assert.equal((await readAnchoredBackup({ ...f, slot: 0 })).archive.toString(), 'synthetic archive')
    const report = await anchoredBackupReadiness({ ...f, at: at(101) })
    assert.equal(report.healthy, true); assert.equal(report.trusted, true)
    assert.equal((await anchoredBackupReadiness({ ...f, at: at(3600011) })).healthy, false)
    assert.equal(JSON.stringify(f.trustedAnchor).includes('PRIVATE'), false)
    assert.equal(JSON.stringify(f.trustedAnchor).includes(f.encryptionKey.toString('hex')), false)
    await rejected({ ...f, trustedAnchor: undefined })
    await rejected({ ...f, trustedAnchor: { ...f.trustedAnchor, sourceHash: '0'.repeat(64) } })
    await rejected({ ...f, encryptionKey: randomBytes(32) })
  } finally { await f.close() }
})

for (const attack of ['archive substitution', 'inventory substitution', 'archive deletion', 'manifest deletion', 'policy downgrade', 'rollback']) {
  test(`trusted inventory rejects ${attack} with local checksums recomputed`, async () => {
    const f = await fixture()
    try {
      const run = join(f.directory, '000000000000'), metadata = join(f.directory, 'metadata.json')
      if (attack === 'archive substitution') {
        // A valid replacement encrypted using the same key/context still differs from the trusted inventory.
        const original = await readFile(join(run, 'archive.dump'))
        await rename(run, join(dirname(f.directory), 'original'))
        await f.tick(0, 'replacement archive')
        assert.notDeepEqual(await readFile(join(run, 'archive.dump')), original)
      } else if (attack === 'inventory substitution') {
        await rewrite(join(run, 'manifest.json'), body => { body.finishedAt = at(99) })
      } else if (attack === 'archive deletion') await unlink(join(run, 'archive.dump'))
      else if (attack === 'manifest deletion') await unlink(join(run, 'manifest.json'))
      else if (attack === 'policy downgrade') {
        await rewrite(metadata, body => { body.protection = 'unencrypted-synthetic-rehearsal' })
        f.encryptionKey = undefined
      } else {
        await f.tick(1)
        f.trustedAnchor = await createBackupAnchor(f)
        // Restore the complete previously valid store state against the latest independent anchor.
        await rename(join(f.directory, '000000000001'), join(dirname(f.directory), 'rolled-back-run'))
      }
      await rejected(f)
    } finally { await f.close() }
  })
}

test('new runs require explicit anchor advancement and old inventories cannot satisfy the new anchor', async () => {
  const f = await fixture()
  try {
    const oldAnchor = f.trustedAnchor
    await f.tick(1)
    await rejected(f)
    f.trustedAnchor = await createBackupAnchor(f)
    assert.notDeepEqual(f.trustedAnchor, oldAnchor)
    assert.equal((await anchoredBackupReadiness({ ...f, at: at(3600101) })).healthy, true)
    assert.equal((await readAnchoredBackup({ ...f, slot: 0 })).archive.toString(), 'synthetic archive')
    assert.equal((await readAnchoredBackup({ ...f, slot: 1 })).archive.toString(), 'synthetic archive')
  } finally { await f.close() }
})
