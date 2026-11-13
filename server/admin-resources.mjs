import { check, fields, text, uuid } from './errors.mjs'

const kinds=['vehicles','drivers']
const iso=value=>value?.toISOString()
function kindKey(kind) { check(kinds.includes(kind),404,'Resource type not found');return kind==='vehicles'?'vehicle_id':'driver_id' }
function snapshot(row,kind) {
  return {id:row.id,name:row.name,active:row.active,capabilities:row.capabilities,revision:Number(row.revision),locationId:row.location_id,availableAt:iso(row.available_at),
    ...(kind==='vehicles'?{plate:row.plate,vehicleType:row.vehicle_type}:{userId:row.user_id,phone:row.phone})}
}
export async function resourceRow(client,kind,id,lock=false) {
  kindKey(kind)
  const {rows:[row]}=await client.query(kind==='vehicles'
    ?`SELECT v.*,to_json(v.capabilities) AS capabilities FROM patient_transfer.vehicles v WHERE id=$1 ${lock?'FOR UPDATE':''}`
    :`SELECT d.*,to_json(d.capabilities) AS capabilities,u.display_name AS name FROM patient_transfer.drivers d JOIN patient_transfer.users u ON u.id=d.user_id WHERE d.id=$1 ${lock?'FOR UPDATE OF d':''}`,[uuid(id)])
  check(row,404,'Resource not found')
  return row
}
async function audit(client,user,action,entityType,id,before,after,reason,now) {
  await client.query(`INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,reason,recorded_at,before_data,after_data)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[user.id,action,entityType,id,reason,now,before,after])
}
function timestamp(value,label) {
  check(typeof value==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value)),400,`Explicit timezone required for ${label}`)
  return value
}
export async function saveResource(client,user,kind,body,now,id) {
  check(user.role==='admin',403,'Administrator authority required')
  const key=kindKey(kind)
  const common=['name','capabilities','active','reason',...(kind==='vehicles'?['plate','vehicleType']:['userId','phone'])]
  const required=[...common,...(id?['expectedRevision']:['locationId','availableAt','initialPositionConfirmed'])]
  fields(body,[...required,...(kind==='drivers'&&id?['sameDriverConfirmed']:[])],required)
  const name=text(body.name,'resource name',120),reason=text(body.reason,'reason',1000)
  const plate=kind==='vehicles'?text(body.plate,'plate',120):undefined
  const vehicleType=kind==='vehicles'?text(body.vehicleType,'vehicle type',120):undefined
  check(typeof body.active==='boolean',400,'Resource status required')
  check(Array.isArray(body.capabilities)&&body.capabilities.length>0&&body.capabilities.length<=3&&body.capabilities.every(value=>['standard','wheelchair','stretcher'].includes(value))&&new Set(body.capabilities).size===body.capabilities.length,400,'Invalid resource capabilities')
  const capabilities=[...body.capabilities].sort()
  const previous=id?await resourceRow(client,kind,id,true):null
  if(previous) {
    check(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision===Number(previous.revision),409,'Resource changed; reload revision')
    const identityChanged=kind==='vehicles'?plate!==previous.plate:body.userId!==previous.user_id
    const critical=identityChanged||previous.active&&!body.active||JSON.stringify([...previous.capabilities].sort())!==JSON.stringify(capabilities)
    if(critical) {
      const {rowCount}=await client.query(`SELECT 1 FROM patient_transfer.schedules s JOIN patient_transfer.bookings b ON b.id=s.booking_id
        WHERE s.${key}=$1 AND s.committed AND s.released_at IS NULL AND b.status NOT IN ('COMPLETED','CANCELLED','REJECTED','ABORTED')`,[id])
      check(!rowCount,409,'Resource has unfinished operational work',{code:'RESOURCE_UNFINISHED_WORK'})
    }
    if(kind==='drivers'&&identityChanged) {
      const {rowCount}=await client.query('SELECT 1 FROM patient_transfer.resource_holds WHERE driver_id=$1 AND ends_at IS NULL',[id])
      check(!rowCount,409,'Driver has unresolved readiness holds',{code:'RESOURCE_HELD'})
      check(body.sameDriverConfirmed===true,400,'Confirm that the linked account belongs to the same physical driver')
    }
  } else {
    uuid(body.locationId);timestamp(body.availableAt,'initial availability')
    check(body.initialPositionConfirmed===true,400,'Verified initial position required')
    const {rowCount}=await client.query("SELECT 1 FROM patient_transfer.locations WHERE id=$1 AND active AND kind IN ('depot','hospital')",[body.locationId])
    check(rowCount,422,'Active depot or hospital initial location required')
  }
  let saved
  if(kind==='vehicles') {
    const {rowCount:duplicate}=await client.query('SELECT 1 FROM patient_transfer.vehicles WHERE lower(plate)=lower($1) AND ($2::uuid IS NULL OR id<>$2)',[plate,id??null])
    check(!duplicate,409,'Vehicle plate already in use',{code:'PLATE_IN_USE'})
    const values=[name,plate,vehicleType,capabilities,body.active]
    const result=id?await client.query(`UPDATE patient_transfer.vehicles SET name=$1,plate=$2,vehicle_type=$3,capabilities=$4,active=$5 WHERE id=$6 RETURNING *,to_json(capabilities) AS capabilities`,[...values,id])
      :await client.query(`INSERT INTO patient_transfer.vehicles(name,plate,vehicle_type,capabilities,active,location_id,available_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *,to_json(capabilities) AS capabilities`,[...values,body.locationId,body.availableAt])
    saved=result.rows[0]
  } else {
    const userId=uuid(body.userId)
    const {rows:[account]}=await client.query('SELECT id,role,active FROM patient_transfer.users WHERE id=$1 FOR SHARE',[userId])
    check(account?.role==='driver'&&(!body.active||account.active),422,'An eligible driver account is required')
    const {rowCount:linked}=await client.query('SELECT 1 FROM patient_transfer.drivers WHERE user_id=$1 AND ($2::uuid IS NULL OR id<>$2)',[userId,id??null])
    check(!linked,409,'Account already linked to another driver',{code:'DRIVER_ALREADY_LINKED'})
    check(typeof body.phone==='string',400,'Driver contact phone required')
    const phone=body.phone.replace(/[\s-]/g,'').replace(/^\+66/,'0')
    check(/^0[0-9]{8,9}$/.test(phone),400,'Invalid driver contact phone')
    const values=[userId,phone,capabilities,body.active]
    const result=id?await client.query('UPDATE patient_transfer.drivers SET user_id=$1,phone=$2,capabilities=$3,active=$4 WHERE id=$5 RETURNING id',[...values,id])
      :await client.query('INSERT INTO patient_transfer.drivers(user_id,phone,capabilities,active,location_id,available_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[...values,body.locationId,body.availableAt])
    await client.query('UPDATE patient_transfer.users SET display_name=$2 WHERE id=$1 AND display_name<>$2',[userId,name])
    saved=await resourceRow(client,kind,result.rows[0].id)
  }
  const after=snapshot(saved,kind)
  await audit(client,user,id?'UPDATE_RESOURCE':'CREATE_RESOURCE',kind,saved.id,previous?snapshot(previous,kind):null,
    previous&&kind==='drivers'&&previous.user_id!==saved.user_id?{...after,sameDriverConfirmed:true}:after,reason,now)
  return after
}

function windowSnapshot(row) {return {id:row.id,vehicleId:row.vehicle_id,driverId:row.driver_id,startsAt:iso(row.starts_at),endsAt:iso(row.ends_at),retiredAt:iso(row.retired_at)??null,revision:Number(row.revision)}}
export async function listWindows(client,user) {
  check(user.role==='admin',403,'Administrator authority required')
  const {rows}=await client.query('SELECT * FROM patient_transfer.availability_windows WHERE retired_at IS NULL ORDER BY starts_at,id')
  return {windows:rows.map(windowSnapshot)}
}
export async function saveWindow(client,user,body,now,{kind,resourceId,id,retire=false}) {
  check(user.role==='admin',403,'Administrator authority required')
  fields(body,['expectedResourceRevision','expectedRevision','startsAt','endsAt','reason'],['expectedResourceRevision','reason',...(id?['expectedRevision']:[]),...(!retire?['startsAt','endsAt']:[])])
  const reason=text(body.reason,'reason',1000)
  let previous
  if(id) {
    const {rows:[row]}=await client.query('SELECT * FROM patient_transfer.availability_windows WHERE id=$1 FOR UPDATE',[uuid(id)])
    check(row,404,'Availability window not found')
    check(!row.retired_at&&Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision===Number(row.revision),409,'Availability window changed; reload revision')
    previous=row;kind=row.vehicle_id?'vehicles':'drivers';resourceId=row.vehicle_id??row.driver_id
  }
  const key=kindKey(kind),resource=await resourceRow(client,kind,resourceId,true)
  check(Number.isSafeInteger(body.expectedResourceRevision)&&body.expectedResourceRevision===Number(resource.revision),409,'Resource changed; reload revision')
  if(!retire) {
    timestamp(body.startsAt,'window start');timestamp(body.endsAt,'window end')
    check(Date.parse(body.endsAt)>Date.parse(body.startsAt),400,'Window end must follow start')
  }
  let saved
  try {
    const result=retire?await client.query('UPDATE patient_transfer.availability_windows SET retired_at=$2 WHERE id=$1 RETURNING *',[id,now])
      :id?await client.query('UPDATE patient_transfer.availability_windows SET starts_at=$2,ends_at=$3 WHERE id=$1 RETURNING *',[id,body.startsAt,body.endsAt])
      :await client.query(`INSERT INTO patient_transfer.availability_windows(${key},starts_at,ends_at) VALUES($1,$2,$3) RETURNING *`,[resourceId,body.startsAt,body.endsAt])
    saved=result.rows[0]
  } catch(error) {
    if(error.code==='23514') check(false,409,'Availability is required by unfinished assignments',{code:'ASSIGNMENT_WINDOW_REQUIRED'})
    throw error
  }
  const after=windowSnapshot(saved)
  await audit(client,user,retire?'RETIRE_AVAILABILITY':id?'UPDATE_AVAILABILITY':'CREATE_AVAILABILITY',kind,saved.id,previous?windowSnapshot(previous):null,after,reason,now)
  const current=await resourceRow(client,kind,resourceId)
  return {...after,resourceRevision:Number(current.revision)}
}
