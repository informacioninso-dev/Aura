import { Moon, Sun } from 'lucide-react'
import { NavLink, useNavigate } from 'react-router'

import BrandMark from '../brand/BrandMark'
import { useAuth } from '../../context/useAuth'
import './layout.css'

// Emojis para hablar igual de cercano que la app movil (misma identidad).
const FINANCE_NAV_ITEMS = [
  { to: '/dashboard', icon: '📈', label: 'Mi dinero' },
  { to: '/ingresos', icon: '💰', label: 'Lo que ganas' },
  { to: '/gastos', icon: '💸', label: 'Lo que gastas' },
  { to: '/cuentas-personas', icon: '🐭', label: 'Cuentas con personas' },
]

const TOOL_NAV_ITEMS = [
  { to: '/presupuesto', icon: '🏷️', label: 'Categorias' },
  { to: '/simulador', icon: '🔮', label: 'Simulador' },
  { to: '/importar', icon: '📥', label: 'Importar historial' },
]

function NavItem({ to, icon, label, onClick }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
      onClick={onClick}
    >
      <span className="nav-item-icon nav-item-emoji" aria-hidden="true">{icon}</span>
      {label}
    </NavLink>
  )
}

export default function Sidebar({ isOpen, onClose, theme, onThemeToggle }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  function handleNavClick() {
    if (onClose) onClose()
  }

  return (
    <aside className={`sidebar${isOpen ? ' sidebar-open' : ''}`}>
      <NavLink to="/dashboard" className="sidebar-logo" onClick={handleNavClick}>
        <BrandMark className="sidebar-logo-icon" />
        <div>
          <div className="sidebar-logo-name">AURA</div>
          <div className="sidebar-logo-tag">Tus finanzas</div>
        </div>
        <button
          className="sidebar-close-btn"
          onClick={(event) => {
            event.preventDefault()
            if (onClose) onClose()
          }}
          aria-label="Cerrar menu"
        >
          X
        </button>
      </NavLink>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Finanzas</div>
        {FINANCE_NAV_ITEMS.map(({ to, icon, label }) => (
          <NavItem key={to} to={to} icon={icon} label={label} onClick={handleNavClick} />
        ))}

        <div className="nav-section-label" style={{ marginTop: 8 }}>Herramientas</div>
        {TOOL_NAV_ITEMS.map(({ to, icon, label }) => (
          <NavItem key={to} to={to} icon={icon} label={label} onClick={handleNavClick} />
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="theme-toggle"
          onClick={onThemeToggle}
          aria-label={`Activar modo ${theme === 'dark' ? 'claro' : 'oscuro'}`}
          aria-pressed={theme === 'light'}
        >
          <span className="nav-item-icon" aria-hidden="true">
            {theme === 'light'
              ? <Sun size={17} strokeWidth={2.1} />
              : <Moon size={17} strokeWidth={2.1} />}
          </span>
          <span className="theme-toggle-label">
            {theme === 'light' ? 'Modo claro' : 'Modo oscuro'}
          </span>
          <span className="theme-toggle-switch" aria-hidden="true">
            <span />
          </span>
        </button>
        <NavItem to="/perfil" icon="👤" label={user?.username || 'Mi perfil'} onClick={handleNavClick} />
        <button
          onClick={handleLogout}
          className="nav-item nav-item-danger"
        >
          <span className="nav-item-icon nav-item-emoji" aria-hidden="true">🚪</span>
          Cerrar sesion
        </button>
      </div>
    </aside>
  )
}
