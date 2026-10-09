import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '../api/client'
import { Button, Card, ErrorBox, PageLoader } from '../components/ui'
import { auditSummary, fmtDate } from '../lib'
import type { AuditEntry, Paged } from '../types'

const PAGE_SIZE = 25

export default function Audit() {
  const [page, setPage] = useState(1)
  const { data, error, isLoading } = useQuery({
    queryKey: ['audit', page],
    queryFn: () => get<Paged<AuditEntry> | AuditEntry[]>('/audit', { page, pageSize: PAGE_SIZE }),
  })

  const items = Array.isArray(data) ? data : (data?.items ?? [])
  const total = Array.isArray(data) ? items.length : (data?.total ?? items.length)
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold">Activity log</h1>
      <p className="text-lg text-slate-600">Who changed what, and when.</p>
      <ErrorBox error={error} />
      {isLoading && <PageLoader />}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-base">
            <thead>
              <tr className="border-b-2 border-slate-300">
                <th className="py-2 pr-3">When</th>
                <th className="pr-3">Who</th>
                <th className="pr-3">What</th>
                <th>About</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={String(e.id)} className="border-b border-slate-200">
                  <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(e.createdAt)}</td>
                  <td className="pr-3">{e.actor?.name ?? e.actorId ?? 'Unknown'}</td>
                  <td className="pr-3 font-semibold">{e.action.replace(/[._]/g, ' ').toLowerCase()}</td>
                  <td>
                    <span className="text-slate-500">{e.entityType.toLowerCase()}: </span>
                    {auditSummary(e)}
                  </td>
                </tr>
              ))}
              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-lg text-slate-600">
                    Nothing to show yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="flex items-center gap-3">
        <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Newer
        </Button>
        <span className="text-lg">
          Page {page} of {pages}
        </span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Older
        </Button>
      </div>
    </div>
  )
}
