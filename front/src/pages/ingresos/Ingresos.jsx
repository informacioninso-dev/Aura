import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, GitBranch } from 'lucide-react'

import { getApiErrorMessage } from '../../api/errors'
import api from '../../api/client'
import { useAuth } from '../../context/useAuth'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import ListControls from '../../components/ui/ListControls'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import DateQuickActions from '../../components/ui/DateQuickActions'
import Modal from '../../components/ui/Modal'
import { DATE_INPUT_MAX, DATE_INPUT_MIN } from '../../utils/dateBounds'
import { formatNumber } from '../../utils/formatters'
import '../../components/ui/app.css'

const FRECUENCIAS = ['diario', 'semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual']
const FREQ_FACTOR = { diario: 30, semanal: 4.33, quincenal: 2, mensual: 1, bimestral: 0.5, trimestral: 0.333, semestral: 0.167, anual: 0.083 }
const FRECUENCIA_STORAGE_KEY = 'ingresos_last_frecuencia'

function getTodayDate() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dayBefore(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function buildEmptyForm() {
  const savedFreq = typeof window !== 'undefined' ? window.localStorage.getItem(FRECUENCIA_STORAGE_KEY) : null
  return {
    descripcion: '',
    monto: '',
    frecuencia: FRECUENCIAS.includes(savedFreq) ? savedFreq : 'mensual',
    fecha_inicio: getTodayDate(),
    fecha_fin: '',
    activo: true,
  }
}

export default function Ingresos({ embedded = false }) {
  const { user } = useAuth()

  // — lista y paginacion —
  const [items, setItems] = useState([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // — modal crear/editar —
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(buildEmptyForm())
  const [editId, setEditId] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)

  // — eliminar —
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  // — seleccion masiva —
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // — versionado —
  const [versioningItem, setVersioningItem] = useState(null)
  const [versionForm, setVersionForm] = useState({ descripcion: '', monto: '', frecuencia: 'mensual', nuevaFecha: '' })
  const [versionLoading, setVersionLoading] = useState(false)

  const [feedback, setFeedback] = useState({ type: '', message: '' })

  useEffect(() => { fetchItems() }, [])

  async function fetchItems() {
    try {
      const { data } = await api.get('/finanzas/ingresos/')
      setItems(data)
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudieron cargar los ingresos.') })
    }
  }

  // — crear / editar —
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
      if (editId) await api.put(`/finanzas/ingresos/${editId}/`, payload)
      else await api.post('/finanzas/ingresos/', payload)
      if (typeof window !== 'undefined') window.localStorage.setItem(FRECUENCIA_STORAGE_KEY, payload.frecuencia)
      setModal(false)
      await fetchItems()
      setFeedback({ type: 'success', message: editId ? 'Ingreso actualizado correctamente.' : 'Ingreso creado correctamente.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo guardar el ingreso.') })
    } finally {
      setLoading(false)
    }
  }

  // — eliminar —
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
      await api.delete(`/finanzas/ingresos/${id}/`)
      await fetchItems()
      setFeedback({ type: 'success', message: 'Ingreso eliminado correctamente.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo eliminar el ingreso.') })
    } finally {
      setDeletingId(null)
    }
  }

  // — versionado —
  function openVersion(item) {
    setVersioningItem(item)
    setVersionForm({
      descripcion: item.descripcion,
      monto: item.monto,
      frecuencia: item.frecuencia,
      nuevaFecha: getTodayDate(),
    })
  }

  async function handleVersion(e) {
    e.preventDefault()
    if (versionLoading) return
    setVersionLoading(true)
    setFeedback({ type: '', message: '' })
    try {
      await api.patch(`/finanzas/ingresos/${versioningItem.id}/`, { fecha_fin: dayBefore(versionForm.nuevaFecha) })
      await api.post('/finanzas/ingresos/', {
        descripcion: versionForm.descripcion,
        monto: versionForm.monto,
        frecuencia: versionForm.frecuencia,
        fecha_inicio: versionForm.nuevaFecha,
        fecha_fin: null,
        activo: versioningItem.activo,
      })
      setVersioningItem(null)
      await fetchItems()
      setFeedback({ type: 'success', message: 'Nueva version creada. El historial anterior se conserva.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo crear la nueva version.') })
    } finally {
      setVersionLoading(false)
    }
  }

  // — computos derivados —
  const hoy = getTodayDate()
  const total = items
    .filter((i) => i.activo && i.fecha_inicio <= hoy && (!i.fecha_fin || i.fecha_fin >= hoy))
    .reduce((s, i) => s + parseFloat(i.monto) * (FREQ_FACTOR[i.frecuencia] || 1), 0)

  const filteredItems = items.filter((item) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      item.descripcion.toLowerCase().includes(q)
      || item.frecuencia.toLowerCase().includes(q)
      || String(item.monto).toLowerCase().includes(q)
    )
  })

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const paginatedItems = filteredItems.slice(start, start + pageSize)

  // — seleccion masiva (necesita paginatedItems) —
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
      if (prev.has(id)) { const next = new Set(prev); next.delete(id); return next }
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
      try { await api.delete(`/finanzas/ingresos/${id}/`) } catch { errors++ }
    }
    setSelectedIds(new Set())
    await fetchItems()
    setBulkDeleting(false)
    if (errors === 0) setFeedback({ type: 'success', message: `${ids.length} ingreso${ids.length !== 1 ? 's' : ''} eliminado${ids.length !== 1 ? 's' : ''}.` })
    else setFeedback({ type: 'error', message: `Se eliminaron ${ids.length - errors} de ${ids.length}. Algunos fallaron.` })
  }

  return (
    <div>
      {embedded ? (
        <div className="finance-panel-header">
          <div>
            <h2 className="finance-panel-kicker">Ingresos fijos</h2>
            <p className="finance-panel-kpi">
              Total al mes:&nbsp;
              <span style={{ color: '#10B981', fontWeight: 700 }}>
                ${formatNumber(total, { maximumFractionDigits: 0 })}
              </span>
            </p>
          </div>
          <button className="btn-add page-primary-action" onClick={openNew}>
            <Plus size={16} /> Agregar
          </button>
        </div>
      ) : (
        <div className="page-header page-header-actions">
          <div className="page-header-main">
            <h1 className="page-title">Ingresos</h1>
            <p className="page-subtitle">
              Total al mes:&nbsp;
              <span style={{ color: '#10B981', fontWeight: 700 }}>
                ${formatNumber(total, { maximumFractionDigits: 0 })}
              </span>
            </p>
          </div>
          <button className="btn-add page-primary-action" onClick={openNew}>
            <Plus size={16} /> Agregar
          </button>
        </div>
      )}

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      <div className="card" style={{ padding: 0 }}>
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">💰</div>
            <p className="empty-text">Aun no sumas ingresos</p>
            <p className="empty-sub">Agrega uno y empieza a ver tu flujo</p>
          </div>
        ) : (
          <>
            <ListControls
              query={query}
              onQueryChange={(value) => { setQuery(value); setPage(1); setSelectedIds(new Set()) }}
              placeholder="Buscar por descripcion o frecuencia..."
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
                    {['Nombre', 'Monto', 'Frecuencia', 'Desde', 'Hasta', 'Estado', ''].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map((item) => (
                    <tr key={item.id}>
                      <td style={{ width: 36, paddingRight: 0 }}>
                        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} style={{ cursor: 'pointer', accentColor: '#C487F6' }} />
                      </td>
                      <td style={{ fontWeight: 600 }}>{item.descripcion}</td>
                      <td className="table-amount positive">${formatNumber(parseFloat(item.monto))}</td>
                      <td><span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{item.frecuencia}</span></td>
                      <td>{item.fecha_inicio}</td>
                      <td>{item.fecha_fin || '-'}</td>
                      <td>
                        <span className={item.activo ? 'badge badge-green' : 'badge badge-gray'}>
                          {item.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="table-actions-cell">
                        <div className="table-actions-row">
                          <button className="btn-icon edit" title="Editar" onClick={() => openEdit(item)}><Pencil size={15} /></button>
                          <button className="btn-icon" title="Nueva version" style={{ color: '#FBBF24' }} onClick={() => openVersion(item)}><GitBranch size={15} /></button>
                          <button className="btn-icon danger" title="Eliminar" disabled={deletingId === item.id} onClick={() => openDeleteConfirm(item.id)}><Trash2 size={15} /></button>
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

      {/* Modal crear / editar */}
      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar ingreso' : '+ Nuevo ingreso'}>
        <form onSubmit={handleSubmit}>
          {!editId && (
            <p style={{ marginTop: -8, marginBottom: 14, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              Carga rapida: nombre y monto. Lo demas es opcional.
            </p>
          )}
          <div className="form-modal-group">
            <label className="form-modal-label">De donde viene?</label>
            <input
              className="form-modal-input"
              required
              placeholder="Ej: Sueldo, freelance, arriendo..."
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
            />
          </div>

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
              onChange={(e) => setForm({ ...form, monto: e.target.value })}
            />
          </div>

          <div className="form-modal-group">
            <label className="form-modal-label">Desde <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>— afecta el historico y la proyeccion</span></label>
            <div className="date-input-wrap">
              <input className="form-modal-input" type="date" required min={DATE_INPUT_MIN} max={DATE_INPUT_MAX} value={form.fecha_inicio} onChange={(e) => setForm((prev) => ({ ...prev, fecha_inicio: e.target.value, fecha_fin: prev.fecha_fin && prev.fecha_fin < e.target.value ? '' : prev.fecha_fin }))} />
            </div>
            <DateQuickActions value={form.fecha_inicio} onChange={(value) => setForm((prev) => ({ ...prev, fecha_inicio: value, fecha_fin: prev.fecha_fin && prev.fecha_fin < value ? '' : prev.fecha_fin }))} disabled={loading} />
          </div>

          {!editId && (
            <button type="button" className="btn-modal-cancel" onClick={() => setShowAdvanced((v) => !v)} style={{ width: '100%', marginBottom: 14 }}>
              {showAdvanced ? 'Ocultar opciones' : 'Ver mas opciones'}
            </button>
          )}

          {(editId || showAdvanced) && (
            <>
              <div className="form-modal-group">
                <label className="form-modal-label">Frecuencia</label>
                <select className="form-modal-select" value={form.frecuencia} onChange={(e) => setForm({ ...form, frecuencia: e.target.value })}>
                  {FRECUENCIAS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              <div className="form-modal-group">
                <label className="form-modal-label">Hasta <span>(opcional)</span></label>
                <div className="date-input-wrap">
                  <input className="form-modal-input" type="date" min={form.fecha_inicio || DATE_INPUT_MIN} max={DATE_INPUT_MAX} value={form.fecha_fin} onChange={(e) => setForm({ ...form, fecha_fin: e.target.value })} />
                </div>
                <DateQuickActions value={form.fecha_fin} onChange={(value) => setForm({ ...form, fecha_fin: value })} allowClear disabled={loading} />
              </div>

              <label className="form-modal-check">
                <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
                <span>Ingreso activo</span>
              </label>
            </>
          )}

          <div className="form-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={() => setModal(false)}>Cancelar</button>
            <button type="submit" className="btn-modal-save" disabled={loading}>
              {loading ? 'Guardando...' : editId ? 'Guardar cambios' : 'Agregar ingreso'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal versionar */}
      <Modal open={versioningItem !== null} onClose={() => setVersioningItem(null)} title="Nueva version">
        {versioningItem && (
          <form onSubmit={handleVersion}>
            <p style={{ marginTop: -8, marginBottom: 16, fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
              Cerramos el registro actual un dia antes de la nueva fecha. El historial queda guardado.
            </p>

            <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
              <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Actual: </span>
              {versioningItem.descripcion} — ${formatNumber(parseFloat(versioningItem.monto))} {versioningItem.frecuencia}
            </div>

            <div className="form-modal-group">
              <label className="form-modal-label">Nombre</label>
              <input
                className="form-modal-input"
                required
                value={versionForm.descripcion}
                onChange={(e) => setVersionForm({ ...versionForm, descripcion: e.target.value })}
              />
            </div>

            <div className="form-modal-row">
              <div className="form-modal-group">
                <label className="form-modal-label">Nuevo monto</label>
                <input
                  className="form-modal-input"
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={versionForm.monto}
                  onChange={(e) => setVersionForm({ ...versionForm, monto: e.target.value })}
                />
              </div>
              <div className="form-modal-group">
                <label className="form-modal-label">Frecuencia</label>
                <select className="form-modal-select" value={versionForm.frecuencia} onChange={(e) => setVersionForm({ ...versionForm, frecuencia: e.target.value })}>
                  {FRECUENCIAS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>

            <div className="form-modal-group">
              <label className="form-modal-label">Aplica desde</label>
              <div className="date-input-wrap">
                <input
                  className="form-modal-input"
                  type="date"
                  required
                  min={DATE_INPUT_MIN}
                  max={DATE_INPUT_MAX}
                  value={versionForm.nuevaFecha}
                  onChange={(e) => setVersionForm({ ...versionForm, nuevaFecha: e.target.value })}
                />
              </div>
              <DateQuickActions value={versionForm.nuevaFecha} onChange={(value) => setVersionForm({ ...versionForm, nuevaFecha: value })} disabled={versionLoading} />
            </div>

            <div className="form-modal-actions">
              <button type="button" className="btn-modal-cancel" onClick={() => setVersioningItem(null)}>Cancelar</button>
              <button type="submit" className="btn-modal-save" disabled={versionLoading}>
                {versionLoading ? 'Guardando...' : 'Crear nueva version'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Eliminar ingreso"
        message="Este ingreso se eliminara de tus calculos y de tu historial."
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
        confirmText="Eliminar todos"
        cancelText="Cancelar"
        loading={bulkDeleting}
        onConfirm={handleBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
      />
    </div>
  )
}
