/* eslint-disable react-refresh/only-export-components */
import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth/AuthContext'
import { ToastProvider } from '../components/Toast'
import { http, HttpResponse } from 'msw'
import { server } from './server'
import type { User } from '../types'

export function LocationDisplay() {
  const l = useLocation()
  return <div data-testid="location">{l.pathname}</div>
}

interface Opts {
  route?: string
  /** Pre-authenticate as this user (msw's GET /api/auth/me returns it). */
  user?: User | null
}

export function renderApp(ui: ReactElement, { route = '/', user }: Opts = {}) {
  if (user) {
    server.use(http.get('/api/auth/me', () => HttpResponse.json(user)))
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  const events = userEvent.setup()
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>
            {ui}
            <LocationDisplay />
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { ...utils, user: events, queryClient }
}
