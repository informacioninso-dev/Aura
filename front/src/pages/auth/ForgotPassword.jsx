import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { useAuth } from '../../context/useAuth'
import { getApiErrorMessage } from '../../api/errors'
import BrandMark from '../../components/brand/BrandMark'
import './auth.css'

export default function ForgotPassword() {
  const { forgotPassword, user, loading: authLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      const response = await forgotPassword(email)
      setSuccess(response?.detail || 'Si el correo está registrado, te enviaremos instrucciones.')
    } catch (err) {
      setError(getApiErrorMessage(err, 'No se pudo procesar la solicitud.'))
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
          <div className="auth-logo-tag">Recupera el acceso de forma segura.</div>
        </Link>

        <div className="auth-card">
          <h2 className="auth-title">Recuperar contraseña</h2>

          {error && <div className="auth-error">{error}</div>}
          {success && (
            <div className="auth-error" style={{ background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.4)', color: '#10B981' }}>
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Correo electrónico</label>
              <input
                type="email"
                required
                className="form-input"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? 'Enviando...' : 'Enviar instrucciones'}
            </button>
          </form>
        </div>

        <p className="auth-footer">
          <Link to="/login">← Volver al login</Link>
        </p>
      </div>
    </div>
  )
}
