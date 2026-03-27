import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/useAuth'
import './layout.css'

const navItems = [
  { to: '/dashboard',            icon: '◈', label: 'Mi dinero' },
  { to: '/ingresos',             icon: '↑', label: 'Lo que entra' },
  { to: '/gastos-corrientes',    icon: '↓', label: 'Lo que sale' },
  { to: '/gastos-no-corrientes', icon: '◉', label: 'Gastos puntuales' },
  { to: '/diferidos',            icon: '⊞', label: 'Cuotas' },
]

export default function Sidebar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <aside className="sidebar">
      <NavLink to="/dashboard" className="sidebar-logo">
        <div className="sidebar-logo-icon">A</div>
        <div>
          <div className="sidebar-logo-name">AURA</div>
          <div className="sidebar-logo-tag">Tus finanzas</div>
        </div>
      </NavLink>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Finanzas</div>
        {navItems.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
            {label}
          </NavLink>
        ))}

        <div className="nav-section-label" style={{ marginTop: 8 }}>Herramientas</div>
        <NavLink
          to="/presupuesto"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>◑</span>
          Categorías
        </NavLink>
        <NavLink
          to="/simulador"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>⬡</span>
          Simulador
        </NavLink>
        <NavLink
          to="/importar"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>⤒</span>
          Importar historial
        </NavLink>
        <NavLink
          to="/reporte"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>≡</span>
          Reportes
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <NavLink
          to="/perfil"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>◎</span>
          {user?.username || 'Mi perfil'}
        </NavLink>
        <button
          onClick={handleLogout}
          className="nav-item nav-item-danger"
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>⊗</span>
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
