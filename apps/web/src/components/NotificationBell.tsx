import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { asList, get } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { auditSummary, timeAgo } from '../lib'
import type { AuditEntry, Paged } from '../types'
import { useDismiss } from './useDismiss'

const RECENT = 5

function readSeen(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeSeen(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: the badge just reappears next visit */
  }
}

/** Bell showing the latest activity-log entries; the badge counts those not yet seen on this device. */
export function NotificationBell() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(wrapper, open, close)

  const seenKey = `workshop_audit_seen_${user?.id ?? 'anon'}`
  const [seen, setSeen] = useState<string | null>(() => readSeen(seenKey))

  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: () => get<Paged<AuditEntry> | AuditEntry[]>('/audit', { page: 1, pageSize: RECENT }),
    enabled: !!user,
    refetchInterval: 30_000,
  })
  const items = data ? asList<AuditEntry>(data).slice(0, RECENT) : []

  const seenAt = seen === null ? -1 : items.findIndex((e) => String(e.id) === seen)
  const unseen = seenAt === -1 ? items.length : seenAt

  const toggle = () => {
    if (!open && items[0]) {
      const latest = String(items[0].id)
      setSeen(latest)
      writeSeen(seenKey, latest)
    }
    setOpen((v) => !v)
  }

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unseen > 0 && !open ? `Notifications, ${unseen} new` : 'Notifications'}
        onClick={toggle}
        className="group relative grid h-11 w-11 place-items-center rounded-full text-indigo-100 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-bell-hover h-6 w-6 origin-top"
        >
          <path d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
        {unseen > 0 && !open && (
          <span aria-hidden="true" className="absolute top-1 right-1 grid h-5 min-w-5 place-items-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fuchsia-400 opacity-60" />
            <span className="relative grid h-5 min-w-5 place-items-center rounded-full bg-fuchsia-500 px-1 text-xs font-bold text-white ring-2 ring-indigo-900">
              {unseen}
            </span>
          </span>
        )}
      </button>

      {open && (
        <div className="animate-menu-in absolute right-0 z-50 mt-3 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl ring-1 shadow-indigo-950/30 ring-black/5">
          <div className="flex items-center justify-between border-b border-slate-100 bg-linear-to-br from-indigo-50 to-violet-50 px-4 py-3">
            <h2 className="text-lg font-bold">Recent activity</h2>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
              latest {RECENT}
            </span>
          </div>

          {isLoading && (
            <ul aria-label="Loading activity" className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex animate-pulse items-center gap-3">
                  <span className="h-9 w-9 rounded-full bg-slate-200" />
                  <span className="flex-1 space-y-2">
                    <span className="block h-3 w-3/4 rounded bg-slate-200" />
                    <span className="block h-3 w-1/3 rounded bg-slate-200" />
                  </span>
                </li>
              ))}
            </ul>
          )}

          {!isLoading && error && <p className="p-4 text-base text-red-700">Could not load activity. Try again shortly.</p>}

          {!isLoading && !error && items.length === 0 && <p className="p-6 text-center text-base text-slate-600">Nothing has happened yet.</p>}

          {items.length > 0 && (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {items.map((e, i) => (
                <li
                  key={String(e.id)}
                  style={{ animationDelay: `${i * 45}ms` }}
                  className="animate-item-in flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700"
                  >
                    {(e.actor?.name ?? '?').charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-base leading-snug">
                      <span className="font-semibold">{e.actor?.name ?? 'Someone'}</span>{' '}
                      <span className="text-slate-600">{e.action.replace(/[._]/g, ' ').toLowerCase()}</span>
                    </p>
                    <p className="truncate text-sm text-slate-500">
                      {e.entityType.toLowerCase()}: {auditSummary(e)}
                    </p>
                  </div>
                  <time dateTime={e.createdAt} className="shrink-0 pt-0.5 text-xs font-medium text-slate-500">
                    {timeAgo(e.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}

          <Link
            to="/audit"
            onClick={close}
            className="block border-t border-slate-100 px-4 py-3 text-center text-base font-semibold text-indigo-700 transition hover:bg-indigo-50"
          >
            View all activity
          </Link>
        </div>
      )}
    </div>
  )
}
