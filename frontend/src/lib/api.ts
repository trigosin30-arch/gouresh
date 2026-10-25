const TOKEN_KEY = 'asm.token'

/**
 * Relative by default (Vite dev/preview proxies `/api`). Set
 * `VITE_API_BASE_URL` when the static build is hosted apart from the API.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown }

async function request<T>(path: string, options: Options = {}): Promise<T> {
  const headers = new Headers(options.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let body: BodyInit | undefined
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(options.body)
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}/api${path}`, { ...options, headers, body })
  } catch {
    throw new ApiError('Cannot reach the store server. Please check your connection.', 0)
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  const data = text ? safeJson(text) : null

  if (!response.ok) {
    if (response.status === 401 && token) {
      setToken(null)
      window.dispatchEvent(new Event('asm:signed-out'))
    }
    throw new ApiError(extractMessage(data, response.status), response.status)
  }
  return data as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { detail: text }
  }
}

function extractMessage(data: unknown, status: number): string {
  const detail = (data as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string; loc?: string[] } | undefined
    if (first?.msg) {
      const field = first.loc?.filter((p) => p !== 'body').join('.')
      return field ? `${field}: ${first.msg.replace(/^Value error, /, '')}` : first.msg
    }
  }
  if (status === 404) return 'Not found'
  if (status === 403) return 'You do not have access to that'
  if (status >= 500) return 'Something went wrong at our end. Please try again.'
  return 'Request failed'
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  })
  const out = search.toString()
  return out ? `?${out}` : ''
}
