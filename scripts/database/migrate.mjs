import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import pg from 'pg'

const directory = new URL('../../database/migrations/', import.meta.url)
const quote = value => `"${value.replaceAll('"', '""')}"`

async function migrationFiles() {
  const names = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.up\.sql$/.test(name)).sort()
  return Promise.all(names.map(async name => {
    const id = name.replace('.up.sql', '')
    const up = await readFile(new URL(name, directory), 'utf8')
    const down = await readFile(new URL(`${id}.down.sql`, directory), 'utf8')
    return { id, up, down, checksum: createHash('sha256').update(`${up}\0${down}`).digest('hex') }
  }))
}

export async function migrate(client, action = 'up') {
  if (!['up', 'down', 'status'].includes(action)) throw new Error('Use up, down, or status')
  const migrations = await migrationFiles()
  await client.query("SELECT pg_advisory_lock(hashtext('patient_transfer_migrations'))")
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.patient_transfer_migrations (
      id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`)
    const { rows: applied } = await client.query('SELECT * FROM public.patient_transfer_migrations ORDER BY id')
    for (let index = 0; index < applied.length; index++) {
      const row = applied[index]
      const source = migrations[index]
      if (!source || source.id !== row.id || source.checksum !== row.checksum) throw new Error(`Migration history/source mismatch: ${row.id}`)
    }
    if (action === 'status') return migrations.map(file => ({ id: file.id, applied: applied.some(row => row.id === file.id) }))
    const pending = action === 'up' ? migrations.slice(applied.length) : applied.length ? [migrations[applied.length - 1]] : []
    const changes = []
    for (const file of pending) {
      await client.query('BEGIN')
      try {
        if (action === 'down') {
          const { rows: tables } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'patient_transfer'")
          for (const { tablename } of tables) {
            // Stronger lock prevents a concurrent writer from racing the empty check.
            await client.query(`LOCK TABLE patient_transfer.${quote(tablename)} IN ACCESS EXCLUSIVE MODE`)
            const { rowCount } = await client.query(`SELECT 1 FROM patient_transfer.${quote(tablename)} LIMIT 1`)
            if (rowCount) throw new Error(`Rollback refused: ${tablename} contains data. Restore/rehearse from backup instead.`)
          }
          await client.query(file.down)
          await client.query('DELETE FROM public.patient_transfer_migrations WHERE id = $1', [file.id])
        } else {
          await client.query(file.up)
          await client.query('INSERT INTO public.patient_transfer_migrations(id, checksum) VALUES ($1, $2)', [file.id, file.checksum])
        }
        await client.query('COMMIT')
        changes.push(file.id)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
    return changes
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('patient_transfer_migrations'))")
  }
}

export async function withDatabase(work) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; see .env.example')
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 })
  try { await client.connect(); return await work(client) }
  finally { await client.end() }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = await withDatabase(client => migrate(client, process.argv[2] ?? 'up'))
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    // Do not print connection configuration or credentials.
    process.stderr.write(`Database migration failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
