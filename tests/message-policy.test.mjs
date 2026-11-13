import {test} from 'node:test'
import assert from 'node:assert/strict'
import {messageSnapshot,renderNotification,approvedAppOrigin} from '../server/notification-messages.mjs'
import {enqueue} from '../server/repository.mjs'

const row={id:'00000000-0000-4000-8000-000000000001',reference:'BK-synthetic',requester_id:'owner',status:'ASSIGNED',pickup_at:new Date('2030-01-15T01:05:00Z'),arrival_at:new Date('2030-01-15T01:40:00Z'),ready_at:new Date('2030-01-15T02:10:00Z')}
const now='2030-01-12T00:00:00Z',origin='https://municipality.example'
test('notification snapshot/rendering allowlists content and requires an approved HTTPS origin',()=>{
 const data=messageSnapshot({...row,patient_name:'PRIVATE PATIENT',contact_phone:'0800000000',pickup_address:'PRIVATE ADDRESS'},'ASSIGNED','citizen',now)
 const text=renderNotification(data,origin)
 assert.match(text,/ASSIGNED/);assert.match(text,/เวลารับที่ยืนยัน/);assert.match(text,/https:\/\/municipality.example\/booking\/status\//)
 for(const value of ['PRIVATE PATIENT','0800000000','PRIVATE ADDRESS'])assert.ok(!text.includes(value))
 for(const value of [undefined,'http://municipality.example','javascript:alert(1)','https://user:pass@municipality.example','https://municipality.example/path','https://municipality.example?query=1']) {
  assert.equal(approvedAppOrigin(value),null);assert.equal(renderNotification(data,value),null)
 }
 const removed=messageSnapshot(row,'ASSIGNMENT_CHANGED','driver',now,'removed')
 assert.equal(removed.pickupAt,null);assert.equal(new URLSearchParams(removed.linkPath.split('?')[1]).get('next'),'/driver')
 assert.match(renderNotification(removed,origin),/REMOVED/)
})
test('enqueue deduplicates resolved account identity across roster and owner roles',async()=>{
 const notifications=[],alerts=[]
 const client={query:async(sql,values)=>{
  if(sql.startsWith('SELECT b.*'))return {rows:[row]}
  if(sql.startsWith('SELECT user_id'))return {rows:[{user_id:'owner'}]}
  if(sql.includes('INSERT INTO patient_transfer.notifications'))notifications.push(values)
  else if(sql.includes('INSERT INTO patient_transfer.dispatcher_alerts'))alerts.push(values)
  else throw new Error('Unexpected query')
  return {rows:[],rowCount:1}
 }}
 await enqueue(client,row,[{recipient:'driver',recipientId:'roster',event:'ASSIGNED'},{recipient:'citizen',recipientId:'owner',event:'ASSIGNED'}],'event',now)
 assert.equal(notifications.length,1);assert.equal(notifications[0][1],'owner');assert.equal(notifications[0][6].audience,'citizen')
 assert.equal(notifications[0][3],'event:recipient:owner');assert.equal(alerts.length,1)
})
