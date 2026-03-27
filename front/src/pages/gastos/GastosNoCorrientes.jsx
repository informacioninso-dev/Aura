import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import api from '../../api/client'
import Modal from '../../components/ui/Modal'
import { useCategorias } from '../../hooks/useCategorias'
import '../../components/ui/app.css'
const EMPTY = { descripcion: '', categoria: 'otro', monto: '', fecha: '', notas: '' }

export default function GastosNoCorrientes() {
  const [items, setItems]     = useState([])
  const [modal, setModal]     = useState(false)
  const [form, setForm]       = useState(EMPTY)
  const [editId, setEditId]   = useState(null)
  const [loading, setLoading] = useState(false)
  const { categorias }        = useCategorias()

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
      else        await api.post('/finanzas/gastos-no-corrientes/', form)
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
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Gastos puntuales</h1>
          <p className="page-subtitle">
            Total registrado:&nbsp;
            <span style={{ color: '#F87171', fontWeight: 700 }}>
              ${total.toLocaleString('es-CL', { maximumFractionDigits: 0 })}
            </span>
          </p>
        </div>
        <button className="btn-add" onClick={openNew}><Plus size={16} /> Agregar</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🧾</div>
            <p className="empty-text">Sin gastos puntuales registrados</p>
            <p className="empty-sub">Registra compras o gastos que no se repiten para tener el historial completo</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 20 }}>
            <table className="table">
              <thead>
                <tr>{['Descripción', 'Categoría', 'Monto', 'Fecha', 'Notas', ''].map(h => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.descripcion}</td>
                    <td><span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{item.categoria}</span></td>
                    <td className="table-amount negative">${parseFloat(item.monto).toLocaleString('es-CL')}</td>
                    <td>{item.fecha}</td>
                    <td style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>{item.notas || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn-icon edit" onClick={() => openEdit(item)}><Pencil size={15} /></button>
                        <button className="btn-icon danger" onClick={() => handleDelete(item.id)}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar gasto' : '+ Nuevo gasto puntual'}>
        <form onSubmit={handleSubmit}>
          <div className="form-modal-group">
            <label className="form-modal-label">¿En qué gastaste?</label>
            <input className="form-modal-input" required placeholder="Ej: Reparación auto, médico, ropa..."
              value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} />
          </div>
          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">Categoría</label>
              <select className="form-modal-select" value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })}>
                {categorias.map(c => <option key={c.nombre} value={c.nombre}>{c.icono} {c.nombre}</option>)}
              </select>
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">¿Cuánto?</label>
              <input className="form-modal-input" type="number" required min="0" step="0.01" placeholder="0"
                value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })} />
            </div>
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">¿Cuándo fue?</label>
            <div className="date-input-wrap">
              <input className="form-modal-input" type="date" required
                value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} />
            </div>
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">Notas <span>(opcional)</span></label>
            <textarea className="form-modal-input" rows={2} placeholder="Detalles adicionales..."
              value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })}
              style={{ resize: 'none', height: 'auto' }} />
          </div>
          <div className="form-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={() => setModal(false)}>Cancelar</button>
            <button type="submit" className="btn-modal-save" disabled={loading}>
              {loading ? 'Guardando...' : editId ? 'Guardar cambios' : 'Agregar gasto'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
