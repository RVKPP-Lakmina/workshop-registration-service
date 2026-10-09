import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import { ApiError, api, asList, get, post, setUnauthorizedHandler, tokenStore } from './client'

describe('api client', () => {
  it('sends the Bearer token when logged in', async () => {
    tokenStore.set('abc')
    let auth: string | null = null
    server.use(
      http.get('/api/ping', ({ request }) => {
        auth = request.headers.get('authorization')
        return HttpResponse.json({ ok: true })
      }),
    )
    await get('/ping')
    expect(auth).toBe('Bearer abc')
  })

  it('omits Authorization when there is no token', async () => {
    let auth: string | null = 'x'
    server.use(
      http.get('/api/ping', ({ request }) => {
        auth = request.headers.get('authorization')
        return HttpResponse.json({})
      }),
    )
    await get('/ping')
    expect(auth).toBeNull()
  })

  it('serialises query params, skipping empty values', async () => {
    let url = ''
    server.use(
      http.get('/api/list', ({ request }) => {
        url = request.url
        return HttpResponse.json([])
      }),
    )
    await get('/list', { a: 'x', b: '', c: undefined, d: null, e: 0, f: false })
    const sp = new URL(url).searchParams
    expect([...sp.keys()].sort()).toEqual(['a', 'e', 'f'])
    expect(sp.get('e')).toBe('0')
  })

  it('posts a JSON body', async () => {
    let body: unknown
    let ct: string | null = null
    server.use(
      http.post('/api/things', async ({ request }) => {
        ct = request.headers.get('content-type')
        body = await request.json()
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )
    expect(await post('/things', { a: 1 })).toEqual({ id: 1 })
    expect(body).toEqual({ a: 1 })
    expect(ct).toContain('application/json')
  })

  it('returns null for empty 204 bodies', async () => {
    server.use(http.get('/api/empty', () => new HttpResponse(null, { status: 204 })))
    expect(await get('/empty')).toBeNull()
  })

  it('clears the token and calls the logout handler on 401', async () => {
    tokenStore.set('abc')
    const onUnauth = vi.fn()
    setUnauthorizedHandler(onUnauth)
    server.use(http.get('/api/secret', () => HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })))
    await expect(get('/secret')).rejects.toMatchObject({ status: 401 })
    expect(tokenStore.get()).toBeNull()
    expect(onUnauth).toHaveBeenCalledOnce()
  })

  it('does not log out on a 401 from the login endpoint', async () => {
    tokenStore.set('abc')
    const onUnauth = vi.fn()
    setUnauthorizedHandler(onUnauth)
    server.use(http.post('/api/auth/login', () => HttpResponse.json({ message: 'Invalid credentials' }, { status: 401 })))
    await expect(post('/auth/login', {})).rejects.toThrow('Invalid credentials')
    expect(tokenStore.get()).toBe('abc')
    expect(onUnauth).not.toHaveBeenCalled()
  })

  it('exposes status, code and message on ApiError', async () => {
    server.use(http.post('/api/x', () => HttpResponse.json({ code: 'WORKSHOP_FULL', message: 'Full' }, { status: 409 })))
    const err = await post('/x').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, code: 'WORKSHOP_FULL', message: 'Full' })
  })

  it('joins array messages (validation errors)', async () => {
    server.use(http.post('/api/x', () => HttpResponse.json({ message: ['name must not be empty', 'email must be an email'] }, { status: 400 })))
    await expect(post('/x')).rejects.toThrow('name must not be empty. email must be an email')
  })

  it('falls back to a generic message for non-JSON errors', async () => {
    server.use(http.get('/api/x', () => new HttpResponse('<html>boom</html>', { status: 500 })))
    await expect(get('/x')).rejects.toThrow('Something went wrong (500).')
  })

  it('maps 429 to a friendly message', async () => {
    server.use(http.get('/api/x', () => new HttpResponse('Too Many', { status: 429 })))
    await expect(get('/x')).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      message: expect.stringMatching(/too many requests/i),
    })
  })

  it('reports network failures in plain language', async () => {
    server.use(http.get('/api/x', () => HttpResponse.error()))
    await expect(get('/x')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK',
      message: expect.stringMatching(/cannot reach the server/i),
    })
  })

  it('supports arbitrary methods via api()', async () => {
    server.use(http.delete('/api/x', () => HttpResponse.json({ ok: true })))
    expect(await api('DELETE', '/x')).toEqual({ ok: true })
  })
})

describe('asList', () => {
  it('accepts arrays and {items}/{data} envelopes', () => {
    expect(asList([1, 2])).toEqual([1, 2])
    expect(asList({ items: [3] })).toEqual([3])
    expect(asList({ data: [4] })).toEqual([4])
    expect(asList({})).toEqual([])
  })
})

describe('tokenStore', () => {
  it('round-trips and survives storage errors', () => {
    tokenStore.set('t')
    expect(tokenStore.get()).toBe('t')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(tokenStore.get()).toBeNull()
    expect(() => {
      tokenStore.set('x')
      tokenStore.clear()
    }).not.toThrow()
  })
})
