import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readLineIdToken, LineConnectionError} from '../src/services/lineAuthentication.ts'

const now=Date.parse('2030-01-12T00:00:00Z')
function provider({inside=false,loggedIn=true,expiry=now/1000+3600,token='synthetic-original-token'}={}) {
  const calls=[]
  return {calls, sdk:{
    init:async config=>{calls.push(['init',config])},
    isLoggedIn:()=>loggedIn,isInClient:()=>inside,
    getDecodedIDToken:()=>({exp:expiry}),getIDToken:()=>token,
    logout:()=>calls.push(['logout']),login:config=>calls.push(['login',config]),
    openWindow:config=>calls.push(['openWindow',config]),
  }}
}
const read=(p,reconnect=false)=>readLineIdToken(p.sdk,'synthetic-liff',()=> 'https://demo.example/booking/status',reconnect,()=>now)
test('fresh LINE identity forwards only the unchanged original token',async()=>{
  const p=provider()
  assert.equal(await read(p),'synthetic-original-token')
  assert.equal(p.calls.length,1)
})
test('logged-in SDK with expired ID token requires fresh external login instead of resubmitting it',async()=>{
  const p=provider({expiry:now/1000-1})
  await assert.rejects(read(p),LineConnectionError)
  assert.deepEqual(p.calls.slice(1),[['logout'],['login',{redirectUri:'https://demo.example/booking/status'}]])
})
test('explicit reconnect refreshes even a token rejected before its decoded expiry',async()=>{
  const p=provider()
  await assert.rejects(read(p,true),LineConnectionError)
  assert.deepEqual(p.calls.slice(1).map(c=>c[0]),['logout','login'])
})
test('LIFF browser never invokes unsupported login/logout and opens external recovery only on request',async()=>{
  const p=provider({inside:true,expiry:0})
  await assert.rejects(read(p),LineConnectionError)
  assert.equal(p.calls.length,1)
  await assert.rejects(read(p,true),LineConnectionError)
  assert.deepEqual(p.calls.at(-1),['openWindow',{url:'https://demo.example/booking?line_reconnect=1',external:true}])
  assert.equal(p.calls.some(c=>['login','logout'].includes(c[0])),false)
})
test('logged-out external browser starts login; missing openid never returns an identity',async()=>{
  const p=provider({loggedIn:false})
  await assert.rejects(read(p),LineConnectionError)
  assert.deepEqual(p.calls.slice(1).map(c=>c[0]),['login'])
  await assert.rejects(read(provider({token:null})),LineConnectionError)
})
