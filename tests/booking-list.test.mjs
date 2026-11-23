import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookingList } from '../server/booking-lists.mjs'

test('full pages hydrate once and restore cursor ordering even if database hydration order differs', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    cursor_at: '2030-01-15T02:00:00.123456Z', status: 'REQUESTED' }))
  const queries = []
  const client = { async query(sql, values) {
    queries.push({ sql, values })
    if (sql.includes(' AS cursor_at')) return { rows }
    if (sql.startsWith('SELECT b.*,b.hospital_location_snapshot')) return { rows: rows.slice(0, 100).reverse() }
    return { rows: [] }
  } }
  const result = await bookingList(client, { id: 'dispatcher', role: 'dispatcher' }, null, row => ({ id: row.id }))
  assert.deepEqual(result.bookings.map(row => row.id), rows.slice(0, 100).map(row => row.id))
  assert.equal(queries.length, 4, 'One snapshot begin, selection, bulk hydration and commit per page')
  assert.deepEqual(queries[2].values, [rows.slice(0, 100).map(row => row.id)])
  assert.equal(JSON.parse(Buffer.from(result.nextCursor, 'base64url')).at, rows[99].cursor_at)
})

test('bulk hydration still rejects a foreign owner and rolls back the page', async () => {
  const statements = []
  const client = { async query(sql) {
    statements.push(sql)
    if (sql.includes(' AS cursor_at')) return { rows: [{ id: 'selected' }] }
    if (sql.startsWith('SELECT b.*,b.hospital_location_snapshot')) return { rows: [{ id: 'selected', requester_id: 'foreign' }] }
    return { rows: [] }
  } }
  await assert.rejects(bookingList(client, { id: 'owner', role: 'citizen' }, null, row => row), { status: 403 })
  assert.equal(statements.at(-1), 'ROLLBACK')
})

test('future driver pages scope the query and project only planned times and reference', async () => {
  const row = { id: '00000000-0000-4000-8000-000000000001', reference: 'BK-future', status: 'ASSIGNED',
    appointmentAt: '2030-01-16T02:00:00Z', departureAt: '2030-01-16T00:50:00Z', pickupAt: '2030-01-16T01:05:00Z',
    patientName: 'Synthetic private field', cursor_at: '2030-01-16T02:00:00.000000Z' }
  const driver = { id: 'driver-user', role: 'driver', driver_id: 'assigned-driver', service_day: '2030-01-15', in_shift: false }
  const queries = []
  const client = { async query(sql, values) {
    queries.push({ sql, values })
    return { rows: sql.includes(' AS cursor_at') ? [row] : [] }
  } }
  const result = await bookingList(client, driver, null, () => assert.fail('Future jobs must not be hydrated'), 'future')
  assert.deepEqual(queries[1].values, ['assigned-driver', '2030-01-15'])
  assert.match(queries[1].sql, /s\.driver_id=\$1 AND b\.status='ASSIGNED' AND b\.started_at IS NULL/)
  assert.match(queries[1].sql, /::date>\$2::date/)
  const { patientName, cursor_at, ...summary } = row
  assert.deepEqual(result, { bookings: [summary], nextCursor: null })
  await assert.rejects(bookingList(client, { ...driver, role: 'dispatcher' }, null, row => row, 'future'), { status: 403 })
})
