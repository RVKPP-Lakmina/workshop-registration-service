import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { manager, makeReg, makeWorkshop, staff } from '../test/fixtures'
import { renderApp } from '../test/render'
import { server } from '../test/server'

const route = '/workshops/w1'

function useWorkshop(w = makeWorkshop(), regs = [makeReg()]) {
  server.use(
    http.get('/api/workshops/w1', () => HttpResponse.json(w)),
    http.get('/api/workshops/w1/registrations', () => HttpResponse.json(regs)),
  )
}

async function fillForm(user: ReturnType<typeof renderApp>['user'], name = 'Bob Buyer', email = 'bob@example.com') {
  await user.type(await screen.findByLabelText('Attendee name'), name)
  await user.type(screen.getByLabelText('Attendee email'), email)
}

describe('WorkshopDetail', () => {
  it('shows workshop info and the capacity bar', async () => {
    useWorkshop(makeWorkshop({ capacity: 10, activeCount: 4, seatsLeft: 6 }))
    renderApp(<App />, { route, user: staff })
    expect(await screen.findByRole('heading', { name: 'Pottery Basics' })).toBeInTheDocument()
    expect(screen.getByText('4 of 10 seats taken')).toBeInTheDocument()
    expect(screen.getByText('6 left')).toBeInTheDocument()
    expect(screen.getByText('Learn to throw a pot.')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '4')
    expect(bar).toHaveAttribute('aria-valuemax', '10')
    expect(bar.firstElementChild).toHaveStyle({ width: '40%' })
    expect(bar.firstElementChild).toHaveClass('bg-emerald-600')
  })

  it.each([
    [8, 10, '80%', 'bg-amber-500'],
    [10, 10, '100%', 'bg-red-600'],
    [12, 10, '100%', 'bg-red-600'], // over-capacity is clamped
  ])('capacity bar at %i/%i is %s wide and %s', async (active, cap, width, colour) => {
    useWorkshop(makeWorkshop({ capacity: cap, activeCount: active, seatsLeft: cap - active }))
    renderApp(<App />, { route, user: staff })
    const bar = await screen.findByRole('progressbar')
    expect(bar.firstElementChild).toHaveStyle({ width })
    expect(bar.firstElementChild).toHaveClass(colour)
  })

  it('never shows negative seats left', async () => {
    useWorkshop(makeWorkshop({ capacity: 10, activeCount: 11, seatsLeft: -1 }))
    renderApp(<App />, { route, user: staff })
    expect(await screen.findByText('0 left')).toBeInTheDocument()
  })

  it('only managers see the Edit button', async () => {
    useWorkshop()
    const a = renderApp(<App />, { route, user: staff })
    await screen.findByRole('heading', { name: 'Pottery Basics' })
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
    a.unmount()
    renderApp(<App />, { route, user: manager })
    expect(await screen.findByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/workshops/w1/edit')
  })

  it('shows an error for an unknown workshop', async () => {
    server.use(http.get('/api/workshops/w1', () => HttpResponse.json({ message: 'Workshop not found' }, { status: 404 })))
    renderApp(<App />, { route, user: staff })
    expect(await screen.findByRole('alert')).toHaveTextContent('Workshop not found')
  })

  describe('registering', () => {
    it('registers an attendee, toasts and clears the form', async () => {
      useWorkshop()
      let body: unknown
      server.use(
        http.post('/api/workshops/w1/registrations', async ({ request }) => {
          body = await request.json()
          return HttpResponse.json(makeReg({ id: 'r2', attendeeName: 'Bob Buyer' }), { status: 201 })
        }),
      )
      const { user } = renderApp(<App />, { route, user: staff })
      await fillForm(user, '  Bob Buyer ', ' bob@example.com ')
      await user.click(screen.getByRole('button', { name: 'Register' }))
      expect(await screen.findByText('Bob Buyer is registered.')).toBeInTheDocument()
      expect(body).toEqual({ attendeeName: 'Bob Buyer', attendeeEmail: 'bob@example.com' })
      expect(screen.getByLabelText('Attendee name')).toHaveValue('')
      expect(screen.getByLabelText('Attendee email')).toHaveValue('')
    })

    it('refreshes the lists after registering', async () => {
      let regs = [makeReg()]
      server.use(
        http.get('/api/workshops/w1', () => HttpResponse.json(makeWorkshop({ activeCount: regs.length, seatsLeft: 10 - regs.length }))),
        http.get('/api/workshops/w1/registrations', () => HttpResponse.json(regs)),
        http.post('/api/workshops/w1/registrations', () => {
          regs = [...regs, makeReg({ id: 'r2', attendeeName: 'Bob Buyer', attendeeEmail: 'bob@example.com' })]
          return HttpResponse.json(regs[1], { status: 201 })
        }),
      )
      const { user } = renderApp(<App />, { route, user: staff })
      await fillForm(user)
      await user.click(screen.getByRole('button', { name: 'Register' }))
      expect(await screen.findByText('Registered (2)')).toBeInTheDocument()
      expect(screen.getByText('2 of 10 seats taken')).toBeInTheDocument()
    })

    it('asks about the waitlist on 409 WORKSHOP_FULL and retries with joinWaitlistIfFull', async () => {
      useWorkshop(makeWorkshop({ capacity: 1, activeCount: 1, seatsLeft: 0 }))
      const bodies: Record<string, unknown>[] = []
      server.use(
        http.post('/api/workshops/w1/registrations', async ({ request }) => {
          const b = (await request.json()) as Record<string, unknown>
          bodies.push(b)
          if (!b.joinWaitlistIfFull) return HttpResponse.json({ code: 'WORKSHOP_FULL', message: 'Workshop is full' }, { status: 409 })
          return HttpResponse.json(makeReg({ id: 'r9', status: 'WAITLISTED', attendeeName: 'Bob Buyer' }), { status: 201 })
        }),
      )
      const { user } = renderApp(<App />, { route, user: staff })
      await fillForm(user)
      await user.click(screen.getByRole('button', { name: 'Try to register' }))

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent('This workshop is full. Add Bob Buyer to the waitlist?')
      expect(screen.queryByText('Workshop is full')).not.toBeInTheDocument() // no error toast, just the prompt
      expect(bodies).toEqual([{ attendeeName: 'Bob Buyer', attendeeEmail: 'bob@example.com' }])

      await user.click(within(dialog).getByRole('button', { name: 'Yes, add to waitlist' }))
      expect(await screen.findByText('Bob Buyer added to the waitlist.')).toBeInTheDocument()
      expect(bodies[1]).toEqual({ attendeeName: 'Bob Buyer', attendeeEmail: 'bob@example.com', joinWaitlistIfFull: true })
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('declining the waitlist prompt sends nothing more', async () => {
      useWorkshop(makeWorkshop({ capacity: 1, activeCount: 1, seatsLeft: 0 }))
      let calls = 0
      server.use(
        http.post('/api/workshops/w1/registrations', () => {
          calls++
          return HttpResponse.json({ code: 'WORKSHOP_FULL', message: 'full' }, { status: 409 })
        }),
      )
      const { user } = renderApp(<App />, { route, user: staff })
      await fillForm(user)
      await user.click(screen.getByRole('button', { name: 'Try to register' }))
      await user.click(await screen.findByRole('button', { name: 'No' }))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(calls).toBe(1)
    })

    it('shows the duplicate-email error as a toast without the waitlist prompt', async () => {
      useWorkshop()
      server.use(
        http.post('/api/workshops/w1/registrations', () =>
          HttpResponse.json({ code: 'ALREADY_REGISTERED', message: 'bob@example.com is already registered for this workshop' }, { status: 409 }),
        ),
      )
      const { user } = renderApp(<App />, { route, user: staff })
      await fillForm(user)
      await user.click(screen.getByRole('button', { name: 'Register' }))
      expect(await screen.findByText('bob@example.com is already registered for this workshop')).toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      // the form keeps what was typed so it can be corrected
      expect(screen.getByLabelText('Attendee name')).toHaveValue('Bob Buyer')
    })

    it('joins array validation messages in the error toast', async () => {
      useWorkshop()
      server.use(http.post('/api/workshops/w1/registrations', () => HttpResponse.json({ message: ['attendeeEmail must be an email'] }, { status: 400 })))
      const { user } = renderApp(<App />, { route, user: staff })
      await fillForm(user)
      await user.click(screen.getByRole('button', { name: 'Register' }))
      expect(await screen.findByText('attendeeEmail must be an email')).toBeInTheDocument()
    })

    it.each([
      ['CANCELLED', 'cancelled'],
      ['COMPLETED', 'finished'],
    ] as const)('hides the form for %s workshops', async (status, word) => {
      useWorkshop(makeWorkshop({ status }))
      renderApp(<App />, { route, user: staff })
      expect(await screen.findByText(new RegExp(`This workshop is ${word}`))).toBeInTheDocument()
      expect(screen.queryByLabelText('Attendee name')).not.toBeInTheDocument()
    })
  })

  describe('lists', () => {
    const regs = [
      makeReg({ id: 'a', attendeeName: 'Alice', attendeeEmail: 'alice@x.com', status: 'ACTIVE' }),
      makeReg({ id: 'w1r', attendeeName: 'Wally', attendeeEmail: 'wally@x.com', status: 'WAITLISTED', registeredAt: '2030-04-02T09:00:00.000Z' }),
      makeReg({ id: 'w2r', attendeeName: 'Wendy', attendeeEmail: 'wendy@x.com', status: 'WAITLISTED', registeredAt: '2030-04-03T09:00:00.000Z' }),
    ]

    it('splits active and waitlisted people with queue positions', async () => {
      useWorkshop(makeWorkshop(), regs)
      renderApp(<App />, { route, user: staff })
      expect(await screen.findByText('Registered (1)')).toBeInTheDocument()
      expect(screen.getByText('Waitlist (2)')).toBeInTheDocument()
      expect(screen.getByText('#1 Wally')).toBeInTheDocument()
      expect(screen.getByText('#2 Wendy')).toBeInTheDocument()
    })

    it('shows empty-state text', async () => {
      useWorkshop(makeWorkshop(), [])
      renderApp(<App />, { route, user: staff })
      expect(await screen.findByText('Nobody yet.')).toBeInTheDocument()
      expect(screen.getByText('Nobody waiting.')).toBeInTheDocument()
    })
  })

  describe('cancelling', () => {
    it('asks for confirmation, sends the trimmed reason and refreshes', async () => {
      let regs = [makeReg({ id: 'r1', attendeeName: 'Alice Attendee' })]
      let body: unknown
      server.use(
        http.get('/api/workshops/w1', () => HttpResponse.json(makeWorkshop())),
        http.get('/api/workshops/w1/registrations', () => HttpResponse.json(regs)),
        http.post('/api/registrations/r1/cancel', async ({ request }) => {
          body = await request.json()
          regs = [{ ...regs[0], status: 'CANCELLED', cancelledAt: '2030-04-05T10:00:00.000Z', cancelledBy: { id: staff.id, name: staff.name }, cancelReason: 'Sick' }]
          return HttpResponse.json(regs[0])
        }),
      )
      const { user } = renderApp(<App />, { route, user: staff })
      await screen.findByText('Registered (1)')
      const list = screen.getByText('Registered (1)').closest('div')!
      await user.click(within(list).getByRole('button', { name: 'Cancel' }))

      expect(screen.getByRole('heading', { name: 'Cancel Alice Attendee?' })).toBeInTheDocument()
      await user.type(screen.getByLabelText('Reason (optional)'), '  Sick ')
      await user.click(screen.getByRole('button', { name: 'Yes, cancel it' }))

      expect(await screen.findByText('Cancelled Alice Attendee.')).toBeInTheDocument()
      expect(body).toEqual({ reason: 'Sick' })
      expect(screen.queryByRole('heading', { name: 'Cancel Alice Attendee?' })).not.toBeInTheDocument()
      expect(await screen.findByText('Registered (0)')).toBeInTheDocument()
      expect(screen.getByText('Reason: Sick')).toBeInTheDocument()
    })

    it('sends an empty body when no reason is given', async () => {
      useWorkshop()
      let body: unknown
      server.use(
        http.post('/api/registrations/r1/cancel', async ({ request }) => {
          body = await request.json()
          return HttpResponse.json(makeReg({ status: 'CANCELLED' }))
        }),
      )
      const { user } = renderApp(<App />, { route, user: staff })
      await user.click(await screen.findByRole('button', { name: 'Cancel' }))
      await user.click(screen.getByRole('button', { name: 'Yes, cancel it' }))
      await screen.findByText('Cancelled Alice Attendee.')
      expect(body).toEqual({})
    })

    it('"Keep it" closes the dialog without calling the API and forgets the reason', async () => {
      useWorkshop()
      let calls = 0
      server.use(http.post('/api/registrations/r1/cancel', () => { calls++; return HttpResponse.json(makeReg()) }))
      const { user } = renderApp(<App />, { route, user: staff })
      await user.click(await screen.findByRole('button', { name: 'Cancel' }))
      await user.type(screen.getByLabelText('Reason (optional)'), 'oops')
      await user.click(screen.getByRole('button', { name: 'Keep it' }))
      expect(screen.queryByRole('heading', { name: /Cancel Alice/ })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.getByLabelText('Reason (optional)')).toHaveValue('')
      expect(calls).toBe(0)
    })

    it('surfaces cancel failures and closes the dialog', async () => {
      useWorkshop()
      server.use(http.post('/api/registrations/r1/cancel', () => HttpResponse.json({ message: 'Already cancelled' }, { status: 409 })))
      const { user } = renderApp(<App />, { route, user: staff })
      await user.click(await screen.findByRole('button', { name: 'Cancel' }))
      await user.click(screen.getByRole('button', { name: 'Yes, cancel it' }))
      expect(await screen.findByText('Already cancelled')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /Cancel Alice/ })).not.toBeInTheDocument()
    })

    it('waitlisted people are removed via "Remove"', async () => {
      useWorkshop(makeWorkshop(), [makeReg({ id: 'q1', attendeeName: 'Wally', status: 'WAITLISTED' })])
      const { user } = renderApp(<App />, { route, user: staff })
      await user.click(await screen.findByRole('button', { name: 'Remove' }))
      expect(screen.getByRole('heading', { name: 'Cancel Wally?' })).toBeInTheDocument()
    })
  })

  describe('history', () => {
    it('shows who and when for registration, promotion and cancellation, newest first', async () => {
      useWorkshop(makeWorkshop(), [
        makeReg({ id: 'old', attendeeName: 'Older Person', registeredAt: '2030-03-01T09:00:00.000Z', registeredBy: { id: 'x', name: 'Rita Receptionist' } }),
        makeReg({
          id: 'new',
          attendeeName: 'Newer Person',
          status: 'CANCELLED',
          registeredAt: '2030-04-10T09:00:00.000Z',
          registeredBy: null,
          promotedAt: '2030-04-11T09:00:00.000Z',
          cancelledAt: '2030-04-12T09:00:00.000Z',
          cancelledBy: { id: 'm', name: 'Mia Manager' },
          cancelReason: 'Changed plans',
        }),
      ])
      renderApp(<App />, { route, user: staff })
      const table = await screen.findByRole('table')
      const rows = within(table).getAllByRole('row').slice(1)
      expect(rows).toHaveLength(2)

      expect(rows[0]).toHaveTextContent('Newer Person')
      expect(rows[0]).toHaveTextContent('Unknown') // registeredBy null
      expect(rows[0]).toHaveTextContent('Moved off waitlist')
      expect(rows[0]).toHaveTextContent('Mia Manager')
      expect(rows[0]).toHaveTextContent('Reason: Changed plans')
      expect(within(rows[0]).getByText('Cancelled')).toBeInTheDocument()

      expect(rows[1]).toHaveTextContent('Older Person')
      expect(rows[1]).toHaveTextContent('Rita Receptionist')
      expect(rows[1]).toHaveTextContent('Registered')
      expect(within(rows[1]).getAllByText('-')).toHaveLength(1)
    })
  })

  it('does not break when the registrations request fails', async () => {
    server.use(
      http.get('/api/workshops/w1', () => HttpResponse.json(makeWorkshop())),
      http.get('/api/workshops/w1/registrations', () => HttpResponse.json({ message: 'Registrations unavailable' }, { status: 403 })),
    )
    renderApp(<App />, { route, user: staff })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Registrations unavailable'))
    expect(screen.getByRole('heading', { name: 'Pottery Basics' })).toBeInTheDocument()
  })
})
