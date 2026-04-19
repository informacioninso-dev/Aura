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
import { useCategorias } from '../../hooks/useCategorias'
import { DATE_INPUT_MAX, DATE_INPUT_MIN } from '../../utils/dateBounds'
import { formatAmount } from '../../utils/formatters'
import '../../components/ui/app.css'

const FRECUENCIAS = ['diario', 'semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual']
const FREQ = { diario: 30, semanal: 4.33, quincenal: 2, mensual: 1, bimestral: 0.5, trimestral: 0.333, semestral: 0.167, anual: 0.083 }
const FRECUENCIA_STORAGE_KEY = 'gastos_corrientes_last_frecuencia'
const CATEGORIA_STORAGE_KEY = 'gastos_corrientes_last_categoria'
const FUTURE_EXPENSE_MESSAGE = 'Los gastos futuros no se cargan aqui. Simulalos desde el simulador con tasa 0%.'

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

export default function GastosCorrientes({ embedded = false }) {
  const { user } = useAuth()
  const { categorias } = useCategorias()
  const maxExpenseDate = getTodayDate()

  // — lista y paginacion —
  const [items, setItems] = useState([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sortField, setSortField] = useState('fecha_inicio')
  const [sortDir, setSortDir] = useState('desc')

  // — modal crear/editar —
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(buildEmptyForm())
  const [editId, setEditId] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [converting, setConverting] = useState(false)

  // — eliminar —
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  // — seleccion masiva —
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // — versionado —
  const [versioningItem, setVersioningItem] = useState(null)
  const [versionForm, setVersionForm] = useState({ descripcion: '', categoria: 'otro', monto: '', frecuencia: 'mensual', nuevaFecha: '' })
  const [versionLoading, setVersionLoading] = useState(false)
  const [confirmConvert, setConfirmConvert] = useState(false)

  const [feedback, setFeedback] = useState({ type: '', message: '' })

  useEffect(() => { fetchItems() }, [])

  function clampExpenseDate(value) {
    if (!value) return value
    return value > maxExpenseDate ? maxExpenseDate : value
  }

  function setStartDate(value) {
    const nextValue = clampExpenseDate(value)
    setForm((prev) => ({
      ...prev,
      fecha_inicio: nextValue,
      fecha_fin: prev.fecha_fin && prev.fecha_fin < nextValue ? '' : prev.fecha_fin,
    }))
  }

  function setVersionStartDate(value) {
    const nextValue = clampExpenseDate(value)
    setVersionForm((prev) => ({ ...prev, nuevaFecha: nextValue }))
  }

  async function fetchItems() {
    try {
      const { data } = await api.get('/finanzas/gastos-corrientes/')
      setItems(data)
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudieron cargar los gastos corrientes.') })
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
    if (form.fecha_inicio > maxExpenseDate) {
      setFeedback({ type: 'error', message: FUTURE_EXPENSE_MESSAGE })
      return
    }
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
      await api.delete(`/finanzas/gastos-corrientes/${id}/`)
      await fetchItems()
      setFeedback({ type: 'success', message: 'Gasto eliminado correctamente.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo eliminar el gasto.') })
    } finally {
      setDeletingId(null)
    }
  }

  // — versionado —
  function openVersion(item) {
    setVersioningItem(item)
    setVersionForm({
      descripcion: item.descripcion,
      categoria: item.categoria,
      monto: item.monto,
      frecuencia: item.frecuencia,
      nuevaFecha: getTodayDate(),
    })
  }

  async function handleVersion(e) {
    e.preventDefault()
    if (versionLoading) return
    if (versionForm.nuevaFecha > maxExpenseDate) {
      setFeedback({ type: 'error', message: FUTURE_EXPENSE_MESSAGE })
      return
    }
    setVersionLoading(true)
    setFeedback({ type: '', message: '' })
    try {
      await api.patch(`/finanzas/gastos-corrientes/${versioningItem.id}/`, { fecha_fin: dayBefore(versionForm.nuevaFecha) })
      await api.post('/finanzas/gastos-corrientes/', {
        descripcion: versionForm.descripcion,
        categoria: versionForm.categoria,
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

  async function handleConvertToPuntual() {
    if (!editId || converting) return
    setConverting(true)
    setConfirmConvert(false)
    setFeedback({ type: '', message: '' })
    try {
      await api.post(`/finanzas/gastos-corrientes/${editId}/convertir_a_puntual/`, {
        descripcion: form.descripcion,
        categoria: form.categoria,
        monto: form.monto,
        fecha: form.fecha_inicio,
      })
      setModal(false)
      await fetchItems()
      setFeedback({ type: 'success', message: 'Listo. Ahora lo veras en Gastos puntuales.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo convertir el gasto a puntual.') })
    } finally {
      setConverting(false)
    }
  }

  // — computos derivados —
  const hoy = getTodayDate()
  const total = items
    .filter((i) => i.activo && i.fecha_inicio <= hoy && (!i.fecha_fin || i.fecha_fin >= hoy))
    .reduce((s, i) => s + parseFloat(i.monto) * (FREQ[i.frecuencia] || 1), 0)

  const filteredItems = items.filter((item) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      item.descripcion.toLowerCase().includes(q)
      || item.categoria.toLowerCase().includes(q)
      || item.frecuencia.toLowerCase().includes(q)
      || String(item.monto).toLowerCase().includes(q)
    )
  }).sort((a, b) => {
    const av = sortField === 'monto' ? parseFloat(a[sortField]) : (a[sortField] || '')
    const bv = sortField === 'monto' ? parseFloat(b[sortField]) : (b[sortField] || '')
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
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
      try { await api.delete(`/finanzas/gastos-corrientes/${id}/`) } catch { errors++ }
    }
    setSelectedIds(new Set())
    await fetchItems()
    setBulkDeleting(false)
    if (errors === 0) setFeedback({ type: 'success', message: `${ids.length} gasto${ids.length !== 1 ? 's' : ''} eliminado${ids.length !== 1 ? 's' : ''}.` })
    else setFeedback({ type: 'error', message: `Se eliminaron ${ids.length - errors} de ${ids.length}. Algunos fallaron.` })
  }

  return (
    <div>
      {embedded ? (
        <div className="finance-panel-header">
          <div>
            <h2 className="finance-panel-kicker">Gastos fijos</h2>
            <p className="finance-panel-kpi">
              Total al mes:&nbsp;
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
            <h1 className="page-title">Gastos fijos</h1>
            <p className="page-subtitle">
              Total al mes:&nbsp;
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
            <div className="empty-icon">🛒</div>
            <p className="empty-text">Aun no sumas gastos fijos</p>
            <p className="empty-sub">Agrega los pagos que se repiten</p>
          </div>
        ) : (
          <>
            <ListControls
              query={query}
              onQueryChange={(value) => { setQuery(value); setPage(1); setSelectedIds(new Set()) }}
              placeholder="Buscar por descripcion o categoria..."
              page={safePage}
              pageCount={pageCount}
              onPrevPage={() => setPage((p) => Math.max(1, p - 1))}
              onNextPage={() => setPage((p) => Math.min(pageCount, p + 1))}
              pageSize={pageSize}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1) }}
              totalItems={items.length}
              filteredItems={filteredItems.length}
              sortField={sortField}
              sortDir={sortDir}
              onSortChange={(f, d) => { setSortField(f); setSortDir(d); setPage(1) }}
              sortOptions={[
                { value: 'descripcion', label: 'Nombre' },
                { value: 'monto', label: 'Valor' },
                { value: 'categoria', label: 'Categoria' },
                { value: 'fecha_inicio', label: 'Fecha' },
              ]}
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
                    {['Nombre', 'Categoria', 'Monto', 'Frecuencia', 'Desde', 'Hasta', 'Estado', ''].map((h) => <th key={h}>{h}</th>)}
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
                      <td className="table-amount negative">${formatAmount(parseFloat(item.monto))}</td>
                      <td><span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{item.frecuencia}</span></td>
                      <td>{item.fecha_inicio}</td>
                      <td>{item.fecha_fin || '-'}</td>
                      <td><span className={item.activo ? 'badge badge-green' : 'badge badge-gray'}>{item.activo ? 'Activo' : 'Inactivo'}</span></td>
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
      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar gasto' : '+ Nuevo gasto'}>
        <form onSubmit={handleSubmit}>
          {!editId && (
            <p style={{ marginTop: -8, marginBottom: 14, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              Carga rapida: nombre, categoria y monto.
            </p>
          )}
          <div className="form-modal-group">
            <label className="form-modal-label">En que se va?</label>
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
              <label className="form-modal-label">Monto</label>
              <input className="form-modal-input" type="number" required min="0" step="0.01" placeholder="0" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
            </div>
          </div>

          <div className="form-modal-group">
            <label className="form-modal-label">Desde <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>— afecta el historico y la proyeccion</span></label>
            <div className="date-input-wrap">
              <input className="form-modal-input" type="date" required min={DATE_INPUT_MIN} max={maxExpenseDate} value={form.fecha_inicio} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <DateQuickActions value={form.fecha_inicio} onChange={setStartDate} disabled={loading} />
            <p style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45 }}>
              Si este gasto empieza mas adelante, no lo cargues aqui. Simulalo en el simulador usando tasa 0%.
            </p>
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
                <span>Gasto activo</span>
              </label>
            </>
          )}

          {editId && (
            <div className="form-modal-convert-block">
              <div className="form-modal-convert-copy">
                <span className="form-modal-convert-title">Cambiar tipo de movimiento</span>
                <span className="form-modal-convert-text">
                  Si esto no era fijo, puedes pasarlo a puntual sin perder el nombre, monto ni fecha.
                </span>
              </div>
              <button
                type="button"
                className="btn-modal-convert"
                onClick={() => setConfirmConvert(true)}
                disabled={loading || converting}
              >
                {converting ? 'Convirtiendo...' : 'Pasar a puntual'}
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

      {/* Modal versionar */}
      <Modal open={versioningItem !== null} onClose={() => setVersioningItem(null)} title="Nueva version">
        {versioningItem && (
          <form onSubmit={handleVersion}>
            <p style={{ marginTop: -8, marginBottom: 16, fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
              Cerramos el registro actual un dia antes de la nueva fecha. El historial queda guardado.
            </p>

            <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
              <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Actual: </span>
              {versioningItem.descripcion} — ${formatAmount(parseFloat(versioningItem.monto))} {versioningItem.frecuencia}
            </div>

            <div className="form-modal-group">
              <label className="form-modal-label">Nombre</label>
              <input className="form-modal-input" required value={versionForm.descripcion} onChange={(e) => setVersionForm({ ...versionForm, descripcion: e.target.value })} />
            </div>

            <div className="form-modal-row">
              <div className="form-modal-group">
                <label className="form-modal-label">Categoria</label>
                <select className="form-modal-select" value={versionForm.categoria} onChange={(e) => setVersionForm({ ...versionForm, categoria: e.target.value })}>
                  {categorias.length > 0
                    ? categorias.map((c) => <option key={c.nombre} value={c.nombre}>{c.icono} {c.nombre}</option>)
                    : <option value="otro">otro</option>}
                </select>
              </div>
              <div className="form-modal-group">
                <label className="form-modal-label">Nuevo monto</label>
                <input className="form-modal-input" type="number" required min="0" step="0.01" value={versionForm.monto} onChange={(e) => setVersionForm({ ...versionForm, monto: e.target.value })} />
              </div>
            </div>

            <div className="form-modal-row">
              <div className="form-modal-group">
                <label className="form-modal-label">Frecuencia</label>
                <select className="form-modal-select" value={versionForm.frecuencia} onChange={(e) => setVersionForm({ ...versionForm, frecuencia: e.target.value })}>
                  {FRECUENCIAS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="form-modal-group">
                <label className="form-modal-label">Aplica desde</label>
                <div className="date-input-wrap">
                  <input className="form-modal-input" type="date" required min={DATE_INPUT_MIN} max={maxExpenseDate} value={versionForm.nuevaFecha} onChange={(e) => setVersionStartDate(e.target.value)} />
                </div>
                <DateQuickActions value={versionForm.nuevaFecha} onChange={setVersionStartDate} disabled={versionLoading} />
                <p style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45 }}>
                  Si el nuevo gasto arranca en el futuro, llevalo al simulador con tasa 0% en vez de versionarlo aqui.
                </p>
              </div>
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
        open={confirmConvert}
        title="Pasar a gasto puntual"
        message={`Se creara un gasto puntual con la fecha ${form.fecha_inicio || 'actual'} y este gasto fijo se eliminara. Luego podras ajustarlo si hace falta.`}
        confirmText="Convertir"
        cancelText="Cancelar"
        loading={converting}
        onConfirm={handleConvertToPuntual}
        onClose={() => setConfirmConvert(false)}
      />

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
