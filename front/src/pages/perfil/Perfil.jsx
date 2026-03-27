import { useState } from 'react'
import { useAuth } from '../../context/useAuth'
import api from '../../api/client'
import { User, CheckCircle } from 'lucide-react'
import '../../components/ui/app.css'

const MONEDAS = ['USD', 'CLP', 'EUR', 'ARS', 'COP', 'MXN', 'PEN']

export default function Perfil() {
  const { user, fetchPerfil } = useAuth()
  const [form, setForm]       = useState({ username: user?.username || '', moneda_preferida: user?.moneda_preferida || 'USD' })
  const [loading, setLoading] = useState(false)
  const [ok, setOk]           = useState(false)
  const [error, setError]     = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError(''); setOk(false)
    try {
      await api.patch('/usuarios/perfil/', form)
      await fetchPerfil()
      setOk(true)
      setTimeout(() => setOk(false), 3000)
    } catch {
      setError('Error al guardar los cambios.')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <div className="page-header">
        <h1 className="page-title">Tu perfil</h1>
        <p className="page-subtitle">Personaliza tu cuenta y preferencias</p>
      </div>

      <div className="card">
        {/* Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(196,135,246,0.25), rgba(16,185,129,0.20))', border: '1.5px solid rgba(196,135,246,0.30)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <User size={24} style={{ color: '#C487F6' }} />
          </div>
          <div>
            <p style={{ fontWeight: 700, color: '#fff', fontSize: 16 }}>{user?.username}</p>
            <p style={{ color: 'rgba(255,255,255,0.40)', fontSize: 13 }}>{user?.email}</p>
          </div>
        </div>

        {error && (
          <div style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)', color: '#FCA5A5', borderRadius: 12, padding: '12px 16px', fontSize: 13, marginBottom: 20 }}>
            {error}
          </div>
        )}
        {ok && (
          <div style={{ background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.25)', color: '#10B981', borderRadius: 12, padding: '12px 16px', fontSize: 13, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle size={15} /> Cambios guardados
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-modal-group">
            <label className="form-modal-label">Nombre de usuario</label>
            <input className="form-modal-input" value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })} />
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">Correo electrónico</label>
            <input className="form-modal-input" value={user?.email} disabled
              style={{ opacity: 0.4, cursor: 'not-allowed' }} />
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">Moneda preferida</label>
            <select className="form-modal-select" value={form.moneda_preferida}
              onChange={e => setForm({ ...form, moneda_preferida: e.target.value })}>
              {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">Miembro desde</label>
            <input className="form-modal-input"
              value={user?.fecha_registro ? new Date(user.fecha_registro).toLocaleDateString('es-CL') : ''} disabled
              style={{ opacity: 0.4, cursor: 'not-allowed' }} />
          </div>
          <button type="submit" className="btn-modal-save" disabled={loading}
            style={{ width: '100%', padding: '13px 0', marginTop: 4 }}>
            {loading ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </form>
      </div>
    </div>
  )
}
