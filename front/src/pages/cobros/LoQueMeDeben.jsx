import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Rat, Trash2 } from 'lucide-react'

import api from '../../api/client'
import { getApiErrorMessage } from '../../api/errors'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import ListControls from '../../components/ui/ListControls'
import Modal from '../../components/ui/Modal'
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

function normalizePayload(form) {
  return {
    ...form,
    fecha_recordatorio: form.fecha_recordatorio || null,
    notas: form.notas?.trim() || '',
  }
}

export default function LoQueMeDeben() {
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
  const [feedback, setFeedback] = useState({ type: '', message: '' })
  const [form, setForm] = useState(buildEmptyForm())

  useEffect(() => {
    void fetchItems()
  }, [])

  async function fetchItems() {
    try {
      const { data } = await api.get('/finanzas/cuentas-por-cobrar/')
      setItems(data)
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No pudimos cargar lo que te deben.') })
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
    const payload = normalizePayload(form)

    try {
      if (editId) await api.put(`/finanzas/cuentas-por-cobrar/${editId}/`, payload)
      else await api.post('/finanzas/cuentas-por-cobrar/', payload)
      setModal(false)
      await fetchItems()
      setFeedback({
        type: 'success',
        message: editId ? 'Deuda actualizada correctamente.' : 'Deuda registrada correctamente.',
      })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo guardar esta deuda.') })
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
      setFeedback({ type: 'success', message: 'Deuda eliminada correctamente.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo eliminar esta deuda.') })
    } finally {
      setDeletingId(null)
    }
  }

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = useMemo(() => items.filter((item) => (
    item.persona.toLowerCase().includes(normalizedQuery)
    || item.concepto.toLowerCase().includes(normalizedQuery)
    || (item.notas || '').toLowerCase().includes(normalizedQuery)
  )), [items, normalizedQuery])

  const totalPendiente = filtered.reduce((sum, item) => sum + Number(item.saldo_pendiente || 0), 0)
  const totalCobrado = filtered.reduce((sum, item) => sum + Number(item.monto_cobrado || 0), 0)
  const casosAbiertos = filtered.filter((item) => Number(item.saldo_pendiente || 0) > 0).length
  const personasUnicas = new Set(filtered.map((item) => item.persona.trim().toLowerCase())).size

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const paginated = filtered.slice(start, start + pageSize)

  return (
    <div className="finance-shell">
      <div className="page-header page-header-actions">
        <div className="page-header-main">
          <h1 className="page-title">Lo que me deben</h1>
          <p className="page-subtitle">Prestamos, vueltas y pendientes que otras personas tienen contigo.</p>
        </div>
        <button className="btn-add page-primary-action" onClick={openNew}>
          <Plus size={16} /> Agregar
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Te deben hoy</div>
          <div className="stat-value lila">${formatNumber(totalPendiente)}</div>
          <div className="stat-sub">Lo que todavia no te han pagado.</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ya te devolvieron</div>
          <div className="stat-value green">${formatNumber(totalCobrado)}</div>
          <div className="stat-sub">Abonos y pagos que ya recibiste.</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Casos abiertos</div>
          <div className="stat-value">{casosAbiertos}</div>
          <div className="stat-sub">Deudas que siguen pendientes.</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Personas</div>
          <div className="stat-value">{personasUnicas}</div>
          <div className="stat-sub">Cuantas personas te deben algo.</div>
        </div>
      </div>

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      <div className="card" style={{ padding: 0 }}>
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><Rat size={38} strokeWidth={1.8} /></div>
            <p className="empty-text">Todavia no registras deudas a tu favor</p>
            <p className="empty-sub">Aqui puedes anotar prestamos, favores o dinero pendiente por cobrar.</p>
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
            />

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Quien</th>
                    <th>Por que</th>
                    <th>Fecha</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Te ha pagado</th>
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
                      <td className="table-amount">${formatNumber(Number(item.monto_total || 0))}</td>
                      <td className="table-amount positive">${formatNumber(Number(item.monto_cobrado || 0))}</td>
                      <td className="table-amount negative">${formatNumber(Number(item.saldo_pendiente || 0))}</td>
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

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar deuda a tu favor' : '+ Nueva deuda a tu favor'}>
        <form onSubmit={handleSubmit}>
          {!editId && (
            <p style={{ marginTop: -8, marginBottom: 14, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              Carga rapida: quien te debe, por que y cuanto.
            </p>
          )}

          <div className="form-modal-group">
            <label className="form-modal-label">Quien te debe?</label>
            <input
              className="form-modal-input"
              required
              placeholder="Ej: Mamá, Juan, compañera de trabajo..."
              value={form.persona}
              onChange={(e) => setForm({ ...form, persona: e.target.value })}
            />
          </div>

          <div className="form-modal-group">
            <label className="form-modal-label">Por que te debe?</label>
            <input
              className="form-modal-input"
              required
              placeholder="Ej: prestamo, almuerzo, pasajes, regalo..."
              value={form.concepto}
              onChange={(e) => setForm({ ...form, concepto: e.target.value })}
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
                onChange={(e) => setForm({ ...form, monto_total: e.target.value })}
              />
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">Ya te pagaron</label>
              <input
                className="form-modal-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={form.monto_cobrado}
                onChange={(e) => setForm({ ...form, monto_cobrado: e.target.value })}
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
                      value={form.fecha_prestamo}
                      onChange={(e) => setForm({ ...form, fecha_prestamo: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-modal-group">
                  <label className="form-modal-label">Recordarmelo <span>(opcional)</span></label>
                  <div className="date-input-wrap">
                    <input
                      className="form-modal-input"
                      type="date"
                      value={form.fecha_recordatorio}
                      onChange={(e) => setForm({ ...form, fecha_recordatorio: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="form-modal-group">
                <label className="form-modal-label">Notas <span>(opcional)</span></label>
                <textarea
                  className="form-modal-input"
                  rows={2}
                  placeholder="Ej: me dijo que me paga a fin de mes..."
                  value={form.notas}
                  onChange={(e) => setForm({ ...form, notas: e.target.value })}
                  style={{ resize: 'none', height: 'auto' }}
                />
              </div>
            </>
          )}

          {!editId && !showAdvanced && (
            <p style={{ marginTop: -4, marginBottom: 18, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              Si no cambias nada, queda con fecha de hoy y sin recordatorio.
            </p>
          )}

          <div className="form-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={() => setModal(false)}>Cancelar</button>
            <button type="submit" className="btn-modal-save" disabled={loading}>
              {loading ? 'Guardando...' : editId ? 'Guardar cambios' : 'Guardar deuda'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Eliminar deuda"
        message="Esta deuda saldra de tu lista y de tus totales."
        confirmText="Eliminar"
        cancelText="Cancelar"
        loading={deletingId !== null}
        onConfirm={handleDelete}
        onClose={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}
