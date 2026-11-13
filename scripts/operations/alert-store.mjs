import { mkdir, readdir, open, readFile, stat, link, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { evaluateProbeAlerts, validateProbeAlertResult } from './probe-alerts.mjs'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === allowed.length && allowed.every(key => Object.hasOwn(value, key))
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
const fileLimit = 1024 * 1024, totalLimit = 16 * 1024 * 1024, commitLimit = 10000
const commitName = sequence => `${String(sequence).padStart(12, '0')}.commit.json`
const staged = /^(commit|checkpoint)-stage-[a-f0-9-]{36}\.json$/
function directoryValue(directory) { if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('Explicit absolute synthetic alert-store directory required') }
async function locked(directory, work) {
  directoryValue(directory)
  let lock
  try { lock = await open(join(directory, '.writer.lock'), 'wx', 0o600) }
  catch { throw new Error('Alert store unavailable or locked; no automatic reset or lock stealing') }
  try { return await work() } finally { await lock.close(); await unlink(join(directory, '.writer.lock')) }
}
async function jsonFile(path, optional = false) {
  try {
    if ((await stat(path)).size > fileLimit) throw new Error('size')
    const bytes = await readFile(path)
    if (bytes.length > fileLimit) throw new Error('size')
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) { if (optional && error.code === 'ENOENT') return null; throw new Error('Alert-store file missing, oversized or corrupt') }
}
async function writeSynced(path, value) {
  const bytes = `${JSON.stringify(value)}\n`
  if (Buffer.byteLength(bytes) > fileLimit) throw new Error('Alert-store commit size limit reached')
  const file = await open(path, 'wx', 0o600)
  try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
}
function cacheValue(metadata, commits) {
  const last = commits.at(-1)
  const body = { version: 1, scope: 'synthetic-only', storeId: metadata.storeId, sequence: commits.length,
    commitHash: last?.hash ?? metadata.hash, state: last?.result.state ?? null,
    eventCount: commits.reduce((count, row) => count + row.result.events.length, 0) }
  return { ...body, checksum: hash(body) }
}
function verifyTransition(prior, result, episodes, eventIds) {
  validateProbeAlertResult(result)
  const next = result.state
  if (prior && (prior.policyHash !== next.policyHash || prior.dutyHash !== next.dutyHash || prior.evaluatedAt > next.evaluatedAt ||
    prior.head && (!next.head || next.head.sequence < prior.head.sequence || next.head.sequence === prior.head.sequence && next.head.hash !== prior.head.hash))) throw new Error('Alert-store checkpoint chronology or policy conflict')
  for (const event of result.events) {
    if (eventIds.has(event.id)) throw new Error('Duplicate committed alert transition')
    if (event.transition === 'opened') {
      if (episodes.has(event.alertId)) throw new Error('Duplicate open alert episode')
      episodes.set(event.alertId, event.category)
    } else {
      if (episodes.get(event.alertId) !== event.category) throw new Error('Recovery lacks its committed opening')
      episodes.delete(event.alertId)
    }
    eventIds.add(event.id)
  }
  if (episodes.size !== next.active.length || next.active.some(alert => episodes.get(alert.id) !== alert.key)) throw new Error('Alert checkpoint and transition history disagree')
}
async function load(directory, expectedHead) {
  const metadata = await jsonFile(join(directory, 'metadata.json'))
  if (!keys(metadata, ['version', 'scope', 'storeId', 'hash']) || metadata.version !== 1 || metadata.scope !== 'synthetic-only' || !uuid(metadata.storeId) ||
    metadata.hash !== hash({ version: 1, scope: 'synthetic-only', storeId: metadata.storeId })) throw new Error('Invalid alert-store metadata')
  const names = await readdir(directory)
  if (names.some(name => !['metadata.json', 'checkpoint.json', '.writer.lock'].includes(name) && !/^\d{12}\.commit\.json$/.test(name) && !staged.test(name))) throw new Error('Unexpected alert-store artifact; reconcile without deleting')
  const files = names.filter(name => /^\d{12}\.commit\.json$/.test(name)).sort()
  if (files.length > commitLimit) throw new Error('Alert-store rehearsal commit limit reached')
  const commits = [], events = [], eventIds = new Set(), episodes = new Map()
  let previousHash = metadata.hash, bytes = 0
  for (const [index, name] of files.entries()) {
    if (name !== commitName(index + 1)) throw new Error('Alert-store generation gap or reordering')
    bytes += (await stat(join(directory, name))).size
    if (bytes > totalLimit) throw new Error('Alert-store rehearsal size limit reached')
    const row = await jsonFile(join(directory, name))
    if (!keys(row, ['version', 'storeId', 'sequence', 'previousHash', 'result', 'hash']) || row.version !== 1 || row.storeId !== metadata.storeId ||
      row.sequence !== index + 1 || row.previousHash !== previousHash || row.hash !== hash({ version: 1, storeId: metadata.storeId,
        sequence: index + 1, previousHash, result: row.result })) throw new Error('Alert-store commit chain conflict')
    verifyTransition(commits.at(-1)?.result.state, row.result, episodes, eventIds)
    events.push(...row.result.events)
    commits.push(row); previousHash = row.hash
  }
  const current = cacheValue(metadata, commits)
  const cache = await jsonFile(join(directory, 'checkpoint.json'), true)
  if (!cache && !commits.length) throw new Error('Incomplete alert-store initialization; do not reset')
  if (cache && (!Number.isSafeInteger(cache.sequence) || cache.sequence < 0 || cache.sequence > commits.length ||
    JSON.stringify(cache) !== JSON.stringify(cacheValue(metadata, commits.slice(0, cache.sequence))))) throw new Error('Alert-store cache conflicts with committed history')
  const head = { sequence: current.sequence, hash: current.commitHash }
  if (expectedHead && (expectedHead.sequence !== head.sequence || expectedHead.hash !== head.hash)) throw new Error('Alert store differs from supplied head anchor')
  return { metadata, commits, state: current.state, events, head, currentCache: current,
    checkpointStatus: !cache ? 'missing' : cache.sequence === commits.length ? 'current' : 'stale',
    stagingArtifacts: names.filter(name => staged.test(name)).length, committedBytes: bytes }
}
const view = store => ({ scope: 'synthetic-only', head: store.head, state: store.state, events: store.events,
  checkpointStatus: store.checkpointStatus, stagingArtifacts: store.stagingArtifacts })
async function replaceCheckpoint(directory, value, fault) {
  const temporary = join(directory, `checkpoint-stage-${randomUUID()}.json`)
  await writeSynced(temporary, value)
  await fault?.('before_checkpoint_replace')
  await rename(temporary, join(directory, 'checkpoint.json'))
  await fault?.('after_checkpoint_replace')
}
export async function initializeAlertStore({ directory }) {
  directoryValue(directory)
  await mkdir(directory, { mode: 0o700 }) // Refuse existing storage, including partial initialization.
  return locked(directory, async () => {
    const body = { version: 1, scope: 'synthetic-only', storeId: randomUUID() }, metadata = { ...body, hash: hash(body) }
    await writeSynced(join(directory, 'metadata.json'), metadata)
    await writeSynced(join(directory, 'checkpoint.json'), cacheValue(metadata, []))
    return view(await load(directory))
  })
}
export async function readAlertStore({ directory, expectedHead }) {
  return locked(directory, async () => view(await load(directory, expectedHead)))
}
export async function recoverAlertStore({ directory, expectedHead }) {
  return locked(directory, async () => {
    const stored = await load(directory, expectedHead), changed = stored.checkpointStatus !== 'current'
    if (changed) await replaceCheckpoint(directory, stored.currentCache)
    return { ...view(await load(directory)), checkpointRebuilt: changed }
  })
}
export async function evaluateAndPersistAlerts({ directory, expectedHead, fault, ...input }) {
  if (Object.hasOwn(input, 'previous')) throw new Error('Persistent alert evaluation derives prior state from committed history')
  return locked(directory, async () => {
    const stored = await load(directory, expectedHead), checkpointRebuilt = stored.checkpointStatus !== 'current'
    if (checkpointRebuilt) await replaceCheckpoint(directory, stored.currentCache)
    const result = validateProbeAlertResult(await evaluateProbeAlerts({ ...input, previous: stored.state }))
    verifyTransition(stored.state, result, new Map(stored.state?.active.map(alert => [alert.id, alert.key]) ?? []), new Set(stored.events.map(event => event.id)))
    if (stored.state?.checksum === result.state.checksum && result.events.length === 0) return { ...view(stored), checkpointStatus: 'current', checkpointRebuilt, committed: false, newEvents: [] }
    if (stored.commits.length >= commitLimit) throw new Error('Alert-store rehearsal commit limit reached')
    const body = { version: 1, storeId: stored.metadata.storeId, sequence: stored.commits.length + 1,
      previousHash: stored.head.hash, result }, row = { ...body, hash: hash(body) }
    if (stored.committedBytes + Buffer.byteLength(JSON.stringify(row)) + 1 > totalLimit) throw new Error('Alert-store rehearsal size limit reached')
    const temporary = join(directory, `commit-stage-${randomUUID()}.json`)
    await writeSynced(temporary, row)
    await fault?.('after_commit_stage')
    // Atomic publication without overwriting an existing immutable generation.
    await link(temporary, join(directory, commitName(row.sequence)))
    await fault?.('after_commit_publish')
    await unlink(temporary)
    await replaceCheckpoint(directory, cacheValue(stored.metadata, [...stored.commits, row]), fault)
    return { ...view(await load(directory)), committed: true, checkpointRebuilt, newEvents: result.events }
  })
}
