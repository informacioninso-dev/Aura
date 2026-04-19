import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { LogOut, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../context/useAuth'
import BrandMark from '../brand/BrandMark'
import './layout.css'

export default function SuperAdminLayout() {
  const { user, loading, logout } = useAuth()
  const navigate = useNavigate()

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  if (!user.is_superuser) return <Navigate to="/dashboard" replace />

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0F172A', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 28px',
        height: 60,
        background: 'rgba(26,37,64,0.85)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BrandMark className="sidebar-logo-icon" />
          <span style={{ fontWeight: 900, fontSize: 14, color: '#fff', letterSpacing: '0.06em' }}>AURA</span>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'rgba(196,135,246,0.12)', border: '1px solid rgba(196,135,246,0.25)',
            borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 600, color: '#C487F6',
          }}>
            <ShieldCheck size={12} strokeWidth={2.2} /> Super Admin
          </span>
        </div>

        <button
          onClick={handleLogout}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 8, padding: '6px 12px',
            color: 'rgba(255,255,255,0.55)', fontSize: 13, cursor: 'pointer',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#F87171'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.35)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)' }}
        >
          <LogOut size={14} strokeWidth={2.1} /> Cerrar sesion
        </button>
      </header>

      <div style={{ padding: '28px 28px 48px' }}>
        <Outlet />
      </div>
    </div>
  )
}
