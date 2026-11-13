import { isDeepStrictEqual } from 'node:util'
import { transitionTrip } from '../src/domain/lifecycle.ts'
import { check, fields, text, uuid } from './errors.mjs'
import { bookingRow, enqueue, hydrateTrip, saveTrip } from './repository.mjs'
import {validateCapacityEvidence} from './capacity-evidence.mjs'

const allowedCommands = {
  APPROVE: [], REJECT:['reason','rejectionKind','capacityCheckId'], START_TRIP:[], UNDO_START:['reason'], DEPART_ORIGIN:[], CONFIRM_PICKUP:[],
  DEPART_FOR_HOSPITAL:[], CONFIRM_HANDOVER:[], CANCEL:['reason'], FAILED_PICKUP:['reason'], REPORT_INCIDENT:['reason'],
  RESOLVE_INCIDENT:['reason'], ABORT:['reason','endedAt','location','disposition'], CONFIRM_READY:['reason'],
  CORRECT_MILESTONE:['target','reason','physicalStateConfirmed'],
}
export async function applyCommand(client,row,user,body,now,route) {
  fields(body,['eventId','expectedRevision','expectedExecutionVersion','command'],['eventId','expectedRevision','command'])
  uuid(body.eventId)
  const keys=Object.hasOwn(allowedCommands,body.command?.type)?allowedCommands[body.command.type]:undefined
  check(keys,400,'Command requires a supported lifecycle endpoint')
  const driverCommands=['START_TRIP','DEPART_ORIGIN','CONFIRM_PICKUP','DEPART_FOR_HOSPITAL','CONFIRM_HANDOVER','FAILED_PICKUP']
  if(driverCommands.includes(body.command.type)) check(user.role==='driver',403,'Assigned driver authority required')
  else if(body.command.type==='CANCEL') check(['citizen','dispatcher'].includes(user.role),403,'Cancellation authority required')
  else if(body.command.type==='REPORT_INCIDENT') check(['driver','dispatcher'].includes(user.role),403,'Incident reporting authority required')
  else check(user.role==='dispatcher',403,'Dispatcher authority required')
  fields(body.command,['type',...keys],['type',...keys.filter(key=>!['capacityCheckId','rejectionKind'].includes(key))])
  for(const key of keys.filter(key=>!['physicalStateConfirmed','capacityCheckId','rejectionKind'].includes(key))) text(body.command[key],key,1000)
  if(body.command.type==='CORRECT_MILESTONE') check(typeof body.command.physicalStateConfirmed==='boolean',400,'Physical confirmation must be boolean')
  const {rows:[previous]}=await client.query('SELECT * FROM patient_transfer.trip_events WHERE id=$1',[body.eventId])
  if(previous) {
    check(previous.booking_id===row.id&&previous.actor_id===user.id&&isDeepStrictEqual(previous.command_data,body.command),409,'Event identifier reused')
    return row
  }
  if(body.command.type==='REJECT')check(['capacity','other'].includes(body.command.rejectionKind)&& (body.command.rejectionKind==='capacity'||!body.command.capacityCheckId),400,'Explicit rejection category required')
  check(Number(row.revision)===body.expectedRevision,409,'Booking changed; reload revision')
  const validatedCheck=body.command.type==='REJECT'&&body.command.rejectionKind==='capacity'?await validateCapacityEvidence(client,row,user,body.command.capacityCheckId,route,now):null
  const trip=await hydrateTrip(client,row)
  const actor={id:user.role==='driver'?user.driver_id:user.id,role:user.role}
  if(body.command.type==='DEPART_ORIGIN') check(row.departure_at&&Date.parse(now)>=row.departure_at.getTime(),409,'Planned departure time has not arrived')
  if(body.command.type==='DEPART_FOR_HOSPITAL') check(row.pickup_at&&Date.parse(now)>=row.pickup_at.getTime()+row.pickup_waiting_seconds*1000,409,'Planned pickup waiting allowance has not elapsed')
  if(body.command.type==='START_TRIP') {
    const {rows:held}=await client.query(`SELECT 1 FROM patient_transfer.resource_holds WHERE (driver_id=$1 OR vehicle_id=$2)
      AND starts_at<=$3 AND (ends_at IS NULL OR ends_at>$3) LIMIT 1`,[row.driver_id,row.vehicle_id,now])
    check(!held.length,409,'Resource readiness hold blocks trip start')
    const localDay=value=>new Date(Date.parse(value)+7*3600000).toISOString().slice(0,10)
    check(row.departure_at && localDay(now)===localDay(row.departure_at) && Date.parse(now)<row.ready_at.getTime(),409,'Trip cannot start outside its planned service day')
    const {rows:shift}=await client.query(`SELECT 1 FROM patient_transfer.availability_windows WHERE driver_id=$1 AND retired_at IS NULL AND starts_at<=$2 AND ends_at>$2`,[row.driver_id,now])
    check(shift.length,409,'Driver is outside an active shift')
    const {rows:busy}=await client.query(`SELECT 1 FROM patient_transfer.bookings b JOIN patient_transfer.schedules s ON s.booking_id=b.id
      WHERE b.id<>$1 AND b.started_at IS NOT NULL AND b.status NOT IN ('COMPLETED','CANCELLED','REJECTED','ABORTED')
      AND s.committed AND s.released_at IS NULL AND (s.driver_id=$2 OR s.vehicle_id=$3) LIMIT 1`,[row.id,row.driver_id,row.vehicle_id])
    check(!busy.length,409,'Resource already executing another trip')
  }
  if(body.command.type==='CONFIRM_READY' && row.status==='COMPLETED') {
    const {rows:[handover]}=await client.query("SELECT recorded_at FROM patient_transfer.trip_events WHERE booking_id=$1 AND command='CONFIRM_HANDOVER' ORDER BY sequence DESC LIMIT 1",[row.id])
    check(handover && Date.parse(now)>=Math.max(row.ready_at?.getTime()??0,handover.recorded_at.getTime()+30*60000),409,'Turnaround not complete')
  }
  const updated=transitionTrip(trip,body.command,actor,body.eventId,now,body.expectedExecutionVersion)
  if(['FAILED_PICKUP','ABORT','CANCEL'].includes(body.command.type)) await client.query('UPDATE patient_transfer.schedules SET released_at=$2 WHERE booking_id=$1 AND committed AND released_at IS NULL',[row.id,now])
  if(body.command.type==='ABORT') {
    await client.query(`INSERT INTO patient_transfer.trip_dispositions(booking_id,recorded_by,reason,ended_at,end_location,patient_arrangement,recorded_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[row.id,user.id,body.command.reason,body.command.endedAt,body.command.location,body.command.disposition,now])
  }
  if(body.command.type==='REPORT_INCIDENT') {
    await client.query('INSERT INTO patient_transfer.trip_incidents(booking_id,reported_by,reason,reported_at) VALUES($1,$2,$3,$4)',[row.id,user.id,body.command.reason,now])
  }
  if(body.command.type==='RESOLVE_INCIDENT') await client.query(`UPDATE patient_transfer.trip_incidents SET resolved_by=$2,resolved_at=$3,resolution=$4
    WHERE booking_id=$1 AND resolved_at IS NULL`,[row.id,user.id,now,body.command.reason])
  if(updated.resourceHold && row.vehicle_id && row.driver_id) {
    for(const [key,id] of [['vehicle_id',row.vehicle_id],['driver_id',row.driver_id]]) await client.query(`INSERT INTO patient_transfer.resource_holds(booking_id,${key},starts_at,reason,created_by)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[row.id,id,now,body.command.reason??'Hospital handover; turnaround/readiness pending',user.id])
  }
  if(['CONFIRM_READY','RESOLVE_INCIDENT'].includes(body.command.type)) {
    const {rows:busy}=await client.query(`SELECT 1 FROM patient_transfer.resource_holds h JOIN patient_transfer.schedules s
      ON s.vehicle_id=h.vehicle_id OR s.driver_id=h.driver_id JOIN patient_transfer.bookings b ON b.id=s.booking_id
      WHERE h.booking_id=$1 AND h.ends_at IS NULL AND b.id<>$1 AND b.started_at IS NOT NULL
      AND b.status NOT IN ('COMPLETED','CANCELLED','REJECTED','ABORTED') AND s.committed AND s.released_at IS NULL LIMIT 1`,[row.id])
    check(!busy.length,409,'Held resource still executing another trip')
    // End strictly after hold start; an equal-time readiness confirmation must retry.
    const {rows:equal}=await client.query('SELECT 1 FROM patient_transfer.resource_holds WHERE booking_id=$1 AND ends_at IS NULL AND starts_at >= $2 LIMIT 1',[row.id,now])
    check(!equal.length,409,'Readiness confirmation must follow the hold event')
    await client.query('UPDATE patient_transfer.resource_holds SET ends_at=$2 WHERE booking_id=$1 AND ends_at IS NULL',[row.id,now])
  }
  await saveTrip(client,row,updated,user,body.eventId,now)
  if(validatedCheck)await client.query('INSERT INTO patient_transfer.capacity_rejections(event_id,source_check_id,validated_check_id) VALUES($1,$2,$3)',[body.eventId,body.command.capacityCheckId,validatedCheck])
  const driverAudience=['REJECT','CANCEL','REPORT_INCIDENT','RESOLVE_INCIDENT','CONFIRM_HANDOVER','ABORT'].includes(body.command.type)
  const recipients=[{recipient:'citizen',recipientId:row.requester_id},...(row.driver_id&&driverAudience?[{recipient:'driver',recipientId:row.driver_id}]:[])]
  await enqueue(client,row,recipients.map(recipient=>({...recipient,key:`${body.eventId}:${recipient.recipient}:${recipient.recipientId}`,event:`TRIP_${body.command.type}`})),body.eventId,now)
  return bookingRow(client,row.id)
}

