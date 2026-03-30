import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'

import { getApiErrorMessage } from '../../api/errors'
import api from '../../api/client'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import ListControls from '../../components/ui/ListControls'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Modal from '../../components/ui/Modal'
import { useCategorias } from '../../hooks/useCategorias'
import { formatNumber } from '../../utils/formatters'
import '../../components/ui/app.css'

const FRECUENCIAS = ['diario', 'semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual']
const FREQ = { diario: 30, semanal: 4.33, quincenal: 2, mensual: 1, bimestral: 0.5, trimestral: 0.333, semestral: 0.167, anual: 0.083 }
const FRECUENCIA_STORAGE_KEY = 'gastos_corrientes_last_frecuencia'
const CATEGORIA_STORAGE_KEY = 'gastos_corrientes_last_categoria'

function getTodayDate() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function buildEmptyForm() {
  const savedFreq = typeof window !== 'undefined' ? window.localStorage.getItem(FRECUENCIA_STORAGE_KEY) : null
  const savedCategoria = typeof window !== 'undefined' ? window.localStorage.getItem(CATEGORIA_STORAGE_KEY) : null
  return {
    descripcion: '',
    categoria: savedCategoria || 'otro',
    monto: '',
    frecuencia: FRECUENCIAS.includes(savedFreq) ? savedFreq : 'mensual',
    fecha_inicio: getTodayDate(),
    fecha_fin: '',
    activo: true,
  }
}

export default function GastosCorrientes() {
  const [items, setItems] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(buildEmptyForm())
  const [editId, setEditId] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [feedback, setFeedback] = useState({ type: '', message: '' })
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const { categorias } = useCategorias()

  useEffect(() => { fetchItems() }, [])

  async function fetchItems() {
    try {
      const { data } = await api.get('/finanzas/gastos-corrientes/')
      setItems(data)
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudieron cargar los gastos corrientes.') })
    }
  }

  function openNew() {
    setForm(buildEmptyForm())
    setEditId(null)
    setShowAdvanced(false)
    setModal(true)
  }

  function openEdit(item) {
    setForm({
      descripcion: item.descripcion,
      categoria: item.categoria,
      monto: item.monto,
      frecuencia: item.frecuencia,
      fecha_inicio: item.fecha_inicio,
      fecha_fin: item.fecha_fin || '',
      activo: item.activo,
    })
    setEditId(item.id)
    setShowAdvanced(true)
    setModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setFeedback({ type: '', message: '' })
    try {
      const payload = { ...form, fecha_fin: form.fecha_fin || null }
      if (editId) await api.put(`/finanzas/gastos-corrientes/${editId}/`, payload)
      else await api.post('/finanzas/gastos-corrientes/', payload)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(FRECUENCIA_STORAGE_KEY, payload.frecuencia)
        window.localStorage.setItem(CATEGORIA_STORAGE_KEY, payload.categoria)
      }
      setModal(false)
      await fetchItems()
      setFeedback({ type: 'success', message: editId ? 'Gasto actualizado correctamente.' : 'Gasto creado correctamente.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo guardar el gasto.') })
    } finally {
      setLoading(false)
    }
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
    setFeedback({ type: '', message: '' })
    try {
      await api.delete(`/finanzas/gastos-corrientes/${id}/`)
      await fetchItems()
      setFeedback({ type: 'success', message: 'Gasto eliminado correctamente.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo eliminar el gasto.') })
    } finally {
      setDeletingId(null)
    }
  }

  const total = items.filter((i) => i.activo).reduce((s, i) => s + parseFloat(i.monto) * (FREQ[i.frecuencia] || 1), 0)

  const filteredItems = items.filter((item) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      item.descripcion.toLowerCase().includes(q)
      || item.categoria.toLowerCase().includes(q)
      || item.frecuencia.toLowerCase().includes(q)
      || String(item.monto).toLowerCase().includes(q)
    )
  })

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const paginatedItems = filteredItems.slice(start, start + pageSize)

  return (
    <div>
      <div className="page-header page-header-actions">
        <div className="page-header-main">
          <h1 className="page-title">Gastos del mes</h1>
          <p className="page-subtitle">
            Total mensual:&nbsp;
            <span style={{ color: '#F87171', fontWeight: 700 }}>
              ${formatNumber(total, { maximumFractionDigits: 0 })}
            </span>
          </p>
        </div>
        <button className="btn-add page-primary-action" onClick={openNew}><Plus size={16} /> Agregar</button>
      </div>

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      <div className="card" style={{ padding: 0 }}>
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🛒</div>
            <p className="empty-text">Todavia no tienes gastos registrados</p>
            <p className="empty-sub">Registra tus gastos recurrentes para proyectar tu flujo de caja</p>
          </div>
        ) : (
          <>
            <ListControls
              query={query}
              onQueryChange={(value) => { setQuery(value); setPage(1) }}
              placeholder="Buscar por descripcion o categoria..."
              page={safePage}
              pageCount={pageCount}
              onPrevPage={() => setPage((p) => Math.max(1, p - 1))}
              onNextPage={() => setPage((p) => Math.min(pageCount, p + 1))}
              pageSize={pageSize}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1) }}
              totalItems={items.length}
              filteredItems={filteredItems.length}
            />

            <div className="table-wrap" style={{ border: 'none', borderRadius: 20 }}>
              <table className="table">
                <thead>
                  <tr>{['Descripcion', 'Categoria', 'Monto', 'Frecuencia', 'Desde', 'Hasta', 'Estado', ''].map((h) => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {paginatedItems.map((item) => (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 600 }}>{item.descripcion}</td>
                      <td><span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{item.categoria}</span></td>
                      <td className="table-amount negative">${formatNumber(parseFloat(item.monto))}</td>
                      <td><span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{item.frecuencia}</span></td>
                      <td>{item.fecha_inicio}</td>
                      <td>{item.fecha_fin || '-'}</td>
                      <td><span className={item.activo ? 'badge badge-green' : 'badge badge-gray'}>{item.activo ? 'Activo' : 'Inactivo'}</span></td>
                      <td className="table-actions-cell">
                        <div className="table-actions-row">
                          <button className="btn-icon edit" onClick={() => openEdit(item)}><Pencil size={15} /></button>
                          <button className="btn-icon danger" disabled={deletingId === item.id} onClick={() => openDeleteConfirm(item.id)}><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar gasto' : '+ Nuevo gasto'}>
        <form onSubmit={handleSubmit}>
          {!editId && (
            <p style={{ marginTop: -8, marginBottom: 14, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              Carga rapida: descripcion, categoria y monto. Lo avanzado es opcional.
            </p>
          )}
          <div className="form-modal-group">
            <label className="form-modal-label">En que gastas?</label>
            <input className="form-modal-input" required placeholder="Ej: Arriendo, Netflix, gym..." value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
          </div>

          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">Categoria</label>
              <select className="form-modal-select" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                {categorias.length > 0
                  ? categorias.map((c) => <option key={c.nombre} value={c.nombre}>{c.icono} {c.nombre}</option>)
                  : <option value="otro">otro</option>}
              </select>
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">Cuanto?</label>
              <input className="form-modal-input" type="number" required min="0" step="0.01" placeholder="0" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
            </div>
          </div>

          {!editId && (
            <button
              type="button"
              className="btn-modal-cancel"
              onClick={() => setShowAdvanced((v) => !v)}
              style={{ width: '100%', marginBottom: 14 }}
            >
              {showAdvanced ? 'Ocultar opciones avanzadas' : 'Ver opciones avanzadas'}
            </button>
          )}

          {(editId || showAdvanced) && (
            <>
              <div className="form-modal-row">
                <div className="form-modal-group">
                  <label className="form-modal-label">Frecuencia</label>
                  <select className="form-modal-select" value={form.frecuencia} onChange={(e) => setForm({ ...form, frecuencia: e.target.value })}>
                    {FRECUENCIAS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className="form-modal-group">
                  <label className="form-modal-label">Desde cuando?</label>
                  <div className="date-input-wrap">
                    <input className="form-modal-input" type="date" required value={form.fecha_inicio} onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className="form-modal-group">
                <label className="form-modal-label">Hasta cuando? <span>(opcional)</span></label>
                <div className="date-input-wrap">
                  <input className="form-modal-input" type="date" value={form.fecha_fin} onChange={(e) => setForm({ ...form, fecha_fin: e.target.value })} />
                </div>
              </div>

              <label className="form-modal-check">
                <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
                <span>Gasto activo</span>
              </label>
            </>
          )}

          {!editId && !showAdvanced && (
            <p style={{ marginTop: -4, marginBottom: 18, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              Se guardara como gasto mensual activo desde hoy.
            </p>
          )}

          <div className="form-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={() => setModal(false)}>Cancelar</button>
            <button type="submit" className="btn-modal-save" disabled={loading}>
              {loading ? 'Guardando...' : editId ? 'Guardar cambios' : 'Agregar gasto'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Eliminar gasto"
        message="Este gasto se eliminara de tus calculos y de tu historial."
        confirmText="Eliminar"
        cancelText="Cancelar"
        loading={deletingId !== null}
        onConfirm={handleDelete}
        onClose={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}
