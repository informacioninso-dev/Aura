import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { getApiErrorMessage } from '../../api/errors'
import BrandMark from '../../components/brand/BrandMark'
import { useAuth } from '../../context/useAuth'
import './auth.css'

export default function Login() {
  const { login, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)
    try {
      await login(form.email, form.password)
      navigate('/dashboard')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Correo o clave incorrectos.'))
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) {
    return (
      <div className="auth-page">
        <div className="auth-box">
          <div className="auth-card">
            <h2 className="auth-title">Recuperando sesion</h2>
            <p className="auth-footer" style={{ marginTop: 10 }}>Un momento...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!authLoading && user) {
    return <Navigate to="/dashboard" replace />
  }

  const brandTarget = user ? '/dashboard' : '/'

  return (
    <div className="auth-page">
      <div className="auth-box">
        <Link to={brandTarget} className="auth-logo auth-logo-link" aria-label={user ? 'Ir a mi dashboard' : 'Volver al inicio'}>
          <BrandMark className="auth-logo-icon" />
          <div className="auth-logo-name">AURA</div>
          <div className="auth-logo-tag">Clara proyeccion, futuro solido.</div>
        </Link>

        <div className="auth-card">
          <h2 className="auth-title">Bienvenido de vuelta</h2>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Correo electronico</label>
              <input
                type="email"
                required
                className="form-input"
                placeholder="tu@correo.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Clave</label>
              <div className="form-input-wrap">
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  className="form-input"
                  placeholder="********"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <button type="button" className="form-eye-btn" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? 'Ocultar clave' : 'Mostrar clave'}>
                  {showPass ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
                </button>
              </div>
              <div style={{ marginTop: 8, textAlign: 'right' }}>
                <Link to="/forgot-password" style={{ fontSize: 12, color: '#C487F6', textDecoration: 'none' }}>
                  Olvide mi clave
                </Link>
              </div>
            </div>

            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? 'Ingresando...' : 'Ingresar a mi cuenta'}
            </button>
          </form>
        </div>

        <p className="auth-footer">
          No tienes cuenta? <Link to="/registro">Crea la tuya gratis</Link>
        </p>
        <p className="auth-footer" style={{ marginTop: 8 }}>
          <Link to="/">Volver al inicio</Link>
        </p>
      </div>
    </div>
  )
}
