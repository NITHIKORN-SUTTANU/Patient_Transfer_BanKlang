import { check, fields, text, uuid } from './errors.mjs'

const hospitalSql=`SELECT h.id,h.name,h.active,h.location_id AS "locationId",h.revision,
  ST_Y(l.point::geometry) AS latitude,ST_X(l.point::geometry) AS longitude FROM patient_transfer.hospitals h JOIN patient_transfer.locations l ON l.id=h.location_id`
const villageSql=`SELECT id,name,active,village_number AS number,revision,
  CASE WHEN boundary IS NULL THEN 'circle' ELSE 'polygon' END AS shape,
  ST_Y(center::geometry) AS latitude,ST_X(center::geometry) AS longitude,radius_metres::float AS "radiusMetres",
  ST_AsGeoJSON(boundary::geometry)::json AS geometry FROM patient_transfer.service_villages`
const version=row=>({...row,revision:Number(row.revision)})
function coordinates(body) {
  check(Number.isFinite(body.latitude)&&Math.abs(body.latitude)<=90&&Number.isFinite(body.longitude)&&Math.abs(body.longitude)<=180,400,'Valid numeric coordinates required')
}
export async function serviceData(client,user) {
  check(user.role==='admin',403,'Administrator authority required')
  const {rows:hospitals}=await client.query(`${hospitalSql} ORDER BY h.name,h.id`)
  const {rows:villages}=await client.query(`${villageSql} ORDER BY village_number`)
  const {rows:[settings]}=await client.query(`SELECT s.revision,s.depot_name AS name,s.depot_location_id AS "locationId",
    ST_Y(l.point::geometry) AS latitude,ST_X(l.point::geometry) AS longitude,
    to_char(s.opens_at,'HH24:MI') AS "opensAt",to_char(s.closes_at,'HH24:MI') AS "closesAt"
    FROM patient_transfer.service_settings s JOIN patient_transfer.locations l ON l.id=s.depot_location_id`)
  const {rows:closures}=await client.query(`SELECT to_char(closed_on,'YYYY-MM-DD') AS date,active,revision,reason FROM patient_transfer.service_closures ORDER BY closed_on DESC`)
  const {rows:[pending]}=await client.query(`SELECT count(*)::int AS count FROM patient_transfer.configuration_reviews r JOIN patient_transfer.bookings b ON b.id=r.booking_id
    WHERE r.accepted_at IS NULL AND b.started_at IS NULL AND b.status NOT IN ('COMPLETED','CANCELLED','REJECTED','ABORTED')`)
  return {hospitals:hospitals.map(version),villages:villages.map(version),settings:settings?version(settings):null,closures:closures.map(version),pendingReviewCount:pending.count}
}
async function audit(client,user,action,kind,id,before,after,reason,now) {
  await client.query(`INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,reason,recorded_at,before_data,after_data)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[user.id,action,kind,id,reason,now,before,after])
}
async function location(client,name,kind,body) {
  const {rows:[row]}=await client.query(`INSERT INTO patient_transfer.locations(name,kind,point) VALUES($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326)::geography) RETURNING id`,[name,kind,body.longitude,body.latitude])
  return row.id
}
export async function configurationChange(client,user,kind,id,data,now) {
  const condition=kind==='hospital'?'b.hospital_id=$1::uuid':kind==='village'?'b.village_id=$1::uuid':kind==='closure'?"(b.appointment_at AT TIME ZONE 'Asia/Bangkok')::date=$1::date":'b.depot_location_snapshot=$1::uuid'
  const {rows}=await client.query(`SELECT b.id FROM patient_transfer.bookings b WHERE ${condition} AND b.started_at IS NULL
    AND b.status NOT IN ('COMPLETED','CANCELLED','REJECTED','ABORTED') ORDER BY b.id FOR UPDATE`,[id])
  for(const booking of rows) {
    await client.query(`INSERT INTO patient_transfer.configuration_reviews(booking_id,entity_type,entity_id,proposed_data,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6)`,[booking.id,kind,id,data,user.id,now])
    await client.query('UPDATE patient_transfer.bookings SET schedule_review_required=true,revision=revision+1 WHERE id=$1',[booking.id])
  }
  await client.query('UPDATE patient_transfer.service_settings SET revision=revision')
  return rows.length
}
function revision(body,row) {check(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision===Number(row.revision),409,'Master data changed; reload revision')}
export async function saveHospital(client,user,body,now,id) {
  check(user.role==='admin',403,'Administrator authority required')
  const required=['name','active','latitude','longitude','reason',...(id?['expectedRevision']:[])]
  fields(body,required,required);coordinates(body)
  const name=text(body.name,'hospital name',120),reason=text(body.reason,'reason',1000)
  check(typeof body.active==='boolean',400,'Hospital status required')
  let before
  if(id) {
    const {rows:[row]}=await client.query(`${hospitalSql} WHERE h.id=$1 FOR UPDATE OF h`,[uuid(id)])
    check(row,404,'Hospital not found');revision(body,row);before=version(row)
  }
  const changed=before&&(before.latitude!==body.latitude||before.longitude!==body.longitude)
  const locationId=!before||changed?await location(client,name,'hospital',body):before.locationId
  const {rows:[saved]}=before?await client.query('UPDATE patient_transfer.hospitals SET name=$2,active=$3,location_id=$4 WHERE id=$1 RETURNING id',[id,name,body.active,locationId])
    :await client.query('INSERT INTO patient_transfer.hospitals(name,active,location_id) VALUES($1,$2,$3) RETURNING id',[name,body.active,locationId])
  const {rows:[row]}=await client.query(`${hospitalSql} WHERE h.id=$1`,[saved.id])
  const after=version(row)
  const affected=before&&(changed||before.active!==body.active)?await configurationChange(client,user,'hospital',saved.id,after,now):0
  if(!before||!changed&&before.active===body.active) await client.query('UPDATE patient_transfer.service_settings SET revision=revision')
  await audit(client,user,before?'UPDATE_HOSPITAL':'CREATE_HOSPITAL','hospital',saved.id,before??null,after,reason,now)
  return {...after,affectedCount:affected}
}
function polygon(value) {
  fields(value,['type','coordinates'],['type','coordinates'])
  check(value.type==='MultiPolygon'&&Array.isArray(value.coordinates)&&value.coordinates.length>0,400,'MultiPolygon geometry required')
  for(const shape of value.coordinates) {
    check(Array.isArray(shape)&&shape.length>0,400,'Polygon rings required')
    for(const ring of shape) {
      check(Array.isArray(ring)&&ring.length>=4,400,'Closed polygon ring required')
      for(const point of ring) check(Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)&&Math.abs(point[0])<=180&&Math.abs(point[1])<=90,400,'Invalid polygon coordinates')
      check(ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1],400,'Polygon ring must close')
    }
  }
  return JSON.stringify(value)
}
export async function saveVillage(client,user,body,now,id) {
  check(user.role==='admin',403,'Administrator authority required')
  const base=['name','number','active','shape','reason',...(id?['expectedRevision']:[])]
  const extra=body.shape==='circle'?['latitude','longitude','radiusMetres']:['geometry']
  fields(body,[...base,...extra],[...base,...extra])
  const name=text(body.name,'village name',120),reason=text(body.reason,'reason',1000)
  check(Number.isInteger(body.number)&&body.number>=1&&body.number<=12&&typeof body.active==='boolean'&&['circle','polygon'].includes(body.shape),400,'Approved village number, status and shape required')
  let geometry=null
  if(body.shape==='circle') {coordinates(body);check(Number.isFinite(body.radiusMetres)&&body.radiusMetres>0,400,'Positive village radius required')}
  else {
    geometry=polygon(body.geometry)
    const {rows:[valid]}=await client.query('SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1),4326)) AS valid',[geometry])
    check(valid.valid,422,'Invalid village polygon')
  }
  let before
  if(id) {const {rows:[row]}=await client.query(`${villageSql} WHERE id=$1 FOR UPDATE`,[uuid(id)]);check(row,404,'Village not found');revision(body,row);before=version(row)}
  const values=[name,body.number,body.active,geometry,body.shape==='circle'?body.longitude:null,body.shape==='circle'?body.latitude:null,body.shape==='circle'?body.radiusMetres:null]
  const assignment=`name=$1,village_number=$2,active=$3,boundary=CASE WHEN $4::text IS NOT NULL THEN ST_SetSRID(ST_GeomFromGeoJSON($4),4326)::geography END,
    center=CASE WHEN $5::float IS NOT NULL THEN ST_SetSRID(ST_MakePoint($5,$6),4326)::geography END,radius_metres=$7`
  const {rows:[saved]}=before?await client.query(`UPDATE patient_transfer.service_villages SET ${assignment} WHERE id=$8 RETURNING id`,[...values,id])
    :await client.query(`INSERT INTO patient_transfer.service_villages(name,village_number,active,boundary,center,radius_metres) VALUES($1,$2,$3,
      CASE WHEN $4::text IS NOT NULL THEN ST_SetSRID(ST_GeomFromGeoJSON($4),4326)::geography END,
      CASE WHEN $5::float IS NOT NULL THEN ST_SetSRID(ST_MakePoint($5,$6),4326)::geography END,$7) RETURNING id`,values)
  const {rows:[row]}=await client.query(`${villageSql} WHERE id=$1`,[saved.id]);const after=version(row)
  const changed=before&&(before.active!==after.active||before.shape!==after.shape||before.latitude!==after.latitude||before.longitude!==after.longitude||before.radiusMetres!==after.radiusMetres||JSON.stringify(before.geometry)!==JSON.stringify(after.geometry))
  const affected=changed?await configurationChange(client,user,'village',saved.id,after,now):0
  if(!changed) await client.query('UPDATE patient_transfer.service_settings SET revision=revision')
  await audit(client,user,before?'UPDATE_VILLAGE':'CREATE_VILLAGE','village',saved.id,before??null,after,reason,now)
  return {...after,affectedCount:affected}
}
export async function saveDepot(client,user,body,now) {
  check(user.role==='admin',403,'Administrator authority required')
  fields(body,['name','latitude','longitude','reason','expectedRevision'],['name','latitude','longitude','reason','expectedRevision']);coordinates(body)
  const name=text(body.name,'depot name',120),reason=text(body.reason,'reason',1000)
  const {rows:[row]}=await client.query(`SELECT s.revision,s.depot_name AS name,s.depot_location_id AS "locationId",ST_Y(l.point::geometry) AS latitude,ST_X(l.point::geometry) AS longitude
    FROM patient_transfer.service_settings s JOIN patient_transfer.locations l ON l.id=s.depot_location_id FOR UPDATE OF s`)
  check(row,503,'Service settings missing');revision(body,row)
  const before=version(row),changed=before.latitude!==body.latitude||before.longitude!==body.longitude
  const locationId=changed?await location(client,name,'depot',body):before.locationId
  await client.query('UPDATE patient_transfer.service_settings SET depot_name=$1,depot_location_id=$2',[name,locationId])
  const after={name,latitude:body.latitude,longitude:body.longitude,locationId}
  const affected=changed?await configurationChange(client,user,'depot',before.locationId,after,now):0
  await audit(client,user,'UPDATE_DEPOT','depot',locationId,before,after,reason,now)
  return {...after,affectedCount:affected}
}
export async function saveClosure(client,user,body,now) {
  check(user.role==='admin',403,'Administrator authority required')
  fields(body,['date','reason','active','expectedRevision'],['date','reason'])
  check(typeof body.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(body.date)&&Number.isFinite(Date.parse(`${body.date}T00:00:00Z`))&&new Date(`${body.date}T00:00:00Z`).toISOString().slice(0,10)===body.date,400,'Invalid closure date')
  const reason=text(body.reason,'closure reason',1000),active=body.active??true
  check(typeof active==='boolean',400,'Closure status required')
  const {rows:[row]}=await client.query("SELECT to_char(closed_on,'YYYY-MM-DD') AS date,active,revision,reason FROM patient_transfer.service_closures WHERE closed_on=$1 FOR UPDATE",[body.date])
  if(row) revision(body,row);else check((body.expectedRevision??0)===0,409,'Closure changed; reload revision')
  const {rows:[saved]}=await client.query(`INSERT INTO patient_transfer.service_closures(closed_on,reason,active,created_by,created_at) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(closed_on) DO UPDATE SET reason=EXCLUDED.reason,active=EXCLUDED.active RETURNING revision`,[body.date,reason,active,user.id,now])
  const after={date:body.date,reason,active,revision:Number(saved.revision)}
  const affected=await configurationChange(client,user,'closure',body.date,after,now)
  await audit(client,user,'SET_CLOSURE','closure',null,row?version(row):null,after,reason,now)
  return {...after,affectedCount:affected,reviewRequired:affected>0}
}
