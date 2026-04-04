import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'

import { getApiErrorMessage } from '../../api/errors'
import api from '../../api/client'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import ListControls from '../../components/ui/ListControls'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import DateQuickActions from '../../components/ui/DateQuickActions'
import Modal from '../../components/ui/Modal'
import { DATE_INPUT_MAX, DATE_INPUT_MIN } from '../../utils/dateBounds'
import { formatNumber } from '../../utils/formatters'
import '../../components/ui/app.css'

function getTodayDate() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function buildEmptyForm() {
  return {
    descripcion: '',
    monto: '',
    fecha: getTodayDate(),
    notas: '',
  }
}

export default function IngresosPuntuales({ embedded = false }) {
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
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  useEffect(() => { fetchItems() }, [])

  async function fetchItems() {
    try {
      const { data } = await api.get('/finanzas/ingresos-puntuales/')
      setItems(data)
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudieron cargar los ingresos puntuales.') })
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
      monto: item.monto,
      fecha: item.fecha,
      notas: item.notas || '',
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
      if (editId) await api.put(`/finanzas/ingresos-puntuales/${editId}/`, form)
      else await api.post('/finanzas/ingresos-puntuales/', form)
      setModal(false)
      await fetchItems()
      setFeedback({
        type: 'success',
        message: editId ? 'Ingreso puntual actualizado correctamente.' : 'Ingreso puntual creado correctamente.',
      })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo guardar el ingreso puntual.') })
    } finally {
      setLoading(false)
    }
  }

  function askDelete(id) {
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
      await api.delete(`/finanzas/ingresos-puntuales/${id}/`)
      await fetchItems()
      setFeedback({ type: 'success', message: 'Ingreso puntual eliminado correctamente.' })
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo eliminar el ingreso puntual.') })
    } finally {
      setDeletingId(null)
    }
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    const currentIds = paginated.map((item) => item.id)
    const allSelected = currentIds.every((id) => selectedIds.has(id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      currentIds.forEach((id) => {
        if (allSelected) next.delete(id)
        else next.add(id)
      })
      return next
    })
  }

  async function handleBulkDelete() {
    if (bulkDeleting) return
    setBulkDeleting(true)
    const ids = [...selectedIds]
    let errors = 0
    for (const id of ids) {
      try { await api.delete(`/finanzas/ingresos-puntuales/${id}/`) } catch { errors++ }
    }
    setSelectedIds(new Set())
    await fetchItems()
    setBulkDeleting(false)
    if (errors === 0) setFeedback({ type: 'success', message: `${ids.length} ingreso${ids.length !== 1 ? 's' : ''} eliminado${ids.length !== 1 ? 's' : ''}.` })
    else setFeedback({ type: 'error', message: `Se eliminaron ${ids.length - errors} de ${ids.length}. Algunos fallaron.` })
  }

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = items.filter((item) => (
    item.descripcion.toLowerCase().includes(normalizedQuery)
    || (item.notas || '').toLowerCase().includes(normalizedQuery)
    || item.fecha.includes(normalizedQuery)
  ))
  const total = filtered.reduce((sum, item) => sum + parseFloat(item.monto), 0)
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const paginated = filtered.slice(start, start + pageSize)
  const pageAllSelected = paginated.length > 0 && paginated.every((item) => selectedIds.has(item.id))

  return (
    <div>
      {embedded ? (
        <div className="finance-panel-header">
          <div>
            <h2 className="finance-panel-kicker">Ingresos puntuales</h2>
            <p className="finance-panel-kpi">
              Total cargado:&nbsp;
              <span style={{ color: '#10B981', fontWeight: 700 }}>
                ${formatNumber(total, { maximumFractionDigits: 0 })}
              </span>
            </p>
          </div>
          <button className="btn-add page-primary-action" onClick={openNew}><Plus size={16} /> Agregar</button>
        </div>
      ) : (
        <div className="page-header page-header-actions">
          <div className="page-header-main">
            <h1 className="page-title">Ingresos puntuales</h1>
            <p className="page-subtitle">
              Total cargado:&nbsp;
              <span style={{ color: '#10B981', fontWeight: 700 }}>
                ${formatNumber(total, { maximumFractionDigits: 0 })}
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
            <div className="empty-icon">$</div>
            <p className="empty-text">No hay ingresos puntuales</p>
            <p className="empty-sub">Suma bonos, ventas o extras</p>
          </div>
        ) : (
          <>
            <ListControls
              query={query}
              onQueryChange={(value) => { setQuery(value); setPage(1); setSelectedIds(new Set()) }}
              placeholder="Buscar por descripcion, fecha o nota..."
              page={safePage}
              pageCount={pageCount}
              onPrevPage={() => setPage((p) => Math.max(1, p - 1))}
              onNextPage={() => setPage((p) => Math.min(pageCount, p + 1))}
              pageSize={pageSize}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); setSelectedIds(new Set()) }}
              totalItems={items.length}
              filteredItems={filtered.length}
            />

            {selectedIds.size > 0 && (
              <div className="bulk-actions-bar">
                <span>{selectedIds.size} seleccionado(s)</span>
                <button className="btn-modal-danger" type="button" onClick={() => setConfirmBulkDelete(true)}>
                  Eliminar seleccionados
                </button>
              </div>
            )}

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 42 }}>
                      <input type="checkbox" checked={pageAllSelected} onChange={toggleSelectAll} />
                    </th>
                    <th>Nombre</th>
                    <th>Fecha</th>
                    <th>Notas</th>
                    <th style={{ textAlign: 'right' }}>Monto</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} />
                      </td>
                      <td style={{ fontWeight: 600 }}>{item.descripcion}</td>
                      <td>{item.fecha}</td>
                      <td style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{item.notas || '-'}</td>
                      <td className="table-amount positive">${formatNumber(parseFloat(item.monto))}</td>
                      <td className="table-actions-cell">
                        <button className="btn-icon" onClick={() => openEdit(item)}><Pencil size={15} /></button>
                        <button className="btn-icon danger" disabled={deletingId === item.id} onClick={() => askDelete(item.id)}>
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar ingreso' : '+ Nuevo ingreso puntual'}>
        <form onSubmit={handleSubmit}>
          {!editId && (
            <p style={{ marginTop: -8, marginBottom: 14, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              Carga rapida: nombre y monto. Lo demas es opcional.
            </p>
          )}
          <div className="form-modal-group">
            <label className="form-modal-label">De donde entro?</label>
            <input className="form-modal-input" required placeholder="Ej: Bono, venta, devolucion..." value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">Monto</label>
            <input className="form-modal-input" type="number" required min="0" step="0.01" placeholder="0" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
          </div>

          {!editId && (
            <button
              type="button"
              className="btn-modal-cancel"
              onClick={() => setShowAdvanced((v) => !v)}
              style={{ width: '100%', marginBottom: 14 }}
            >
              {showAdvanced ? 'Ocultar opciones' : 'Ver mas opciones'}
            </button>
          )}

          {(editId || showAdvanced) && (
            <>
              <div className="form-modal-group">
                <label className="form-modal-label">Fecha</label>
                <div className="date-input-wrap">
                  <input className="form-modal-input" type="date" required min={DATE_INPUT_MIN} max={DATE_INPUT_MAX} value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
                </div>
                <DateQuickActions value={form.fecha} onChange={(value) => setForm({ ...form, fecha: value })} disabled={loading} />
              </div>
              <div className="form-modal-group">
                <label className="form-modal-label">Notas <span>(opcional)</span></label>
                <textarea className="form-modal-input" rows={2} placeholder="Detalles adicionales..." value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} style={{ resize: 'none', height: 'auto' }} />
              </div>
            </>
          )}

          {!editId && !showAdvanced && (
            <p style={{ marginTop: -4, marginBottom: 18, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              Si no cambias nada, queda con fecha de hoy.
            </p>
          )}

          <div className="form-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={() => setModal(false)}>Cancelar</button>
            <button type="submit" className="btn-modal-save" disabled={loading}>
              {loading ? 'Guardando...' : editId ? 'Guardar cambios' : 'Agregar ingreso'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Eliminar ingreso puntual"
        message="Este ingreso puntual se eliminara de tus reportes y de tu historial."
        confirmText="Eliminar"
        cancelText="Cancelar"
        loading={deletingId !== null}
        onConfirm={handleDelete}
        onClose={() => setConfirmDeleteId(null)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Eliminar seleccionados"
        message={`Se eliminaran ${selectedIds.size} ingreso${selectedIds.size !== 1 ? 's' : ''}. Esta accion no se puede deshacer.`}
        confirmText="Eliminar"
        cancelText="Cancelar"
        loading={bulkDeleting}
        onConfirm={handleBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
      />
    </div>
  )
}
