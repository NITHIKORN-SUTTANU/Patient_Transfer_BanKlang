import { readFile, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { linePushSender } from '../../server/line.mjs'

// Test-only provider model. Its file survives database loss; it stores no message text,
// recipient subject or credentials. Fresh adapters reload the file on every request.
export function syntheticRecoveryProvider(path, now) {
  return linePushSender('Synthetic-Test-Token-Only', async (_url, options) => {
    let history
    try { history = JSON.parse(await readFile(path, 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error; history = [] }
    const retryKey = options.headers['X-Line-Retry-Key']
    const payloadHash = createHash('sha256').update(options.body).digest('hex')
    const prior = history.findLast(row => row.retryKey === retryKey && row.accepted)
    const duplicate = prior && Date.parse(now) - Date.parse(prior.at) < 24 * 3600000
    if (duplicate && prior.payloadHash !== payloadHash) throw Error('Synthetic retry payload changed')
    history.push({ retryKey, payloadHash, at: now, accepted: !duplicate })
    const file = await open(path, 'w', 0o600)
    try { await file.writeFile(JSON.stringify(history)); await file.sync() } finally { await file.close() }
    return { ok: !duplicate, status: duplicate ? 409 : 200,
      headers: { get: key => key === 'x-line-accepted-request-id' && duplicate ? 'synthetic-accepted-request' : null } }
  })
}
export async function syntheticProviderHistory(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}
