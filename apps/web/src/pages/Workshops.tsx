import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { asList, get } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Badge, Button, Card, ErrorBox, Input, Select} from '../components/ui'
import { fmtDate, range, type Preset } from '../lib'
import { LOCATIONS, type Workshop } from '../types'

export function SeatsBadge({ w }: { w: Workshop }) {
  if (w.status === 'CANCELLED') return <Badge tone="gray">Cancelled</Badge>
  if (w.status === 'COMPLETED') return <Badge tone="gray">Finished</Badge>
  if (w.seatsLeft <= 0) return <Badge tone="red">Full</Badge>
  return <Badge tone={w.seatsLeft <= 3 ? 'amber' : 'green'}>{w.seatsLeft} seats left</Badge>
}

const presets: { id: Preset; label: string }[] = [
  { id: 'all', label: 'All dates' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'next7', label: 'Next 7 days' },
  { id: 'custom', label: 'Pick dates' },
]

export default function Workshops() {
  const { user } = useAuth()
  const [preset, setPreset] = useState<Preset>('week')
  const [cFrom, setCFrom] = useState('')
  const [cTo, setCTo] = useState('')
  const [status, setStatus] = useState('')
  const [location, setLocation] = useState('')
  const [hasSeats, setHasSeats] = useState(false)
  const [q, setQ] = useState('')

  // Computed once per selection: range() reads the clock, so recomputing it every render would change
  // the query key each time and refetch in a loop.
  const r = useMemo(() => range(preset, cFrom, cTo), [preset, cFrom, cTo])
  const params = { ...r, status, location, q: q.trim(), hasSeats: hasSeats ? true : undefined }

  const { data, error, isLoading } = useQuery({
    queryKey: ['workshops', params],
    queryFn: () => get<Workshop[] | { items: Workshop[] }>('/workshops', params).then(asList),
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Workshops</h1>
        {user?.role === 'MANAGER' && (
          <Link to="/workshops/new">
            <Button>+ New workshop</Button>
          </Link>
        )}
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <Button key={p.id} variant={preset === p.id ? 'primary' : 'secondary'} onClick={() => setPreset(p.id)}>
              {p.label}
            </Button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex flex-wrap gap-3">
            <label className="text-base font-semibold">
              From <Input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} />
            </label>
            <label className="text-base font-semibold">
              To <Input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} />
            </label>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-4">
          <Input placeholder="Search name, code, teacher..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="COMPLETED">Finished</option>
          </Select>
          <Select value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Location">
            <option value="">All locations</option>
            {LOCATIONS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </Select>
          <label className="flex items-center gap-3 text-lg font-semibold">
            <input type="checkbox" className="h-6 w-6" checked={hasSeats} onChange={(e) => setHasSeats(e.target.checked)} />
            Only with seats left
          </label>
        </div>
      </Card>

      <ErrorBox error={error} />
      {isLoading && <p className="text-lg">Loading...</p>}
      {data && data.length === 0 && <p className="text-lg text-slate-600">No workshops match these filters.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {data?.map((w) => (
          <Link key={w.id} to={`/workshops/${w.id}`} className="block">
            <Card className="h-full transition hover:border-indigo-400 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-500">{w.code}</p>
                  <h2 className="text-xl font-bold">{w.title}</h2>
                </div>
                <SeatsBadge w={w} />
              </div>
              <p className="mt-2 text-lg">{fmtDate(w.startsAt)}</p>
              <p className="text-base text-slate-600">
                {w.location} · {w.instructor}
              </p>
              <p className="mt-1 text-base text-slate-600">
                {w.activeCount} of {w.capacity} seats taken
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
