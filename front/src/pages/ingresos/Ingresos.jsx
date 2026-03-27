import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import api from '../../api/client'
import Modal from '../../components/ui/Modal'
import '../../components/ui/app.css'

const FRECUENCIAS = ['diario', 'semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual']
const EMPTY = { descripcion: '', monto: '', frecuencia: 'mensual', fecha_inicio: '', fecha_fin: '', activo: true }

const FREQ_FACTOR = { diario: 30, semanal: 4.33, quincenal: 2, mensual: 1, bimestral: 0.5, trimestral: 0.333, semestral: 0.167, anual: 0.083 }

export default function Ingresos() {
  const [items, setItems]   = useState([])
  const [modal, setModal]   = useState(false)
  const [form, setForm]     = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchItems() }, [])

  async function fetchItems() {
    const { data } = await api.get('/finanzas/ingresos/')
    setItems(data)
  }

  function openNew() { setForm(EMPTY); setEditId(null); setModal(true) }
  function openEdit(item) {
    setForm({ descripcion: item.descripcion, monto: item.monto, frecuencia: item.frecuencia, fecha_inicio: item.fecha_inicio, fecha_fin: item.fecha_fin || '', activo: item.activo })
    setEditId(item.id); setModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = { ...form, fecha_fin: form.fecha_fin || null }
      if (editId) await api.put(`/finanzas/ingresos/${editId}/`, payload)
      else await api.post('/finanzas/ingresos/', payload)
      setModal(false)
      fetchItems()
    } finally { setLoading(false) }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar este ingreso?')) return
    await api.delete(`/finanzas/ingresos/${id}/`)
    fetchItems()
  }

  const total = items.filter(i => i.activo).reduce((s, i) =>
    s + parseFloat(i.monto) * (FREQ_FACTOR[i.frecuencia] || 1), 0)

  return (
    <div>
      {/* ── HEADER ── */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Ingresos</h1>
          <p className="page-subtitle">
            Total mensual estimado:&nbsp;
            <span style={{ color: '#10B981', fontWeight: 700 }}>
              ${total.toLocaleString('es-CL', { maximumFractionDigits: 0 })}
            </span>
          </p>
        </div>
        <button className="btn-add" onClick={openNew}>
          <Plus size={16} /> Agregar
        </button>
      </div>

      {/* ── TABLA ── */}
      <div className="card" style={{ padding: 0 }}>
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">💰</div>
            <p className="empty-text">Aún no tienes ingresos registrados</p>
            <p className="empty-sub">Agrega tu primer ingreso para empezar a proyectar tu flujo de caja</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 20 }}>
            <table className="table">
              <thead>
                <tr>
                  {['Descripción', 'Monto', 'Frecuencia', 'Desde', 'Hasta', 'Estado', ''].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.descripcion}</td>
                    <td className="table-amount positive">${parseFloat(item.monto).toLocaleString('es-CL')}</td>
                    <td><span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{item.frecuencia}</span></td>
                    <td>{item.fecha_inicio}</td>
                    <td>{item.fecha_fin || '—'}</td>
                    <td>
                      <span className={item.activo ? 'badge badge-green' : 'badge badge-gray'}>
                        {item.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
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

      {/* ── MODAL ── */}
      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar ingreso' : '+ Nuevo ingreso'}>
        <form onSubmit={handleSubmit}>

          <div className="form-modal-group">
            <label className="form-modal-label">¿De qué es este ingreso?</label>
            <input
              className="form-modal-input"
              required
              placeholder="Ej: Sueldo, freelance, arriendo..."
              value={form.descripcion}
              onChange={e => setForm({ ...form, descripcion: e.target.value })}
            />
          </div>

          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">Monto</label>
              <input
                className="form-modal-input"
                type="number"
                required
                min="0"
                step="0.01"
                placeholder="0"
                value={form.monto}
                onChange={e => setForm({ ...form, monto: e.target.value })}
              />
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">¿Con qué frecuencia?</label>
              <select
                className="form-modal-select"
                value={form.frecuencia}
                onChange={e => setForm({ ...form, frecuencia: e.target.value })}
              >
                {FRECUENCIAS.map(f => <option key={f} value={f} style={{ textTransform: 'capitalize' }}>{f}</option>)}
              </select>
            </div>
          </div>

          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">¿Desde cuándo?</label>
              <div className="date-input-wrap">
                <input
                  className="form-modal-input"
                  type="date"
                  required
                  value={form.fecha_inicio}
                  onChange={e => setForm({ ...form, fecha_inicio: e.target.value })}
                />
              </div>
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">¿Hasta cuándo? <span>(opcional)</span></label>
              <div className="date-input-wrap">
                <input
                  className="form-modal-input"
                  type="date"
                  value={form.fecha_fin}
                  onChange={e => setForm({ ...form, fecha_fin: e.target.value })}
                />
              </div>
            </div>
          </div>

          <label className="form-modal-check">
            <input
              type="checkbox"
              checked={form.activo}
              onChange={e => setForm({ ...form, activo: e.target.checked })}
            />
            <span>Ingreso activo</span>
          </label>

          <div className="form-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={() => setModal(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-modal-save" disabled={loading}>
              {loading ? 'Guardando...' : editId ? 'Guardar cambios' : 'Agregar ingreso'}
            </button>
          </div>

        </form>
      </Modal>
    </div>
  )
}
