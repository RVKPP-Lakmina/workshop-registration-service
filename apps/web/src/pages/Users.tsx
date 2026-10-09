import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { asList, get, patch, post } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Badge, Button, Card, ErrorBox, Field, Input, Select } from '../components/ui'
import type { Role, User } from '../types'

const roleLabel: Record<Role, string> = { ADMIN: 'Admin', MANAGER: 'Manager', STAFF: 'Front desk staff' }

export default function Users() {
  const { user: me } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'STAFF' as Role })
  const [resetFor, setResetFor] = useState<User | null>(null)
  const [newPw, setNewPw] = useState('')

  const users = useQuery({ queryKey: ['users'], queryFn: () => get<User[] | { items: User[] }>('/users').then(asList) })
  const done = (msg: string) => {
    toast('ok', msg)
    qc.invalidateQueries({ queryKey: ['users'] })
    qc.invalidateQueries({ queryKey: ['audit'] })
  }

  const create = useMutation({
    mutationFn: () => post<User>('/users', { ...form, email: form.email.trim(), name: form.name.trim() }),
    onSuccess: (u) => {
      done(`Account created for ${u?.name ?? form.name}.`)
      setForm({ name: '', email: '', password: '', role: 'STAFF' })
    },
    onError: (e) => toast('err', e.message),
  })

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: Role; isActive?: boolean; password?: string; msg: string }) => {
      const { msg, ...rest } = body
      void msg
      return patch<User>(`/users/${id}`, rest)
    },
    onSuccess: (_d, v) => {
      done(v.msg)
      if (v.password) {
        setResetFor(null)
        setNewPw('')
      }
    },
    onError: (e) => toast('err', e.message),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Staff accounts</h1>

      <Card>
        <h2 className="mb-3 text-2xl font-bold">Add a person</h2>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
          <Field label="Full name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Starting password" hint="At least 8 characters">
            <Input type="text" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {(Object.keys(roleLabel) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {roleLabel[r]}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Saving...' : 'Create account'}
            </Button>
          </div>
        </form>
      </Card>

      <ErrorBox error={users.error} />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-lg">
            <thead>
              <tr className="border-b-2 border-slate-300">
                <th className="py-2 pr-3">Person</th>
                <th className="pr-3">Role</th>
                <th className="pr-3">Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.map((u) => {
                const self = u.id === me?.id
                return (
                  <tr key={u.id} className="border-b border-slate-200 align-middle">
                    <td className="py-3 pr-3">
                      <p className="font-semibold">
                        {u.name} {self && <span className="text-slate-500">(you)</span>}
                      </p>
                      <p className="text-base text-slate-600">{u.email}</p>
                    </td>
                    <td className="pr-3">
                      <Select
                        value={u.role}
                        disabled={self || update.isPending}
                        aria-label={`Role for ${u.name}`}
                        onChange={(e) => update.mutate({ id: u.id, role: e.target.value as Role, msg: `${u.name} is now ${roleLabel[e.target.value as Role]}.` })}
                      >
                        {(Object.keys(roleLabel) as Role[]).map((r) => (
                          <option key={r} value={r}>
                            {roleLabel[r]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="pr-3">
                      <Badge tone={u.isActive ? 'green' : 'gray'}>{u.isActive ? 'Active' : 'Turned off'}</Badge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {!self && (
                          <Button
                            variant="secondary"
                            disabled={update.isPending}
                            onClick={() =>
                              update.mutate({ id: u.id, isActive: !u.isActive, msg: u.isActive ? `${u.name} can no longer sign in.` : `${u.name} can sign in again.` })
                            }
                          >
                            {u.isActive ? 'Turn off' : 'Turn on'}
                          </Button>
                        )}
                        <Button variant="secondary" onClick={() => setResetFor(u)}>
                          Reset password
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {resetFor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md space-y-4">
            <h2 className="text-2xl font-bold">New password for {resetFor.name}</h2>
            <Field label="New password" hint="At least 8 characters">
              <Input type="text" minLength={8} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </Field>
            <div className="flex gap-3">
              <Button
                disabled={newPw.length < 8 || update.isPending}
                onClick={() => update.mutate({ id: resetFor.id, password: newPw, msg: `Password changed for ${resetFor.name}.` })}
              >
                Save password
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setResetFor(null)
                  setNewPw('')
                }}
              >
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
