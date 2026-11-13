import {randomUUID} from 'node:crypto'
import {test,expect,type Page} from '@playwright/test'
import {startOperationalTestApi,ids} from './helpers/operational-postgres'
import {syntheticPassword} from './helpers/admin-postgres.mjs'
import {deliverNotifications} from '../server/notifications.mjs'
import {newToken,tokenHash} from '../server/auth.mjs'

test.use({actionTimeout:10000})
test.beforeEach(()=>test.skip(!process.env.DATABASE_TEST_ADMIN_URL,'Run npm run test:messages:integration with a local test database configured'))
const origin='https://municipality.example'
type Fixture=Awaited<ReturnType<typeof startOperationalTestApi>>
interface Native {id:string;recipient_id:string;event_id:string|null;message_data:{event:string;audience:string;meaning:string;linkPath:string;pickupAt:string|null;readyAt:string|null;status:string}}
interface Sent {recipient:string;text:string;retryKey:string}
const rows=async(f:Fixture,bookingId:string,event:string)=>(await f.pool.query('SELECT * FROM patient_transfer.notifications WHERE booking_id=$1 AND template_key=$2 ORDER BY recipient_id',[bookingId,event])).rows as Native[]
async function bindings(f:Fixture) {
 for(const [id,digit] of [[ids.citizen,'1'],['00000000-0000-4000-8000-000000000003','2']]) await f.pool.query('UPDATE patient_transfer.users SET line_subject=$1 WHERE id=$2',[`U${digit.repeat(32)}`,id])
}
async function isolate(f:Fixture,selected:Native[]) {
 const selectedIds=selected.map(row=>row.id)
 await f.pool.query("UPDATE patient_transfer.notifications SET next_attempt_at='2099-01-01' WHERE NOT (id=ANY($1::uuid[]))",[selectedIds])
 await f.pool.query("UPDATE patient_transfer.notifications SET next_attempt_at=$2 WHERE id=ANY($1::uuid[]) AND attempts=0 AND status='PENDING'",[selectedIds,f.control.now])
}
async function send(f:Fixture,selected:Native[]) {
 await isolate(f,selected)
 const messages:Sent[]=[]
 await deliverNotifications(f.pool,async(message:Sent)=>{messages.push(message);return {ok:true}},{now:f.control.now,publicAppUrl:origin})
 return messages
}
async function onboard(f:Fixture) {
 let booking=await f.assigned()
 f.control.now=booking.schedule!.departureAt
 for(const role of ['dispatcher','admin','driver'])await f.login(role)
 booking=await f.command(booking,'START_TRIP',{},'driver')
 booking=await f.command(booking,'DEPART_ORIGIN',{},'driver')
 f.control.now=booking.schedule!.pickupAt
 booking=await f.command(booking,'CONFIRM_PICKUP',{},'driver')
 return f.command(booking,'DEPART_FOR_HOSPITAL',{},'driver')
}
async function openLink(page:Page,f:Fixture,path:string,username:string) {
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url())
  try{await route.fulfill({response:await route.fetch({url:`${f.base}${url.pathname}${url.search}`})})}
  catch{throw new Error(`Ephemeral message-link API request failed: ${url.pathname}`)}
 })
 await page.route(/https:\/\/.*(?:map|tile|openstreetmap|arcgis).*/,route=>route.abort())
 await page.goto(path)
 await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(username)
 await page.getByLabel('รหัสผ่าน',{exact:true}).fill(syntheticPassword)
 await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click()
 await page.getByRole('link',{name:username.includes('driver')?'เปิดหน้าคนขับ':'เปิดหน้าจัดรถ',exact:true}).click()
}

test('request, proposed schedule and final assignment capture minimized recipients/timing and stable retry text',async()=>{
 const f=await startOperationalTestApi()
 try {
  const booking=await f.assigned();await bindings(f)
  expect(await rows(f,booking.id,'REQUEST_RECEIVED')).toHaveLength(1)
  expect(await rows(f,booking.id,'SCHEDULE_CONFIRMED')).toHaveLength(1)
  const assigned=await rows(f,booking.id,'ASSIGNED')
  expect(assigned).toHaveLength(2)
  expect(assigned.every(row=>Date.parse(row.message_data.pickupAt!)===Date.parse(booking.schedule!.pickupAt))).toBe(true)
  const requester=assigned.find(row=>row.recipient_id===ids.citizen)!
  await isolate(f,[requester])
  const before=await f.snapshot(booking.id),messages:Sent[]=[]
  await deliverNotifications(f.pool,async(message:Sent)=>{messages.push(message);return {ok:false,retry:true,code:'LINE_HTTP_429'}},{now:f.control.now,publicAppUrl:origin})
  expect(await f.snapshot(booking.id)).toEqual(before)
  await f.request(`/bookings/${booking.id}/modification`,'dispatcher',f.selection(booking,{pickupWaitingMinutes:10,reason:'PRIVATE_REASON with patient/contact context not for notification'}))
  await isolate(f,[requester])
  f.control.now=new Date(Date.parse(f.control.now)+60000).toISOString()
  await deliverNotifications(f.pool,async(message:Sent)=>{messages.push(message);return {ok:true}},{now:f.control.now,publicAppUrl:'https://changed-origin.example'})
  expect(messages).toHaveLength(2);expect(messages[0]).toEqual(messages[1])
  expect(messages[0].text).toContain(`${origin}/booking/status/${booking.id}`)
  expect(messages[0].text).toContain('เวลารับที่ยืนยัน')
  for(const value of [booking.patientName,booking.contactPhone,booking.pickupAddress,'PRIVATE_REASON','18.59','99.05'])expect(messages[0].text).not.toContain(value)
  await expect(f.pool.query("UPDATE patient_transfer.notifications SET message_data=message_data||'{\"status\":\"FAKE\"}'::jsonb WHERE id=$1",[requester.id])).rejects.toMatchObject({code:'23514'})
  await expect(f.pool.query('UPDATE patient_transfer.notifications SET message_text=$2 WHERE id=$1',[requester.id,'Changed retry text'])).rejects.toMatchObject({code:'23514'})
 } finally {await f.close()}
})

test('reassignment distinguishes removed/new drivers and old authenticated links cannot expose the job',async({page})=>{
 test.setTimeout(60000)
 const f=await startOperationalTestApi()
 try {
  let booking=await f.assigned();await bindings(f)
  const oldMessage=(await rows(f,booking.id,'ASSIGNED')).find(row=>row.message_data.audience==='driver')!
  const replacement=randomUUID(),account=randomUUID()
  await f.pool.query(`INSERT INTO patient_transfer.users(id,role,display_name,username,password_hash,line_subject)
   SELECT $1,'driver','Synthetic replacement','synthetic-driver2',password_hash,$2 FROM patient_transfer.users WHERE username='synthetic-driver'`,[account,`U${'3'.repeat(32)}`])
  await f.pool.query(`INSERT INTO patient_transfer.drivers(id,user_id,location_id,available_at,capabilities)
   VALUES($1,$2,$3,'2029-01-01',ARRAY['standard']::patient_transfer.mobility_type[])`,[replacement,account,ids.depot])
  await f.pool.query(`INSERT INTO patient_transfer.availability_windows(driver_id,starts_at,ends_at) VALUES($1,'2030-01-15T06:00:00+07:00','2030-01-15T16:00:00+07:00')`,[replacement])
  f.control.now='2030-01-15T00:00:00Z'
  for(const role of ['dispatcher','admin','driver','driver2'])await f.login(role)
  await f.request(`/bookings/${booking.id}`,'driver')
  booking=await f.request(`/bookings/${booking.id}/modification`,'dispatcher',f.selection(booking,{driverId:replacement,vehicleId:'50000000-0000-4000-8000-000000000002',reason:'PRIVATE_REASON reassignment'}))
  await f.request(`/bookings/${booking.id}`,'driver',undefined,403)
  await f.request(`/bookings/${booking.id}`,'driver2')
  const changed=await rows(f,booking.id,'ASSIGNMENT_CHANGED')
  expect(changed).toHaveLength(3);expect(new Set(changed.map(row=>row.recipient_id)).size).toBe(3)
  const removed=changed.find(row=>row.message_data.meaning==='removed')!,newDriver=changed.find(row=>row.message_data.meaning==='assigned')!
  expect(removed.message_data.pickupAt).toBeNull()
  expect(new URLSearchParams(removed.message_data.linkPath.split('?')[1]).get('next')).toBe('/driver')
  const messages=await send(f,changed)
  expect(messages.find(row=>row.retryKey===removed.id)!.text).toContain('REMOVED')
  expect(messages.find(row=>row.retryKey===newDriver.id)!.text).toContain('ASSIGNED')
  expect(messages.every(row=>!row.text.includes('PRIVATE_REASON'))).toBe(true)
  // A queued earlier assignment must not reveal its timing to a removed driver.
  await f.pool.query('UPDATE patient_transfer.notifications SET next_attempt_at=$2 WHERE id=$1',[oldMessage.id,f.control.now])
  expect(await send(f,[oldMessage])).toEqual([])
  expect((await f.pool.query('SELECT failure_code FROM patient_transfer.notifications WHERE id=$1',[oldMessage.id])).rows[0].failure_code).toBe('RECIPIENT_ACCESS_CHANGED')
  await openLink(page,f,oldMessage.message_data.linkPath,'synthetic-driver')
  await expect(page.getByRole('heading',{name:'ไม่พบงานที่มอบหมายให้คนขับนี้',exact:true})).toBeVisible()
  await expect(page.getByText(booking.patientName)).toHaveCount(0)
  await openLink(page,f,newDriver.message_data.linkPath,'synthetic-driver2')
  await expect(page.getByText(booking.patientName).first()).toBeVisible()
 } finally {if(!page.isClosed()){await page.unrouteAll({behavior:'wait'});await page.close()}await f.close()}
})

test('failure, incident, rejection and cancellation audiences use web alerts and omit private reasons',async()=>{
 for(const kind of ['REJECT','CANCEL','FAILED_PICKUP','REPORT_INCIDENT','RESOLVE_INCIDENT']) {
  const f=await startOperationalTestApi()
  try {
   let booking=kind==='REJECT'?await f.requested():await f.assigned();await bindings(f)
   if(kind==='FAILED_PICKUP') {
    f.control.now=booking.schedule!.departureAt
    for(const role of ['dispatcher','driver'])await f.login(role)
    booking=await f.command(booking,'START_TRIP',{},'driver')
    booking=await f.command(booking,'DEPART_ORIGIN',{},'driver')
   }
   if(kind==='RESOLVE_INCIDENT') {
    booking=await f.command(booking,'REPORT_INCIDENT',{reason:'PRIVATE_REASON'})
    f.control.now=new Date(Date.parse(f.control.now)+1000).toISOString()
   }
   booking=await f.command(booking,kind,{reason:'PRIVATE_REASON detailed patient context',...(kind==='REJECT'?{rejectionKind:'other'}:{})},kind==='FAILED_PICKUP'?'driver':'dispatcher')
   const selected=await rows(f,booking.id,`TRIP_${kind}`)
   expect(selected).toHaveLength(['REJECT','FAILED_PICKUP'].includes(kind)?1:2)
   const messages=await send(f,selected)
   expect(messages).toHaveLength(selected.length)
   expect(messages.every(row=>!row.text.includes('PRIVATE_REASON')&&!row.text.includes(booking.patientName))).toBe(true)
   if(kind==='FAILED_PICKUP')expect(messages[0].text).toContain('ยังต้องยืนยันความพร้อม')
   const alerts=await f.request('/dispatcher-alerts')
   expect(alerts.alerts.some((row:{event:string})=>row.event===`TRIP_${kind}`)).toBe(true)
   expect((await f.pool.query(`SELECT count(*)::int AS n FROM patient_transfer.notifications n JOIN patient_transfer.users u ON u.id=n.recipient_id WHERE u.role='dispatcher'`)).rows[0].n).toBe(0)
  } finally {await f.close()}
 }
})

test('destination, ABORTED and real handover messages preserve distinct outcomes and current readiness',async()=>{
 for(const mode of ['abort','handover']) {
  const f=await startOperationalTestApi()
  try {
   let booking=await onboard(f);await bindings(f)
   if(mode==='abort') {
    const hospital=await f.request('/admin/hospitals','admin',{name:'Approved synthetic hospital',latitude:18.65,longitude:99.08,active:true,reason:'Approved destination'})
    booking=await f.request(`/bookings/${booking.id}/destination`,'dispatcher',{eventId:randomUUID(),expectedRevision:booking.revision,expectedExecutionVersion:booking.executionVersion,hospitalId:hospital.id,reason:'PRIVATE_REASON',currentLocation:{latitude:18.60,longitude:99.06,label:'PRIVATE_LOCATION'},confirmedAt:f.control.now,confirmedPhase:booking.status})
    const revised=await rows(f,booking.id,'DESTINATION_CHANGED')
    const messages=await send(f,revised)
    expect(messages).toHaveLength(2);expect(messages.every(row=>row.text.includes('ปรับโรงพยาบาล'))).toBe(true)
    expect(revised.every(row=>Date.parse(row.message_data.readyAt!)===Date.parse(booking.destinationRevision!.readyAt))).toBe(true)
    booking=await f.command(booking,'ABORT',{reason:'PRIVATE_REASON',endedAt:f.control.now,location:'PRIVATE_LOCATION',disposition:'PRIVATE_DISPOSITION'})
   } else {
    f.control.now=new Date(Date.parse(booking.schedule!.arrivalAt)+3600000).toISOString()
    booking=await f.command(booking,'CONFIRM_HANDOVER',{},'driver')
   }
   const selected=await rows(f,booking.id,mode==='abort'?'TRIP_ABORT':'TRIP_CONFIRM_HANDOVER')
   const messages=await send(f,selected)
   expect(messages).toHaveLength(2)
   for(const item of messages) {
    expect(item.text).toContain(mode==='abort'?'ABORTED':'COMPLETED')
    expect(item.text).not.toContain(mode==='abort'?'COMPLETED':'ABORTED')
    for(const secret of ['PRIVATE_REASON','PRIVATE_LOCATION','PRIVATE_DISPOSITION',booking.patientName])expect(item.text).not.toContain(secret)
   }
   if(mode==='handover')expect(selected.every(row=>Date.parse(row.message_data.readyAt!)===Date.parse(f.control.now)+30*60000)).toBe(true)
  } finally {await f.close()}
 }
})

test('missing link configuration and changed LINE binding fail safely without altering the stored retry payload',async()=>{
 const f=await startOperationalTestApi()
 try {
  const booking=await f.assigned();await bindings(f)
  const selected=(await rows(f,booking.id,'ASSIGNED')).filter(row=>row.recipient_id===ids.citizen)
  await isolate(f,selected)
  let calls=0
  await deliverNotifications(f.pool,async()=>{calls++;return {ok:true}},{now:f.control.now,publicAppUrl:''})
  expect(calls).toBe(0)
  expect((await f.pool.query('SELECT failure_code FROM patient_transfer.notifications WHERE id=$1',[selected[0].id])).rows[0].failure_code).toBe('MESSAGE_LINK_UNCONFIGURED')
  const pending=(await rows(f,booking.id,'REQUEST_RECEIVED'))
  await isolate(f,pending)
  await deliverNotifications(f.pool,async()=>{calls++;return {ok:false,retry:true,code:'LINE_HTTP_503'}},{now:f.control.now,publicAppUrl:origin})
  const before=(await f.pool.query('SELECT message_text,delivery_subject FROM patient_transfer.notifications WHERE id=$1',[pending[0].id])).rows[0]
  await f.pool.query('UPDATE patient_transfer.users SET line_subject=$1 WHERE id=$2',[`U${'4'.repeat(32)}`,ids.citizen])
  f.control.now=new Date(Date.parse(f.control.now)+60000).toISOString()
  await deliverNotifications(f.pool,async()=>{calls++;return {ok:true}},{now:f.control.now,publicAppUrl:origin})
  expect(calls).toBe(1)
  const after=(await f.pool.query('SELECT message_text,delivery_subject,failure_code FROM patient_transfer.notifications WHERE id=$1',[pending[0].id])).rows[0]
  expect(after).toMatchObject({...before,failure_code:'RECIPIENT_CHANGED'})
 } finally {await f.close()}
})

test('original dispatcher work queue is authenticated, acknowledges web events once and retains owner isolation',async({page})=>{
 const f=await startOperationalTestApi()
 try {
  const booking=await f.assigned(),before=await f.snapshot(booking.id)
  const queue=await f.request('/dispatcher-alerts'),received=queue.alerts.find((row:{event:string})=>row.event==='REQUEST_RECEIVED')
  for(const role of ['citizen','driver','admin'])await f.request('/dispatcher-alerts',role,undefined,403)
  const outsider=randomUUID(),token=newToken()
  await f.pool.query("INSERT INTO patient_transfer.users(id,role,display_name) VALUES($1,'citizen','Other synthetic requester')",[outsider])
  await f.pool.query(`INSERT INTO patient_transfer.auth_sessions(user_id,token_hash,access_version,created_at,expires_at) VALUES($1,$2,0,'2030-01-01','2031-01-01')`,[outsider,tokenHash(token)])
  // Use the account's actual access version, without adding a public test identity.
  await f.pool.query('UPDATE patient_transfer.auth_sessions SET access_version=(SELECT access_version FROM patient_transfer.users WHERE id=$1) WHERE user_id=$1',[outsider])
  const foreign=await fetch(`${f.base}/api/bookings/${booking.id}`,{headers:{Authorization:`Bearer ${token}`}})
  expect(foreign.status).toBe(403)
  await openLink(page,f,'/staff/login?next=%2Fdispatcher','synthetic-dispatcher')
  await page.locator('summary').filter({hasText:'แจ้งเตือนงานรับส่ง'}).click()
  const card=page.locator('section').filter({hasText:'รับคำขอแล้ว (REQUESTED) รอเจ้าหน้าที่พิจารณา'}).last()
  await card.getByRole('button',{name:'รับทราบรายการในเว็บ',exact:true}).click()
  await expect(card.getByText('รับทราบรายการในเว็บแล้ว',{exact:true})).toBeVisible()
  await f.request(`/dispatcher-alerts/${received.id}/acknowledgement`,'dispatcher',{})
  expect((await f.pool.query('SELECT count(*)::int AS n FROM patient_transfer.dispatcher_alert_receipts WHERE alert_id=$1',[received.id])).rows[0].n).toBe(1)
  expect((await f.request('/dispatcher-alerts')).unread).toBe(queue.unread-1)
  expect(await f.snapshot(booking.id)).toEqual(before)
  expect((await f.pool.query('SELECT count(*)::int AS n FROM patient_transfer.notification_attempts')).rows[0].n).toBe(0)
 } finally {if(!page.isClosed()){await page.unrouteAll({behavior:'wait'});await page.close()}await f.close()}
})

test('event identities cannot collide with request receipts and dispatcher links fetch beyond the first list page',async({page})=>{
 test.setTimeout(90000)
 const f=await startOperationalTestApi()
 try {
  const requested=await f.requested()
  const approval={eventId:requested.id,expectedRevision:requested.revision,command:{type:'APPROVE'}}
  let booking=await f.request(`/bookings/${requested.id}/commands`,'dispatcher',approval)
  await f.request(`/bookings/${requested.id}/commands`,'dispatcher',approval)
  expect((await f.pool.query('SELECT count(*)::int AS n FROM patient_transfer.notifications WHERE booking_id=$1',[requested.id])).rows[0].n).toBe(2)
  expect((await f.pool.query('SELECT count(*)::int AS n FROM patient_transfer.dispatcher_alerts WHERE booking_id=$1',[requested.id])).rows[0].n).toBe(2)
  booking=await f.request(`/bookings/${booking.id}/schedule`,'dispatcher',f.selection(booking))
  booking=await f.request(`/bookings/${booking.id}/assignment`,'dispatcher',f.selection(booking))
  for(let index=0;index<100;index++)await f.requested('08:00')
  expect((await f.request('/bookings')).bookings.some((row:{id:string})=>row.id===booking.id)).toBe(false)
  const focused=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/bookings/${booking.id}`)
  await openLink(page,f,`/staff/login?next=${encodeURIComponent(`/dispatcher/tracking?booking=${booking.id}&dialog=tracking`)}`,'synthetic-dispatcher')
  expect((await focused).status()).toBe(200)
  await expect(page.getByRole('combobox',{name:'การดำเนินการ',exact:true})).toBeVisible()
 } finally {if(!page.isClosed()){await page.unrouteAll({behavior:'wait'});await page.close()}await f.close()}
})

test('failed alert publication rolls back booking, lifecycle, audit and recipient outbox together',async()=>{
 const f=await startOperationalTestApi()
 try {
  const booking=await f.requested(),before=await f.snapshot(booking.id)
  const counts=async()=>(await f.pool.query(`SELECT
   (SELECT count(*) FROM patient_transfer.notifications WHERE booking_id=$1) AS notifications,
   (SELECT count(*) FROM patient_transfer.dispatcher_alerts WHERE booking_id=$1) AS alerts,
   (SELECT count(*) FROM patient_transfer.trip_events WHERE booking_id=$1) AS events,
   (SELECT count(*) FROM patient_transfer.audit_logs WHERE entity_id=$1) AS audit`,[booking.id])).rows[0]
  const original=await counts(),body={eventId:randomUUID(),expectedRevision:booking.revision,command:{type:'APPROVE'}}
  await f.pool.query(`CREATE FUNCTION patient_transfer.synthetic_alert_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected alert publication failure' USING ERRCODE='23514'; END $$`)
  await f.pool.query('CREATE TRIGGER synthetic_alert_failure BEFORE INSERT ON patient_transfer.dispatcher_alerts FOR EACH ROW EXECUTE FUNCTION patient_transfer.synthetic_alert_failure()')
  await f.request(`/bookings/${booking.id}/commands`,'dispatcher',body,422)
  expect(await f.snapshot(booking.id)).toEqual(before);expect(await counts()).toEqual(original)
  await f.pool.query('DROP TRIGGER synthetic_alert_failure ON patient_transfer.dispatcher_alerts')
  await f.request(`/bookings/${booking.id}/commands`,'dispatcher',body)
  const committed=await counts()
  await f.request(`/bookings/${booking.id}/commands`,'dispatcher',body)
  expect(await counts()).toEqual(committed)
  expect(Number(committed.notifications)-Number(original.notifications)).toBe(1)
  expect(Number(committed.alerts)-Number(original.alerts)).toBe(1)
 } finally {await f.close()}
})
