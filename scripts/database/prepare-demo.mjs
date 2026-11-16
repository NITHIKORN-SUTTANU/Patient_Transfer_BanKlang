import pg from 'pg'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {createBooking,transaction} from '../../server/repository.mjs'

const uuidFor=value=>{
  const hex=createHash('sha256').update(value).digest('hex')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`
}
export async function prepareDemo(pool,{date,noticeVersion='demo-v1',now=new Date().toISOString()}={}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date??'')||!Number.isFinite(Date.parse(date+'T09:00:00+07:00'))||new Date(date+'T12:00:00+07:00').toISOString().slice(0,10)!==date)throw Error('Valid Bangkok demo date required')
  return transaction(pool,async client=>{
    const {rows:[owner]}=await client.query("SELECT id,role,line_subject FROM patient_transfer.users WHERE username='synthetic-citizen' FOR SHARE")
    const {rows:[admin]}=await client.query("SELECT id FROM patient_transfer.users WHERE username='demo-admin' AND role='admin' AND active FOR SHARE")
    if(!owner||owner.role!=='citizen'||owner.line_subject!==null||!admin)throw Error('Isolated fictional demo identities required')
    const prepared=[]
    for(const [index,time] of ['09:00','11:00','14:00'].entries()) {
      const requestId=uuidFor(`patient-transfer-fictional-demo:${date}:${time}`)
      const {rows:[existing]}=await client.query('SELECT id,reference,status FROM patient_transfer.bookings WHERE requester_id=$1 AND intake_request_id=$2',[owner.id,requestId])
      if(existing){prepared.push(existing);continue}
      const appointmentAt=`${date}T${time}:00+07:00`,submittedAt=new Date(Date.parse(appointmentAt)-72*3600000).toISOString()
      const consentId=uuidFor(`fictional-consent:${date}:${time}`)
      // Explicitly fictional history for an unlinked fixture identity, never a
      // fabricated consent or LINE identity for an actual person.
      await client.query(`INSERT INTO patient_transfer.consent_records(id,user_id,notice_version,accepted,recorded_at)
        VALUES($1,$2,$3,true,$4)`,[consentId,owner.id,noticeVersion,submittedAt])
      const booking=await createBooking(client,owner,{requestId,consentId,bookingFor:'other',patientName:`ผู้ป่วยสมมติสาธิต ${index+1}`,
        requesterName:'ผู้จัดสาธิตสมมติ',contactPhone:'0800000000',pickupAddress:'จุดรับสมมติสำหรับสาธิตเท่านั้น',latitude:18.59,longitude:99.05,
        landmark:'PRELOADED FICTIONAL DEMO — synthetic historical submission; no real patient or consent claim',
        villageId:'30000000-0000-4000-8000-000000000001',hospitalId:'40000000-0000-4000-8000-000000000001',mobility:'wheelchair',
        assistance:['boarding_support','caregiver_accompanies'],appointmentAt},submittedAt,noticeVersion)
      await client.query(`INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,reason,recorded_at)
        VALUES($1,'PREPARE_FICTIONAL_DEMO','booking',$2,$3,$4)`,[admin.id,booking.id,'Controlled offline fixture with synthetic historical submission; never a real requester consent. No clock override on the public API.',now])
      prepared.push({id:booking.id,reference:booking.reference,status:booking.status})
    }
    return prepared
  })
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  let pool
  try {
    const url=new URL(process.env.DATABASE_URL)
    if(process.env.ALLOW_SYNTHETIC_SEED!=='true'||process.env.ALLOW_LINE_DELIVERY!=='false'||url.pathname!=='/patient_transfer_demo'||!['database','localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Isolated demo database and disabled delivery required')
    const date=process.env.DEMO_DAY??new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
    pool=new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000})
    const bookings=await prepareDemo(pool,{date,noticeVersion:process.env.PRIVACY_NOTICE_VERSION??'demo-v1'})
    process.stdout.write(JSON.stringify({date,fictional:true,bookings})+'\n')
  }catch{process.stderr.write('Demo preparation failed; verify isolated configuration and initial demo accounts. No secrets printed.\n');process.exitCode=1}
  finally{if(pool)await pool.end()}
}
