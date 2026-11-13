import { check, fields, text, uuid } from './errors.mjs'
import { hashPassword } from './auth.mjs'

const staffRoles=['admin','dispatcher','driver']
const snapshot=row=>({id:row.id,name:row.display_name,username:row.username,role:row.role,active:row.active,revision:Number(row.revision)})
export async function adminAccounts(client,user) {
  check(user.role==='admin',403,'Administrator authority required')
  const {rows}=await client.query(`SELECT id,display_name,username,role,active,revision FROM patient_transfer.users
    WHERE role IN ('admin','dispatcher','driver') ORDER BY display_name,id`)
  return {accounts:rows.map(snapshot)}
}
export async function saveAccount(client,user,body,now,id) {
  check(user.role==='admin',403,'Administrator authority required')
  const required=['name','username','role','active','reason',...(id?['expectedRevision']:['password'])]
  fields(body,[...required,'password'],required)
  const name=text(body.name,'name',120),username=text(body.username,'username',120),reason=text(body.reason,'reason',1000)
  check(staffRoles.includes(body.role)&&typeof body.active==='boolean',400,'Valid staff role and account status required')
  let previous
  if(id) {
    const {rows:[row]}=await client.query('SELECT * FROM patient_transfer.users WHERE id=$1 FOR UPDATE',[uuid(id)])
    check(row&&staffRoles.includes(row.role),404,'Staff account not found')
    check(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision===Number(row.revision),409,'Account changed; reload current revision')
    previous=row
    if(row.role==='admin'&&row.active&&(!body.active||body.role!=='admin')) {
      const {rowCount}=await client.query("SELECT 1 FROM patient_transfer.users WHERE role='admin' AND active AND id<>$1",[row.id])
      check(rowCount>0,409,'At least one active administrator must remain',{code:'LAST_ACTIVE_ADMIN'})
    }
    const {rows:drivers}=await client.query('SELECT id FROM patient_transfer.drivers WHERE user_id=$1',[row.id])
    check(!drivers.length||body.role==='driver',409,'Linked driver account must keep its driver role',{code:'LINKED_DRIVER_ROLE'})
    if(row.active&&!body.active&&drivers.length) {
      const {rowCount}=await client.query(`SELECT 1 FROM patient_transfer.schedules s JOIN patient_transfer.bookings b ON b.id=s.booking_id
        JOIN patient_transfer.drivers d ON d.id=s.driver_id WHERE d.user_id=$1 AND s.committed AND s.released_at IS NULL
        AND b.status NOT IN ('COMPLETED','CANCELLED','REJECTED','ABORTED')`,[row.id])
      check(!rowCount,409,'Driver has unfinished operational work',{code:'UNFINISHED_DRIVER_WORK'})
    }
  }
  const {rowCount:duplicate}=await client.query('SELECT 1 FROM patient_transfer.users WHERE lower(username)=lower($1) AND ($2::uuid IS NULL OR id<>$2)',[username,id??null])
  check(!duplicate,409,'Username already in use',{code:'USERNAME_IN_USE'})
  let passwordHash=previous?.password_hash
  if(Object.hasOwn(body,'password')) {
    check(typeof body.password==='string'&&body.password.length>=12&&body.password.length<=512,400,'Password must contain 12–512 characters')
    passwordHash=await hashPassword(body.password)
  }
  const values=[name,username,body.role,body.active,passwordHash]
  const {rows:[saved]}=id
    ?await client.query(`UPDATE patient_transfer.users SET display_name=$1,username=$2,role=$3,active=$4,password_hash=$5 WHERE id=$6 RETURNING *`,[...values,id])
    :await client.query(`INSERT INTO patient_transfer.users(display_name,username,role,active,password_hash,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[...values,now])
  // Only the explicit staff metadata allowlist is retained; no password/hash/token/LINE data.
  await client.query(`INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,reason,recorded_at,before_data,after_data)
    VALUES($1,$2,'staff_account',$3,$4,$5,$6,$7)`,[user.id,id?'UPDATE_STAFF_ACCOUNT':'CREATE_STAFF_ACCOUNT',saved.id,reason,now,
      previous?snapshot(previous):null,snapshot(saved)])
  return snapshot(saved)
}

export async function adminSummary(client,user) {
  check(user.role==='admin',403,'Administrator authority required')
  const {rows}=await client.query(`SELECT status,count(*)::int AS count FROM patient_transfer.bookings GROUP BY status ORDER BY status`)
  return {statuses:rows}
}
