import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, asList, get, post } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Badge, Button, Card, ErrorBox, Field, Input, PageLoader } from '../components/ui'
import { fmtDate } from '../lib'
import { SeatsBadge } from './Workshops'
import type { Registration, Workshop } from '../types'

interface RegInput {
  attendeeName: string
  attendeeEmail: string
  joinWaitlistIfFull?: boolean
}

const regTone = { ACTIVE: 'green', WAITLISTED: 'amber', CANCELLED: 'gray' } as const
const regLabel = { ACTIVE: 'Registered', WAITLISTED: 'Waitlist', CANCELLED: 'Cancelled' } as const

export default function WorkshopDetail() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [askWaitlist, setAskWaitlist] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<Registration | null>(null)
  const [reason, setReason] = useState('')

  const ws = useQuery({ queryKey: ['workshop', id], queryFn: () => get<Workshop>(`/workshops/${id}`) })
  const regs = useQuery({
    queryKey: ['registrations', id],
    queryFn: () => get<Registration[] | { items: Registration[] }>(`/workshops/${id}/registrations`).then(asList),
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['workshop', id] })
    qc.invalidateQueries({ queryKey: ['registrations', id] })
    qc.invalidateQueries({ queryKey: ['workshops'] })
    qc.invalidateQueries({ queryKey: ['audit'] })
  }

  const register = useMutation({
    mutationFn: (b: RegInput) => post<Registration>(`/workshops/${id}/registrations`, b),
    onSuccess: (r) => {
      toast('ok', r.status === 'WAITLISTED' ? `${r.attendeeName} added to the waitlist.` : `${r.attendeeName} is registered.`)
      setName('')
      setEmail('')
      setAskWaitlist(false)
      refresh()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'WORKSHOP_FULL') {
        setAskWaitlist(true)
      } else {
        setAskWaitlist(false)
        toast('err', err.message)
      }
      refresh()
    },
  })

  const cancel = useMutation({
    mutationFn: (r: Registration) => post<Registration>(`/registrations/${r.id}/cancel`, reason.trim() ? { reason: reason.trim() } : {}),
    onSuccess: (_d, r) => {
      toast('ok', `Cancelled ${r.attendeeName}.`)
      setCancelTarget(null)
      setReason('')
      refresh()
    },
    onError: (err) => {
      toast('err', err.message)
      setCancelTarget(null)
      refresh()
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setAskWaitlist(false)
    register.mutate({ attendeeName: name.trim(), attendeeEmail: email.trim() })
  }

  const w = ws.data
  if (ws.error) return <ErrorBox error={ws.error} />
  if (!w) return <PageLoader />

  const all = regs.data ?? []
  const active = all.filter((r) => r.status === 'ACTIVE')
  const waitlist = all.filter((r) => r.status === 'WAITLISTED')
  const history = [...all].sort((a, b) => +new Date(b.registeredAt) - +new Date(a.registeredAt))
  const pct = Math.min(100, Math.round((w.activeCount / w.capacity) * 100))
  const open = w.status === 'SCHEDULED'

  return (
    <div className="space-y-6">
      <Link to="/workshops" className="text-lg font-semibold text-indigo-700 underline">
        &larr; All workshops
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-500">{w.code}</p>
            <h1 className="text-3xl font-bold">{w.title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <SeatsBadge w={w} />
            {user?.role === 'MANAGER' && (
              <Link to={`/workshops/${w.id}/edit`}>
                <Button variant="secondary">Edit</Button>
              </Link>
            )}
          </div>
        </div>
        <p className="mt-2 text-xl">{fmtDate(w.startsAt)} to {fmtDate(w.endsAt)}</p>
        <p className="text-lg text-slate-600">
          {w.location} · Taught by {w.instructor}
        </p>
        {w.description && <p className="mt-2 text-lg">{w.description}</p>}
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-lg font-semibold">
            <span>
              {w.activeCount} of {w.capacity} seats taken
            </span>
            <span>{Math.max(0, w.seatsLeft)} left</span>
          </div>
          <div className="h-5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={w.activeCount} aria-valuemax={w.capacity}>
            <div className={`h-full ${pct >= 100 ? 'bg-red-600' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-600'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-2xl font-bold">Register someone</h2>
        {!open ? (
          <p className="text-lg text-slate-700">This workshop is {w.status === 'CANCELLED' ? 'cancelled' : 'finished'}, so no new registrations can be added.</p>
        ) : (
          <form onSubmit={submit} className="grid gap-3 md:grid-cols-3 md:items-end">
            <Field label="Attendee name">
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Attendee email">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button type="submit" disabled={register.isPending}>
              {register.isPending ? 'Saving...' : w.seatsLeft <= 0 ? 'Try to register' : 'Register'}
            </Button>
          </form>
        )}
        {askWaitlist && (
          <div className="mt-4 rounded-lg border-2 border-amber-400 bg-amber-50 p-4" role="alertdialog">
            <p className="text-xl font-bold">This workshop is full. Add {name || 'them'} to the waitlist?</p>
            <p className="text-lg text-slate-700">They will get the next seat that opens up.</p>
            <div className="mt-3 flex gap-3">
              <Button
                disabled={register.isPending}
                onClick={() => register.mutate({ attendeeName: name.trim(), attendeeEmail: email.trim(), joinWaitlistIfFull: true })}
              >
                Yes, add to waitlist
              </Button>
              <Button variant="secondary" onClick={() => setAskWaitlist(false)}>
                No
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ErrorBox error={regs.error} />

      <Card>
        <h2 className="mb-3 text-2xl font-bold">Registered ({active.length})</h2>
        {active.length === 0 ? <p className="text-lg text-slate-600">Nobody yet.</p> : (
          <ul className="divide-y divide-slate-200">
            {active.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-lg font-semibold">{r.attendeeName}</p>
                  <p className="text-base text-slate-600">{r.attendeeEmail}</p>
                </div>
                <Button variant="danger" onClick={() => setCancelTarget(r)}>
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-2xl font-bold">Waitlist ({waitlist.length})</h2>
        {waitlist.length === 0 ? <p className="text-lg text-slate-600">Nobody waiting.</p> : (
          <ol className="divide-y divide-slate-200">
            {waitlist.map((r, i) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-lg font-semibold">
                    #{i + 1} {r.attendeeName}
                  </p>
                  <p className="text-base text-slate-600">{r.attendeeEmail}</p>
                </div>
                <Button variant="danger" onClick={() => setCancelTarget(r)}>
                  Remove
                </Button>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-2xl font-bold">Full history</h2>
        <p className="mb-3 text-base text-slate-600">Every registration ever made, including cancelled ones.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-base">
            <thead>
              <tr className="border-b-2 border-slate-300">
                <th className="py-2 pr-3">Attendee</th>
                <th className="pr-3">Status</th>
                <th className="pr-3">Registered by / when</th>
                <th>Cancelled by / when</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-b border-slate-200 align-top">
                  <td className="py-2 pr-3">
                    <p className="font-semibold">{r.attendeeName}</p>
                    <p className="text-slate-600">{r.attendeeEmail}</p>
                  </td>
                  <td className="pr-3">
                    <Badge tone={regTone[r.status]}>{regLabel[r.status]}</Badge>
                  </td>
                  <td className="pr-3">
                    {r.registeredBy?.name ?? 'Unknown'}
                    <br />
                    <span className="text-slate-600">{fmtDate(r.registeredAt)}</span>
                    {r.promotedAt && <p className="text-slate-600">Moved off waitlist {fmtDate(r.promotedAt)}</p>}
                  </td>
                  <td>
                    {r.cancelledAt ? (
                      <>
                        {r.cancelledBy?.name ?? 'Unknown'}
                        <br />
                        <span className="text-slate-600">{fmtDate(r.cancelledAt)}</span>
                        {r.cancelReason && <p className="text-slate-600">Reason: {r.cancelReason}</p>}
                      </>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {cancelTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md space-y-4">
            <h2 className="text-2xl font-bold">Cancel {cancelTarget.attendeeName}?</h2>
            <p className="text-lg">This frees the seat. The record stays in the history.</p>
            <Field label="Reason (optional)">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex gap-3">
              <Button variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate(cancelTarget)}>
                Yes, cancel it
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setCancelTarget(null)
                  setReason('')
                }}
              >
                Keep it
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
