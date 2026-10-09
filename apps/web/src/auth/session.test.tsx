import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { manager } from '../test/fixtures'
import { renderApp } from '../test/render'
import { server } from '../test/server'

describe('cookie session', () => {
  it('restores the session from GET /auth/me', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    server.use(http.get('/api/auth/me', () => HttpResponse.json(manager)))
    renderApp(<App />, { route: '/workshops' })
    expect(await screen.findByRole('heading', { name: 'Workshops' })).toBeInTheDocument()
    expect(fetchSpy.mock.calls.some(([u, init]) => String(u).endsWith('/auth/me') && init?.credentials === 'include')).toBe(true)
  })

  it('lands on /login when /auth/me returns 401', async () => {
    renderApp(<App />, { route: '/workshops' })
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'))
  })

  it('logout calls POST /auth/logout with the CSRF header and returns to /login', async () => {
    let xrw: string | null = null
    let calls = 0
    server.use(
      http.post('/api/auth/logout', ({ request }) => {
        calls++
        xrw = request.headers.get('x-requested-with')
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderApp(<App />, { route: '/workshops', user: manager })
    await user.click(await screen.findByRole('button', { name: 'Mia' }))
    await user.click(await screen.findByRole('menuitem', { name: /log out/i }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'))
    expect(calls).toBe(1)
    expect(xrw).toBe('XMLHttpRequest')
  })

  it('logs out locally even if POST /auth/logout fails', async () => {
    server.use(http.post('/api/auth/logout', () => HttpResponse.error()))
    const { user } = renderApp(<App />, { route: '/workshops', user: manager })
    await user.click(await screen.findByRole('button', { name: 'Mia' }))
    await user.click(await screen.findByRole('menuitem', { name: /log out/i }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'))
  })

  it('a 401 mid-session logs the user out', async () => {
    server.use(http.get('/api/workshops', () => HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })))
    renderApp(<App />, { route: '/workshops', user: manager })
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'))
  })
})
