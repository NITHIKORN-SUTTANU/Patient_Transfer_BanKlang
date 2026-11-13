import {createHash,randomUUID} from 'node:crypto'
import {check,fields,uuid} from './errors.mjs'
import {citizenText} from './citizen-fields.mjs'
import {buildScheduleInput,loadScheduling} from './repository.mjs'
import {confirmReservation,validateReservations} from '../src/domain/scheduling.ts'

const canonical=value=>Array.isArray(value)?value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
async function fingerprint(client,context){
 const {rows:[data]}=await client.query(`SELECT
  (SELECT json_agg(json_build_array(id,revision,execution_version,status,started_at) ORDER BY id) FROM patient_transfer.bookings) AS bookings,
  (SELECT json_agg(to_jsonb(v) ORDER BY id) FROM patient_transfer.vehicles v) AS vehicles,
  (SELECT json_agg(to_jsonb(d) ORDER BY id) FROM patient_transfer.drivers d) AS drivers,
  (SELECT json_agg(to_jsonb(w) ORDER BY id) FROM patient_transfer.availability_windows w) AS windows,
  (SELECT json_agg(json_build_array(id,active,role,access_version) ORDER BY id) FROM patient_transfer.users) AS accounts,
  (SELECT json_agg(to_jsonb(s)) FROM patient_transfer.service_settings s) AS settings,
  (SELECT json_agg(to_jsonb(h) ORDER BY id) FROM patient_transfer.hospitals h) AS hospitals,
  (SELECT json_agg(to_jsonb(v) ORDER BY id) FROM patient_transfer.service_villages v) AS villages,
  (SELECT json_agg(to_jsonb(l) ORDER BY id) FROM patient_transfer.locations l) AS locations`)
 return createHash('sha256').update(JSON.stringify(canonical({context,data}))).digest('hex')
}
export async function checkCapacity(client,row,user,body,route,now){
 check(user.role==='dispatcher',403,'Dispatcher capacity authority required')
 fields(body,['expectedRevision','alternatives','explanation'],['expectedRevision','alternatives','explanation'])
 check(!row.started_at&&['REQUESTED','APPROVED','SCHEDULED'].includes(row.status)&&Number(row.revision)===body.expectedRevision,409,'Current unstarted reviewable booking required')
 check(!row.schedule_review_required,409,'Resolve configuration review before investigating capacity')
 check(Array.isArray(body.alternatives)&&body.alternatives.length>0&&body.alternatives.length<=30,400,'Between one and thirty alternatives required')
 const explanation=citizenText(body.explanation,'explanation',1000)
 const context=await loadScheduling(client,now),results=[]
 // Existing invalid timelines are not evidence of unavailable candidate capacity.
 check(validateReservations(context).length===0,409,'Existing schedule requires review before capacity investigation')
 for(const alternative of body.alternatives){
  fields(alternative,['vehicleId','driverId','originLocationId','originKind','previousBookingId','arrangement','pickupWaitingMinutes'],['vehicleId','driverId','originLocationId'])
  if(alternative.arrangement){fields(alternative.arrangement,['locationId','confirmedAt','note'],['locationId','confirmedAt','note']);citizenText(alternative.arrangement.note,'note',1000)}
  const {input,source}=await buildScheduleInput(client,row,alternative,route,now)
  const result=confirmReservation(context,input,now,false)
  results.push({selection:alternative,routingSource:source,routes:{originMinutes:input.originToPickup.minutes,hospitalMinutes:input.pickupToHospital.minutes},
   result:result.ok?'available':result.issues.every(i=>['RESOURCE','CAPABILITY','SHIFT','HOLD','CONFLICT','LOCATION','CHAIN'].includes(i.code))?'unavailable':'not_capacity',
   ...(result.ok?{schedule:result.reservation.schedule}:{issues:result.issues})})
 }
 const id=randomUUID(),rejectable=results.every(r=>r.result==='unavailable'),state=await fingerprint(client,context)
 await client.query('INSERT INTO patient_transfer.capacity_checks(id,booking_id,actor_id,recorded_at,booking_revision,fingerprint,alternatives,explanation,rejectable) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,row.id,user.id,now,row.revision,state,JSON.stringify(results),explanation,rejectable])
 await client.query(`INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,recorded_at,after_data) VALUES($1,'CHECK_CAPACITY','capacity_check',$2,$3,$4)`,[user.id,id,now,{bookingId:row.id,alternativeCount:results.length,rejectable}])
 return {id,recordedAt:now,bookingRevision:Number(row.revision),alternatives:results,explanation,rejectable}
}
export async function validateCapacityEvidence(client,row,user,id,route,now){
 uuid(id)
 const {rows:[stored]}=await client.query('SELECT * FROM patient_transfer.capacity_checks WHERE id=$1 AND booking_id=$2 AND actor_id=$3',[id,row.id,user.id])
 check(stored&&stored.rejectable&&Number(stored.booking_revision)===Number(row.revision),409,'Current unavailable capacity evidence required')
 check(stored.fingerprint===await fingerprint(client,await loadScheduling(client,now)),409,'Capacity state changed; investigate again')
 // Re-route/re-evaluate at decision time rather than inventing a fixed freshness TTL.
 const fresh=await checkCapacity(client,row,user,{expectedRevision:Number(row.revision),alternatives:stored.alternatives.map(a=>a.selection),explanation:stored.explanation},route,now)
 check(fresh.rejectable,409,'Current alternatives do not support capacity rejection')
 return fresh.id
}
