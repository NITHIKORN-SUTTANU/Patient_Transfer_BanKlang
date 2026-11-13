import { hashPassword } from '../../server/auth.mjs'
import { withDatabase } from './migrate.mjs'

try {
  const { STAFF_USERNAME: username, STAFF_PASSWORD: password, STAFF_ROLE: role = 'admin', STAFF_NAME: name = username } = process.env
  if (!username || !['admin','dispatcher','driver'].includes(role)) throw new Error('STAFF_USERNAME and valid STAFF_ROLE required')
  const hash = await hashPassword(password)
  await withDatabase(client => client.query(`INSERT INTO patient_transfer.users(username,display_name,role,password_hash)
    VALUES($1,$2,$3,$4)`, [username, name, role, hash]))
  process.stdout.write('Staff account created. Password was not logged. Driver accounts still need a driver roster record.\n')
} catch (error) {
  process.stderr.write(`Staff setup failed: ${error.code === '23505' ? 'Username already exists; account preserved' : error.message}\n`)
  process.exitCode = 1
}
