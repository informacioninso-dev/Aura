import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'

import { getApiErrorMessage } from '../../api/errors'
import api from '../../api/client'
import { useAuth } from '../../context/useAuth'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import ListControls from '../../components/ui/ListControls'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Modal from '../../components/ui/Modal'
import { useCategorias } from '../../hooks/useCategorias'
import { formatNumber } from '../../utils/formatters'
import '../../components/ui/app.css'

const CATEGORIA_STORAGE_KEY = 'gastos_puntuales_last_categoria'

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
  }
}

export default function GastosNoCorrientes() {
  const { user } = useAuth()
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
  const { categorias } = useCategorias()

  useEffect(() => { fetchItems() }, [])

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
    setForm({ descripcion: item.descripcion, categoria: item.categoria, monto: item.monto, fecha: item.fecha, notas: item.notas || '' })
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

  return (
    <div>
      <div className="page-header page-header-actions">
        <div className="page-header-main">
          <h1 className="page-title">Gastos puntuales</h1>
          <p className="page-subtitle">
            Total registrado:&nbsp;
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
            <div className="empty-icon">🧾</div>
            <p className="empty-text">Sin gastos puntuales registrados</p>
            <p className="empty-sub">Registra compras o gastos que no se repiten para tener historial completo</p>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', background: 'rgba(196,135,246,0.08)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', flex: 1 }}>{selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}</span>
                <button className="btn-modal-danger" style={{ padding: '6px 14px', fontSize: 13 }} disabled={bulkDeleting} onClick={() => setConfirmBulkDelete(true)}>
                  {bulkDeleting ? 'Eliminando...' : 'Eliminar seleccionados'}
                </button>
                <button className="btn-modal-cancel" style={{ padding: '6px 14px', fontSize: 13 }} onClick={() => setSelectedIds(new Set())}>
                  Cancelar
                </button>
              </div>
            )}
            <div className="table-wrap" style={{ border: 'none', borderRadius: 20 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 36, paddingRight: 0 }}>
                      <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} style={{ cursor: 'pointer', accentColor: '#C487F6' }} />
                    </th>
                    {['Descripcion', 'Categoria', 'Monto', 'Fecha', 'Notas', ''].map((h) => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map((item) => (
                    <tr key={item.id}>
                      <td style={{ width: 36, paddingRight: 0 }}>
                        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} style={{ cursor: 'pointer', accentColor: '#C487F6' }} />
                      </td>
                      <td style={{ fontWeight: 600 }}>{item.descripcion}</td>
                      <td><span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{item.categoria}</span></td>
                      <td className="table-amount negative">${formatNumber(parseFloat(item.monto))}</td>
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
              Carga rapida: descripcion, categoria y monto. Fecha y notas son opcionales.
            </p>
          )}
          <div className="form-modal-group">
            <label className="form-modal-label">En que gastaste?</label>
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
              <div className="form-modal-group">
                <label className="form-modal-label">Cuando fue?</label>
                <div className="date-input-wrap">
                  <input className="form-modal-input" type="date" required value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
                </div>
              </div>
              <div className="form-modal-group">
                <label className="form-modal-label">Notas <span>(opcional)</span></label>
                <textarea className="form-modal-input" rows={2} placeholder="Detalles adicionales..." value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} style={{ resize: 'none', height: 'auto' }} />
              </div>
            </>
          )}

          {!editId && !showAdvanced && (
            <p style={{ marginTop: -4, marginBottom: 18, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              Se registrara con la fecha de hoy.
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
