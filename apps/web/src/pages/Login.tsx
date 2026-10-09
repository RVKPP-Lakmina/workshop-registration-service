import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { homeFor, useAuth } from '../auth/AuthContext'
import { Button, Card, ErrorBox, Field, Input } from '../components/ui'
import { config } from '../config'

export default function Login() {
  const { user, login } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={homeFor(user.role)} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const u = await login(email.trim(), password)
      nav(homeFor(u.role), { replace: true })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <h1 className="mb-1 text-3xl font-bold">{config.appName}</h1>
        <p className="mb-6 text-lg text-slate-600">Sign in with your staff account.</p>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <Input type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
