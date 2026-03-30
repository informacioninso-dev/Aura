import { useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/useAuth'
import BrandMark from '../brand/BrandMark'
import Sidebar from './Sidebar'
import NotificationBell from './NotificationBell'
import './layout.css'

export default function AppLayout() {
  const { user, loading } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
      {/* Mobile topbar */}
      <header className="mobile-topbar">
        <button
          className="hamburger-btn"
          onClick={() => setSidebarOpen(true)}
          aria-label="Abrir menú"
        >
          <span /><span /><span />
        </button>
        <div className="mobile-logo">
          <BrandMark className="sidebar-logo-icon" />
          <span className="sidebar-logo-name">AURA</span>
        </div>
        <div style={{ width: 44 }} />
      </header>

      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="app-main">
        <div className="notification-bell-wrap">
          <NotificationBell />
        </div>
        <Outlet />
      </main>
    </div>
  )
}
