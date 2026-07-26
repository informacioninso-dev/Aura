import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../../context/useAuth'
import BrandMark from '../brand/BrandMark'
import Sidebar from './Sidebar'
import NotificationBell from './NotificationBell'
import AuraAssistant from '../ui/AuraAssistant'
import { getPreferredTheme, saveTheme } from '../../utils/theme'
import './layout.css'

export default function AppLayout() {
  const { user, loading } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [theme, setTheme] = useState(getPreferredTheme)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.appTheme = theme

    return () => {
      if (root.dataset.appTheme === theme) delete root.dataset.appTheme
    }
  }, [theme])

  function handleThemeToggle() {
    setTheme((currentTheme) => {
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark'
      saveTheme(nextTheme)
      return nextTheme
    })
  }

  if (loading) {
    return (
      <div className="loading-screen app-theme-root" data-theme={theme}>
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  if (user.is_superuser) return <Navigate to="/superadmin" replace />

  return (
    <div className="app-shell app-theme-root" data-theme={theme}>
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

      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        theme={theme}
        onThemeToggle={handleThemeToggle}
      />

      <main className="app-main">
        <div className="notification-bell-wrap">
          <NotificationBell />
        </div>
        <Outlet />
      </main>

      <AuraAssistant />
    </div>
  )
}
