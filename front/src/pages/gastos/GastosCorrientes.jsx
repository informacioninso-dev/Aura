import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, ShoppingCart } from 'lucide-react'
import api from '../../api/client'
import Modal from '../../components/ui/Modal'

const FRECUENCIAS = ['diario', 'semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual']
const CATEGORIAS = ['vivienda', 'alimentacion', 'transporte', 'salud', 'educacion', 'entretenimiento', 'ropa', 'servicios', 'tecnologia', 'deudas', 'ahorro', 'otro']
const EMPTY = { descripcion: '', categoria: 'otro', monto: '', frecuencia: 'mensual', fecha_inicio: '', fecha_fin: '', activo: true }

export default function GastosCorrientes() {
  const [items, setItems] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchItems() }, [])

  async function fetchItems() {
    const { data } = await api.get('/finanzas/gastos-corrientes/')
    setItems(data)
  }

  function openNew() { setForm(EMPTY); setEditId(null); setModal(true) }
  function openEdit(item) {
    setForm({ descripcion: item.descripcion, categoria: item.categoria, monto: item.monto, frecuencia: item.frecuencia, fecha_inicio: item.fecha_inicio, fecha_fin: item.fecha_fin || '', activo: item.activo })
    setEditId(item.id); setModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault(); setLoading(true)
    try {
      const payload = { ...form, fecha_fin: form.fecha_fin || null }
      if (editId) await api.put(`/finanzas/gastos-corrientes/${editId}/`, payload)
      else await api.post('/finanzas/gastos-corrientes/', payload)
      setModal(false); fetchItems()
    } finally { setLoading(false) }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar este gasto?')) return
    await api.delete(`/finanzas/gastos-corrientes/${id}/`)
    fetchItems()
  }

  const total = items.filter(i => i.activo).reduce((s, i) => {
    const map = { diario: 30, semanal: 4.33, quincenal: 2, mensual: 1, bimestral: 0.5, trimestral: 0.333, semestral: 0.167, anual: 0.083 }
    return s + parseFloat(i.monto) * (map[i.frecuencia] || 1)
  }, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Gastos Corrientes</h1>
          <p className="text-[#94A3B8] text-sm mt-1">Total mensual estimado: <span className="text-rose-400 font-semibold">${total.toLocaleString('es-CL', { maximumFractionDigits: 0 })}</span></p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 bg-[#10B981] hover:bg-[#059669] text-white font-medium px-4 py-2 rounded-lg transition-colors">
          <Plus size={16} /> Agregar
        </button>
      </div>

      <div className="bg-[#1E293B] rounded-xl border border-[#334155] overflow-hidden">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#475569]">
            <ShoppingCart size={32} className="mb-2" />
            <p>No hay gastos corrientes registrados</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#334155]">
                {['Descripción', 'Categoría', 'Monto', 'Frecuencia', 'Desde', 'Hasta', 'Estado', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-[#475569] uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b border-[#334155]/50 hover:bg-[#334155]/20 transition-colors">
                  <td className="px-4 py-3 text-white text-sm">{item.descripcion}</td>
                  <td className="px-4 py-3 text-[#94A3B8] text-sm capitalize">{item.categoria}</td>
                  <td className="px-4 py-3 text-rose-400 font-semibold text-sm">${parseFloat(item.monto).toLocaleString('es-CL')}</td>
                  <td className="px-4 py-3 text-[#94A3B8] text-sm capitalize">{item.frecuencia}</td>
                  <td className="px-4 py-3 text-[#94A3B8] text-sm">{item.fecha_inicio}</td>
                  <td className="px-4 py-3 text-[#94A3B8] text-sm">{item.fecha_fin || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${item.activo ? 'bg-[#10B981]/20 text-[#10B981]' : 'bg-[#475569]/20 text-[#475569]'}`}>
                      {item.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(item)} className="text-[#475569] hover:text-[#10B981] transition-colors"><Pencil size={15} /></button>
                      <button onClick={() => handleDelete(item.id)} className="text-[#475569] hover:text-red-400 transition-colors"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar gasto corriente' : 'Nuevo gasto corriente'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-[#94A3B8] block mb-1.5">Descripción</label>
            <input required value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]" placeholder="Ej: Arriendo" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-[#94A3B8] block mb-1.5">Categoría</label>
              <select value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981] capitalize">
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm text-[#94A3B8] block mb-1.5">Frecuencia</label>
              <select value={form.frecuencia} onChange={e => setForm({ ...form, frecuencia: e.target.value })}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981] capitalize">
                {FRECUENCIAS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm text-[#94A3B8] block mb-1.5">Monto</label>
            <input type="number" required min="0" step="0.01" value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]" placeholder="0" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-[#94A3B8] block mb-1.5">Fecha inicio</label>
              <input type="date" required value={form.fecha_inicio} onChange={e => setForm({ ...form, fecha_inicio: e.target.value })}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]" />
            </div>
            <div>
              <label className="text-sm text-[#94A3B8] block mb-1.5">Fecha fin <span className="text-[#475569]">(opcional)</span></label>
              <input type="date" value={form.fecha_fin} onChange={e => setForm({ ...form, fecha_fin: e.target.value })}
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
