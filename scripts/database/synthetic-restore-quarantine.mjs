import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { recoveryTarget } from './recovery.mjs'

export const quarantineDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name))
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)
function time(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw Error('time')
  return Date.parse(value)
}
// Opt-in synthetic rehearsal only. Production delivery does not select this policy.
// The expected digest and context must be held independently of restored DB/evidence.
export function syntheticRestoreQuarantine({ source, restoreId, recoveryAnchorHash, evidencePath, expectedEvidenceDigest }) {
  try {
    recoveryTarget(source.connectionString, source.database)
    if (!uuid(restoreId) || !hex(recoveryAnchorHash) || !isAbsolute(evidencePath) || !hex(expectedEvidenceDigest)) throw Error('context')
  } catch { throw Error('RESTORE_QUARANTINE_BLOCKED') }
  const databaseHash = quarantineDigest(source.database)
  return async (client, notification, startedAt) => {
    try {
      if ((await stat(evidencePath)).size > 2 * 1024 * 1024) throw Error('size')
      const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
      if (quarantineDigest(evidence) !== expectedEvidenceDigest ||
        !exact(evidence, ['version', 'scope', 'restoreId', 'databaseHash', 'recoveryAnchorHash', 'reviewer', 'reviewedAt', 'decisions']) ||
        evidence.version !== 1 || evidence.scope !== 'synthetic-local-only' || evidence.restoreId !== restoreId ||
        evidence.databaseHash !== databaseHash || evidence.recoveryAnchorHash !== recoveryAnchorHash ||
        typeof evidence.reviewer !== 'string' || !/^synthetic-reviewer-[a-z0-9-]{1,64}$/.test(evidence.reviewer) ||
        !Array.isArray(evidence.decisions) || evidence.decisions.length < 1 || evidence.decisions.length > 10000 ||
        time(evidence.reviewedAt) > time(startedAt)) throw Error('evidence')
      const seen = new Set()
      for (const row of evidence.decisions) {
        if (!exact(row, ['notificationId', 'rowDigest', 'decision', 'firstProviderUseAt', 'evidenceRef']) ||
          !uuid(row.notificationId) || !hex(row.rowDigest) || !hex(row.evidenceRef) || seen.has(row.notificationId) ||
          !['HOLD', 'CONFIRMED_NOT_ACCEPTED', 'RETRY_WITHIN_WINDOW'].includes(row.decision)) throw Error('decision')
        seen.add(row.notificationId)
        if (row.decision === 'RETRY_WITHIN_WINDOW') {
          if (time(row.firstProviderUseAt) > time(evidence.reviewedAt)) throw Error('future provider evidence')
        } else if (row.firstProviderUseAt !== null) throw Error('conflict')
      }
      if ((await client.query('SELECT current_database() AS name')).rows[0].name !== source.database) throw Error('database')
      const decision = evidence.decisions.find(row => row.notificationId === notification.id)
      const current = (await client.query('SELECT to_jsonb(n) AS row FROM patient_transfer.notifications n WHERE id=$1', [notification.id])).rows[0]?.row
      if (!decision || decision.decision === 'HOLD' || !current || decision.rowDigest !== quarantineDigest(current)) throw Error('stale or held')
      if (decision.decision === 'RETRY_WITHIN_WINDOW' && time(startedAt) >= time(decision.firstProviderUseAt) + 24 * 3600000) throw Error('expired')
      // No attempt/history/status/key is changed by this gate. The normal worker
      // retains all existing budget, expiry, recipient and payload safeguards.
    } catch { throw Error('RESTORE_QUARANTINE_BLOCKED') }
  }
}
