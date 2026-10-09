import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { makeAudit, manager, staff } from '../test/fixtures'
import { renderApp } from '../test/render'
import { server } from '../test/server'

describe('Audit page', () => {
  it('renders who / what / about for each entry', async () => {
    server.use(
      http.get('/api/audit', () =>
        HttpResponse.json({
          items: [
            makeAudit({ id: 1, action: 'workshop.created', after: { title: 'Pottery Basics' } }),
            makeAudit({ id: 2, action: 'registration_cancelled', entityType: 'Registration', entityId: 'r1', after: { attendeeName: 'Alice' }, actor: { id: 'x', name: 'Rita' } }),
            makeAudit({ id: 3, action: 'user.updated', entityType: 'User', entityId: 'u-9', after: null, actor: null, actorId: 'actor-77' }),
          ],
          total: 3,
          page: 1,
          pageSize: 25,
        }),
      ),
    )
    renderApp(<App />, { route: '/audit', user: manager })
    expect(await screen.findByRole('heading', { name: 'Activity log' })).toBeInTheDocument()
    await screen.findByText('Pottery Basics')
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Mia Manager')
    expect(rows[0]).toHaveTextContent('workshop created')
    expect(rows[0]).toHaveTextContent('workshop: Pottery Basics')
    expect(rows[1]).toHaveTextContent('Rita')
    expect(rows[1]).toHaveTextContent('registration cancelled')
    expect(rows[1]).toHaveTextContent('registration: Alice')
    expect(rows[2]).toHaveTextContent('actor-77') // falls back to actorId
    expect(rows[2]).toHaveTextContent('user: u-9') // falls back to entityId
  })

  it('is reachable by every role', async () => {
    renderApp(<App />, { route: '/audit', user: staff })
    expect(await screen.findByRole('heading', { name: 'Activity log' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/audit')
  })

  it('accepts a bare array response', async () => {
    server.use(http.get('/api/audit', () => HttpResponse.json([makeAudit({ after: { code: 'ABC-1' } })])))
    renderApp(<App />, { route: '/audit', user: manager })
    expect(await screen.findByText('ABC-1')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    server.use(http.get('/api/audit', () => HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 25 })))
    renderApp(<App />, { route: '/audit', user: manager })
    expect(await screen.findByText('Nothing to show yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled()
  })

  it('shows an error when loading fails', async () => {
    server.use(http.get('/api/audit', () => HttpResponse.json({ message: 'Audit unavailable' }, { status: 500 })))
    renderApp(<App />, { route: '/audit', user: manager })
    expect(await screen.findByRole('alert')).toHaveTextContent('Audit unavailable')
  })

  it('paginates with 25 per page using the page query param', async () => {
    const seen: string[][] = []
    server.use(
      http.get('/api/audit', ({ request }) => {
        const sp = new URL(request.url).searchParams
        seen.push([sp.get('page')!, sp.get('pageSize')!])
        const page = Number(sp.get('page'))
        return HttpResponse.json({
          items: [makeAudit({ id: page, entityId: `page-${page}`, after: null })],
          total: 60,
          page,
          pageSize: 25,
        })
      }),
    )
    const { user } = renderApp(<App />, { route: '/audit', user: manager })
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByText('workshop:', { exact: false })).toBeInTheDocument()
    const newer = screen.getByRole('button', { name: 'Newer' })
    const older = screen.getByRole('button', { name: 'Older' })
    expect(newer).toBeDisabled()
    expect(older).toBeEnabled()

    await user.click(older)
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument()
    await screen.findByText('page-2', { exact: false })
    await user.click(older)
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Newer' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Newer' }))
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument()
    expect(seen).toContainEqual(['1', '25'])
    expect(seen).toContainEqual(['3', '25'])
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2)
  })
})
