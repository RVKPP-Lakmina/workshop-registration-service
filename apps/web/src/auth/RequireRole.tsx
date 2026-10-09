import { Navigate, Outlet } from 'react-router'
import { homeFor, useAuth } from './AuthContext'
import type { Role } from '../types'
import { PageLoader } from '../components/ui'

export function RequireRole({ roles }: { roles?: Role[] }) {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
  return <Outlet />
}
