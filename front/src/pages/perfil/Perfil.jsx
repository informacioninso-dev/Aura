import { useState } from 'react'
import { useAuth } from '../../context/useAuth'
import api from '../../api/client'
import { User, CheckCircle } from 'lucide-react'

const MONEDAS = ['USD', 'CLP', 'EUR', 'ARS', 'COP', 'MXN', 'PEN']

export default function Perfil() {
  const { user, fetchPerfil } = useAuth()
  const [form, setForm] = useState({ username: user?.username || '', moneda_preferida: user?.moneda_preferida || 'USD' })
  const [loading, setLoading] = useState(false)
  const [ok, setOk] = useState(false)
  const [error, setError] = useState('')

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
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Perfil</h1>
        <p className="text-[#94A3B8] text-sm mt-1">Información de tu cuenta</p>
      </div>

      <div className="bg-[#1E293B] rounded-xl border border-[#334155] p-6">
        <div className="flex items-center gap-4 mb-6 pb-6 border-b border-[#334155]">
          <div className="w-14 h-14 bg-[#10B981]/20 border border-[#10B981]/30 rounded-full flex items-center justify-center">
            <User size={24} className="text-[#10B981]" />
          </div>
          <div>
            <p className="font-semibold text-white">{user?.username}</p>
            <p className="text-sm text-[#94A3B8]">{user?.email}</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm mb-4">{error}</div>
        )}
        {ok && (
          <div className="bg-[#10B981]/10 border border-[#10B981]/30 text-[#10B981] rounded-lg px-4 py-3 text-sm mb-4 flex items-center gap-2">
            <CheckCircle size={16} /> Cambios guardados
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-[#94A3B8] block mb-1.5">Nombre de usuario</label>
            <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]" />
          </div>
          <div>
            <label className="text-sm text-[#94A3B8] block mb-1.5">Correo electrónico</label>
            <input value={user?.email} disabled
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-[#475569] cursor-not-allowed" />
          </div>
          <div>
            <label className="text-sm text-[#94A3B8] block mb-1.5">Moneda preferida</label>
            <select value={form.moneda_preferida} onChange={e => setForm({ ...form, moneda_preferida: e.target.value })}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]">
              {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-[#94A3B8] block mb-1.5">Miembro desde</label>
            <input value={user?.fecha_registro ? new Date(user.fecha_registro).toLocaleDateString('es-CL') : ''} disabled
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-[#475569] cursor-not-allowed" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-[#10B981] hover:bg-[#059669] disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors">
            {loading ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </form>
      </div>
    </div>
  )
}
