import {randomUUID} from 'node:crypto'
import {test,expect,type Page} from '@playwright/test'
import {startOperationalTestApi,ids} from './helpers/operational-postgres'
import {syntheticPassword} from './helpers/admin-postgres.mjs'
import {deliverNotifications as deliverRaw} from '../server/notifications.mjs'
const deliverNotifications=(...args:Parameters<typeof deliverRaw>)=>deliverRaw(args[0],args[1],{publicAppUrl:'https://municipality.example',...args[2]})

test.use({actionTimeout:10000})
test.beforeEach(()=>test.skip(!process.env.DATABASE_TEST_ADMIN_URL,'Run npm run test:notifications:integration with a local test database configured'))
async function fixture() {
  const f=await startOperationalTestApi(),booking=await f.assigned()
  await f.pool.query("UPDATE patient_transfer.notifications SET next_attempt_at='2099-01-01'")
  await f.pool.query('UPDATE patient_transfer.users SET line_subject=$1 WHERE id=$2',[`U${'c'.repeat(32)}`,ids.citizen])
  const event=(await f.pool.query('SELECT id FROM patient_transfer.trip_events WHERE booking_id=$1 ORDER BY sequence DESC LIMIT 1',[booking.id])).rows[0].id
  const receipt=(await f.pool.query("SELECT message_data FROM patient_transfer.notifications WHERE booking_id=$1 AND template_key='REQUEST_RECEIVED' LIMIT 1",[booking.id])).rows[0].message_data
  async function notification(withSnapshot=true) {
    const id=randomUUID()
    await f.pool.query(`INSERT INTO patient_transfer.notifications(id,booking_id,recipient_id,deduplication_key,template_key,next_attempt_at,message_data)
      VALUES($1,$2,$3,$4,'SYNTHETIC_NOTIFICATION',$5,$6)`,[id,booking.id,ids.citizen,`synthetic:${id}`,f.control.now,withSnapshot?receipt:null])
    return id
  }
  const row=async(id:string)=>(await f.pool.query('SELECT * FROM patient_transfer.notifications WHERE id=$1',[id])).rows[0]
  async function open(page:Page,admin=false) {
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url())
      try {await route.fulfill({response:await route.fetch({url:`${f.base}${url.pathname}${url.search}`})})}
      catch {throw new Error(`Ephemeral notification API request failed: ${url.pathname}`)}
    })
    await page.goto(`/staff/login?next=${encodeURIComponent(admin?'/admin':'/dispatcher/tracking')}`)
    await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(admin?'synthetic-admin':'synthetic-dispatcher')
    await page.getByLabel('รหัสผ่าน',{exact:true}).fill(syntheticPassword)
    await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click()
    await page.getByRole('link',{name:admin?'เปิดหน้าผู้ดูแลระบบ':'เปิดหน้าจัดรถ',exact:true}).click()
    await page.locator('summary').filter({hasText:admin?'ปัญหาการส่งข้อความ':'ข้อความที่ส่งไม่สำเร็จ'}).click()
  }
  return {...f,booking,event,notification,row,open}
}

test('five delivery attempts obey exact due boundaries, retain identity and record an immutable exhausted history',async()=>{
  const f=await fixture()
  try {
    const id=await f.notification(),sent:{recipient:string;text:string;retryKey:string}[]=[]
    const before=await f.snapshot(f.booking.id)
    const sender=async(message:{recipient:string;text:string;retryKey:string})=>{sent.push(message);return {ok:false,retry:true,code:'LINE_HTTP_503'}}
    const origin=Date.parse(f.control.now),minutes=[0,1,6,36,156]
    for(let index=0;index<minutes.length;index++) {
      const at=new Date(origin+minutes[index]*60000).toISOString()
      if(index>0) expect(await deliverNotifications(f.pool,sender,{now:new Date(Date.parse(at)-1).toISOString()})).toEqual([])
      expect(await deliverNotifications(f.pool,sender,{now:at})).toHaveLength(1)
      const saved=await f.row(id)
      expect(saved.attempts).toBe(index+1)
      expect(saved.next_attempt_at?.getTime()??null).toBe(index<4?origin+minutes[index+1]*60000:null)
    }
    expect(await deliverNotifications(f.pool,sender,{now:'2030-01-13T00:00:00Z'})).toEqual([])
    expect(sent).toHaveLength(5);expect(new Set(sent.map(item=>item.retryKey))).toEqual(new Set([id]))
    expect(sent.every(item=>!item.text.includes(f.booking.patientName)&&!item.text.includes('0800000000')&&!item.text.includes('18.59'))).toBe(true)
    const history=(await f.pool.query('SELECT * FROM patient_transfer.notification_attempts WHERE notification_id=$1 ORDER BY attempt',[id])).rows
    expect(history).toHaveLength(5)
    await expect(f.pool.query('DELETE FROM patient_transfer.notification_attempts WHERE id=$1',[history[0].id])).rejects.toMatchObject({code:'55000'})
    const queue=await f.request('/notification-failures')
    expect(queue.pending).toBe(1);expect(queue.failures[0]).toMatchObject({id,terminal:true,attempts:5,eventId:null,recipientId:ids.citizen})
    expect(await f.snapshot(f.booking.id)).toEqual(before)
  } finally {await f.close()}
})

test('provider delays, thrown network errors, permanent failures and expired retry keys never create false delivery success',async()=>{
  const f=await fixture()
  try {
    const id=await f.notification(),start=Date.parse(f.control.now)
    await deliverNotifications(f.pool,async()=>({ok:false,retry:true,code:'LINE_HTTP_429',retryAfter:'600'}),{now:f.control.now})
    expect((await f.row(id)).next_attempt_at.getTime()).toBe(start+10*60000)
    expect(await deliverNotifications(f.pool,async()=>({ok:true}),{now:new Date(start+10*60000-1).toISOString()})).toEqual([])
    await deliverNotifications(f.pool,async()=>{throw new Error('Synthetic secret-bearing provider text must not be persisted')},{now:new Date(start+10*60000).toISOString()})
    expect((await f.row(id)).failure_code).toBe('LINE_NETWORK')
    expect((await f.row(id)).next_attempt_at.getTime()).toBe(start+15*60000)
    await deliverNotifications(f.pool,async()=>({ok:true}),{now:new Date(start+15*60000).toISOString()})
    expect((await f.row(id)).status).toBe('SENT')
    const permanent=await f.notification()
    await deliverNotifications(f.pool,async()=>({ok:false,retry:false,code:'LINE_HTTP_400'}),{now:f.control.now})
    expect(await f.row(permanent)).toMatchObject({status:'FAILED',attempts:1,next_attempt_at:null,sent_at:null})
    const unknown=await f.notification()
    await deliverNotifications(f.pool,async()=>({ok:false,retry:true,code:'unsafe token=synthetic'}),{now:f.control.now})
    expect(await f.row(unknown)).toMatchObject({failure_code:'DELIVERY_FAILED',next_attempt_at:null})
    const expired=await f.notification()
    await deliverNotifications(f.pool,async()=>({ok:false,retry:true,code:'LINE_HTTP_429',retryAfter:'90000'}),{now:f.control.now})
    let calls=0
    await deliverNotifications(f.pool,async()=>{calls++;return {ok:true}},{now:new Date(start+90000*1000).toISOString()})
    expect(calls).toBe(0);expect(await f.row(expired)).toMatchObject({status:'FAILED',failure_code:'RETRY_KEY_EXPIRED',attempts:1,next_attempt_at:null})
    expect(JSON.stringify(await f.request('/admin/notification-failures','admin'))).not.toContain('unsafe token')
  } finally {await f.close()}
})

test('workers use failure completion time and concurrent claims send a notification only once',async()=>{
  const f=await fixture()
  try {
    const id=await f.notification(),started=Date.parse(f.control.now)
    let current=started
    await deliverNotifications(f.pool,async()=>{current+=8000;return {ok:false,retry:true,code:'LINE_NETWORK'}},{clock:()=>new Date(current).toISOString(),limit:1})
    expect((await f.row(id)).next_attempt_at.getTime()).toBe(started+68000)
    let calls=0
    const sender=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,20));return {ok:true}}
    const results=await Promise.all([deliverNotifications(f.pool,sender,{now:new Date(started+68000).toISOString(),limit:1}),deliverNotifications(f.pool,sender,{now:new Date(started+68000).toISOString(),limit:1})])
    expect(calls).toBe(1);expect(results.flat()).toHaveLength(1)
    expect(await f.row(id)).toMatchObject({attempts:2,status:'SENT',next_attempt_at:null})
  } finally {await f.close()}
})

test('durable attempt reservation survives an unknown send outcome and never permits a sixth attempt',async()=>{
  const f=await fixture()
  try {
    const id=await f.notification(),start=Date.parse(f.control.now),keys:string[]=[]
    const sender=async(message:{retryKey:string})=>{keys.push(message.retryKey);return {ok:true}}
    await f.pool.query(`CREATE FUNCTION patient_transfer.synthetic_delivery_write_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected delivery persistence failure' USING ERRCODE='23514'; END $$`)
    await f.pool.query('CREATE TRIGGER synthetic_delivery_failure BEFORE INSERT ON patient_transfer.notification_attempts FOR EACH ROW EXECUTE FUNCTION patient_transfer.synthetic_delivery_write_failure()')
    await expect(deliverNotifications(f.pool,sender,{now:f.control.now})).rejects.toMatchObject({code:'23514'})
    expect(await f.row(id)).toMatchObject({status:'PENDING',attempts:1,delivery_in_flight:true,sent_at:null})
    await f.pool.query('DROP TRIGGER synthetic_delivery_failure ON patient_transfer.notification_attempts')
    expect(await deliverNotifications(f.pool,sender,{now:new Date(start+29999).toISOString()})).toEqual([])
    await deliverNotifications(f.pool,sender,{now:new Date(start+30000).toISOString()})
    expect(keys).toEqual([id])
    expect(await f.row(id)).toMatchObject({status:'FAILED',attempts:1,delivery_in_flight:false,failure_code:'LINE_DELIVERY_UNCERTAIN'})
    expect((await f.row(id)).next_attempt_at.getTime()).toBe(start+90000)
    await deliverNotifications(f.pool,sender,{now:new Date(start+90000).toISOString()})
    expect(keys).toEqual([id,id]);expect(await f.row(id)).toMatchObject({status:'SENT',attempts:2})
    const fifth=await f.notification()
    await f.pool.query('UPDATE patient_transfer.notifications SET attempts=5,delivery_in_flight=true,first_attempt_at=$2 WHERE id=$1',[fifth,f.control.now])
    await deliverNotifications(f.pool,sender,{now:f.control.now})
    expect(keys).toHaveLength(2)
    expect(await f.row(fifth)).toMatchObject({status:'FAILED',attempts:5,delivery_in_flight:false,next_attempt_at:null})
    expect(await deliverNotifications(f.pool,sender,{now:new Date(start+3600000).toISOString()})).toEqual([])
  } finally {await f.close()}
})

test('unknown legacy retries stop for reconciliation; inactive recipients are never sent messages',async()=>{
  const f=await fixture()
  try {
    const legacy=await f.notification()
    await f.pool.query('UPDATE patient_transfer.notifications SET attempts=2 WHERE id=$1',[legacy])
    let calls=0
    const sender=async()=>{calls++;return {ok:true}}
    const unsnapshotted=await f.notification(false)
    await deliverNotifications(f.pool,sender,{now:f.control.now})
    expect(await f.row(unsnapshotted)).toMatchObject({failure_code:'MESSAGE_PAYLOAD_UNAVAILABLE',next_attempt_at:null})
    await deliverNotifications(f.pool,sender,{now:f.control.now})
    expect(calls).toBe(0)
    expect(await f.row(legacy)).toMatchObject({failure_code:'RETRY_HISTORY_UNKNOWN',next_attempt_at:null,attempts:2})
    expect((await f.pool.query('SELECT count(*)::int AS n FROM patient_transfer.notification_attempts WHERE notification_id=$1',[legacy])).rows[0].n).toBe(0)
    const unverified=await f.notification()
    await f.pool.query('UPDATE patient_transfer.users SET line_subject=NULL WHERE id=$1',[ids.citizen])
    await deliverNotifications(f.pool,sender,{now:f.control.now})
    expect(await f.row(unverified)).toMatchObject({failure_code:'NO_VERIFIED_LINE_ACCOUNT',attempts:1,next_attempt_at:null})
    const inactive=await f.notification()
    await f.pool.query('UPDATE patient_transfer.users SET active=false WHERE id=$1',[ids.citizen])
    await deliverNotifications(f.pool,sender,{now:f.control.now})
    expect(await f.row(inactive)).toMatchObject({failure_code:'ACCOUNT_INACTIVE',attempts:1,next_attempt_at:null})
    expect(calls).toBe(0)
  } finally {await f.close()}
})

test('failure pagination and reviewer ownership prevent forged reviews; inactive owners can be replaced',async()=>{
  const f=await fixture()
  try {
    const id=await f.notification()
    await deliverNotifications(f.pool,async()=>({ok:false,retry:false,code:'LINE_HTTP_400'}),{now:f.control.now})
    let row=await f.row(id)
    await f.request(`/notification-failures/${id}`,'dispatcher',{action:'review',expectedRevision:Number(row.revision),note:'Cannot review unclaimed'},403)
    await f.request(`/admin/notification-failures/${id}`,'admin',{action:'claim',expectedRevision:Number(row.revision)},403)
    await f.request(`/notification-failures/${id}`,'dispatcher',{action:'retry',expectedRevision:Number(row.revision)},400)
    await f.request(`/notification-failures/${id}`,'dispatcher',{action:'claim',expectedRevision:Number(row.revision)})
    await f.pool.query(`INSERT INTO patient_transfer.users(role,display_name,username,password_hash)
      SELECT 'dispatcher','Synthetic second reviewer','synthetic-dispatcher2',password_hash FROM patient_transfer.users WHERE username='synthetic-dispatcher'`)
    await f.login('dispatcher2')
    row=await f.row(id)
    await f.request(`/notification-failures/${id}`,'dispatcher2',{action:'claim',expectedRevision:Number(row.revision)},409)
    await f.request(`/notification-failures/${id}`,'dispatcher2',{action:'review',expectedRevision:Number(row.revision),note:'Cannot review another owner'},403)
    await f.pool.query("UPDATE patient_transfer.users SET active=false WHERE username='synthetic-dispatcher'")
    await f.request('/notification-failures','dispatcher',undefined,401)
    await f.request(`/notification-failures/${id}`,'dispatcher2',{action:'claim',expectedRevision:Number(row.revision)})
    row=await f.row(id)
    await f.request(`/notification-failures/${id}`,'dispatcher2',{action:'review',expectedRevision:Number(row.revision),note:'Human reconciliation and approved alternative contact recorded'})
    expect(await f.row(id)).toMatchObject({status:'FAILED',attempts:1,next_attempt_at:null})
    await f.pool.query(`INSERT INTO patient_transfer.notifications(booking_id,recipient_id,deduplication_key,template_key,status,attempts,failure_code)
      SELECT $1,$2,'page:'||gen_random_uuid(),'SYNTHETIC','FAILED',5,'LINE_HTTP_429' FROM generate_series(1,51)`,[f.booking.id,ids.citizen])
    const first=await f.request('/notification-failures','dispatcher2')
    expect(first.failures).toHaveLength(50);expect(first.nextCursor).toBeTruthy()
    const second=await f.request(`/notification-failures?cursor=${first.nextCursor}`,'dispatcher2')
    expect(second.failures).toHaveLength(2);expect(second.nextCursor).toBeNull()
    expect(new Set([...first.failures,...second.failures].map(row=>row.id)).size).toBe(52)
  } finally {await f.close()}
})

test('original dispatcher and admin screens record independent named reviews without retrying or exposing patient data to admin',async({page})=>{
  test.setTimeout(60000)
  const f=await fixture()
  try {
    const id=await f.notification()
    await deliverNotifications(f.pool,async()=>({ok:false,retry:false,code:'LINE_HTTP_401'}),{now:f.control.now})
    const before=await f.snapshot(f.booking.id)
    for(const role of ['citizen','driver','admin']) await f.request('/notification-failures',role,undefined,403)
    await f.request('/admin/notification-failures','dispatcher',undefined,403)
    const minimized=await f.request('/admin/notification-failures','admin')
    for(const value of [f.booking.id,f.booking.reference,ids.citizen,f.event,f.booking.patientName,'0800000000',`U${'c'.repeat(32)}`]) expect(JSON.stringify(minimized)).not.toContain(value)
    await f.open(page)
    const card=page.locator('section').filter({has:page.getByRole('heading',{name:f.booking.reference,exact:true})}).last()
    await card.getByRole('button',{name:'รับตรวจสอบรายการนี้',exact:true}).click()
    const note=page.getByRole('textbox',{name:'ผลตรวจสอบและขั้นตอนถัดไป',exact:true})
    await note.fill('ติดต่อผู้ขอผ่านช่องทางที่ได้รับอนุญาตแล้ว และส่งต่อปัญหาระบบ')
    await f.pool.query('UPDATE patient_transfer.notifications SET failure_code=failure_code WHERE id=$1',[id])
    await page.getByRole('button',{name:'บันทึกผลตรวจสอบ',exact:true}).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(note).toHaveValue('ติดต่อผู้ขอผ่านช่องทางที่ได้รับอนุญาตแล้ว และส่งต่อปัญหาระบบ')
    await page.getByRole('button',{name:'โหลดรายการส่งข้อความล่าสุด',exact:true}).click()
    await page.getByRole('textbox',{name:'ผลตรวจสอบและขั้นตอนถัดไป',exact:true}).fill('ตรวจสอบแล้ว ติดต่อผ่านช่องทางอื่นโดยไม่ส่งซ้ำ')
    await page.getByRole('button',{name:'บันทึกผลตรวจสอบ',exact:true}).click()
    await expect(page.getByText('บันทึกผลตรวจสอบแล้ว · ตรวจสอบแล้ว ติดต่อผ่านช่องทางอื่นโดยไม่ส่งซ้ำ',{exact:true})).toBeVisible()
    expect(await f.row(id)).toMatchObject({status:'FAILED',attempts:1,claimed_by:'00000000-0000-4000-8000-000000000002',technical_claimed_by:null})
    await f.open(page,true)
    await expect(page.getByText(f.booking.patientName,{exact:true})).toHaveCount(0)
    await expect(page.getByText(f.booking.reference,{exact:true})).toHaveCount(0)
    await page.getByRole('button',{name:'รับตรวจสอบรายการนี้',exact:true}).click()
    await page.getByRole('textbox',{name:'ผลตรวจสอบและขั้นตอนถัดไป',exact:true}).fill('ผู้รับผิดชอบระบบรับตรวจสอบสิทธิ์การเชื่อมต่อแล้ว')
    await page.getByRole('button',{name:'บันทึกผลตรวจสอบ',exact:true}).click()
    await expect(page.getByText('บันทึกผลตรวจสอบแล้ว · ผู้รับผิดชอบระบบรับตรวจสอบสิทธิ์การเชื่อมต่อแล้ว',{exact:true})).toBeVisible()
    expect(await f.row(id)).toMatchObject({status:'FAILED',attempts:1,next_attempt_at:null,technical_claimed_by:'00000000-0000-4000-8000-000000000004'})
    expect(await f.snapshot(f.booking.id)).toEqual(before)
  } finally {if(!page.isClosed()){await page.unrouteAll({behavior:'wait'});await page.close()}await f.close()}
})
