import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '../../context/useAuth'
import { getApiErrorMessage } from '../../api/errors'
import BrandMark from '../../components/brand/BrandMark'
import './auth.css'

export default function ResetPassword() {
  const navigate = useNavigate()
  const { resetPassword, user, loading: authLoading } = useAuth()
  const [params] = useSearchParams()
  const uid = params.get('uid') || ''
  const token = params.get('token') || ''

  const hasToken = useMemo(() => Boolean(uid && token), [uid, token])

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setError('')
    setSuccess('')

    if (password.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)
    try {
      const response = await resetPassword({ uid, token, new_password: password })
      setSuccess(response?.detail || 'Contraseña restablecida correctamente.')
      setTimeout(() => navigate('/login'), 1500)
    } catch (err) {
      setError(getApiErrorMessage(err, 'No se pudo restablecer la contraseña.'))
    } finally {
      setLoading(false)
    }
  }

  if (!hasToken) {
    return (
      <div className="auth-page">
        <div className="auth-box">
          <div className="auth-card">
            <h2 className="auth-title">Enlace inválido</h2>
            <div className="auth-error">El enlace de recuperación no es válido.</div>
            <p className="auth-footer" style={{ marginTop: 10 }}>
              <Link to="/forgot-password">Solicitar un nuevo enlace</Link>
            </p>
          </div>
        </div>
      </div>
    )
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
          <div className="auth-logo-tag">Define una nueva contraseña segura.</div>
        </Link>

        <div className="auth-card">
          <h2 className="auth-title">Restablecer contraseña</h2>
          {error && <div className="auth-error">{error}</div>}
          {success && (
            <div className="auth-error" style={{ background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.4)', color: '#10B981' }}>
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Nueva contraseña</label>
              <input
                type="password"
                required
                minLength={8}
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirmar contraseña</label>
              <input
                type="password"
                required
                minLength={8}
                className="form-input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? 'Guardando...' : 'Actualizar contraseña'}
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
