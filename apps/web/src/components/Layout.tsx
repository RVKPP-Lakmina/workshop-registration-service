import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import type { Role } from '../types'
import { config } from '../config'
import { NotificationBell } from './NotificationBell'
import { UserMenu } from './UserMenu'

const links: { to: string; label: string; roles: Role[] }[] = [
  { to: '/workshops', label: 'Workshops', roles: ['MANAGER', 'STAFF'] },
  { to: '/users', label: 'Users', roles: ['ADMIN'] },
  { to: '/audit', label: 'Activity log', roles: ['ADMIN', 'MANAGER', 'STAFF'] },
]

export function Layout() {
  const { user } = useAuth()
  if (!user) return null
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-linear-to-r from-indigo-950/95 via-indigo-900/95 to-violet-900/95 text-white shadow-lg shadow-indigo-950/20 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-10 w-10 place-items-center rounded-xl bg-linear-to-br from-fuchsia-500 to-indigo-500 shadow-lg shadow-fuchsia-900/30"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
                <path d="m9 16 2 2 4-4" />
              </svg>
            </span>
            <span className="text-xl font-bold tracking-tight">{config.appName}</span>
          </div>

          <nav className="order-last flex w-full gap-1 overflow-x-auto rounded-xl bg-white/5 p-1 sm:order-0 sm:w-auto sm:flex-1 sm:bg-transparent sm:p-0">
            {links
              .filter((l) => l.roles.includes(user.role))
              .map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) =>
                    `rounded-lg px-4 py-2 text-lg font-semibold whitespace-nowrap transition-all duration-200 ${
                      isActive
                        ? 'bg-white text-indigo-900 shadow-md'
                        : 'text-indigo-100 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  {l.label}
                </NavLink>
              ))}
          </nav>

          <div className="ml-auto flex items-center gap-1 sm:ml-0">
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
