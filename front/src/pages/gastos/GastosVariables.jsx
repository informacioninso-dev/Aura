import { useEffect, useState, useCallback } from 'react'
import { Lightbulb, Plus, Pencil, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { getApiErrorMessage } from '../../api/errors'
import api from '../../api/client'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import ListControls from '../../components/ui/ListControls'
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

export default function GastosVariables() {
  const [searchParams] = useSearchParams()
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

  const [realItem, setRealItem] = useState(null)
  const [realMonto, setRealMonto] = useState('')
  const [savingReal, setSavingReal] = useState(false)

  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [creandoMes, setCreandoMes] = useState(false)

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
  const totalEstimado = filas.reduce((sum, fila) => sum + parseFloat(fila.estimado || 0), 0)

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
      case 'real':
        return parseFloat(fila.real ?? fila.sugerido ?? 0)
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

  function openNew() {
    setForm(buildEmptyForm())
    setEditId(null)
    setModal(true)
  }

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
      const payload = {
        descripcion: form.descripcion,
        categoria: form.categoria,
        monto: form.monto,
        tipo_monto: 'variable',
        frecuencia: 'mensual',
        fecha_inicio: new Date().toISOString().slice(0, 10),
      }
      if (editId) {
        await api.patch(`/finanzas/gastos-corrientes/${editId}/`, {
          descripcion: form.descripcion,
          categoria: form.categoria,
          monto: form.monto,
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
        message: `Se crearon ${data.creados} gasto(s) con el valor estimado. Edita los que hayan cambiado.`,
      })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudieron crear los gastos del mes.') })
    } finally {
      setCreandoMes(false)
    }
  }

  function openReal(fila) {
    setRealItem(fila)
    setRealMonto(fila.real ?? fila.sugerido ?? '')
  }

  async function handleSubmitReal(e) {
    e.preventDefault()
    if (savingReal || !realItem) return
    setSavingReal(true)
    setFeedback({ type: '', message: '' })
    try {
      await api.post(`/finanzas/gastos-corrientes/${realItem.id}/ejecuciones/`, {
        anio,
        mes,
        monto_real: realMonto === '' ? '0' : realMonto,
      })
      setRealItem(null)
      await fetchResumen()
      setFeedback({ type: 'success', message: 'Monto real guardado.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo guardar el monto real.') })
    } finally {
      setSavingReal(false)
    }
  }

  function renderSituacion(fila) {
    const situacion = SITUACION[fila.situacion] || SITUACION.pendiente
    const pct = fila.delta_pct
    return (
      <div>
        <span style={{ color: situacion.color, fontWeight: 600, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '999px',
              backgroundColor: situacion.color,
              display: 'inline-block',
            }}
          />
          {situacion.label}
        </span>
        {fila.situacion !== 'pendiente' && fila.situacion !== 'sin_gasto' && fila.delta_abs != null && (
          <div style={{ fontSize: 12, color: 'rgba(var(--app-ink-rgb),0.45)' }}>
            {parseFloat(fila.delta_abs) >= 0 ? '+' : ''}${formatAmount(Math.abs(parseFloat(fila.delta_abs)))}
            {pct != null ? ` (${pct >= 0 ? '+' : ''}${pct}%)` : ''}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="finance-panel-header">
        <div>
          <h2 className="finance-panel-kicker">Gastos variables</h2>
          <p className="finance-panel-kpi">
            Estimado al mes:&nbsp;
            <span style={{ color: 'var(--app-danger)', fontWeight: 700 }}>${formatAmount(totalEstimado)}</span>
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
              onQueryChange={(value) => { setQuery(value); setPage(1) }}
              placeholder="Buscar por gasto o categoria..."
              page={safePage}
              pageCount={pageCount}
              onPrevPage={() => setPage((prev) => Math.max(1, prev - 1))}
              onNextPage={() => setPage((prev) => Math.min(pageCount, prev + 1))}
              pageSize={pageSize}
              onPageSizeChange={(value) => { setPageSize(value); setPage(1) }}
              totalItems={filas.length}
              filteredItems={filteredRows.length}
              sortField={sortField}
              sortDir={sortDir}
              onSortChange={(field, dir) => { setSortField(field); setSortDir(dir); setPage(1) }}
              sortOptions={[
                { value: 'descripcion', label: 'Nombre' },
                { value: 'estimado', label: 'Estimado' },
                { value: 'real', label: 'Real' },
                { value: 'categoria', label: 'Categoria' },
                { value: 'situacion', label: 'Estado' },
              ]}
              showSearch={filas.length > 0}
              showSort={filas.length > 0}
              showPagination={filas.length > 0}
            >
              <MonthNavigator
                value={selectedMonth}
                onChange={(nextMonth) => {
                  setSelectedMonth(nextMonth)
                  setPage(1)
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
              <div className="table-wrap" style={{ border: 'none', borderRadius: 20 }}>
                <table className="table">
                  <thead>
                    <tr>
                      {['Gasto', 'Categoria', 'Estimado', 'Real del mes', 'Situacion vs. estimado', 'Accion'].map((header) => <th key={header}>{header}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.map((fila) => (
                      <tr key={fila.id}>
                        <td style={{ fontWeight: 600 }}>{fila.descripcion}</td>
                        <td><span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{fila.categoria}</span></td>
                        <td className="table-amount">${formatAmount(parseFloat(fila.estimado))}</td>
                        <td>
                          {fila.real != null ? (
                            <span className="table-amount negative">${formatAmount(parseFloat(fila.real))}</span>
                          ) : (
                            <div>
                              <span style={{ color: 'rgba(var(--app-ink-rgb),0.5)', fontSize: 13 }}>~${formatAmount(parseFloat(fila.sugerido))}</span>
                              <div style={{ fontSize: 11, color: 'rgba(var(--app-ink-rgb),0.3)' }}>estimado</div>
                            </div>
                          )}
                        </td>
                        <td>{renderSituacion(fila)}</td>
                        <td className="table-actions-cell">
                          <div className="table-actions-row">
                            <button
                              className="btn-modal-convert"
                              style={{ minWidth: 0, padding: '7px 12px', fontSize: 12 }}
                              onClick={() => openReal(fila)}
                            >
                              {fila.real != null ? 'Editar' : 'Registrar gasto'}
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
            )}
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

          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">Categoria</label>
              <select className="form-modal-select" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                {categorias.length > 0
                  ? categorias.map((categoria) => <option key={categoria.nombre} value={categoria.nombre}>{categoria.icono} {categoria.nombre}</option>)
                  : <option value="servicios">servicios</option>}
              </select>
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">Monto estimado</label>
              <input className="form-modal-input" type="number" required min="0" step="0.01" placeholder="0" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
              <p style={{ marginTop: 6, fontSize: 12, color: 'rgba(var(--app-ink-rgb),0.45)' }}>
                Lo iremos ajustando con lo que realmente pagues cada mes.
              </p>
            </div>
          </div>

          <div className="form-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={() => setModal(false)}>Cancelar</button>
            <button type="submit" className="btn-modal-save" disabled={saving}>
              {saving ? 'Guardando...' : editId ? 'Guardar cambios' : 'Agregar gasto'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={realItem !== null} onClose={() => setRealItem(null)} title="Cuanto pagaste?">
        {realItem && (
          <form onSubmit={handleSubmitReal}>
            <p style={{ marginTop: -8, marginBottom: 16, fontSize: 13, color: 'rgba(var(--app-ink-rgb),0.5)', lineHeight: 1.5 }}>
              Registra lo que pagaste de <strong>{realItem.descripcion}</strong> este mes.
              Si este mes no gastaste en esto, pon <strong>0</strong>.
            </p>
            <div className="form-modal-group">
              <label className="form-modal-label">Monto real</label>
              <input className="form-modal-input" type="number" min="0" step="0.01" placeholder="0" autoFocus value={realMonto} onChange={(e) => setRealMonto(e.target.value)} />
            </div>
            <div className="form-modal-actions">
              <button type="button" className="btn-modal-cancel" onClick={() => setRealItem(null)}>Cancelar</button>
              <button type="submit" className="btn-modal-save" disabled={savingReal}>
                {savingReal ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
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
    </div>
  )
}
