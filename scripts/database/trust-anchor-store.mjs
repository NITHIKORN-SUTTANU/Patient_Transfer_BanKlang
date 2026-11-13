import { mkdir, open, readdir, readFile, rename, realpath, stat, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name))
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
function validAnchor(anchor) {
  return exact(anchor, ['version', 'scope', 'sourceHash', 'inventorySha256']) && anchor.version === 1 &&
    anchor.scope === 'synthetic-local-only' && hex(anchor.sourceHash) && hex(anchor.inventorySha256)
}
const name = revision => String(revision).padStart(6, '0') + '.json'
async function separate(directory, backupDirectory, prospective = false) {
  if (!isAbsolute(directory) || !isAbsolute(backupDirectory)) throw Error('path')
  const trust = prospective ? join(await realpath(dirname(directory)), basename(directory)) : await realpath(directory), backup = await realpath(backupDirectory)
  const contains = (parent, child) => { const rel = relative(parent, child); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)) }
  if (contains(trust, backup) || contains(backup, trust)) throw Error('overlap')
}
async function locked(options, work) {
  let lock
  try {
    await separate(options.directory, options.backupDirectory)
    lock = await open(join(options.directory, '.trust.lock'), 'wx', 0o600)
  } catch { throw Error('TRUST_STORE_UNAVAILABLE') }
  try { return await work() }
  finally { await lock.close(); await unlink(join(options.directory, '.trust.lock')) }
}
async function load(directory) {
  const files = (await readdir(directory)).filter(file => file !== '.trust.lock').sort()
  if (files.length > 10000 || files.some((file, index) => file !== name(index + 1))) throw Error('TRUST_STORE_UNVERIFIED')
  const rows = []
  for (const file of files) {
    const path = join(directory, file)
    if ((await stat(path)).size > 4096) throw Error('TRUST_STORE_UNVERIFIED')
    const row = JSON.parse(await readFile(path, 'utf8')), previous = rows.at(-1)
    if (!exact(row, ['version', 'scope', 'revision', 'previousHash', 'operationId', 'anchor', 'hash'])) throw Error('TRUST_STORE_UNVERIFIED')
    const { hash, ...body } = row
    if (row.version !== 1 || row.scope !== 'synthetic-local-only' || row.revision !== rows.length + 1 ||
      row.previousHash !== (previous?.hash ?? null) || hash !== digest(body) || !validAnchor(row.anchor) ||
      typeof row.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(row.operationId) ||
      rows.some(prior => prior.operationId === row.operationId || prior.anchor.inventorySha256 === row.anchor.inventorySha256) ||
      previous && previous.anchor.sourceHash !== row.anchor.sourceHash) throw Error('TRUST_STORE_UNVERIFIED')
    rows.push(row)
  }
  return rows
}
const receipt = row => row ? { revision: row.revision, hash: row.hash, anchor: row.anchor } : null
const same = (left, right) => left === null && right === null || exact(left, ['revision', 'hash', 'anchor']) &&
  exact(right, ['revision', 'hash', 'anchor']) && left.revision === right.revision && left.hash === right.hash &&
  validAnchor(left.anchor) && digest(left.anchor) === digest(right.anchor)
export async function initializeTrustStore(options) {
  try {
    // Explicit initialization only; existing stores are never reset or adopted.
    if (!isAbsolute(options.directory)) throw Error('path')
    await separate(options.directory, options.backupDirectory, true)
    await mkdir(options.directory, { mode: 0o700 })
    await locked(options, async () => { if ((await load(options.directory)).length) throw Error('nonempty') })
  } catch { throw Error('TRUST_STORE_INITIALIZATION_FAILED') }
}
export async function readTrustHead(options) {
  try {
    return await locked(options, async () => {
      const head = receipt((await load(options.directory)).at(-1))
      if (Object.hasOwn(options, 'expectedHead') && !same(options.expectedHead, head)) throw Error('TRUST_HEAD_CONFLICT')
      return head
    })
  } catch (error) { throw Error(error.message === 'TRUST_HEAD_CONFLICT' ? error.message : 'TRUST_STORE_UNVERIFIED') }
}
export async function advanceTrustAnchor(options) {
  const { directory, expectedHead, nextAnchor, operationId, fault } = options
  if (!validAnchor(nextAnchor) || typeof operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(operationId) ||
    !(expectedHead === null || exact(expectedHead, ['revision', 'hash', 'anchor']))) throw Error('TRUST_UPDATE_INVALID')
  return locked(options, async () => {
    let rows
    try { rows = await load(directory) } catch { throw Error('TRUST_STORE_UNVERIFIED') }
    const replay = rows.find(row => row.operationId === operationId)
    if (replay) {
      const previous = receipt(rows[replay.revision - 2])
      if (!same(expectedHead, previous) || digest(replay.anchor) !== digest(nextAnchor)) throw Error('TRUST_OPERATION_CONFLICT')
      // A replay must never hand back an older head after further advancement.
      if (replay !== rows.at(-1)) throw Error('TRUST_HEAD_CONFLICT')
      return { committed: false, replayed: true, head: receipt(replay) }
    }
    if (!same(expectedHead, receipt(rows.at(-1)))) throw Error('TRUST_HEAD_CONFLICT')
    if (rows.length >= 10000 || rows.some(row => row.anchor.inventorySha256 === nextAnchor.inventorySha256) ||
      rows.length && rows[0].anchor.sourceHash !== nextAnchor.sourceHash) throw Error('TRUST_UPDATE_INVALID')
    const body = { version: 1, scope: 'synthetic-local-only', revision: rows.length + 1,
      previousHash: rows.at(-1)?.hash ?? null, operationId, anchor: nextAnchor }
    const row = { ...body, hash: digest(body) }, stage = join(directory, 'stage-' + operationId)
    try {
      const file = await open(stage, 'wx', 0o600)
      try { await file.writeFile(JSON.stringify(row) + '\n'); await file.sync() } finally { await file.close() }
      await fault?.('before_publish')
      await rename(stage, join(directory, name(row.revision)))
      await fault?.('after_publish')
    } catch { throw Error('TRUST_PUBLICATION_UNCERTAIN') }
    return { committed: true, replayed: false, head: receipt(row) }
  })
}
