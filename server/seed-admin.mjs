import { randomUUID } from 'node:crypto'
import { check, fields } from './errors.mjs'

const SEED_VILLAGES = [
  { number: 1, name: 'บ้านกลาง', lat: 18.5795, lng: 99.0435 },
  { number: 2, name: 'บ้านท่าล้อ', lat: 18.5842, lng: 99.0352 },
  { number: 3, name: 'บ้านพญาผาบ', lat: 18.5758, lng: 99.0510 },
  { number: 4, name: 'บ้านสันป่ายางหน่อม', lat: 18.5890, lng: 99.0468 },
  { number: 5, name: 'บ้านศรีชุม', lat: 18.5934, lng: 99.0385 },
  { number: 6, name: 'บ้านฮ่องกอม่วง', lat: 18.5978, lng: 99.0492 },
  { number: 7, name: 'บ้านแม่ตีบ', lat: 18.5812, lng: 99.0604 },
  { number: 8, name: 'บ้านดอยคำ', lat: 18.5695, lng: 99.0568 },
  { number: 9, name: 'บ้านสันป่าสัก', lat: 18.5712, lng: 99.0378 },
  { number: 10, name: 'บ้านขี้เหล็ก', lat: 18.5865, lng: 99.0275 },
  { number: 11, name: 'บ้านแม่สารป่าขาม', lat: 18.6015, lng: 99.0342 },
  { number: 12, name: 'บ้านใหม่สันป่ายาง', lat: 18.5920, lng: 99.0562 },
]

const STARTED_STATUSES = ['PICKING_UP', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED', 'ABORTED']
const UNSTARTED_STATUSES = ['REQUESTED', 'APPROVED', 'SCHEDULED', 'REJECTED']

export async function importSeedBookings(client, user, body, now) {
  check(user.role === 'admin', 403, 'Administrator authority required')
  fields(body, ['bookings', 'replace'], ['bookings'])
  check(Array.isArray(body.bookings) && body.bookings.length > 0 && body.bookings.length <= 1000, 400, 'Between 1 and 1000 seed bookings required')

  if (body.replace) {
    await deleteSeedRows(client)
  }

  let { rows: [seedUser] } = await client.query(`SELECT id FROM patient_transfer.users WHERE username='seed-citizen-batch' AND role='citizen'`)
  if (!seedUser) {
    const { rows: [created] } = await client.query(
      `INSERT INTO patient_transfer.users(role, display_name, username, active) VALUES('citizen', 'บัญชีข้อมูลจำลองเทศบาล', 'seed-citizen-batch', true) RETURNING id`,
    )
    seedUser = created
  }

  let { rows: [consent] } = await client.query(
    `SELECT id FROM patient_transfer.consent_records WHERE user_id=$1 AND accepted=true ORDER BY recorded_at DESC LIMIT 1`,
    [seedUser.id],
  )
  if (!consent) {
    const { rows: [createdConsent] } = await client.query(
      `INSERT INTO patient_transfer.consent_records(user_id, notice_version, accepted, recorded_at) VALUES($1, 'seed-v1', true, $2) RETURNING id`,
      [seedUser.id, now],
    )
    consent = createdConsent
  }

  const { rows: existingSettings } = await client.query(`SELECT depot_location_id FROM patient_transfer.service_settings`)
  let depotLocationId = existingSettings[0]?.depot_location_id
  if (!depotLocationId) {
    const { rows: [depotLoc] } = await client.query(
      `INSERT INTO patient_transfer.locations(name, kind, point) VALUES('ศูนย์รถเทศบาลตำบลบ้านกลาง', 'depot', ST_SetSRID(ST_MakePoint(99.0422, 18.5835), 4326)::geography) RETURNING id`,
    )
    depotLocationId = depotLoc.id
    await client.query(`INSERT INTO patient_transfer.service_settings(depot_location_id, depot_name) VALUES($1, 'ศูนย์รถเทศบาลตำบลบ้านกลาง') ON CONFLICT DO NOTHING`, [depotLocationId])
  }

  const villageMap = new Map()
  for (const sv of SEED_VILLAGES) {
    let { rows: [row] } = await client.query(`SELECT id FROM patient_transfer.service_villages WHERE village_number=$1`, [sv.number])
    if (!row) {
      const { rows: [inserted] } = await client.query(
        `INSERT INTO patient_transfer.service_villages(village_number, name, center, radius_metres)
         VALUES($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, 1500) RETURNING id`,
        [sv.number, sv.name, sv.lng, sv.lat],
      )
      row = inserted
    }
    villageMap.set(`village-${String(sv.number).padStart(2, '0')}`, row.id)
    villageMap.set(String(sv.number), row.id)
  }

  const hospitalMap = new Map()
  const { rows: existingHospitals } = await client.query(`SELECT id, name FROM patient_transfer.hospitals`)
  for (const h of existingHospitals) hospitalMap.set(h.name, h.id)

  let importedCount = 0
  for (const item of body.bookings) {
    const reference = String(item.reference || item.id || `BK-SEED-${randomUUID().slice(0, 8)}`).slice(0, 80)
    const normalizedRef = reference.startsWith('BK-SEED-') || reference.startsWith('BK-CSV-') ? reference : `BK-SEED-${reference}`
    const hospitalName = String(item.details?.hospital || item.hospitalName || 'โรงพยาบาลลำพูน').trim()
    let hospitalId = hospitalMap.get(hospitalName)
    if (!hospitalId) {
      const { rows: [loc] } = await client.query(
        `INSERT INTO patient_transfer.locations(name, kind, point) VALUES($1, 'hospital', ST_SetSRID(ST_MakePoint(99.0086, 18.5778), 4326)::geography) RETURNING id`,
        [hospitalName],
      )
      const { rows: [hosp] } = await client.query(
        `INSERT INTO patient_transfer.hospitals(location_id, name) VALUES($1, $2) RETURNING id`,
        [loc.id, hospitalName],
      )
      hospitalId = hosp.id
      hospitalMap.set(hospitalName, hospitalId)
    }

    const villageKey = String(item.details?.villageId || 'village-01')
    const villageId = villageMap.get(villageKey) || villageMap.get('village-01')
    const apptAt = new Date(Date.parse(item.appointmentAt)).toISOString()
    const rawCreated = item.createdAt && Number.isFinite(Date.parse(item.createdAt)) ? Date.parse(item.createdAt) : Date.parse(apptAt) - 72 * 3600000
    const submittedAt = new Date(Math.min(rawCreated, Date.parse(apptAt) - 48 * 3600000)).toISOString()

    const rawApi = String(item.apiStatus || '').toUpperCase()
    const status = ['REQUESTED', 'APPROVED', 'SCHEDULED', 'ASSIGNED', 'PICKING_UP', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED', 'REJECTED', 'ABORTED'].includes(rawApi)
      ? rawApi
      : 'REQUESTED'

    const startedAt = STARTED_STATUSES.includes(status)
      ? (item.startedAt && Number.isFinite(Date.parse(item.startedAt)) ? new Date(Date.parse(item.startedAt)).toISOString() : new Date(Date.parse(apptAt) - 45 * 60000).toISOString())
      : (UNSTARTED_STATUSES.includes(status) ? null : null)

    const mobilityRaw = item.mobility || item.details?.assistance
    const mobility = mobilityRaw === 'wheelchair' || String(mobilityRaw).includes('รถเข็น')
      ? 'wheelchair'
      : mobilityRaw === 'stretcher' || String(mobilityRaw).includes('เปลนอน')
        ? 'stretcher'
        : 'standard'

    const phoneRaw = String(item.details?.phone || item.contactPhone || '0800000000').replace(/\D/g, '')
    const contactPhone = /^0\d{9}$/.test(phoneRaw) ? phoneRaw : '0800000000'
    const bookingFor = item.details?.bookingFor === 'other' ? 'other' : 'self'
    const assistance = (item.details?.extras ?? [])
      .map(v => String(v).includes('พยุง') || v === 'boarding_support' ? 'boarding_support' : String(v).includes('ผู้ดูแล') || v === 'caregiver_accompanies' ? 'caregiver_accompanies' : '')
      .filter((v, idx, arr) => v && arr.indexOf(v) === idx)

    const lat = Number(item.details?.pickup?.latitude ?? 18.5835)
    const lng = Number(item.details?.pickup?.longitude ?? 99.0422)

    await client.query(
      `INSERT INTO patient_transfer.bookings(
        reference, requester_id, consent_id, patient_name, requester_name, contact_phone,
        pickup_address, pickup_point, landmark, village_id, hospital_id, mobility,
        submitted_at, appointment_at, status, started_at, booking_for, assistance
      ) VALUES($1,$2,$3,$4,$5,$6,$7,ST_SetSRID(ST_MakePoint($8,$9),4326)::geography,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (reference) DO NOTHING`,
      [
        normalizedRef,
        seedUser.id,
        consent.id,
        String(item.patientName || 'ผู้ป่วยจำลอง').slice(0, 120),
        String(item.details?.contactName || item.patientName || 'ผู้ติดต่อจำลอง').slice(0, 120),
        contactPhone,
        String(item.details?.pickupAddress || item.details?.pickup?.label || 'ต.บ้านกลาง อ.เมืองลำพูน').slice(0, 1000),
        Number.isFinite(lng) ? lng : 99.0422,
        Number.isFinite(lat) ? lat : 18.5835,
        String(item.details?.landmark || '').slice(0, 1000),
        villageId,
        hospitalId,
        mobility,
        submittedAt,
        apptAt,
        status,
        startedAt,
        bookingFor,
        assistance,
      ],
    )
    importedCount++
  }

  await client.query(
    `INSERT INTO patient_transfer.audit_logs(actor_id, action, entity_type, reason, recorded_at)
     VALUES($1, 'SEED_IMPORT', 'seed_data', $2, $3)`,
    [user.id, `Imported ${importedCount} seed bookings`, now],
  )

  return { importedCount, persistedToDatabase: true }
}

async function deleteSeedRows(client) {
  const { rows: targetRows } = await client.query(
    `SELECT b.id FROM patient_transfer.bookings b
     WHERE (b.reference LIKE 'BK-SEED-%' OR b.reference LIKE 'BK-CSV-%')
       AND NOT EXISTS (SELECT 1 FROM patient_transfer.trip_events e WHERE e.booking_id = b.id)`,
  )
  const ids = targetRows.map(r => r.id)
  if (!ids.length) return 0

  await client.query(`DELETE FROM patient_transfer.configuration_reviews WHERE booking_id = ANY($1::uuid[])`, [ids])
  await client.query(`DELETE FROM patient_transfer.verification_logs WHERE booking_id = ANY($1::uuid[])`, [ids])
  await client.query(`DELETE FROM patient_transfer.notifications WHERE booking_id = ANY($1::uuid[])`, [ids])
  await client.query(`DELETE FROM patient_transfer.dispatcher_alerts WHERE booking_id = ANY($1::uuid[])`, [ids])
  await client.query(`DELETE FROM patient_transfer.trip_incidents WHERE booking_id = ANY($1::uuid[])`, [ids])
  await client.query(`DELETE FROM patient_transfer.resource_holds WHERE booking_id = ANY($1::uuid[])`, [ids])
  await client.query(`DELETE FROM patient_transfer.trip_route_legs WHERE booking_id = ANY($1::uuid[])`, [ids])
  await client.query(`DELETE FROM patient_transfer.schedules WHERE booking_id = ANY($1::uuid[])`, [ids])
  const { rowCount } = await client.query(`DELETE FROM patient_transfer.bookings WHERE id = ANY($1::uuid[])`, [ids])
  return rowCount
}

export async function resetSeedBookings(client, user, body, now) {
  check(user.role === 'admin', 403, 'Administrator authority required')
  check(body?.confirm === true, 400, 'Confirmation required to reset seed data')
  const deletedCount = await deleteSeedRows(client)
  await client.query(
    `INSERT INTO patient_transfer.audit_logs(actor_id, action, entity_type, reason, recorded_at)
     VALUES($1, 'SEED_RESET', 'seed_data', $2, $3)`,
    [user.id, `Cleared ${deletedCount} mock/seed bookings`, now],
  )
  return { deletedCount, persistedToDatabase: true }
}

export async function adminAnalytics(client, user) {
  check(['admin', 'dispatcher'].includes(user.role), 403, 'Analytics authority required')
  const { rows: [agg] } = await client.query(`
    SELECT
      (SELECT count(*)::int FROM patient_transfer.bookings) AS total_bookings,
      (SELECT coalesce(json_agg(json_build_object('status', status, 'count', c)), '[]'::json)
        FROM (SELECT status::text, count(*)::int AS c FROM patient_transfer.bookings GROUP BY status) s) AS statuses,
      (SELECT coalesce(json_agg(json_build_object('month', m, 'count', c) ORDER BY m), '[]'::json)
        FROM (SELECT to_char(appointment_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') AS m, count(*)::int AS c FROM patient_transfer.bookings GROUP BY 1) t) AS monthly,
      (SELECT coalesce(json_agg(json_build_object('hour', h, 'count', c) ORDER BY h), '[]'::json)
        FROM (SELECT EXTRACT(HOUR FROM appointment_at AT TIME ZONE 'Asia/Bangkok')::int AS h, count(*)::int AS c FROM patient_transfer.bookings GROUP BY 1) hr) AS hourly,
      (SELECT coalesce(json_agg(json_build_object('villageNumber', sv.village_number, 'villageName', sv.name, 'count', coalesce(vb.c, 0)) ORDER BY sv.village_number), '[]'::json)
        FROM patient_transfer.service_villages sv
        LEFT JOIN (SELECT village_id, count(*)::int AS c FROM patient_transfer.bookings GROUP BY village_id) vb ON vb.village_id = sv.id) AS villages,
      (SELECT coalesce(json_agg(json_build_object('mobility', mobility::text, 'count', c)), '[]'::json)
        FROM (SELECT mobility, count(*)::int AS c FROM patient_transfer.bookings GROUP BY mobility) m) AS mobility,
      (SELECT coalesce(json_agg(json_build_object('hospitalName', hname, 'count', c) ORDER BY c DESC, hname), '[]'::json)
        FROM (SELECT COALESCE(b.hospital_name_snapshot, h.name, 'ไม่ระบุโรงพยาบาล') AS hname, count(*)::int AS c
          FROM patient_transfer.bookings b LEFT JOIN patient_transfer.hospitals h ON h.id = b.hospital_id GROUP BY 1) hs) AS hospitals,
      (SELECT count(DISTINCT (appointment_at AT TIME ZONE 'Asia/Bangkok')::date)::int FROM patient_transfer.bookings) AS active_days,
      (SELECT count(*)::int FROM patient_transfer.vehicles WHERE active) AS active_vehicles,
      (SELECT count(*)::int FROM patient_transfer.vehicles) AS total_vehicles
  `)
  return agg
}
