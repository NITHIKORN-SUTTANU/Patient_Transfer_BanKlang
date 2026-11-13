import { ApiError } from './errors.mjs'

export function osrmRouting(baseUrl) {
  if (!baseUrl) return async () => { throw new ApiError(503, 'Routing unavailable; request remains pending') }
  const base = new URL(baseUrl)
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('OSRM_URL must use HTTP or HTTPS')
  return async (from, to) => {
    const path = `route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}`
    const url = new URL(path, base.href.endsWith('/') ? base : `${base.href}/`)
    url.searchParams.set('overview', 'false')
    try {
      const response = await globalThis.fetch(url, { signal: AbortSignal.timeout(8000) })
      const result = await response.json()
      const duration = result.routes?.[0]?.duration
      if (!response.ok || result.code !== 'Ok' || !Number.isFinite(duration) || duration < 0) throw new Error('No verified route')
      return { minutes: Math.ceil(duration * 1000) / 60000, source: 'OSRM' }
    } catch { throw new ApiError(503, 'Routing unavailable; existing request and assignment retained') }
  }
}
