import { AsyncLocalStorage } from 'node:async_hooks'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { percentile } from '../../scripts/performance/measure.mjs'

const queryKind = sql => {
  if (sql.includes('pg_advisory_xact_lock')) return 'operational_lock'
  if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/i.test(sql)) return sql.split(' ')[0].toLowerCase()
  if (sql.startsWith('SELECT b.*,b.hospital_location_snapshot')) return 'booking_hydration'
  if (sql.startsWith('SELECT u.id,u.role,u.display_name')) return 'authentication'
  if (/INSERT INTO patient_transfer\.(bookings|notifications|audit_logs|dispatcher_alerts)/i.test(sql)) return `insert_${sql.match(/patient_transfer\.(\w+)/i)[1]}`
  return 'other_sql'
}
const operation = request => {
  const path = new URL(request.url, 'http://localhost').pathname
  if (request.method === 'POST' && path === '/api/bookings') return 'intake'
  if (path === '/api/reports/monthly') return 'monthly_export'
  if (path === '/api/reports/daily') return 'daily_export'
  if (request.method === 'POST' && path.endsWith('/schedule')) return 'schedule'
  return request.method === 'POST' ? 'other_write' : 'read'
}
const distribution = values => ({ mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
  p50: percentile(values, 0.5), p95: percentile(values, 0.95), max: values.length ? Math.max(...values) : null })
function intervalTime(intervals) {
  let total = 0, until = -Infinity
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, end - Math.max(start, until)); until = Math.max(until, end)
  }
  return total
}

// Opt-in test fixture instrumentation. No SQL text/parameters, tokens, URLs or patient fields retained.
export function loadDiagnostics() {
  const context = new AsyncLocalStorage(), traces = [], queries = []
  const loop = monitorEventLoopDelay({ resolution: 20 })
  let active = false, utilization
  async function query(client, args) {
    const trace = active && context.getStore()
    if (!trace) return client.query(...args)
    const kind = queryKind(typeof args[0] === 'string' ? args[0] : args[0].text)
    const start = performance.now()
    try { return await client.query(...args) }
    finally {
      const ms = performance.now() - start
      if (kind === 'operational_lock') trace.lockMs += ms
      else trace.sqlMs += ms
      trace.queryCount++
      queries.push({ operation: trace.operation, kind, ms })
    }
  }
  return {
    pool(raw) {
      const wrapped = {
        async connect() {
          const trace = active && context.getStore(), start = performance.now()
          const client = await raw.connect()
          if (trace) trace.poolMs += performance.now() - start
          return { query: (...args) => query(client, args), release: (...args) => client.release(...args) }
        },
        async query(...args) {
          const client = await wrapped.connect()
          try { return await client.query(...args) } finally { client.release() }
        },
      }
      return wrapped
    },
    server(server) {
      const handlers = server.listeners('request')
      server.removeAllListeners('request')
      server.on('request', (request, response) => {
        if (!active) { for (const handler of handlers) handler.call(server, request, response); return }
        const trace = { operation: operation(request), started: performance.now(), poolMs: 0, lockMs: 0, sqlMs: 0, routeIntervals: [], queryCount: 0 }
        response.once('finish', () => {
          trace.totalMs = performance.now() - trace.started
          trace.routeMs = intervalTime(trace.routeIntervals); delete trace.routeIntervals
          trace.outsideDbRouteMs = Math.max(0, trace.totalMs - trace.poolMs - trace.lockMs - trace.sqlMs - trace.routeMs)
          trace.status = response.statusCode; delete trace.started; traces.push(trace)
        })
        context.run(trace, () => { for (const handler of handlers) handler.call(server, request, response) })
      })
    },
    async route(work) {
      const trace = active && context.getStore(), start = performance.now()
      try { return await work() } finally { if (trace) trace.routeIntervals.push([start, performance.now()]) }
    },
    start() { traces.length = 0; queries.length = 0; loop.reset(); loop.enable(); utilization = performance.eventLoopUtilization(); active = true },
    dispose() { active = false; loop.disable() },
    stop() {
      active = false; loop.disable()
      const elapsed = performance.eventLoopUtilization(utilization)
      const byOperation = Object.fromEntries([...new Set(traces.map(row => row.operation))].map(name => {
        const selected = traces.filter(row => row.operation === name)
        return [name, { requests: selected.length, ...Object.fromEntries(['totalMs', 'poolMs', 'lockMs', 'sqlMs', 'routeMs', 'outsideDbRouteMs', 'queryCount']
          .map(key => [key, distribution(selected.map(row => row[key]))])) }]
      }))
      const byQuery = Object.fromEntries([...new Set(queries.map(row => row.kind))].map(kind => {
        const selected = queries.filter(row => row.kind === kind)
        return [kind, { calls: selected.length, ...distribution(selected.map(row => row.ms)) }]
      }))
      return { scope: 'test-only client-observed waits; SQL durations include network/driver/event-loop delay, not pure PostgreSQL execution',
        eventLoop: { utilization: elapsed.utilization, p95DelayMs: loop.percentile(95) / 1e6, maxDelayMs: loop.max / 1e6 },
        byOperation, byQuery, slowestIntakes: traces.filter(row => row.operation === 'intake').sort((a, b) => b.totalMs - a.totalMs).slice(0, 5) }
    },
  }
}
