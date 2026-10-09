import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { timeAgo } from '../lib'
import { makeAudit, manager } from '../test/fixtures'
import { renderApp } from '../test/render'
import { server } from '../test/server'

const entries = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    makeAudit({ id: 100 - i, action: 'registration.created', after: { attendeeName: `Guest ${i}` }, createdAt: new Date(Date.now() - i * 3_600_000).toISOString() }),
  )

const serveAudit = (items = entries(3)) =>
  server.use(http.get('/api/audit', () => HttpResponse.json({ items, total: items.length, page: 1, pageSize: 5 })))

describe('account menu', () => {
  it('closes on Escape and on outside click', async () => {
    const { user } = renderApp(<App />, { route: '/workshops', user: manager })
    await user.click(await screen.findByRole('button', { name: 'Mia' }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Mia' }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    await user.click(screen.getByRole('heading', { name: 'Workshops' }))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('reports its expanded state to assistive tech', async () => {
    const { user } = renderApp(<App />, { route: '/workshops', user: manager })
    const trigger = await screen.findByRole('button', { name: 'Mia' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('notification bell', () => {
  it('badges unseen activity, lists recent entries and clears the badge once opened', async () => {
    serveAudit()
    const { user } = renderApp(<App />, { route: '/workshops', user: manager })
    const bell = await screen.findByRole('button', { name: 'Notifications, 3 new' })
    await user.click(bell)

    const panel = (await screen.findByRole('heading', { name: 'Recent activity' })).parentElement!.parentElement!
    expect(within(panel).getAllByRole('listitem')).toHaveLength(3)
    expect(panel).toHaveTextContent('Guest 0')
    expect(within(panel).getByRole('link', { name: 'View all activity' })).toHaveAttribute('href', '/audit')

    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('only counts entries newer than the last one seen on this device', async () => {
    localStorage.setItem(`workshop_audit_seen_${manager.id}`, '99')
    serveAudit()
    renderApp(<App />, { route: '/workshops', user: manager })
    expect(await screen.findByRole('button', { name: 'Notifications, 1 new' })).toBeInTheDocument()
  })

  it('shows an empty state and navigates to the activity log', async () => {
    serveAudit([])
    const { user } = renderApp(<App />, { route: '/workshops', user: manager })
    await user.click(await screen.findByRole('button', { name: 'Notifications' }))
    expect(await screen.findByText('Nothing has happened yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'View all activity' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/audit'))
  })

  it('shows an error message when activity cannot be loaded', async () => {
    server.use(http.get('/api/audit', () => HttpResponse.json({ statusCode: 500, code: 'X', message: 'boom' }, { status: 500 })))
    const { user } = renderApp(<App />, { route: '/workshops', user: manager })
    await user.click(await screen.findByRole('button', { name: 'Notifications' }))
    expect(await screen.findByText(/Could not load activity/)).toBeInTheDocument()
  })
})

describe('timeAgo', () => {
  const now = new Date('2030-04-01T12:00:00Z').getTime()
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it.each([
    [10_000, 'just now'],
    [5 * 60_000, '5 min ago'],
    [3 * 3_600_000, '3 h ago'],
    [2 * 86_400_000, '2 d ago'],
  ])('%i ms ago -> %s', (ms, label) => {
    expect(timeAgo(ago(ms), now)).toBe(label)
  })

  it('falls back to a date after a week and never goes negative', () => {
    expect(timeAgo(ago(30 * 86_400_000), now)).not.toMatch(/ago|just now/)
    expect(timeAgo(new Date(now + 60_000).toISOString(), now)).toBe('just now')
  })
})
