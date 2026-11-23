import { check, fields, uuid } from './errors.mjs'
import { citizenFields, resolvePickupVillage } from './citizen-fields.mjs'
import { requireCurrentConsent } from './consents.mjs'

const columns=`p.id,p.patient_name AS "patientName",p.contact_phone AS "contactPhone",p.mobility,
  p.village_id AS "villageId",p.assistance,p.landmark,COALESCE(p.pickup_address,l.address) AS "pickupAddress",
  ST_Y(l.point::geometry) AS latitude,ST_X(l.point::geometry) AS longitude`
const currentProfile=`SELECT id FROM patient_transfer.patient_profiles WHERE requester_id=$1
  ORDER BY created_at DESC,id DESC LIMIT 1`

export async function listProfiles(client,user) {
  check(user.role==='citizen',403,'Citizen identity required')
  const {rows}=await client.query(`SELECT ${columns} FROM patient_transfer.patient_profiles p
    LEFT JOIN patient_transfer.locations l ON l.id=p.pickup_location_id
    LEFT JOIN patient_transfer.service_villages v ON v.id=p.village_id
    WHERE p.id=(${currentProfile}) AND
      ((p.pickup_location_id IS NULL AND v.active) OR l.active)`,[user.id])
  return {profiles:rows}
}

export async function saveProfile(client,user,body,now,noticeVersion,id) {
  check(user.role==='citizen',403,'Citizen identity required')
  const required=['consentId','patientName','contactPhone','mobility']
  fields(body,[...required,'villageId','pickupAddress','assistance','landmark','pickupMethod','latitude','longitude'],required)
  // Lock the requester even on the first save, when no profile row exists yet.
  await client.query('SELECT id FROM patient_transfer.users WHERE id=$1 FOR UPDATE',[user.id])
  const {rows:[current]}=await client.query(currentProfile,[user.id])
  if(id) check(current?.id===uuid(id),404,'Profile not found')
  const normalized=citizenFields(body)
  const addressOnly=body.pickupMethod==='address'
  const {patientName:name,pickupAddress:address,contactPhone:phone,assistance,landmark}=normalized
  await requireCurrentConsent(client,user,body.consentId,now,noticeVersion)
  const villageId=(await resolvePickupVillage(client,body))??null
  check(villageId||body.pickupMethod==='map',422,'Pickup is outside active service scope',{code:addressOnly?'PICKUP_VILLAGE_UNAVAILABLE':'PICKUP_OUTSIDE_AREA'})
  // A fresh location keeps any previously referenced location immutable.
  const location=addressOnly?null:(await client.query(`INSERT INTO patient_transfer.locations(name,kind,point,address)
    VALUES('Saved patient pickup','pickup',ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,$3) RETURNING id`,[body.longitude,body.latitude,address])).rows[0]
  const values=[user.id,name,phone,body.mobility,villageId,location?.id??null,assistance,landmark,addressOnly?address:null]
  const {rows:[profile]}=current
    ?await client.query(`UPDATE patient_transfer.patient_profiles SET patient_name=$2,contact_phone=$3,mobility=$4,village_id=$5,pickup_location_id=$6,assistance=$7,landmark=$8,pickup_address=$9
      WHERE requester_id=$1 AND id=$10 RETURNING id`,[...values,current.id])
    :await client.query(`INSERT INTO patient_transfer.patient_profiles(requester_id,patient_name,contact_phone,mobility,village_id,pickup_location_id,assistance,landmark,pickup_address,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[...values,now])
  await client.query(`INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,recorded_at)
    VALUES($1,$2,'patient_profile',$3,$4)`,[user.id,current?'UPDATE_PROFILE':'CREATE_PROFILE',profile.id,now])
  return {id:profile.id,...normalized,mobility:body.mobility,villageId,latitude:body.latitude??null,longitude:body.longitude??null}
}
