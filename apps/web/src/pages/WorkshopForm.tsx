import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, patch, post } from '../api/client'
import { useToast } from '../components/Toast'
import { Button, Card, ErrorBox, Field, Input, Select} from '../components/ui'
import { toLocalInput } from '../lib'
import { LOCATIONS, type Workshop, type WorkshopInput, type WorkshopStatus } from '../types'

interface FormState {
  code: string
  title: string
  description: string
  instructor: string
  location: string
  startsAt: string
  endsAt: string
  capacity: string
  status: WorkshopStatus
}

const empty: FormState = {
  code: '',
  title: '',
  description: '',
  instructor: '',
  location: LOCATIONS[0],
  startsAt: '',
  endsAt: '',
  capacity: '10',
  status: 'SCHEDULED',
}

function Editor({ existing }: { existing?: Workshop }) {
  const nav = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState<FormState>(
    existing
      ? {
          code: existing.code,
          title: existing.title,
          description: existing.description ?? '',
          instructor: existing.instructor,
          location: existing.location,
          startsAt: toLocalInput(existing.startsAt),
          endsAt: toLocalInput(existing.endsAt),
          capacity: String(existing.capacity),
          status: existing.status,
        }
      : empty,
  )
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))

  const save = useMutation({
    mutationFn: () => {
      const body: WorkshopInput = {
        code: f.code.trim(),
        title: f.title.trim(),
        description: f.description.trim() || undefined,
        instructor: f.instructor.trim(),
        location: f.location,
        startsAt: new Date(f.startsAt).toISOString(),
        endsAt: new Date(f.endsAt).toISOString(),
        capacity: Number(f.capacity),
        status: f.status,
      }
      return existing ? patch<Workshop>(`/workshops/${existing.id}`, body) : post<Workshop>('/workshops', body)
    },
    onSuccess: (w) => {
      toast('ok', existing ? 'Workshop saved.' : 'Workshop created.')
      qc.invalidateQueries({ queryKey: ['workshops'] })
      qc.invalidateQueries({ queryKey: ['workshop'] })
      qc.invalidateQueries({ queryKey: ['registrations'] })
      qc.invalidateQueries({ queryKey: ['audit'] })
      nav(`/workshops/${w?.id ?? existing?.id ?? ''}`)
    },
    onError: (e) => toast('err', e.message),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate()
  }

  return (
    <div className="space-y-5">
      <Link to={existing ? `/workshops/${existing.id}` : '/workshops'} className="text-lg font-semibold text-indigo-700 underline">
        &larr; Back
      </Link>
      <h1 className="text-3xl font-bold">{existing ? 'Edit workshop' : 'New workshop'}</h1>
      <Card>
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
          <Field label="Workshop code" hint="Short unique code, e.g. POT-101">
            <Input required value={f.code} onChange={set('code')} />
          </Field>
          <Field label="Title">
            <Input required value={f.title} onChange={set('title')} />
          </Field>
          <Field label="Instructor">
            <Input required value={f.instructor} onChange={set('instructor')} />
          </Field>
          <Field label="Location">
            <Select value={f.location} onChange={set('location')}>
              {LOCATIONS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="Starts">
            <Input type="datetime-local" required value={f.startsAt} onChange={set('startsAt')} />
          </Field>
          <Field label="Ends">
            <Input type="datetime-local" required value={f.endsAt} onChange={set('endsAt')} />
          </Field>
          <Field label="Number of seats" hint={existing ? `${existing.activeCount} already registered` : undefined}>
            <Input type="number" min={1} required value={f.capacity} onChange={set('capacity')} />
          </Field>
          {existing && (
            <Field label="Status">
              <Select value={f.status} onChange={set('status')}>
                <option value="SCHEDULED">Scheduled</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="COMPLETED">Finished</option>
              </Select>
            </Field>
          )}
          <div className="md:col-span-2">
            <Field label="Description (optional)">
              <Input value={f.description} onChange={set('description')} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <ErrorBox error={save.error} />
          </div>
          <div>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving...' : 'Save workshop'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

export default function WorkshopForm() {
  const { id } = useParams()
  const q = useQuery({ queryKey: ['workshop', id], queryFn: () => get<Workshop>(`/workshops/${id}`), enabled: !!id })
  if (!id) return <Editor />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data) return <p className="text-lg">Loading...</p>
  return <Editor key={q.data.id} existing={q.data} />
}
