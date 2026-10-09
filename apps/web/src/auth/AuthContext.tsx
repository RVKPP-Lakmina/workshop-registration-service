import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { get, post, setUnauthorizedHandler } from '../api/client'
import type { LoginResponse, Role, User } from '../types'

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  logout: () => void
}

const Ctx = createContext<AuthState | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function homeFor(role: Role) {
  return role === 'ADMIN' ? '/users' : '/workshops'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const clearSession = useCallback(() => {
    setUser(null)
    qc.clear()
  }, [qc])

  const logout = useCallback(() => {
    // Ask the server to clear the cookie; the local session ends regardless of the outcome.
    post('/auth/logout')
      .catch(() => {})
      .finally(clearSession)
  }, [clearSession])

  useEffect(() => {
    // A 401 mid-session means the cookie is gone: just drop local state.
    setUnauthorizedHandler(clearSession)
  }, [clearSession])

  useEffect(() => {
    let cancelled = false
    get<User>('/auth/me')
      .then((u) => {
        if (!cancelled) setUser(u)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await post<LoginResponse>('/auth/login', { email, password })
    setUser(res.user)
    return res.user
  }, [])

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
