import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, ChevronRight } from 'lucide-react'

import api from '../../api/client'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import DateQuickActions from '../../components/ui/DateQuickActions'
import ListControls from '../../components/ui/ListControls'
import ListPager from '../../components/ui/ListPager'
import Modal from '../../components/ui/Modal'
import { useCategorias } from '../../hooks/useCategorias'
import { DATE_INPUT_MAX, DATE_INPUT_MIN } from '../../utils/dateBounds'
import { formatAmount } from '../../utils/formatters'
import '../../components/ui/app.css'

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// "Termina en jul 2026" a partir de la fecha de fin (mas humano que la fecha cruda).
function terminaEnLabel(item) {
  if (!item.fecha_fin) return '—'
  const [y, m] = item.fecha_fin.split('-').map(Number)
  const prefijo = item.status?.key === 'finished' ? 'Termino en' : 'Termina en'
  return `${prefijo} ${MESES_CORTOS[m - 1]} ${y}`
}

// Anillo de progreso de cuotas (pagadas / total) al estilo del mockup.
function CuotasRing({ pagadas, total }) {
  const size = 46
  const stroke = 4
  const radius = (size - stroke) / 2
  const circ = 2 * Math.PI * radius
  const ratio = total > 0 ? Math.min(1, Math.max(0, pagadas / total)) : 0
  const color = ratio >= 1 ? 'var(--app-green)' : 'var(--app-lila)'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(var(--app-ink-rgb),0.10)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - ratio)} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.4s' }}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
        fontSize="12" fontWeight="700" fill="var(--app-text)">{pagadas}/{total}</text>
    </svg>
  )
}

const EMPTY = {
  descripcion: '',
  categoria: 'otro',
  monto_total: '',
  num_cuotas: '',
  cuota_mensual: '',
  fecha_inicio: '',
  fecha_fin: '',
  activo: true,
}

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

function diffMonths(start, end) {
  return ((end.getFullYear() - start.getFullYear()) * 12) + (end.getMonth() - start.getMonth())
}

function getItemStatus(item, todayDate, todayString) {
  const startDate = parseLocalDate(item.fecha_inicio)
  const endDate = parseLocalDate(item.fecha_fin)

  if (!item.activo) {
    return {
      key: 'inactive',
      label: 'Inactivo',
      badgeClass: 'badge badge-gray',
      sortBucket: 3,
    }
  }

  if (item.fecha_fin < todayString || endDate < todayDate) {
    return {
      key: 'finished',
      label: 'Finalizado',
      badgeClass: 'badge badge-gray',
      sortBucket: 2,
    }
  }

  if (item.fecha_inicio > todayString || startDate > todayDate) {
    return {
      key: 'upcoming',
      label: 'Por comenzar',
      badgeClass: 'badge badge-lila',
      sortBucket: 1,
    }
  }

  return {
    key: 'current',
    label: 'En curso',
    badgeClass: 'badge badge-green',
    sortBucket: 0,
  }
}

function getProgress(item, todayDate) {
  const startDate = parseLocalDate(item.fecha_inicio)
  const endDate = parseLocalDate(item.fecha_fin)
  const totalMonths = Math.max(1, diffMonths(startDate, endDate) + 1)

  if (!item.activo || todayDate < startDate) return 0
  if (todayDate > endDate) return 100

  const elapsedMonths = Math.max(0, diffMonths(startDate, todayDate) + 1)
  return Math.min(100, Math.max(0, Math.round((elapsedMonths / totalMonths) * 100)))
}

function getRemainingInstallments(item, todayDate, statusKey) {
  if (statusKey === 'finished' || statusKey === 'inactive') return 0
  if (statusKey === 'upcoming') return Number(item.num_cuotas || 0)
  return Math.max(0, diffMonths(todayDate, parseLocalDate(item.fecha_fin)) + 1)
}

export default function Diferidos({ embedded = false, autoNew = false }) {
  const [items, setItems] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sortField, setSortField] = useState('estado')
  const [sortDir, setSortDir] = useState('asc')
  const [totalItems, setTotalItems] = useState(0)
  const [summary, setSummary] = useState({})
  const { categorias } = useCategorias()

  useEffect(() => {
    const timer = setTimeout(() => { void fetchItems() }, 250)
    return () => clearTimeout(timer)
  }, [page, pageSize, query, sortField, sortDir])

  // Abre el form al llegar desde el selector "que quieres registrar".
  useEffect(() => {
    if (autoNew) openNew()
  }, [autoNew])

  async function fetchItems() {
    const { data } = await api.get('/finanzas/diferidos/', {
      params: {
        page,
        page_size: pageSize,
        search: query.trim() || undefined,
        ordering: `${sortDir === 'desc' ? '-' : ''}${sortField}`,
      },
    })
    setItems(data.results || [])
    setTotalItems(data.count || 0)
    setSummary(data.summary || {})
  }

  // Vista previa mientras se llena el formulario: el backend recalcula la cuota
  // al guardar y es la fuente de verdad. Es la cuota base; la ultima puede
  // diferir en centavos porque absorbe el residuo de la division.
  function calcularCuota(monto, cuotas) {
    if (monto && cuotas && parseFloat(cuotas) > 0) {
      return (parseFloat(monto) / parseFloat(cuotas)).toFixed(2)
    }
    return ''
  }

  function calcularFechaFin(fechaInicio, numCuotas) {
    if (!fechaInicio || !numCuotas || parseInt(numCuotas, 10) <= 0) return ''
    const date = parseLocalDate(fechaInicio)
    date.setMonth(date.getMonth() + (parseInt(numCuotas, 10) - 1))
    return formatDateLocal(date)
  }

  function handleMontoOrCuotas(field, value) {
    const updated = { ...form, [field]: value }
    updated.cuota_mensual = calcularCuota(
      field === 'monto_total' ? value : form.monto_total,
      field === 'num_cuotas' ? value : form.num_cuotas,
    )
    const cuotas = field === 'num_cuotas' ? value : form.num_cuotas
    updated.fecha_fin = calcularFechaFin(form.fecha_inicio, cuotas)
    setForm(updated)
  }

  function handleFechaInicio(value) {
    setForm((prev) => ({
      ...prev,
      fecha_inicio: value,
      fecha_fin: calcularFechaFin(value, prev.num_cuotas),
    }))
  }

  function openNew() {
    setForm(EMPTY)
    setEditId(null)
    setModal(true)
  }

  function openEdit(item) {
    setForm({
      descripcion: item.descripcion,
      categoria: item.categoria,
      monto_total: item.monto_total,
      num_cuotas: item.num_cuotas,
      cuota_mensual: item.cuota_mensual,
      fecha_inicio: item.fecha_inicio,
      fecha_fin: item.fecha_fin,
      activo: item.activo,
    })
    setEditId(item.id)
    setModal(true)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    try {
      if (editId) await api.put(`/finanzas/diferidos/${editId}/`, form)
      else await api.post('/finanzas/diferidos/', form)
      setModal(false)
      await fetchItems()
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
    try {
      await api.delete(`/finanzas/diferidos/${id}/`)
      await fetchItems()
    } finally {
      setDeletingId(null)
    }
  }

  const todayString = getTodayDate()
  const todayDate = parseLocalDate(todayString)

  const enrichedItems = useMemo(() => items.map((item) => {
    const status = getItemStatus(item, todayDate, todayString)
    return {
      ...item,
      totalValue: Number(item.monto_total || 0),
      monthlyValue: Number(item.cuota_mes ?? item.cuota_mensual ?? 0),
      progress: getProgress(item, todayDate),
      remainingInstallments: getRemainingInstallments(item, todayDate, status.key),
      status,
    }
  }), [items, todayDate, todayString])

  const totalMensual = Number(summary.monthly_total || 0)
  const totalComprometido = Number(summary.total_committed || 0)
  const activosHoy = Number(summary.current || 0)
  const porComenzar = Number(summary.upcoming || 0)
  const finalizados = Number(summary.finished || 0)
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(page, pageCount)
  const paginatedItems = enrichedItems
  return (
    <div className={embedded ? '' : 'finance-shell'}>
      {embedded ? (
        <div className="finance-panel-header">
          <div>
            <h2 className="finance-panel-kicker">Gastos a cuotas</h2>
            <p className="finance-panel-kpi">Lo que ya cae este mes: <span style={{ color: '#F87171', fontWeight: 700 }}>${formatAmount(totalMensual)}</span></p>
          </div>
          <button className="btn-add page-primary-action" onClick={openNew}><Plus size={16} /> Agregar</button>
        </div>
      ) : (
        <div className="page-header page-header-actions">
          <div className="page-header-main">
            <h1 className="page-title">Gastos a cuotas</h1>
            <p className="page-subtitle">Vista compacta para manejar muchas deudas sin perder de vista lo que vence primero.</p>
          </div>
          <button className="btn-add page-primary-action" onClick={openNew}>
            <Plus size={16} /> Agregar
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="stats-grid diferidos-stats-grid">
          <div className="stat-card">
            <div className="stat-label">Cuota hoy</div>
            <div className="stat-value lila">${formatAmount(totalMensual)}</div>
            <div className="stat-sub">Lo que ya cae en este mes.</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Comprometido</div>
            <div className="stat-value">${formatAmount(totalComprometido)}</div>
            <div className="stat-sub">Activos y por comenzar.</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">En curso</div>
            <div className="stat-value green">{activosHoy}</div>
            <div className="stat-sub">Cuotas corriendo hoy.</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Cola</div>
            <div className="stat-value">{porComenzar}</div>
            <div className="stat-sub">{finalizados} finalizados o fuera del flujo.</div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">💳</div>
            <p className="empty-text">No hay gastos a cuotas</p>
            <p className="empty-sub">Suma una compra a cuotas y la ves en tu flujo.</p>
          </div>
        ) : (
          <>
            <ListControls
              query={query}
              onQueryChange={(value) => { setQuery(value); setPage(1) }}
              placeholder="Buscar por descripcion o categoria..."
              page={safePage}
              pageCount={pageCount}
              onPrevPage={() => setPage((current) => Math.max(1, current - 1))}
              onNextPage={() => setPage((current) => Math.min(pageCount, current + 1))}
              pageSize={pageSize}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
              totalItems={totalItems}
              filteredItems={totalItems}
              sortField={sortField}
              sortDir={sortDir}
              showPagination={false}
              onSortChange={(field, dir) => { setSortField(field); setSortDir(dir); setPage(1) }}
              sortOptions={[
                { value: 'estado', label: 'Estado' },
                { value: 'descripcion', label: 'Nombre' },
                { value: 'monto_total', label: 'Valor' },
                { value: 'cuota_mensual', label: 'Cuota' },
                { value: 'fecha_fin', label: 'Vence' },
              ]}
            />

            {paginatedItems.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Categoria</th>
                      <th>Inicio</th>
                      <th>Vence</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ textAlign: 'right' }}>Cuota</th>
                      <th>Estado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{item.descripcion}</div>
                          <div style={{ color: 'rgba(var(--app-ink-rgb),0.45)', fontSize: 12 }}>
                            {item.num_cuotas} cuotas
                            {item.remainingInstallments > 0 && (
                              <span style={{ color: '#FB923C', fontWeight: 600 }}> · {item.remainingInstallments} {item.remainingInstallments === 1 ? 'falta' : 'faltan'}</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>
                            {item.categoria}
                          </span>
                        </td>
                        <td>
                          <div>{item.fecha_inicio}</div>
                          <div style={{ color: 'rgba(var(--app-ink-rgb),0.45)', fontSize: 12 }}>
                            {item.status.key === 'upcoming' ? 'Aun no empieza' : 'Ya cuenta en tu historial'}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{terminaEnLabel(item)}</div>
                          <div style={{ color: 'rgba(var(--app-ink-rgb),0.45)', fontSize: 12 }}>
                            {item.status.key === 'current' && 'En curso'}
                            {item.status.key === 'upcoming' && 'Pendiente de iniciar'}
                            {item.status.key === 'finished' && 'Ya termino'}
                            {item.status.key === 'inactive' && 'Fuera del flujo'}
                          </div>
                        </td>
                        <td className="table-amount">${formatAmount(item.totalValue)}</td>
                        <td className="table-amount" style={{ color: 'var(--app-lila)' }}>${formatAmount(item.monthlyValue)}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <CuotasRing
                              pagadas={Math.max(0, Number(item.num_cuotas || 0) - item.remainingInstallments)}
                              total={Number(item.num_cuotas || 0)}
                            />
                            <span className={item.status.badgeClass}>{item.status.label}</span>
                          </div>
                        </td>
                        <td className="table-actions-cell">
                          <div className="table-actions-row">
                            <button className="btn-icon edit" onClick={() => openEdit(item)}><Pencil size={15} /></button>
                            <button className="btn-icon danger" disabled={deletingId === item.id} onClick={() => openDeleteConfirm(item.id)}>
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">🔎</div>
                <p className="empty-text">No encontramos cuotas con ese filtro</p>
                <p className="empty-sub">Prueba con otro nombre, categoria o monto.</p>
              </div>
            )}
            <ListPager
              page={safePage}
              pageCount={pageCount}
              onPrevPage={() => setPage((current) => Math.max(1, current - 1))}
              onNextPage={() => setPage((current) => Math.min(pageCount, current + 1))}
              pageSize={pageSize}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
              totalItems={totalItems}
              filteredItems={totalItems}
            />
          </>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar gasto a cuotas' : '+ Nuevo gasto a cuotas'}>
        <form onSubmit={handleSubmit}>
          <div className="form-modal-group">
            <label className="form-modal-label">Que estas pagando?</label>
            <input
              className="form-modal-input"
              required
              placeholder="Ej: celular, viaje, credito..."
              value={form.descripcion}
              onChange={(event) => setForm({ ...form, descripcion: event.target.value })}
            />
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">Categoria</label>
            <select className="form-modal-select" value={form.categoria} onChange={(event) => setForm({ ...form, categoria: event.target.value })}>
              {categorias.map((categoria) => (
                <option key={categoria.nombre} value={categoria.nombre}>
                  {categoria.icono} {categoria.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">Monto total</label>
              <input
                className="form-modal-input"
                type="number"
                required
                min="0"
                step="0.01"
                placeholder="0"
                value={form.monto_total}
                onChange={(event) => handleMontoOrCuotas('monto_total', event.target.value)}
              />
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">Numero de cuotas</label>
              <input
                className="form-modal-input"
                type="number"
                required
                min="1"
                placeholder="12"
                value={form.num_cuotas}
                onChange={(event) => handleMontoOrCuotas('num_cuotas', event.target.value)}
              />
            </div>
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">Cuota al mes</label>
            <input
              className="form-modal-input"
              type="number"
              required
              min="0"
              step="0.01"
              placeholder="Se calcula automatico"
              value={form.cuota_mensual}
              onChange={(event) => setForm({ ...form, cuota_mensual: event.target.value })}
            />
          </div>
          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">Empieza en</label>
              <div className="date-input-wrap">
                <input
                  className="form-modal-input"
                  type="date"
                  required
                  min={DATE_INPUT_MIN}
                  max={DATE_INPUT_MAX}
                  value={form.fecha_inicio}
                  onChange={(event) => handleFechaInicio(event.target.value)}
                />
              </div>
              <DateQuickActions value={form.fecha_inicio} onChange={handleFechaInicio} disabled={loading} />
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">Termina en <span>(auto)</span></label>
              <div className="date-input-wrap">
                <input
                  className="form-modal-input"
                  type="date"
                  required
                  min={form.fecha_inicio || DATE_INPUT_MIN}
                  max={DATE_INPUT_MAX}
                  value={form.fecha_fin}
                  onChange={(event) => setForm({ ...form, fecha_fin: event.target.value })}
                  style={form.fecha_fin ? { borderColor: 'rgba(196,135,246,0.40)' } : {}}
                />
              </div>
            </div>
          </div>
          {editId ? (
            <label className="form-modal-check">
              <input type="checkbox" checked={form.activo} onChange={(event) => setForm({ ...form, activo: event.target.checked })} />
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
                color: 'rgba(var(--app-ink-rgb),0.72)',
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
