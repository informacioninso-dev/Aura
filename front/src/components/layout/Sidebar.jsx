import {
  ArrowDownCircle,
  ArrowUpCircle,
  Calculator,
  CreditCard,
  LogOut,
  Rat,
  ShieldCheck,
  Tags,
  Upload,
  UserRound,
  Wallet,
} from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'

import BrandMark from '../brand/BrandMark'
import { useAuth } from '../../context/useAuth'
import './layout.css'

const FINANCE_NAV_ITEMS = [
  { to: '/dashboard', icon: Wallet, label: 'Mi dinero' },
  { to: '/ingresos', icon: ArrowDownCircle, label: 'Lo que ganas' },
  { to: '/gastos', icon: ArrowUpCircle, label: 'Lo que gastas' },
  { to: '/diferidos', icon: CreditCard, label: 'Gastos a cuotas' },
  { to: '/lo-que-me-deben', icon: Rat, label: 'Lo que me deben' },
]

function NavItem({ to, icon, label, onClick }) {
  const IconComponent = icon

  return (
    <NavLink
      to={to}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
      onClick={onClick}
    >
      <span className="nav-item-icon" aria-hidden="true">
        <IconComponent size={17} strokeWidth={2.1} />
      </span>
      {label}
    </NavLink>
  )
}

export default function Sidebar({ isOpen, onClose }) {
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
        <NavItem to="/presupuesto" icon={Tags} label="Categorias" onClick={handleNavClick} />
        <NavItem to="/simulador" icon={Calculator} label="Simulador" onClick={handleNavClick} />
        <NavItem to="/importar" icon={Upload} label="Importar historial" onClick={handleNavClick} />

        {user?.is_superuser && (
          <>
            <div className="nav-section-label" style={{ marginTop: 8 }}>Admin</div>
            <NavItem to="/superadmin" icon={ShieldCheck} label="Super Admin" onClick={handleNavClick} />
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <NavItem to="/perfil" icon={UserRound} label={user?.username || 'Mi perfil'} onClick={handleNavClick} />
        <button
          onClick={handleLogout}
          className="nav-item nav-item-danger"
        >
          <span className="nav-item-icon" aria-hidden="true">
            <LogOut size={17} strokeWidth={2.1} />
          </span>
          Cerrar sesion
        </button>
      </div>
    </aside>
  )
}
