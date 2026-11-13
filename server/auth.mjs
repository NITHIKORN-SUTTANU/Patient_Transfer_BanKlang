import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(scrypt)
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
export const tokenHash = token => createHash('sha256').update(token).digest('hex')
export const newToken = () => randomBytes(32).toString('base64url')

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 512) throw new Error('Password must contain 12–512 characters')
  const salt = randomBytes(16).toString('hex')
  const hash = await derive(password, salt, 64, options)
  return `scrypt-v1:${salt}:${hash.toString('hex')}`
}
export async function verifyPassword(password, encoded) {
  const parts = typeof encoded === 'string' ? encoded.split(':') : []
  const valid = parts.length === 3 && parts[0] === 'scrypt-v1' && /^[a-f0-9]{32}$/.test(parts[1]) && /^[a-f0-9]{128}$/.test(parts[2])
  // Derive even for unknown accounts to avoid an obvious username timing shortcut.
  const actual = await derive(password, valid ? parts[1] : '0'.repeat(32), 64, options)
  const expected = Buffer.from(valid ? parts[2] : '0'.repeat(128), 'hex')
  return timingSafeEqual(actual, expected) && valid
}
