/** Typed fetch wrapper: session cookies, CSRF header, consistent errors. */

export class ApiError extends Error {
  status: number
  details?: unknown
  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)asm_csrf=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  raw?: boolean
}

export async function api<T = any>(path: string, options: Options = {}): Promise<T> {
  const method = options.method || 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken()
  let body: BodyInit | undefined
  if (options.body instanceof FormData) {
    body = options.body
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError('Cannot reach the store right now. Check your connection and try again.', 0)
  }

  if (response.status === 204) return undefined as T
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new ApiError(`Request failed (${response.status})`, response.status)
    return (await response.text()) as unknown as T
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(extractMessage(data, response.status), response.status, data)
  }
  return data as T
}

function extractMessage(data: any, status: number): string {
  if (!data) return `Request failed (${status})`
  if (typeof data.detail === 'string') return data.detail
  if (Array.isArray(data.detail)) {
    const first = data.detail[0]
    if (first?.msg) {
      const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : ''
      return field ? `${String(field)}: ${first.msg}` : first.msg
    }
  }
  return `Request failed (${status})`
}

export async function uploadImage(file: File, endpoint: string): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file)
  return api<{ url: string }>(endpoint, { method: 'POST', body: form })
}

export const qs = (params: Record<string, string | number | boolean | null | undefined>): string => {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '' || value === false) return
    search.set(key, String(value))
  })
  const text = search.toString()
  return text ? `?${text}` : ''
}
