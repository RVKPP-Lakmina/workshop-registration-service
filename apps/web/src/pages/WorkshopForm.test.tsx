import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { manager, makeWorkshop } from '../test/fixtures'
import { renderApp } from '../test/render'
import { server } from '../test/server'

type U = ReturnType<typeof renderApp>['user']

function setDates(start: string, end: string) {
  fireEvent.change(screen.getByLabelText('Starts'), { target: { value: start } })
  fireEvent.change(screen.getByLabelText('Ends'), { target: { value: end } })
}

async function fillRequired(user: U) {
  await user.type(screen.getByLabelText(/Workshop code/), '  KNT-1 ')
  await user.type(screen.getByLabelText('Title'), ' Knitting ')
  await user.type(screen.getByLabelText('Instructor'), 'Kari')
  setDates('2030-07-01T10:00', '2030-07-01T12:30')
}

describe('WorkshopForm (create)', () => {
  it('renders defaults', async () => {
    renderApp(<App />, { route: '/workshops/new', user: manager })
    expect(await screen.findByRole('heading', { name: 'New workshop' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Number of seats/)).toHaveValue(10)
    expect(screen.getByLabelText('Location')).toHaveValue('Main Campus')
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
  })

  it('does not submit when required fields are missing', async () => {
    let calls = 0
    server.use(http.post('/api/workshops', () => { calls++; return HttpResponse.json(makeWorkshop(), { status: 201 }) }))
    const { user } = renderApp(<App />, { route: '/workshops/new', user: manager })
    await screen.findByRole('heading', { name: 'New workshop' })
    await user.click(screen.getByRole('button', { name: 'Save workshop' }))
    expect(calls).toBe(0)
    expect(screen.getByLabelText(/Workshop code/)).toBeInvalid()
    expect(screen.getByLabelText('Title')).toBeInvalid()
    expect(screen.getByLabelText('Starts')).toBeInvalid()
  })

  it('rejects a capacity below 1', async () => {
    const { user } = renderApp(<App />, { route: '/workshops/new', user: manager })
    await screen.findByRole('heading', { name: 'New workshop' })
    await fillRequired(user)
    const cap = screen.getByLabelText(/Number of seats/)
    await user.clear(cap)
    await user.type(cap, '0')
    expect(cap).toBeInvalid()
  })

  it('posts a normalised payload and goes to the new workshop', async () => {
    let body: Record<string, unknown> = {}
    server.use(
      http.post('/api/workshops', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(makeWorkshop({ id: 'new-1', title: 'Knitting' }), { status: 201 })
      }),
      http.get('/api/workshops/new-1', () => HttpResponse.json(makeWorkshop({ id: 'new-1', title: 'Knitting' }))),
      http.get('/api/workshops/new-1/registrations', () => HttpResponse.json([])),
    )
    const { user } = renderApp(<App />, { route: '/workshops/new', user: manager })
    await screen.findByRole('heading', { name: 'New workshop' })
    await fillRequired(user)
    await user.selectOptions(screen.getByLabelText('Location'), 'Lakeside')
    const cap = screen.getByLabelText(/Number of seats/)
    await user.clear(cap)
    await user.type(cap, '12')
    await user.click(screen.getByRole('button', { name: 'Save workshop' }))

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/workshops/new-1'))
    expect(body).toEqual({
      code: 'KNT-1',
      title: 'Knitting',
      instructor: 'Kari',
      location: 'Lakeside',
      startsAt: new Date(2030, 6, 1, 10, 0).toISOString(),
      endsAt: new Date(2030, 6, 1, 12, 30).toISOString(),
      capacity: 12,
      status: 'SCHEDULED',
    })
    expect(await screen.findByText('Workshop created.')).toBeInTheDocument()
  })

  it('includes a trimmed description when given', async () => {
    let body: Record<string, unknown> = {}
    server.use(
      http.post('/api/workshops', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(makeWorkshop({ id: 'new-1' }), { status: 201 })
      }),
    )
    const { user } = renderApp(<App />, { route: '/workshops/new', user: manager })
    await screen.findByRole('heading', { name: 'New workshop' })
    await fillRequired(user)
    await user.type(screen.getByLabelText('Description (optional)'), '  Bring wool ')
    await user.click(screen.getByRole('button', { name: 'Save workshop' }))
    await waitFor(() => expect(body.description).toBe('Bring wool'))
  })

  it('shows the API error (e.g. duplicate code) and stays on the form', async () => {
    server.use(http.post('/api/workshops', () => HttpResponse.json({ code: 'CODE_TAKEN', message: 'A workshop with code KNT-1 already exists' }, { status: 409 })))
    const { user } = renderApp(<App />, { route: '/workshops/new', user: manager })
    await screen.findByRole('heading', { name: 'New workshop' })
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Save workshop' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A workshop with code KNT-1 already exists')
    expect(screen.getByTestId('location')).toHaveTextContent('/workshops/new')
    expect(screen.getByRole('button', { name: 'Save workshop' })).toBeEnabled()
  })
})

describe('WorkshopForm (edit)', () => {
  const existing = makeWorkshop({
    id: 'w1',
    description: 'Old text',
    startsAt: new Date(2030, 4, 1, 10, 0).toISOString(),
    endsAt: new Date(2030, 4, 1, 12, 0).toISOString(),
    capacity: 8,
    activeCount: 5,
    seatsLeft: 3,
  })

  it('pre-fills the form from the workshop', async () => {
    server.use(http.get('/api/workshops/w1', () => HttpResponse.json(existing)))
    renderApp(<App />, { route: '/workshops/w1/edit', user: manager })
    expect(await screen.findByRole('heading', { name: 'Edit workshop' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Workshop code/)).toHaveValue('POT-101')
    expect(screen.getByLabelText('Title')).toHaveValue('Pottery Basics')
    expect(screen.getByLabelText('Starts')).toHaveValue('2030-05-01T10:00')
    expect(screen.getByLabelText('Ends')).toHaveValue('2030-05-01T12:00')
    expect(screen.getByLabelText(/Number of seats/)).toHaveValue(8)
    expect(screen.getByText('5 already registered')).toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toHaveValue('SCHEDULED')
    expect(screen.getByRole('link', { name: /Back/ })).toHaveAttribute('href', '/workshops/w1')
  })

  it('PATCHes the edited payload, including a status change', async () => {
    let body: Record<string, unknown> = {}
    let method = ''
    server.use(
      http.get('/api/workshops/w1', () => HttpResponse.json(existing)),
      http.get('/api/workshops/w1/registrations', () => HttpResponse.json([])),
      http.patch('/api/workshops/w1', async ({ request }) => {
        method = request.method
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(existing)
      }),
    )
    const { user } = renderApp(<App />, { route: '/workshops/w1/edit', user: manager })
    const title = await screen.findByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'Advanced Pottery')
    const cap = screen.getByLabelText(/Number of seats/)
    await user.clear(cap)
    await user.type(cap, '20')
    await user.selectOptions(screen.getByLabelText('Status'), 'CANCELLED')
    await user.click(screen.getByRole('button', { name: 'Save workshop' }))

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/workshops\/w1$/))
    expect(method).toBe('PATCH')
    expect(body).toMatchObject({
      code: 'POT-101',
      title: 'Advanced Pottery',
      description: 'Old text',
      capacity: 20,
      status: 'CANCELLED',
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
    })
    expect(await screen.findByText('Workshop saved.')).toBeInTheDocument()
  })

  it('surfaces API errors such as capacity below current registrations', async () => {
    server.use(
      http.get('/api/workshops/w1', () => HttpResponse.json(existing)),
      http.patch('/api/workshops/w1', () => HttpResponse.json({ message: ['capacity cannot be lower than 5 active registrations'] }, { status: 400 })),
    )
    const { user } = renderApp(<App />, { route: '/workshops/w1/edit', user: manager })
    await screen.findByLabelText('Title')
    await user.click(screen.getByRole('button', { name: 'Save workshop' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('capacity cannot be lower than 5 active registrations')
  })

  it('shows an error when the workshop cannot be loaded', async () => {
    server.use(http.get('/api/workshops/w1', () => HttpResponse.json({ message: 'Workshop not found' }, { status: 404 })))
    renderApp(<App />, { route: '/workshops/w1/edit', user: manager })
    expect(await screen.findByRole('alert')).toHaveTextContent('Workshop not found')
  })
})
