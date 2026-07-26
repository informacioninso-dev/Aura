import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'

import { getApiErrorMessage } from '../../api/errors'
import BrandMark from '../../components/brand/BrandMark'
import { useAuth } from '../../context/useAuth'
import './auth.css'

const MONEDAS = ['CLP', 'USD', 'EUR', 'ARS', 'COP', 'MXN', 'PEN']

export default function Registro() {
  const { registro, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    email: '',
    username: '',
    password: '',
    confirm_password: '',
    moneda_preferida: 'USD',
    privacy_notice_acknowledged: false,
    terms_accepted: false,
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setError('')

    if (form.password.length < 8) {
      setError('La clave debe tener al menos 8 caracteres.')
      return
    }
    if (form.password !== form.confirm_password) {
      setError('Las claves no coinciden.')
      return
    }
    if (!form.privacy_notice_acknowledged || !form.terms_accepted) {
      setError('Debes revisar el Aviso de Privacidad y aceptar los Terminos de Uso.')
      return
    }

    setLoading(true)
    try {
      await registro({
        email: form.email,
        username: form.username,
        password: form.password,
        moneda_preferida: form.moneda_preferida,
        privacy_notice_acknowledged: form.privacy_notice_acknowledged,
        terms_accepted: form.terms_accepted,
      })
      navigate('/dashboard')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Error al crear la cuenta. Intenta nuevamente.'))
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
          <h2 className="auth-title">Crea tu cuenta gratis</h2>

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
              <label className="form-label">Nombre de usuario</label>
              <input
                type="text"
                required
                className="form-input"
                placeholder="Tu nombre"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>

            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Clave</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  className="form-input"
                  placeholder="Minimo 8 caracteres"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Confirmar</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  className="form-input"
                  placeholder="Repite la clave"
                  value={form.confirm_password}
                  onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Moneda</label>
              <select
                className="form-select"
                value={form.moneda_preferida}
                onChange={(e) => setForm({ ...form, moneda_preferida: e.target.value })}
              >
                {MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div className="auth-legal-confirmations">
              <label className="auth-legal-check">
                <input
                  type="checkbox"
                  required
                  checked={form.privacy_notice_acknowledged}
                  onChange={(e) => setForm({ ...form, privacy_notice_acknowledged: e.target.checked })}
                />
                <span>
                  He leido el <Link to="/privacidad" target="_blank" rel="noreferrer">Aviso de Privacidad</Link> y entiendo como Aura tratara mis datos.
                </span>
              </label>

              <label className="auth-legal-check">
                <input
                  type="checkbox"
                  required
                  checked={form.terms_accepted}
                  onChange={(e) => setForm({ ...form, terms_accepted: e.target.checked })}
                />
                <span>
                  Acepto los <Link to="/terminos" target="_blank" rel="noreferrer">Terminos de Uso</Link>. Entiendo que Aura es informativa, no reemplaza asesoria financiera y sus resultados dependen de los datos que ingreso.
                </span>
              </label>
            </div>

            <button type="submit" className="btn-submit" disabled={loading} style={{ marginTop: 12 }}>
              {loading ? 'Creando cuenta...' : 'Crear mi cuenta gratis'}
            </button>
          </form>
        </div>

        <p className="auth-footer">
          Ya tienes cuenta? <Link to="/login">Inicia sesion</Link>
        </p>
        <p className="auth-footer" style={{ marginTop: 8 }}>
          <Link to="/">Volver al inicio</Link>
        </p>
      </div>
    </div>
  )
}
