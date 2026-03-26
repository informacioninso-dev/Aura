import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/useAuth'
import Sidebar from './Sidebar'
import './layout.css'

export default function AppLayout() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
