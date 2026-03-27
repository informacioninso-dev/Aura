import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/useAuth'
import Sidebar from './Sidebar'
import NotificationBell from './NotificationBell'
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
        <div style={{ position: 'fixed', top: 16, right: 20, zIndex: 900 }}>
          <NotificationBell />
        </div>
        <Outlet />
      </main>
    </div>
  )
}
