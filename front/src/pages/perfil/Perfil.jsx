import { useState } from 'react'
import { CheckCircle, User } from 'lucide-react'

import { getApiErrorMessage } from '../../api/errors'
import { useAuth } from '../../context/useAuth'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import api from '../../api/client'
import '../../components/ui/app.css'

const MONEDAS = ['USD', 'CLP', 'EUR', 'ARS', 'COP', 'MXN', 'PEN']

export default function Perfil() {
  const { user, fetchPerfil, changePassword } = useAuth()

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
    } catch (err) {
      setPassError(getApiErrorMessage(err, 'No se pudo actualizar la clave.'))
    } finally {
      setPassLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-header">
        <h1 className="page-title">Tu perfil</h1>
        <p className="page-subtitle">Personaliza tu cuenta y seguridad</p>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="perfil-summary">
          <div className="perfil-avatar-shell">
            <User size={24} style={{ color: '#C487F6' }} />
          </div>
          <div>
            <p style={{ fontWeight: 700, color: '#fff', fontSize: 16 }}>{user?.username}</p>
            <p style={{ color: 'rgba(255,255,255,0.40)', fontSize: 13 }}>{user?.email}</p>
          </div>
        </div>

        <FeedbackAlert type="error" message={error} />
        {ok && (
          <div style={{ background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.25)', color: '#10B981', borderRadius: 12, padding: '12px 16px', fontSize: 13, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
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
