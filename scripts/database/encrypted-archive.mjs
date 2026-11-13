import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Provisional rehearsal format: fixed AES-256-GCM, fresh 96-bit nonce, 128-bit tag.
const magic = Buffer.from('PTBAK001')
export function validateArchiveKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Synthetic archive key must contain 32 bytes')
}
export function sealArchive(bytes, key, context) {
  validateArchiveKey(key)
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(context))
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()])
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), ciphertext])
}
export function openArchive(bytes, key, context) {
  try {
    validateArchiveKey(key)
    if (bytes.length <= 36 || !bytes.subarray(0, 8).equals(magic)) throw new Error('format')
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(8, 20))
    decipher.setAAD(Buffer.from(context))
    decipher.setAuthTag(bytes.subarray(20, 36))
    return Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()])
  } catch { throw new Error('BACKUP_DECRYPTION_FAILED') }
}
