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
