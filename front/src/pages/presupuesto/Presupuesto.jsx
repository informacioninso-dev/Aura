import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Check, X, ChevronLeft, ChevronRight } from 'lucide-react'

import api from '../../api/client'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import Modal from '../../components/ui/Modal'
import { formatAmount } from '../../utils/formatters'
import { montoEfectivoMes } from '../../utils/frecuencias'
import '../../components/ui/app.css'

const MESES_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date, n) {
  return new Date(date.getFullYear(), date.getMonth() + n, 1)
}

const ICONOS_SUGERIDOS = ['📦', '🏠', '🛒', '🚗', '💊', '📚', '🎬', '👕', '💡', '💻', '💳', '🐷', '✈️', '🏋️', '🎵', '🍔', '☕', '🎮', '🐾', '🌿', '💰', '🎁', '🔧', '📱']
const EMPTY_FORM = { nombre: '', icono: '📦', limite_mensual: '' }
const ICON_PREVIEW_COUNT = 12
const SUMMARY_PREVIEW_COUNT = 6

function parseLocalDate(value) {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function normalizeText(value) {
  return String(value || '').toLowerCase().trim()
}

function toMoneyNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function percentOf(value, total) {
  if (!total || total <= 0) return 0
  return Math.round((value / total) * 100)
}

function sortCategoriasPorUso(items, gastos) {
  return [...items].sort((a, b) => {
    const gastoDiff = (gastos[b.nombre] || 0) - (gastos[a.nombre] || 0)
    if (Math.abs(gastoDiff) > 0.009) return gastoDiff
    return a.nombre.localeCompare(b.nombre, 'es')
  })
}

export default function Presupuesto() {
  const [categorias, setCategorias] = useState([])
  const [gastos, setGastos] = useState({})
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [editPresup, setEditPresup] = useState(null)
  const [savingBudgetId, setSavingBudgetId] = useState(null)
  const [valorPresup, setValorPresup] = useState('')
  const [query, setQuery] = useState('')
  const [showAllSummary, setShowAllSummary] = useState(false)
  const [showAllIcons, setShowAllIcons] = useState(false)
  const [feedback, setFeedback] = useState({ type: '', message: '' })
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()))

  useEffect(() => {
    cargarTodo(selectedMonth)
  }, [selectedMonth])

  async function cargarTodo(monthDate) {
    const [cats, gc, gnc, dif] = await Promise.all([
      api.get('/finanzas/categorias/'),
      api.get('/finanzas/gastos-corrientes/'),
      api.get('/finanzas/gastos-no-corrientes/'),
      api.get('/finanzas/diferidos/'),
    ])
    setCategorias(cats.data)

    const mes = monthDate.getMonth()
    const anio = monthDate.getFullYear()
    const totales = {}

    gc.data.filter((g) => g.activo).forEach((g) => {
      const ini = parseLocalDate(g.fecha_inicio)
      const fin = g.fecha_fin ? parseLocalDate(g.fecha_fin) : null
      const fecha = new Date(anio, mes, 1)
      if (ini <= fecha && (!fin || fin >= fecha)) {
        totales[g.categoria] = (totales[g.categoria] || 0) + montoEfectivoMes(g.monto, g.frecuencia, g.fecha_inicio, anio, mes + 1)
      }
    })

    gnc.data.forEach((g) => {
      const fecha = parseLocalDate(g.fecha)
      if (fecha.getMonth() === mes && fecha.getFullYear() === anio) {
        totales[g.categoria] = (totales[g.categoria] || 0) + toMoneyNumber(g.monto)
      }
    })

    dif.data.filter((d) => d.activo).forEach((d) => {
      const ini = parseLocalDate(d.fecha_inicio)
      const fin = parseLocalDate(d.fecha_fin)
      const fecha = new Date(anio, mes, 1)
      if (ini <= fecha && fin >= fecha) {
        totales[d.categoria] = (totales[d.categoria] || 0) + toMoneyNumber(d.cuota_mensual)
      }
    })

    setGastos(totales)
  }

  function closeModal() {
    setModal(false)
    setShowAllIcons(false)
  }

  const closeBudgetEditor = useCallback(() => {
    setEditPresup(null)
    setValorPresup('')
  }, [])

  function openNew() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setShowAllIcons(false)
    setModal(true)
  }

  const openEdit = useCallback((cat) => {
    setForm({
      nombre: cat.nombre,
      icono: cat.icono,
      limite_mensual: cat.limite_mensual || '',
    })
    setEditId(cat.id)
    setShowAllIcons(false)
    setModal(true)
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editId) {
        const { data } = await api.put(`/finanzas/categorias/${editId}/`, form)
        setCategorias((prev) => prev.map((cat) => (cat.id === editId ? data : cat)))
      } else {
        const { data } = await api.post('/finanzas/categorias/', form)
        setCategorias((prev) => [...prev, data])
      }
      closeModal()
    } finally {
      setSaving(false)
    }
  }

  const openDeleteConfirm = useCallback((id) => {
    if (!deletingId) setConfirmDeleteId(id)
  }, [deletingId])

  async function handleDelete() {
    const id = confirmDeleteId
    if (!id || deletingId) return

    setConfirmDeleteId(null)
    setDeletingId(id)
    try {
      await api.delete(`/finanzas/categorias/${id}/`)
      setCategorias((prev) => prev.filter((cat) => cat.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  const guardarPresupuesto = useCallback(async (cat) => {
    if (savingBudgetId === cat.id) return
    const rawValue = String(valorPresup || '').trim().replace(',', '.')
    const limite = parseFloat(rawValue)
    if (!rawValue || Number.isNaN(limite) || limite <= 0) {
      setFeedback({ type: 'error', message: 'Escribe un limite mensual valido mayor que cero.' })
      return
    }
    setSavingBudgetId(cat.id)
    setFeedback({ type: '', message: '' })
    try {
      const { data } = await api.patch(`/finanzas/categorias/${cat.id}/`, { limite_mensual: limite })
      setCategorias((prev) => prev.map((item) => (item.id === cat.id ? data : item)))
      closeBudgetEditor()
      setFeedback({ type: 'success', message: `Listo. ${cat.nombre} ya tiene presupuesto mensual.` })
    } catch {
      setFeedback({ type: 'error', message: 'No se pudo guardar el presupuesto. Intenta otra vez.' })
    } finally {
      setSavingBudgetId(null)
    }
  }, [valorPresup, closeBudgetEditor])

  const quitarPresupuesto = useCallback(async (cat) => {
    if (savingBudgetId === cat.id) return
    setSavingBudgetId(cat.id)
    setFeedback({ type: '', message: '' })
    try {
      const { data } = await api.patch(`/finanzas/categorias/${cat.id}/`, { limite_mensual: null })
      setCategorias((prev) => prev.map((item) => (item.id === cat.id ? data : item)))
      closeBudgetEditor()
      setFeedback({ type: 'success', message: `Quitaste el presupuesto mensual de ${cat.nombre}.` })
    } catch {
      setFeedback({ type: 'error', message: 'No se pudo quitar el presupuesto. Intenta otra vez.' })
    } finally {
      setSavingBudgetId(null)
    }
  }, [closeBudgetEditor])

  const categoriasOrdenadas = useMemo(() => sortCategoriasPorUso(categorias, gastos), [categorias, gastos])

  const categoriasFiltradas = useMemo(() => {
    const normalizedQuery = normalizeText(query)
    if (!normalizedQuery) return categoriasOrdenadas
    return categoriasOrdenadas.filter((cat) => normalizeText(cat.nombre).includes(normalizedQuery))
  }, [categoriasOrdenadas, query])

  const conLimite = categoriasFiltradas.filter((cat) => cat.limite_mensual !== null && cat.limite_mensual !== undefined)
  const sinLimite = categoriasFiltradas.filter((cat) => cat.limite_mensual === null || cat.limite_mensual === undefined)
  const sinLimiteConGasto = sinLimite.filter((cat) => (gastos[cat.nombre] || 0) > 0)
  const sinLimiteSinGasto = sinLimite.filter((cat) => !(gastos[cat.nombre] || 0) > 0)

  const resumenCategorias = useMemo(() => (
    categoriasOrdenadas
      .map((cat) => ({ ...cat, gasto: toMoneyNumber(gastos[cat.nombre] || 0) }))
      .filter((cat) => cat.gasto > 0)
  ), [categoriasOrdenadas, gastos])

  const totalGastadoMes = useMemo(
    () => resumenCategorias.reduce((acc, cat) => acc + cat.gasto, 0),
    [resumenCategorias],
  )

  const visibleResumen = showAllSummary ? resumenCategorias : resumenCategorias.slice(0, SUMMARY_PREVIEW_COUNT)
  const visibleIcons = showAllIcons ? ICONOS_SUGERIDOS : ICONOS_SUGERIDOS.slice(0, ICON_PREVIEW_COUNT)
  const categoriasConMovimiento = resumenCategorias.length

  const handlePrevMonth = useCallback(() => setSelectedMonth((m) => addMonths(m, -1)), [])
  const handleNextMonth = useCallback(() => setSelectedMonth((m) => addMonths(m, 1)), [])
  const handleQueryChange = useCallback((e) => setQuery(e.target.value), [])

  return (
    <div>
      <div className="page-header page-header-actions">
        <div className="page-header-main">
          <h1 className="page-title">Categorias y presupuesto</h1>
          <p className="page-subtitle">Organiza tus categorias, mira en que se te va el mes y define limites solo donde de verdad te ayuden.</p>
        </div>
        <button className="btn-add page-primary-action" onClick={openNew}>
          <Plus size={16} />
          Nueva categoria
        </button>
      </div>

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      <div className="presupuesto-month-bar">
        <button
          type="button"
          className="dashboard-cat-month-btn"
          onClick={handlePrevMonth}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="presupuesto-month-label">
          {MESES_FULL[selectedMonth.getMonth()]} {selectedMonth.getFullYear()}
        </span>
        <button
          type="button"
          className="dashboard-cat-month-btn"
          onClick={handleNextMonth}
          disabled={addMonths(selectedMonth, 1) > startOfMonth(new Date())}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Categorias</div>
          <div className="stat-value">{categorias.length}</div>
          <div className="stat-sub">Creadas en total.</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Con limite</div>
          <div className="stat-value">{categorias.filter((cat) => cat.limite_mensual != null).length}</div>
          <div className="stat-sub">Con presupuesto activo.</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Activas</div>
          <div className="stat-value">{categoriasConMovimiento}</div>
          <div className="stat-sub">Con gasto en el mes.</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Gastado</div>
          <div className="stat-value">${formatAmount(totalGastadoMes)}</div>
          <div className="stat-sub">Total categorizado.</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="category-toolbar">
          <div>
            <div className="card-title" style={{ marginBottom: 6 }}>Gestion rapida</div>
            <p className="category-toolbar-copy">
              Busca una categoria, ajusta su limite y revisa en la misma pantalla cuanto lleva este mes.
            </p>
          </div>
          <div className="category-toolbar-search">
            <input
              className="form-modal-input"
              placeholder="Buscar categoria..."
              value={query}
              onChange={handleQueryChange}
            />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div>
            <h2 className="card-title">Resumen por categoria</h2>
            <p className="category-toolbar-copy" style={{ marginTop: 4 }}>
              Lo que mas pesa en {MESES_FULL[selectedMonth.getMonth()]} {selectedMonth.getFullYear()}.
            </p>
          </div>
          {resumenCategorias.length > SUMMARY_PREVIEW_COUNT && (
            <button
              type="button"
              className="btn-modal-cancel"
              onClick={() => setShowAllSummary((value) => !value)}
              style={{ flex: '0 0 auto', minWidth: 116, padding: '10px 16px' }}
            >
              {showAllSummary ? 'Ver menos' : 'Ver todas'}
            </button>
          )}
        </div>

        {resumenCategorias.length > 0 ? (
          <div className="category-summary-list" style={{ marginTop: 16 }}>
            {visibleResumen.map((cat) => (
              <ResumenCategoriaRow
                key={cat.id}
                cat={cat}
                totalGastadoMes={totalGastadoMes}
              />
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 16, textAlign: 'center' }}>
            Sin gastos registrados en {MESES_FULL[selectedMonth.getMonth()]} {selectedMonth.getFullYear()}.
          </p>
        )}
      </div>

      {conLimite.length > 0 && (
        <>
          <p className="presupuesto-section-label">Con limite mensual</p>
          <div className="budget-card-grid" style={{ marginBottom: 28 }}>
            {conLimite.map((cat) => (
              <TarjetaCategoria
                key={cat.id}
                cat={cat}
                gasto={gastos[cat.nombre] || 0}
                openEdit={openEdit}
                handleDelete={openDeleteConfirm}
                deletingId={deletingId}
                editPresup={editPresup}
                setEditPresup={setEditPresup}
                valorPresup={valorPresup}
                setValorPresup={setValorPresup}
                savingBudgetId={savingBudgetId}
                guardarPresupuesto={guardarPresupuesto}
                quitarPresupuesto={quitarPresupuesto}
                closeBudgetEditor={closeBudgetEditor}
              />
            ))}
          </div>
        </>
      )}

      {sinLimiteConGasto.length > 0 && (
        <>
          <p className="presupuesto-section-label">Sin limite · con gasto</p>
          <div className="budget-card-grid" style={{ marginBottom: 28 }}>
            {sinLimiteConGasto.map((cat) => (
              <TarjetaCategoria
                key={cat.id}
                cat={cat}
                gasto={gastos[cat.nombre] || 0}
                openEdit={openEdit}
                handleDelete={openDeleteConfirm}
                deletingId={deletingId}
                editPresup={editPresup}
                setEditPresup={setEditPresup}
                valorPresup={valorPresup}
                setValorPresup={setValorPresup}
                savingBudgetId={savingBudgetId}
                guardarPresupuesto={guardarPresupuesto}
                quitarPresupuesto={quitarPresupuesto}
                closeBudgetEditor={closeBudgetEditor}
              />
            ))}
          </div>
        </>
      )}

      {sinLimiteSinGasto.length > 0 && (
        <>
          <p className="presupuesto-section-label">Sin movimiento este mes</p>
          <div className="card" style={{ padding: '4px 8px' }}>
            {sinLimiteSinGasto.map((cat) => (
              <FilaCategoria
                key={cat.id}
                cat={cat}
                openEdit={openEdit}
                handleDelete={openDeleteConfirm}
                deletingId={deletingId}
                editPresup={editPresup}
                setEditPresup={setEditPresup}
                valorPresup={valorPresup}
                setValorPresup={setValorPresup}
                savingBudgetId={savingBudgetId}
                guardarPresupuesto={guardarPresupuesto}
                closeBudgetEditor={closeBudgetEditor}
              />
            ))}
          </div>
        </>
      )}

      {categoriasFiltradas.length === 0 && (
        <div className="empty-state" style={{ marginTop: 16 }}>
          No encontramos categorias con ese texto. Prueba otro nombre o crea una nueva.
        </div>
      )}

      <Modal open={modal} onClose={closeModal} title={editId ? 'Editar categoria' : 'Nueva categoria'}>
        <form onSubmit={handleSubmit}>
          <div className="form-modal-group">
            <label className="form-modal-label">Nombre</label>
            <input
              className="form-modal-input"
              required
              placeholder="Ej: mascota, gimnasio, cafe..."
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            />
          </div>

          <div className="form-modal-group">
            <label className="form-modal-label">Icono</label>
            <div className="category-icon-grid">
              {visibleIcons.map((icono) => (
                <button
                  key={icono}
                  type="button"
                  className={`category-icon-chip ${form.icono === icono ? 'is-active' : ''}`}
                  onClick={() => setForm({ ...form, icono })}
                >
                  {icono}
                </button>
              ))}
            </div>
            {ICONOS_SUGERIDOS.length > ICON_PREVIEW_COUNT && (
              <button
                type="button"
                className="category-icon-toggle"
                onClick={() => setShowAllIcons((value) => !value)}
              >
                {showAllIcons ? 'Ver menos iconos' : 'Ver mas iconos'}
              </button>
            )}
            <input
              className="form-modal-input"
              placeholder="O escribe tu propio emoji"
              value={form.icono}
              onChange={(e) => setForm({ ...form, icono: e.target.value })}
              style={{ width: 160, marginTop: 10 }}
            />
          </div>

          <div className="form-modal-group">
            <label className="form-modal-label">Presupuesto mensual <span>(opcional)</span></label>
            <input
              className="form-modal-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="Sin limite"
              value={form.limite_mensual}
              onChange={(e) => setForm({ ...form, limite_mensual: e.target.value })}
            />
          </div>

          <div className="form-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={closeModal}>Cancelar</button>
            <button type="submit" className="btn-modal-save" disabled={saving}>
              {saving ? 'Guardando...' : editId ? 'Guardar cambios' : 'Crear categoria'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Eliminar categoria"
        message="Si eliminas esta categoria, los gastos que ya existen conservaran el texto actual en sus registros."
        confirmText="Eliminar"
        cancelText="Cancelar"
        loading={deletingId !== null}
        onConfirm={handleDelete}
        onClose={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}

const ResumenCategoriaRow = memo(function ResumenCategoriaRow({ cat, totalGastadoMes }) {
  const limite = cat.limite_mensual != null ? toMoneyNumber(cat.limite_mensual) : null
  const usoLimite = limite ? Math.round((cat.gasto / limite) * 100) : null
  const porcentajeMes = percentOf(cat.gasto, totalGastadoMes)
  const barColor = usoLimite == null
    ? '#C487F6'
    : usoLimite >= 100
      ? '#F87171'
      : usoLimite >= 75
        ? '#FBBF24'
        : '#10B981'
  const barWidth = usoLimite == null ? Math.max(8, porcentajeMes) : Math.min(100, usoLimite)

  return (
    <div className="category-summary-row">
      <div className="category-summary-row-top">
        <div className="category-summary-meta">
          <span style={{ fontSize: 22 }}>{cat.icono}</span>
          <div>
            <div className="category-summary-name">{cat.nombre}</div>
            <div className="category-summary-sub">
              {porcentajeMes}% de tus gastos del mes
              {limite != null ? ` · ${Math.min(usoLimite, 999)}% del limite` : ' · sin limite'}
            </div>
          </div>
        </div>
        <div className="category-summary-amount">${formatAmount(cat.gasto)}</div>
      </div>

      <div className="category-summary-bar">
        <div
          className="category-summary-bar-fill"
          style={{ width: `${barWidth}%`, background: barColor }}
        />
      </div>
    </div>
  )
})

const TarjetaCategoria = memo(function TarjetaCategoria({
  cat,
  gasto,
  openEdit,
  handleDelete,
  deletingId,
  editPresup,
  setEditPresup,
  valorPresup,
  setValorPresup,
  savingBudgetId,
  guardarPresupuesto,
  quitarPresupuesto,
  closeBudgetEditor,
}) {
  const limite = cat.limite_mensual != null ? parseFloat(cat.limite_mensual) : null
  const pct = limite ? Math.min(100, Math.round((gasto / limite) * 100)) : null
  const over = pct !== null && pct >= 100
  const warn = pct !== null && pct >= 75 && pct < 100
  const barColor = over ? '#F87171' : warn ? '#FBBF24' : '#10B981'
  const isSavingBudget = savingBudgetId === cat.id

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="budget-card-head">
        <div className="budget-card-meta">
          <span style={{ fontSize: 24 }}>{cat.icono}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, textTransform: 'capitalize' }}>{cat.nombre}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>
              {gasto > 0 ? `Este mes: $${formatAmount(gasto)}` : 'Sin gasto este mes'}
            </div>
          </div>
        </div>

        <div className="table-actions-row">
          <button className="btn-icon edit" onClick={() => openEdit(cat)}><Pencil size={13} /></button>
          <button className="btn-icon danger" disabled={deletingId === cat.id} onClick={() => handleDelete(cat.id)}><Trash2 size={13} /></button>
        </div>
      </div>

      {limite !== null && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
            <span style={{ color: over ? '#F87171' : warn ? '#FBBF24' : 'rgba(255,255,255,0.60)' }}>
              ${formatAmount(gasto)}
              {over ? '  · limite superado' : ''}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.30)' }}>${formatAmount(limite)}</span>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 99, height: 6, marginBottom: 4 }}>
            <div style={{ width: `${pct}%`, height: 6, borderRadius: 99, background: barColor, transition: 'width 0.4s' }} />
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', textAlign: 'right', marginBottom: 10 }}>{pct}% usado</div>
        </>
      )}

      {editPresup === cat.id ? (
        <form
          className="budget-inline-edit"
          onSubmit={(e) => {
            e.preventDefault()
            guardarPresupuesto(cat)
          }}
        >
          <input
            className="form-modal-input"
            type="number"
            min="0"
            step="0.01"
            placeholder="Limite mensual"
            value={valorPresup}
            onChange={(e) => setValorPresup(e.target.value)}
            inputMode="decimal"
            style={{ flex: 1, padding: '10px 12px', fontSize: 14 }}
            autoFocus
            disabled={isSavingBudget}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeBudgetEditor()
            }}
          />
          <div className="budget-inline-actions">
            <button
              type="submit"
              className="budget-inline-button budget-inline-button-primary"
              disabled={isSavingBudget}
            >
              <Check size={14} /> {isSavingBudget ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              type="button"
              className="budget-inline-button budget-inline-button-secondary"
              onClick={closeBudgetEditor}
              disabled={isSavingBudget}
            >
              Cancelar
            </button>
            {limite !== null && (
              <button
                type="button"
                className="budget-inline-button budget-inline-button-danger"
                onClick={() => quitarPresupuesto(cat)}
                disabled={isSavingBudget}
              >
                <X size={14} /> Quitar
              </button>
            )}
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditPresup(cat.id)
            setValorPresup(cat.limite_mensual || '')
          }}
          style={{
            width: '100%',
            padding: '8px 0',
            fontSize: 12,
            fontWeight: 600,
            color: limite ? 'rgba(255,255,255,0.38)' : '#C487F6',
            background: limite ? 'rgba(255,255,255,0.04)' : 'rgba(196,135,246,0.08)',
            border: limite ? '1px solid rgba(255,255,255,0.07)' : '1px dashed rgba(196,135,246,0.35)',
            borderRadius: 10,
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {limite ? 'Cambiar limite' : 'Anadir limite mensual'}
        </button>
      )}
    </div>
  )
})

const FilaCategoria = memo(function FilaCategoria({
  cat,
  openEdit,
  handleDelete,
  deletingId,
  editPresup,
  setEditPresup,
  valorPresup,
  setValorPresup,
  savingBudgetId,
  guardarPresupuesto,
  closeBudgetEditor,
}) {
  const isSavingBudget = savingBudgetId === cat.id
  const isEditing = editPresup === cat.id

  return (
    <div className="presupuesto-fila">
      <div className="presupuesto-fila-meta">
        <span style={{ fontSize: 20, lineHeight: 1 }}>{cat.icono}</span>
        <span className="presupuesto-fila-nombre">{cat.nombre}</span>
      </div>

      <div className="presupuesto-fila-actions">
        {isEditing ? (
          <form
            className="presupuesto-fila-edit"
            onSubmit={(e) => { e.preventDefault(); guardarPresupuesto(cat) }}
          >
            <input
              className="form-modal-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="Limite mensual"
              value={valorPresup}
              onChange={(e) => setValorPresup(e.target.value)}
              inputMode="decimal"
              autoFocus
              disabled={isSavingBudget}
              className="presupuesto-fila-edit-input"
              style={{ padding: '6px 10px', fontSize: 13 }}
              onKeyDown={(e) => { if (e.key === 'Escape') closeBudgetEditor() }}
            />
            <button type="submit" className="budget-inline-button budget-inline-button-primary" disabled={isSavingBudget} style={{ padding: '6px 10px' }}>
              <Check size={13} /> {isSavingBudget ? '...' : 'Guardar'}
            </button>
            <button type="button" className="budget-inline-button budget-inline-button-secondary" onClick={closeBudgetEditor} disabled={isSavingBudget} style={{ padding: '6px 10px' }}>
              Cancelar
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="presupuesto-fila-add-btn"
            onClick={() => { setEditPresup(cat.id); setValorPresup('') }}
          >
            + Limite
          </button>
        )}
        <button className="btn-icon edit" onClick={() => openEdit(cat)}><Pencil size={13} /></button>
        <button className="btn-icon danger" disabled={deletingId === cat.id} onClick={() => handleDelete(cat.id)}><Trash2 size={13} /></button>
      </div>
    </div>
  )
})
