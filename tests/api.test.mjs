import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { migrate } from '../scripts/database/migrate.mjs'
import { createApi } from '../server/app.mjs'
import { hashPassword, newToken, tokenHash } from '../server/auth.mjs'
import { ApiError } from '../server/errors.mjs'
import { deliverNotifications } from '../server/notifications.mjs'

const adminUrl=process.env.DATABASE_TEST_ADMIN_URL
if(!adminUrl) throw new Error('DATABASE_TEST_ADMIN_URL required')
const url=new URL(adminUrl)
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('API tests require a local database')
const databaseName=`pt_test_${randomUUID().replaceAll('-','')}`
const ids={ citizen:'00000000-0000-4000-8000-000000000001',officer:'00000000-0000-4000-8000-000000000002',
  driver:'00000000-0000-4000-8000-000000000003',admin:'00000000-0000-4000-8000-000000000004',driver2:randomUUID(),other:randomUUID(),
  depot:'20000000-0000-4000-8000-000000000001',hospital:'40000000-0000-4000-8000-000000000001',
  pickup:'20000000-0000-4000-8000-000000000003',village:'30000000-0000-4000-8000-000000000001',
  vehicle:'50000000-0000-4000-8000-000000000001',vehicle2:'50000000-0000-4000-8000-000000000002',
  roster:'60000000-0000-4000-8000-000000000001',roster2:randomUUID() }
const password='Synthetic-Test-Password-Only-123'
const stamp=(day,clock)=>`2030-01-${day}T${clock}:00+07:00`

test('authenticated API persists complete synthetic journeys',async t=>{
  const admin=new pg.Client({connectionString:adminUrl})
  let pool,server,created=false
  let now=stamp('12','06:00')
  let routingUnavailable=false
  try {
    await admin.connect();await admin.query(`CREATE DATABASE "${databaseName}"`);created=true
    url.pathname=`/${databaseName}`
    pool=new pg.Pool({connectionString:url.toString(),max:8})
    const client=await pool.connect()
    try {
      await migrate(client)
      const seed=await readFile(new URL('../database/seeds/development.sql',import.meta.url),'utf8')
      await client.query('BEGIN');await client.query(seed);await client.query('COMMIT')
      const hash=await hashPassword(password)
      await client.query("UPDATE patient_transfer.users SET password_hash=$1 WHERE role IN ('dispatcher','driver','admin')",[hash])
      await client.query(`INSERT INTO patient_transfer.users(id,role,display_name,username,password_hash) VALUES($1,'driver','Synthetic replacement driver','synthetic-driver-2',$2),($3,'citizen','Other synthetic requester','other-synthetic',NULL)`,[ids.driver2,hash,ids.other])
      await client.query(`INSERT INTO patient_transfer.drivers(id,user_id,location_id,available_at) VALUES($1,$2,$3,'2029-01-01T00:00:00Z')`,[ids.roster2,ids.driver2,ids.depot])
      await client.query(`INSERT INTO patient_transfer.availability_windows(vehicle_id,starts_at,ends_at)
        SELECT v.id,day+time '06:00',day+time '16:00' FROM patient_transfer.vehicles v CROSS JOIN generate_series(date '2030-01-15',date '2030-01-25',interval '1 day') day`)
      await client.query(`INSERT INTO patient_transfer.availability_windows(driver_id,starts_at,ends_at)
        SELECT d.id,day+time '06:00',day+time '16:00' FROM patient_transfer.drivers d CROSS JOIN generate_series(date '2030-01-15',date '2030-01-25',interval '1 day') day`)
      // Fixture windows above are expressed in Bangkok local time.
      await client.query("UPDATE patient_transfer.availability_windows SET starts_at=starts_at-interval '7 hours',ends_at=ends_at-interval '7 hours'")
    } finally {client.release()}
    const tokens={}
    for(const role of ['citizen','officer','driver','admin','driver2','other']) {
      const token=newToken();tokens[role]=token
      await pool.query(`INSERT INTO patient_transfer.auth_sessions(user_id,token_hash,access_version,created_at,expires_at)
        SELECT id,$1,access_version,'2029-01-01T00:00:00Z','2031-01-01T00:00:00Z' FROM patient_transfer.users WHERE id=$2`,[tokenHash(token),ids[role]])
    }
    server=createApi({pool,clock:()=>new Date(now).toISOString(),liffId:'synthetic-liff',verifyLine:async token=>{
      if(token==='synthetic-verified-token') return {subject:`U${'a'.repeat(32)}`,name:'Synthetic verified citizen'}
      if(token==='synthetic-staff-token') return {subject:`U${'c'.repeat(32)}`,name:'Must not replace staff'}
      throw new ApiError(401,'Invalid LINE token')
    },noticeText:'Synthetic transport privacy notice for tests only',onError:error=>process.stderr.write(`Internal test error ${error.code}: ${error.message}\n`),route:async(from)=>{
      if(routingUnavailable) throw new ApiError(503,'Routing unavailable')
      return {minutes:from.kind==='pickup'?5:from.kind?15:35,source:'synthetic-test'}
    }})
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    const base=`http://127.0.0.1:${server.address().port}`
    async function request(path,role='officer',body,expected=200) {
      const response=await globalThis.fetch(`${base}/api${path}`,{method:body?'POST':'GET',
        headers:{...(role?{Authorization:`Bearer ${tokens[role]}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
      const result=await response.json()
      assert.equal(response.status,expected,JSON.stringify(result))
      return result
    }
    async function intake(day,overrides={},expected=201) {
      now=stamp('12','06:00')
      const consent=await request('/consents','citizen',{accepted:true,noticeVersion:'development-v1'},201)
      return request('/bookings','citizen',{consentId:consent.id,bookingFor:'self',patientName:'Synthetic patient',requesterName:'Synthetic requester',contactPhone:'0800000000',
        pickupAddress:'Synthetic address',latitude:18.59,longitude:99.05,villageId:ids.village,hospitalId:ids.hospital,mobility:'standard',appointmentAt:stamp(day,'09:00'),...overrides},expected)
    }
    const command=(booking,type,extra={},role='officer',expected=200,eventId=randomUUID())=>request(`/bookings/${booking.id}/commands`,role,
      {eventId,expectedRevision:booking.revision,expectedExecutionVersion:booking.executionVersion,command:{type,...extra}},expected)
    const scheduleBody=booking=>({eventId:randomUUID(),expectedRevision:booking.revision,vehicleId:ids.vehicle,driverId:ids.roster,originLocationId:ids.depot})
    async function assigned(day) {
      let booking=await intake(day)
      booking=await command(booking,'APPROVE')
      booking=await request(`/bookings/${booking.id}/schedule`,'officer',scheduleBody(booking))
      return request(`/bookings/${booking.id}/assignment`,'officer',scheduleBody(booking))
    }
    async function readyAll(day,clock='10:00') {
      now=stamp(day,clock)
      for(const [kind,list] of [['vehicles',[ids.vehicle,ids.vehicle2]],['drivers',[ids.roster,ids.roster2]]]) {
        for(const id of list) await request(`/resources/${kind}/${id}/readiness`,'officer',{locationId:ids.depot,reason:'Synthetic physical readiness and depot position verified'})
      }
    }

    await t.test('saved profiles enforce ownership, validation, consent and immutable booking snapshots',async()=>{
      await request('/profiles',null,undefined,401)
      for(const role of ['officer','driver','admin']) await request('/profiles',role,undefined,403)
      const consent=await request('/consents','citizen',{accepted:true,noticeVersion:'development-v1'},201)
      const body={consentId:consent.id,patientName:' ผู้ป่วยทดสอบ ',contactPhone:'+66 80-000-0000',mobility:'wheelchair',villageId:ids.village,pickupAddress:' จุดรับทดสอบ ',latitude:18.59,longitude:99.05,assistance:['boarding_support'],landmark:' ประตูหน้า '}
      const profile=await request('/profiles','citizen',body,201)
      assert.equal(profile.patientName,'ผู้ป่วยทดสอบ')
      assert.equal(profile.contactPhone,'0800000000')
      assert.equal(profile.landmark,'ประตูหน้า')
      assert.deepEqual(profile.assistance,['boarding_support'])
      assert.ok((await request('/profiles','citizen')).profiles.some(p=>p.id===profile.id))
      assert.equal((await request('/profiles','other')).profiles.length,0)
      await request(`/profiles/${profile.id}`,'other',body,404)
      await request('/profiles','officer',body,403)
      await request('/profiles','citizen',{...body,diagnosis:'forbidden'},400)
      await request('/profiles','citizen',{...body,patientName:'😀'.repeat(121)},400)
      await request('/profiles','citizen',{...body,contactPhone:'123'},400)
      await request('/profiles','citizen',{...body,latitude:0,longitude:0},422)
      await request('/profiles','citizen',{...body,consentId:randomUUID()},422)
      const refused=await request('/consents','citizen',{accepted:false,noticeVersion:'development-v1'},201)
      await request('/profiles','citizen',{...body,consentId:refused.id},422)
      await request('/profiles','citizen',body,422)
      body.consentId=(await request('/consents','citizen',{accepted:true,noticeVersion:'development-v1'},201)).id
      await pool.query('UPDATE patient_transfer.service_villages SET active=false WHERE id=$1',[ids.village])
      assert.equal((await request('/profiles','citizen')).profiles.some(row=>row.id===profile.id),false)
      await request('/profiles','citizen',body,422)
      await pool.query('UPDATE patient_transfer.service_villages SET active=true WHERE id=$1',[ids.village])
      const booking=await intake('15',{patientProfileId:profile.id,patientName:profile.patientName,mobility:profile.mobility,assistance:profile.assistance,landmark:profile.landmark})
      await intake('15',{patientProfileId:randomUUID()},422)
      body.consentId=(await request('/consents','citizen',{accepted:true,noticeVersion:'development-v1'},201)).id
      const updated=await request(`/profiles/${profile.id}`,'citizen',{...body,patientName:'Future autofill only',mobility:'standard',pickupAddress:'New saved pickup',latitude:18.591,assistance:[],landmark:''})
      assert.equal(updated.patientName,'Future autofill only')
      const snapshot=await request(`/bookings/${booking.id}`,'citizen')
      assert.equal(snapshot.patientName,profile.patientName)
      assert.equal(snapshot.mobility,'wheelchair')
      assert.equal(snapshot.latitude,18.59)
      assert.equal(snapshot.pickupAddress,'Synthetic address')
      assert.deepEqual(snapshot.assistance,['boarding_support'])
      assert.equal(snapshot.landmark,'ประตูหน้า')
      const {rows:[audit]}=await pool.query("SELECT count(*)::int AS count FROM patient_transfer.audit_logs WHERE entity_id=$1 AND entity_type='patient_profile'",[profile.id])
      assert.equal(audit.count,2)
    })
    await t.test('citizen intake normalizes Unicode/phone and persists controlled assistance and relationship',async()=>{
      const booking=await intake('15',{bookingFor:'other',patientName:` ${'😀'.repeat(120)} `,requesterName:' ผู้ดูแล ',contactPhone:'+66 80-000-0000',landmark:` ${'ก'.repeat(1000)} `,assistance:['boarding_support','caregiver_accompanies']})
      assert.equal(booking.patientName,'😀'.repeat(120))
      assert.equal(booking.requesterName,'ผู้ดูแล')
      assert.equal(booking.contactPhone,'0800000000')
      assert.equal(booking.bookingFor,'other')
      assert.equal(booking.landmark.length,1000)
      assert.deepEqual((await request(`/bookings/${booking.id}`,'officer')).assistance,['boarding_support','caregiver_accompanies'])
      for(const overrides of [{patientName:'ก'.repeat(121)},{requesterName:'😀'.repeat(121)},{landmark:'ก'.repeat(1001)},
        {contactPhone:'+660800000000'},{assistance:['diagnosis']},{assistance:['boarding_support','boarding_support']},
        {assistance:[null]},{assistance:'boarding_support'},{bookingFor:'unknown'},{bookingFor:null},{latitude:'18.59'}]) {
        const error=await intake('15',overrides,400)
        assert.ok(error.details.field)
      }
      const empty=await intake('15',{landmark:'  '})
      assert.deepEqual(empty.assistance,[])
      assert.equal(empty.landmark,'')
      await assert.rejects(pool.query("UPDATE patient_transfer.bookings SET assistance=ARRAY['clinical'] WHERE id=$1",[booking.id]),error=>error.code==='23514')
      await assert.rejects(pool.query("UPDATE patient_transfer.bookings SET assistance=ARRAY['boarding_support','boarding_support'] WHERE id=$1",[booking.id]),error=>error.code==='23514')
    })
    await t.test('latest consent decision gates new intake even at identical timestamps; old bookings retain snapshots',async()=>{
      const existing=await intake('15')
      const {rows:[snapshot]}=await pool.query('SELECT consent_id FROM patient_transfer.bookings WHERE id=$1',[existing.id])
      const body={consentId:snapshot.consent_id,bookingFor:'self',patientName:'Synthetic patient',requesterName:'Synthetic requester',contactPhone:'0800000000',pickupAddress:'Synthetic address',latitude:18.59,longitude:99.05,villageId:ids.village,hospitalId:ids.hospital,mobility:'standard',appointmentAt:stamp('15','09:00')}
      await request('/consents','citizen',{accepted:false,noticeVersion:'development-v1'},201)
      await request('/bookings','citizen',body,422)
      body.consentId=(await request('/consents','citizen',{accepted:true,noticeVersion:'development-v1'},201)).id
      await request('/bookings','citizen',body,201)
      assert.equal((await pool.query('SELECT consent_id FROM patient_transfer.bookings WHERE id=$1',[existing.id])).rows[0].consent_id,snapshot.consent_id)
    })
    await t.test('citizen sees authoritative rejection reason and cannot read another request',async()=>{
      const booking=await intake('15')
      const rejected=await command(booking,'REJECT',{reason:'Synthetic transport-only rejection',rejectionKind:'other'})
      assert.equal(rejected.status,'REJECTED')
      const own=await request(`/bookings/${booking.id}`,'citizen')
      assert.equal(own.rejectionReason,'Synthetic transport-only rejection')
      assert.equal(own.submittedAt,new Date(stamp('12','06:00')).toISOString())
      await request(`/bookings/${booking.id}`,'other',undefined,403)
      await command(own,'CANCEL',{reason:'Must remain rejected'},'citizen',409)
    })
    await t.test('admin account CRUD enforces scope, revisions, last administrator and immediate revocation without secret audit data',async()=>{
      for(const role of ['citizen','officer','driver']) {
        await request('/admin/accounts',role,undefined,403)
        await request('/admin/summary',role,undefined,403)
      }
      const accounts=await request('/admin/accounts','admin')
      assert.equal(accounts.accounts.some(row=>row.id===ids.citizen),false)
      assert.equal(JSON.stringify(accounts).includes('password'),false)
      const currentAdmin=accounts.accounts.find(row=>row.id===ids.admin)
      const body={name:currentAdmin.name,username:currentAdmin.username,role:'admin',active:false,reason:'Synthetic last admin safeguard',expectedRevision:currentAdmin.revision}
      await request(`/admin/accounts/${ids.admin}`,'admin',body,409)
      await request(`/admin/accounts/${ids.citizen}`,'admin',body,404)
      const input={name:'Synthetic managed staff',username:'managed-synthetic',role:'admin',active:true,reason:'Synthetic account creation',password}
      await request('/admin/accounts','citizen',input,403)
      await request('/admin/accounts','admin',{...input,password:'short'},400)
      await request('/admin/accounts','admin',{...input,accessVersion:100},400)
      let managed=await request('/admin/accounts','admin',input,201)
      assert.equal(managed.revision,1)
      assert.equal(Object.hasOwn(managed,'password_hash'),false)
      let login=await request('/auth/login',null,{username:input.username,password})
      tokens.managed=login.token
      assert.equal((await request('/auth/me','managed')).role,'admin')
      const edit={name:managed.name,username:managed.username,role:'dispatcher',active:true,reason:'Synthetic role reduction',expectedRevision:managed.revision}
      await request(`/admin/accounts/${managed.id}`,'admin',{...edit,expectedRevision:0},409)
      managed=await request(`/admin/accounts/${managed.id}`,'admin',edit)
      await request('/auth/me','managed',undefined,401)
      login=await request('/auth/login',null,{username:input.username,password});tokens.managed=login.token
      assert.equal((await request('/auth/me','managed')).role,'dispatcher')
      const newPassword='Synthetic-New-Password-Only-123'
      managed=await request(`/admin/accounts/${managed.id}`,'admin',{...edit,expectedRevision:managed.revision,password:newPassword})
      await request('/auth/me','managed',undefined,401)
      await request('/auth/login',null,{username:input.username,password},401)
      login=await request('/auth/login',null,{username:input.username,password:newPassword});tokens.managed=login.token
      managed=await request(`/admin/accounts/${managed.id}`,'admin',{...edit,expectedRevision:managed.revision,active:false})
      await request('/auth/me','managed',undefined,401)
      const driverAccount=(await request('/admin/accounts','admin')).accounts.find(row=>row.id===ids.driver)
      await request(`/admin/accounts/${ids.driver}`,'admin',{...edit,name:driverAccount.name,username:driverAccount.username,expectedRevision:driverAccount.revision},409)
      const audit=await request('/admin/audit','admin')
      assert.equal(audit.events.some(event=>event.actor==='Synthetic requester'),false)
      const adminCatalog=await request('/catalog','admin')
      assert.ok(adminCatalog.locations.every(location=>location.kind!=='pickup'))
      assert.equal(adminCatalog.settings.opensAt,'06:00')
      assert.equal(adminCatalog.settings.closesAt,'16:00')
      const events=audit.events.filter(row=>row.entityId===managed.id)
      assert.equal(events.length,4)
      assert.equal(events.find(event=>event.after.revision===managed.revision).after.active,false)
      for(const event of events) {
        const value=JSON.stringify(event)
        assert.equal(value.includes(password),false);assert.equal(value.includes(newPassword),false)
        assert.equal(value.includes('password_hash'),false);assert.equal(value.includes('scrypt-v1'),false)
      }
      const summary=await request('/admin/summary','admin')
      assert.ok(summary.statuses.every(row=>Object.keys(row).sort().join(',')==='count,status'))
    })
    await t.test('admin resources and availability enforce ownership, revisions, preserved positions and retired-window exclusion',async()=>{
      const input={name:'Synthetic added vehicle',plate:'SYNTHETIC-NEW',vehicleType:'Synthetic transport',active:true,capabilities:['standard','wheelchair'],reason:'Synthetic resource creation',locationId:ids.depot,availableAt:stamp('12','06:00'),initialPositionConfirmed:true}
      for(const role of ['citizen','officer','driver']) {
        await request('/admin/resources/vehicles',role,input,403)
        await request('/admin/availability',role,undefined,403)
      }
      await request('/admin/resources/vehicles','admin',{...input,initialPositionConfirmed:false},400)
      await request('/admin/resources/vehicles','admin',{...input,locationId:ids.pickup},422)
      for(const capabilities of [[],['clinical'],['standard','standard']]) await request('/admin/resources/vehicles','admin',{...input,capabilities},400)
      let resource=await request('/admin/resources/vehicles','admin',input,201)
      const edit={name:'Renamed synthetic vehicle',plate:resource.plate,vehicleType:resource.vehicleType,capabilities:resource.capabilities,active:true,reason:'Synthetic metadata edit',expectedRevision:resource.revision}
      await request(`/admin/resources/vehicles/${resource.id}`,'admin',{...edit,locationId:ids.hospital},400)
      resource=await request(`/admin/resources/vehicles/${resource.id}`,'admin',edit)
      assert.equal(resource.locationId,ids.depot);assert.equal(resource.availableAt,new Date(input.availableAt).toISOString())
      await request(`/admin/resources/vehicles/${resource.id}`,'admin',edit,409)
      const windowBody={expectedResourceRevision:resource.revision,startsAt:stamp('15','06:00'),endsAt:stamp('15','16:00'),reason:'Synthetic availability'}
      let window=await request(`/admin/resources/vehicles/${resource.id}/windows`,'admin',windowBody,201)
      await request(`/admin/resources/vehicles/${resource.id}/windows`,'admin',windowBody,409)
      window=await request(`/admin/availability/${window.id}`,'admin',{...windowBody,expectedRevision:window.revision,expectedResourceRevision:window.resourceRevision,endsAt:stamp('15','15:00')})
      window=await request(`/admin/availability/${window.id}/retire`,'admin',{expectedRevision:window.revision,expectedResourceRevision:window.resourceRevision,reason:'Synthetic retirement'})
      assert.ok(window.retiredAt)
      assert.equal((await request('/admin/availability','admin')).windows.some(row=>row.id===window.id),false)
      assert.ok((await pool.query('SELECT retired_at FROM patient_transfer.availability_windows WHERE id=$1',[window.id])).rows[0].retired_at)
      const account=await request('/admin/accounts','admin',{name:'Synthetic new driver',username:'new-roster-driver',role:'driver',active:true,password,reason:'Synthetic driver account'},201)
      let roster=await request('/admin/resources/drivers','admin',{name:account.name,userId:account.id,phone:'+66 80-000-0000',capabilities:['standard'],active:true,reason:'Synthetic roster creation',locationId:ids.depot,availableAt:stamp('12','06:00'),initialPositionConfirmed:true},201)
      const login=await request('/auth/login',null,{username:'new-roster-driver',password});tokens.roster=login.token
      assert.equal((await request('/auth/me','roster')).driverId,roster.id)
      const rosterEdit={name:roster.name,userId:account.id,phone:roster.phone,capabilities:roster.capabilities,active:false,reason:'Synthetic roster deactivation',expectedRevision:roster.revision}
      roster=await request(`/admin/resources/drivers/${roster.id}`,'admin',rosterEdit)
      await request('/auth/me','roster',undefined,401)
      roster=await request(`/admin/resources/drivers/${roster.id}`,'admin',{...rosterEdit,active:true,expectedRevision:roster.revision})
      await request('/auth/me','roster',undefined,401)
      tokens.roster=(await request('/auth/login',null,{username:'new-roster-driver',password})).token
      const replacement=await request('/admin/accounts','admin',{name:'Synthetic relinked driver',username:'relinked-roster-driver',role:'driver',active:true,password,reason:'Synthetic replacement credential account'},201)
      await request(`/admin/resources/drivers/${roster.id}`,'admin',{...rosterEdit,name:replacement.name,userId:replacement.id,active:true,expectedRevision:roster.revision},400)
      roster=await request(`/admin/resources/drivers/${roster.id}`,'admin',{...rosterEdit,name:replacement.name,userId:replacement.id,active:true,expectedRevision:roster.revision,sameDriverConfirmed:true})
      await request('/auth/me','roster',undefined,401)
      assert.equal(roster.locationId,ids.depot)
      tokens.relinked=(await request('/auth/login',null,{username:'relinked-roster-driver',password})).token
      assert.equal((await request('/auth/me','relinked')).driverId,roster.id)
      const {rows:[holdCount]}=await pool.query('SELECT count(*)::int AS count FROM patient_transfer.resource_holds WHERE vehicle_id=$1',[resource.id])
      assert.equal(holdCount.count,0)
    })
    await t.test('staff login, hashed sessions, scoped access, unknown-field rejection',async()=>{
      await request('/auth/me',null,undefined,401)
      await request('/auth/login',null,{username:'synthetic-dispatcher',password:'wrong'},401)
      const login=await request('/auth/login',null,{username:'synthetic-dispatcher',password})
      assert.ok(login.token);assert.equal(login.expiresInSeconds,28800)
      const {rows:[stored]}=await pool.query('SELECT token_hash FROM patient_transfer.auth_sessions WHERE token_hash=$1',[tokenHash(login.token)])
      assert.ok(stored);assert.notEqual(stored.token_hash,login.token)
      await intake('15',{diagnosis:'must not enter'},400)
      await intake('15',{latitude:0,longitude:0},422)
      await intake('13',{},422)
      await intake('15',{appointmentAt:stamp('15','16:00')},422)
      const booking=await intake('15')
      await request(`/bookings/${booking.id}`,'other',undefined,403)
      await request(`/bookings/${booking.id}`,'admin',undefined,403)
      assert.equal((await request('/bookings','other')).bookings.length,0)
      await request('/bookings','admin',undefined,403)
      await command(booking,'APPROVE',{},'admin',403)
      await request('/auth/logout','other',{})
      await request('/auth/me','other',undefined,401)
    })
    await t.test('LINE exchange verifies identity and never accepts browser-supplied roles',async()=>{
      await request('/auth/line',null,{idToken:'forged-token'},401)
      await request('/auth/line',null,{idToken:'synthetic-verified-token',role:'admin'},400)
      const session=await request('/auth/line',null,{idToken:'synthetic-verified-token'})
      const response=await globalThis.fetch(`${base}/api/auth/me`,{headers:{Authorization:`Bearer ${session.token}`}})
      const identity=await response.json()
      assert.equal(identity.role,'citizen')
      await pool.query('UPDATE patient_transfer.users SET line_subject=$1 WHERE id=$2',[`U${'c'.repeat(32)}`,ids.officer])
      await request('/auth/line',null,{idToken:'synthetic-staff-token'},403)
      assert.equal((await pool.query('SELECT role FROM patient_transfer.users WHERE id=$1',[ids.officer])).rows[0].role,'dispatcher')
      await pool.query('UPDATE patient_transfer.users SET active=false WHERE id=$1',[identity.id])
      await request('/auth/line',null,{idToken:'synthetic-verified-token'},403)
    })
    await t.test('routing outage leaves request pending; schedule/assignment are separate',async()=>{
      let booking=await intake('15')
      assert.equal(booking.status,'REQUESTED')
      booking=await command(booking,'APPROVE')
      routingUnavailable=true
      await request(`/bookings/${booking.id}/schedule`,'officer',scheduleBody(booking),503)
      routingUnavailable=false
      const unchanged=await request(`/bookings/${booking.id}`,'citizen')
      assert.equal(unchanged.status,'APPROVED')
      assert.equal(unchanged.revision,booking.revision)
    })
    await t.test('waiting modification, breakdown and ABORTED persist history and holds',async()=>{
      let booking=await assigned('15')
      const master=(await request('/catalog','admin')).vehicles.find(row=>row.id===ids.vehicle)
      const metadata={name:master.name,plate:master.plate,vehicleType:'Synthetic type',active:false,capabilities:master.capabilities,reason:'Synthetic unfinished-work check',expectedRevision:master.revision}
      await request(`/admin/resources/vehicles/${ids.vehicle}`,'admin',metadata,409)
      await request(`/admin/resources/vehicles/${ids.vehicle}`,'admin',{...metadata,active:true,capabilities:['standard']},409)
      const window=(await request('/admin/availability','admin')).windows.find(row=>row.vehicleId===ids.vehicle&&row.startsAt===new Date(stamp('15','06:00')).toISOString())
      const before=await pool.query('SELECT revision FROM patient_transfer.vehicles WHERE id=$1',[ids.vehicle])
      await request(`/admin/availability/${window.id}/retire`,'admin',{expectedRevision:window.revision,expectedResourceRevision:master.revision,reason:'Must keep assigned interval'},409)
      assert.equal((await pool.query('SELECT revision FROM patient_transfer.vehicles WHERE id=$1',[ids.vehicle])).rows[0].revision,before.rows[0].revision)
      const linked=(await request('/admin/accounts','admin')).accounts.find(row=>row.id===ids.driver)
      await request(`/admin/accounts/${ids.driver}`,'admin',{name:linked.name,username:linked.username,role:'driver',active:false,reason:'Synthetic unfinished-work guard',expectedRevision:linked.revision},409)
      assert.equal(booking.status,'ASSIGNED')
      assert.equal((await request('/bookings','driver')).bookings.length,0)
      await request(`/bookings/${booking.id}`,'driver',undefined,403)
      assert.equal((await request('/catalog','citizen')).vehicles,undefined)
      await request('/admin/audit','officer',undefined,403)
      const originalArrival=booking.schedule.arrivalAt
      booking=await request(`/bookings/${booking.id}/modification`,'officer',{...scheduleBody(booking),pickupWaitingMinutes:5,reason:'Earlier pickup requested'})
      assert.equal(booking.schedule.pickupWaitingMinutes,5)
      assert.equal(booking.schedule.arrivalAt,originalArrival)
      assert.equal(booking.executionVersion,1)
      await request(`/bookings/${booking.id}/modification`,'officer',{...scheduleBody(booking),expectedRevision:1,reason:'Stale update'},409)
      now=stamp('15','07:40');booking=await command(booking,'START_TRIP',{},'driver')
      await command(booking,'CANCEL',{reason:'Too late'},'citizen',409)
      now=stamp('15','07:45');booking=await command(booking,'DEPART_ORIGIN',{},'driver')
      now=stamp('15','08:00');booking=await command(booking,'CONFIRM_PICKUP',{},'driver')
      now=stamp('15','08:05');booking=await command(booking,'REPORT_INCIDENT',{reason:'Synthetic breakdown'},'driver')
      assert.equal(booking.status,'PICKED_UP');assert.equal(booking.incidentOpen,true)
      await request(`/bookings/${booking.id}/modification`,'officer',{...scheduleBody(booking),reason:'Forbidden after pickup'},409)
      now=stamp('15','08:15');booking=await command(booking,'ABORT',{reason:'Transport ended',endedAt:stamp('15','08:10'),location:'Synthetic safe location',disposition:'Synthetic authorized caregiver handoff'})
      assert.equal(booking.status,'ABORTED')
      const {rows:[history]}=await pool.query('SELECT count(*)::int AS count FROM patient_transfer.schedules WHERE booking_id=$1 AND committed',[booking.id])
      assert.equal(history.count,2)
      const {rows:[holds]}=await pool.query('SELECT count(*)::int AS count FROM patient_transfer.resource_holds WHERE booking_id=$1 AND ends_at IS NULL',[booking.id])
      assert.equal(holds.count,2)
      now=stamp('15','08:30')
      await request(`/resources/vehicles/${ids.vehicle}/readiness`,'officer',{locationId:ids.depot,reason:'Vehicle checked; driver still pending'})
      const partial=await request(`/bookings/${booking.id}`)
      assert.equal(partial.resourceHold,true);assert.equal(partial.incidentOpen,true)
      assert.equal(partial.revision,booking.revision)
      await readyAll('15','08:30')
      const ended=await request(`/bookings/${booking.id}`)
      assert.equal(ended.status,'ABORTED')
      assert.equal(ended.resourceHold,false)
      assert.equal(ended.incidentOpen,false,'Final resource readiness must close the ended trip incident')
      assert.equal(ended.revision,booking.revision+1)
      const {rows:[resolved]}=await pool.query('SELECT resolved_at,resolved_by,resolution FROM patient_transfer.trip_incidents WHERE booking_id=$1',[booking.id])
      assert.ok(resolved.resolved_at);assert.equal(resolved.resolved_by,ids.officer);assert.ok(resolved.resolution)
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM patient_transfer.audit_logs WHERE entity_id=$1 AND action='CONFIRM_TERMINAL_READY'",[booking.id])).rows[0].count,1)
    })
    await t.test('normal completion enforces actual turnaround; retry does not duplicate events',async()=>{
      let booking=await assigned('16')
      now=stamp('16','07:50')
      const startId=randomUUID()
      const started=await command(booking,'START_TRIP',{},'driver',200,startId)
      const repeated=await command(booking,'START_TRIP',{},'driver',200,startId)
      assert.equal(repeated.revision,started.revision);booking=started
      booking=await command(booking,'DEPART_ORIGIN',{},'driver')
      now=stamp('16','08:05');booking=await command(booking,'CONFIRM_PICKUP',{},'driver')
      booking=await command(booking,'DEPART_FOR_HOSPITAL',{},'driver')
      now=stamp('16','08:40');booking=await command(booking,'CONFIRM_HANDOVER',{},'driver')
      assert.equal(booking.status,'COMPLETED')
      await request(`/bookings/${booking.id}`,'driver',undefined,403)
      assert.ok(!(await request('/bookings','driver')).bookings.some(item=>item.id===booking.id))
      const history=await request('/driver/history','driver')
      assert.ok(history.bookings.some(item=>item.id===booking.id))
      assert.ok(history.bookings.every(item=>!Object.hasOwn(item,'patientName')&&!Object.hasOwn(item,'contactPhone')&&!Object.hasOwn(item,'pickupAddress')))
      now=stamp('16','09:00');await command(booking,'CONFIRM_READY',{reason:'Readiness checked'},'officer',409)
      now=stamp('16','09:10');booking=await command(booking,'CONFIRM_READY',{reason:'Turnaround and readiness checked'})
      assert.equal(booking.status,'COMPLETED')
      await readyAll('16')
    })
    await t.test('failed pickup cancels reservation but preserves hold until readiness',async()=>{
      let booking=await assigned('17')
      now=stamp('17','07:50');booking=await command(booking,'START_TRIP',{},'driver')
      booking=await command(booking,'DEPART_ORIGIN',{},'driver')
      now=stamp('17','08:05');booking=await command(booking,'FAILED_PICKUP',{reason:'Synthetic patient absent'},'driver')
      assert.equal(booking.status,'CANCELLED')
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM patient_transfer.resource_holds WHERE booking_id=$1 AND ends_at IS NULL',[booking.id])).rows[0].count,2)
      await readyAll('17','08:30')
    })
    await t.test('after-departure reassignment validates handoff, old holds and stale driver',async()=>{
      let booking=await assigned('18')
      now=stamp('18','07:50');booking=await command(booking,'START_TRIP',{},'driver')
      booking=await command(booking,'DEPART_ORIGIN',{},'driver')
      now=stamp('18','07:55')
      for(const [kind,id] of [['vehicles',ids.vehicle2],['drivers',ids.roster2]]) await request(`/resources/${kind}/${id}/readiness`,'officer',{locationId:ids.pickup,reason:'Replacement crew verified at safe origin'})
      booking=await request(`/bookings/${booking.id}/modification`,'officer',{...scheduleBody(booking),vehicleId:ids.vehicle2,driverId:ids.roster2,
        originLocationId:ids.pickup,originKind:'handoff',reason:'Synthetic reassignment',arrangement:{locationId:ids.pickup,confirmedAt:new Date(now).toISOString(),note:'Old crew remains held; replacement confirmed at origin'}})
      assert.equal(booking.status,'ASSIGNED');assert.equal(booking.startedAt,null)
      assert.equal(booking.cancellationLocked,true)
      assert.equal(booking.resourceHold,true,'Dispatcher must still see released-crew holds')
      assert.equal((await request(`/bookings/${booking.id}`,'driver2')).resourceHold,false,'Replacement driver is blocked only by current-resource holds')
      await command(booking,'CANCEL',{reason:'Already underway'},'citizen',409)
      await command(booking,'START_TRIP',{},'driver',403)
      now=stamp('18','08:00');booking=await command(booking,'START_TRIP',{},'driver2')
      booking=await command(booking,'DEPART_ORIGIN',{},'driver2')
      now=stamp('18','08:05');booking=await command(booking,'CONFIRM_PICKUP',{},'driver2')
      booking=await command(booking,'DEPART_FOR_HOSPITAL',{},'driver2')
      now=stamp('18','08:40');booking=await command(booking,'CONFIRM_HANDOVER',{},'driver2')
      const {rows:notices}=await pool.query("SELECT recipient_id FROM patient_transfer.notifications WHERE booking_id=$1 AND template_key='ASSIGNMENT_CHANGED'",[booking.id])
      assert.deepEqual(new Set(notices.map(row=>row.recipient_id)),new Set([ids.citizen,ids.driver,ids.driver2]))
      await readyAll('18')
    })
    await t.test('concurrent API assignment leaves exactly one committed reservation',async()=>{
      const bookings=[]
      for(let i=0;i<2;i++) {
        let booking=await intake('19');booking=await command(booking,'APPROVE')
        bookings.push(await request(`/bookings/${booking.id}/schedule`,'officer',scheduleBody(booking)))
      }
      const results=await Promise.all(bookings.map(async booking=>{
        const response=await globalThis.fetch(`${base}/api/bookings/${booking.id}/assignment`,{method:'POST',headers:{Authorization:`Bearer ${tokens.officer}`,'Content-Type':'application/json'},body:JSON.stringify(scheduleBody(booking))})
        return {status:response.status,body:await response.json()}
      }))
      assert.deepEqual(results.map(result=>result.status).sort(),[200,409])
      const winner=results.find(result=>result.status===200).body
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM patient_transfer.schedules WHERE booking_id=ANY($1) AND committed AND released_at IS NULL',[bookings.map(booking=>booking.id)])).rows[0].count,1)
      await command(winner,'CANCEL',{reason:'Synthetic before-start cancellation'},'citizen')
    })
    await t.test('appointment modification is atomic; route failure preserves original details',async()=>{
      let booking=await assigned('21')
      booking=await request(`/bookings/${booking.id}/modification`,'officer',{...scheduleBody(booking),reason:'Appointment changed',bookingChanges:{appointmentAt:stamp('21','09:30')}})
      assert.equal(new Date(booking.appointmentAt).toISOString(),new Date(stamp('21','09:30')).toISOString())
      routingUnavailable=true
      await request(`/bookings/${booking.id}/modification`,'officer',{...scheduleBody(booking),reason:'Second change',bookingChanges:{appointmentAt:stamp('21','10:00')}},503)
      routingUnavailable=false
      const unchanged=await request(`/bookings/${booking.id}`,'citizen')
      assert.equal(unchanged.appointmentAt,booking.appointmentAt);assert.equal(unchanged.revision,booking.revision)
      await command(booking,'CANCEL',{reason:'Synthetic cleanup'},'citizen')
    })
    await t.test('admin closure flags existing assignment and suspension immediately revokes access',async()=>{
      const booking=await assigned('20')
      await request('/admin/closures','officer',{date:'2030-01-20',reason:'Synthetic closure'},403)
      await request('/admin/closures','admin',{date:'2030-01-20',reason:'Synthetic closure'})
      const affected=await request(`/bookings/${booking.id}`,'officer')
      assert.equal(affected.status,'ASSIGNED');assert.equal(affected.scheduleReviewRequired,true)
      await pool.query('UPDATE patient_transfer.users SET active=false WHERE id=$1',[ids.driver])
      await request('/auth/me','driver',undefined,401)
    })
    await t.test('master edits preserve snapshots and require explicit verified configuration acceptance',async()=>{
      await request('/admin/service-data','citizen',undefined,403)
      await request('/admin/service-data','officer',undefined,403)
      const priorClosure=(await request('/admin/service-data','admin')).closures.find(row=>row.date==='2030-01-20')
      await request('/admin/closures','admin',{date:priorClosure.date,active:false,reason:'Synthetic reopening',expectedRevision:priorClosure.revision})
      await pool.query('UPDATE patient_transfer.users SET active=true WHERE id=$1',[ids.driver])
      const outstanding=(await pool.query("SELECT id FROM patient_transfer.bookings WHERE status='ASSIGNED' AND started_at IS NULL")).rows
      for(const row of outstanding) await command(await request('/bookings/'+row.id,'officer'),'CANCEL',{reason:'Synthetic cleanup before independent master test'},'citizen')
      await readyAll('24')
      const master={name:'Synthetic versioned hospital',active:true,latitude:18.61,longitude:99.06,reason:'Approved synthetic master'}
      const hospital=await request('/admin/hospitals','admin',master)
      let booking=await intake('25',{hospitalId:hospital.id})
      booking=await command(booking,'APPROVE')
      booking=await request('/bookings/'+booking.id+'/schedule','officer',scheduleBody(booking))
      const original=booking.hospitalLocationId
      const changed=await request('/admin/hospitals/'+hospital.id,'admin',{...master,latitude:18.62,expectedRevision:hospital.revision})
      assert.notEqual(changed.locationId,original);assert.equal(changed.affectedCount,1)
      await request('/admin/hospitals/'+hospital.id,'admin',{...master,expectedRevision:hospital.revision},409)
      booking=await request('/bookings/'+booking.id,'officer')
      assert.equal(booking.hospitalLocationId,original);assert.equal(booking.status,'SCHEDULED');assert.equal(booking.scheduleReviewRequired,true)
      const untouchedSchedule=booking.schedule
      await request('/bookings/'+booking.id+'/schedule','officer',scheduleBody(booking),409)
      await request('/bookings/'+booking.id+'/configuration-preview','admin',scheduleBody(booking),403)
      const preview=await request('/bookings/'+booking.id+'/configuration-preview','officer',scheduleBody(booking))
      assert.deepEqual((await request('/bookings/'+booking.id,'officer')).schedule,untouchedSchedule)
      const acceptance={...scheduleBody(booking),acceptConfiguration:true,expectedConfigurationRevision:preview.configurationRevision,reason:'Verified current location and recalculated proposal'}
      await request('/bookings/'+booking.id+'/schedule','officer',{...acceptance,expectedConfigurationRevision:preview.configurationRevision-1},409)
      routingUnavailable=true
      await request('/bookings/'+booking.id+'/schedule','officer',acceptance,503)
      routingUnavailable=false
      assert.equal((await request('/bookings/'+booking.id,'officer')).hospitalLocationId,original)
      booking=await request('/bookings/'+booking.id+'/schedule','officer',acceptance)
      assert.equal(booking.hospitalLocationId,changed.locationId);assert.equal(booking.scheduleReviewRequired,false);assert.equal(booking.status,'SCHEDULED')
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM patient_transfer.configuration_reviews WHERE booking_id=$1 AND accepted_at IS NULL',[booking.id])).rows[0].n,0)
      await assert.rejects(pool.query('UPDATE patient_transfer.locations SET point=ST_SetSRID(ST_MakePoint(99,18),4326)::geography WHERE id=$1',[original]),error=>error.code==='23514')
      const future=await intake('25',{hospitalId:hospital.id})
      assert.equal(future.hospitalLocationId,changed.locationId)
      const data=await request('/admin/service-data','admin')
      assert.equal(JSON.stringify(data).includes(booking.id),false)
      const depot=await request('/admin/depot','admin',{name:'Versioned depot',latitude:data.settings.latitude+0.001,longitude:data.settings.longitude,expectedRevision:data.settings.revision,reason:'Approved depot coordinates'})
      assert.notEqual(depot.locationId,data.settings.locationId)
      assert.equal((await pool.query('SELECT location_id FROM patient_transfer.vehicles WHERE id=$1',[ids.vehicle])).rows[0].location_id,ids.depot)
      const village=data.villages[0]
      await request('/admin/villages/'+village.id,'admin',{name:village.name,number:village.number,active:true,shape:'polygon',geometry:{type:'MultiPolygon',coordinates:[[[[99,18],[99.1,18],[99.1,18.1],[99,18]]]]},reason:'Approved polygon',expectedRevision:village.revision})
      await request('/admin/villages/'+village.id,'admin',{name:village.name,number:village.number,active:true,shape:'polygon',geometry:{type:'MultiPolygon',coordinates:[[[[99,18],[99.1,18],[99.1,18.1],[99,18]]]]},reason:'Stale polygon',expectedRevision:village.revision},409)
      const closed=await request('/admin/closures','admin',{date:'2030-01-26',reason:'Approved closure',expectedRevision:0})
      await request('/admin/closures','admin',{date:closed.date,reason:'Approved reopening',active:false,expectedRevision:closed.revision})
      assert.equal((await request('/catalog','officer')).closures?.includes?.('2030-01-26')??false,false)
    })
    await t.test('LINE outbox retries safely and excludes patient details',async()=>{
      await pool.query('UPDATE patient_transfer.users SET line_subject=$1 WHERE id=$2',[`U${'b'.repeat(32)}`,ids.citizen])
      const {rows:[booking]}=await pool.query('SELECT id FROM patient_transfer.bookings ORDER BY submitted_at LIMIT 1')
      const retryId=randomUUID()
      const payload=(await pool.query("SELECT message_data FROM patient_transfer.notifications WHERE booking_id=$1 AND template_key='REQUEST_RECEIVED' LIMIT 1",[booking.id])).rows[0].message_data
      await pool.query(`INSERT INTO patient_transfer.notifications(id,booking_id,recipient_id,deduplication_key,template_key,next_attempt_at,message_data)
        VALUES($1,$2,$3,$4,'SYNTHETIC_RETRY','2030-01-12T00:00:00Z',$5)`,[retryId,booking.id,ids.citizen,`synthetic:${retryId}`,payload])
      let retryAttempts=0
      const messages=[]
      const sender=async message=>{
        messages.push(message)
        if(message.retryKey===retryId&&retryAttempts++===0) return {ok:false,retry:true,code:'LINE_HTTP_429'}
        return {ok:true}
      }
      await deliverNotifications(pool,sender,{limit:1000,now:'2030-01-25T00:00:00Z',publicAppUrl:'https://municipality.example'})
      const failed=(await pool.query('SELECT * FROM patient_transfer.notifications WHERE id=$1',[retryId])).rows[0]
      assert.equal(failed.status,'FAILED');assert.equal(failed.attempts,1);assert.ok(failed.next_attempt_at)
      await deliverNotifications(pool,sender,{limit:1000,now:'2030-01-25T00:03:00Z',publicAppUrl:'https://municipality.example'})
      const sent=(await pool.query('SELECT * FROM patient_transfer.notifications WHERE id=$1',[retryId])).rows[0]
      assert.equal(sent.status,'SENT');assert.equal(sent.attempts,2)
      assert.ok(messages.every(message=>!message.text.includes('Synthetic patient')&&!message.text.includes('0800000000')&&!message.text.includes('18.59')))
      assert.equal(messages.filter(message=>message.retryKey===retryId).length,2)
    })
  } finally {
    if(server) {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
    if(pool) await pool.end()
    if(created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
    await admin.end()
  }
})
