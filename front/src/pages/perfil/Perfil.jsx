import { useState } from 'react'
import { CheckCircle, Crown, RotateCcw, User } from 'lucide-react'
import { useNavigate } from 'react-router'

import { getApiErrorMessage } from '../../api/errors'
import { useAuth } from '../../context/useAuth'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import api from '../../api/client'
import '../../components/ui/app.css'

const MONEDAS = ['USD', 'CLP', 'EUR', 'ARS', 'COP', 'MXN', 'PEN']

function formatPlanDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })
}

export default function Perfil() {
  const { user, fetchPerfil, changePassword, logout } = useAuth()
  const navigate = useNavigate()
  const currentPlanLabel = user?.plan?.slug === 'pro' ? 'Pro' : 'Free'
  const currentPlanBadgeClass = user?.plan?.slug === 'pro' ? 'is-pro' : 'is-free'

  const [form, setForm] = useState({
    username: user?.username || '',
    moneda_preferida: user?.moneda_preferida || 'USD',
  })
  const [loading, setLoading] = useState(false)
  const [ok, setOk] = useState('')
  const [error, setError] = useState('')

  const [passForm, setPassForm] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [passLoading, setPassLoading] = useState(false)
  const [passOk, setPassOk] = useState('')
  const [passError, setPassError] = useState('')

  const [cancelLoading, setCancelLoading] = useState(false)
  const [reactivateLoading, setReactivateLoading] = useState(false)
  const [cancelOk, setCancelOk] = useState('')
  const [cancelError, setCancelError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)

  const isPro = user?.plan?.slug !== undefined && !user.plan.is_default
  const endsAt = user?.plan?.assignment_ends_at
  const cancelAtPeriodEnd = user?.plan?.cancel_at_period_end
  const esPago = user?.plan?.assignment_tipo === 'pago'

  async function handleCancelarSuscripcion() {
    setCancelLoading(true)
    setCancelError('')
    setCancelOk('')
    try {
      await api.post('/usuarios/suscripcion/cancelar/')
      await fetchPerfil()
      setCancelOk('Suscripcion cancelada. Tu plan Pro se mantiene hasta el fin del periodo.')
      setConfirmCancel(false)
    } catch (err) {
      setCancelError(getApiErrorMessage(err, 'No se pudo cancelar la suscripcion.'))
    } finally {
      setCancelLoading(false)
    }
  }

  async function handleReactivarSuscripcion() {
    setReactivateLoading(true)
    setCancelError('')
    setCancelOk('')
    try {
      const { data } = await api.post('/usuarios/suscripcion/reactivar/')
      await fetchPerfil()
      setCancelOk(data.detail || 'Cancelacion deshecha. Tu plan Pro vuelve a estar activo.')
    } catch (err) {
      setCancelError(getApiErrorMessage(err, 'No se pudo deshacer la cancelacion.'))
    } finally {
      setReactivateLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')
    setOk('')

    try {
      await api.patch('/usuarios/perfil/', form)
      await fetchPerfil()
      setOk('Cambios guardados correctamente.')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Error al guardar los cambios.'))
    } finally {
      setLoading(false)
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault()
    if (passLoading) return
    setPassError('')
    setPassOk('')

    if (passForm.new_password.length < 8) {
      setPassError('La nueva clave debe tener al menos 8 caracteres.')
      return
    }
    if (passForm.new_password !== passForm.confirm_password) {
      setPassError('Las claves nuevas no coinciden.')
      return
    }

    setPassLoading(true)
    try {
      const response = await changePassword({
        current_password: passForm.current_password,
        new_password: passForm.new_password,
      })
      setPassOk(response?.detail || 'Contrasena actualizada correctamente.')
      setPassForm({ current_password: '', new_password: '', confirm_password: '' })
      if (response?.force_relogin) {
        window.setTimeout(async () => {
          await logout()
          navigate('/login')
        }, 1200)
      }
    } catch (err) {
      setPassError(getApiErrorMessage(err, 'No se pudo actualizar la clave.'))
    } finally {
      setPassLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-header">
        <div className="page-title-row">
          <h1 className="page-title">Tu perfil</h1>
          <span className={`subtle-plan-badge ${currentPlanBadgeClass}`}>Plan {currentPlanLabel}</span>
        </div>
        <p className="page-subtitle">Personaliza tu cuenta y seguridad</p>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="perfil-summary">
          <div className="perfil-avatar-shell">
            <User size={24} style={{ color: 'var(--app-lila)' }} />
          </div>
          <div className="perfil-summary-copy">
            <div className="perfil-summary-row">
              <p style={{ fontWeight: 700, color: 'var(--app-text)', fontSize: 16 }}>{user?.username}</p>
              <span className={`subtle-plan-badge ${currentPlanBadgeClass}`}>{currentPlanLabel}</span>
            </div>
            <p style={{ color: 'rgba(var(--app-ink-rgb),0.40)', fontSize: 13 }}>{user?.email}</p>
          </div>
        </div>

        <FeedbackAlert type="error" message={error} />
        {ok && (
          <div style={{ background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.25)', color: 'var(--app-green)', borderRadius: 12, padding: '12px 16px', fontSize: 13, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle size={15} /> {ok}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-modal-group">
            <label className="form-modal-label">Nombre de usuario</label>
            <input className="form-modal-input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">Correo electronico</label>
            <input className="form-modal-input" value={user?.email || ''} disabled style={{ opacity: 0.4, cursor: 'not-allowed' }} />
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">Moneda preferida</label>
            <select className="form-modal-select" value={form.moneda_preferida} onChange={(e) => setForm({ ...form, moneda_preferida: e.target.value })}>
              {MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-modal-save" disabled={loading} style={{ width: '100%', padding: '13px 0', marginTop: 4 }}>
            {loading ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </form>
      </div>

      <div className="card perfil-plan-card">
        <div className="perfil-plan-header">
          <div className="perfil-plan-icon" aria-hidden="true">
            <Crown size={20} />
          </div>
          <div className="perfil-plan-heading">
            <span>Plan y suscripcion</span>
            <h3>Plan {currentPlanLabel}</h3>
          </div>
          <span className={`subtle-plan-badge ${currentPlanBadgeClass}`}>{currentPlanLabel}</span>
        </div>

        <p className="perfil-plan-copy">
          {!isPro && 'Estas en el plan Free. Puedes pasar a Pro cuando quieras para desbloquear todas las herramientas.'}
          {isPro && !esPago && 'Tu plan Pro fue asignado a tu cuenta y no tiene cobro administrado desde Aura.'}
          {isPro && esPago && cancelAtPeriodEnd && (
            <>La cancelacion esta programada. Conservas Pro hasta el <strong>{formatPlanDate(endsAt)}</strong> y puedes deshacerla mientras el periodo siga activo.</>
          )}
          {isPro && esPago && !cancelAtPeriodEnd && (
            <>Tu periodo Pro esta activo{endsAt ? <> hasta el <strong>{formatPlanDate(endsAt)}</strong></> : ''}.</>
          )}
        </p>

        <FeedbackAlert type="success" message={cancelOk} />
        <FeedbackAlert type="error" message={cancelError} />

        {!isPro && (
          <button type="button" className="btn-modal-save perfil-plan-primary" onClick={() => navigate('/planes')}>
            <Crown size={16} /> Pasar a Pro
          </button>
        )}

        {isPro && esPago && cancelAtPeriodEnd && (
          <button
            type="button"
            className="btn-modal-save perfil-plan-primary"
            disabled={reactivateLoading}
            onClick={handleReactivarSuscripcion}
          >
            <RotateCcw size={16} /> {reactivateLoading ? 'Reactivando...' : 'Deshacer cancelacion'}
          </button>
        )}

        {isPro && esPago && !cancelAtPeriodEnd && (
          <>
            {!confirmCancel ? (
              <button
                type="button"
                className="btn-modal-cancel perfil-plan-danger"
                onClick={() => setConfirmCancel(true)}
              >
                Cancelar al final del periodo
              </button>
            ) : (
              <div className="perfil-cancel-box">
                <p>
                  No perderas Pro hoy. Lo conservaras hasta terminar el periodo actual y despues volveras a Free.
                </p>
                <div className="perfil-plan-actions">
                  <button
                    type="button"
                    className="btn-modal-cancel perfil-plan-danger"
                    disabled={cancelLoading}
                    onClick={handleCancelarSuscripcion}
                  >
                    {cancelLoading ? 'Cancelando...' : 'Confirmar cancelacion'}
                  </button>
                  <button
                    type="button"
                    className="btn-modal-cancel"
                    disabled={cancelLoading}
                    onClick={() => setConfirmCancel(false)}
                  >
                    Conservar Pro
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Cambiar clave</h3>

        <FeedbackAlert type="error" message={passError} />
        <FeedbackAlert type="success" message={passOk} />

        <form onSubmit={handlePasswordSubmit}>
          <div className="form-modal-group">
            <label className="form-modal-label">Clave actual</label>
            <input
              type="password"
              className="form-modal-input"
              required
              value={passForm.current_password}
              onChange={(e) => setPassForm({ ...passForm, current_password: e.target.value })}
            />
          </div>

          <div className="form-modal-group">
            <label className="form-modal-label">Nueva clave</label>
            <input
              type="password"
              className="form-modal-input"
              required
              minLength={8}
              value={passForm.new_password}
              onChange={(e) => setPassForm({ ...passForm, new_password: e.target.value })}
            />
          </div>

          <div className="form-modal-group">
            <label className="form-modal-label">Confirmar nueva clave</label>
            <input
              type="password"
              className="form-modal-input"
              required
              minLength={8}
              value={passForm.confirm_password}
              onChange={(e) => setPassForm({ ...passForm, confirm_password: e.target.value })}
            />
          </div>

          <button type="submit" className="btn-modal-save" disabled={passLoading} style={{ width: '100%', padding: '13px 0', marginTop: 4 }}>
            {passLoading ? 'Actualizando...' : 'Actualizar clave'}
          </button>
        </form>
      </div>

    </div>
  )
}
