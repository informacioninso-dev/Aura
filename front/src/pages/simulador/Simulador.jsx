import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  Calculator,
  CalendarClock,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Repeat2,
  Save,
  Trash2,
  WalletCards,
  XCircle,
} from 'lucide-react'

import { getApiErrorMessage } from '../../api/errors'
import api from '../../api/client'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import DateQuickActions from '../../components/ui/DateQuickActions'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import ListControls from '../../components/ui/ListControls'
import ListPager from '../../components/ui/ListPager'
import { useAuth } from '../../context/useAuth'
import { DATE_INPUT_MAX } from '../../utils/dateBounds'
import { formatMoney } from '../../utils/formatters'
import '../../components/ui/app.css'

const SimulationBalanceChart = lazy(() => import('../../components/charts/SimulationBalanceChart'))

const COLCHON_STORAGE_KEY = 'simulador_colchon_minimo'
const PAST_SIMULATION_DATE_MESSAGE = 'El simulador solo permite fechas desde hoy hacia adelante.'
const SIMULATOR_CHART_BREAKPOINT = 768
const MOBILE_SIMULATION_WINDOW_MONTHS = 6
const DESKTOP_SIMULATION_WINDOW_MONTHS = 12
const PROJECTION_MODE_LABELS = {
  automatica: 'Inteligente',
  simple: 'Simple',
  conservadora: 'Conservadora',
}
const SCENARIO_TYPE_LABELS = {
  contado: 'Pago unico',
  cuotas: 'Prestamo',
  recurrente: 'Gasto mensual',
}
const SCENARIO_TYPES = [
  {
    value: 'contado',
    label: 'Pago unico',
    description: 'Viaje, boda, cirugia o una compra de contado.',
    icon: WalletCards,
  },
  {
    value: 'cuotas',
    label: 'Prestamo',
    description: 'Vehiculo, vivienda, equipo o prestamo.',
    icon: CreditCard,
  },
  {
    value: 'recurrente',
    label: 'Gasto mensual',
    description: 'Mudanza, estudios, un hijo o un nuevo estilo de vida.',
    icon: Repeat2,
  },
]

function parseLocalDate(value) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function shiftMonths(date, amount) {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(date.getDate(), lastDay))
  return target
}

function formatDateLocal(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeApiMessage(value) {
  if (Array.isArray(value)) return value.map(normalizeApiMessage).filter(Boolean).join(' ')
  if (value && typeof value === 'object') return Object.values(value).map(normalizeApiMessage).filter(Boolean).join(' ')
  if (value == null) return ''
  return String(value)
}

function normalizeDetectedDuplicates(items) {
  if (!Array.isArray(items)) return []
  return items.map((item) => ({
    id: Number(item?.id),
    descripcion: normalizeApiMessage(item?.descripcion),
    fecha_inicio: normalizeApiMessage(item?.fecha_inicio),
    fecha_fin: normalizeApiMessage(item?.fecha_fin),
    cuota_mensual: normalizeApiMessage(item?.cuota_mensual),
  }))
}

function clampSimulationWindow(startIndex, totalPoints, windowSize) {
  if (totalPoints <= 0) return { startIndex: 0, endIndex: 0 }

  const safeWindowSize = Math.max(1, Math.min(windowSize, totalPoints))
  const maxStartIndex = Math.max(0, totalPoints - safeWindowSize)
  const safeStartIndex = Math.min(Math.max(0, startIndex), maxStartIndex)

  return {
    startIndex: safeStartIndex,
    endIndex: Math.min(totalPoints - 1, safeStartIndex + safeWindowSize - 1),
  }
}

function getInitialColchonMinimo() {
  if (typeof window === 'undefined') return ''
  const savedValue = window.localStorage.getItem(COLCHON_STORAGE_KEY)
  const parsed = Number(savedValue)
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : ''
}

function createInitialForm() {
  return {
    tipo: 'contado',
    nombre: '',
    monto: '',
    banco: '',
    tasa_anual: '0',
    plazo_meses: '12',
    colchon_minimo: getInitialColchonMinimo(),
    fecha_inicio: formatDateLocal(new Date()),
  }
}

const SIMULATOR_DATE_ACTIONS = [
  { key: 'today', label: 'Hoy', resolve: () => new Date() },
  { key: 'month-end', label: 'Fin de mes', resolve: (base) => endOfMonth(base) },
  { key: 'next-month', label: 'Mes siguiente', resolve: (base) => shiftMonths(base, 1) },
  { key: 'next-month-start', label: 'Prox. inicio', resolve: (base) => startOfMonth(shiftMonths(base, 1)) },
]

export default function Simulador() {
  const { user } = useAuth()
  const todayDate = formatDateLocal(new Date())
  const [bancos, setBancos] = useState([])
  const [simulaciones, setSimulaciones] = useState([])
  const [form, setForm] = useState(createInitialForm)
  const [resultado, setResultado] = useState(null)
  const [isCompactChart, setIsCompactChart] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < SIMULATOR_CHART_BREAKPOINT,
  )
  const [chartStartIndex, setChartStartIndex] = useState(0)
  const [showFullChart, setShowFullChart] = useState(false)
  const [loadingData, setLoadingData] = useState(true)
  const [simulating, setSimulating] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [agregando, setAgregando] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [confirmAddDiferidoOpen, setConfirmAddDiferidoOpen] = useState(false)
  const [duplicateDiferidoWarning, setDuplicateDiferidoWarning] = useState(null)
  const [diferidoOk, setDiferidoOk] = useState(false)
  const [feedback, setFeedback] = useState({ type: '', message: '' })
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [totalSimulaciones, setTotalSimulaciones] = useState(0)
  const savedMinimumInitializedRef = useRef(false)

  const fetchSimulaciones = useCallback(async () => {
    const { data } = await api.get('/simulador/simulaciones/', {
      params: { page, page_size: pageSize, search: query.trim() || undefined },
    })
    const results = data.results || []
    setSimulaciones(results)
    setTotalSimulaciones(data.count || 0)
    if (!savedMinimumInitializedRef.current && !getInitialColchonMinimo() && results.length > 0) {
      savedMinimumInitializedRef.current = true
      const savedMinimum = Number(results[0].colchon_minimo)
      if (savedMinimum > 0) {
        setForm((previous) => ({ ...previous, colchon_minimo: String(savedMinimum) }))
      }
    }
  }, [page, pageSize, query])
  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    function handleResize() {
      setIsCompactChart(window.innerWidth < SIMULATOR_CHART_BREAKPOINT)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    async function loadBanks() {
      setLoadingData(true)
      try {
        const { data } = await api.get('/simulador/bancos/')
        setBancos(data)
      } catch (error) {
        setFeedback({ type: 'error', message: getApiErrorMessage(error, 'No se pudo cargar el simulador.') })
      } finally {
        setLoadingData(false)
      }
    }

    void loadBanks()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchSimulaciones().catch((error) => {
        setFeedback({ type: 'error', message: getApiErrorMessage(error, 'No se pudieron cargar los escenarios.') })
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [fetchSimulaciones])

  function updateForm(patch) {
    setForm((previous) => ({ ...previous, ...patch }))
    setResultado(null)
    setDiferidoOk(false)
  }

  function selectScenarioType(tipo) {
    const defaults = tipo === 'contado'
      ? { banco: '', tasa_anual: '0', plazo_meses: '1' }
      : tipo === 'recurrente'
        ? { banco: '', tasa_anual: '0', plazo_meses: '12' }
        : { plazo_meses: form.plazo_meses === '1' ? '12' : form.plazo_meses }
    updateForm({ tipo, ...defaults })
    setFeedback({ type: '', message: '' })
  }

  function handleBanco(id) {
    const banco = bancos.find((item) => item.id === Number(id))
    updateForm({
      banco: id,
      tasa_anual: banco ? String(banco.tasa_anual_minima) : form.tasa_anual,
      plazo_meses: banco && Number(form.plazo_meses) > Number(banco.plazo_maximo_meses)
        ? String(banco.plazo_maximo_meses)
        : form.plazo_meses,
    })
  }

  function setSimulationStartDate(value) {
    updateForm({ fecha_inicio: value && value < todayDate ? todayDate : value })
  }

  function ensureFutureSimulationDate() {
    if (!form.fecha_inicio || form.fecha_inicio < todayDate) {
      setFeedback({ type: 'error', message: PAST_SIMULATION_DATE_MESSAGE })
      return false
    }
    return true
  }

  function buildPayload() {
    return {
      tipo: form.tipo,
      nombre: form.nombre.trim(),
      monto: form.monto,
      banco: form.tipo === 'cuotas' && form.banco ? Number(form.banco) : null,
      tasa_anual: form.tipo === 'cuotas' ? form.tasa_anual : '0',
      plazo_meses: form.tipo === 'contado' ? 1 : Number(form.plazo_meses),
      colchon_minimo: form.colchon_minimo,
      fecha_inicio: form.fecha_inicio,
    }
  }
  async function simular(event) {
    event.preventDefault()
    if (simulating || !ensureFutureSimulationDate()) return
    setFeedback({ type: '', message: '' })
    setSimulating(true)

    try {
      const { data } = await api.post('/simulador/evaluar/', buildPayload())
      setChartStartIndex(0)
      setShowFullChart(false)
      setResultado(data)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COLCHON_STORAGE_KEY, String(form.colchon_minimo))
      }
    } catch (error) {
      setFeedback({ type: 'error', message: getApiErrorMessage(error, 'No se pudo evaluar esta decision.') })
    } finally {
      setSimulating(false)
    }
  }

  async function guardarSimulacion() {
    if (!resultado || guardando || !ensureFutureSimulationDate()) return
    setGuardando(true)
    setFeedback({ type: '', message: '' })
    try {
      await api.post('/simulador/simulaciones/', buildPayload())
      if (page === 1) await fetchSimulaciones()
      else setPage(1)
      setFeedback({ type: 'success', message: 'Escenario guardado correctamente.' })
    } catch (error) {
      setFeedback({ type: 'error', message: getApiErrorMessage(error, 'No se pudo guardar el escenario.') })
    } finally {
      setGuardando(false)
    }
  }

  async function agregarComoDiferido({ confirmarDuplicado = false } = {}) {
    if (!resultado || form.tipo !== 'cuotas' || agregando || !ensureFutureSimulationDate()) return
    if (confirmarDuplicado) setDuplicateDiferidoWarning(null)
    setConfirmAddDiferidoOpen(false)
    setAgregando(true)
    setFeedback({ type: '', message: '' })

    try {
      const inicio = parseLocalDate(form.fecha_inicio)
      const fin = shiftMonths(inicio, Number(form.plazo_meses) - 1)
      await api.post('/finanzas/diferidos/', {
        descripcion: form.nombre.trim(),
        categoria: 'otro',
        monto_total: resultado.total_a_pagar,
        num_cuotas: form.plazo_meses,
        cuota_mensual: resultado.cuota_mensual,
        fecha_inicio: form.fecha_inicio,
        fecha_fin: formatDateLocal(fin),
        activo: true,
        confirmar_duplicado: confirmarDuplicado,
      })
      setDiferidoOk(true)
      setDuplicateDiferidoWarning(null)
      setFeedback({ type: 'success', message: 'La decision quedo agregada a tus gastos a cuotas.' })
      setTimeout(() => setDiferidoOk(false), 3500)
    } catch (error) {
      const duplicateMessage = normalizeApiMessage(error?.response?.data?.duplicado).trim()
      const detectedDuplicates = normalizeDetectedDuplicates(error?.response?.data?.duplicados_detectados)
      if (!confirmarDuplicado && duplicateMessage && detectedDuplicates.length > 0) {
        setDuplicateDiferidoWarning({ message: duplicateMessage, duplicates: detectedDuplicates })
        return
      }
      setFeedback({ type: 'error', message: getApiErrorMessage(error, 'No se pudo agregar el gasto a cuotas.') })
    } finally {
      setAgregando(false)
    }
  }

  async function eliminarSimulacion() {
    const id = confirmDeleteId
    if (!id || deletingId) return
    setConfirmDeleteId(null)
    setDeletingId(id)
    setFeedback({ type: '', message: '' })
    try {
      await api.delete(`/simulador/simulaciones/${id}/`)
      await fetchSimulaciones()
      setFeedback({ type: 'success', message: 'Escenario eliminado correctamente.' })
    } catch (error) {
      setFeedback({ type: 'error', message: getApiErrorMessage(error, 'No se pudo eliminar el escenario.') })
    } finally {
      setDeletingId(null)
    }
  }

  const moneda = user?.moneda_preferida || 'USD'
  const fmt = (value) => formatMoney(value, { currency: moneda })
  const mode = resultado?.projection_mode || user?.projection_mode || 'simple'
  const projectionModeLabel = PROJECTION_MODE_LABELS[mode] || 'Simple'
  const selectedBank = bancos.find((item) => item.id === Number(form.banco))
  const paymentLabel = form.tipo === 'contado' ? 'Impacto unico' : form.tipo === 'recurrente' ? 'Aumento mensual' : 'Cuota mensual'
  const financedAmount = resultado
    ? Math.max(0, Number(resultado.total_a_pagar) - Number(resultado.total_intereses))
    : 0
  const amountLabel = form.tipo === 'recurrente' ? 'Monto mensual' : 'Monto de la decision'
  const durationLabel = form.tipo === 'recurrente' ? 'Durante cuantos meses?' : 'Plazo (meses)'
  const startDateLabel = parseLocalDate(form.fecha_inicio)?.toLocaleDateString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }) || form.fecha_inicio
  const simulationFlow = resultado?.flow || []
  const simulationWindowSize = isCompactChart
    ? MOBILE_SIMULATION_WINDOW_MONTHS
    : DESKTOP_SIMULATION_WINDOW_MONTHS
  const simulationWindow = clampSimulationWindow(
    chartStartIndex,
    simulationFlow.length,
    simulationWindowSize,
  )
  const visibleSimulationFlow = showFullChart
    ? simulationFlow
    : simulationFlow.slice(simulationWindow.startIndex, simulationWindow.endIndex + 1)
  const simulationRangeLabel = visibleSimulationFlow.length
    ? `${visibleSimulationFlow[0].label} - ${visibleSimulationFlow.at(-1).label}`
    : ''
  const decisionStartPoint = visibleSimulationFlow.find(
    (point) => point.month === resultado?.fecha_inicio?.slice(0, 7),
  )
  const visibleScenarioMinimum = visibleSimulationFlow.reduce(
    (minimum, point) => Math.min(minimum, Number(point.saldo_escenario)),
    Number.POSITIVE_INFINITY,
  )
  const reserveMargin = Number.isFinite(visibleScenarioMinimum)
    ? visibleScenarioMinimum - Number(resultado?.colchon_minimo || 0)
    : 0
  const reserveAtRisk = reserveMargin < 0
  const showSimulationNavigator = simulationFlow.length > simulationWindowSize
  const canGoPreviousPeriod = simulationWindow.startIndex > 0
  const canGoNextPeriod = simulationWindow.endIndex < simulationFlow.length - 1

  function slideSimulationChart(direction) {
    setChartStartIndex((current) => {
      const safeCurrent = clampSimulationWindow(current, simulationFlow.length, simulationWindowSize)
      return clampSimulationWindow(
        safeCurrent.startIndex + direction * simulationWindowSize,
        simulationFlow.length,
        simulationWindowSize,
      ).startIndex
    })
  }

  const pageCount = Math.max(1, Math.ceil(totalSimulaciones / pageSize))
  const safePage = Math.min(page, pageCount)
  const paginatedSimulaciones = simulaciones
  function buildDuplicateDiferidoMessage() {
    if (!duplicateDiferidoWarning) return ''
    const duplicates = duplicateDiferidoWarning.duplicates || []
    const firstDuplicate = duplicates[0]
    if (!firstDuplicate) return duplicateDiferidoWarning.message || 'Ya existe un gasto a cuotas parecido.'
    const firstDate = parseLocalDate(firstDuplicate.fecha_inicio)
    const lastDate = parseLocalDate(firstDuplicate.fecha_fin)
    const startLabel = firstDate?.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) || firstDuplicate.fecha_inicio
    const endLabel = lastDate?.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) || firstDuplicate.fecha_fin
    const installmentLabel = firstDuplicate.cuota_mensual ? fmt(firstDuplicate.cuota_mensual) : null
    const moreLabel = duplicates.length > 1 ? ` Tambien hay ${duplicates.length - 1} parecido(s).` : ''
    return `${duplicateDiferidoWarning.message} Encontramos "${firstDuplicate.descripcion}"${installmentLabel ? ` por ${installmentLabel} al mes` : ''} entre ${startLabel} y ${endLabel}. Si sigues, quedara duplicado.${moreLabel}`
  }

  function resultMessage() {
    if (!resultado) return ''
    if (resultado.factible) {
      return `Tu saldo se mantiene por encima de tu reserva de ${fmt(resultado.colchon_minimo)} durante los ${resultado.horizon_months} meses analizados.`
    }
    if (resultado.flujo_base_en_riesgo && !resultado.decision_genera_riesgo) {
      return `Tu proyeccion ya baja de tu reserva incluso sin esta decision. Con el gasto, el punto mas bajo seria ${fmt(resultado.saldo_minimo_escenario)}.`
    }
    if (resultado.primer_mes_negativo) {
      return `Con esta decision tu saldo entraria en negativo por primera vez en ${resultado.primer_mes_negativo}.`
    }
    return `Con esta decision bajarias de tu reserva por primera vez en ${resultado.primer_mes_riesgo}.`
  }
  return (
    <div className="simulator-page">
      <div className="page-header simulator-page-header">
        <div>
          <h1 className="page-title">Simula una decision de gasto</h1>
          <p className="page-subtitle">Prueba una compra grande o un cambio de vida antes de comprometer tu dinero.</p>
        </div>
        <div className="simulator-projection-badge">
          <span>Base de calculo</span>
          <strong>{projectionModeLabel}</strong>
        </div>
      </div>

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      {loadingData ? (
        <div className="card simulator-loading">Preparando tus finanzas...</div>
      ) : (
        <>
          <div className="simulator-layout">
            <section className="card simulator-form-card">
              <div className="simulator-section-heading">
                <Calculator size={19} />
                <div>
                  <h2>Que quieres probar?</h2>
                  <p>Elige como afectaria tu dinero. Solo mostraremos los datos necesarios.</p>
                </div>
              </div>

              <div className="simulator-type-switch" role="group" aria-label="Tipo de decision">
                {SCENARIO_TYPES.map((option) => {
                  const Icon = option.icon
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`simulator-type-option ${form.tipo === option.value ? 'is-active' : ''}`}
                      aria-pressed={form.tipo === option.value}
                      onClick={() => selectScenarioType(option.value)}
                    >
                      <Icon size={18} />
                      <span>{option.label}</span>
                    </button>
                  )
                })}
              </div>
              <p className="simulator-type-description">
                {SCENARIO_TYPES.find((option) => option.value === form.tipo)?.description}
              </p>

              <form onSubmit={simular} className="simulator-form">
                <div className="form-modal-group">
                  <label className="form-modal-label">Ponle un nombre a la decision</label>
                  <input
                    className="form-modal-input"
                    required
                    maxLength={200}
                    placeholder="Ej: mudarme, estudiar, comprar un carro"
                    value={form.nombre}
                    onChange={(event) => updateForm({ nombre: event.target.value })}
                  />
                </div>

                <div className="form-modal-group">
                  <label className="form-modal-label">{amountLabel}</label>
                  <input
                    className="form-modal-input form-modal-input-no-spinner"
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0"
                    value={form.monto}
                    onChange={(event) => updateForm({ monto: event.target.value })}
                    onWheel={(event) => event.currentTarget.blur()}
                  />
                </div>

                {form.tipo === 'cuotas' && (
                  <>
                    <div className="form-modal-group">
                      <label className="form-modal-label">Banco <span>(opcional)</span></label>
                      <select className="form-modal-select" value={form.banco} onChange={(event) => handleBanco(event.target.value)}>
                        <option value="">Sin banco o con una oferta propia</option>
                        {bancos.map((banco) => (
                          <option key={banco.id} value={banco.id}>{banco.nombre}</option>
                        ))}
                      </select>
                      {selectedBank && (
                        <p className="simulator-field-help">
                          Referencia: {selectedBank.tasa_anual_minima}% a {selectedBank.tasa_anual_maxima}%, hasta {selectedBank.plazo_maximo_meses} meses.
                        </p>
                      )}
                    </div>

                    <div className="form-modal-row">
                      <div className="form-modal-group">
                        <label className="form-modal-label">Tasa anual (%)</label>
                        <input
                          className="form-modal-input"
                          type="number"
                          required
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={form.tasa_anual}
                          onChange={(event) => updateForm({ tasa_anual: event.target.value })}
                        />
                      </div>
                      <div className="form-modal-group">
                        <label className="form-modal-label">{durationLabel}</label>
                        <input
                          className="form-modal-input"
                          type="number"
                          required
                          min="1"
                          max="360"
                          inputMode="numeric"
                          value={form.plazo_meses}
                          onChange={(event) => updateForm({ plazo_meses: event.target.value })}
                        />
                      </div>
                    </div>
                  </>
                )}

                {form.tipo === 'recurrente' && (
                  <div className="form-modal-group">
                    <label className="form-modal-label">{durationLabel}</label>
                    <input
                      className="form-modal-input"
                      type="number"
                      required
                      min="1"
                      max="360"
                      inputMode="numeric"
                      value={form.plazo_meses}
                      onChange={(event) => updateForm({ plazo_meses: event.target.value })}
                    />
                    <p className="simulator-field-help">Usa el tiempo durante el cual quieres medir este cambio de vida.</p>
                  </div>
                )}

                <div className="form-modal-group">
                  <label className="form-modal-label">Reserva que quieres conservar</label>
                  <input
                    className="form-modal-input"
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="Ej: 300"
                    value={form.colchon_minimo}
                    onChange={(event) => updateForm({ colchon_minimo: event.target.value })}
                  />
                  <p className="simulator-field-help">Es el monto que no quieres tocar aun despues de asumir el gasto.</p>
                </div>

                <div className="form-modal-group">
                  <label className="form-modal-label">Cuando empezaria?</label>
                  <div className="date-input-wrap">
                    <input
                      className="form-modal-input"
                      type="date"
                      required
                      min={todayDate}
                      max={DATE_INPUT_MAX}
                      value={form.fecha_inicio}
                      onChange={(event) => setSimulationStartDate(event.target.value)}
                    />
                  </div>
                  <DateQuickActions
                    value={form.fecha_inicio}
                    onChange={setSimulationStartDate}
                    disabled={simulating}
                    actions={SIMULATOR_DATE_ACTIONS}
                  />
                </div>

                <button type="submit" className="btn-modal-save simulator-submit" disabled={simulating}>
                  {simulating ? 'Analizando tus finanzas...' : 'Ver impacto en mis finanzas'}
                </button>
              </form>
            </section>
            <section className="simulator-result-column" aria-live="polite">
              {resultado ? (
                <>
                  <div className={`card simulator-result-card ${resultado.factible ? 'is-positive' : 'is-risk'}`}>
                    <div className="simulator-verdict">
                      {resultado.factible
                        ? <CheckCircle size={34} />
                        : <XCircle size={34} />}
                      <div>
                        <span>{SCENARIO_TYPE_LABELS[resultado.tipo]}</span>
                        <h2>{resultado.factible ? 'Esta decision cabe en tus finanzas' : 'Esta decision necesita cuidado'}</h2>
                        <p>{resultMessage()}</p>
                      </div>
                    </div>

                    <div className="simulator-key-metrics">
                      <div>
                        <span>{paymentLabel}</span>
                        <strong>{fmt(resultado.cuota_mensual)}</strong>
                      </div>
                      <div>
                        <span>Saldo mas bajo</span>
                        <strong>{fmt(resultado.saldo_minimo_escenario)}</strong>
                      </div>
                      <div>
                        <span>Primer riesgo</span>
                        <strong>{resultado.primer_mes_riesgo || 'Sin riesgo'}</strong>
                      </div>
                    </div>

                    <details className="simulator-details">
                      <summary>Ver detalle del calculo</summary>
                      <div className="simulator-detail-list">
                        <div><span>Proyeccion utilizada</span><strong>{projectionModeLabel}</strong></div>
                        <div><span>La decision empieza</span><strong>{startDateLabel}</strong></div>
                        {resultado.tipo === 'cuotas' && (
                          <>
                            <div><span>Monto financiado, sin intereses</span><strong>{fmt(financedAmount)}</strong></div>
                            <div><span>Numero de cuotas</span><strong>{resultado.meses_con_impacto}</strong></div>
                            <div><span>Valor de cada cuota</span><strong>{fmt(resultado.cuota_mensual)}</strong></div>
                            <div><span>Intereses totales del credito</span><strong>{fmt(resultado.total_intereses)}</strong></div>
                            <div><span>Total final a pagar</span><strong>{fmt(resultado.total_a_pagar)}</strong></div>
                          </>
                        )}
                        {resultado.tipo === 'contado' && (
                          <div><span>Pago unico</span><strong>{fmt(resultado.total_a_pagar)}</strong></div>
                        )}
                        {resultado.tipo === 'recurrente' && (
                          <>
                            <div><span>Gasto mensual</span><strong>{fmt(resultado.cuota_mensual)}</strong></div>
                            <div><span>Meses incluidos</span><strong>{resultado.meses_con_impacto}</strong></div>
                            <div><span>Total durante el periodo</span><strong>{fmt(resultado.total_a_pagar)}</strong></div>
                          </>
                        )}
                        <div><span>Saldo mas bajo sin el gasto</span><strong>{fmt(resultado.saldo_minimo_base)}</strong></div>
                        <div><span>Saldo mas bajo incluyendo el gasto</span><strong>{fmt(resultado.saldo_minimo_escenario)}</strong></div>
                        <div><span>Reserva que quieres conservar</span><strong>{fmt(resultado.colchon_minimo)}</strong></div>
                        <div><span>Horizonte evaluado</span><strong>{resultado.horizon_months} meses</strong></div>
                      </div>
                    </details>

                    <div className="simulator-actions">
                      <button type="button" onClick={guardarSimulacion} disabled={guardando} className="btn-modal-cancel">
                        <Save size={16} /> {guardando ? 'Guardando...' : 'Guardar escenario'}
                      </button>
                      {form.tipo === 'cuotas' && resultado.factible && (
                        diferidoOk ? (
                          <div className="simulator-added-state"><CheckCircle size={16} /> Agregado a gastos a cuotas</div>
                        ) : (
                          <button type="button" onClick={() => setConfirmAddDiferidoOpen(true)} disabled={agregando} className="btn-modal-save">
                            <CreditCard size={16} /> Agregar a mi plan
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  <div className="card simulator-chart-card">
                    <div className="simulator-chart-heading">
                      <div>
                        <span>Tu saldo proyectado</span>
                        <h2>¿Cuánto dinero te quedaría?</h2>
                      </div>
                      <CalendarClock size={20} />
                    </div>
                    <p className="simulator-chart-explanation">
                      <strong>No son gastos.</strong> Cada punto muestra el dinero acumulado que te quedaría al cerrar ese mes, después de tus ingresos y gastos proyectados durante {resultado.horizon_months} meses.
                      <span>La distancia entre las líneas es el efecto acumulado de este gasto en tus finanzas.</span>
                    </p>
                    <ul className="simulator-chart-guide" aria-label="Qué representa cada línea">
                      <li>
                        <span className="simulator-chart-dot simulator-chart-dot--base" aria-hidden="true" />
                        <span><strong>Sin hacer este gasto</strong> Lo que te quedaría siguiendo tu plan actual.</span>
                      </li>
                      <li>
                        <span className="simulator-chart-dot simulator-chart-dot--scenario" aria-hidden="true" />
                        <span><strong>Incluyendo este gasto</strong> Lo que te quedaría después de pagarlo.</span>
                      </li>
                    </ul>
                    <div className={`simulator-chart-reserve ${reserveAtRisk ? 'is-risk' : 'is-safe'}`}>
                      {reserveAtRisk ? <XCircle size={16} /> : <CheckCircle size={16} />}
                      <span>
                        <strong>Reserva que quieres conservar: {fmt(resultado.colchon_minimo)}</strong>
                        {reserveAtRisk
                          ? `En este periodo tu saldo baja ${fmt(Math.abs(reserveMargin))} por debajo.`
                          : `En este periodo tu saldo se mantiene al menos ${fmt(reserveMargin)} por encima.`}
                      </span>
                    </div>
                    <div
                      className="simulator-chart-wrap"
                      role="img"
                      aria-label={`Dinero que te quedaría con y sin este gasto durante ${resultado.horizon_months} meses`}
                    >
                      <Suspense fallback={<div className="loading-screen"><div className="spinner" /></div>}>
                        <SimulationBalanceChart
                          data={visibleSimulationFlow}
                          decisionStartPoint={decisionStartPoint}
                          currency={moneda}
                          formatValue={fmt}
                        />
                      </Suspense>
                    </div>
                    {showSimulationNavigator && (
                      <div className="simulator-chart-navigator">
                        <button
                          type="button"
                          onClick={() => slideSimulationChart(-1)}
                          disabled={showFullChart || !canGoPreviousPeriod}
                          aria-label="Ver periodo anterior"
                        >
                          <ChevronLeft size={18} />
                        </button>
                        <div className="simulator-chart-range" aria-live="polite">
                          <strong>{simulationRangeLabel}</strong>
                          <span>{showFullChart ? `${simulationFlow.length} meses` : `${visibleSimulationFlow.length} de ${simulationFlow.length} meses`}</span>
                          <button
                            type="button"
                            className="simulator-chart-view-toggle"
                            onClick={() => setShowFullChart((current) => !current)}
                          >
                            {showFullChart ? 'Ver por periodos' : 'Ver todo'}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => slideSimulationChart(1)}
                          disabled={showFullChart || !canGoNextPeriod}
                          aria-label="Ver periodo siguiente"
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="card simulator-empty-result">
                  <div className="simulator-empty-icon"><Calculator size={28} /></div>
                  <h2>Convierte una idea en una decision informada</h2>
                  <p>Veras cuanto cambia tu saldo, cual seria el punto mas bajo y en que mes apareceria el primer riesgo.</p>
                  <div className="simulator-example-list">
                    <span>Un viaje dentro de seis meses</span>
                    <span>Independizarte y pagar arriendo</span>
                    <span>Comprar un carro a cuotas</span>
                  </div>
                </div>
              )}
            </section>
          </div>
          <section className="card simulator-saved-card">
            <div className="card-header simulator-saved-heading">
              <div>
                <span>Decisiones para comparar</span>
                <h2 className="card-title">Escenarios guardados</h2>
              </div>
            </div>

            {totalSimulaciones === 0 ? (
              <div className="empty-state simulator-saved-empty">
                <p className="empty-text">Aun no guardas escenarios</p>
                <p className="empty-sub">Simula una decision y guardala para revisarla despues.</p>
              </div>
            ) : (
              <>
                <ListControls
                  query={query}
                  onQueryChange={(value) => { setQuery(value); setPage(1) }}
                  placeholder="Buscar por nombre, tipo o banco..."
                  page={safePage}
                  pageCount={pageCount}
                  onPrevPage={() => setPage((previous) => Math.max(1, previous - 1))}
                  onNextPage={() => setPage((previous) => Math.min(pageCount, previous + 1))}
                  pageSize={pageSize}
                  onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
                  totalItems={totalSimulaciones}
                  filteredItems={totalSimulaciones}
                  showPagination={false}
                />
                <div className="table-wrap" style={{ border: 'none' }}>
                  <table className="table">
                    <thead>
                      <tr>{['Decision', 'Tipo', 'Monto', 'Inicio', 'Impacto', ''].map((heading) => <th key={heading}>{heading}</th>)}</tr>
                    </thead>
                    <tbody>
                      {paginatedSimulaciones.map((item) => (
                        <tr key={item.id}>
                          <td style={{ fontWeight: 600 }}>{item.nombre}</td>
                          <td><span className="simulator-type-pill">{SCENARIO_TYPE_LABELS[item.tipo] || 'Prestamo'}</span></td>
                          <td>{fmt(item.monto)}</td>
                          <td>{parseLocalDate(item.fecha_inicio)?.toLocaleDateString('es-EC', { month: 'short', year: 'numeric' })}</td>
                          <td className="table-amount positive">{fmt(item.cuota_mensual)}</td>
                          <td className="table-actions-cell">
                            <button
                              type="button"
                              className="btn-icon danger"
                              aria-label={`Eliminar ${item.nombre}`}
                              disabled={deletingId === item.id}
                              onClick={() => setConfirmDeleteId(item.id)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ListPager
                  page={safePage}
                  pageCount={pageCount}
                  onPrevPage={() => setPage((previous) => Math.max(1, previous - 1))}
                  onNextPage={() => setPage((previous) => Math.min(pageCount, previous + 1))}
                  pageSize={pageSize}
                  onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
                  totalItems={totalSimulaciones}
                  filteredItems={totalSimulaciones}
                />
              </>
            )}
          </section>
        </>
      )}

      <ConfirmDialog
        open={confirmAddDiferidoOpen}
        title="Agregar esta decision a tu plan"
        message={`Se agregara una cuota mensual de ${fmt(resultado?.cuota_mensual || 0)} desde ${startDateLabel}.`}
        confirmText="Agregar cuota"
        cancelText="Cancelar"
        loading={agregando}
        onConfirm={agregarComoDiferido}
        onClose={() => setConfirmAddDiferidoOpen(false)}
      />
      <ConfirmDialog
        open={duplicateDiferidoWarning !== null}
        title="Posible gasto duplicado"
        message={buildDuplicateDiferidoMessage()}
        confirmText="Agregar igual"
        cancelText="Cancelar"
        loading={agregando}
        onConfirm={() => agregarComoDiferido({ confirmarDuplicado: true })}
        onClose={() => setDuplicateDiferidoWarning(null)}
      />
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Eliminar escenario"
        message="Este escenario se eliminara de tus decisiones guardadas. No cambia tus gastos reales."
        confirmText="Eliminar"
        cancelText="Cancelar"
        loading={deletingId !== null}
        onConfirm={eliminarSimulacion}
        onClose={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}