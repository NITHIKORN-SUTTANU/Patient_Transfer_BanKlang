import { check, uuid } from './errors.mjs'
import { authorizeBooking, bookingRows } from './repository.mjs'

const pageSize = 100
function readCursor(value, scope) {
  if (value === null) return null
  check(value.length <= 1000 && /^[A-Za-z0-9_-]+$/.test(value), 400, 'Invalid list cursor')
  let cursor
  try { cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) } catch { check(false, 400, 'Invalid list cursor') }
  check(cursor && cursor.scope === scope && typeof cursor.at === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.at) && Number.isFinite(Date.parse(cursor.at)), 400, 'Invalid list cursor')
  uuid(cursor.id)
  return cursor
}

// Each page has one database snapshot, including scoped selection and hydration.
// Cursors are positions, not authorization; recheck the authenticated scope every page.
export async function bookingList(client, user, value, serialize, history = false) {
  check(history ? user.role === 'driver' : ['dispatcher', 'citizen', 'driver'].includes(user.role), 403, 'Scoped booking access required')
  const scope = `${history ? 'history' : 'bookings'}:${user.role}:${user.id}:${user.driver_id ?? ''}`
  const cursor = readCursor(value, scope)
  const values = []
  const param = value => { values.push(value); return `$${values.length}` }
  const terminal = "('COMPLETED','CANCELLED','REJECTED','ABORTED')"
  let filter = 'true'
  let join = 'LEFT JOIN patient_transfer.schedules s ON s.booking_id=b.id AND s.committed AND s.released_at IS NULL'
  if (history) {
    join = 'JOIN LATERAL(SELECT driver_id FROM patient_transfer.schedules s WHERE s.booking_id=b.id AND s.committed ORDER BY s.created_at DESC,s.id DESC LIMIT 1) latest ON true'
    filter = `latest.driver_id=${param(user.driver_id)} AND b.status IN ${terminal}`
  } else if (user.role === 'citizen') filter = `b.requester_id=${param(user.id)}`
  else if (user.role === 'driver') filter = `s.driver_id=${param(user.driver_id)} AND b.status NOT IN ${terminal} AND
    (b.started_at IS NOT NULL OR (${param(user.in_shift)}::boolean AND (s.departure_at AT TIME ZONE 'Asia/Bangkok')::date=${param(user.service_day)}::date))`
  if (cursor) filter += ` AND (b.appointment_at,b.id) ${history ? '<' : '>'} (${param(cursor.at)}::timestamptz,${param(cursor.id)}::uuid)`
  const direction = history ? 'DESC' : 'ASC'
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    const { rows } = await client.query(`SELECT b.id,b.reference,b.status,b.appointment_at AS "appointmentAt",
      to_char(b.appointment_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
      FROM patient_transfer.bookings b ${join} WHERE ${filter}
      ORDER BY b.appointment_at ${direction},b.id ${direction} LIMIT ${pageSize + 1}`, values)
    const page = rows.slice(0, pageSize)
    // Hydrate within the same snapshot in one round trip, then restore cursor order.
    const hydrated = history ? null : new Map((await bookingRows(client, page.map(row => row.id))).map(row => [row.id, row]))
    const bookings = []
    for (const row of page) {
      if (history) bookings.push({ id: row.id, reference: row.reference, status: row.status, appointmentAt: row.appointmentAt })
      else {
        const booking = hydrated.get(row.id)
        check(booking, 404, 'Booking not found')
        authorizeBooking(user, booking)
        bookings.push(serialize(booking, user))
      }
    }
    const last = page.at(-1)
    const nextCursor = rows.length > pageSize ? Buffer.from(JSON.stringify({ scope, at: last.cursor_at, id: last.id })).toString('base64url') : null
    await client.query('COMMIT')
    return { bookings, nextCursor }
  } catch (error) { await client.query('ROLLBACK'); throw error }
}
