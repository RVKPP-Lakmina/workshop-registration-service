import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { admin, manager } from '../test/fixtures'
import { renderApp } from '../test/render'
import { server } from '../test/server'

async function fill(user: ReturnType<typeof renderApp>['user'], email: string, pw: string) {
  await user.type(screen.getByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), pw)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('Login page', () => {
  it('signs in a manager, stores nothing and opens /workshops', async () => {
    let body: unknown
    server.use(
      http.post('/api/auth/login', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ user: manager })
      }),
    )
    const { user } = renderApp(<App />, { route: '/login' })
    await fill(user, '  mgr@workshop.test ', 'secret123')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/workshops'))
    expect(body).toEqual({ email: 'mgr@workshop.test', password: 'secret123' }) // email trimmed
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('sends an admin to /users', async () => {
    server.use(http.post('/api/auth/login', () => HttpResponse.json({ user: admin })))
    const { user } = renderApp(<App />, { route: '/login' })
    await fill(user, 'admin@workshop.test', 'secret123')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/users'))
  })

  it('shows the server message on wrong credentials and stays put', async () => {
    server.use(http.post('/api/auth/login', () => HttpResponse.json({ message: 'Invalid email or password' }, { status: 401 })))
    const { user } = renderApp(<App />, { route: '/login' })
    await fill(user, 'mgr@workshop.test', 'wrong')
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(screen.getByTestId('location')).toHaveTextContent('/login')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('disables the button while signing in', async () => {
    server.use(
      http.post('/api/auth/login', async () => {
        await new Promise((r) => setTimeout(r, 50))
        return HttpResponse.json({ user: manager })
      }),
    )
    const { user } = renderApp(<App />, { route: '/login' })
    await fill(user, 'mgr@workshop.test', 'secret123')
    expect(await screen.findByRole('button', { name: 'Signing in...' })).toBeDisabled()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/workshops'))
  })

  it('shows a friendly error when the server is unreachable', async () => {
    server.use(http.post('/api/auth/login', () => HttpResponse.error()))
    const { user } = renderApp(<App />, { route: '/login' })
    await fill(user, 'mgr@workshop.test', 'secret123')
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot reach the server/i)
  })
})
