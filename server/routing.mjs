import { ApiError } from './errors.mjs'

export function osrmRouting(baseUrl,{minimumIntervalMs=Number(process.env.OSRM_MIN_INTERVAL_MS??0),fetcher=globalThis.fetch,userAgent=process.env.OSRM_USER_AGENT??'PatientTransfer/0.1'}={}) {
  if (!baseUrl) return async () => { throw new ApiError(503, 'Routing unavailable; request remains pending') }
  const base = new URL(baseUrl)
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('OSRM_URL must use HTTP or HTTPS')
  if(!Number.isSafeInteger(minimumIntervalMs)||minimumIntervalMs<0||minimumIntervalMs>8000) throw new Error('Invalid OSRM_MIN_INTERVAL_MS')
  if(typeof userAgent!=='string'||!userAgent.trim()||userAgent.length>256||/[\r\n]/.test(userAgent)) throw new Error('Invalid OSRM_USER_AGENT')
  let tail=Promise.resolve(),lastStart=-Infinity,queued=0
  const request = async (from, to) => {
    const path = `route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}`
    const url = new URL(path, base.href.endsWith('/') ? base : `${base.href}/`)
    url.searchParams.set('overview', 'false')
    try {
      const response = await fetcher(url, { headers:{'User-Agent':userAgent},signal: AbortSignal.timeout(8000) })
      const result = await response.json()
      const duration = result.routes?.[0]?.duration
      if (!response.ok || result.code !== 'Ok' || !Number.isFinite(duration) || duration < 0) throw new Error('No verified route')
      return { minutes: Math.ceil(duration * 1000) / 60000, source: 'OSRM' }
    } catch { throw new ApiError(503, 'Routing unavailable; existing request and assignment retained') }
  }
  return async(from,to)=>{
    if(!minimumIntervalMs)return request(from,to)
    if(queued>=8)throw new ApiError(503,'Routing busy; existing request and assignment retained')
    const entered=performance.now();queued++
    const pending=tail.then(async()=>{
      if(performance.now()-entered>8000)throw new ApiError(503,'Routing busy; existing request and assignment retained')
      const remaining=minimumIntervalMs-(performance.now()-lastStart)
      if(remaining>0)await new Promise(resolve=>setTimeout(resolve,Math.ceil(remaining)))
      lastStart=performance.now()
      return request(from,to)
    })
    tail=pending.catch(()=>undefined)
    try{return await pending}finally{queued--}
  }
}
