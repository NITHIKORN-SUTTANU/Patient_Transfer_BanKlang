import { isDeepStrictEqual } from 'node:util'
import { check,fields,text,uuid } from './errors.mjs'
import { bookingRow,hydrateTrip,loadScheduling,saveTrip,enqueue } from './repository.mjs'
import { transitionTrip } from '../src/domain/lifecycle.ts'
import { validateReservations } from '../src/domain/scheduling.ts'

export async function reviseDestination(client,row,user,body,route,now,preview=false) {
  check(user.role==='dispatcher',403,'Dispatcher authority required')
  const required=['expectedRevision','expectedExecutionVersion','hospitalId','reason','currentLocation','confirmedAt','confirmedPhase']
  fields(body,[...required,'eventId'],preview?required:[...required,'eventId'])
  if(!preview) {
    uuid(body.eventId)
    const {rows:[old]}=await client.query('SELECT * FROM patient_transfer.trip_route_legs WHERE id=$1',[body.eventId])
    if(old) {
      check(old.booking_id===row.id&&old.recorded_by===user.id&&isDeepStrictEqual(old.request_data,body),409,'Event identifier reused')
      return row
    }
    const {rowCount:used}=await client.query('SELECT 1 FROM patient_transfer.trip_events WHERE id=$1',[body.eventId])
    check(!used,409,'Event identifier reused')
  }
  check(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision===Number(row.revision)&&Number.isSafeInteger(body.expectedExecutionVersion)&&body.expectedExecutionVersion===row.execution_version,409,'Booking or execution changed; reload')
  check(['PICKED_UP','IN_TRANSIT'].includes(row.status)&&row.started_at&&row.schedule_id,409,'Destination revision requires actual pickup on an active assignment')
  check(body.confirmedPhase===row.status,409,'Confirmed physical phase must match current phase')
  const reason=text(body.reason,'destination revision reason',1000)
  fields(body.currentLocation,['latitude','longitude','label'],['latitude','longitude','label'])
  const {latitude,longitude}=body.currentLocation
  check(Number.isFinite(latitude)&&Math.abs(latitude)<=90&&Number.isFinite(longitude)&&Math.abs(longitude)<=180,400,'Valid numeric current location required')
  const label=text(body.currentLocation.label,'current location',1000)
  const confirmation=Date.parse(body.confirmedAt)
  check(typeof body.confirmedAt==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(body.confirmedAt)&&Number.isFinite(confirmation)&&confirmation<=Date.parse(now)&&confirmation>=Math.max(Date.parse(now)-5*60000,row.started_at.getTime()),422,'Physical confirmation must be current and after Start Trip')
  const {rows:[pickup]}=await client.query("SELECT recorded_at FROM patient_transfer.trip_events WHERE booking_id=$1 AND command='CONFIRM_PICKUP' ORDER BY sequence DESC LIMIT 1",[row.id])
  check(pickup&&pickup.recorded_at.getTime()<=confirmation,409,'Actual pickup must precede physical confirmation')
  const {rows:[hospital]}=await client.query(`SELECT h.id,h.name,h.location_id,ST_Y(l.point::geometry) AS latitude,ST_X(l.point::geometry) AS longitude
    FROM patient_transfer.hospitals h JOIN patient_transfer.locations l ON l.id=h.location_id WHERE h.id=$1 AND h.active AND l.active`,[uuid(body.hospitalId)])
  check(hospital,422,'Active supported destination required')
  const current=row.active_route_leg
  check(hospital.id!==(current?.hospital_id??row.hospital_id)||hospital.location_id!==(current?.hospital_location_id??row.hospital_location_snapshot),422,'Destination is unchanged')
  const verified=await route({latitude,longitude,kind:'continuation'},hospital)
  check(Number.isFinite(verified.minutes)&&verified.minutes>=0&&verified.minutes<=7*24*60,503,'Verified remaining route unavailable')
  const seconds=Math.ceil(verified.minutes*60),source=text(verified.source,'routing source',100)
  const start=Math.max(Date.parse(now),row.status==='PICKED_UP'?pickup.recorded_at.getTime()+row.pickup_waiting_seconds*1000:0)
  const arrivalAt=new Date(start+seconds*1000).toISOString()
  const readyAt=new Date(Math.max(row.original_ready_at.getTime(),Date.parse(arrivalAt)+30*60000)).toISOString()
  const proposal={version:(current?.version??0)+1,hospitalId:hospital.id,hospitalName:hospital.name,hospitalLocationId:hospital.location_id,
    arrivalAt,readyAt,latenessSeconds:Math.max(0,Math.ceil((Date.parse(arrivalAt)-row.original_arrival_at.getTime())/1000)),
    appointmentLatenessSeconds:Math.max(0,Math.ceil((Date.parse(arrivalAt)-row.appointment_at.getTime())/1000)),recordedAt:now}
  const scheduling=await loadScheduling(client,now)
  const record=scheduling.reservations.find(item=>item.schedule.tripId===row.id)
  check(record,409,'Current reservation unavailable')
  record.continuation={hospitalId:hospital.location_id,arrivalAt,readyAt,recordedAt:now}
  const issues=validateReservations(scheduling)
  check(!issues.length,409,'Continuation conflicts; resolve downstream work or resource restrictions first',issues)
  if(preview) return proposal
  const trip=await hydrateTrip(client,row)
  const updated=transitionTrip(trip,{type:'REVISE_DESTINATION',hospitalId:hospital.id,reason},{id:user.id,role:user.role},body.eventId,now)
  await saveTrip(client,row,updated,user,body.eventId,now)
  await client.query(`INSERT INTO patient_transfer.trip_route_legs(id,booking_id,schedule_id,version,previous_leg_id,hospital_id,hospital_location_id,hospital_name,
    origin_point,origin_label,confirmed_at,recorded_at,recorded_by,phase,route_seconds,routing_source,arrival_at,ready_at,lateness_seconds,appointment_lateness_seconds,reason,request_data)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,ST_SetSRID(ST_MakePoint($9,$10),4326)::geography,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    [body.eventId,row.id,row.schedule_id,proposal.version,current?.id??null,hospital.id,hospital.location_id,hospital.name,longitude,latitude,label,body.confirmedAt,now,user.id,row.status,seconds,source,arrivalAt,readyAt,proposal.latenessSeconds,proposal.appointmentLatenessSeconds,reason,body])
  await enqueue(client,row,[{recipient:'citizen',recipientId:row.requester_id,key:`${body.eventId}:citizen:${row.requester_id}`,event:'DESTINATION_CHANGED'},
    {recipient:'driver',recipientId:row.driver_id,key:`${body.eventId}:driver:${row.driver_id}`,event:'DESTINATION_CHANGED'}],body.eventId,now)
  return bookingRow(client,row.id)
}
