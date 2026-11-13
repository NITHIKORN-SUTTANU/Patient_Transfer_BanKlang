export class ApiError extends Error {
  constructor(public readonly status: number, public readonly field?: string, public readonly code?: string) { super(`API request failed (${status})`) }
}

// Same-origin API; prototype records and browser cookies are never submitted.
async function request(path: string, options: { token?: string; body?: unknown; timeoutMs?: number } = {}): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    method: options.body === undefined ? 'GET' : 'POST',
    headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
  })
  if (!response.ok) {
    const failure = await response.json().catch(() => null)
    throw new ApiError(response.status, typeof failure?.details?.field === 'string' ? failure.details.field : undefined,
      typeof failure?.details?.code === 'string' ? failure.details.code : undefined)
  }
  return response
}
export async function apiRequest<T>(path: string, options: { token?: string; body?: unknown } = {}): Promise<T> {
  return (await request(path,options)).json() as Promise<T>
}
export async function apiDownload(path: string, options: {token: string; body: unknown}): Promise<{blob:Blob;filename:string}> {
  const response=await request(path,{...options,timeoutMs:60000})
  const filename=/filename="([A-Za-z0-9_.-]+)"/.exec(response.headers.get('content-disposition')??'')?.[1]
  if(!filename)throw new ApiError(502)
  return {blob:await response.blob(),filename}
}
