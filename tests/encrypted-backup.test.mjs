import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { temporaryProbeJournal } from './helpers/probe-journal-temp.mjs'
import { initializeBackupRehearsal, runScheduledBackup, readVerifiedBackup, backupReadiness } from '../scripts/database/backup-readiness.mjs'
import { sealArchive, openArchive } from '../scripts/database/encrypted-archive.mjs'
const source = { connectionString: 'postgres://synthetic:PRIVATE_PASSWORD@localhost:54329/postgres', database: `pt_test_${'b'.repeat(32)}` }
const at = ms => new Date(Date.parse('2030-01-01T00:00:00Z') + ms).toISOString()

test('authenticated archive rejects wrong keys, every envelope region, and changed context', () => {
  const key = randomBytes(32), plain = Buffer.from('synthetic patient backup'), sealed = sealArchive(plain, key, 'context')
  assert.deepEqual(openArchive(sealed, key, 'context'), plain)
  assert.notDeepEqual(sealArchive(plain, key, 'context'), sealed)
  assert.throws(() => openArchive(sealed, randomBytes(32), 'context'), /BACKUP_DECRYPTION_FAILED/)
  assert.throws(() => openArchive(sealed, key, 'other slot'), /BACKUP_DECRYPTION_FAILED/)
  for (const offset of [0, 8, 20, 36, sealed.length - 1]) {
    const altered = Buffer.from(sealed); altered[offset] ^= 1
    assert.throws(() => openArchive(altered, key, 'context'), /BACKUP_DECRYPTION_FAILED/)
  }
})

test('encrypted retained store fails closed and never writes plaintext or key material', async () => {
  const temp = await temporaryProbeJournal(), directory = join(dirname(temp.path), 'encrypted'), encryptionKey = randomBytes(32)
  const plain = Buffer.from('PRIVATE_SYNTHETIC_BACKUP_CONTENT')
  try {
    await initializeBackupRehearsal({ directory, source, anchorAt: at(0), clockKind: 'controlled', encryptionKey })
    const times = [at(0), at(100)]
    await runScheduledBackup({ directory, source, encryptionKey, at: at(0), clock: () => times.shift(), capture: async () => ({ archive: plain, recoveryPointAt: at(10) }) })
    const options = { directory, source, slot: 0, encryptionKey }
    assert.deepEqual((await readVerifiedBackup(options)).archive, plain)
    assert.equal((await backupReadiness({ ...options, at: at(101) })).healthy, true)
    for (const key of [undefined, randomBytes(32)]) {
      await assert.rejects(readVerifiedBackup({ ...options, encryptionKey: key }))
      assert.equal((await backupReadiness({ ...options, encryptionKey: key, at: at(101) })).healthy, false)
    }
    let captured = false
    await assert.rejects(runScheduledBackup({ directory, source, encryptionKey: randomBytes(32), at: at(3600000),
      clock: () => at(3600000), capture: async () => { captured = true } }), /BACKUP_DECRYPTION_FAILED/)
    assert.equal(captured, false)
    for (const path of ['metadata.json', '000000000000/manifest.json', '000000000000/archive.dump']) {
      const bytes = await readFile(join(directory, path))
      assert.equal(bytes.includes(plain), false)
      assert.equal(bytes.includes(encryptionKey), false)
      assert.equal(bytes.includes(Buffer.from('PRIVATE_PASSWORD')), false)
    }
    // Recomputed public checksums cannot bypass authenticated encryption.
    const archivePath = join(directory, '000000000000/archive.dump'), manifestPath = join(directory, '000000000000/manifest.json')
    const altered = await readFile(archivePath); altered[36] ^= 1; await writeFile(archivePath, altered)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.archiveSha256 = createHash('sha256').update(altered).digest('hex')
    const { hash: ignored, ...body } = manifest
    void ignored
    manifest.hash = createHash('sha256').update(JSON.stringify(body)).digest('hex')
    await writeFile(manifestPath, JSON.stringify(manifest))
    await assert.rejects(readVerifiedBackup(options), /BACKUP_DECRYPTION_FAILED/)
    assert.equal((await backupReadiness({ ...options, at: at(101) })).healthy, false)
    assert.deepEqual((await readdir(directory)).sort(), ['000000000000', 'metadata.json'])
  } finally { await temp.close() }
})
