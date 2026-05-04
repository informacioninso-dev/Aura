import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Rat, Trash2 } from 'lucide-react'

import api from '../../api/client'
import { getApiErrorMessage } from '../../api/errors'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import DateQuickActions from '../../components/ui/DateQuickActions'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import ListControls from '../../components/ui/ListControls'
import Modal from '../../components/ui/Modal'
import { DATE_INPUT_MAX, DATE_INPUT_MIN } from '../../utils/dateBounds'
import { formatAmount } from '../../utils/formatters'
import '../../components/ui/app.css'

const DIRECTION_CONFIG = {
  me_deben: {
    panelKicker: 'Me deben',
    headerTitle: 'Lo que me deben',
    headerSubtitle: 'Prestamos, vueltas y pendientes que otras personas tienen contigo.',
    panelKpiLabel: 'Pendiente por cobrar',
    panelAccent: '#C487F6',
    fetchError: 'No pudimos cargar lo que te deben.',
    pendingLabel: 'Te deben hoy',
    pendingValueClass: 'lila',
    pendingSub: 'Lo que todavia no te han pagado.',
    settledLabel: 'Ya te devolvieron',
    settledValueClass: 'green',
    settledSub: 'Abonos y pagos que ya recibiste.',
    openCasesSub: 'Deudas que siguen pendientes.',
    peopleSub: 'Cuantas personas te deben algo.',
    emptyText: 'Todavia no registras deudas a tu favor',
    emptySub: 'Aqui puedes anotar prestamos, favores o dinero pendiente por cobrar.',
    createTitle: '+ Nueva cuenta a tu favor',
    editTitle: 'Editar cuenta a tu favor',
    quickHint: 'Carga rapida: quien te debe, por que y cuanto.',
    idleHint: 'Si no cambias nada, queda con fecha de hoy y sin recordatorio.',
    personaLabel: 'Quien te debe?',
    personaPlaceholder: 'Ej: Mama, Juan, companera de trabajo...',
    conceptoLabel: 'Por que te debe?',
    conceptoPlaceholder: 'Ej: prestamo, almuerzo, pasajes, regalo...',
    paidLabel: 'Ya te pagaron',
    paidColumn: 'Te ha pagado',
  },
  debo: {
    panelKicker: 'Debo',
    headerTitle: 'Lo que debo',
    headerSubtitle: 'Vueltas, prestamos y pendientes que tienes con personas conocidas.',
    panelKpiLabel: 'Pendiente por pagar',
    panelAccent: '#F87171',
    fetchError: 'No pudimos cargar lo que debes.',
    pendingLabel: 'Debo hoy',
    pendingValueClass: 'red',
    pendingSub: 'Lo que todavia te falta por pagar.',
    settledLabel: 'Ya pague',
    settledValueClass: 'green',
    settledSub: 'Abonos y pagos que ya salieron.',
    openCasesSub: 'Deudas que aun no cierras.',
    peopleSub: 'Cuantas personas esperan un pago tuyo.',
    emptyText: 'Todavia no registras deudas pendientes',
    emptySub: 'Aqui puedes anotar prestamos, vueltas o dinero que debes a personas conocidas.',
    createTitle: '+ Nueva cuenta pendiente',
    editTitle: 'Editar cuenta pendiente',
    quickHint: 'Carga rapida: a quien debes, por que y cuanto.',
    idleHint: 'Si no cambias nada, queda con fecha de hoy y sin recordatorio.',
    personaLabel: 'A quien le debes?',
    personaPlaceholder: 'Ej: Papa, amiga, vecino...',
    conceptoLabel: 'Por que le debes?',
    conceptoPlaceholder: 'Ej: prestamo, almuerzo, pasajes, regalo...',
    paidLabel: 'Ya pagaste',
    paidColumn: 'Ya pagaste',
  },
}

function getTodayDate() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getDirectionConfig(direction) {
  return DIRECTION_CONFIG[direction] || DIRECTION_CONFIG.me_deben
}

function buildEmptyForm(direction = 'me_deben') {
  return {
    direccion: direction,
    persona: '',
    concepto: '',
    monto_total: '',
    monto_cobrado: '0',
    fecha_prestamo: getTodayDate(),
    fecha_recordatorio: '',
    notas: '',
  }
}

function getBadgeClass(estado) {
  if (estado === 'pagado') return 'badge badge-green'
  if (estado === 'pagando') return 'badge badge-yellow'
  return 'badge badge-lila'
}

function getBadgeLabel(estado) {
  if (estado === 'pagado') return 'Pagado'
  if (estado === 'pagando') return 'Pagando'
  return 'Pendiente'
}

function normalizePayload(form, direction) {
  return {
    ...form,
    direccion: form.direccion || direction,
    fecha_recordatorio: form.fecha_recordatorio || null,
    notas: form.notas?.trim() || '',
  }
}

export default function CuentasPersonasPanel({ embedded = false, direction = 'me_deben' }) {
  const config = getDirectionConfig(direction)
  const [items, setItems] = useState([])
  const [modal, setModal] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sortField, setSortField] = useState('fecha_prestamo')
  const [sortDir, setSortDir] = useState('desc')
  const [feedback, setFeedback] = useState({ type: '', message: '' })
  const [form, setForm] = useState(buildEmptyForm(direction))

  const fetchItems = useCallback(async () => {
    try {
      const { data } = await api.get('/finanzas/cuentas-por-cobrar/', { params: { direccion: direction } })
      setItems(data)
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, config.fetchError) })
    }
  }, [config.fetchError, direction])

  useEffect(() => {
    void fetchItems()
  }, [fetchItems])

  function openNew() {
    setForm(buildEmptyForm(direction))
    setEditId(null)
    setShowAdvanced(false)
    setModal(true)
  }

  function openEdit(item) {
    setForm({
      direccion: item.direccion || direction,
      persona: item.persona,
      concepto: item.concepto,
      monto_total: item.monto_total,
      monto_cobrado: item.monto_cobrado,
      fecha_prestamo: item.fecha_prestamo,
      fecha_recordatorio: item.fecha_recordatorio || '',
      notas: item.notas || '',
    })
    setEditId(item.id)
    setShowAdvanced(true)
    setModal(true)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setFeedback({ type: '', message: '' })
    const payload = normalizePayload(form, direction)

    try {
      if (editId) await api.put(`/finanzas/cuentas-por-cobrar/${editId}/`, payload)
      else await api.post('/finanzas/cuentas-por-cobrar/', payload)
      setModal(false)
      await fetchItems()
      setFeedback({
        type: 'success',
        message: editId ? 'Cuenta actualizada correctamente.' : 'Cuenta registrada correctamente.',
      })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo guardar esta cuenta.') })
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
      await api.delete(`/finanzas/cuentas-por-cobrar/${id}/`)
      await fetchItems()
      setFeedback({ type: 'success', message: 'Cuenta eliminada correctamente.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo eliminar esta cuenta.') })
    } finally {
      setDeletingId(null)
    }
  }

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = useMemo(() => items.filter((item) => (
    item.persona.toLowerCase().includes(normalizedQuery)
    || item.concepto.toLowerCase().includes(normalizedQuery)
    || (item.notas || '').toLowerCase().includes(normalizedQuery)
  )).sort((a, b) => {
    const numFields = ['monto_total', 'monto_cobrado', 'saldo_pendiente']
    const av = numFields.includes(sortField) ? parseFloat(a[sortField] || 0) : (a[sortField] || '')
    const bv = numFields.includes(sortField) ? parseFloat(b[sortField] || 0) : (b[sortField] || '')
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  }), [items, normalizedQuery, sortField, sortDir])

  const totalPendiente = filtered.reduce((sum, item) => sum + Number(item.saldo_pendiente || 0), 0)
  const totalCobrado = filtered.reduce((sum, item) => sum + Number(item.monto_cobrado || 0), 0)
  const casosAbiertos = filtered.filter((item) => Number(item.saldo_pendiente || 0) > 0).length
  const personasUnicas = new Set(filtered.map((item) => item.persona.trim().toLowerCase())).size

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const paginated = filtered.slice(start, start + pageSize)

  return (
    <div className={`cuentas-personas-panel is-${direction}`}>
      {embedded ? (
        <div className="finance-panel-header">
          <div className="finance-panel-copy">
            <h2 className="finance-panel-kicker">{config.panelKicker}</h2>
            <p className="finance-panel-kpi">
              {config.panelKpiLabel}:&nbsp;
              <span style={{ color: config.panelAccent, fontWeight: 700 }}>
                ${formatAmount(totalPendiente)}
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
            <h1 className="page-title">{config.headerTitle}</h1>
            <p className="page-subtitle">{config.headerSubtitle}</p>
          </div>
          <button className="btn-add page-primary-action" onClick={openNew}>
            <Plus size={16} /> Agregar
          </button>
        </div>
      )}

      <div className="stats-grid cobros-stats-grid">
        <div className="stat-card">
          <div className="stat-label">{config.pendingLabel}</div>
          <div className={`stat-value ${config.pendingValueClass}`}>${formatAmount(totalPendiente)}</div>
          <div className="stat-sub">{config.pendingSub}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{config.settledLabel}</div>
          <div className={`stat-value ${config.settledValueClass}`}>${formatAmount(totalCobrado)}</div>
          <div className="stat-sub">{config.settledSub}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Casos abiertos</div>
          <div className="stat-value">{casosAbiertos}</div>
          <div className="stat-sub">{config.openCasesSub}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Personas</div>
          <div className="stat-value">{personasUnicas}</div>
          <div className="stat-sub">{config.peopleSub}</div>
        </div>
      </div>

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      <div className="card" style={{ padding: 0 }}>
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><Rat size={38} strokeWidth={1.8} /></div>
            <p className="empty-text">{config.emptyText}</p>
            <p className="empty-sub">{config.emptySub}</p>
          </div>
        ) : (
          <>
            <ListControls
              query={query}
              onQueryChange={(value) => { setQuery(value); setPage(1) }}
              placeholder="Buscar por persona, concepto o nota..."
              page={safePage}
              pageCount={pageCount}
              onPrevPage={() => setPage((p) => Math.max(1, p - 1))}
              onNextPage={() => setPage((p) => Math.min(pageCount, p + 1))}
              pageSize={pageSize}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
              totalItems={items.length}
              filteredItems={filtered.length}
              sortField={sortField}
              sortDir={sortDir}
              onSortChange={(field, dir) => { setSortField(field); setSortDir(dir); setPage(1) }}
              sortOptions={[
                { value: 'persona', label: 'Persona' },
                { value: 'monto_total', label: 'Total' },
                { value: 'saldo_pendiente', label: 'Pendiente' },
                { value: 'fecha_prestamo', label: 'Fecha' },
              ]}
            />

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Persona</th>
                    <th>Motivo</th>
                    <th>Fecha</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>{config.paidColumn}</th>
                    <th style={{ textAlign: 'right' }}>Pendiente</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((item) => (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 700 }}>{item.persona}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.concepto}</div>
                        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{item.notas || 'Sin notas'}</div>
                      </td>
                      <td>
                        <div>{item.fecha_prestamo}</div>
                        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
                          {item.fecha_recordatorio ? `Recordar: ${item.fecha_recordatorio}` : 'Sin recordatorio'}
                        </div>
                      </td>
                      <td className="table-amount">${formatAmount(Number(item.monto_total || 0))}</td>
                      <td className="table-amount positive">${formatAmount(Number(item.monto_cobrado || 0))}</td>
                      <td className="table-amount negative">${formatAmount(Number(item.saldo_pendiente || 0))}</td>
                      <td><span className={getBadgeClass(item.estado)}>{getBadgeLabel(item.estado)}</span></td>
                      <td className="table-actions-cell">
                        <button className="btn-icon edit" onClick={() => openEdit(item)}><Pencil size={15} /></button>
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

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? config.editTitle : config.createTitle}>
        <form onSubmit={handleSubmit}>
          {!editId && (
            <p style={{ marginTop: -8, marginBottom: 14, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              {config.quickHint}
            </p>
          )}

          <div className="form-modal-group">
            <label className="form-modal-label">{config.personaLabel}</label>
            <input
              className="form-modal-input"
              required
              placeholder={config.personaPlaceholder}
              value={form.persona}
              onChange={(event) => setForm({ ...form, persona: event.target.value })}
            />
          </div>

          <div className="form-modal-group">
            <label className="form-modal-label">{config.conceptoLabel}</label>
            <input
              className="form-modal-input"
              required
              placeholder={config.conceptoPlaceholder}
              value={form.concepto}
              onChange={(event) => setForm({ ...form, concepto: event.target.value })}
            />
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
                onChange={(event) => setForm({ ...form, monto_total: event.target.value })}
              />
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">{config.paidLabel}</label>
              <input
                className="form-modal-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={form.monto_cobrado}
                onChange={(event) => setForm({ ...form, monto_cobrado: event.target.value })}
              />
            </div>
          </div>

          {!editId && (
            <button
              type="button"
              className="btn-modal-cancel"
              onClick={() => setShowAdvanced((value) => !value)}
              style={{ width: '100%', marginBottom: 14 }}
            >
              {showAdvanced ? 'Ocultar opciones' : 'Ver mas opciones'}
            </button>
          )}

          {(editId || showAdvanced) && (
            <>
              <div className="form-modal-row">
                <div className="form-modal-group">
                  <label className="form-modal-label">Desde cuando?</label>
                  <div className="date-input-wrap">
                    <input
                      className="form-modal-input"
                      type="date"
                      required
                      min={DATE_INPUT_MIN}
                      max={DATE_INPUT_MAX}
                      value={form.fecha_prestamo}
                      onChange={(event) => setForm((prev) => ({
                        ...prev,
                        fecha_prestamo: event.target.value,
                        fecha_recordatorio: prev.fecha_recordatorio && prev.fecha_recordatorio < event.target.value ? '' : prev.fecha_recordatorio,
                      }))}
                    />
                  </div>
                  <DateQuickActions
                    value={form.fecha_prestamo}
                    onChange={(value) => setForm((prev) => ({
                      ...prev,
                      fecha_prestamo: value,
                      fecha_recordatorio: prev.fecha_recordatorio && prev.fecha_recordatorio < value ? '' : prev.fecha_recordatorio,
                    }))}
                    disabled={loading}
                  />
                </div>
                <div className="form-modal-group">
                  <label className="form-modal-label">Recordarmelo <span>(opcional)</span></label>
                  <div className="date-input-wrap">
                    <input
                      className="form-modal-input"
                      type="date"
                      min={form.fecha_prestamo || DATE_INPUT_MIN}
                      max={DATE_INPUT_MAX}
                      value={form.fecha_recordatorio}
                      onChange={(event) => setForm({ ...form, fecha_recordatorio: event.target.value })}
                    />
                  </div>
                  <DateQuickActions
                    value={form.fecha_recordatorio}
                    onChange={(value) => setForm({ ...form, fecha_recordatorio: value })}
                    allowClear
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="form-modal-group">
                <label className="form-modal-label">Notas <span>(opcional)</span></label>
                <textarea
                  className="form-modal-input"
                  rows={2}
                  placeholder="Ej: me dijo que lo cierra a fin de mes..."
                  value={form.notas}
                  onChange={(event) => setForm({ ...form, notas: event.target.value })}
                  style={{ resize: 'none', height: 'auto' }}
                />
              </div>
            </>
          )}

          {!editId && !showAdvanced && (
            <p style={{ marginTop: -4, marginBottom: 18, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              {config.idleHint}
            </p>
          )}

          <div className="form-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={() => setModal(false)}>Cancelar</button>
            <button type="submit" className="btn-modal-save" disabled={loading}>
              {loading ? 'Guardando...' : editId ? 'Guardar cambios' : 'Guardar cuenta'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Eliminar cuenta"
        message="Esta cuenta saldra de tu lista y de tus totales."
        confirmText="Eliminar"
        cancelText="Cancelar"
        loading={deletingId !== null}
        onConfirm={handleDelete}
        onClose={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}
