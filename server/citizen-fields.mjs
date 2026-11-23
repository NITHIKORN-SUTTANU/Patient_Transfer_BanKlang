import { check, uuid } from './errors.mjs'

export function citizenText(value,field,maximum,optional=false) {
  if(optional&&value===undefined) return ''
  check(typeof value==='string',400,`Invalid ${field}`,{field})
  const normalized=value.trim()
  check((optional||normalized.length>0)&&[...normalized].length<=maximum,400,`Invalid ${field}`,{field})
  return normalized
}

export function pickupCoordinates(body) {
  for(const [field,maximum] of [['latitude',90],['longitude',180]]) {
    check(Number.isFinite(body[field])&&Math.abs(body[field])<=maximum,400,`Invalid ${field}`,{field})
  }
}

export function citizenFields(body) {
  const patientName=citizenText(body.patientName,'patientName',120)
  const mapOnly=body.pickupMethod==='map'
  const pickupAddress=mapOnly?'จุดรับบนแผนที่':citizenText(body.pickupAddress,'pickupAddress',1000)
  const landmark=mapOnly?'':citizenText(body.landmark,'landmark',1000,true)
  check(typeof body.contactPhone==='string',400,'Invalid contact phone',{field:'contactPhone'})
  const contactPhone=body.contactPhone.replace(/[\s-]/g,'').replace(/^\+66/,'0')
  check(/^0[0-9]{9}$/.test(contactPhone),400,'Invalid contact phone',{field:'contactPhone'})
  check(['standard','wheelchair','stretcher'].includes(body.mobility),400,'Invalid mobility',{field:'mobility'})
  check(body.pickupMethod===undefined||['map','address'].includes(body.pickupMethod),400,'Invalid pickup method',{field:'pickupMethod'})
  if(body.pickupMethod==='address') {
    check(!Object.hasOwn(body,'latitude')&&!Object.hasOwn(body,'longitude'),400,'Address pickup cannot also include coordinates',{field:'pickupMethod'})
  } else pickupCoordinates(body)
  if(mapOnly) check(['pickupAddress','landmark','villageId'].every(key=>!Object.hasOwn(body,key)),400,'Map pickup cannot include address fields',{field:'pickupMethod'})
  const assistance=body.assistance===undefined?[]:body.assistance
  check(Array.isArray(assistance)&&assistance.length<=2&&assistance.every(code=>['boarding_support','caregiver_accompanies'].includes(code))&&new Set(assistance).size===assistance.length,
    400,'Invalid assistance codes',{field:'assistance'})
  return {patientName,pickupAddress,landmark,contactPhone,assistance:[...assistance]}
}

export async function resolvePickupVillage(client,body) {
  const pickedVillage=body.pickupMethod==='map'?null:uuid(body.villageId)
  const {rows:[village]}=await client.query(`SELECT v.id FROM patient_transfer.service_villages v
    CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint($2,$3),4326)::geography AS point) p
    WHERE v.active AND ($1::uuid IS NULL OR v.id=$1)
      AND ($4::boolean OR ST_Covers(v.boundary,p.point) OR ST_DWithin(v.center,p.point,v.radius_metres))
    ORDER BY COALESCE(ST_Covers(v.boundary,p.point),false) DESC,
      ST_Distance(v.center,p.point) ASC NULLS LAST,v.village_number
    LIMIT 1`,[pickedVillage,body.longitude??null,body.latitude??null,body.pickupMethod==='address'])
  return village?.id
}
