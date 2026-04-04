import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import api from '../../api/client'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import DateQuickActions from '../../components/ui/DateQuickActions'
import Modal from '../../components/ui/Modal'
import { useCategorias } from '../../hooks/useCategorias'
import { DATE_INPUT_MAX, DATE_INPUT_MIN } from '../../utils/dateBounds'
import { formatAmount } from '../../utils/formatters'
import '../../components/ui/app.css'
const EMPTY = { descripcion: '', categoria: 'otro', monto_total: '', num_cuotas: '', cuota_mensual: '', fecha_inicio: '', fecha_fin: '', activo: true }

function parseLocalDate(value) {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatDateLocal(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getTodayDate() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export default function Diferidos() {
  const [items, setItems]     = useState([])
  const [modal, setModal]     = useState(false)
  const [form, setForm]       = useState(EMPTY)
  const [editId, setEditId]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const { categorias }        = useCategorias()

  useEffect(() => { fetchItems() }, [])

  async function fetchItems() {
    const { data } = await api.get('/finanzas/diferidos/')
    setItems(data)
  }

  function calcularCuota(monto, cuotas) {
    if (monto && cuotas && parseFloat(cuotas) > 0)
      return (parseFloat(monto) / parseFloat(cuotas)).toFixed(2)
    return ''
  }

  function calcularFechaFin(fechaInicio, numCuotas) {
    if (!fechaInicio || !numCuotas || parseInt(numCuotas) <= 0) return ''
    const d = parseLocalDate(fechaInicio)
    d.setMonth(d.getMonth() + (parseInt(numCuotas, 10) - 1))
    return formatDateLocal(d)
  }

  function handleMontoOrCuotas(field, value) {
    const updated = { ...form, [field]: value }
    updated.cuota_mensual = calcularCuota(
      field === 'monto_total' ? value : form.monto_total,
      field === 'num_cuotas'  ? value : form.num_cuotas
    )
    const cuotas    = field === 'num_cuotas'    ? value : form.num_cuotas
    const fechaIni  = form.fecha_inicio
    updated.fecha_fin = calcularFechaFin(fechaIni, cuotas)
    setForm(updated)
  }

  function handleFechaInicio(value) {
    setForm(prev => ({
      ...prev,
      fecha_inicio: value,
      fecha_fin: calcularFechaFin(value, prev.num_cuotas),
    }))
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
      else        await api.post('/finanzas/diferidos/', form)
      setModal(false); fetchItems()
    } finally { setLoading(false) }
  }

  function openDeleteConfirm(id) {
    if (deletingId) return
    setConfirmDeleteId(id)
  }

  async function handleDelete() {
    const id = confirmDeleteId
    if (!id || deletingId) return
    setConfirmDeleteId(null)
    setDeletingId(id)
    try {
      await api.delete(`/finanzas/diferidos/${id}/`)
      fetchItems()
    } finally {
      setDeletingId(null)
    }
  }

  const hoy = getTodayDate()
  const totalMensual = items
    .filter((i) => i.activo && i.fecha_inicio <= hoy && i.fecha_fin >= hoy)
    .reduce((s, i) => s + parseFloat(i.cuota_mensual), 0)

  function progreso(item) {
    const ini  = parseLocalDate(item.fecha_inicio)
    const fin  = parseLocalDate(item.fecha_fin)
    const hoy  = new Date()
    const total  = (fin - ini) / (1000 * 60 * 60 * 24 * 30)
    const pasado = (hoy - ini) / (1000 * 60 * 60 * 24 * 30)
    return Math.min(100, Math.max(0, Math.round((pasado / total) * 100)))
  }

  return (
    <div>
      <div className="page-header page-header-actions">
        <div className="page-header-main">
          <h1 className="page-title">Gastos a cuotas</h1>
          <p className="page-subtitle">
            Total al mes:&nbsp;
            <span style={{ color: '#C487F6', fontWeight: 700 }}>
              ${formatAmount(totalMensual)}
            </span>
          </p>
        </div>
        <button className="btn-add page-primary-action" onClick={openNew}><Plus size={16} /> Agregar</button>
      </div>

      {items.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">💳</div>
            <p className="empty-text">No hay gastos a cuotas</p>
            <p className="empty-sub">Suma una compra a cuotas y la ves en tu flujo</p>
          </div>
        </div>
      ) : (
        <div className="diferidos-grid-responsive">
          {items.map(item => {
            const pct = progreso(item)
            return (
              <div key={item.id} className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <p style={{ fontWeight: 700, color: '#fff', marginBottom: 2 }}>{item.descripcion}</p>
                    <span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{item.categoria}</span>
                  </div>
                  <div className="table-actions-row">
                    <button className="btn-icon edit" onClick={() => openEdit(item)}><Pencil size={14} /></button>
                    <button className="btn-icon danger" disabled={deletingId === item.id} onClick={() => openDeleteConfirm(item.id)}><Trash2 size={14} /></button>
                  </div>
                </div>

                <div className="diferido-card-summary">
                  <div>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 2 }}>Total</p>
                    <p style={{ fontWeight: 600, color: '#fff' }}>${formatAmount(parseFloat(item.monto_total))}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 2 }}>Cuota al mes</p>
                    <p style={{ fontWeight: 700, color: '#C487F6' }}>${formatAmount(parseFloat(item.cuota_mensual))}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 2 }}>Cuotas</p>
                    <p style={{ color: 'rgba(255,255,255,0.65)' }}>{item.num_cuotas}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 2 }}>Vence</p>
                    <p style={{ color: 'rgba(255,255,255,0.65)' }}>{item.fecha_fin}</p>
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>
                    <span>Progreso</span><span>{pct}%</span>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 99, height: 6 }}>
                    <div style={{ width: `${pct}%`, height: 6, borderRadius: 99, background: 'linear-gradient(90deg, #C487F6, #10B981)', transition: 'width 0.4s' }} />
                  </div>
                </div>

                {!item.activo && (
                  <span className="badge badge-gray" style={{ marginTop: 10, display: 'inline-block' }}>Inactivo</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar gasto a cuotas' : '+ Nuevo gasto a cuotas'}>
        <form onSubmit={handleSubmit}>
          <div className="form-modal-group">
            <label className="form-modal-label">Que estas pagando?</label>
            <input className="form-modal-input" required placeholder="Ej: celular, viaje, credito..."
              value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} />
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">Categoria</label>
            <select className="form-modal-select" value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })}>
              {categorias.map(c => <option key={c.nombre} value={c.nombre}>{c.icono} {c.nombre}</option>)}
            </select>
          </div>
          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">Monto total</label>
              <input className="form-modal-input" type="number" required min="0" step="0.01" placeholder="0"
                value={form.monto_total} onChange={e => handleMontoOrCuotas('monto_total', e.target.value)} />
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">Numero de cuotas</label>
              <input className="form-modal-input" type="number" required min="1" placeholder="12"
                value={form.num_cuotas} onChange={e => handleMontoOrCuotas('num_cuotas', e.target.value)} />
            </div>
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">Cuota al mes</label>
            <input className="form-modal-input" type="number" required min="0" step="0.01" placeholder="Se calcula automatico"
              value={form.cuota_mensual} onChange={e => setForm({ ...form, cuota_mensual: e.target.value })} />
          </div>
          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">Empieza en</label>
              <div className="date-input-wrap">
                <input className="form-modal-input" type="date" required min={DATE_INPUT_MIN} max={DATE_INPUT_MAX}
                  value={form.fecha_inicio} onChange={e => handleFechaInicio(e.target.value)} />
              </div>
              <DateQuickActions value={form.fecha_inicio} onChange={handleFechaInicio} disabled={loading} />
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">Termina en <span>(auto)</span></label>
              <div className="date-input-wrap">
                <input className="form-modal-input" type="date" required min={form.fecha_inicio || DATE_INPUT_MIN} max={DATE_INPUT_MAX}
                  value={form.fecha_fin} onChange={e => setForm({ ...form, fecha_fin: e.target.value })}
                  style={form.fecha_fin ? { borderColor: 'rgba(196,135,246,0.40)' } : {}} />
              </div>
            </div>
          </div>
          {editId ? (
            <label className="form-modal-check">
              <input type="checkbox" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} />
              <span>Activo en tu flujo</span>
            </label>
          ) : (
            <div
              style={{
                marginTop: 4,
                marginBottom: 8,
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(196,135,246,0.18)',
                background: 'rgba(196,135,246,0.06)',
                fontSize: 13,
                color: 'rgba(255,255,255,0.72)',
              }}
            >
              Esta cuota se sumara automaticamente a tu flujo mensual.
            </div>
          )}
          <div className="form-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={() => setModal(false)}>Cancelar</button>
            <button type="submit" className="btn-modal-save" disabled={loading}>
              {loading ? 'Guardando...' : editId ? 'Guardar cambios' : 'Agregar gasto a cuotas'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Eliminar gasto a cuotas"
        message="Este gasto a cuotas se eliminara de tu flujo y del historial."
        confirmText="Eliminar"
        cancelText="Cancelar"
        loading={deletingId !== null}
        onConfirm={handleDelete}
        onClose={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}
