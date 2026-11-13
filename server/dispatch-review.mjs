import {check,fields,uuid} from './errors.mjs'
import {citizenText} from './citizen-fields.mjs'

export const verificationOutcomes=['confirmed','correction_needed','unreachable','requester_declined']
// Deliberately exact normalization, without fuzzy matching or identity inference.
export const normalizedName=value=>value.normalize('NFC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('und')
const normalizedPhone=value=>value.replace(/[\s-]/g,'').replace(/^\+66/,'0')
async function booking(client,user,id){
 check(user.role==='dispatcher',403,'Dispatcher review authority required');uuid(id)
 const {rows:[row]}=await client.query('SELECT id,patient_profile_id,patient_name,contact_phone,hospital_id,appointment_at FROM patient_transfer.bookings WHERE id=$1',[id])
 check(row,404,'Booking not found');return row
}
export async function dispatchReview(client,user,id,cursor){
 const row=await booking(client,user,id)
 if(cursor!==null&&cursor!==undefined)uuid(cursor)
 // Exact appointment/hospital constrain candidates before name/contact comparison.
 const {rows:candidates}=await client.query(`SELECT id,reference,status,patient_profile_id,patient_name,contact_phone,hospital_id,appointment_at FROM patient_transfer.bookings
  WHERE id<>$1 AND appointment_at=$2 AND (hospital_id=$3 OR ($4::uuid IS NOT NULL AND patient_profile_id=$4)) ORDER BY id`,[id,row.appointment_at,row.hospital_id,row.patient_profile_id])
 const duplicates=candidates.flatMap(other=>{
  const reasons=[]
  if(row.patient_profile_id&&row.patient_profile_id===other.patient_profile_id)reasons.push('same_profile_appointment')
  if(row.hospital_id===other.hospital_id&&normalizedName(row.patient_name)===normalizedName(other.patient_name)&&normalizedPhone(row.contact_phone)===normalizedPhone(other.contact_phone))reasons.push('exact_name_contact_hospital_appointment')
  return reasons.length?[{id:other.id,reference:other.reference,status:other.status,reasons}]:[]
 })
 // Keyset paging never hides earlier verification history behind a fixed total limit.
 let boundary=null
 if(cursor){const {rows:[entry]}=await client.query('SELECT revision FROM patient_transfer.verification_logs WHERE id=$1 AND booking_id=$2',[cursor,id]);check(entry,400,'Invalid review cursor');boundary=entry.revision}
 const {rows:history}=await client.query(`SELECT v.id,v.outcome,v.notes,v.recorded_at AS "recordedAt",v.actor_id AS "actorId",u.display_name AS actor,v.corrects_id AS "correctsId"
  FROM patient_transfer.verification_logs v JOIN patient_transfer.users u ON u.id=v.actor_id WHERE v.booking_id=$1 AND ($2::bigint IS NULL OR v.revision<$2) ORDER BY v.revision DESC LIMIT 51`,[id,boundary])
 const {rows:[latest]}=await client.query('SELECT id FROM patient_transfer.verification_logs WHERE booking_id=$1 ORDER BY revision DESC LIMIT 1',[id])
 const {rows:[capacityDecision]}=await client.query(`SELECT c.id,c.recorded_at AS "recordedAt",c.alternatives,c.explanation,r.source_check_id AS "sourceCheckId" FROM patient_transfer.capacity_rejections r JOIN patient_transfer.trip_events e ON e.id=r.event_id JOIN patient_transfer.capacity_checks c ON c.id=r.validated_check_id WHERE e.booking_id=$1 ORDER BY e.sequence DESC LIMIT 1`,[id])
 return {bookingId:id,latestId:latest?.id??null,duplicates,history:history.slice(0,50),nextCursor:history.length>50?history[49].id:null,capacityDecision:capacityDecision??null}
}
export async function saveVerification(client,user,id,body,now){
 await booking(client,user,id)
 fields(body,['eventId','expectedLatestId','outcome','notes','correctsId'],['eventId','expectedLatestId','outcome','notes'])
 const eventId=uuid(body.eventId),expected=body.expectedLatestId===null?null:uuid(body.expectedLatestId),corrects=body.correctsId===undefined||body.correctsId===null?null:uuid(body.correctsId)
 check(verificationOutcomes.includes(body.outcome),400,'Invalid verification outcome')
 const notes=citizenText(body.notes,'notes',1000,true)
 check(!corrects||notes.length>0,400,'Correction explanation required')
 const {rows:[replay]}=await client.query('SELECT * FROM patient_transfer.verification_logs WHERE id=$1',[eventId])
 if(replay){check(replay.booking_id===id&&replay.actor_id===user.id&&replay.outcome===body.outcome&&replay.notes===notes&&replay.corrects_id===corrects,409,'Verification event identity already used');return {id:replay.id}}
 const {rows:[latest]}=await client.query('SELECT id FROM patient_transfer.verification_logs WHERE booking_id=$1 ORDER BY revision DESC LIMIT 1',[id])
 check((latest?.id??null)===expected,409,'Verification history changed; reload before saving')
 check(!corrects||corrects===latest?.id,409,'Correction must reference the latest verification entry')
 await client.query('INSERT INTO patient_transfer.verification_logs(id,booking_id,actor_id,outcome,notes,recorded_at,corrects_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[eventId,id,user.id,body.outcome,notes,now,corrects])
 await client.query(`INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,recorded_at,after_data) VALUES($1,'RECORD_VERIFICATION','booking_verification',$2,$3,$4)`,[user.id,eventId,now,{bookingId:id,outcome:body.outcome,correctsId:corrects}])
 return {id:eventId}
}
