import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import type { Role } from '../types'
import { config } from '../config'

const links: { to: string; label: string; roles: Role[] }[] = [
  { to: '/workshops', label: 'Workshops', roles: ['MANAGER', 'STAFF'] },
  { to: '/users', label: 'Users', roles: ['ADMIN'] },
  { to: '/audit', label: 'Activity log', roles: ['ADMIN', 'MANAGER', 'STAFF'] },
]

export function Layout() {
  const { user, logout } = useAuth()
  if (!user) return null
  return (
    <div className="min-h-screen">
      <header className="bg-indigo-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="text-xl font-bold">{config.appName}</span>
          <nav className="flex flex-1 gap-2">
            {links
              .filter((l) => l.roles.includes(user.role))
              .map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) =>
                    `rounded-lg px-4 py-2 text-lg font-semibold ${isActive ? 'bg-white text-indigo-900' : 'hover:bg-indigo-800'}`
                  }
                >
                  {l.label}
                </NavLink>
              ))}
          </nav>
          <span className="text-base">
            {user.name} ({user.role.toLowerCase()})
          </span>
          <button onClick={logout} className="rounded-lg border border-white/50 px-4 py-2 text-lg font-semibold hover:bg-indigo-800">
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
