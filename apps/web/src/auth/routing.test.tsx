import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { admin, manager, staff } from '../test/fixtures'
import { renderApp } from '../test/render'
import { server } from '../test/server'

const loc = () => screen.getByTestId('location').textContent

describe('routing and role guards', () => {
  it('sends unauthenticated visitors to /login', async () => {
    renderApp(<App />, { route: '/workshops' })
    await waitFor(() => expect(loc()).toBe('/login'))
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('sends "/" to /login when logged out', async () => {
    renderApp(<App />, { route: '/' })
    await waitFor(() => expect(loc()).toBe('/login'))
  })

  it('lands Admin on /users from the root', async () => {
    renderApp(<App />, { route: '/', user: admin })
    await waitFor(() => expect(loc()).toBe('/users'))
    expect(await screen.findByRole('heading', { name: 'Staff accounts' })).toBeInTheDocument()
  })

  it.each([
    ['Manager', manager],
    ['Staff', staff],
  ])('lands %s on /workshops from the root', async (_n, u) => {
    renderApp(<App />, { route: '/', user: u })
    await waitFor(() => expect(loc()).toBe('/workshops'))
  })

  it('redirects Admin away from /workshops to /users', async () => {
    renderApp(<App />, { route: '/workshops', user: admin })
    await waitFor(() => expect(loc()).toBe('/users'))
  })

  it('redirects Staff away from /users to /workshops', async () => {
    renderApp(<App />, { route: '/users', user: staff })
    await waitFor(() => expect(loc()).toBe('/workshops'))
  })

  it('keeps Staff out of the manager-only workshop editor', async () => {
    renderApp(<App />, { route: '/workshops/new', user: staff })
    await waitFor(() => expect(loc()).toBe('/workshops'))
  })

  it('lets Manager open the new workshop form', async () => {
    renderApp(<App />, { route: '/workshops/new', user: manager })
    expect(await screen.findByRole('heading', { name: 'New workshop' })).toBeInTheDocument()
    expect(loc()).toBe('/workshops/new')
  })

  it('redirects a logged-in user away from /login', async () => {
    renderApp(<App />, { route: '/login', user: manager })
    await waitFor(() => expect(loc()).toBe('/workshops'))
  })

  it('shows a loading state while the session is being restored', async () => {
    server.use(http.get('/api/auth/me', async () => {
      await new Promise((r) => setTimeout(r, 50))
      return HttpResponse.json(manager)
    }))
    renderApp(<App />, { route: '/workshops', user: manager })
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Workshops' })).toBeInTheDocument()
  })

  it('falls back to /login when there is no valid session cookie', async () => {
    renderApp(<App />, { route: '/workshops' })
    await waitFor(() => expect(loc()).toBe('/login'))
  })
})

describe('navigation', () => {
  const linkNames = () => screen.getAllByRole('link').map((a) => a.textContent)

  it('Admin sees Users and Activity log only', async () => {
    renderApp(<App />, { route: '/users', user: admin })
    await screen.findByRole('heading', { name: 'Staff accounts' })
    const nav = screen.getByRole('navigation')
    expect(nav).toHaveTextContent('Users')
    expect(nav).toHaveTextContent('Activity log')
    expect(nav).not.toHaveTextContent('Workshops')
  })

  it.each([
    ['Manager', manager],
    ['Staff', staff],
  ])('%s sees Workshops and Activity log but not Users', async (_n, u) => {
    renderApp(<App />, { route: '/workshops', user: u })
    await screen.findByRole('heading', { name: 'Workshops' })
    const nav = screen.getByRole('navigation')
    expect(nav).toHaveTextContent('Workshops')
    expect(nav).toHaveTextContent('Activity log')
    expect(nav).not.toHaveTextContent('Users')
    expect(linkNames()).not.toContain('Users')
  })

  it('shows the first name, opens the account menu and logs out back to /login', async () => {
    const { user } = renderApp(<App />, { route: '/workshops', user: manager })
    const trigger = await screen.findByRole('button', { name: 'Mia' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(trigger)
    expect(await screen.findByRole('menu')).toHaveTextContent('Mia Manager')
    expect(screen.getByRole('menu')).toHaveTextContent('MANAGER')
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))
    await waitFor(() => expect(loc()).toBe('/login'))
  })
})
