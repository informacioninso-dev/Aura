import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, CreditCard } from 'lucide-react'
import api from '../../api/client'
import Modal from '../../components/ui/Modal'

const CATEGORIAS = ['vivienda', 'alimentacion', 'transporte', 'salud', 'educacion', 'entretenimiento', 'ropa', 'servicios', 'tecnologia', 'deudas', 'ahorro', 'otro']
const EMPTY = { descripcion: '', categoria: 'otro', monto_total: '', num_cuotas: '', cuota_mensual: '', fecha_inicio: '', fecha_fin: '', activo: true }

export default function Diferidos() {
  const [items, setItems] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchItems() }, [])

  async function fetchItems() {
    const { data } = await api.get('/finanzas/diferidos/')
    setItems(data)
  }

  function calcularCuota(monto, cuotas) {
    if (monto && cuotas && parseFloat(cuotas) > 0) {
      return (parseFloat(monto) / parseFloat(cuotas)).toFixed(2)
    }
    return ''
  }

  function handleMontoOrCuotas(field, value) {
    const updated = { ...form, [field]: value }
    updated.cuota_mensual = calcularCuota(
      field === 'monto_total' ? value : form.monto_total,
      field === 'num_cuotas' ? value : form.num_cuotas
    )
    setForm(updated)
  }

  function openNew() { setForm(EMPTY); setEditId(null); setModal(true) }
  function openEdit(item) {
    setForm({ descripcion: item.descripcion, categoria: item.categoria, monto_total: item.monto_total, num_cuotas: item.num_cuotas, cuota_mensual: item.cuota_mensual, fecha_inicio: item.fecha_inicio, fecha_fin: item.fecha_fin, activo: item.activo })
    setEditId(item.id); setModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault(); setLoading(true)
    try {
      if (editId) await api.put(`/finanzas/diferidos/${editId}/`, form)
      else await api.post('/finanzas/diferidos/', form)
      setModal(false); fetchItems()
    } finally { setLoading(false) }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar este diferido?')) return
    await api.delete(`/finanzas/diferidos/${id}/`)
    fetchItems()
  }

  const totalMensual = items.filter(i => i.activo).reduce((s, i) => s + parseFloat(i.cuota_mensual), 0)

  function progreso(item) {
    const ini = new Date(item.fecha_inicio)
    const fin = new Date(item.fecha_fin)
    const hoy = new Date()
    const total = (fin - ini) / (1000 * 60 * 60 * 24 * 30)
    const pasado = (hoy - ini) / (1000 * 60 * 60 * 24 * 30)
    return Math.min(100, Math.max(0, Math.round((pasado / total) * 100)))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Diferidos</h1>
          <p className="text-[#94A3B8] text-sm mt-1">Cuota total mensual: <span className="text-purple-400 font-semibold">${totalMensual.toLocaleString('es-CL', { maximumFractionDigits: 0 })}</span></p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 bg-[#10B981] hover:bg-[#059669] text-white font-medium px-4 py-2 rounded-lg transition-colors">
          <Plus size={16} /> Agregar
        </button>
      </div>

      {items.length === 0 ? (
        <div className="bg-[#1E293B] rounded-xl border border-[#334155] flex flex-col items-center justify-center py-16 text-[#475569]">
          <CreditCard size={32} className="mb-2" />
          <p>No hay diferidos registrados</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map(item => {
            const pct = progreso(item)
            return (
              <div key={item.id} className="bg-[#1E293B] rounded-xl border border-[#334155] p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-white">{item.descripcion}</p>
                    <p className="text-xs text-[#475569] capitalize mt-0.5">{item.categoria}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(item)} className="text-[#475569] hover:text-[#10B981] transition-colors"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(item.id)} className="text-[#475569] hover:text-red-400 transition-colors"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                  <div>
                    <p className="text-[#475569] text-xs">Total</p>
                    <p className="text-white font-medium">${parseFloat(item.monto_total).toLocaleString('es-CL')}</p>
                  </div>
                  <div>
                    <p className="text-[#475569] text-xs">Cuota mensual</p>
                    <p className="text-purple-400 font-semibold">${parseFloat(item.cuota_mensual).toLocaleString('es-CL')}</p>
                  </div>
                  <div>
                    <p className="text-[#475569] text-xs">Cuotas</p>
                    <p className="text-[#94A3B8]">{item.num_cuotas}</p>
                  </div>
                  <div>
                    <p className="text-[#475569] text-xs">Vence</p>
                    <p className="text-[#94A3B8]">{item.fecha_fin}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-[#475569]">
                    <span>Progreso</span><span>{pct}%</span>
                  </div>
                  <div className="w-full bg-[#334155] rounded-full h-1.5">
                    <div className="bg-purple-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                {!item.activo && <span className="text-xs text-[#475569] mt-2 block">Inactivo</span>}
              </div>
            )
          })}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar diferido' : 'Nuevo diferido'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-[#94A3B8] block mb-1.5">Descripción</label>
            <input required value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]" placeholder="Ej: iPhone 15 Pro" />
          </div>
          <div>
            <label className="text-sm text-[#94A3B8] block mb-1.5">Categoría</label>
            <select value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981] capitalize">
              {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-[#94A3B8] block mb-1.5">Monto total</label>
              <input type="number" required min="0" step="0.01" value={form.monto_total}
                onChange={e => handleMontoOrCuotas('monto_total', e.target.value)}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]" placeholder="0" />
            </div>
            <div>
              <label className="text-sm text-[#94A3B8] block mb-1.5">N° de cuotas</label>
              <input type="number" required min="1" value={form.num_cuotas}
                onChange={e => handleMontoOrCuotas('num_cuotas', e.target.value)}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]" placeholder="12" />
            </div>
          </div>
          <div>
            <label className="text-sm text-[#94A3B8] block mb-1.5">Cuota mensual</label>
            <input type="number" required min="0" step="0.01" value={form.cuota_mensual}
              onChange={e => setForm({ ...form, cuota_mensual: e.target.value })}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]" placeholder="Calculada automáticamente" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-[#94A3B8] block mb-1.5">Fecha inicio</label>
              <input type="date" required value={form.fecha_inicio} onChange={e => setForm({ ...form, fecha_inicio: e.target.value })}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]" />
            </div>
            <div>
              <label className="text-sm text-[#94A3B8] block mb-1.5">Fecha fin</label>
              <input type="date" required value={form.fecha_fin} onChange={e => setForm({ ...form, fecha_fin: e.target.value })}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]" />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} className="accent-[#10B981] w-4 h-4" />
            <span className="text-sm text-[#94A3B8]">Activo</span>
          </label>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setModal(false)} className="flex-1 border border-[#334155] text-[#94A3B8] hover:text-white py-2.5 rounded-lg transition-colors">Cancelar</button>
            <button type="submit" disabled={loading} className="flex-1 bg-[#10B981] hover:bg-[#059669] disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors">
              {loading ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
