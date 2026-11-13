import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { migrate } from '../scripts/database/migrate.mjs'

const adminUrl = process.env.DATABASE_TEST_ADMIN_URL
if (!adminUrl) throw new Error('DATABASE_TEST_ADMIN_URL required; tests create and remove an isolated local database')
const target = new URL(adminUrl)
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw new Error('Database tests require a local PostgreSQL server')
const databaseName = `pt_test_${randomUUID().replaceAll('-', '')}`
if (!/^pt_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Unsafe test database name')
const requester = '00000000-0000-4000-8000-000000000001'
const officer = '00000000-0000-4000-8000-000000000002'
const driverUser = '00000000-0000-4000-8000-000000000003'
const consent = '10000000-0000-4000-8000-000000000001'
const depot = '20000000-0000-4000-8000-000000000001'
const hospitalLocation = '20000000-0000-4000-8000-000000000002'
const village = '30000000-0000-4000-8000-000000000001'
const hospital = '40000000-0000-4000-8000-000000000001'
const vehicle = '50000000-0000-4000-8000-000000000001'
const vehicle2 = '50000000-0000-4000-8000-000000000002'
const driver = '60000000-0000-4000-8000-000000000001'
const appointment = '2030-01-15T09:00:00+07:00'

async function expectError(client, query, values, code, constraint) {
  await client.query('SAVEPOINT expected_failure')
  try {
    await assert.rejects(client.query(query, values), error => error.code === code && (!constraint || error.constraint === constraint))
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure')
    await client.query('RELEASE SAVEPOINT expected_failure')
  }
}
async function booking(client, appt = appointment) {
  const id = randomUUID()
  await client.query(`INSERT INTO patient_transfer.bookings
    (id, reference, requester_id, consent_id, patient_name, requester_name, contact_phone, pickup_address, pickup_point, village_id, hospital_id, mobility, submitted_at, appointment_at, status)
    VALUES ($1,$2,$3,$4,'Synthetic patient','Synthetic requester','0800000000','Synthetic address',ST_SetSRID(ST_MakePoint(99.05,18.59),4326)::geography,$5,$6,'standard','2030-01-12T00:00:00Z',$7,'SCHEDULED')`,
  [id, `SYNTHETIC-${id}`, requester, consent, village, hospital, appt])
  return id
}
const scheduleSql = `INSERT INTO patient_transfer.schedules
  (booking_id, vehicle_id, driver_id, origin_location_id, origin_kind, previous_booking_id, hospital_id, appointment_at,
  departure_at, pickup_at, arrival_at, ready_at, origin_to_pickup_seconds, pickup_to_hospital_seconds, routing_source, routed_at, committed)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,
    $8::timestamptz-interval '70 minutes', $8::timestamptz-interval '55 minutes',
    $8::timestamptz-interval '20 minutes', $8::timestamptz+interval '10 minutes',900,2100,'synthetic-test',now(),$9) RETURNING id`
const scheduleValues = (id, options = {}) => [id, options.vehicle ?? vehicle, driver, options.previous ? hospitalLocation : depot,
  options.previous ? 'previous_hospital' : 'depot', options.previous ?? null, hospital, options.appointment ?? appointment, options.committed ?? true]

test('PostgreSQL/PostGIS migrations and persistence rules', async t => {
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 10_000 })
  let client
  let created = false
  try {
    await admin.connect()
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    created = true
    target.pathname = `/${databaseName}`
    client = new pg.Client({ connectionString: target.toString(), connectionTimeoutMillis: 10_000 })
    await client.connect()
    await t.test('failed migration rolls back schema and migration ledger entry', async () => {
      const failing = { query: async (sql, values) => {
        const result = await client.query(sql, values)
        if (typeof sql === 'string' && sql.includes('CREATE SCHEMA patient_transfer;')) throw new Error('Injected migration failure')
        return result
      } }
      await assert.rejects(migrate(failing), /Injected migration failure/)
      assert.equal((await client.query("SELECT to_regnamespace('patient_transfer') AS schema")).rows[0].schema, null)
      assert.equal((await client.query('SELECT count(*)::int AS count FROM public.patient_transfer_migrations')).rows[0].count, 0)
    })
    await t.test('apply, repeat, empty rollback, and reapply succeed', async () => {
      assert.deepEqual(await migrate(client), ['001_foundation', '002_dispatch_changes', '003_api_support', '004_citizen_fields', '005_consent_decisions', '006_admin_accounts', '007_admin_resources', '008_service_administration', '009_destination_continuation', '010_notification_review', '011_notification_messages', '012_assignment_labels', '013_dispatch_review', '014_capacity_evidence'])
      assert.deepEqual(await migrate(client), [])
      assert.deepEqual(await migrate(client, 'status'), [{ id: '001_foundation', applied: true }, { id: '002_dispatch_changes', applied: true }, { id: '003_api_support', applied: true }, { id: '004_citizen_fields', applied: true }, { id: '005_consent_decisions', applied: true }, { id: '006_admin_accounts', applied: true }, { id: '007_admin_resources', applied: true }, { id: '008_service_administration', applied: true }, { id: '009_destination_continuation', applied: true }, { id: '010_notification_review', applied: true }, { id: '011_notification_messages', applied: true }, { id: '012_assignment_labels', applied: true }, { id: '013_dispatch_review', applied: true }, { id: '014_capacity_evidence', applied: true }])
      assert.deepEqual(await migrate(client, 'down'), ['014_capacity_evidence'])
      assert.deepEqual(await migrate(client, 'down'), ['013_dispatch_review'])
      assert.deepEqual(await migrate(client, 'down'), ['012_assignment_labels'])
      assert.deepEqual(await migrate(client, 'down'), ['011_notification_messages'])
      assert.deepEqual(await migrate(client, 'down'), ['010_notification_review'])
      assert.deepEqual(await migrate(client, 'down'), ['009_destination_continuation'])
      assert.deepEqual(await migrate(client, 'down'), ['008_service_administration'])
      assert.deepEqual(await migrate(client, 'down'), ['007_admin_resources'])
      assert.deepEqual(await migrate(client, 'down'), ['006_admin_accounts'])
      assert.deepEqual(await migrate(client, 'down'), ['005_consent_decisions'])
      assert.deepEqual(await migrate(client, 'down'), ['004_citizen_fields'])
      assert.deepEqual(await migrate(client, 'down'), ['003_api_support'])
      assert.deepEqual(await migrate(client, 'down'), ['002_dispatch_changes'])
      assert.deepEqual(await migrate(client, 'down'), ['001_foundation'])
      assert.equal((await client.query("SELECT to_regnamespace('patient_transfer') AS schema")).rows[0].schema, null)
      assert.deepEqual(await migrate(client), ['001_foundation', '002_dispatch_changes', '003_api_support', '004_citizen_fields', '005_consent_decisions', '006_admin_accounts', '007_admin_resources', '008_service_administration', '009_destination_continuation', '010_notification_review', '011_notification_messages', '012_assignment_labels', '013_dispatch_review', '014_capacity_evidence'])
    })
    const seed = await readFile(new URL('../database/seeds/development.sql', import.meta.url), 'utf8')
    for (let i = 0; i < 2; i++) {
      await client.query('BEGIN'); await client.query(seed); await client.query('COMMIT')
    }
    await t.test('synthetic seed repeats safely; populated rollback is refused', async () => {
      assert.equal((await client.query('SELECT count(*)::int AS count FROM patient_transfer.service_villages')).rows[0].count, 12)
      await assert.rejects(migrate(client, 'down'), /Rollback refused/)
      assert.equal((await migrate(client, 'status'))[0].applied, true)
    })
    async function isolated(name, work) {
      await t.test(name, async () => {
        await client.query('BEGIN')
        try {
          await client.query(`INSERT INTO patient_transfer.availability_windows(vehicle_id, starts_at, ends_at)
            SELECT id,'2030-01-15T06:00:00+07:00','2030-01-15T16:00:00+07:00' FROM patient_transfer.vehicles`)
          await client.query(`INSERT INTO patient_transfer.availability_windows(driver_id, starts_at, ends_at)
            VALUES ($1,'2030-01-15T06:00:00+07:00','2030-01-15T16:00:00+07:00')`, [driver])
          await work()
        } finally { await client.query('ROLLBACK') }
      })
    }
    await isolated('lead time, consent ownership, saved-profile ownership, and prohibited columns', async () => {
      const id = await booking(client)
      await expectError(client, 'UPDATE patient_transfer.bookings SET appointment_at = submitted_at + interval \'47 hours\' WHERE id = $1', [id], '23514')
      await client.query('UPDATE patient_transfer.bookings SET appointment_at = submitted_at + interval \'48 hours\' WHERE id = $1', [id])
      await expectError(client, 'UPDATE patient_transfer.bookings SET requester_id = $1 WHERE id = $2', [officer, id], '23503')
      await expectError(client, 'UPDATE patient_transfer.bookings SET consent_accepted = false WHERE id = $1', [id], '23514')
      const profile = randomUUID()
      await client.query(`INSERT INTO patient_transfer.patient_profiles(id,requester_id,patient_name,contact_phone,mobility,village_id,pickup_location_id)
        VALUES($1,$2,'Synthetic profile','0800000000','standard',$3,$4)`, [profile, officer, village, depot])
      await expectError(client, 'UPDATE patient_transfer.bookings SET patient_profile_id = $1 WHERE id = $2', [profile, id], '23503')
      await expectError(client, "UPDATE patient_transfer.bookings SET diagnosis = 'forbidden' WHERE id = $1", [id], '42703')
    })
    await isolated('PostGIS stores valid points and supports village checks', async () => {
      const result = await client.query(`SELECT ST_DWithin(v.center, l.point, v.radius_metres) AS inside
        FROM patient_transfer.service_villages v CROSS JOIN patient_transfer.locations l WHERE v.id=$1 AND l.id=$2`, [village, '20000000-0000-4000-8000-000000000003'])
      assert.equal(result.rows[0].inside, true)
    })
    await isolated('committed overlaps rejected, recommendations allowed, adjacent intervals allowed', async () => {
      const first = await booking(client)
      await client.query(scheduleSql, scheduleValues(first))
      const other = await booking(client)
      await client.query(scheduleSql, scheduleValues(other, { committed: false }))
      await expectError(client, scheduleSql, scheduleValues(other), '23P01')
      const nextTime = '2030-01-15T10:20:00+07:00'
      const next = await booking(client, nextTime)
      await client.query(scheduleSql, scheduleValues(next, { appointment: nextTime, previous: first }))
    })
    await isolated('driver overlap rejected even with a different vehicle', async () => {
      await client.query(scheduleSql, scheduleValues(await booking(client)))
      await expectError(client, scheduleSql, scheduleValues(await booking(client), { vehicle: vehicle2 }), '23P01', 'schedules_driver_no_overlap')
    })
    await isolated('message snapshot upgrade preserves legacy outbox without inventing event content',async()=>{
      const down=await readFile(new URL('../database/migrations/011_notification_messages.down.sql',import.meta.url),'utf8')
      const up=await readFile(new URL('../database/migrations/011_notification_messages.up.sql',import.meta.url),'utf8')
      await client.query(down)
      const id=randomUUID(),bookingId=await booking(client)
      await client.query(`INSERT INTO patient_transfer.notifications(id,booking_id,recipient_id,deduplication_key,template_key,status,attempts)
        VALUES($1,$2,$3,$4,'LEGACY_EVENT','FAILED',2)`,[id,bookingId,officer,`message-legacy:${id}`])
      const before=(await client.query('SELECT to_jsonb(n) AS row FROM patient_transfer.notifications n WHERE id=$1',[id])).rows[0].row
      await client.query(up)
      const after=(await client.query('SELECT to_jsonb(n) AS row FROM patient_transfer.notifications n WHERE id=$1',[id])).rows[0].row
      for(const key of Object.keys(before))assert.deepEqual(after[key],before[key])
      assert.equal(after.message_data,null);assert.equal(after.message_text,null);assert.equal(after.delivery_subject,null)
      assert.equal((await client.query('SELECT count(*)::int AS n FROM patient_transfer.dispatcher_alerts')).rows[0].n,0)
    })
    await isolated('notification review upgrade preserves delivery records without fabricating attempt history',async()=>{
      const down=await readFile(new URL('../database/migrations/010_notification_review.down.sql',import.meta.url),'utf8')
      const up=await readFile(new URL('../database/migrations/010_notification_review.up.sql',import.meta.url),'utf8')
      await client.query(down)
      const id=randomUUID(),bookingId=await booking(client)
      await client.query(`INSERT INTO patient_transfer.notifications(id,booking_id,recipient_id,deduplication_key,template_key,status,attempts,next_attempt_at,failure_code)
        VALUES($1,$2,$3,$4,'SYNTHETIC_LEGACY','FAILED',2,'2030-01-15T01:00:00Z','LINE_HTTP_503')`,[id,bookingId,officer,`legacy:${id}`])
      const before=(await client.query('SELECT to_jsonb(n) AS row FROM patient_transfer.notifications n WHERE id=$1',[id])).rows[0].row
      await client.query(up)
      const after=(await client.query('SELECT to_jsonb(n) AS row FROM patient_transfer.notifications n WHERE id=$1',[id])).rows[0].row
      for(const key of Object.keys(before)) assert.deepEqual(after[key],before[key])
      assert.equal(after.first_attempt_at,null);assert.equal(after.last_attempt_at,null)
      assert.equal((await client.query('SELECT count(*)::int AS n FROM patient_transfer.notification_attempts')).rows[0].n,0)
    })
    await isolated('capacity evidence upgrade preserves existing booking and reservation data',async()=>{
      const down=await readFile(new URL('../database/migrations/014_capacity_evidence.down.sql',import.meta.url),'utf8'),up=await readFile(new URL('../database/migrations/014_capacity_evidence.up.sql',import.meta.url),'utf8')
      await client.query(down)
      const id=await booking(client);await client.query(scheduleSql,scheduleValues(id))
      const snapshot=()=>client.query('SELECT to_jsonb(b) AS booking,to_jsonb(s) AS schedule FROM patient_transfer.bookings b JOIN patient_transfer.schedules s ON s.booking_id=b.id WHERE b.id=$1',[id])
      const before=(await snapshot()).rows
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');await client.query(up)
      assert.deepEqual((await snapshot()).rows,before)
      assert.equal((await client.query('SELECT count(*)::int AS n FROM patient_transfer.capacity_checks')).rows[0].n,0)
    })
    await isolated('verification upgrade preserves unknown historical outcomes and enforces append-only new records',async()=>{
      const down=await readFile(new URL('../database/migrations/013_dispatch_review.down.sql',import.meta.url),'utf8')
      const up=await readFile(new URL('../database/migrations/013_dispatch_review.up.sql',import.meta.url),'utf8')
      await client.query(down)
      const id=await booking(client),entry=randomUUID()
      await client.query("INSERT INTO patient_transfer.verification_logs(id,booking_id,actor_id,outcome,notes,recorded_at) VALUES($1,$2,$3,'unknown legacy result','Preserved operational note','2029-01-01')",[entry,id,officer])
      const before=(await client.query('SELECT to_jsonb(v) AS row FROM patient_transfer.verification_logs v WHERE id=$1',[entry])).rows[0].row
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');await client.query(up)
      const after=(await client.query('SELECT to_jsonb(v) AS row FROM patient_transfer.verification_logs v WHERE id=$1',[entry])).rows[0].row
      for(const key of Object.keys(before))assert.deepEqual(after[key],before[key])
      assert.equal(after.corrects_id,null)
      await expectError(client,"UPDATE patient_transfer.verification_logs SET notes='replace' WHERE id=$1",[entry],'55000')
      await expectError(client,"INSERT INTO patient_transfer.verification_logs(booking_id,actor_id,outcome) VALUES($1,$2,'invalid new outcome')",[id,officer],'23514')
    })
    await isolated('assignment label upgrade preserves old IDs without inventing historical names',async()=>{
      const down=await readFile(new URL('../database/migrations/012_assignment_labels.down.sql',import.meta.url),'utf8')
      const up=await readFile(new URL('../database/migrations/012_assignment_labels.up.sql',import.meta.url),'utf8')
      await client.query(down)
      const id=await booking(client)
      await client.query(scheduleSql,scheduleValues(id))
      const before=(await client.query('SELECT to_jsonb(s) AS row FROM patient_transfer.schedules s WHERE booking_id=$1',[id])).rows[0].row
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query(up)
      const after=(await client.query('SELECT to_jsonb(s) AS row FROM patient_transfer.schedules s WHERE booking_id=$1',[id])).rows[0].row
      for(const key of Object.keys(before))assert.deepEqual(after[key],before[key])
      for(const key of ['driver_user_snapshot','driver_name_snapshot','vehicle_name_snapshot','vehicle_plate_snapshot','origin_name_snapshot','hospital_name_snapshot'])assert.equal(after[key],null)
    })
    await isolated('destination continuation migration preserves existing bookings and planned schedules',async()=>{
      const down=await readFile(new URL('../database/migrations/009_destination_continuation.down.sql',import.meta.url),'utf8')
      const up=await readFile(new URL('../database/migrations/009_destination_continuation.up.sql',import.meta.url),'utf8')
      await client.query(down)
      const id=await booking(client)
      await client.query(scheduleSql,scheduleValues(id))
      const before=(await client.query('SELECT to_jsonb(b) AS booking,to_jsonb(s) AS schedule FROM patient_transfer.bookings b JOIN patient_transfer.schedules s ON s.booking_id=b.id WHERE b.id=$1',[id])).rows[0]
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query(up)
      assert.deepEqual((await client.query('SELECT to_jsonb(b) AS booking,to_jsonb(s) AS schedule FROM patient_transfer.bookings b JOIN patient_transfer.schedules s ON s.booking_id=b.id WHERE b.id=$1',[id])).rows[0],before)
      assert.equal((await client.query('SELECT count(*)::int AS n FROM patient_transfer.trip_route_legs')).rows[0].n,0)
    })
    await isolated('waiting migration preserves existing schedules with zero allowance', async () => {
      const down = await readFile(new URL('../database/migrations/002_dispatch_changes.down.sql', import.meta.url), 'utf8')
      const up = await readFile(new URL('../database/migrations/002_dispatch_changes.up.sql', import.meta.url), 'utf8')
      await client.query(down)
      const { rows: [saved] } = await client.query(scheduleSql, scheduleValues(await booking(client)))
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query(up)
      const { rows: [row] } = await client.query('SELECT pickup_waiting_seconds,departure_at FROM patient_transfer.schedules WHERE id=$1', [saved.id])
      assert.equal(row.pickup_waiting_seconds, 0)
      assert.equal(row.departure_at.toISOString(), new Date('2030-01-15T07:50:00+07:00').toISOString())
      await client.query(`UPDATE patient_transfer.schedules SET pickup_waiting_seconds=600,
        pickup_at=pickup_at-interval '10 minutes', departure_at=departure_at-interval '10 minutes' WHERE id=$1`, [saved.id])
      await expectError(client, 'UPDATE patient_transfer.schedules SET pickup_waiting_seconds=-1 WHERE id=$1', [saved.id], '23514')
    })
    await isolated('citizen migration preserves existing snapshots and unknown relationships', async () => {
      const down=await readFile(new URL('../database/migrations/004_citizen_fields.down.sql',import.meta.url),'utf8')
      const up=await readFile(new URL('../database/migrations/004_citizen_fields.up.sql',import.meta.url),'utf8')
      await client.query(down)
      const id=await booking(client)
      const {rows:[profile]}=await client.query(`INSERT INTO patient_transfer.patient_profiles(requester_id,patient_name,contact_phone,mobility,village_id,pickup_location_id)
        VALUES($1,'Saved synthetic patient','0800000000','standard',$2,$3) RETURNING id`,[requester,village,'20000000-0000-4000-8000-000000000003'])
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query(up)
      const {rows:[row]}=await client.query('SELECT patient_name,contact_phone,booking_for,assistance FROM patient_transfer.bookings WHERE id=$1',[id])
      assert.equal(row.patient_name,'Synthetic patient')
      assert.equal(row.contact_phone,'0800000000')
      assert.equal(row.booking_for,null)
      assert.deepEqual(row.assistance,[])
      await expectError(client,"UPDATE patient_transfer.bookings SET assistance=ARRAY['boarding_support',NULL] WHERE id=$1",[id],'23514')
      await expectError(client,"UPDATE patient_transfer.bookings SET booking_for='invented' WHERE id=$1",[id],'23514')
      const {rows:[saved]}=await client.query('SELECT assistance,landmark FROM patient_transfer.patient_profiles WHERE id=$1',[profile.id])
      assert.deepEqual(saved.assistance,[])
      assert.equal(saved.landmark,'')
      await expectError(client,"UPDATE patient_transfer.patient_profiles SET assistance=ARRAY['clinical'] WHERE id=$1",[profile.id],'23514')
      await expectError(client,"UPDATE patient_transfer.patient_profiles SET landmark=repeat('ก',1001) WHERE id=$1",[profile.id],'23514')
    })
    await isolated('consent ordering upgrade preserves history and resolves timestamp ties conservatively', async () => {
      await client.query(await readFile(new URL('../database/migrations/005_consent_decisions.down.sql',import.meta.url),'utf8'))
      await client.query(`INSERT INTO patient_transfer.consent_records(user_id,notice_version,accepted,recorded_at)
        VALUES($1,'synthetic-notice-v1',false,'2029-01-01T00:00:00Z')`,[requester])
      const before=(await client.query('SELECT to_jsonb(c) AS value FROM patient_transfer.consent_records c ORDER BY id')).rows
      await client.query(await readFile(new URL('../database/migrations/005_consent_decisions.up.sql',import.meta.url),'utf8'))
      assert.deepEqual((await client.query("SELECT to_jsonb(c)-'decision_order' AS value FROM patient_transfer.consent_records c ORDER BY id")).rows,before)
      const latest=()=>client.query('SELECT accepted FROM patient_transfer.consent_records WHERE user_id=$1 ORDER BY decision_order DESC LIMIT 1',[requester])
      assert.equal((await latest()).rows[0].accepted,false)
      await client.query(`INSERT INTO patient_transfer.consent_records(user_id,notice_version,accepted,recorded_at)
        VALUES($1,'synthetic-notice-v1',true,'2029-01-01T00:00:00Z')`,[requester])
      assert.equal((await latest()).rows[0].accepted,true)
    })
    await isolated('admin account migration preserves existing identities and advances revisions', async () => {
      await client.query(await readFile(new URL('../database/migrations/006_admin_accounts.down.sql',import.meta.url),'utf8'))
      const before=(await client.query('SELECT to_jsonb(u) AS value FROM patient_transfer.users u WHERE id=$1',[officer])).rows[0].value
      await client.query(await readFile(new URL('../database/migrations/006_admin_accounts.up.sql',import.meta.url),'utf8'))
      const after=(await client.query("SELECT to_jsonb(u)-'revision' AS value FROM patient_transfer.users u WHERE id=$1",[officer])).rows[0].value
      assert.deepEqual(after,before)
      await client.query("UPDATE patient_transfer.users SET display_name='Synthetic revised staff' WHERE id=$1",[officer])
      assert.equal(Number((await client.query('SELECT revision FROM patient_transfer.users WHERE id=$1',[officer])).rows[0].revision),2)
    })
    await isolated('resource migration preserves configured positions, capabilities and existing windows', async () => {
      await client.query(await readFile(new URL('../database/migrations/007_admin_resources.down.sql',import.meta.url),'utf8'))
      const vehicleBefore=(await client.query('SELECT to_jsonb(v) AS value FROM patient_transfer.vehicles v WHERE id=$1',[vehicle])).rows[0].value
      const driverBefore=(await client.query('SELECT to_jsonb(d) AS value FROM patient_transfer.drivers d WHERE id=$1',[driver])).rows[0].value
      const windowsBefore=(await client.query('SELECT to_jsonb(w) AS value FROM patient_transfer.availability_windows w ORDER BY id')).rows
      await client.query(await readFile(new URL('../database/migrations/007_admin_resources.up.sql',import.meta.url),'utf8'))
      assert.deepEqual((await client.query("SELECT to_jsonb(v)-ARRAY['revision','vehicle_type'] AS value FROM patient_transfer.vehicles v WHERE id=$1",[vehicle])).rows[0].value,vehicleBefore)
      assert.deepEqual((await client.query("SELECT to_jsonb(d)-ARRAY['revision','phone'] AS value FROM patient_transfer.drivers d WHERE id=$1",[driver])).rows[0].value,driverBefore)
      assert.deepEqual((await client.query("SELECT to_jsonb(w)-ARRAY['revision','retired_at'] AS value FROM patient_transfer.availability_windows w ORDER BY id")).rows,windowsBefore)
    })
    await isolated('resource metadata and windows cannot invalidate unfinished assignments', async () => {
      const id=await booking(client)
      await client.query(scheduleSql,scheduleValues(id))
      await expectError(client,"UPDATE patient_transfer.vehicles SET capabilities=ARRAY['wheelchair']::patient_transfer.mobility_type[] WHERE id=$1",[vehicle],'23514')
      await expectError(client,'UPDATE patient_transfer.drivers SET user_id=$2 WHERE id=$1',[driver,officer],'23514')
      const {rows:[window]}=await client.query('SELECT * FROM patient_transfer.availability_windows WHERE vehicle_id=$1',[vehicle])
      await expectError(client,"UPDATE patient_transfer.availability_windows SET ends_at='2030-01-15T08:00:00+07:00' WHERE id=$1",[window.id],'23514')
      await expectError(client,'DELETE FROM patient_transfer.availability_windows WHERE id=$1',[window.id],'23514')
      const {rows:[alternative]}=await client.query('INSERT INTO patient_transfer.availability_windows(vehicle_id,starts_at,ends_at) VALUES($1,$2,$3) RETURNING id',[vehicle,window.starts_at,window.ends_at])
      await client.query('UPDATE patient_transfer.availability_windows SET retired_at=now() WHERE id=$1',[window.id])
      await client.query("UPDATE patient_transfer.bookings SET status='CANCELLED' WHERE id=$1",[id])
      await client.query('UPDATE patient_transfer.schedules SET released_at=now() WHERE booking_id=$1',[id])
      await client.query('UPDATE patient_transfer.availability_windows SET retired_at=now() WHERE id=$1',[alternative.id])
      await expectError(client,scheduleSql,scheduleValues(await booking(client)),'23514')
    })
    await isolated('held driver identity and position cannot be reset by metadata updates', async () => {
      const id=await booking(client)
      await client.query("UPDATE patient_transfer.bookings SET status='CANCELLED' WHERE id=$1",[id])
      await client.query("INSERT INTO patient_transfer.resource_holds(driver_id,booking_id,starts_at,reason,created_by) VALUES($1,$2,now(),'Synthetic unresolved hold',$3)",[driver,id,officer])
      await expectError(client,'UPDATE patient_transfer.drivers SET user_id=$2 WHERE id=$1',[driver,officer],'23514')
      await expectError(client,'UPDATE patient_transfer.drivers SET location_id=$2 WHERE id=$1',[driver,hospitalLocation],'23514')
      await client.query("UPDATE patient_transfer.drivers SET phone='0800000000' WHERE id=$1",[driver])
      assert.equal((await client.query('SELECT count(*)::int AS count FROM patient_transfer.resource_holds WHERE driver_id=$1 AND ends_at IS NULL',[driver])).rows[0].count,1)
    })
    await isolated('resources with unfinished assignments cannot be deactivated', async () => {
      await client.query(scheduleSql, scheduleValues(await booking(client)))
      await expectError(client, 'UPDATE patient_transfer.vehicles SET active=false WHERE id=$1', [vehicle], '23514')
      await expectError(client, 'UPDATE patient_transfer.drivers SET active=false WHERE id=$1', [driver], '23514')
    })
    await isolated('ABORTED requires actual start and patient disposition at transaction boundary', async () => {
      const id = await booking(client)
      await expectError(client, "UPDATE patient_transfer.bookings SET status='ABORTED' WHERE id=$1", [id], '23514')
      await client.query("UPDATE patient_transfer.bookings SET status='ABORTED',started_at='2030-01-15T07:50:00+07:00' WHERE id=$1", [id])
      await expectError(client, 'SET CONSTRAINTS ALL IMMEDIATE', [], '23514')
      await client.query(`INSERT INTO patient_transfer.trip_dispositions(booking_id,recorded_by,reason,ended_at,end_location,patient_arrangement,recorded_at)
        VALUES($1,$2,'Synthetic transport ended','2030-01-15T08:30:00+07:00','Synthetic location','Synthetic authorized caregiver handoff','2030-01-15T08:35:00+07:00')`, [id, officer])
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    })
    await isolated('service hours, shifts, holds, and capability guards reject unsafe assignments', async () => {
      const early = '2030-01-15T07:09:00+07:00'
      await expectError(client, scheduleSql, scheduleValues(await booking(client, early), { appointment: early }), '23514')
      const id = await booking(client)
      await client.query(`INSERT INTO patient_transfer.resource_holds(vehicle_id,starts_at,reason,created_by)
        VALUES($1,'2030-01-15T06:00:00+07:00','Synthetic readiness hold',$2)`, [vehicle, officer])
      await expectError(client, scheduleSql, scheduleValues(id), '23514')
      await client.query('DELETE FROM patient_transfer.resource_holds')
      await client.query("UPDATE patient_transfer.bookings SET mobility='stretcher' WHERE id=$1", [id])
      await expectError(client, scheduleSql, scheduleValues(id), '23514')
      await client.query("UPDATE patient_transfer.bookings SET mobility='standard' WHERE id=$1", [id])
      await client.query('DELETE FROM patient_transfer.availability_windows WHERE driver_id=$1', [driver])
      await expectError(client, scheduleSql, scheduleValues(id), '23514')
    })
    await isolated('closure flags existing assignments without cancelling and blocks new commitments', async () => {
      const id = await booking(client)
      await client.query(scheduleSql, scheduleValues(id))
      await client.query("INSERT INTO patient_transfer.service_closures(closed_on,reason,created_by) VALUES('2030-01-15','Synthetic closure',$1)", [officer])
      const { rows: [row] } = await client.query('SELECT status,schedule_review_required FROM patient_transfer.bookings WHERE id=$1', [id])
      assert.equal(row.status, 'SCHEDULED'); assert.equal(row.schedule_review_required, true)
      await expectError(client, scheduleSql, scheduleValues(await booking(client)), '23514')
    })
    await isolated('events and consent preserve history; suspension revokes sessions', async () => {
      await expectError(client, 'DELETE FROM patient_transfer.consent_records WHERE id=$1', [consent], '55000')
      const id = await booking(client)
      const event = randomUUID()
      await client.query(`INSERT INTO patient_transfer.trip_events(id,booking_id,actor_id,actor_role,command,command_data,from_status,to_status,recorded_at)
        VALUES($1,$2,$3,'dispatcher','APPROVE','{"type":"APPROVE"}','REQUESTED','APPROVED',now())`, [event, id, officer])
      await expectError(client, 'DELETE FROM patient_transfer.trip_events WHERE id=$1', [event], '55000')
      await expectError(client, "UPDATE patient_transfer.trip_events SET command_data='{}' WHERE id=$1", [event], '55000')
      const version=(await client.query('SELECT access_version::int FROM patient_transfer.users WHERE id=$1',[driverUser])).rows[0].access_version
      await client.query(`INSERT INTO patient_transfer.auth_sessions(user_id,token_hash,access_version,expires_at)
        SELECT id,'synthetic-hash',access_version,now()+interval '1 hour' FROM patient_transfer.users WHERE id=$1`, [driverUser])
      await client.query('UPDATE patient_transfer.users SET active=false WHERE id=$1', [driverUser])
      const { rows: [session] } = await client.query('SELECT revoked_at FROM patient_transfer.auth_sessions WHERE user_id=$1', [driverUser])
      assert.ok(session.revoked_at)
      assert.equal((await client.query('SELECT access_version::int FROM patient_transfer.users WHERE id=$1', [driverUser])).rows[0].access_version, version+1)
    })
    await t.test('concurrent transactions cannot commit overlapping vehicle or driver reservations', async () => {
      await client.query(`INSERT INTO patient_transfer.availability_windows(vehicle_id,starts_at,ends_at)
        SELECT id,'2030-01-15T06:00:00+07:00','2030-01-15T16:00:00+07:00' FROM patient_transfer.vehicles`)
      await client.query(`INSERT INTO patient_transfer.availability_windows(driver_id,starts_at,ends_at)
        VALUES($1,'2030-01-15T06:00:00+07:00','2030-01-15T16:00:00+07:00')`, [driver])
      const second = new pg.Client({ connectionString: target.toString() })
      await second.connect()
      try {
        for (const competingVehicle of [vehicle, vehicle2]) {
          const firstId = await booking(client)
          const secondId = await booking(client)
          await client.query('BEGIN'); await second.query('BEGIN')
          await second.query("SET LOCAL statement_timeout='5s'")
          await client.query(scheduleSql, scheduleValues(firstId))
          // Attach rejection handler immediately while this query waits for row lock.
          const competing = second.query(scheduleSql, scheduleValues(secondId, { vehicle: competingVehicle }))
            .then(() => ({ accepted: true }), error => ({ accepted: false, code: error.code }))
          await client.query('COMMIT')
          const result = await competing
          assert.equal(result.accepted, false)
          assert.equal(result.code, '23P01')
          await second.query('ROLLBACK')
          await client.query('UPDATE patient_transfer.schedules SET released_at=now() WHERE booking_id=$1', [firstId])
        }
      } finally {
        await client.query('ROLLBACK'); await second.query('ROLLBACK'); await second.end()
      }
    })
  } finally {
    if (client) await client.end()
    if (created) {
      await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
    }
    await admin.end()
  }
})
