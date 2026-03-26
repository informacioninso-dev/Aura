import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Wallet } from 'lucide-react'
import api from '../../api/client'
import Modal from '../../components/ui/Modal'

const CATEGORIAS = ['vivienda', 'alimentacion', 'transporte', 'salud', 'educacion', 'entretenimiento', 'ropa', 'servicios', 'tecnologia', 'deudas', 'ahorro', 'otro']
const EMPTY = { descripcion: '', categoria: 'otro', monto: '', fecha: '', notas: '' }

export default function GastosNoCorrientes() {
  const [items, setItems] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchItems() }, [])

  async function fetchItems() {
    const { data } = await api.get('/finanzas/gastos-no-corrientes/')
    setItems(data)
  }

  function openNew() { setForm(EMPTY); setEditId(null); setModal(true) }
  function openEdit(item) {
    setForm({ descripcion: item.descripcion, categoria: item.categoria, monto: item.monto, fecha: item.fecha, notas: item.notas || '' })
    setEditId(item.id); setModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault(); setLoading(true)
    try {
      if (editId) await api.put(`/finanzas/gastos-no-corrientes/${editId}/`, form)
      else await api.post('/finanzas/gastos-no-corrientes/', form)
      setModal(false); fetchItems()
    } finally { setLoading(false) }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar este gasto?')) return
    await api.delete(`/finanzas/gastos-no-corrientes/${id}/`)
    fetchItems()
  }

  const total = items.reduce((s, i) => s + parseFloat(i.monto), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Gastos No Corrientes</h1>
          <p className="text-[#94A3B8] text-sm mt-1">Total registrado: <span className="text-amber-400 font-semibold">${total.toLocaleString('es-CL', { maximumFractionDigits: 0 })}</span></p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 bg-[#10B981] hover:bg-[#059669] text-white font-medium px-4 py-2 rounded-lg transition-colors">
          <Plus size={16} /> Agregar
        </button>
      </div>

      <div className="bg-[#1E293B] rounded-xl border border-[#334155] overflow-hidden">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#475569]">
            <Wallet size={32} className="mb-2" />
            <p>No hay gastos no corrientes registrados</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#334155]">
                {['Descripción', 'Categoría', 'Monto', 'Fecha', 'Notas', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-[#475569] uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b border-[#334155]/50 hover:bg-[#334155]/20 transition-colors">
                  <td className="px-4 py-3 text-white text-sm">{item.descripcion}</td>
                  <td className="px-4 py-3 text-[#94A3B8] text-sm capitalize">{item.categoria}</td>
                  <td className="px-4 py-3 text-amber-400 font-semibold text-sm">${parseFloat(item.monto).toLocaleString('es-CL')}</td>
                  <td className="px-4 py-3 text-[#94A3B8] text-sm">{item.fecha}</td>
                  <td className="px-4 py-3 text-[#475569] text-sm truncate max-w-[150px]">{item.notas || '—'}</td>
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

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar gasto' : 'Nuevo gasto no corriente'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-[#94A3B8] block mb-1.5">Descripción</label>
            <input required value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]" placeholder="Ej: Reparación auto" />
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
              <label className="text-sm text-[#94A3B8] block mb-1.5">Monto</label>
              <input type="number" required min="0" step="0.01" value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]" placeholder="0" />
            </div>
          </div>
          <div>
            <label className="text-sm text-[#94A3B8] block mb-1.5">Fecha</label>
            <input type="date" required value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]" />
          </div>
          <div>
            <label className="text-sm text-[#94A3B8] block mb-1.5">Notas <span className="text-[#475569]">(opcional)</span></label>
            <textarea rows={2} value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981] resize-none" placeholder="..." />
          </div>
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
