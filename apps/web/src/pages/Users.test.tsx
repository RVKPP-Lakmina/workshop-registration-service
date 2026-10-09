import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '../App'
import type { User } from '../types'
import { admin, manager, staff } from '../test/fixtures'
import { renderApp } from '../test/render'
import { server } from '../test/server'

const inactive: User = { id: 'u-off', email: 'off@workshop.test', name: 'Olly Off', role: 'STAFF', isActive: false }

function useUsers(list: User[] = [admin, manager, staff, inactive]) {
  server.use(http.get('/api/users', () => HttpResponse.json(list)))
}
const rowFor = (name: string) => screen.getByText(name).closest('tr')!

describe('Users page', () => {
  it('lists users with role and status', async () => {
    useUsers()
    renderApp(<App />, { route: '/users', user: admin })
    expect(await screen.findByText('Mia Manager')).toBeInTheDocument()
    expect(screen.getByText('mgr@workshop.test')).toBeInTheDocument()
    expect(within(rowFor('Mia Manager')).getByLabelText('Role for Mia Manager')).toHaveValue('MANAGER')
    expect(within(rowFor('Mia Manager')).getByText('Active')).toBeInTheDocument()
    expect(within(rowFor('Olly Off')).getByText('Turned off')).toBeInTheDocument()
  })

  it("locks the admin's own row", async () => {
    useUsers()
    renderApp(<App />, { route: '/users', user: admin })
    await screen.findByText('Mia Manager')
    const own = within(screen.getByLabelText('Role for Ada Admin').closest('tr')!)
    expect(own.getByText('(you)')).toBeInTheDocument()
    expect(own.getByLabelText('Role for Ada Admin')).toBeDisabled()
    expect(own.queryByRole('button', { name: /Turn o(ff|n)/ })).not.toBeInTheDocument()
    // other rows are editable
    expect(within(rowFor('Mia Manager')).getByLabelText('Role for Mia Manager')).toBeEnabled()
    expect(within(rowFor('Mia Manager')).getByRole('button', { name: 'Turn off' })).toBeInTheDocument()
  })

  it('creates a user with the form values and refreshes the list', async () => {
    let list = [admin]
    let body: unknown
    server.use(
      http.get('/api/users', () => HttpResponse.json(list)),
      http.post('/api/users', async ({ request }) => {
        body = await request.json()
        const created: User = { id: 'u-new', email: 'new@workshop.test', name: 'Nina New', role: 'MANAGER', isActive: true }
        list = [...list, created]
        return HttpResponse.json(created, { status: 201 })
      }),
    )
    const { user } = renderApp(<App />, { route: '/users', user: admin })
    await screen.findByText(/Ada Admin/)
    await user.type(screen.getByLabelText('Full name'), ' Nina New ')
    await user.type(screen.getByLabelText('Email'), ' new@workshop.test ')
    await user.type(screen.getByLabelText(/Starting password/), 'hunter2hunter2')
    await user.selectOptions(screen.getByLabelText('Role'), 'MANAGER')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Account created for Nina New.')).toBeInTheDocument()
    expect(body).toEqual({ name: 'Nina New', email: 'new@workshop.test', password: 'hunter2hunter2', role: 'MANAGER' })
    expect(await screen.findByLabelText('Role for Nina New')).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveValue('')
    expect(screen.getByLabelText('Role')).toHaveValue('STAFF') // reset to default
  })

  it('defaults new accounts to front desk staff', async () => {
    renderApp(<App />, { route: '/users', user: admin })
    expect(await screen.findByLabelText('Role')).toHaveValue('STAFF')
  })

  it('declares the 8 character minimum on the password field', async () => {
    renderApp(<App />, { route: '/users', user: admin })
    // jsdom does not enforce minLength, so assert the constraint the browser will apply
    expect(await screen.findByLabelText(/Starting password/)).toHaveAttribute('minlength', '8')
  })

  it('shows the API error when the email is already used', async () => {
    server.use(http.post('/api/users', () => HttpResponse.json({ message: 'Email already in use' }, { status: 409 })))
    const { user } = renderApp(<App />, { route: '/users', user: admin })
    await user.type(await screen.findByLabelText('Full name'), 'Dup')
    await user.type(screen.getByLabelText('Email'), 'dup@workshop.test')
    await user.type(screen.getByLabelText(/Starting password/), 'password123')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Email already in use')).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveValue('Dup') // kept for correction
  })

  it('changes a role', async () => {
    useUsers()
    let body: unknown
    server.use(
      http.patch('/api/users/u-staff', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ...staff, role: 'MANAGER' })
      }),
    )
    const { user } = renderApp(<App />, { route: '/users', user: admin })
    await screen.findByText('Sam Staff')
    await user.selectOptions(screen.getByLabelText('Role for Sam Staff'), 'MANAGER')
    expect(await screen.findByText('Sam Staff is now Manager.')).toBeInTheDocument()
    expect(body).toEqual({ role: 'MANAGER' })
  })

  it('turns an account off and back on', async () => {
    useUsers()
    const bodies: unknown[] = []
    server.use(
      http.patch('/api/users/:id', async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(staff)
      }),
    )
    const { user } = renderApp(<App />, { route: '/users', user: admin })
    await screen.findByText('Sam Staff')
    await user.click(within(rowFor('Sam Staff')).getByRole('button', { name: 'Turn off' }))
    expect(await screen.findByText('Sam Staff can no longer sign in.')).toBeInTheDocument()
    await user.click(within(rowFor('Olly Off')).getByRole('button', { name: 'Turn on' }))
    expect(await screen.findByText('Olly Off can sign in again.')).toBeInTheDocument()
    expect(bodies).toEqual([{ isActive: false }, { isActive: true }])
  })

  it('shows a toast when an update is refused', async () => {
    useUsers()
    server.use(http.patch('/api/users/u-staff', () => HttpResponse.json({ message: 'Cannot remove the last admin' }, { status: 409 })))
    const { user } = renderApp(<App />, { route: '/users', user: admin })
    await screen.findByText('Sam Staff')
    await user.click(within(rowFor('Sam Staff')).getByRole('button', { name: 'Turn off' }))
    expect(await screen.findByText('Cannot remove the last admin')).toBeInTheDocument()
  })

  it('resets a password via the dialog (min 8 chars)', async () => {
    useUsers()
    let body: unknown
    server.use(
      http.patch('/api/users/u-staff', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(staff)
      }),
    )
    const { user } = renderApp(<App />, { route: '/users', user: admin })
    await screen.findByText('Sam Staff')
    await user.click(within(rowFor('Sam Staff')).getByRole('button', { name: 'Reset password' }))
    expect(screen.getByRole('heading', { name: 'New password for Sam Staff' })).toBeInTheDocument()

    const save = screen.getByRole('button', { name: 'Save password' })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText(/New password/), 'short')
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText(/New password/), 'er-than-8')
    expect(save).toBeEnabled()
    await user.click(save)

    expect(await screen.findByText('Password changed for Sam Staff.')).toBeInTheDocument()
    expect(body).toEqual({ password: 'shorter-than-8' })
    await waitFor(() => expect(screen.queryByRole('heading', { name: /New password for/ })).not.toBeInTheDocument())
  })

  it('cancelling the reset dialog sends nothing', async () => {
    useUsers()
    let calls = 0
    server.use(http.patch('/api/users/:id', () => { calls++; return HttpResponse.json(staff) }))
    const { user } = renderApp(<App />, { route: '/users', user: admin })
    await screen.findByText('Sam Staff')
    await user.click(within(rowFor('Sam Staff')).getByRole('button', { name: 'Reset password' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: /New password for/ })).not.toBeInTheDocument()
    expect(calls).toBe(0)
  })

  it('shows an error when the list cannot be loaded', async () => {
    server.use(http.get('/api/users', () => HttpResponse.json({ message: 'Forbidden' }, { status: 403 })))
    renderApp(<App />, { route: '/users', user: admin })
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden')
  })
})
