import { randomUUID } from 'node:crypto'
import { transitionTrip } from '../src/domain/lifecycle.ts'
import { assignProductionTrip, modifyProductionTrip } from '../src/domain/assignment.ts'
import { confirmReservation } from '../src/domain/scheduling.ts'
import { ApiError, check, fields, text, uuid } from './errors.mjs'
import { citizenFields, citizenText } from './citizen-fields.mjs'
import { requireCurrentConsent } from './consents.mjs'
import {messageSnapshot} from './notification-messages.mjs'

const iso = date => date?.toISOString()
const terminal = ['COMPLETED','CANCELLED','REJECTED','ABORTED']
export async function transaction(pool, work) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout='8s'")
    await client.query("SET LOCAL statement_timeout='15s'")
    // Conservative municipal-scale serialization. All API operational writes share
    // this cross-process lock, including closures, holds and readiness changes.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('patient_transfer_operations'))")
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}

async function readBookingRows(client, id, lock = false) {
  const { rows } = await client.query(`SELECT b.*,b.hospital_location_snapshot AS hospital_location_id,
    ST_X(b.pickup_point::geometry) AS longitude,ST_Y(b.pickup_point::geometry) AS latitude,
    s.vehicle_id,s.driver_id,s.id AS schedule_id,s.ready_at,s.departure_at,s.pickup_at,s.arrival_at,s.pickup_waiting_seconds,s.origin_location_id,s.origin_kind,s.previous_booking_id,
    o.name AS origin_name,v.name AS vehicle_name,p.proposed_schedule,
    coalesce(s.arrival_at,os.arrival_at) AS original_arrival_at,coalesce(s.ready_at,os.ready_at) AS original_ready_at,
    coalesce(r.ready_at,s.ready_at) AS ready_at,coalesce(r.arrival_at,s.arrival_at) AS arrival_at,
    to_jsonb(r) AS active_route_leg,
    (SELECT coalesce(json_agg(json_build_object('version',rl.version,'hospitalName',rl.hospital_name,'arrivalAt',rl.arrival_at,'readyAt',rl.ready_at,'reason',rl.reason,'recordedAt',rl.recorded_at,'routingSource',rl.routing_source) ORDER BY rl.version),'[]'::json)
      FROM patient_transfer.trip_route_legs rl WHERE rl.booking_id=b.id) AS destination_history,
    (SELECT coalesce(json_agg(json_build_object('id',r.id,'type',r.entity_type,'proposed',r.proposed_data) ORDER BY r.created_at,r.id),'[]'::json)
      FROM patient_transfer.configuration_reviews r WHERE r.booking_id=b.id AND r.accepted_at IS NULL) AS configuration_reviews,
    (SELECT e.command_data->>'reason' FROM patient_transfer.trip_events e WHERE e.booking_id=b.id AND e.command='REJECT' ORDER BY e.sequence DESC LIMIT 1) AS rejection_reason,
    EXISTS(SELECT 1 FROM patient_transfer.resource_holds rh WHERE rh.booking_id=b.id AND rh.ends_at IS NULL AND (rh.vehicle_id=s.vehicle_id OR rh.driver_id=s.driver_id)) AS current_resource_hold,
    EXISTS(SELECT 1 FROM patient_transfer.resource_holds rh WHERE rh.booking_id=b.id AND rh.ends_at IS NULL) AS resource_hold
    FROM patient_transfer.bookings b JOIN patient_transfer.hospitals h ON h.id=b.hospital_id
    LEFT JOIN patient_transfer.schedules s ON s.booking_id=b.id AND s.committed AND s.released_at IS NULL
    LEFT JOIN patient_transfer.locations o ON o.id=s.origin_location_id
    LEFT JOIN patient_transfer.vehicles v ON v.id=s.vehicle_id
    LEFT JOIN LATERAL (SELECT * FROM patient_transfer.trip_route_legs WHERE booking_id=b.id ORDER BY version DESC LIMIT 1) r ON true
    LEFT JOIN patient_transfer.schedules os ON os.id=r.schedule_id
    LEFT JOIN LATERAL (SELECT json_build_object('vehicleId',ps.vehicle_id,'driverId',ps.driver_id,'originLocationId',ps.origin_location_id,'originKind',ps.origin_kind,'previousBookingId',ps.previous_booking_id,
      'departureAt',ps.departure_at,'pickupAt',ps.pickup_at,'arrivalAt',ps.arrival_at,'readyAt',ps.ready_at,'pickupWaitingMinutes',ps.pickup_waiting_seconds/60.0) AS proposed_schedule
      FROM patient_transfer.schedules ps WHERE ps.booking_id=b.id AND NOT ps.committed AND ps.released_at IS NULL ORDER BY ps.created_at DESC,ps.id DESC LIMIT 1) p ON true
    WHERE ${Array.isArray(id) ? 'b.id=ANY($1::uuid[])' : 'b.id=$1'} ${lock ? 'FOR UPDATE OF b' : ''}`, [id])
  return rows
}
export async function bookingRow(client, id, lock = false) {
  const [row] = await readBookingRows(client, id, lock)
  check(row,404,'Booking not found')
  return row
}
export async function bookingRows(client, ids) {
  return ids.length ? readBookingRows(client, ids) : []
}
export function authorizeBooking(user, row) {
  const driverActive=row.started_at&&!['COMPLETED','CANCELLED','REJECTED','ABORTED'].includes(row.status)
  const tripDay=row.departure_at?new Date(row.departure_at.getTime()+7*3600000).toISOString().slice(0,10):null
  check(user.role === 'dispatcher' ||
    (user.role === 'citizen' && row.requester_id === user.id) ||
    (user.role === 'driver' && !terminal.includes(row.status) && row.driver_id === user.driver_id && (driverActive||(user.in_shift&&tripDay===user.service_day))),403,'Booking access denied')
}
export async function hydrateTrip(client, row) {
  const { rows } = await client.query(`SELECT e.*,d.id AS actor_driver_id FROM patient_transfer.trip_events e
    LEFT JOIN patient_transfer.drivers d ON d.user_id=e.actor_id WHERE e.booking_id=$1 ORDER BY e.sequence`, [row.id])
  const {rows:[last]}=row.vehicle_id&&row.driver_id?{rows:[row]}:await client.query(`SELECT vehicle_id,driver_id FROM patient_transfer.schedules
    WHERE booking_id=$1 AND committed ORDER BY created_at DESC,id DESC LIMIT 1`,[row.id])
  const { rows: holds } = await client.query(`SELECT 1 FROM patient_transfer.resource_holds WHERE booking_id=$1 AND ends_at IS NULL
    AND (vehicle_id=$2 OR driver_id=$3) LIMIT 1`, [row.id,last?.vehicle_id??null,last?.driver_id??null])
  return { id: row.id, requesterId: row.requester_id, status: row.status, vehicleId: last?.vehicle_id ?? undefined,
    driverId: last?.driver_id ?? undefined, startedAt: iso(row.started_at), resourceHold: holds.length > 0,
    incidentOpen: row.incident_open, revision: Number(row.revision), executionVersion: row.execution_version, cancellationLocked: row.cancellation_locked,
    events: rows.map(event => ({ id: event.id, at: iso(event.recorded_at), actor: { id: event.actor_role==='driver' ? event.actor_driver_id : event.actor_id, role: event.actor_role },
      command: event.command_data, from: event.from_status, to: event.to_status })) }
}

function inputFromSchedule(row) {
  return { request: { tripId: row.booking_id, submittedAt: iso(row.submitted_at), appointmentAt: iso(row.appointment_at),
    pickupId: `pickup:${row.booking_id}`, hospitalId: row.hospital_location_id, mobility: row.mobility },
    vehicleId: row.vehicle_id, driverId: row.driver_id,
    origin: { kind: row.origin_kind, locationId: row.origin_location_id, ...(row.previous_booking_id ? { previousTripId: row.previous_booking_id } : {}) },
    originToPickup: { fromId: row.origin_location_id, toId: `pickup:${row.booking_id}`, minutes: Number(row.origin_to_pickup_seconds)/60 },
    pickupToHospital: { fromId: `pickup:${row.booking_id}`, toId: row.hospital_location_id, minutes: Number(row.pickup_to_hospital_seconds)/60 },
    pickupWaitingMinutes: row.pickup_waiting_seconds/60 }
}
export async function loadScheduling(client, now) {
  const { rows: [settings] } = await client.query('SELECT * FROM patient_transfer.service_settings')
  check(settings,503,'Service settings missing')
  const { rows: closures } = await client.query('SELECT to_char(closed_on,\'YYYY-MM-DD\') AS day FROM patient_transfer.service_closures WHERE active')
  const { rows: windows } = await client.query('SELECT * FROM patient_transfer.availability_windows WHERE retired_at IS NULL')
  const { rows: holds } = await client.query('SELECT * FROM patient_transfer.resource_holds')
  const { rows: positions } = await client.query('SELECT * FROM patient_transfer.resource_position_updates ORDER BY confirmed_at')
  const resources = (rows, key) => rows.map(row => ({ id: row.id, active: row.active, locationId: row.location_id,
    availableAt: iso(row.available_at), capabilities: row.capabilities,
    windows: windows.filter(window => window[key]===row.id).map(window=>({from:iso(window.starts_at),until:iso(window.ends_at)})),
    holds: holds.filter(hold=>hold[key]===row.id).map(hold=>({from:iso(hold.starts_at),...(hold.ends_at ? {until:iso(hold.ends_at)} : {}),reason:hold.reason,...(hold.booking_id ? {tripId:hold.booking_id} : {})})),
    positionUpdates: positions.filter(position=>position[key]===row.id).map(position=>({at:iso(position.confirmed_at),locationId:position.location_id})) }))
  const { rows: vehicles } = await client.query('SELECT v.*,to_json(v.capabilities) AS capabilities FROM patient_transfer.vehicles v ORDER BY id')
  const { rows: drivers } = await client.query(`SELECT d.*,to_json(d.capabilities) AS capabilities,d.active AND u.active AND u.role='driver' AS active
    FROM patient_transfer.drivers d JOIN patient_transfer.users u ON u.id=d.user_id ORDER BY d.id`)
  const { rows: schedules } = await client.query(`SELECT s.*,b.submitted_at,b.mobility,b.status,b.started_at,s.hospital_location_snapshot AS hospital_location_id,to_jsonb(r) AS continuation
    FROM patient_transfer.schedules s JOIN patient_transfer.bookings b ON b.id=s.booking_id JOIN patient_transfer.hospitals h ON h.id=s.hospital_id
    LEFT JOIN LATERAL (SELECT * FROM patient_transfer.trip_route_legs WHERE schedule_id=s.id ORDER BY version DESC LIMIT 1) r ON true
    WHERE s.committed AND s.released_at IS NULL ORDER BY s.departure_at`)
  const context = { calendar: { timezone:'Asia/Bangkok',opensAt:'06:00',closesAt:'16:00',closureDates:closures.map(row=>row.day) },
    vehicles:resources(vehicles,'vehicle_id'), drivers:resources(drivers,'driver_id'),
    reservations:schedules.map(row=>({ input: inputFromSchedule(row), schedule:{tripId:row.booking_id,hospitalId:row.hospital_location_id,
      vehicleId:row.vehicle_id,driverId:row.driver_id,origin:inputFromSchedule(row).origin,
      departureAt:iso(row.departure_at),pickupAt:iso(row.pickup_at),arrivalAt:iso(row.arrival_at),readyAt:iso(row.ready_at),pickupWaitingMinutes:row.pickup_waiting_seconds/60},
      ...(row.continuation?{continuation:{hospitalId:row.continuation.hospital_location_id,arrivalAt:row.continuation.arrival_at,readyAt:row.continuation.ready_at,recordedAt:row.continuation.recorded_at}}:{}) })) }
  for (const row of schedules.filter(row=>row.started_at && !terminal.includes(row.status) && Date.parse(row.continuation?.ready_at??row.ready_at)<=Date.parse(now))) {
    for (const [kind,key] of [['vehicles','vehicle_id'],['drivers','driver_id']]) {
      const resource=context[kind].find(resource=>resource.id===row[key])
      resource?.holds.push({from:row.continuation?.ready_at??iso(row.ready_at),reason:'Active trip exceeds planned readiness',tripId:row.booking_id})
    }
  }
  return context
}

export async function buildScheduleInput(client, row, body, route, now) {
  const originId=uuid(body.originLocationId)
  const { rows:[origin] }=await client.query('SELECT *,ST_X(point::geometry) AS longitude,ST_Y(point::geometry) AS latitude FROM patient_transfer.locations WHERE id=$1 AND active',[originId])
  const { rows:[destination] }=await client.query(`SELECT l.*,ST_X(l.point::geometry) AS longitude,ST_Y(l.point::geometry) AS latitude
    FROM patient_transfer.hospitals h JOIN patient_transfer.locations l ON l.id=$2 WHERE h.id=$1 AND h.active AND l.active`,[row.hospital_id,row.hospital_location_snapshot])
  check(origin && destination,422,'Origin or hospital unavailable')
  const originKind=body.originKind??'depot'
  if(originKind==='depot') {
    const {rows:[settings]}=await client.query('SELECT depot_location_id FROM patient_transfer.service_settings')
    check((row.depot_location_snapshot??settings?.depot_location_id)===origin.id && origin.kind==='depot',422,'Origin is not the booking depot snapshot')
  }
  check(['depot','previous_hospital','handoff'].includes(originKind),400,'Invalid origin kind')
  if(originKind==='handoff') check(body.arrangement?.locationId===originId && Date.parse(body.arrangement?.confirmedAt)<=Date.parse(now) && Date.parse(body.arrangement?.confirmedAt)>=Date.parse(now)-5*60000,422,'Current verified handoff required')
  const [first,second]=await Promise.all([route(origin,row),route(row,destination)])
  check([first.minutes,second.minutes].every(value=>Number.isFinite(value)&&value>=0),503,'Routing unavailable')
  const input={request:{tripId:row.id,submittedAt:iso(row.submitted_at),appointmentAt:iso(row.appointment_at),pickupId:`pickup:${row.id}`,hospitalId:destination.id,mobility:row.mobility},
    vehicleId:uuid(body.vehicleId),driverId:uuid(body.driverId),origin:{kind:originKind,locationId:originId,...(body.previousBookingId?{previousTripId:uuid(body.previousBookingId)}:{})},
    originToPickup:{fromId:originId,toId:`pickup:${row.id}`,minutes:first.minutes},
    pickupToHospital:{fromId:`pickup:${row.id}`,toId:destination.id,minutes:second.minutes},pickupWaitingMinutes:body.pickupWaitingMinutes??0}
  return {input,source:text(`${first.source}/${second.source}`,'routing source',100)}
}

export async function saveSchedule(client,row,input,schedule,source,now,committed,reason) {
  await client.query(`INSERT INTO patient_transfer.schedules(booking_id,vehicle_id,driver_id,origin_location_id,origin_kind,previous_booking_id,hospital_id,
    appointment_at,departure_at,pickup_at,arrival_at,ready_at,origin_to_pickup_seconds,pickup_to_hospital_seconds,pickup_waiting_seconds,routing_source,routed_at,committed,change_reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
  [row.id,input.vehicleId,input.driverId,input.origin.locationId,input.origin.kind,input.origin.previousTripId??null,row.hospital_id,row.appointment_at,
    schedule.departureAt,schedule.pickupAt,schedule.arrivalAt,schedule.readyAt,
    Math.ceil(input.originToPickup.minutes*60000)/1000,Math.ceil(input.pickupToHospital.minutes*60000)/1000,schedule.pickupWaitingMinutes*60,source,now,committed,reason??null])
}

export async function saveTrip(client,row,trip,user,eventId,now) {
  const event=trip.events.find(event=>event.id===eventId)
  check(event,500,'Lifecycle event missing')
  const {rowCount}=await client.query(`UPDATE patient_transfer.bookings SET status=$2,started_at=$3,incident_open=$4,revision=$5,execution_version=$6,cancellation_locked=$8
    WHERE id=$1 AND revision=$7`,[row.id,trip.status,trip.startedAt??null,trip.incidentOpen,trip.revision,trip.executionVersion,row.revision,trip.cancellationLocked])
  check(rowCount===1,409,'Booking changed; reload revision')
  await client.query(`INSERT INTO patient_transfer.trip_events(id,booking_id,actor_id,actor_role,command,command_data,from_status,to_status,recorded_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[event.id,row.id,user.id,user.role,event.command.type,event.command,event.from,event.to,now])
  await client.query('INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,reason,recorded_at) VALUES($1,$2,\'booking\',$3,$4,$5)',
    [user.id,event.command.type,row.id,event.command.reason??null,now])
}
export async function enqueue(client,row,notices,eventId,now) {
  if(!notices.length) return
  const current=await bookingRow(client,row.id)
  const recipients=new Map()
  for(const notice of notices) {
    let recipient=notice.recipientId
    if(notice.recipient==='driver') {
      const {rows:[driver]}=await client.query('SELECT user_id FROM patient_transfer.drivers WHERE id=$1',[recipient])
      check(driver,422,'Driver account missing'); recipient=driver.user_id
    }
    // Resolve roster identity before deduplicating. Prefer the owner view if a
    // single authorized account appears through more than one audience.
    if(!recipients.has(recipient)||notice.recipient==='citizen') recipients.set(recipient,{...notice,recipientId:recipient})
  }
  for(const [recipient,notice] of recipients) {
    check(['citizen','driver'].includes(notice.recipient),422,'Supported notification audience required')
    await client.query(`INSERT INTO patient_transfer.notifications(booking_id,recipient_id,event_id,deduplication_key,template_key,next_attempt_at,message_data)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[row.id,recipient,eventId,`${eventId??`request:${row.id}`}:recipient:${recipient}`,notice.event,now,messageSnapshot(current,notice.event,notice.recipient,now,notice.meaning)])
  }
  await client.query(`INSERT INTO patient_transfer.dispatcher_alerts(booking_id,event_id,deduplication_key,message_data,created_at)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(deduplication_key) DO NOTHING`,[row.id,eventId,`${eventId??`request:${row.id}`}:dispatcher`,messageSnapshot(current,notices[0].event,'dispatcher',now),now])
  return current
}

export async function persistResourceChanges(client,before,after,user,now) {
  for(const [kind,key] of [['vehicles','vehicle_id'],['drivers','driver_id']]) {
    for(const resource of after[kind]) {
      const original=before[kind].find(old=>old.id===resource.id)
      for(const hold of resource.holds) {
        const existing=original.holds.find(old=>old.from===hold.from && old.tripId===hold.tripId && old.reason===hold.reason)
        if(existing && existing.until!==hold.until) {
          await client.query(`UPDATE patient_transfer.resource_holds SET ends_at=$1 WHERE ${key}=$2 AND booking_id=$3 AND starts_at=$4 AND ends_at IS NULL`,[hold.until,resource.id,hold.tripId,hold.from])
        } else if(!existing) {
          await client.query(`INSERT INTO patient_transfer.resource_holds(${key},booking_id,starts_at,ends_at,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)`,
            [resource.id,hold.tripId??null,hold.from,hold.until??null,hold.reason,user.id])
        }
      }
      for(const position of resource.positionUpdates??[]) if(!(original.positionUpdates??[]).some(old=>old.at===position.at&&old.locationId===position.locationId)) {
        await client.query(`INSERT INTO patient_transfer.resource_position_updates(${key},location_id,confirmed_by,confirmed_at,reason) VALUES($1,$2,$3,$4,$5)`,
          [resource.id,position.locationId,user.id,position.at,'Dispatcher-confirmed reassignment arrangement'])
      }
    }
  }
  void now
}

async function currentConfiguration(client,row) {
  check(!row.started_at&&['APPROVED','SCHEDULED','ASSIGNED'].includes(row.status),409,'Configuration review requires approved, unstarted work')
  const {rows:[settings]}=await client.query('SELECT revision,depot_location_id FROM patient_transfer.service_settings')
  const {rows:[hospital]}=await client.query('SELECT location_id,name FROM patient_transfer.hospitals WHERE id=$1 AND active',[row.hospital_id])
  const {rowCount:eligible}=await client.query(`SELECT 1 FROM patient_transfer.service_villages v WHERE v.id=$1 AND v.active
    AND (ST_Covers(v.boundary,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) OR ST_DWithin(v.center,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,v.radius_metres))`,[row.village_id,row.longitude,row.latitude])
  check(settings&&hospital&&eligible,422,'Current hospital or service area requires dispatcher intervention')
  return {revision:Number(settings.revision),row:{...row,hospital_location_snapshot:hospital.location_id,hospital_location_id:hospital.location_id,
    hospital_name_snapshot:hospital.name,depot_location_snapshot:settings.depot_location_id}}
}
const schedulingFields=['eventId','expectedRevision','vehicleId','driverId','originLocationId','originKind','previousBookingId','pickupWaitingMinutes','reason','arrangement','bookingChanges','acceptConfiguration','expectedConfigurationRevision']
export async function previewConfiguration(client,row,user,body,route,now) {
  check(user.role==='dispatcher',403,'Dispatcher authority required')
  fields(body,schedulingFields.filter(key=>key!=='bookingChanges'),['expectedRevision','vehicleId','driverId','originLocationId'])
  check(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision===Number(row.revision),409,'Booking changed; reload revision')
  const candidate=await currentConfiguration(client,row)
  const {input}=await buildScheduleInput(client,candidate.row,body,route,now)
  const result=confirmReservation(await loadScheduling(client,now),input,now,row.status==='ASSIGNED')
  check(result.ok,409,'Configuration proposal unavailable',result.issues)
  return {configurationRevision:candidate.revision,schedule:{...result.reservation.schedule,vehicleId:input.vehicleId,driverId:input.driverId,
    originLocationId:input.origin.locationId,originKind:input.origin.kind,previousBookingId:input.origin.previousTripId}}
}
export async function schedulingAction(client,row,user,body,mode,route,now) {
  check(user.role==='dispatcher',403,'Dispatcher authority required')
  fields(body,schedulingFields,['eventId','expectedRevision','vehicleId','driverId','originLocationId'])
  uuid(body.eventId)
  check(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>0,400,'Valid booking revision required')
  if(Object.hasOwn(body,'arrangement')) {
    fields(body.arrangement,['locationId','confirmedAt','note'],['locationId','confirmedAt','note'])
    uuid(body.arrangement.locationId);text(body.arrangement.note,'operational arrangement',1000)
    check(typeof body.arrangement.confirmedAt==='string'&&Number.isFinite(Date.parse(body.arrangement.confirmedAt)),400,'Valid arrangement timestamp required')
  }
  check(Number(row.revision)===body.expectedRevision,409,'Booking changed; reload revision')
  if(row.schedule_review_required&&!row.started_at) check(body.acceptConfiguration===true,409,'Explicit configuration review required',{code:'CONFIGURATION_REVIEW_REQUIRED'})
  const trip=await hydrateTrip(client,row)
  if(mode==='modify'&&trip.startedAt&&(body.vehicleId===trip.vehicleId||body.driverId===trip.driverId)) {
    check(body.originKind==='handoff',409,'Retained resource requires a verified handoff origin')
  }
  if(Object.hasOwn(body,'bookingChanges')) {
    check(mode==='modify'&&['ASSIGNED','PICKING_UP'].includes(trip.status),409,'Booking changes require a pre-pickup modification')
    text(body.reason,'modification reason')
    const changes=fields(body.bookingChanges,['appointmentAt','hospitalId','latitude','longitude','pickupAddress','villageId'])
    if(Object.hasOwn(changes,'appointmentAt')) check(typeof changes.appointmentAt==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(changes.appointmentAt)&&Number.isFinite(Date.parse(changes.appointmentAt)),400,'Explicit appointment timezone required')
    for(const key of ['latitude','longitude']) if(Object.hasOwn(changes,key)) check(typeof changes[key]==='number',400,'Numeric pickup coordinates required')
    if(Object.hasOwn(changes,'pickupAddress')) text(changes.pickupAddress,'pickup address',1000)
    const latitude=changes.latitude??row.latitude,longitude=changes.longitude??row.longitude
    check(Number.isFinite(latitude)&&Math.abs(latitude)<=90&&Number.isFinite(longitude)&&Math.abs(longitude)<=180,400,'Invalid pickup coordinates')
    const hospitalId=changes.hospitalId?uuid(changes.hospitalId):row.hospital_id
    const villageId=changes.villageId?uuid(changes.villageId):row.village_id
    const {rows:eligible}=await client.query(`SELECT 1 FROM patient_transfer.hospitals h,patient_transfer.service_villages v
      WHERE h.id=$1 AND h.active AND v.id=$2 AND v.active AND
      (ST_Covers(v.boundary,ST_SetSRID(ST_MakePoint($3,$4),4326)::geography) OR ST_DWithin(v.center,ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,v.radius_metres))`,
      [hospitalId,villageId,longitude,latitude])
    check(eligible.length,422,'Changed destination or pickup is outside service scope')
    await client.query(`UPDATE patient_transfer.bookings SET hospital_id=$2,appointment_at=$3,pickup_point=ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,
      pickup_address=$6,village_id=$7 WHERE id=$1`,[row.id,hospitalId,changes.appointmentAt??row.appointment_at,longitude,latitude,
      changes.pickupAddress?text(changes.pickupAddress,'pickup address',1000):row.pickup_address,villageId])
    row=await bookingRow(client,row.id)
  }
  if(body.acceptConfiguration===true) {
    text(body.reason,'configuration review reason',1000)
    const candidate=await currentConfiguration(client,row)
    check(Number.isSafeInteger(body.expectedConfigurationRevision)&&body.expectedConfigurationRevision===candidate.revision,409,'Configuration changed; preview current proposal')
    await client.query('UPDATE patient_transfer.bookings SET hospital_location_snapshot=$2,hospital_name_snapshot=$3,depot_location_snapshot=$4 WHERE id=$1',
      [row.id,candidate.row.hospital_location_snapshot,candidate.row.hospital_name_snapshot,candidate.row.depot_location_snapshot])
    row=await bookingRow(client,row.id)
  } else check(body.acceptConfiguration===undefined||body.acceptConfiguration===false,400,'Invalid configuration review decision')
  const scheduling=await loadScheduling(client,now)
  const {input,source}=await buildScheduleInput(client,row,body,route,now)
  if(mode==='schedule') {
    const proposal=confirmReservation(scheduling,input,now)
    check(proposal.ok,409,'Schedule unavailable',proposal.issues)
    const updated=transitionTrip(trip,{type:'CONFIRM_SCHEDULE'},{id:user.id,role:user.role},body.eventId,now)
    await client.query('UPDATE patient_transfer.schedules SET released_at=$2 WHERE booking_id=$1 AND NOT committed AND released_at IS NULL',[row.id,now])
    await saveSchedule(client,row,input,proposal.reservation.schedule,source,now,false)
    await saveTrip(client,row,updated,user,body.eventId,now)
    await enqueue(client,row,[{recipient:'citizen',recipientId:row.requester_id,event:'SCHEDULE_CONFIRMED'}],body.eventId,now)
  } else {
    const state={trips:[trip],scheduling}
    const result=mode==='modify'
      ?modifyProductionTrip(state,input,{id:user.id,role:user.role},body.eventId,now,text(body.reason,'modification reason'),body.expectedRevision,body.arrangement)
      :assignProductionTrip(state,input,{id:user.id,role:user.role},body.eventId,now)
    if(!result.ok) throw new ApiError(409,'Assignment unavailable',result.issues)
    if(mode==='modify') await client.query('UPDATE patient_transfer.schedules SET released_at=$2 WHERE booking_id=$1 AND committed AND released_at IS NULL',[row.id,now])
    await persistResourceChanges(client,scheduling,result.state.scheduling,user,now)
    await saveSchedule(client,row,input,result.state.scheduling.reservations.find(record=>record.schedule.tripId===row.id).schedule,source,now,true,body.reason)
    await saveTrip(client,row,result.state.trips[0],user,body.eventId,now)
    if(mode==='modify'&&trip.incidentOpen) await client.query(`UPDATE patient_transfer.trip_incidents SET resolved_at=$2,resolved_by=$3,resolution=$4
      WHERE booking_id=$1 AND resolved_at IS NULL`,[row.id,now,user.id,body.reason])
    await enqueue(client,row,result.state.outbox??[],body.eventId,now)
  }
  if(body.acceptConfiguration===true) {
    await client.query('UPDATE patient_transfer.bookings SET schedule_review_required=false WHERE id=$1',[row.id])
    await client.query('UPDATE patient_transfer.configuration_reviews SET accepted_by=$2,accepted_at=$3 WHERE booking_id=$1 AND accepted_at IS NULL',[row.id,user.id,now])
    await client.query("INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,reason,recorded_at) VALUES($1,'ACCEPT_CONFIGURATION','booking',$2,$3,$4)",[user.id,row.id,body.reason,now])
  }
  return bookingRow(client,row.id)
}

export async function createBooking(client,user,body,now,noticeVersion) {
  check(user.role==='citizen',403,'Citizen identity required')
  fields(body,['consentId','patientName','requesterName','contactPhone','pickupAddress','latitude','longitude','landmark','villageId','hospitalId','mobility','appointmentAt','patientProfileId','bookingFor','assistance'],
    ['consentId','patientName','requesterName','contactPhone','pickupAddress','latitude','longitude','villageId','hospitalId','mobility','appointmentAt','bookingFor'])
  const normalized=citizenFields(body)
  const requesterName=citizenText(body.requesterName,'requesterName',120)
  check(['self','other'].includes(body.bookingFor),400,'Invalid booking relationship',{field:'bookingFor'})
  await requireCurrentConsent(client,user,body.consentId,now,noticeVersion)
  const {rows:[eligible]}=await client.query(`SELECT 1 FROM patient_transfer.service_villages v,patient_transfer.hospitals h,
    patient_transfer.consent_records c WHERE v.id=$1 AND v.active AND h.id=$2 AND h.active AND c.id=$3 AND c.user_id=$4 AND c.accepted
    AND c.recorded_at <= $7 AND c.notice_version=$8
    AND (ST_Covers(v.boundary,ST_SetSRID(ST_MakePoint($5,$6),4326)::geography)
      OR ST_DWithin(v.center,ST_SetSRID(ST_MakePoint($5,$6),4326)::geography,v.radius_metres))`,
  [uuid(body.villageId),uuid(body.hospitalId),uuid(body.consentId),user.id,body.longitude,body.latitude,now,noticeVersion])
  check(eligible,422,'Consent, hospital or service-area validation failed')
  const appointment=Date.parse(body.appointmentAt)
  check(typeof body.appointmentAt==='string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(body.appointmentAt)&&Number.isFinite(appointment)&&appointment-Date.parse(now)>=48*3600000,422,'Appointment requires at least 48-hour notice and explicit timezone')
  const date=new Date(appointment+7*3600000).toISOString().slice(0,10)
  const clock=new Date(appointment+7*3600000).toISOString().slice(11,23)
  check(clock>='06:20:00.000'&&clock<='15:50:00.000',422,'Appointment cannot fit the service-hour window')
  const {rows:closures}=await client.query('SELECT 1 FROM patient_transfer.service_closures WHERE closed_on=$1 AND active',[date])
  check(!closures.length,422,'Service closed on appointment date')
  const id=randomUUID()
  await client.query(`INSERT INTO patient_transfer.bookings(id,reference,requester_id,patient_profile_id,consent_id,patient_name,requester_name,contact_phone,
    pickup_address,pickup_point,landmark,village_id,hospital_id,mobility,submitted_at,appointment_at,booking_for,assistance)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,ST_SetSRID(ST_MakePoint($10,$11),4326)::geography,$12,$13,$14,$15,$16,$17,$18,$19)`,
  [id,`BK-${id}`,user.id,body.patientProfileId?uuid(body.patientProfileId):null,body.consentId,normalized.patientName,requesterName,normalized.contactPhone,
    normalized.pickupAddress,body.longitude,body.latitude,normalized.landmark,body.villageId,body.hospitalId,body.mobility,now,body.appointmentAt,body.bookingFor,normalized.assistance])
  // Publication leaves this fresh booking unchanged; return only after its writes succeed.
  return enqueue(client,{id},[{recipient:'citizen',recipientId:user.id,event:'REQUEST_RECEIVED'}],null,now)
}
