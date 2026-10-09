import { config } from '../config'

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

type Params = Record<string, string | number | boolean | undefined | null>

function qs(params?: Params) {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export async function api<T>(
  method: string,
  path: string,
  opts: { body?: unknown; params?: Params } = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${config.apiBaseUrl}${path}${qs(opts.params)}`, {
      method,
      // Auth is an HttpOnly session cookie; X-Requested-With is the CSRF defence the API requires.
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.', 'NETWORK')
  }

  if (res.status === 429) {
    throw new ApiError(429, 'Too many requests, wait a moment and try again.', 'RATE_LIMITED')
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    const d = (data ?? {}) as { code?: string; message?: string | string[] }
    const msg = Array.isArray(d.message) ? d.message.join('. ') : d.message
    if (res.status === 401 && path !== '/auth/login') {
      onUnauthorized()
    }
    throw new ApiError(res.status, msg || `Something went wrong (${res.status}).`, d.code)
  }
  return data as T
}

export const get = <T>(path: string, params?: Params) => api<T>('GET', path, { params })
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, { body: body ?? {} })
export const patch = <T>(path: string, body?: unknown) => api<T>('PATCH', path, { body: body ?? {} })

/** Accepts either a bare array or a { items } envelope. */
export function asList<T>(data: T[] | { items?: T[]; data?: T[] }): T[] {
  if (Array.isArray(data)) return data
  return data.items ?? data.data ?? []
}
