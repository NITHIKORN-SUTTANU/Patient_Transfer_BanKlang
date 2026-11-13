import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { syntheticAvailabilityCanary } from './helpers/availability-canary.mjs'

for (const mode of ['landing_page', 'timeout']) test(`green health plus ${mode} cannot pass the critical-service probe`, async () => {
  const timers = []
  const server = http.createServer((request, response) => {
    if (request.url === '/api/health') { response.setHeader('Content-Type', 'application/json'); response.end('{"status":"ok"}'); return }
    if (mode === 'landing_page') { response.setHeader('Content-Type', 'text/html'); response.end('<html>Service homepage</html>') }
    else timers.push(setTimeout(() => { response.setHeader('Content-Type', 'application/json'); response.end('{}') }, 500))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await syntheticAvailabilityCanary({ base: `http://127.0.0.1:${server.address().port}`, control: {}, timeoutMs: 100 })
    assert.equal(result.state, 'unavailable')
    assert.equal(result.databaseHealthOk, true)
    assert.deepEqual(result.failure, { check: 'line_identity', code: mode === 'landing_page' ? 'invalid_content_type' : 'timeout' })
    assert.equal(JSON.stringify(result).includes('synthetic-availability-line'), false)
  } finally { timers.forEach(clearTimeout); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
