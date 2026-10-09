import { Navigate, Route, Routes } from 'react-router'
import { homeFor, useAuth } from './auth/AuthContext'
import { RequireRole } from './auth/RequireRole'
import { Layout } from './components/Layout'
import Login from './pages/Login'
import Workshops from './pages/Workshops'
import WorkshopDetail from './pages/WorkshopDetail'
import WorkshopForm from './pages/WorkshopForm'
import Users from './pages/Users'
import Audit from './pages/Audit'

function Home() {
  const { user, loading } = useAuth()
  if (loading) return <p className="p-8 text-lg">Loading...</p>
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireRole />}>
        <Route element={<Layout />}>
          <Route element={<RequireRole roles={['MANAGER', 'STAFF']} />}>
            <Route path="/workshops" element={<Workshops />} />
            <Route path="/workshops/:id" element={<WorkshopDetail />} />
          </Route>
          <Route element={<RequireRole roles={['MANAGER']} />}>
            <Route path="/workshops/new" element={<WorkshopForm />} />
            <Route path="/workshops/:id/edit" element={<WorkshopForm />} />
          </Route>
          <Route element={<RequireRole roles={['ADMIN']} />}>
            <Route path="/users" element={<Users />} />
          </Route>
          <Route path="/audit" element={<Audit />} />
        </Route>
      </Route>
      <Route path="*" element={<Home />} />
    </Routes>
  )
}
