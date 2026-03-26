import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/useAuth'
import './auth.css'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(form.email, form.password)
      navigate('/dashboard')
    } catch {
      setError('Correo o contraseña incorrectos.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-box">
        <div className="auth-logo">
          <div className="auth-logo-icon">A</div>
          <div className="auth-logo-name">AURA</div>
          <div className="auth-logo-tag">Clara Proyección, Futuro Sólido.</div>
        </div>

        <div className="auth-card">
          <h2 className="auth-title">Bienvenido de vuelta</h2>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Correo electrónico</label>
              <input
                type="email"
                required
                className="form-input"
                placeholder="tu@correo.com"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Contraseña</label>
              <div className="form-input-wrap">
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  className="form-input"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                />
                <button type="button" className="form-eye-btn" onClick={() => setShowPass(!showPass)}>
                  {showPass ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? 'Ingresando...' : 'Ingresar a mi cuenta'}
            </button>
          </form>
        </div>

        <p className="auth-footer">
          ¿No tienes cuenta?{' '}
          <Link to="/registro">Créala gratis aquí</Link>
        </p>
        <p className="auth-footer" style={{ marginTop: 8 }}>
          <Link to="/">← Volver al inicio</Link>
        </p>
      </div>
    </div>
  )
}
