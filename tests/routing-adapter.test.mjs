import {test} from 'node:test'
import assert from 'node:assert/strict'
import {osrmRouting} from '../server/routing.mjs'

const origin={latitude:18.58,longitude:99.04},pickup={latitude:18.59,longitude:99.05}
test('routing retains verified provenance and identifies the application',async()=>{
  const route=osrmRouting('https://routing.invalid/',{minimumIntervalMs:0,userAgent:'Synthetic routing test',fetcher:async(url,options)=>{
    assert.equal(url.pathname,'/route/v1/driving/99.04,18.58;99.05,18.59')
    assert.equal(options.headers['User-Agent'],'Synthetic routing test')
    return{ok:true,json:async()=>({code:'Ok',routes:[{duration:150}]})}
  }})
  assert.deepEqual(await route(origin,pickup),{minutes:2.5,source:'OSRM'})
})
test('parallel callers obey provider spacing even when a provider request fails',async()=>{
  const starts=[]
  const route=osrmRouting('https://routing.invalid/',{minimumIntervalMs:50,fetcher:async()=>{
    starts.push(performance.now())
    if(starts.length===1)throw Error('Synthetic outage')
    return{ok:true,json:async()=>({code:'Ok',routes:[{duration:60}]})}
  }})
  const results=await Promise.allSettled([route(origin,pickup),route(origin,pickup),route(origin,pickup)])
  assert.equal(results[0].status,'rejected');assert.equal(results[0].reason.status,503)
  assert.equal(results[1].status,'fulfilled');assert.equal(results[2].status,'fulfilled')
  assert.ok(starts[1]-starts[0]>=45);assert.ok(starts[2]-starts[1]>=45)
})
test('missing and unverifiable routes never yield invented estimates; invalid pacing fails startup',async()=>{
  await assert.rejects(osrmRouting(undefined)(origin,pickup),error=>error.status===503)
  for(const result of [{code:'NoRoute',routes:[]},{code:'Ok',routes:[{duration:-1}]},{code:'Ok',routes:[{duration:null}]}]){
    await assert.rejects(osrmRouting('https://routing.invalid/',{minimumIntervalMs:0,fetcher:async()=>({ok:true,json:async()=>result})})(origin,pickup),error=>error.status===503)
  }
  assert.throws(()=>osrmRouting('https://routing.invalid/',{minimumIntervalMs:-1}),/Invalid OSRM/)
})
