import { useEffect, useState, useCallback } from 'react'
import { Lightbulb, Plus, Pencil, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router'

import { getApiErrorMessage } from '../../api/errors'
import api from '../../api/client'
import { useAuth } from '../../context/useAuth'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import ListControls from '../../components/ui/ListControls'
import ListPager from '../../components/ui/ListPager'
import SuggestionsPanel from '../../components/ui/SuggestionsPanel'
import Modal from '../../components/ui/Modal'
import MonthNavigator from '../../components/ui/MonthNavigator'
import { useCategorias } from '../../hooks/useCategorias'
import { formatAmount } from '../../utils/formatters'
import { startOfMonth } from '../../utils/months'
import '../../components/ui/app.css'

const SITUACION = {
  pendiente: { label: 'Pendiente', color: '#FBBF24' },
  en_estimado: { label: 'En el estimado', color: '#4ADE80' },
  sobre: { label: 'Sobre el estimado', color: 'var(--app-danger)' },
  menos: { label: 'Menos de lo estimado', color: '#4ADE80' },
  sin_gasto: { label: 'Sin gasto este mes', color: '#60A5FA' },
}

const SITUACION_ORDEN = {
  pendiente: 0,
  sin_gasto: 1,
  en_estimado: 2,
  menos: 3,
  sobre: 4,
}

function buildEmptyForm() {
  return { descripcion: '', categoria: 'servicios', monto: '' }
}

function getSituacionLabel(situacion) {
  return (SITUACION[situacion] || SITUACION.pendiente).label
}

export default function GastosVariables({ autoNew = false }) {
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const notificationYear = Number(searchParams.get('anio'))
  const notificationMonth = Number(searchParams.get('mes'))
  const { categorias } = useCategorias()

  const [selectedMonth, setSelectedMonth] = useState(() => (
    notificationYear >= 2000 && notificationYear <= 2100 && notificationMonth >= 1 && notificationMonth <= 12
      ? new Date(notificationYear, notificationMonth - 1, 1)
      : startOfMonth(new Date())
  ))
  const [filas, setFilas] = useState([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sortField, setSortField] = useState('descripcion')
  const [sortDir, setSortDir] = useState('asc')
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState({ type: '', message: '' })

  const [catalogo, setCatalogo] = useState([])

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(buildEmptyForm())
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)

  // — detalle de rubro: consumos individuales del mes —
  const [rubro, setRubro] = useState(null)
  const [consumos, setConsumos] = useState([])
  const [consumoForm, setConsumoForm] = useState({ monto: '', descripcion: '', fecha: '' })
  const [savingConsumo, setSavingConsumo] = useState(false)

  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [creandoMes, setCreandoMes] = useState(false)

  // — seleccion masiva —
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const anio = selectedMonth.getFullYear()
  const mes = selectedMonth.getMonth() + 1

  const now = new Date()
  const esMesActual = anio === now.getFullYear() && mes === now.getMonth() + 1
  const pendientes = filas.filter((fila) => fila.situacion === 'pendiente').length

  useEffect(() => {
    if (notificationYear < 2000 || notificationYear > 2100 || notificationMonth < 1 || notificationMonth > 12) return
    setSelectedMonth((current) => (
      current.getFullYear() === notificationYear && current.getMonth() === notificationMonth - 1
        ? current
        : new Date(notificationYear, notificationMonth - 1, 1)
    ))
    setPage(1)
  }, [notificationYear, notificationMonth])

  const fetchResumen = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/finanzas/gastos-corrientes/resumen_variables/?anio=${anio}&mes=${mes}`)
      setFilas(data)
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo cargar el resumen.') })
    } finally {
      setLoading(false)
    }
  }, [anio, mes])

  useEffect(() => { fetchResumen() }, [fetchResumen])

  useEffect(() => {
    api.get('/finanzas/catalogo/')
      .then(({ data }) => setCatalogo(data.gasto_variable || []))
      .catch(() => {})
  }, [])
  // Total del mes: lo que ya registraste; si un rubro sigue pendiente, usa su
  // sugerencia (o el estimado guardado). Sin jergas de "estimado" a la vista.
  const totalMes = filas.reduce((sum, fila) => {
    const valor = fila.real != null ? fila.real : (fila.sugerido ?? fila.estimado ?? 0)
    return sum + parseFloat(valor || 0)
  }, 0)

  const suggestionItems = esMesActual && pendientes > 0 && filas.length > 0
  ? [{
      summary: `${pendientes} gasto${pendientes !== 1 ? 's' : ''} pendiente${pendientes !== 1 ? 's' : ''} este mes`,
      title: `Tienes ${pendientes} gasto${pendientes !== 1 ? 's' : ''} variable${pendientes !== 1 ? 's' : ''} sin registrar este mes`,
      description: 'Puedes crearlos de una vez con el valor del mes anterior (o tu promedio) y luego editar los que cambiaron.',
      primaryActionLabel: creandoMes ? 'Creando...' : 'Crear gastos del mes',
      onPrimaryAction: crearMes,
      primaryDisabled: creandoMes,
    }]
  : []

  function getSortValue(fila, field) {
    switch (field) {
      case 'categoria':
      case 'descripcion':
        return String(fila[field] || '').toLowerCase()
      case 'estimado':
        return parseFloat(fila.estimado || 0)
      case 'valor':
      case 'real':
        return parseFloat(fila.real ?? fila.sugerido ?? fila.estimado ?? 0)
      case 'situacion':
        return SITUACION_ORDEN[fila.situacion] ?? 0
      default:
        return String(fila[field] || '').toLowerCase()
    }
  }

  const filteredRows = filas
    .filter((fila) => {
      const q = query.trim().toLowerCase()
      if (!q) return true

      return (
        fila.descripcion.toLowerCase().includes(q)
        || fila.categoria.toLowerCase().includes(q)
        || String(fila.estimado ?? '').toLowerCase().includes(q)
        || String(fila.real ?? fila.sugerido ?? '').toLowerCase().includes(q)
        || getSituacionLabel(fila.situacion).toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      const av = getSortValue(a, sortField)
      const bv = getSortValue(b, sortField)

      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const paginatedRows = filteredRows.slice(start, start + pageSize)

  // — seleccion masiva (necesita paginatedRows) —
  const bulkDeleteMax = user?.feature_access?.bulk_delete_max ?? 10
  const allPageSelected = paginatedRows.length > 0 && paginatedRows.every((f) => selectedIds.has(f.id))

  function toggleSelectAll() {
    if (allPageSelected) {
      setSelectedIds((prev) => { const next = new Set(prev); paginatedRows.forEach((f) => next.delete(f.id)); return next })
    } else {
      const excedido = paginatedRows.filter((f) => !selectedIds.has(f.id)).length + selectedIds.size > bulkDeleteMax
      setSelectedIds((prev) => {
        const next = new Set(prev)
        let count = next.size
        for (const f of paginatedRows) {
          if (next.has(f.id)) continue
          if (count >= bulkDeleteMax) break
          next.add(f.id)
          count++
        }
        return next
      })
      if (excedido) setFeedback({ type: 'error', message: `Tu plan permite seleccionar hasta ${bulkDeleteMax} registros a la vez.` })
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
    await fetchResumen()
    setBulkDeleting(false)
    if (errors === 0) setFeedback({ type: 'success', message: `${ids.length} gasto${ids.length !== 1 ? 's' : ''} eliminado${ids.length !== 1 ? 's' : ''}.` })
    else setFeedback({ type: 'error', message: `Se eliminaron ${ids.length - errors} de ${ids.length}. Algunos fallaron.` })
  }

  function openNew() {
    setForm(buildEmptyForm())
    setEditId(null)
    setModal(true)
  }

  useEffect(() => {
    if (autoNew) openNew()
  }, [autoNew])

  function openEdit(fila) {
    setForm({ descripcion: fila.descripcion, categoria: fila.categoria, monto: fila.estimado })
    setEditId(fila.id)
    setModal(true)
  }

  function elegirDelCatalogo(item) {
    setForm((prev) => ({ ...prev, descripcion: item.label, categoria: item.categoria }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setFeedback({ type: '', message: '' })
    try {
      // El estimado ya no se pide: se aprende del historial. Se crea en 0.
      const payload = {
        descripcion: form.descripcion,
        categoria: form.categoria,
        monto: 0,
        tipo_monto: 'variable',
        frecuencia: 'mensual',
        fecha_inicio: new Date().toISOString().slice(0, 10),
      }
      if (editId) {
        await api.patch(`/finanzas/gastos-corrientes/${editId}/`, {
          descripcion: form.descripcion,
          categoria: form.categoria,
        })
      } else {
        await api.post('/finanzas/gastos-corrientes/', payload)
      }
      setModal(false)
      await fetchResumen()
      setFeedback({ type: 'success', message: editId ? 'Gasto variable actualizado.' : 'Gasto variable creado.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo guardar.') })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    const id = confirmDeleteId
    if (!id) return
    setConfirmDeleteId(null)
    try {
      await api.delete(`/finanzas/gastos-corrientes/${id}/`)
      await fetchResumen()
      setFeedback({ type: 'success', message: 'Gasto eliminado.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo eliminar.') })
    }
  }

  async function crearMes() {
    if (creandoMes) return
    setCreandoMes(true)
    setFeedback({ type: '', message: '' })
    try {
      const { data } = await api.post('/finanzas/gastos-corrientes/crear_mes_variables/', { anio, mes })
      await fetchResumen()
      setFeedback({
        type: 'success',
        message: `Se crearon ${data.creados} gasto(s) con tu promedio. Ajusta los que hayan cambiado.`,
      })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudieron crear los gastos del mes.') })
    } finally {
      setCreandoMes(false)
    }
  }

  function hoyDelMes() {
    // Fecha por defecto para un consumo: hoy si el mes seleccionado es el
    // actual; si no, el primer dia del mes que se esta viendo.
    const now = new Date()
    if (anio === now.getFullYear() && mes === now.getMonth() + 1) return now.toISOString().slice(0, 10)
    return `${anio}-${String(mes).padStart(2, '0')}-01`
  }

  async function cargarConsumos(rubroId) {
    try {
      const { data } = await api.get(`/finanzas/gastos-corrientes/${rubroId}/ejecuciones/?anio=${anio}&mes=${mes}`)
      setConsumos(data)
    } catch {
      setConsumos([])
    }
  }

  function openRubro(fila) {
    setRubro(fila)
    setConsumoForm({ monto: '', descripcion: '', fecha: hoyDelMes() })
    cargarConsumos(fila.id)
  }

  async function handleAddConsumo(e) {
    e.preventDefault()
    if (savingConsumo || !rubro) return
    setSavingConsumo(true)
    setFeedback({ type: '', message: '' })
    try {
      await api.post(`/finanzas/gastos-corrientes/${rubro.id}/ejecuciones/`, {
        fecha: consumoForm.fecha,
        descripcion: consumoForm.descripcion,
        monto_real: consumoForm.monto || '0',
      })
      await cargarConsumos(rubro.id)
      await fetchResumen()
      setConsumoForm({ monto: '', descripcion: '', fecha: hoyDelMes() })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo anadir la compra.') })
    } finally {
      setSavingConsumo(false)
    }
  }

  async function handleMarcarCero() {
    if (savingConsumo || !rubro) return
    setSavingConsumo(true)
    setFeedback({ type: '', message: '' })
    try {
      await api.post(`/finanzas/gastos-corrientes/${rubro.id}/ejecuciones/`, {
        fecha: hoyDelMes(),
        descripcion: 'Sin gasto este mes',
        monto_real: 0,
      })
      await fetchResumen()
      setRubro(null)
      setFeedback({ type: 'success', message: `${rubro.descripcion}: marcado sin gasto este mes.` })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo marcar.') })
    } finally {
      setSavingConsumo(false)
    }
  }

  async function handleDeleteConsumo(id) {
    try {
      await api.delete(`/finanzas/gastos-corrientes/${rubro.id}/ejecuciones/${id}/`)
      await cargarConsumos(rubro.id)
      await fetchResumen()
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo eliminar la compra.') })
    }
  }

  const acumuladoRubro = consumos.reduce((s, c) => s + parseFloat(c.monto_real || 0), 0)

  return (
    <div>
      <div className="finance-panel-header">
        <div>
          <h2 className="finance-panel-kicker">Gastos variables</h2>
          <p className="finance-panel-kpi">
            Este mes:&nbsp;
            <span style={{ color: 'var(--app-danger)', fontWeight: 700 }}>${formatAmount(totalMes)}</span>
          </p>
        </div>
        <button className="btn-add page-primary-action" onClick={openNew}><Plus size={16} /> Agregar</button>
      </div>

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      <SuggestionsPanel
        title="Sugerencias"
        tone="warning"
        items={suggestionItems}
      />

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="empty-state"><p className="empty-text">Cargando...</p></div>
        ) : (
          <>
            <ListControls
              query={query}
              onQueryChange={(value) => { setQuery(value); setPage(1); setSelectedIds(new Set()) }}
              placeholder="Buscar por gasto o categoria..."
              page={safePage}
              pageCount={pageCount}
              onPrevPage={() => setPage((prev) => Math.max(1, prev - 1))}
              onNextPage={() => setPage((prev) => Math.min(pageCount, prev + 1))}
              pageSize={pageSize}
              onPageSizeChange={(value) => { setPageSize(value); setPage(1) }}
              totalItems={filas.length}
              filteredItems={filteredRows.length}
              showPagination={false}
              sortField={sortField}
              sortDir={sortDir}
              onSortChange={(field, dir) => { setSortField(field); setSortDir(dir); setPage(1) }}
              sortOptions={[
                { value: 'descripcion', label: 'Nombre' },
                { value: 'valor', label: 'Valor' },
                { value: 'categoria', label: 'Categoria' },
              ]}
              showSearch={filas.length > 0}
              showSort={filas.length > 0}
            >
              <MonthNavigator
                value={selectedMonth}
                onChange={(nextMonth) => {
                  setSelectedMonth(nextMonth)
                  setPage(1)
                  setSelectedIds(new Set())
                }}
              />
            </ListControls>

            {filas.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><Lightbulb size={20} /></div>
                <p className="empty-text">No hay gastos variables para este mes</p>
                <p className="empty-sub">Agrega uno nuevo o cambia de mes para revisar otro periodo.</p>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="empty-state">
                <p className="empty-text">No encontramos gastos para ese filtro</p>
                <p className="empty-sub">Prueba con otro nombre, categoria o cambia de mes.</p>
              </div>
            ) : (
              <>
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
                <table className="table table-variables">
                  <thead>
                    <tr>
                      <th style={{ width: 36, paddingRight: 0 }}>
                        <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} style={{ cursor: 'pointer', accentColor: 'var(--app-lila)' }} />
                      </th>
                      {['Gasto', 'Categoria', 'Este mes', 'Accion'].map((header) => (
                        <th key={header} className={header === 'Categoria' ? 'col-cat' : undefined}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.map((fila) => (
                      <tr key={fila.id}>
                        <td style={{ width: 36, paddingRight: 0 }}>
                          <input type="checkbox" checked={selectedIds.has(fila.id)} onChange={() => toggleSelect(fila.id)} style={{ cursor: 'pointer', accentColor: 'var(--app-lila)' }} />
                        </td>
                        <td style={{ fontWeight: 600 }}>{fila.descripcion}</td>
                        <td className="col-cat"><span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{fila.categoria}</span></td>
                        <td>
                          {fila.real != null ? (
                            <span className="table-amount negative">${formatAmount(parseFloat(fila.real))}</span>
                          ) : (
                            <button type="button" className="rubro-pendiente-btn" onClick={() => openRubro(fila)}>
                              Pendiente
                            </button>
                          )}
                        </td>
                        <td className="table-actions-cell">
                          <div className="table-actions-row">
                            <button
                              className="btn-modal-convert var-accion-btn"
                              onClick={() => openRubro(fila)}
                              title={fila.consumos > 0 ? 'Ver / Añadir compra' : 'Añadir compra'}
                            >
                              <Plus size={16} className="var-accion-icon" />
                              <span className="var-accion-text">{fila.consumos > 0 ? 'Ver / Añadir' : 'Añadir'}</span>
                            </button>
                            <button className="btn-icon edit" title="Editar gasto" onClick={() => openEdit(fila)}><Pencil size={15} /></button>
                            <button className="btn-icon danger" title="Eliminar" onClick={() => setConfirmDeleteId(fila.id)}><Trash2 size={15} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
            <ListPager
              page={safePage}
              pageCount={pageCount}
              onPrevPage={() => setPage((prev) => Math.max(1, prev - 1))}
              onNextPage={() => setPage((prev) => Math.min(pageCount, prev + 1))}
              pageSize={pageSize}
              onPageSizeChange={(value) => { setPageSize(value); setPage(1) }}
              totalItems={filas.length}
              filteredItems={filteredRows.length}
            />
          </>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar gasto variable' : '+ Nuevo gasto variable'}>
        <form onSubmit={handleSubmit}>
          {!editId && catalogo.length > 0 && (
            <div className="form-modal-group">
              <label className="form-modal-label">Sugerencias</label>
              <div className="catalogo-grid">
                {catalogo.map((item) => (
                  <button
                    key={item.clave}
                    type="button"
                    className={`catalogo-chip ${form.descripcion === item.label ? 'is-active' : ''}`}
                    onClick={() => elegirDelCatalogo(item)}
                  >
                    <span className="catalogo-emoji">{item.emoji}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              <p style={{ marginTop: 6, fontSize: 12, color: 'rgba(var(--app-ink-rgb),0.4)' }}>
                Elige uno o escribe el tuyo abajo.
              </p>
            </div>
          )}

          <div className="form-modal-group">
            <label className="form-modal-label">En que se va?</label>
            <input className="form-modal-input" required placeholder="Ej: Luz, agua, super, gasolina..." value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
          </div>

          <div className="form-modal-group">
            <label className="form-modal-label">Categoria</label>
            <select className="form-modal-select" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
              {categorias.length > 0
                ? categorias.map((categoria) => <option key={categoria.nombre} value={categoria.nombre}>{categoria.icono} {categoria.nombre}</option>)
                : <option value="servicios">servicios</option>}
            </select>
            <p style={{ marginTop: 6, fontSize: 12, color: 'rgba(var(--app-ink-rgb),0.45)' }}>
              No necesitas poner un monto: cada mes registras lo que gastaste y Aura aprende tu promedio.
            </p>
          </div>

          <div className="form-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={() => setModal(false)}>Cancelar</button>
            <button type="submit" className="btn-modal-save" disabled={saving}>
              {saving ? 'Guardando...' : editId ? 'Guardar cambios' : 'Agregar gasto'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={rubro !== null} onClose={() => setRubro(null)} title={rubro ? rubro.descripcion : ''}>
        {rubro && (
          <div>
            {/* Lo que llevas gastado este mes */}
            <div className="rubro-cards">
              <div className="rubro-card">
                <span className="rubro-card-label">Este mes</span>
                <span className="rubro-card-value">${formatAmount(acumuladoRubro)}</span>
              </div>
            </div>

            {/* Sugerencia aprendida del historial (ultimos 6 meses, mas peso a los 3 recientes) */}
            {parseFloat(rubro.sugerido) > 0 && (
              <div className="rubro-sugerido">
                <span>Sueles gastar cerca de <strong>${formatAmount(parseFloat(rubro.sugerido))}</strong> aqui.</span>
                {consumos.length === 0 && (
                  <button
                    type="button"
                    className="rubro-sugerido-btn"
                    onClick={() => setConsumoForm((prev) => ({ ...prev, monto: String(parseFloat(rubro.sugerido)) }))}
                  >
                    Usar ese valor
                  </button>
                )}
              </div>
            )}

            {/* Anadir una compra */}
            <form onSubmit={handleAddConsumo} className="rubro-add-form">
              <div className="form-modal-row">
                <div className="form-modal-group" style={{ flex: '1 1 120px' }}>
                  <label className="form-modal-label">Cuanto gastaste?</label>
                  <input className="form-modal-input" type="number" min="0" step="0.01" placeholder="0" required autoFocus
                    value={consumoForm.monto} onChange={(e) => setConsumoForm({ ...consumoForm, monto: e.target.value })} />
                </div>
                <div className="form-modal-group" style={{ flex: '1 1 120px' }}>
                  <label className="form-modal-label">Dia</label>
                  <input className="form-modal-input" type="date" required value={consumoForm.fecha}
                    onChange={(e) => setConsumoForm({ ...consumoForm, fecha: e.target.value })} />
                </div>
              </div>
              <div className="form-modal-group">
                <label className="form-modal-label">Donde? <span style={{ color: 'rgba(var(--app-ink-rgb),0.4)' }}>(opcional)</span></label>
                <input className="form-modal-input" placeholder="Ej: Fybeca, Sana Sana..."
                  value={consumoForm.descripcion} onChange={(e) => setConsumoForm({ ...consumoForm, descripcion: e.target.value })} />
              </div>
              <button type="submit" className="btn-modal-save" style={{ width: '100%' }} disabled={savingConsumo}>
                {savingConsumo ? 'Guardando...' : '+ Anadir compra'}
              </button>
            </form>

            {consumos.length === 0 && (
              <button type="button" className="rubro-cero-btn" onClick={handleMarcarCero} disabled={savingConsumo}>
                Este mes no gasté nada aquí — marcar $0
              </button>
            )}

            {/* Lista de consumos del mes */}
            <p className="rubro-list-title">Compras de este mes</p>
            {consumos.length === 0 ? (
              <p style={{ fontSize: 13, color: 'rgba(var(--app-ink-rgb),0.4)', textAlign: 'center', padding: '12px 0' }}>
                Aun no anades compras. Cada compra suma al total del mes.
              </p>
            ) : (
              <div className="rubro-consumos">
                {consumos.map((c) => (
                  <div key={c.id} className="rubro-consumo">
                    <div>
                      <div className="rubro-consumo-desc">{c.descripcion || 'Compra'}</div>
                      <div className="rubro-consumo-fecha">{c.fecha}</div>
                    </div>
                    <div className="rubro-consumo-right">
                      <span className="rubro-consumo-monto">${formatAmount(parseFloat(c.monto_real))}</span>
                      <button className="btn-icon danger" title="Eliminar" onClick={() => handleDeleteConsumo(c.id)}><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Eliminar gasto variable"
        message="Se eliminara el gasto y sus montos reales registrados."
        confirmText="Eliminar"
        cancelText="Cancelar"
        onConfirm={handleDelete}
        onClose={() => setConfirmDeleteId(null)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Eliminar seleccionados"
        message={`Se eliminaran ${selectedIds.size} gasto${selectedIds.size !== 1 ? 's' : ''} variable${selectedIds.size !== 1 ? 's' : ''} y sus consumos. Esta accion no se puede deshacer.`}
        confirmText="Eliminar todos"
        cancelText="Cancelar"
        loading={bulkDeleting}
        onConfirm={handleBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
      />
    </div>
  )
}
