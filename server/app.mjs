import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { newToken, tokenHash, verifyPassword } from './auth.mjs'
import { ApiError, check, fields, text, uuid } from './errors.mjs'
import { authorizeBooking, bookingRow, createBooking, previewConfiguration, schedulingAction, transaction } from './repository.mjs'
import { applyCommand } from './commands.mjs'
import { osrmRouting } from './routing.mjs'
import { lineIdentityVerifier } from './line.mjs'
import { catalog } from './catalog.mjs'
import { listProfiles, saveProfile } from './profiles.mjs'
import { adminAccounts, adminSummary, saveAccount } from './admin.mjs'
import { listWindows, saveResource, saveWindow } from './admin-resources.mjs'
import { serviceData, saveHospital, saveVillage, saveDepot, saveClosure } from './service-admin.mjs'
import { reviseDestination } from './destination.mjs'
import { notificationFailures,reviewNotification } from './notification-review.mjs'
import {dispatcherAlerts,acknowledgeAlert} from './dispatcher-alerts.mjs'
import {approvedAppOrigin} from './notification-messages.mjs'
import {dailyManifest,manifestRequest,auditManifest} from './daily-manifest.mjs'
import {manifestFile} from './manifest-files.mjs'
import {monthlyRequest,monthlyReport,monthlyFile,auditMonthlyReport} from './monthly-report.mjs'
import {dispatchReview,saveVerification} from './dispatch-review.mjs'
import {checkCapacity} from './capacity-evidence.mjs'
import { bookingList } from './booking-lists.mjs'

async function jsonBody(request) {
  check(request.headers['content-type']?.split(';')[0]==='application/json',415,'Content-Type application/json required')
  let size=0
  const chunks=[]
  for await(const chunk of request) {
    size+=chunk.length
    check(size<=32768,413,'Request body too large')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new ApiError(400,'Invalid JSON') }
}
export async function authenticate(client,request,now,lock=false) {
  const authorization=request.headers.authorization??''
  check(/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization),401,'Authentication required')
  const hash=tokenHash(authorization.slice(7))
  const {rows:[user]}=await client.query(`SELECT u.id,u.role,u.display_name,d.id AS driver_id,s.id AS session_id,
    EXISTS(SELECT 1 FROM patient_transfer.availability_windows w WHERE w.driver_id=d.id AND w.retired_at IS NULL AND w.starts_at<=$2 AND w.ends_at>$2) AS in_shift,
    to_char($2::timestamptz AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS service_day
    FROM patient_transfer.auth_sessions s JOIN patient_transfer.users u ON u.id=s.user_id
    LEFT JOIN patient_transfer.drivers d ON d.user_id=u.id AND d.active
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>$2 AND u.active AND s.access_version=u.access_version
    ${lock?'FOR SHARE OF u,s':''}`,[hash,now])
  check(user && (user.role!=='driver'||user.driver_id),401,'Session expired or revoked')
  return user
}
function publicBooking(row,user) {
  const leg=row.active_route_leg
  const result={id:row.id,reference:row.reference,status:row.status,revision:Number(row.revision),executionVersion:row.execution_version,
    patientName:row.patient_name,hospitalId:leg?.hospital_id??row.hospital_id,appointmentAt:row.appointment_at,startedAt:row.started_at,originName:row.origin_name,vehicleName:row.vehicle_name,
    hospitalName:leg?.hospital_name??row.hospital_name_snapshot,hospitalLocationId:leg?.hospital_location_id??row.hospital_location_snapshot,depotLocationId:row.depot_location_snapshot,
    destinationRevision:leg?{version:leg.version,arrivalAt:leg.arrival_at,readyAt:leg.ready_at,latenessSeconds:leg.lateness_seconds,appointmentLatenessSeconds:leg.appointment_lateness_seconds,originalHospitalName:row.hospital_name_snapshot,originalArrivalAt:row.original_arrival_at,recordedAt:leg.recorded_at}:null,
    vehicleId:row.vehicle_id,driverId:row.driver_id,incidentOpen:row.incident_open,resourceHold:user.role==='driver'?row.current_resource_hold:row.resource_hold,cancellationLocked:row.cancellation_locked,scheduleReviewRequired:row.schedule_review_required,
    schedule:row.schedule_id?{departureAt:row.departure_at,pickupAt:row.pickup_at,arrivalAt:row.arrival_at,readyAt:row.ready_at,pickupWaitingMinutes:row.pickup_waiting_seconds/60,originLocationId:row.origin_location_id,originKind:row.origin_kind,previousBookingId:row.previous_booking_id}:null}
  if(['citizen','driver','dispatcher'].includes(user.role)) Object.assign(result,{contactPhone:row.contact_phone,pickupAddress:row.pickup_address,
    latitude:row.latitude,longitude:row.longitude,mobility:row.mobility,assistance:row.assistance,landmark:row.landmark})
  if(['citizen','dispatcher'].includes(user.role)) Object.assign(result,{requesterName:row.requester_name,bookingFor:row.booking_for,villageId:row.village_id,patientProfileId:row.patient_profile_id,submittedAt:row.submitted_at,rejectionReason:row.rejection_reason})
  if(user.role==='dispatcher') {result.proposedSchedule=row.proposed_schedule;result.configurationChanges=row.configuration_reviews;result.destinationHistory=row.destination_history}
  return result
}

export function createApi({pool,clock=()=>new Date().toISOString(),route=osrmRouting(process.env.OSRM_URL),noticeVersion=process.env.PRIVACY_NOTICE_VERSION??'development-v1',allowedOrigin=process.env.FRONTEND_ORIGIN,onError=()=>{},
  verifyLine=lineIdentityVerifier(process.env.LINE_LOGIN_CHANNEL_ID),liffId=process.env.LINE_LIFF_ID??'',noticeText=process.env.PRIVACY_NOTICE_TEXT??'',contactPhone=process.env.MUNICIPAL_CONTACT_PHONE??''}={}) {
  const attempts=new Map()
  const server=http.createServer(async(request,response)=>{
    const now=clock()
    response.setHeader('Content-Type','application/json; charset=utf-8')
    response.setHeader('Cache-Control','no-store')
    response.setHeader('X-Content-Type-Options','nosniff')
    if(allowedOrigin && request.headers.origin===allowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin',allowedOrigin)
      response.setHeader('Vary','Origin')
      response.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type')
      response.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS')
    }
    const send=(status,value)=>{response.statusCode=status;response.end(JSON.stringify(value))}
    try {
      const path=new URL(request.url,'http://localhost').pathname
      if(request.method==='OPTIONS') {send(204,null);return}
      if(request.method==='GET'&&path==='/api/health') {await pool.query('SELECT 1');send(200,{status:'ok'});return}
      if(request.method==='GET'&&path==='/api/config') {send(200,{liffId,lineEnabled:!!liffId,noticeVersion,noticeText,contactPhone,opensAt:'06:00',closesAt:'16:00'});return}
      if(request.method==='POST'&&path==='/api/auth/line') {
        const body=fields(await jsonBody(request),['idToken'],['idToken'])
        check(typeof body.idToken==='string'&&body.idToken.length>0&&body.idToken.length<16000,400,'Valid LINE ID token required')
        const ip=`line:${request.socket.remoteAddress}`,timestamp=Date.now()
        const entry=attempts.get(ip)??{since:timestamp,count:0}
        if(timestamp-entry.since>15*60000) {entry.since=timestamp;entry.count=0}
        check(entry.count<20,429,'Too many LINE login attempts; retry later');entry.count++;attempts.set(ip,entry)
        const identity=await verifyLine(body.idToken,now)
        check(typeof identity.subject==='string'&&/^U[a-f0-9]{32}$/i.test(identity.subject),401,'Invalid verified LINE identity')
        const token=newToken()
        await transaction(pool,async client=>{
          const {rows:[user]}=await client.query(`INSERT INTO patient_transfer.users(role,display_name,line_subject) VALUES('citizen',$1,$2)
            ON CONFLICT(line_subject) DO UPDATE SET display_name=EXCLUDED.display_name
            WHERE users.role='citizen' AND users.active RETURNING id,access_version`,[identity.name||'ผู้ใช้ LINE',identity.subject])
          check(user,403,'LINE account is not eligible for citizen access')
          await client.query('INSERT INTO patient_transfer.auth_sessions(user_id,token_hash,access_version,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',
            [user.id,tokenHash(token),user.access_version,now,new Date(Date.parse(now)+8*3600000).toISOString()])
        })
        send(200,{token,expiresInSeconds:28800});return
      }
      if(request.method==='POST'&&path==='/api/auth/login') {
        const body=fields(await jsonBody(request),['username','password'],['username','password'])
        const username=text(body.username,'username',120)
        check(typeof body.password==='string'&&body.password.length>0&&body.password.length<=512,400,'Invalid password')
        const key=request.socket.remoteAddress
        const timestamp=Date.now()
        for(const [ip,entry] of attempts) if(timestamp-entry.since>15*60000) attempts.delete(ip)
        const entry=attempts.get(key)??{since:timestamp,count:0}
        check(entry.count<10,429,'Too many login attempts; retry later')
        entry.count++;attempts.set(key,entry)
        const {rows:[account]}=await pool.query('SELECT id,role,active,password_hash,access_version FROM patient_transfer.users WHERE lower(username)=lower($1)',[username])
        const valid=await verifyPassword(body.password,account?.password_hash)
        check(valid&&account?.active&&account.role!=='citizen',401,'Invalid credentials')
        const token=newToken()
        // Recheck access under lock so a concurrent suspension cannot create an active session.
        await transaction(pool,async client=>{
          const {rows:[fresh]}=await client.query('SELECT * FROM patient_transfer.users WHERE id=$1 FOR SHARE',[account.id])
          check(fresh.active&&fresh.access_version===account.access_version&&fresh.password_hash===account.password_hash,401,'Invalid credentials')
          await client.query(`INSERT INTO patient_transfer.auth_sessions(user_id,token_hash,access_version,created_at,expires_at) VALUES($1,$2,$3,$4,$5)`,
            [fresh.id,tokenHash(token),fresh.access_version,now,new Date(Date.parse(now)+8*3600000).toISOString()])
        })
        attempts.delete(key);send(200,{token,expiresInSeconds:28800});return
      }
      const body=request.method==='POST'?await jsonBody(request):undefined
      if(request.method==='POST'&&(path==='/api/reports/daily'||path==='/api/reports/monthly')) {
        const monthly=path==='/api/reports/monthly'
        const permitted=user=>monthly?['admin','dispatcher'].includes(user.role):user.role==='dispatcher'
        const report=await transaction(pool,async client=>{
          const user=await authenticate(client,request,clock(),true)
          check(permitted(user),403,'Report authority required')
          if(monthly)monthlyRequest(body);else manifestRequest(body)
          return {actor:user.id,data:monthly?await monthlyReport(client,user,body.month,clock()):await dailyManifest(client,user,body.date,clock())}
        })
        report.data.generatedAt=clock()
        // Render from the captured dataset without holding the operational lock.
        const file=monthly?await monthlyFile(report.data):await manifestFile(report.data,body.format)
        await transaction(pool,async client=>{
          const user=await authenticate(client,request,clock(),true)
          check(permitted(user)&&user.id===report.actor,403,'Report authority required')
          if(monthly)await auditMonthlyReport(client,user,report.data,clock());else await auditManifest(client,user,report.data,body.format,clock())
        })
        response.setHeader('Content-Type',file.contentType)
        response.setHeader('Content-Disposition',`attachment; filename="${file.filename}"`)
        response.setHeader('Content-Length',file.buffer.length)
        response.setHeader('X-Report-Id',report.data.id)
        response.end(file.buffer);return
      }
      if(request.method==='POST') {
        const result=await transaction(pool,async client=>{
          const user=await authenticate(client,request,now,true)
          const alertMatch=path.match(/^\/api\/dispatcher-alerts\/([^/]+)\/acknowledgement$/)
          if(alertMatch)return acknowledgeAlert(client,user,alertMatch[1],body,now)
          const notificationMatch=path.match(/^\/api\/(?:admin\/)?notification-failures\/([^/]+)$/)
          if(notificationMatch) {
            check(user.role===(path.startsWith('/api/admin/')?'admin':'dispatcher'),403,'Scoped notification review authority required')
            return reviewNotification(client,user,notificationMatch[1],body,now)
          }
          if(path==='/api/auth/logout') {await client.query('UPDATE patient_transfer.auth_sessions SET revoked_at=$2 WHERE id=$1',[user.session_id,now]);return {loggedOut:true}}
          if(path==='/api/consents') {
            check(user.role==='citizen',403,'Citizen identity required')
            fields(body,['accepted','noticeVersion'],['accepted','noticeVersion'])
            check(typeof body.accepted==='boolean'&&body.noticeVersion===noticeVersion,400,'Current privacy notice decision required')
            check(!body.accepted||noticeText.trim(),503,'Privacy notice is not configured')
            const id=randomUUID()
            await client.query('INSERT INTO patient_transfer.consent_records(id,user_id,notice_version,accepted,recorded_at) VALUES($1,$2,$3,$4,$5)',[id,user.id,noticeVersion,body.accepted,now])
            return {id,accepted:body.accepted}
          }
          if(path==='/api/bookings') return publicBooking(await createBooking(client,user,body,now,noticeVersion),user)
          const verificationMatch=path.match(/^\/api\/bookings\/([^/]+)\/verification$/)
          if(verificationMatch)return saveVerification(client,user,verificationMatch[1],body,now)
          const capacityMatch=path.match(/^\/api\/bookings\/([^/]+)\/capacity-checks$/)
          if(capacityMatch){check(user.role==='dispatcher',403,'Dispatcher capacity authority required');return checkCapacity(client,await bookingRow(client,uuid(capacityMatch[1])),user,body,route,now)}
          if(path==='/api/profiles') return saveProfile(client,user,body,now,noticeVersion)
          const profileMatch=path.match(/^\/api\/profiles\/([^/]+)$/)
          if(profileMatch) return saveProfile(client,user,body,now,noticeVersion,profileMatch[1])
          if(path==='/api/admin/closures') return saveClosure(client,user,body,now)
          if(path==='/api/admin/depot') return saveDepot(client,user,body,now)
          const hospitalMatch=path.match(/^\/api\/admin\/hospitals(?:\/([^/]+))?$/)
          if(hospitalMatch) return saveHospital(client,user,body,now,hospitalMatch[1])
          const villageMatch=path.match(/^\/api\/admin\/villages(?:\/([^/]+))?$/)
          if(villageMatch) return saveVillage(client,user,body,now,villageMatch[1])
          if(path==='/api/admin/accounts') return saveAccount(client,user,body,now)
          const accountMatch=path.match(/^\/api\/admin\/accounts\/([^/]+)$/)
          if(accountMatch) return saveAccount(client,user,body,now,accountMatch[1])
          const masterMatch=path.match(/^\/api\/admin\/resources\/(vehicles|drivers)(?:\/([^/]+))?$/)
          if(masterMatch) return saveResource(client,user,masterMatch[1],body,now,masterMatch[2])
          const newWindow=path.match(/^\/api\/admin\/resources\/(vehicles|drivers)\/([^/]+)\/windows$/)
          if(newWindow) return saveWindow(client,user,body,now,{kind:newWindow[1],resourceId:newWindow[2]})
          const windowMatch=path.match(/^\/api\/admin\/availability\/([^/]+)(\/retire)?$/)
          if(windowMatch) return saveWindow(client,user,body,now,{id:windowMatch[1],retire:!!windowMatch[2]})
          const resourceMatch=path.match(/^\/api\/resources\/(vehicles|drivers)\/([^/]+)\/readiness$/)
          if(resourceMatch) {
            check(user.role==='dispatcher',403,'Dispatcher authority required')
            fields(body,['locationId','reason'],['locationId','reason'])
            const key=resourceMatch[1]==='vehicles'?'vehicle_id':'driver_id'
            const id=uuid(resourceMatch[2]);uuid(body.locationId);text(body.reason,'readiness reason')
            const {rows:[resource]}=await client.query(`SELECT id FROM patient_transfer.${resourceMatch[1]} WHERE id=$1 FOR UPDATE`,[id])
            check(resource,404,'Resource not found')
            const {rows:busy}=await client.query(`SELECT 1 FROM patient_transfer.schedules s JOIN patient_transfer.bookings b ON b.id=s.booking_id
              WHERE s.${key}=$1 AND s.committed AND s.released_at IS NULL AND b.started_at IS NOT NULL
              AND b.status NOT IN ('COMPLETED','CANCELLED','REJECTED','ABORTED') LIMIT 1`,[id])
            check(!busy.length,409,'Resource still executing an active trip')
            const {rows:turnaround}=await client.query(`SELECT 1 FROM patient_transfer.resource_holds h JOIN patient_transfer.bookings b ON b.id=h.booking_id
              JOIN patient_transfer.trip_events e ON e.booking_id=b.id AND e.command='CONFIRM_HANDOVER'
              JOIN patient_transfer.schedules s ON s.booking_id=b.id AND s.committed AND s.released_at IS NULL
              WHERE h.${key}=$1 AND h.ends_at IS NULL AND b.status='COMPLETED'
              AND greatest(s.ready_at,(SELECT r.ready_at FROM patient_transfer.trip_route_legs r WHERE r.schedule_id=s.id ORDER BY version DESC LIMIT 1),e.recorded_at+interval '30 minutes')>$2 LIMIT 1`,[id,now])
            check(!turnaround.length,409,'Turnaround not complete')
            const {rows:equal}=await client.query(`SELECT 1 FROM patient_transfer.resource_holds WHERE ${key}=$1 AND ends_at IS NULL AND starts_at >= $2 LIMIT 1`,[id,now])
            check(!equal.length,409,'Readiness must follow hold event')
            // Serialize finalization across independently confirmed resources.
            // Active trips and their incidents must never be closed by resource readiness.
            const {rows:ended}=await client.query(`SELECT b.id FROM patient_transfer.bookings b
              WHERE b.status IN ('COMPLETED','CANCELLED','REJECTED','ABORTED') AND EXISTS(
                SELECT 1 FROM patient_transfer.resource_holds h WHERE h.booking_id=b.id AND h.${key}=$1 AND h.ends_at IS NULL)
              ORDER BY b.id FOR UPDATE OF b`,[id])
            await client.query(`UPDATE patient_transfer.resource_holds SET ends_at=$2 WHERE ${key}=$1 AND ends_at IS NULL`,[id,now])
            for(const booking of ended) {
              const {rowCount:finalized}=await client.query(`UPDATE patient_transfer.bookings b SET incident_open=false,revision=revision+1
                WHERE b.id=$1 AND b.incident_open AND NOT EXISTS(
                  SELECT 1 FROM patient_transfer.resource_holds h WHERE h.booking_id=b.id AND h.ends_at IS NULL)`,[booking.id])
              if(finalized) {
                await client.query(`UPDATE patient_transfer.trip_incidents SET resolved_by=$2,resolved_at=$3,resolution=$4
                  WHERE booking_id=$1 AND resolved_at IS NULL`,[booking.id,user.id,now,body.reason])
                await client.query(`INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,reason,recorded_at)
                  VALUES($1,'CONFIRM_TERMINAL_READY','booking',$2,$3,$4)`,[user.id,booking.id,body.reason,now])
              }
            }
            await client.query(`INSERT INTO patient_transfer.resource_position_updates(${key},location_id,confirmed_by,confirmed_at,reason) VALUES($1,$2,$3,$4,$5)`,[id,body.locationId,user.id,now,body.reason])
            await client.query(`INSERT INTO patient_transfer.audit_logs(actor_id,action,entity_type,entity_id,reason,recorded_at) VALUES($1,'CONFIRM_RESOURCE_READY',$2,$3,$4,$5)`,[user.id,resourceMatch[1],id,body.reason,now])
            return {id,ready:true,locationId:body.locationId}
          }
          const match=path.match(/^\/api\/bookings\/([^/]+)\/(commands|schedule|assignment|modification|configuration-preview|destination-preview|destination)$/)
          check(match,404,'Endpoint not found')
          const row=await bookingRow(client,uuid(match[1]),true)
          authorizeBooking(user,row)
          if(match[2]==='configuration-preview') return previewConfiguration(client,row,user,body,route,now)
          if(match[2]==='destination-preview') return reviseDestination(client,row,user,body,route,now,true)
          if(match[2]==='destination') return publicBooking(await reviseDestination(client,row,user,body,route,now),user)
          const updated=match[2]==='commands'?await applyCommand(client,row,user,body,now,route):await schedulingAction(client,row,user,body,
            match[2]==='modification'?'modify':match[2]==='assignment'?'assign':'schedule',route,now)
          return publicBooking(updated,user)
        })
        send(['/api/bookings','/api/consents','/api/profiles','/api/admin/accounts'].includes(path)||/^\/api\/admin\/resources\/(vehicles|drivers)(?:\/[^/]+\/windows)?$/.test(path)?201:200,result);return
      }
      const reviewMatch=path.match(/^\/api\/bookings\/([^/]+)\/review$/)
      if(request.method==='GET'&&reviewMatch){
        const result=await transaction(pool,async client=>dispatchReview(client,await authenticate(client,request,clock(),true),reviewMatch[1],new URL(request.url,'http://localhost').searchParams.get('cursor')))
        send(200,result);return
      }
      const client=await pool.connect()
      try {
        const user=await authenticate(client,request,now)
        if(request.method==='GET'&&path==='/api/dispatcher-alerts') {send(200,await dispatcherAlerts(client,user,new URL(request.url,'http://localhost').searchParams.get('cursor')));return}
        if(request.method==='GET'&&['/api/notification-failures','/api/admin/notification-failures'].includes(path)) {
          check(user.role===(path.startsWith('/api/admin/')?'admin':'dispatcher'),403,'Scoped notification review authority required')
          send(200,await notificationFailures(client,user,new URL(request.url,'http://localhost').searchParams.get('cursor'),{configured:!!process.env.LINE_CHANNEL_ACCESS_TOKEN,deliveryEnabled:process.env.ALLOW_LINE_DELIVERY==='true',linksConfigured:!!approvedAppOrigin(process.env.PUBLIC_APP_URL)}));return
        }
        if(request.method==='GET'&&path==='/api/auth/me') {send(200,{id:user.id,role:user.role,name:user.display_name,driverId:user.driver_id});return}
        if(request.method==='GET'&&path==='/api/catalog') {send(200,await catalog(client,user));return}
        if(request.method==='GET'&&path==='/api/admin/accounts') {send(200,await adminAccounts(client,user));return}
        if(request.method==='GET'&&path==='/api/admin/summary') {send(200,await adminSummary(client,user));return}
        if(request.method==='GET'&&path==='/api/admin/availability') {send(200,await listWindows(client,user));return}
        if(request.method==='GET'&&path==='/api/admin/service-data') {send(200,await serviceData(client,user));return}
        if(request.method==='GET'&&path==='/api/profiles') {send(200,await listProfiles(client,user));return}
        if(request.method==='GET'&&path==='/api/driver/history') {
          send(200,await bookingList(client,user,new URL(request.url,'http://localhost').searchParams.get('cursor'),publicBooking,true));return
        }
        if(request.method==='GET'&&path==='/api/admin/audit') {
          check(user.role==='admin',403,'Administrator authority required')
          const {rows}=await client.query(`SELECT a.id,a.action,a.entity_type AS "entityType",a.recorded_at AS "recordedAt",
            CASE WHEN u.role='citizen' THEN 'citizen' ELSE u.display_name END AS actor,
            CASE WHEN a.entity_type IN ('staff_account','vehicles','drivers','hospital','village','depot','closure') AND a.after_data IS NOT NULL THEN a.entity_id END AS "entityId",
            CASE WHEN a.entity_type IN ('staff_account','vehicles','drivers','hospital','village','depot','closure') AND a.after_data IS NOT NULL THEN a.reason END AS reason,
            CASE WHEN a.entity_type IN ('staff_account','vehicles','drivers','hospital','village','depot','closure') THEN a.before_data END AS before,
            CASE WHEN a.entity_type IN ('staff_account','vehicles','drivers','hospital','village','depot','closure') THEN a.after_data END AS after
            FROM patient_transfer.audit_logs a LEFT JOIN patient_transfer.users u ON u.id=a.actor_id ORDER BY a.recorded_at DESC LIMIT 100`)
          send(200,{events:rows});return
        }
        if(request.method==='GET'&&path==='/api/bookings') {
          send(200,await bookingList(client,user,new URL(request.url,'http://localhost').searchParams.get('cursor'),publicBooking));return
        }
        const match=path.match(/^\/api\/bookings\/([^/]+)$/)
        if(request.method==='GET'&&match) {
          const row=await bookingRow(client,uuid(match[1]));authorizeBooking(user,row);send(200,publicBooking(row,user));return
        }
        throw new ApiError(404,'Endpoint not found')
      } finally {client.release()}
    } catch(error) {
      const conflict=['23505','23P01','40001','40P01','55P03'].includes(error.code)
      const invalid=error.code?.startsWith('22')||['23514','23503','23502'].includes(error.code)
      const domain=error instanceof Error&&!(error instanceof ApiError)&&!error.code&&['required','permitted','changed','confirmation','preceding','rollback','identifier','already','before','forbidden','pickup','authority','resources'].some(word=>error.message.toLowerCase().includes(word))
      const status=error.status??(conflict?409:invalid?422:domain?409:500)
      if(status===500) onError(error)
      send(status,{error:status===500?'Internal server error':error.status||domain?error.message:conflict?'Conflicting database update':'Invalid operation',...(error.details?{details:error.details}:{})})
    }
  })
  server.requestTimeout=15000
  server.headersTimeout=10000
  return server
}
