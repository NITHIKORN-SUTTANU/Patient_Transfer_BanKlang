import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { writeFile, readdir, rename } from 'node:fs/promises'
import { temporaryProbeJournal } from './helpers/probe-journal-temp.mjs'
import { initializeTrustStore, advanceTrustAnchor, readTrustHead } from '../scripts/database/trust-anchor-store.mjs'
import { initializeBackupRehearsal, runScheduledBackup, createBackupAnchor, readAnchoredBackup } from '../scripts/database/backup-readiness.mjs'
const source = { connectionString: 'postgres://synthetic:PRIVATE_PASSWORD@localhost:54329/postgres', database: `pt_test_${'d'.repeat(32)}` }
const at = ms => new Date(Date.parse('2030-01-01T00:00:00Z') + ms).toISOString()
async function fixture() {
  const temp = await temporaryProbeJournal(), root = dirname(temp.path), backupDirectory = join(root, 'backups'), directory = join(root, 'trust')
  const backup = { directory: backupDirectory, source, encryptionKey: randomBytes(32) }, trust = { directory, backupDirectory }
  await initializeBackupRehearsal({ ...backup, anchorAt: at(0), clockKind: 'controlled' })
  await initializeTrustStore(trust)
  const tick = async slot => {
    const base = slot * 3600000, times = [at(base), at(base + 100)]
    await runScheduledBackup({ ...backup, at: at(base), clock: () => times.shift(),
      capture: async () => ({ archive: Buffer.from('synthetic retained backup'), recoveryPointAt: at(base + 10) }) })
    return createBackupAnchor(backup)
  }
  return { ...temp, root, backup, trust, tick }
}
const advance = (f, expectedHead, nextAnchor, extra = {}) => advanceTrustAnchor({ ...f.trust, expectedHead, nextAnchor, operationId: randomUUID(), ...extra })

test('separate persisted anchor is reloaded for restore; advancement preserves prior records', async () => {
  const f = await fixture()
  try {
    assert.equal(await readTrustHead(f.trust), null)
    const first = await advance(f, null, await f.tick(0))
    assert.equal(first.head.revision, 1)
    assert.deepEqual(await readTrustHead({ ...f.trust, expectedHead: first.head }), first.head)
    const read = await readAnchoredBackup({ ...f.backup, trustedAnchor: (await readTrustHead(f.trust)).anchor, slot: 0 })
    assert.equal(read.archive.toString(), 'synthetic retained backup')
    const next = await advance(f, first.head, await f.tick(1))
    assert.equal(next.head.revision, 2)
    await assert.rejects(readTrustHead({ ...f.trust, expectedHead: first.head }), /TRUST_HEAD_CONFLICT/)
    assert.deepEqual((await readdir(f.trust.directory)).sort(), ['000001.json', '000002.json'])
    const bytes = JSON.stringify(await readTrustHead(f.trust))
    assert.equal(bytes.includes('PRIVATE'), false)
    assert.equal(bytes.includes(f.backup.encryptionKey.toString('hex')), false)
    await assert.rejects(initializeTrustStore(f.trust), /TRUST_STORE_INITIALIZATION_FAILED/)
    assert.deepEqual(await readTrustHead(f.trust), next.head)
  } finally { await f.close() }
})

test('concurrent same-head writers cannot both publish; stale and rollback updates fail', async () => {
  const f = await fixture()
  try {
    const first = await advance(f, null, await f.tick(0)), nextAnchor = await f.tick(1)
    const results = await Promise.allSettled([advance(f, first.head, nextAnchor), advance(f, first.head, nextAnchor)])
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1)
    assert.equal((await readTrustHead(f.trust)).revision, 2)
    await assert.rejects(advance(f, first.head, nextAnchor), /TRUST_HEAD_CONFLICT/)
    await assert.rejects(advance(f, await readTrustHead(f.trust), first.head.anchor), /TRUST_UPDATE_INVALID/)
  } finally { await f.close() }
})

test('lost publication response reconciles idempotently; request collisions cannot rewrite history', async () => {
  const f = await fixture()
  try {
    const nextAnchor = await f.tick(0), operationId = randomUUID()
    await assert.rejects(advance(f, null, nextAnchor, { operationId, fault: point => { if (point === 'after_publish') throw Error('PRIVATE_FAULT') } }), { message: 'TRUST_PUBLICATION_UNCERTAIN' })
    const head = await readTrustHead(f.trust)
    const replay = await advance(f, null, nextAnchor, { operationId })
    assert.equal(replay.replayed, true); assert.equal(replay.committed, false)
    assert.deepEqual(replay.head, head)
    const laterAnchor = await f.tick(1)
    await assert.rejects(advance(f, null, laterAnchor, { operationId }), /TRUST_OPERATION_CONFLICT/)
    await advance(f, head, laterAnchor)
    await assert.rejects(advance(f, null, nextAnchor, { operationId }), /TRUST_HEAD_CONFLICT/)
    assert.equal((await readTrustHead(f.trust)).revision, 2)
  } finally { await f.close() }
})

test('pre-publication interruption leaves evidence and blocks automatic repair or replacement', async () => {
  const f = await fixture()
  try {
    const first = await advance(f, null, await f.tick(0)), nextAnchor = await f.tick(1)
    await assert.rejects(advance(f, first.head, nextAnchor, { fault: () => { throw Error('PRIVATE_FAULT') } }), { message: 'TRUST_PUBLICATION_UNCERTAIN' })
    await assert.rejects(readTrustHead(f.trust), /TRUST_STORE_UNVERIFIED/)
    await assert.rejects(advance(f, first.head, nextAnchor), /TRUST_STORE_UNVERIFIED/)
    assert.equal((await readdir(f.trust.directory)).filter(file => file.startsWith('stage-')).length, 1)
  } finally { await f.close() }
})

test('corruption, missing records, trust-store rollback and stale locks fail closed', async () => {
  for (const fault of ['corrupt', 'missing', 'rollback', 'lock']) {
    const f = await fixture()
    try {
      const first = await advance(f, null, await f.tick(0)), second = await advance(f, first.head, await f.tick(1))
      if (fault === 'corrupt') await writeFile(join(f.trust.directory, '000002.json'), '{PRIVATE_BROKEN')
      else if (fault === 'lock') await writeFile(join(f.trust.directory, '.trust.lock'), '')
      else await rename(join(f.trust.directory, fault === 'missing' ? '000001.json' : '000002.json'), join(f.root, 'removed-record'))
      await assert.rejects(readTrustHead({ ...f.trust, expectedHead: second.head }), /TRUST_STORE_UNVERIFIED|TRUST_HEAD_CONFLICT/)
    } finally { await f.close() }
  }
})

test('trust storage rejects overlapping paths and updates with missing or cross-source expectations', async () => {
  const f = await fixture()
  try {
    await assert.rejects(readTrustHead({ directory: f.trust.backupDirectory, backupDirectory: f.trust.backupDirectory }), /TRUST_STORE_UNVERIFIED/)
    const nextAnchor = await f.tick(0)
    await assert.rejects(advance(f, undefined, nextAnchor), /TRUST_UPDATE_INVALID/)
    const head = (await advance(f, null, nextAnchor)).head
    await assert.rejects(advance(f, head, { ...nextAnchor, sourceHash: '0'.repeat(64), inventorySha256: '1'.repeat(64) }), /TRUST_UPDATE_INVALID/)
  } finally { await f.close() }
})
