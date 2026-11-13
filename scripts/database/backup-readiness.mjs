import { mkdir, open, readFile, readdir, stat, rename, unlink } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { sealArchive, openArchive, validateArchiveKey } from './encrypted-archive.mjs'
import { recoveryTarget, postgresArchive } from './recovery.mjs'

export const backupHourMs = 3600000
const archiveLimit = 64 * 1024 * 1024
const hash = value => createHash('sha256').update(value).digest('hex')
const digest = value => hash(JSON.stringify(value))
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === allowed.length && allowed.every(key => Object.hasOwn(value, key))
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Canonical backup timestamp required')
  return Date.parse(value)
}
function sourceKey(source) {
  try { recoveryTarget(source.connectionString, source.database) }
  catch { throw new Error('Backup rehearsal requires a generated local test database; check private source configuration') }
  return hash(source.database)
}
const runName = slot => String(slot).padStart(12, '0')
async function locked(directory, work) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('Explicit absolute synthetic backup directory required')
  let lock
  try { lock = await open(join(directory, '.backup.lock'), 'wx', 0o600) }
  catch { throw new Error('BACKUP_STORE_UNAVAILABLE') }
  try { return await work() } finally { await lock.close(); await unlink(join(directory, '.backup.lock')) }
}
async function writeSynced(path, value) {
  const file = await open(path, 'wx', 0o600)
  try { await file.writeFile(value); await file.sync() } finally { await file.close() }
}
async function json(path) {
  if ((await stat(path)).size > 65536) throw new Error('Invalid backup metadata size')
  return JSON.parse(await readFile(path, 'utf8'))
}
async function load(directory, source) {
  const sourceHash = sourceKey(source), metadata = await json(join(directory, 'metadata.json'))
  if (!keys(metadata, ['version', 'scope', 'sourceHash', 'anchorAt', 'clockKind', 'intervalMs', 'maxAgeMs', 'protection', 'hash'])) throw new Error('Invalid backup store')
  const { hash: checksum, ...body } = metadata
  if (checksum !== digest(body) || metadata.version !== 1 || metadata.scope !== 'synthetic-local-only' || metadata.sourceHash !== sourceHash ||
    !['system', 'controlled'].includes(metadata.clockKind) || metadata.intervalMs !== backupHourMs || metadata.maxAgeMs !== backupHourMs ||
    !['unencrypted-synthetic-rehearsal', 'encrypted-synthetic-rehearsal'].includes(metadata.protection)) throw new Error('Backup metadata/source/policy conflict')
  const anchor = timestamp(metadata.anchorAt), names = await readdir(directory)
  if (names.some(name => !['metadata.json', '.backup.lock'].includes(name) && !/^\d{12}$/.test(name) && !/^stage-[a-f0-9-]{36}$/.test(name))) throw new Error('Unexpected backup artifact')
  const runs = []
  for (const name of names.filter(name => /^\d{12}$/.test(name)).sort()) {
    const manifest = await json(join(directory, name, 'manifest.json'))
    if (!keys(manifest, ['version', 'scope', 'sourceHash', 'slot', 'scheduledAt', 'startedAt', 'finishedAt', 'status', 'recoveryPointAt', 'archiveBytes', 'archiveSha256', 'failureCode', 'hash'])) throw new Error('Invalid backup run envelope')
    const { hash: runHash, ...runBody } = manifest
    if (runHash !== digest(runBody) || manifest.version !== 1 || manifest.scope !== metadata.scope || manifest.sourceHash !== sourceHash ||
      !Number.isSafeInteger(manifest.slot) || manifest.slot < 0 || manifest.slot >= 10000 || runName(manifest.slot) !== name ||
      timestamp(manifest.scheduledAt) !== anchor + manifest.slot * backupHourMs || timestamp(manifest.startedAt) < timestamp(manifest.scheduledAt) ||
      Math.floor((timestamp(manifest.startedAt) - anchor) / backupHourMs) !== manifest.slot ||
      timestamp(manifest.finishedAt) < timestamp(manifest.startedAt) || runs.length && timestamp(runs.at(-1).finishedAt) > timestamp(manifest.startedAt) ||
      !['SUCCESS', 'FAILED'].includes(manifest.status)) throw new Error('Backup run integrity/chronology conflict')
    const files = await readdir(join(directory, name))
    if (manifest.status === 'SUCCESS') {
      if (!Number.isSafeInteger(manifest.archiveBytes) || manifest.archiveBytes < 1 || manifest.archiveBytes > archiveLimit ||
        typeof manifest.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.archiveSha256) || manifest.failureCode !== null ||
        timestamp(manifest.recoveryPointAt) < timestamp(manifest.startedAt) || timestamp(manifest.recoveryPointAt) > timestamp(manifest.finishedAt) ||
        files.some(file => !['manifest.json', 'archive.dump'].includes(file))) throw new Error('Invalid successful recovery point')
    } else if (manifest.recoveryPointAt !== null || manifest.archiveBytes !== 0 || manifest.archiveSha256 !== null ||
      !['CAPTURE_FAILED', 'INVALID_CAPTURE'].includes(manifest.failureCode) || files.some(file => file !== 'manifest.json')) throw new Error('Invalid failed backup metadata')
    runs.push(manifest)
  }
  return { metadata, runs, stagingArtifacts: names.filter(name => name.startsWith('stage-')).length }
}
async function verifiedFile(path, manifest) {
  try {
    if ((await stat(path)).size > archiveLimit) throw new Error('size')
    const bytes = await readFile(path)
    if (bytes.length !== manifest.archiveBytes || hash(bytes) !== manifest.archiveSha256) throw new Error('checksum')
    return bytes
  } catch { throw new Error('BACKUP_ARCHIVE_UNVERIFIED') }
}
const context = manifest => JSON.stringify([manifest.sourceHash, manifest.slot, manifest.recoveryPointAt])
async function archive(directory, manifest, metadata, encryptionKey) {
  const bytes = await verifiedFile(join(directory, runName(manifest.slot), 'archive.dump'), manifest)
  return metadata.protection === 'encrypted-synthetic-rehearsal' ? openArchive(bytes, encryptionKey, context(manifest)) : bytes
}
function protectionKey(metadata, encryptionKey) {
  if (metadata.protection === 'encrypted-synthetic-rehearsal') validateArchiveKey(encryptionKey)
  else if (encryptionKey !== undefined) throw new Error('Backup protection policy conflict')
}
export async function initializeBackupRehearsal({ directory, source, anchorAt, clockKind = 'system', encryptionKey }) {
  sourceKey(source); timestamp(anchorAt)
  if (encryptionKey !== undefined) validateArchiveKey(encryptionKey)
  if (!isAbsolute(directory) || !['system', 'controlled'].includes(clockKind)) throw new Error('Explicit synthetic backup initialization required')
  await mkdir(directory, { mode: 0o700 })
  await locked(directory, async () => {
    const body = { version: 1, scope: 'synthetic-local-only', sourceHash: sourceKey(source), anchorAt, clockKind,
      intervalMs: backupHourMs, maxAgeMs: backupHourMs, protection: encryptionKey === undefined ? 'unencrypted-synthetic-rehearsal' : 'encrypted-synthetic-rehearsal' }
    await writeSynced(join(directory, 'metadata.json'), `${JSON.stringify({ ...body, hash: digest(body) })}\n`)
  })
}
export function postgresBackupCapture({ source, pool }) {
  sourceKey(source)
  return async () => {
    const client = await pool.connect()
    try {
      if ((await client.query('SELECT current_database() AS name')).rows[0].name !== source.database) throw new Error('Synthetic backup database mismatch')
      // Take a conservative database wall timestamp before the MVCC snapshot is acquired.
      const point = (await client.query('SELECT clock_timestamp() AS at')).rows[0]
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const { snapshot } = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0]
      const bytes = await postgresArchive(source.connectionString, source.database, { snapshot })
      await client.query('COMMIT')
      return { archive: bytes, recoveryPointAt: point.at.toISOString() }
    } finally { try { await client.query('ROLLBACK') } finally { client.release() } }
  }
}
export async function runScheduledBackup({ directory, source, at, capture, clock, fault, encryptionKey }) {
  timestamp(at); sourceKey(source)
  return locked(directory, async () => {
    const stored = await load(directory, source), anchor = timestamp(stored.metadata.anchorAt), now = timestamp(at)
    protectionKey(stored.metadata, encryptionKey)
    if (stored.metadata.protection === 'encrypted-synthetic-rehearsal') {
      const latest = stored.runs.findLast(row => row.status === 'SUCCESS')
      if (latest) await archive(directory, latest, stored.metadata, encryptionKey)
    }
    if (stored.metadata.clockKind !== (clock ? 'controlled' : 'system')) throw new Error('Backup clock source changed')
    if (now < anchor) return { due: false, committed: false }
    const slot = Math.floor((now - anchor) / backupHourMs)
    if (slot >= 10000) throw new Error('Backup rehearsal slot limit reached')
    const prior = stored.runs.find(row => row.slot === slot)
    if (prior) {
      if (prior.status === 'SUCCESS') await archive(directory, prior, stored.metadata, encryptionKey)
      return { due: false, committed: false, manifest: prior }
    }
    const readClock = clock ?? (() => new Date().toISOString()), startedAt = readClock()
    if (timestamp(startedAt) < now) throw new Error('Backup run clock precedes scheduled tick')
    if (Math.floor((timestamp(startedAt) - anchor) / backupHourMs) !== slot || stored.runs.some(row => timestamp(row.finishedAt) > timestamp(startedAt))) throw new Error('Stale tick or backward backup run clock')
    let captured, status = 'SUCCESS', failureCode = null
    try { captured = await capture() } catch { status = 'FAILED'; failureCode = 'CAPTURE_FAILED' }
    const finishedAt = readClock()
    if (timestamp(finishedAt) < timestamp(startedAt)) throw new Error('Backup clock moved backwards')
    if (status === 'SUCCESS') {
      try {
        if (!Buffer.isBuffer(captured?.archive) || captured.archive.length < 1 || captured.archive.length > archiveLimit - (encryptionKey === undefined ? 0 : 36) ||
          timestamp(captured.recoveryPointAt) < timestamp(startedAt) || timestamp(captured.recoveryPointAt) > timestamp(finishedAt)) throw new Error('capture')
      } catch { status = 'FAILED'; failureCode = 'INVALID_CAPTURE' }
    }
    let capturedBytes = status === 'SUCCESS' ? Buffer.from(captured.archive) : null
    if (capturedBytes && encryptionKey !== undefined) capturedBytes = sealArchive(capturedBytes, encryptionKey, context({ sourceHash: stored.metadata.sourceHash, slot, recoveryPointAt: captured.recoveryPointAt }))
    const body = { version: 1, scope: stored.metadata.scope, sourceHash: stored.metadata.sourceHash, slot,
      scheduledAt: new Date(anchor + slot * backupHourMs).toISOString(), startedAt, finishedAt, status,
      recoveryPointAt: status === 'SUCCESS' ? captured.recoveryPointAt : null,
      archiveBytes: capturedBytes?.length ?? 0,
      archiveSha256: capturedBytes ? hash(capturedBytes) : null, failureCode }
    const manifest = { ...body, hash: digest(body) }, stage = join(directory, `stage-${randomUUID()}`)
    try {
      await mkdir(stage, { mode: 0o700 })
      if (status === 'SUCCESS') await writeSynced(join(stage, 'archive.dump'), capturedBytes)
      await fault?.('after_archive_write')
      await writeSynced(join(stage, 'manifest.json'), `${JSON.stringify(manifest)}\n`)
      await fault?.('before_publish')
      if (status === 'SUCCESS') await verifiedFile(join(stage, 'archive.dump'), manifest)
      await rename(stage, join(directory, runName(slot)))
      await fault?.('after_publish')
    } catch { throw new Error('BACKUP_STORAGE_FAILED_OR_OUTCOME_UNCERTAIN') }
    return { due: true, committed: true, manifest }
  })
}
export async function readVerifiedBackup({ directory, source, slot, encryptionKey }) {
  return locked(directory, async () => {
    const { runs, metadata } = await load(directory, source), manifest = runs.find(row => row.slot === slot)
    if (!manifest || manifest.status !== 'SUCCESS') throw new Error('No successful synthetic recovery point for slot')
    protectionKey(metadata, encryptionKey)
    return { manifest, archive: await archive(directory, manifest, metadata, encryptionKey) }
  })
}
export async function backupReadiness({ directory, source, at, encryptionKey, trustedAnchor }) {
  const now = timestamp(at), sourceHash = sourceKey(source)
  const finding = (code, slot = null) => ({ id: digest([sourceHash, code, slot]), code, slot, scope: 'synthetic-local-only' })
  try {
    return await locked(directory, async () => {
      const stored = await load(directory, source), anchor = timestamp(stored.metadata.anchorAt), findings = [], valid = []
      protectionKey(stored.metadata, encryptionKey)
      if (trustedAnchor !== undefined) matchAnchor(trustedAnchor, (await inventory(directory, source, encryptionKey)).anchor)
      const currentSlot = Math.floor((now - anchor) / backupHourMs)
      if (currentSlot >= 10000) throw new Error('Backup rehearsal slot limit reached')
      for (const row of stored.runs) if (row.status === 'SUCCESS') {
        try { await archive(directory, row, stored.metadata, encryptionKey); valid.push(row) } catch { findings.push(finding('ARCHIVE_UNVERIFIED', row.slot)) }
      }
      const latest = valid.at(-1), lastRun = stored.runs.at(-1), age = latest ? now - timestamp(latest.recoveryPointAt) : null
      const clockConflict = stored.runs.some(row => timestamp(row.finishedAt) > now)
      if (clockConflict) findings.push(finding('CLOCK_CONFLICT'))
      if (!latest) findings.push(finding('NO_RECOVERY_POINT'))
      else if (age > backupHourMs) findings.push(finding('STALE_RECOVERY_POINT', latest.slot))
      if (lastRun?.status === 'FAILED') findings.push(finding('LAST_RUN_FAILED', lastRun.slot))
      const missedSlots = []
      for (let slot = 0; slot <= currentSlot; slot++) if (anchor + slot * backupHourMs < now && !stored.runs.some(row => row.slot === slot)) missedSlots.push(slot)
      if (missedSlots.includes(currentSlot)) findings.push(finding('MISSED_SCHEDULE', currentSlot))
      if (stored.stagingArtifacts) findings.push(finding('UNPUBLISHED_ARTIFACTS'))
      return { scope: 'synthetic-local-only; not protected production backup acceptance', at,
        protection: stored.metadata.protection, healthy: findings.length === 0, findings,
        ...(trustedAnchor !== undefined ? { trusted: true } : {}),
        latestRecoveryPointAt: latest?.recoveryPointAt ?? null, recoveryPointAgeMs: clockConflict ? null : age,
        runDue: currentSlot >= 0 && !stored.runs.some(row => row.slot === currentSlot), missedSlots,
        successfulRuns: valid.length, failedRuns: stored.runs.filter(row => row.status === 'FAILED').length, stagingArtifacts: stored.stagingArtifacts }
    })
  } catch { return { scope: 'synthetic-local-only', at, healthy: false,
    ...(trustedAnchor !== undefined ? { trusted: false } : {}),
    findings: [finding(trustedAnchor !== undefined ? 'BACKUP_TRUST_VERIFICATION_FAILED' : 'STORE_UNAVAILABLE')] } }
}

// The caller must retain this anchor independently of the mutable backup store.
// Creation is an explicit trust decision, never automatic repair or reconciliation.
async function inventory(directory, source, encryptionKey) {
  const stored = await load(directory, source)
  protectionKey(stored.metadata, encryptionKey)
  if (stored.metadata.protection !== 'encrypted-synthetic-rehearsal' || stored.stagingArtifacts ||
    !stored.runs.some(row => row.status === 'SUCCESS')) throw new Error('Unanchorable synthetic backup store')
  for (const row of stored.runs) if (row.status === 'SUCCESS') await archive(directory, row, stored.metadata, encryptionKey)
  const anchor = { version: 1, scope: 'synthetic-local-only', sourceHash: stored.metadata.sourceHash,
    inventorySha256: digest([stored.metadata, stored.runs]) }
  return { ...stored, anchor }
}
function matchAnchor(expected, actual) {
  if (!keys(expected, ['version', 'scope', 'sourceHash', 'inventorySha256']) ||
    expected.version !== actual.version || expected.scope !== actual.scope || expected.sourceHash !== actual.sourceHash ||
    expected.inventorySha256 !== actual.inventorySha256) throw new Error('Anchor mismatch')
}
export async function createBackupAnchor({ directory, source, encryptionKey }) {
  try {
    return await locked(directory, async () => Object.freeze((await inventory(directory, source, encryptionKey)).anchor))
  } catch { throw new Error('BACKUP_ANCHOR_CREATION_FAILED') }
}
export async function readAnchoredBackup({ directory, source, encryptionKey, trustedAnchor, slot }) {
  try {
    return await locked(directory, async () => {
      const stored = await inventory(directory, source, encryptionKey)
      matchAnchor(trustedAnchor, stored.anchor)
      const manifest = stored.runs.find(row => row.slot === slot && row.status === 'SUCCESS')
      if (!manifest) throw new Error('Missing recovery point')
      return { manifest, archive: await archive(directory, manifest, stored.metadata, encryptionKey) }
    })
  } catch { throw new Error('BACKUP_TRUST_VERIFICATION_FAILED') }
}
export async function anchoredBackupReadiness(options) {
  // Null ensures a missing anchor fails closed rather than choosing unanchored mode.
  return backupReadiness({ ...options, trustedAnchor: options.trustedAnchor ?? null })
}
