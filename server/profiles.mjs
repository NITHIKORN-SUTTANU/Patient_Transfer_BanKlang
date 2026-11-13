import { check, fields, uuid } from './errors.mjs'
import { citizenFields } from './citizen-fields.mjs'
import { requireCurrentConsent } from './consents.mjs'

const columns=`p.id,p.patient_name AS "patientName",p.contact_phone AS "contactPhone",p.mobility,
  p.village_id AS "villageId",p.assistance,p.landmark,l.address AS "pickupAddress",
  ST_Y(l.point::geometry) AS latitude,ST_X(l.point::geometry) AS longitude`

export async function listProfiles(client,user) {
  check(user.role==='citizen',403,'Citizen identity required')
  const {rows}=await client.query(`SELECT ${columns} FROM patient_transfer.patient_profiles p
    JOIN patient_transfer.locations l ON l.id=p.pickup_location_id
    JOIN patient_transfer.service_villages v ON v.id=p.village_id
    WHERE p.requester_id=$1 AND l.active AND v.active
      AND (ST_Covers(v.boundary,l.point) OR ST_DWithin(v.center,l.point,v.radius_metres))
    ORDER BY p.created_at,p.id`,[user.id])
  return {profiles:rows}
}

export async function saveProfile(client,user,body,now,noticeVersion,id) {
  check(user.role==='citizen',403,'Citizen identity required')
  const required=['consentId','patientName','contactPhone','mobility','villageId','pickupAddress','latitude','longitude']
  fields(body,[...required,'assistance','landmark'],required)
  if(id) {
    const {rowCount}=await client.query('SELECT 1 FROM patient_transfer.patient_profiles WHERE id=$1 AND requester_id=$2 FOR UPDATE',[uuid(id),user.id])
    check(rowCount,404,'Profile not found')
  }
  const normalized=citizenFields(body)
  const {patientName:name,pickupAddress:address,contactPhone:phone,assistance,landmark}=normalized
  await requireCurrentConsent(client,user,body.consentId,now,noticeVersion)
  const {rowCount:eligible}=await client.query(`SELECT 1 FROM patient_transfer.service_villages v WHERE v.id=$1 AND v.active
    AND (ST_Covers(v.boundary,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography)
      OR ST_DWithin(v.center,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,v.radius_metres))`,[uuid(body.villageId),body.longitude,body.latitude])
  check(eligible,422,'Pickup is outside active service scope')
  // A fresh location keeps any previously referenced location immutable.
  const {rows:[location]}=await client.query(`INSERT INTO patient_transfer.locations(name,kind,point,address)
    VALUES('Saved patient pickup','pickup',ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,$3) RETURNING id`,[body.longitude,body.latitude,address])
  const values=[user.id,name,phone,body.mobility,body.villageId,location.id,assistance,landmark]
  const {rows:[profile]}=id
    ?await client.query(`UPDATE patient_transfer.patient_profiles SET patient_name=$2,contact_phone=$3,mobility=$4,village_id=$5,pickup_location_id=$6,assistance=$7,landmark=$8
      WHERE requester_id=$1 AND id=$9 RETURNING id`,[...values,id])
    :await client.query(`INSERT INTO patient_transfer.patient_profiles(requester_id,patient_name,contact_phone,mobility,village_id,pickup_location_id,assistance,landmark,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[...values,now])
  await client.query(`INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,recorded_at)
    VALUES($1,$2,'patient_profile',$3,$4)`,[user.id,id?'UPDATE_PROFILE':'CREATE_PROFILE',profile.id,now])
  return {id:profile.id,...normalized,mobility:body.mobility,villageId:body.villageId,latitude:body.latitude,longitude:body.longitude}
}
