import { randomUUID } from 'node:crypto'
import { syntheticPassword } from './admin-postgres.mjs'

class ProbeFailure extends Error {
  constructor(step, code) { super('Synthetic critical-service check failed'); this.step = step; this.code = code }
}

// Mutating canary for isolated synthetic fixtures only. Never a production monitoring command.
export async function syntheticAvailabilityCanary({ base, control, beforeDriverAccess = async () => {}, timeoutMs = 5000 }) {
  const url = new URL(base)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search) {
    throw new Error('Synthetic canary requires a local ephemeral test API')
  }
  const checks = [], started = performance.now(), observedAt = new Date().toISOString()
  async function step(name, path, token, body, expected = 200, validate = () => true) {
    const start = performance.now()
    let status = null, code = 'transport'
    try {
      const response = await fetch(`${base}/api${path}`, { method: body ? 'POST' : 'GET',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs) })
      status = response.status
      if (status !== expected) { code = `http_${status}`; throw new ProbeFailure(name, code) }
      if (response.headers.get('content-type')?.split(';')[0] !== 'application/json') {
        code = 'invalid_content_type'; throw new ProbeFailure(name, code)
      }
      code = 'invalid_json'
      const data = await response.json()
      code = 'invalid_result'
      if (!validate(data)) throw new ProbeFailure(name, code)
      code = null
      return data
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') code = 'timeout'
      throw new ProbeFailure(name, code)
    } finally { checks.push({ name, ok: code === null, status, failure: code, elapsedMs: performance.now() - start }) }
  }
  const tokenResult = row => typeof row.token === 'string' && row.token.length === 43
  const line = name => step(name, '/auth/line', null, { idToken: 'synthetic-availability-line' }, 200, tokenResult)
  const login = role => step(`${role}_login`, '/auth/login', null,
    { username: `synthetic-${role}`, password: syntheticPassword }, 200, tokenResult)
  let health = false
  try { await step('database_health', '/health', null, undefined, 200, row => row.status === 'ok'); health = true }
  catch (error) { if (!(error instanceof ProbeFailure)) throw error }
  let failure = null
  try {
    let citizen = (await line('line_identity')).token
    await step('citizen_identity', '/auth/me', citizen, undefined, 200, row => row.role === 'citizen')
    const consent = await step('current_consent', '/consents', citizen, { accepted: true, noticeVersion: 'development-v1' }, 201, row => !!row.id && row.accepted === true)
    let booking = await step('citizen_booking', '/bookings', citizen, {
      consentId: consent.id, bookingFor: 'self', patientName: 'ผู้ป่วยสังเคราะห์ตรวจบริการ', requesterName: 'ผู้ขอสังเคราะห์',
      contactPhone: '0800000000', pickupAddress: 'จุดรับสังเคราะห์', latitude: 18.59, longitude: 99.05,
      villageId: '30000000-0000-4000-8000-000000000001', hospitalId: '40000000-0000-4000-8000-000000000001',
      mobility: 'standard', appointmentAt: '2030-01-15T09:00:00+07:00',
    }, 201, row => !!row.id && !!row.reference && row.status === 'REQUESTED')
    const id = booking.id, reference = booking.reference
    await step('citizen_status', `/bookings/${id}`, citizen, undefined, 200, row => row.id === id && row.status === 'REQUESTED')
    const dispatcher = (await login('dispatcher')).token
    await step('dispatcher_review', `/bookings/${id}/review`, dispatcher, undefined, 200, row => row.bookingId === id && Array.isArray(row.history))
    const command = (row, type) => ({ eventId: randomUUID(), expectedRevision: row.revision, expectedExecutionVersion: row.executionVersion, command: { type } })
    booking = await step('dispatcher_approval', `/bookings/${id}/commands`, dispatcher, command(booking, 'APPROVE'), 200, row => row.status === 'APPROVED')
    const selection = row => ({ eventId: randomUUID(), expectedRevision: row.revision,
      vehicleId: '50000000-0000-4000-8000-000000000001', driverId: '60000000-0000-4000-8000-000000000001',
      originLocationId: '20000000-0000-4000-8000-000000000001' })
    booking = await step('dispatcher_schedule', `/bookings/${id}/schedule`, dispatcher, selection(booking), 200, row => row.status === 'SCHEDULED')
    booking = await step('dispatcher_assignment', `/bookings/${id}/assignment`, dispatcher, selection(booking), 200, row => row.status === 'ASSIGNED' && !!row.schedule?.departureAt)
    control.now = booking.schedule.departureAt
    const driver = (await login('driver')).token
    await beforeDriverAccess()
    await step('driver_jobs', '/bookings', driver, undefined, 200, row => Array.isArray(row.bookings) && row.bookings.some(item => item.id === id))
    booking = await step('driver_record', `/bookings/${id}/commands`, driver, command(booking, 'START_TRIP'), 200, row => row.id === id && row.status === 'ASSIGNED' && !!row.startedAt)
    citizen = (await line('citizen_reauthentication')).token
    await step('citizen_current_status', `/bookings/${id}`, citizen, undefined, 200, row => row.reference === reference && row.startedAt === booking.startedAt)
  } catch (error) {
    if (!(error instanceof ProbeFailure)) throw error
    failure = { check: error.step, code: error.code }
  }
  return { scope: 'isolated synthetic mutating canary; not live availability', observedAt, finishedAt: new Date().toISOString(),
    elapsedMs: performance.now() - started, state: failure ? 'unavailable' : 'available', databaseHealthOk: health, failure, checks }
}
