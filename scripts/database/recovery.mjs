import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

// Deliberately limited to generated local test databases. This is not a live restore command.
export function recoveryTarget(connectionString, database) {
  const url = new URL(connectionString)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      (url.port || '5432') !== '54329' || !/^pt_test_[a-f0-9]{32}$/.test(database)) {
    throw new Error('Recovery drill requires a generated local test database on port 54329')
  }
  return { database, username: decodeURIComponent(url.username) }
}

export function postgresArchive(connectionString, database, { snapshot, archive } = {}) {
  const target = recoveryTarget(connectionString, database)
  const restoring = archive !== undefined
  if (!restoring && !/^[\da-f]+-[\da-f]+-\d+$/i.test(snapshot ?? '')) throw new Error('Exported snapshot required')
  const tool = restoring ? 'pg_restore' : 'pg_dump'
  const args = ['compose', 'exec', '-T', 'database', tool, '--username', target.username,
    '--dbname', target.database, '--no-owner', '--no-acl',
    ...(restoring ? ['--exit-on-error', '--single-transaction'] : ['--format=custom', `--snapshot=${snapshot}`])]
  return new Promise((resolve, reject) => {
    // No URL/password in arguments, logs or child diagnostics. Container-local socket authentication.
    const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    let size = 0, failed = false
    const fail = () => { if (!failed) { failed = true; reject(new Error(`Synthetic ${tool} failed; check Docker/local database tooling`)) } }
    child.on('error', fail)
    child.stderr.on('data', () => {})
    child.stdout.on('data', chunk => {
      size += chunk.length
      if (size > 64 * 1024 * 1024) { child.kill(); fail() }
      else chunks.push(chunk)
    })
    child.stdin.on('error', fail)
    const timeout = setTimeout(() => { child.kill(); fail() }, 120000)
    child.on('close', code => {
      clearTimeout(timeout)
      if (code !== 0) fail()
      else if (!failed) resolve(Buffer.concat(chunks))
    })
    child.stdin.end(archive)
  })
}

const quote = value => `"${value.replaceAll('"', '""')}"`

export async function recoveryFingerprint(client) {
  const { rows: tables } = await client.query(`SELECT schemaname,tablename FROM pg_tables
    WHERE schemaname='patient_transfer' OR (schemaname='public' AND tablename='patient_transfer_migrations')
    ORDER BY schemaname,tablename`)
  const result = {}
  for (const { schemaname, tablename } of tables) {
    const { rows } = await client.query(`SELECT to_jsonb(t)::text AS row FROM ${quote(schemaname)}.${quote(tablename)} t ORDER BY to_jsonb(t)::text COLLATE "C"`)
    result[`${schemaname}.${tablename}`] = {
      rows: rows.length,
      sha256: createHash('sha256').update(JSON.stringify(rows.map(row => row.row))).digest('hex'),
    }
  }
  return result
}
