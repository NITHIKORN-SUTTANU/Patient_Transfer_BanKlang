import { setTimeout as pause } from 'node:timers/promises'

export function percentile(values, fraction) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(fraction * sorted.length) - 1]
}

export function summarize(samples, targetMs) {
  const successful = samples.filter(row => row.ok)
  const withinTarget = successful.filter(row => row.ms <= targetMs).length
  const failures = {}
  for (const row of samples.filter(row => !row.ok)) failures[row.failure] = (failures[row.failure] ?? 0) + 1
  return { attempts: samples.length, successful: successful.length, failed: samples.length - successful.length,
    failures, p95AllMs: percentile(samples.map(row => row.ms), 0.95),
    p95SuccessfulMs: percentile(successful.map(row => row.ms), 0.95), targetMs: targetMs ?? null,
    successfulWithinTarget: targetMs === undefined ? null : withinTarget,
    successfulWithinTargetPercent: targetMs === undefined || !samples.length ? null : 100 * withinTarget / samples.length }
}

// Every response body is consumed before stopping the latency timer. No payloads/tokens are retained in samples.
export async function measureRequest(base, actor, operation, samples, activity) {
  const started = performance.now()
  activity.inFlight++; activity.peak = Math.max(activity.peak, activity.inFlight)
  let status = null, bytes = 0, elapsed, failure = 'transport', value
  try {
    const response = await fetch(`${base}/api${operation.path}`, { method: operation.body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${actor.token}`, ...(operation.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(operation.body ? { body: JSON.stringify(operation.body) } : {}), signal: AbortSignal.timeout(20000) })
    status = response.status
    const buffer = Buffer.from(await response.arrayBuffer())
    bytes = buffer.length; elapsed = performance.now() - started
    if (status !== (operation.status ?? 200)) { failure = `http_${status}`; return }
    if (operation.kind === 'export') {
      failure = 'invalid_export'
      if (!response.headers.get('content-disposition')?.includes('attachment') || buffer.subarray(0, 2).toString() !== 'PK') return
      value = { bytes }
    } else { failure = 'invalid_json'; value = JSON.parse(buffer.toString('utf8')) }
    failure = 'invalid_result'
    if (operation.validate && !operation.validate(value)) return
    operation.saved?.(value)
    failure = null
    return value
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') failure = 'timeout'
  } finally {
    activity.inFlight--
    samples.push({ actor: actor.index, role: actor.role, operation: operation.name, kind: operation.kind ?? 'normal',
      status, bytes, ms: elapsed ?? performance.now() - started, ok: failure === null, failure })
  }
}

export async function runUsers(actors, nextOperation, request, { durationMs, thinkMs }) {
  const start = performance.now(), deadline = start + durationMs
  await Promise.all(actors.map(async actor => {
    let step = 0
    while (performance.now() < deadline) {
      await request(actor, nextOperation(actor, step++))
      const remaining = deadline - performance.now()
      if (remaining > 0) await pause(Math.min(thinkMs, remaining))
    }
  }))
  return performance.now() - start
}
