export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details }
}
export function check(condition, status, message, details) { if (!condition) throw new ApiError(status, message, details) }
export function fields(value, allowed, required = []) {
  check(value && typeof value === 'object' && !Array.isArray(value), 400, 'JSON object required')
  check(Object.keys(value).every(key => allowed.includes(key)), 400, 'Unknown request field')
  check(required.every(key => Object.hasOwn(value, key)), 400, 'Required request field missing')
  return value
}
export function text(value, label, maximum = 500) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= maximum, 400, `Invalid ${label}`)
  return value.trim()
}
export function uuid(value) {
  check(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), 400, 'Invalid identifier')
  return value
}
