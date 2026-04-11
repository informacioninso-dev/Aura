import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'

import { getApiErrorMessage } from '../../api/errors'
import api from '../../api/client'
import { useAuth } from '../../context/useAuth'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import ListControls from '../../components/ui/ListControls'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import DateQuickActions from '../../components/ui/DateQuickActions'
import Modal from '../../components/ui/Modal'
import { useCategorias } from '../../hooks/useCategorias'
import { DATE_INPUT_MIN } from '../../utils/dateBounds'
import { formatAmount } from '../../utils/formatters'
import '../../components/ui/app.css'

const CATEGORIA_STORAGE_KEY = 'gastos_puntuales_last_categoria'
const FUTURE_EXPENSE_MESSAGE = 'Los gastos futuros no se cargan aqui. Simulalos desde el simulador con tasa 0%.'

function getTodayDate() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function buildEmptyForm() {
  const savedCategoria = typeof window !== 'undefined' ? window.localStorage.getItem(CATEGORIA_STORAGE_KEY) : null
  return {
    descripcion: '',
    categoria: savedCategoria || 'otro',
    monto: '',
    fecha: getTodayDate(),
    notas: '',
    incluir_en_proyeccion: true,
  }
}

export default function GastosNoCorrientes({ embedded = false }) {
  const { user } = useAuth()
  const maxExpenseDate = getTodayDate()
  const [items, setItems] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(buildEmptyForm())
  const [editId, setEditId] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [converting, setConverting] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [feedback, setFeedback] = useState({ type: '', message: '' })
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [confirmConvert, setConfirmConvert] = useState(false)
  const { categorias } = useCategorias()
  const canCustomizeProjection = Boolean(user?.feature_access?.advanced_projection_enabled)

  useEffect(() => { fetchItems() }, [])

  function clampExpenseDate(value) {
    if (!value) return value
    return value > maxExpenseDate ? maxExpenseDate : value
  }

  async function fetchItems() {
    try {
      const { data } = await api.get('/finanzas/gastos-no-corrientes/')
      setItems(data)
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudieron cargar los gastos puntuales.') })
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
      fecha: item.fecha,
      notas: item.notas || '',
      incluir_en_proyeccion: item.incluir_en_proyeccion !== false,
    })
    setEditId(item.id)
    setShowAdvanced(true)
    setModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    if (form.fecha > maxExpenseDate) {
      setFeedback({ type: 'error', message: FUTURE_EXPENSE_MESSAGE })
      return
    }
    setLoading(true)
    setFeedback({ type: '', message: '' })
    try {
      if (editId) await api.put(`/finanzas/gastos-no-corrientes/${editId}/`, form)
      else await api.post('/finanzas/gastos-no-corrientes/', form)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(CATEGORIA_STORAGE_KEY, form.categoria)
      }
      setModal(false)
      await fetchItems()
      setFeedback({ type: 'success', message: editId ? 'Gasto puntual actualizado correctamente.' : 'Gasto puntual creado correctamente.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo guardar el gasto puntual.') })
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
      await api.delete(`/finanzas/gastos-no-corrientes/${id}/`)
      await fetchItems()
      setFeedback({ type: 'success', message: 'Gasto puntual eliminado correctamente.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo eliminar el gasto puntual.') })
    } finally {
      setDeletingId(null)
    }
  }

  const total = items.reduce((s, i) => s + parseFloat(i.monto), 0)

  const filteredItems = items.filter((item) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      item.descripcion.toLowerCase().includes(q)
      || item.categoria.toLowerCase().includes(q)
      || (item.notas || '').toLowerCase().includes(q)
      || String(item.monto).toLowerCase().includes(q)
    )
  })

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const paginatedItems = filteredItems.slice(start, start + pageSize)
  const projectionStatusLabel = (item) => (item.incluir_en_proyeccion === false ? 'Fuera de proyeccion' : 'En proyeccion')

  const bulkDeleteMax = user?.feature_access?.bulk_delete_max ?? 10
  const allPageSelected = paginatedItems.length > 0 && paginatedItems.every((i) => selectedIds.has(i.id))

  function toggleSelectAll() {
    if (allPageSelected) {
      setSelectedIds((prev) => { const next = new Set(prev); paginatedItems.forEach((i) => next.delete(i.id)); return next })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        let count = next.size
        for (const i of paginatedItems) {
          if (next.has(i.id)) continue
          if (count >= bulkDeleteMax) break
          next.add(i.id)
          count++
        }
        return next
      })
      if (paginatedItems.filter((i) => !selectedIds.has(i.id)).length + selectedIds.size > bulkDeleteMax) {
        setFeedback({ type: 'error', message: `Tu plan permite seleccionar hasta ${bulkDeleteMax} registros a la vez.` })
      }
    }
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      if (prev.has(id)) {
        const next = new Set(prev); next.delete(id); return next
      }
      if (prev.size >= bulkDeleteMax) {
        setFeedback({ type: 'error', message: `Tu plan permite seleccionar hasta ${bulkDeleteMax} registros a la vez.` })
        return prev
      }
      const next = new Set(prev); next.add(id); return next
    })
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    setConfirmBulkDelete(false)
    setFeedback({ type: '', message: '' })
    const ids = [...selectedIds]
    let errors = 0
    for (const id of ids) {
      try { await api.delete(`/finanzas/gastos-no-corrientes/${id}/`) } catch { errors++ }
    }
    setSelectedIds(new Set())
    await fetchItems()
    setBulkDeleting(false)
    if (errors === 0) setFeedback({ type: 'success', message: `${ids.length} gasto${ids.length !== 1 ? 's' : ''} eliminado${ids.length !== 1 ? 's' : ''}.` })
    else setFeedback({ type: 'error', message: `Se eliminaron ${ids.length - errors} de ${ids.length}. Algunos fallaron.` })
  }

  async function handleConvertToFijo() {
    if (!editId || converting) return
    setConverting(true)
    setConfirmConvert(false)
    setFeedback({ type: '', message: '' })
    try {
      await api.post(`/finanzas/gastos-no-corrientes/${editId}/convertir_a_fijo/`, {
        descripcion: form.descripcion,
        categoria: form.categoria,
        monto: form.monto,
        fecha_inicio: form.fecha,
      })
      setModal(false)
      await fetchItems()
      setFeedback({ type: 'success', message: 'Listo. Ahora lo veras en Gastos fijos.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo convertir el gasto a fijo.') })
    } finally {
      setConverting(false)
    }
  }

  return (
    <div>
      {embedded ? (
        <div className="finance-panel-header">
          <div>
            <h2 className="finance-panel-kicker">Gastos puntuales</h2>
            <p className="finance-panel-kpi">
              Total cargado:&nbsp;
              <span style={{ color: '#F87171', fontWeight: 700 }}>
                ${formatAmount(total)}
              </span>
            </p>
          </div>
          <button className="btn-add page-primary-action" onClick={openNew}><Plus size={16} /> Agregar</button>
        </div>
      ) : (
        <div className="page-header page-header-actions">
          <div className="page-header-main">
            <h1 className="page-title">Gastos puntuales</h1>
            <p className="page-subtitle">
              Total cargado:&nbsp;
              <span style={{ color: '#F87171', fontWeight: 700 }}>
                ${formatAmount(total)}
              </span>
            </p>
          </div>
          <button className="btn-add page-primary-action" onClick={openNew}><Plus size={16} /> Agregar</button>
        </div>
      )}

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      <div className="card" style={{ padding: 0 }}>
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🧾</div>
            <p className="empty-text">No hay gastos puntuales</p>
            <p className="empty-sub">Suma compras, salidas o imprevistos</p>
          </div>
        ) : (
          <>
            <ListControls
              query={query}
              onQueryChange={(value) => { setQuery(value); setPage(1); setSelectedIds(new Set()) }}
              placeholder="Buscar por descripcion, categoria o nota..."
              page={safePage}
              pageCount={pageCount}
              onPrevPage={() => setPage((p) => Math.max(1, p - 1))}
              onNextPage={() => setPage((p) => Math.min(pageCount, p + 1))}
              pageSize={pageSize}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1) }}
              totalItems={items.length}
              filteredItems={filteredItems.length}
            />

            {selectedIds.size > 0 && (
              <div className="table-bulk-bar">
                <span className="table-bulk-info">{selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}</span>
                <div className="table-bulk-actions">
                  <button className="btn-modal-danger table-bulk-danger" disabled={bulkDeleting} onClick={() => setConfirmBulkDelete(true)}>
                    {bulkDeleting ? 'Eliminando...' : 'Eliminar seleccionados'}
                  </button>
                  <button className="btn-modal-cancel table-bulk-cancel" onClick={() => setSelectedIds(new Set())}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            <div className="table-wrap" style={{ border: 'none', borderRadius: 20 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 36, paddingRight: 0 }}>
                      <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} style={{ cursor: 'pointer', accentColor: '#C487F6' }} />
                    </th>
                    {['Nombre', 'Categoria', 'Monto', 'Fecha', 'Notas', ''].map((h) => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map((item) => (
                    <tr key={item.id}>
                      <td style={{ width: 36, paddingRight: 0 }}>
                        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} style={{ cursor: 'pointer', accentColor: '#C487F6' }} />
                      </td>
                      <td>
                        <div className="table-title-stack">
                          <span style={{ fontWeight: 600 }}>{item.descripcion}</span>
                          {canCustomizeProjection && (
                            <span className={`table-row-badge ${item.incluir_en_proyeccion === false ? 'is-muted' : 'is-active'}`}>
                              {projectionStatusLabel(item)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td><span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{item.categoria}</span></td>
                      <td className="table-amount negative">${formatAmount(parseFloat(item.monto))}</td>
                      <td>{item.fecha}</td>
                      <td style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>{item.notas || '-'}</td>
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

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar gasto' : '+ Nuevo gasto puntual'}>
        <form onSubmit={handleSubmit}>
          {!editId && (
            <p style={{ marginTop: -8, marginBottom: 14, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              Carga rapida: nombre, categoria y monto. Lo demas es opcional.
            </p>
          )}
          <div className="form-modal-group">
            <label className="form-modal-label">En que se fue?</label>
            <input className="form-modal-input" required placeholder="Ej: Reparacion auto, medico, ropa..." value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
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
              <label className="form-modal-label">Monto</label>
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
              {showAdvanced ? 'Ocultar opciones' : canCustomizeProjection ? 'Ver fecha, notas y proyeccion' : 'Ver mas opciones'}
            </button>
          )}

          {!editId && !showAdvanced && canCustomizeProjection && (
            <p style={{ marginTop: -4, marginBottom: 14, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              Aqui tambien puedes decidir si este gasto puntual entra o no en tu proyeccion personalizada.
            </p>
          )}

          {(editId || showAdvanced) && (
            <>
              <div className="form-modal-group">
                <label className="form-modal-label">Fecha</label>
                <div className="date-input-wrap">
                  <input className="form-modal-input" type="date" required min={DATE_INPUT_MIN} max={maxExpenseDate} value={form.fecha} onChange={(e) => setForm({ ...form, fecha: clampExpenseDate(e.target.value) })} />
                </div>
                <DateQuickActions value={form.fecha} onChange={(value) => setForm({ ...form, fecha: clampExpenseDate(value) })} disabled={loading} />
                <p style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45 }}>
                  Si este gasto todavia no pasa, simulalo en el simulador con tasa 0% en lugar de dejarlo futuro aqui.
                </p>
              </div>
              <div className="form-modal-group">
                <label className="form-modal-label">Notas <span>(opcional)</span></label>
                <textarea className="form-modal-input" rows={2} placeholder="Detalles adicionales..." value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} style={{ resize: 'none', height: 'auto' }} />
              </div>
              {canCustomizeProjection && (
                <div className="form-modal-group" style={{ marginTop: -2 }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={form.incluir_en_proyeccion}
                      onChange={(e) => setForm({ ...form, incluir_en_proyeccion: e.target.checked })}
                      style={{ marginTop: 3, accentColor: '#C487F6' }}
                    />
                    <div>
                      <div className="form-modal-label" style={{ marginBottom: 4 }}>Usar en mi proyeccion personalizada</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.45 }}>
                        Solo aplica en modo Personalizada. Dejalo activo si este gasto puntual podria repetirse; apagalo para viajes u otros casos especiales.
                      </div>
                    </div>
                  </label>
                </div>
              )}
            </>
          )}

          {!editId && !showAdvanced && (
            <p style={{ marginTop: -4, marginBottom: 18, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              Si no cambias nada, queda con fecha de hoy. Si es para mas adelante, simulalo en el simulador con tasa 0%.
            </p>
          )}

          {editId && (
            <div className="form-modal-convert-block">
              <div className="form-modal-convert-copy">
                <span className="form-modal-convert-title">Cambiar tipo de movimiento</span>
                <span className="form-modal-convert-text">
                  Si esto se repite todos los meses, puedes pasarlo a fijo y luego ajustar la frecuencia si hace falta.
                </span>
              </div>
              <button
                type="button"
                className="btn-modal-convert"
                onClick={() => setConfirmConvert(true)}
                disabled={loading || converting}
              >
                {converting ? 'Convirtiendo...' : 'Pasar a fijo'}
              </button>
            </div>
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
        open={confirmConvert}
        title="Pasar a gasto fijo"
        message={`Se creara como gasto fijo mensual desde ${form.fecha || 'la fecha actual'} y este gasto puntual se eliminara. Luego podras ajustar la frecuencia si hace falta.`}
        confirmText="Convertir"
        cancelText="Cancelar"
        loading={converting}
        onConfirm={handleConvertToFijo}
        onClose={() => setConfirmConvert(false)}
      />

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Eliminar gasto puntual"
        message="Este gasto puntual se eliminara de tus reportes y de tu historial."
        confirmText="Eliminar"
        cancelText="Cancelar"
        loading={deletingId !== null}
        onConfirm={handleDelete}
        onClose={() => setConfirmDeleteId(null)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Eliminar seleccionados"
        message={`Se eliminaran ${selectedIds.size} gasto${selectedIds.size !== 1 ? 's' : ''}. Esta accion no se puede deshacer.`}
        confirmText="Eliminar todos"
        cancelText="Cancelar"
        loading={bulkDeleting}
        onConfirm={handleBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
      />
    </div>
  )
}
