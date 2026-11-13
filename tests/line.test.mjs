import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineIdentityVerifier, linePushSender } from '../server/line.mjs'
import {retryTime} from '../server/notifications.mjs'

const now='2030-01-12T00:00:00Z'
const claims={iss:'https://access.line.me',aud:'test-channel',sub:`U${'a'.repeat(32)}`,name:'Synthetic LINE user',iat:Date.parse(now)/1000-60,exp:Date.parse(now)/1000+3600}
test('LINE verification sends ID token to LINE and validates returned audience/issuer/expiry',async()=>{
  const verify=lineIdentityVerifier('test-channel',async(url,options)=>{
    assert.equal(url,'https://api.line.me/oauth2/v2.1/verify')
    assert.equal(options.body.get('client_id'),'test-channel')
    assert.equal(options.body.get('id_token'),'synthetic-token')
    return {ok:true,status:200,json:async()=>claims}
  })
  assert.deepEqual(await verify('synthetic-token',now),{subject:claims.sub,name:claims.name})
  for(const replacement of [{aud:'wrong'},{iss:'wrong'},{exp:0},{sub:'forged'},{iat:Date.parse(now)/1000+3600}]) {
    const invalid=lineIdentityVerifier('test-channel',async()=>({ok:true,json:async()=>({...claims,...replacement})}))
    await assert.rejects(invalid('synthetic-token',now),{status:401})
  }
  await assert.rejects(lineIdentityVerifier(undefined)('token',now),{status:503})
  await assert.rejects(lineIdentityVerifier('test-channel',async()=>{throw new Error('offline')})('token',now),{status:503})
})
test('LINE push uses stable retry key; already-accepted retries count as success',async()=>{
  const sender=linePushSender('synthetic-channel-token',async(url,options)=>{
    assert.equal(url,'https://api.line.me/v2/bot/message/push')
    assert.equal(options.headers['X-Line-Retry-Key'],'synthetic-retry-key')
    assert.equal(options.headers.Authorization,'Bearer synthetic-channel-token')
    assert.deepEqual(JSON.parse(options.body),{to:claims.sub,messages:[{type:'text',text:'Transport update'}]})
    return {ok:false,status:409,headers:new Headers({'x-line-accepted-request-id':'synthetic-accepted-request'})}
  })
  assert.deepEqual(await sender({recipient:claims.sub,text:'Transport update',retryKey:'synthetic-retry-key'}),{ok:true})
  const rateLimited=linePushSender('synthetic',async()=>({ok:false,status:429}))
  assert.deepEqual(await rateLimited({recipient:claims.sub,text:'Update',retryKey:'key'}),{ok:false,retry:true,code:'LINE_HTTP_429'})
  const invalid=linePushSender('synthetic',async()=>({ok:false,status:400}))
  assert.equal((await invalid({recipient:claims.sub,text:'Update',retryKey:'key'})).retry,false)
})

test('retry delays use 1/5/30/120 minutes and later valid provider instructions',()=>{
  for(const [attempt,minutes] of [[1,1],[2,5],[3,30],[4,120]]) assert.equal(Date.parse(retryTime(attempt,now))-Date.parse(now),minutes*60000)
  assert.equal(retryTime(5,now),null)
  assert.equal(Date.parse(retryTime(1,now,'600'))-Date.parse(now),600000)
  assert.equal(retryTime(1,now,'Sat, 12 Jan 2030 00:15:00 GMT'),'2030-01-12T00:15:00.000Z')
  for(const value of ['garbage','-1','0','9'.repeat(300)]) assert.equal(retryTime(1,now,value),'2030-01-12T00:01:00.000Z')
})

test('LINE sender preserves Retry-After and does not fabricate acceptance from an unconfirmed conflict',async()=>{
  const sender=linePushSender('synthetic',async()=>({ok:false,status:429,headers:new Headers({'Retry-After':'600'})}))
  assert.deepEqual(await sender({recipient:claims.sub,text:'Update',retryKey:'key'}),{ok:false,retry:true,code:'LINE_HTTP_429',retryAfter:'600'})
  const conflict=linePushSender('synthetic',async()=>({ok:false,status:409,headers:new Headers()}))
  assert.deepEqual(await conflict({recipient:claims.sub,text:'Update',retryKey:'key'}),{ok:false,retry:false,code:'LINE_HTTP_409'})
})
