import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import type { Role } from '../types'
import { useDismiss } from './useDismiss'

const roleStyle: Record<Role, string> = {
  ADMIN: 'bg-violet-100 text-violet-800',
  MANAGER: 'bg-indigo-100 text-indigo-800',
  STAFF: 'bg-emerald-100 text-emerald-800',
}

export function UserMenu() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const logoutBtn = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(wrapper, open, close)

  useEffect(() => {
    if (open) logoutBtn.current?.focus()
  }, [open])

  if (!user) return null
  const firstName = user.name.trim().split(/\s+/)[0] || user.name

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') trigger.current?.blur()
        }}
        className="group flex items-center gap-2.5 rounded-full py-1 pr-3 pl-1 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <span
          aria-hidden="true"
          className="grid h-10 w-10 place-items-center rounded-full bg-linear-to-br from-fuchsia-400 via-violet-400 to-indigo-400 text-lg font-bold text-white shadow-md ring-2 ring-white/30 transition group-hover:scale-105"
        >
          {firstName.charAt(0).toUpperCase()}
        </span>
        <span className="hidden max-w-32 truncate text-lg font-semibold sm:block">{firstName}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-5 w-5 text-indigo-200 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path
            fillRule="evenodd"
            d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="animate-menu-in absolute right-0 z-50 mt-3 w-72 overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl ring-1 shadow-indigo-950/30 ring-black/5"
        >
          <div className="flex items-center gap-3 bg-linear-to-br from-indigo-50 to-violet-50 px-4 py-4">
            <span
              aria-hidden="true"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-linear-to-br from-fuchsia-400 via-violet-400 to-indigo-400 text-xl font-bold text-white"
            >
              {firstName.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold">{user.name}</p>
              <p className="truncate text-sm text-slate-600">{user.email}</p>
              <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide ${roleStyle[user.role]}`}>
                {user.role}
              </span>
            </div>
          </div>
          <div className="p-2">
            <button
              ref={logoutBtn}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                logout()
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-lg font-semibold text-red-700 transition hover:bg-red-50 focus:bg-red-50 focus:outline-none"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path
                  fillRule="evenodd"
                  d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z"
                  clipRule="evenodd"
                />
                <path
                  fillRule="evenodd"
                  d="M19 10a.75.75 0 0 0-.75-.75H8.704l1.048-.943a.75.75 0 1 0-1.004-1.114l-2.5 2.25a.75.75 0 0 0 0 1.114l2.5 2.25a.75.75 0 1 0 1.004-1.114l-1.048-.943h9.546A.75.75 0 0 0 19 10Z"
                  clipRule="evenodd"
                />
              </svg>
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
