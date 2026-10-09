import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { manager, makeWorkshop, staff } from '../test/fixtures'
import { renderApp } from '../test/render'
import { server } from '../test/server'

function captureWorkshopQueries(items = [makeWorkshop()]) {
  const seen: URLSearchParams[] = []
  server.use(
    http.get('/api/workshops', ({ request }) => {
      seen.push(new URL(request.url).searchParams)
      return HttpResponse.json(items)
    }),
  )
  return { seen, last: () => seen[seen.length - 1] }
}

describe('Workshops page', () => {
  it('renders the workshops returned by the API', async () => {
    server.use(
      http.get('/api/workshops', () =>
        HttpResponse.json([
          makeWorkshop({ id: 'a', code: 'POT-101', title: 'Pottery Basics', seatsLeft: 6, activeCount: 4 }),
          makeWorkshop({ id: 'b', code: 'WEL-200', title: 'Welding', seatsLeft: 0, activeCount: 10, location: 'Lakeside', instructor: 'Omar' }),
          makeWorkshop({ id: 'c', code: 'OLD-1', title: 'Old class', status: 'COMPLETED' }),
        ]),
      ),
    )
    renderApp(<App />, { route: '/workshops', user: staff })
    expect(await screen.findByRole('heading', { name: 'Pottery Basics' })).toBeInTheDocument()
    expect(screen.getByText('6 seats left')).toBeInTheDocument()
    expect(screen.getAllByText('4 of 10 seats taken')).toHaveLength(2)
    expect(screen.getByText('Full')).toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: /Old class/ })).getByText('Finished')).toBeInTheDocument()
    expect(screen.getByText('Lakeside · Omar')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Pottery Basics/ })).toHaveAttribute('href', '/workshops/a')
  })

  it('accepts the { items } envelope', async () => {
    server.use(http.get('/api/workshops', () => HttpResponse.json({ items: [makeWorkshop({ title: 'Enveloped' })] })))
    renderApp(<App />, { route: '/workshops', user: staff })
    expect(await screen.findByRole('heading', { name: 'Enveloped' })).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    server.use(http.get('/api/workshops', () => HttpResponse.json([])))
    renderApp(<App />, { route: '/workshops', user: staff })
    expect(await screen.findByText('No workshops match these filters.')).toBeInTheDocument()
  })

  it('shows an error when loading fails', async () => {
    server.use(http.get('/api/workshops', () => HttpResponse.json({ message: 'Database down' }, { status: 500 })))
    renderApp(<App />, { route: '/workshops', user: staff })
    expect(await screen.findByRole('alert')).toHaveTextContent('Database down')
  })

  it('only managers get the "New workshop" button', async () => {
    const first = renderApp(<App />, { route: '/workshops', user: staff })
    await screen.findByRole('heading', { name: 'Pottery Basics' })
    expect(screen.queryByText('+ New workshop')).not.toBeInTheDocument()
    first.unmount()
    renderApp(<App />, { route: '/workshops', user: manager })
    expect(await screen.findByText('+ New workshop')).toBeInTheDocument()
  })

  describe('filters', () => {
    it('defaults to "This week" with a Monday-start range', async () => {
      const { seen } = captureWorkshopQueries()
      renderApp(<App />, { route: '/workshops', user: staff })
      await screen.findByRole('heading', { name: 'Pottery Basics' })
      const q = seen[0]
      expect(q.get('from')).toBeTruthy()
      expect(q.get('to')).toBeTruthy()
      expect(new Date(q.get('from')!).getDay()).toBe(1)
      expect(q.has('status') || q.has('location') || q.has('q') || q.has('hasSeats')).toBe(false)
    })

    it('"All dates" drops the date range', async () => {
      const { last } = captureWorkshopQueries()
      const { user } = renderApp(<App />, { route: '/workshops', user: staff })
      await screen.findByRole('heading', { name: 'Pottery Basics' })
      await user.click(screen.getByRole('button', { name: 'All dates' }))
      await waitFor(() => expect(last().has('from')).toBe(false))
      expect(last().has('to')).toBe(false)
    })

    it('"Today" sends a one-day range', async () => {
      const { last } = captureWorkshopQueries()
      const { user } = renderApp(<App />, { route: '/workshops', user: staff })
      await screen.findByRole('heading', { name: 'Pottery Basics' })
      await user.click(screen.getByRole('button', { name: 'Today' }))
      await waitFor(() => {
        const diff = +new Date(last().get('to')!) - +new Date(last().get('from')!)
        expect(diff).toBe(24 * 3600 * 1000 - 1)
      })
    })

    it('"Next 7 days" sends a seven-day range', async () => {
      const { last } = captureWorkshopQueries()
      const { user } = renderApp(<App />, { route: '/workshops', user: staff })
      await screen.findByRole('heading', { name: 'Pottery Basics' })
      await user.click(screen.getByRole('button', { name: 'Next 7 days' }))
      await waitFor(() => {
        const diff = +new Date(last().get('to')!) - +new Date(last().get('from')!)
        expect(diff).toBe(7 * 24 * 3600 * 1000)
      })
    })

    it('"Pick dates" reveals date inputs and sends the chosen days', async () => {
      const { last } = captureWorkshopQueries()
      const { user } = renderApp(<App />, { route: '/workshops', user: staff })
      await screen.findByRole('heading', { name: 'Pottery Basics' })
      await user.click(screen.getByRole('button', { name: 'Pick dates' }))
      await user.type(screen.getByLabelText('From'), '2030-06-01')
      await user.type(screen.getByLabelText('To'), '2030-06-03')
      await waitFor(() => {
        expect(new Date(last().get('from')!)).toEqual(new Date(2030, 5, 1, 0, 0, 0, 0))
        expect(new Date(last().get('to')!)).toEqual(new Date(2030, 5, 3, 23, 59, 59, 999))
      })
    })

    it('sends status, location, hasSeats and trimmed q', async () => {
      const { last } = captureWorkshopQueries()
      const { user } = renderApp(<App />, { route: '/workshops', user: staff })
      await screen.findByRole('heading', { name: 'Pottery Basics' })

      await user.selectOptions(screen.getByLabelText('Status'), 'CANCELLED')
      await user.selectOptions(screen.getByLabelText('Location'), 'Lakeside')
      await user.click(screen.getByLabelText('Only with seats left'))
      await user.type(screen.getByLabelText('Search'), ' pot ')

      await waitFor(() => {
        expect(last().get('status')).toBe('CANCELLED')
        expect(last().get('location')).toBe('Lakeside')
        expect(last().get('hasSeats')).toBe('true')
        expect(last().get('q')).toBe('pot')
      })
    })

    it('unchecking "only with seats left" removes hasSeats', async () => {
      const { last } = captureWorkshopQueries()
      const { user } = renderApp(<App />, { route: '/workshops', user: staff })
      await screen.findByRole('heading', { name: 'Pottery Basics' })
      const box = screen.getByLabelText('Only with seats left')
      await user.click(box)
      await waitFor(() => expect(last().get('hasSeats')).toBe('true'))
      await user.click(box)
      await waitFor(() => expect(last().has('hasSeats')).toBe(false))
    })

    it('shows the empty state after filtering everything out', async () => {
      server.use(
        http.get('/api/workshops', ({ request }) =>
          HttpResponse.json(new URL(request.url).searchParams.get('q') === 'zzz' ? [] : [makeWorkshop()]),
        ),
      )
      const { user } = renderApp(<App />, { route: '/workshops', user: staff })
      await screen.findByRole('heading', { name: 'Pottery Basics' })
      await user.type(screen.getByLabelText('Search'), 'zzz')
      expect(await screen.findByText('No workshops match these filters.')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Pottery Basics' })).not.toBeInTheDocument()
    })

    it('lists the known locations', async () => {
      renderApp(<App />, { route: '/workshops', user: staff })
      const select = await screen.findByLabelText('Location')
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All locations', 'Main Campus', 'City Centre', 'Lakeside'])
    })
  })
})

describe('time-based presets', () => {
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it.each(['Next 7 days', 'Today', 'This week'])('does not refetch in a loop with "%s"', async (label) => {
    const { seen } = captureWorkshopQueries()
    const { user } = renderApp(<App />, { route: '/workshops', user: staff })
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    await user.click(screen.getByRole('button', { name: label }))
    await settle(500)
    const settled = seen.length
    await settle(500)
    expect(seen.length).toBe(settled) // no new requests while nothing changed
    expect(settled).toBeLessThanOrEqual(3)
  })
})

describe('filtering experience', () => {
  it('keeps the current list visible, with a spinner, while new filter results load', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let calls = 0
    server.use(
      http.get('/api/workshops', async () => {
        calls += 1
        if (calls > 1) await gate // hold every request after the first
        return HttpResponse.json([makeWorkshop({ title: calls > 1 ? 'Second result' : 'First result' })])
      }),
    )
    const { user } = renderApp(<App />, { route: '/workshops', user: staff })
    expect(await screen.findByRole('heading', { name: 'First result' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(await screen.findByRole('status', { name: 'Updating workshops' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'First result' })).toBeInTheDocument() // not blanked out

    release()
    expect(await screen.findByRole('heading', { name: 'Second result' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Updating workshops' })).not.toBeInTheDocument())
  })

  it('waits for a pause in typing before querying, and shows a spinner meanwhile', async () => {
    const { seen } = captureWorkshopQueries()
    const { user } = renderApp(<App />, { route: '/workshops', user: staff })
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    const before = seen.length

    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'pottery')
    expect(screen.getByRole('status', { name: 'Searching' })).toBeInTheDocument()
    expect(seen.length).toBe(before) // 7 keystrokes, no requests yet

    await waitFor(() => expect(seen[seen.length - 1].get('q')).toBe('pottery'))
    expect(seen.length - before).toBe(1) // one request for the whole word
  })
})
