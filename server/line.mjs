import { ApiError, check } from './errors.mjs'

export function lineIdentityVerifier(channelId, fetcher=globalThis.fetch) {
  return async (idToken, now) => {
    check(channelId,503,'LINE login is not configured')
    let response, result
    try {
      response=await fetcher('https://api.line.me/oauth2/v2.1/verify',{
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({id_token:idToken,client_id:channelId}),signal:AbortSignal.timeout(8000),
      })
      result=await response.json()
    } catch {throw new ApiError(503,'LINE identity service unavailable')}
    check(response.ok, response.status===429||response.status>=500?503:401,'LINE identity verification failed')
    check(result.iss==='https://access.line.me'&&result.aud===channelId&&typeof result.sub==='string'&&/^U[a-f0-9]{32}$/i.test(result.sub)&&
      Number.isFinite(result.exp)&&result.exp*1000>Date.parse(now)&&Number.isFinite(result.iat)&&result.iat*1000<=Date.parse(now)+60000,
      401,'Invalid LINE identity claims')
    return {subject:result.sub,name:typeof result.name==='string'?result.name.slice(0,120):'ผู้ใช้ LINE'}
  }
}

export function linePushSender(accessToken, fetcher=globalThis.fetch) {
  check(accessToken,503,'LINE messaging is not configured')
  return async ({recipient,text,retryKey}) => {
    let response
    try {
      response=await fetcher('https://api.line.me/v2/bot/message/push',{
        method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json','X-Line-Retry-Key':retryKey},
        body:JSON.stringify({to:recipient,messages:[{type:'text',text}]}),signal:AbortSignal.timeout(8000),
      })
    } catch {return {ok:false,retry:true,code:'LINE_NETWORK'}}
    if(response.ok||(response.status===409&&response.headers?.get('x-line-accepted-request-id'))) return {ok:true}
    const retryAfter=response.headers?.get('retry-after')
    return {ok:false,retry:response.status===429||response.status>=500,code:`LINE_HTTP_${response.status}`,...(retryAfter?{retryAfter}:{})}
  }
}
