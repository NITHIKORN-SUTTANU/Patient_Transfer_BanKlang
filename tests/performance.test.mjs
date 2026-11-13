import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { percentile, summarize, measureRequest } from '../scripts/performance/measure.mjs'
import { loadDiagnostics } from './helpers/load-diagnostics.mjs'
import { setTimeout as pause } from 'node:timers/promises'

test('nearest-rank p95 and success-within-target include functional failures in the denominator', () => {
  assert.equal(percentile([], 0.95), null)
  assert.equal(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 0.95), 95)
  const report = summarize([{ ok: true, ms: 2500 }, { ok: false, ms: 1, failure: 'http_500' }], 2000)
  assert.equal(report.successfulWithinTargetPercent, 0)
  assert.equal(report.failed, 1)
  assert.deepEqual(report.failures, { http_500: 1 })
  assert.equal(summarize([], 2000).successfulWithinTargetPercent, null)
  assert.equal(summarize([{ ok: true, ms: 1 }]).successfulWithinTargetPercent, null)
})

test('test-only diagnostics attribute pool/lock waits and overlapping routes without retaining query data', async () => {
  const diagnostics = loadDiagnostics()
  let releases = 0
  const pool = diagnostics.pool({ async connect() {
    await pause(15)
    return { async query(sql) {
      if (sql.includes('pg_advisory_xact_lock')) await pause(25)
      else await pause(5)
      return { rows: [] }
    }, release() { releases++ } }
  } })
  const server = http.createServer(async (_request, response) => {
    const client = await pool.connect()
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('private SQL text'))")
      await client.query('SELECT $1', ['private parameter'])
      await Promise.all([diagnostics.route(() => pause(35)), diagnostics.route(() => pause(35))])
      response.end('{}')
    } finally { client.release() }
  })
  diagnostics.server(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  diagnostics.start()
  try {
    await Promise.all([0, 1].map(() => fetch(`http://127.0.0.1:${server.address().port}/api/bookings`, { method: 'POST' }).then(row => row.text())))
    const report = diagnostics.stop(), intake = report.byOperation.intake
    assert.equal(releases, 2)
    assert.equal(intake.requests, 2)
    assert.ok(intake.poolMs.mean >= 10)
    assert.ok(intake.lockMs.mean >= 20)
    assert.equal(intake.queryCount.mean, 2)
    assert.ok(intake.routeMs.mean >= 30)
    assert.ok(intake.routeMs.mean + intake.poolMs.mean + intake.lockMs.mean + intake.sqlMs.mean <= intake.totalMs.mean + 1,
      'Parallel route waits must not be summed as sequential wall time')
    assert.equal(JSON.stringify(report).includes('private'), false)
  } finally { diagnostics.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('request timing consumes the full body and rejects HTTP, semantic and export failures', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/api/error') { response.writeHead(500); response.end('{}'); return }
    if (request.url === '/api/slow') {
      response.writeHead(200); response.write('{"ok":')
      setTimeout(() => response.end('true}'), 60); return
    }
    response.end('{"ok":false}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`, samples = [], activity = { inFlight: 0, peak: 0 }
  const actor = { index: 0, role: 'citizen', token: 'synthetic-only' }
  try {
    for (const [path, kind, validate] of [['/slow', 'normal', row => row.ok === true], ['/error', 'normal'],
      ['/invalid', 'normal', row => row.ok === true], ['/invalid', 'export']]) {
      await measureRequest(base, actor, { name: 'unit', path, kind, validate }, samples, activity)
    }
    assert.ok(samples[0].ms >= 50)
    assert.deepEqual(samples.map(row => row.failure), [null, 'http_500', 'invalid_result', 'invalid_export'])
    assert.equal(activity.inFlight, 0)
    assert.equal(samples.some(row => Object.hasOwn(row, 'token')), false)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
