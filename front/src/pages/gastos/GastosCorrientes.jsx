import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import api from '../../api/client'
import Modal from '../../components/ui/Modal'
import { useCategorias } from '../../hooks/useCategorias'
import '../../components/ui/app.css'

const FRECUENCIAS = ['diario', 'semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual']
const EMPTY = { descripcion: '', categoria: 'otro', monto: '', frecuencia: 'mensual', fecha_inicio: '', fecha_fin: '', activo: true }
const FREQ  = { diario: 30, semanal: 4.33, quincenal: 2, mensual: 1, bimestral: 0.5, trimestral: 0.333, semestral: 0.167, anual: 0.083 }

export default function GastosCorrientes() {
  const [items, setItems]     = useState([])
  const [modal, setModal]     = useState(false)
  const [form, setForm]       = useState(EMPTY)
  const [editId, setEditId]   = useState(null)
  const [loading, setLoading] = useState(false)
  const { categorias }        = useCategorias()

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
      else        await api.post('/finanzas/gastos-corrientes/', payload)
      setModal(false); fetchItems()
    } finally { setLoading(false) }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar este gasto?')) return
    await api.delete(`/finanzas/gastos-corrientes/${id}/`)
    fetchItems()
  }

  const total = items.filter(i => i.activo).reduce((s, i) => s + parseFloat(i.monto) * (FREQ[i.frecuencia] || 1), 0)

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Gastos del mes</h1>
          <p className="page-subtitle">
            Total mensual:&nbsp;
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
            <div className="empty-icon">🛒</div>
            <p className="empty-text">Sin gastos registrados aún</p>
            <p className="empty-sub">Registra tus gastos recurrentes para proyectar tu flujo de caja</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 20 }}>
            <table className="table">
              <thead>
                <tr>{['Descripción','Categoría','Monto','Frecuencia','Desde','Hasta','Estado',''].map(h => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.descripcion}</td>
                    <td><span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{item.categoria}</span></td>
                    <td className="table-amount negative">${parseFloat(item.monto).toLocaleString('es-CL')}</td>
                    <td><span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{item.frecuencia}</span></td>
                    <td>{item.fecha_inicio}</td>
                    <td>{item.fecha_fin || '—'}</td>
                    <td><span className={item.activo ? 'badge badge-green' : 'badge badge-gray'}>{item.activo ? 'Activo' : 'Inactivo'}</span></td>
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

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar gasto' : '+ Nuevo gasto'}>
        <form onSubmit={handleSubmit}>
          <div className="form-modal-group">
            <label className="form-modal-label">¿En qué gastas?</label>
            <input className="form-modal-input" required placeholder="Ej: Arriendo, Netflix, gym..."
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
              <label className="form-modal-label">¿Con qué frecuencia?</label>
              <select className="form-modal-select" value={form.frecuencia} onChange={e => setForm({ ...form, frecuencia: e.target.value })}>
                {FRECUENCIAS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">¿Cuánto?</label>
            <input className="form-modal-input" type="number" required min="0" step="0.01" placeholder="0"
              value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })} />
          </div>
          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">¿Desde cuándo?</label>
              <div className="date-input-wrap">
                <input className="form-modal-input" type="date" required
                  value={form.fecha_inicio} onChange={e => setForm({ ...form, fecha_inicio: e.target.value })} />
              </div>
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">¿Hasta cuándo? <span>(opcional)</span></label>
              <div className="date-input-wrap">
                <input className="form-modal-input" type="date"
                  value={form.fecha_fin} onChange={e => setForm({ ...form, fecha_fin: e.target.value })} />
              </div>
            </div>
          </div>
          <label className="form-modal-check">
            <input type="checkbox" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} />
            <span>Gasto activo</span>
          </label>
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
