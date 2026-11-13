import { readFile } from 'node:fs/promises'
import { withDatabase } from './migrate.mjs'

try {
  if (process.env.ALLOW_SYNTHETIC_SEED !== 'true') throw new Error('Set ALLOW_SYNTHETIC_SEED=true only for a development database')
  const sql = await readFile(new URL('../../database/seeds/development.sql', import.meta.url), 'utf8')
  await withDatabase(async client => {
    await client.query('BEGIN')
    try { await client.query(sql); await client.query('COMMIT') }
    catch (error) { await client.query('ROLLBACK'); throw error }
  })
  process.stdout.write('Synthetic fixtures loaded. No login passwords were created.\n')
} catch (error) {
  process.stderr.write(`Database seed failed: ${error.message}\n`)
  process.exitCode = 1
}
