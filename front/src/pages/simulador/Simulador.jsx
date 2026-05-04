import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calculator, CheckCircle, XCircle, Save, Trash2, CreditCard } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'

import { getApiErrorMessage } from '../../api/errors'
import api from '../../api/client'
import ListControls from '../../components/ui/ListControls'
import DateQuickActions from '../../components/ui/DateQuickActions'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { useAuth } from '../../context/useAuth'
import { DATE_INPUT_MAX } from '../../utils/dateBounds'
import { formatMoney } from '../../utils/formatters'
import '../../components/ui/app.css'

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const FACTOR_FRECUENCIA = {
  diario: 30,
  semanal: 4.33,
  quincenal: 2,
  mensual: 1,
  bimestral: 0.5,
  trimestral: 0.333,
  semestral: 0.167,
  anual: 0.083,
}
const COLCHON_STORAGE_KEY = 'simulador_colchon_minimo'
const SIMULADOR_PAST_MONTHS = 6
const PROJECTION_MODE_LABELS = {
  automatica: 'Automatica',
  simple: 'Simple',
  personalizada: 'Personalizada',
}
const PAST_SIMULATION_DATE_MESSAGE = 'El simulador solo permite fechas desde hoy hacia adelante.'

function parseLocalDate(value) {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
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

function overlapsMonth(item, monthDate) {
  if (!item.activo) return false
  const monthStart = startOfMonth(monthDate)
  const monthEnd = endOfMonth(monthDate)
  const ini = parseLocalDate(item.fecha_inicio)
  const fin = item.fecha_fin ? parseLocalDate(item.fecha_fin) : null
  return ini <= monthEnd && (!fin || fin >= monthStart)
}

function occursInMonth(item, monthDate, dateField = 'fecha') {
  const dateValue = item?.[dateField]
  if (!dateValue) return false
  const targetDate = parseLocalDate(dateValue)
  const monthStart = startOfMonth(monthDate)
  const monthEnd = endOfMonth(monthDate)
  return targetDate >= monthStart && targetDate <= monthEnd
}

function formatDateLocal(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function calcularCuota(monto, tasaAnual, plazoMeses) {
  if (!monto || !tasaAnual || !plazoMeses) return 0
  const r = Number(tasaAnual) / 100 / 12
  const n = Number(plazoMeses)
  const p = Number(monto)
  if (!r) return p / n
  return (p * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1)
}

function roundMoneyNumber(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(2))
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

function getInitialColchonMinimo() {
  if (typeof window === 'undefined') return ''
  const savedValue = window.localStorage.getItem(COLCHON_STORAGE_KEY)
  if (!savedValue) return ''
  const parsed = Number(savedValue)
  if (!Number.isFinite(parsed) || parsed <= 0) return ''
  return String(parsed)
}

function construirFlujoBaseSimple(ingresos, ingresosPuntuales, gastosCorrientes, gastosNoCorrientes, diferidos, desiredMonths = 24) {
  const hoy = new Date()
  return Array.from({ length: desiredMonths }, (_, i) => {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
    const mes = `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`

    const totalIngresos = ingresos
      .filter((item) => overlapsMonth(item, fecha))
      .reduce((sum, item) => sum + Number(item.monto) * (FACTOR_FRECUENCIA[item.frecuencia] || 1), 0)

    const totalIngresosPuntuales = ingresosPuntuales
      .filter((item) => occursInMonth(item, fecha))
      .reduce((sum, item) => sum + Number(item.monto), 0)

    const totalGastosCorrientes = gastosCorrientes
      .filter((item) => overlapsMonth(item, fecha))
      .reduce((sum, item) => sum + Number(item.monto) * (FACTOR_FRECUENCIA[item.frecuencia] || 1), 0)

    const totalGastosPuntuales = gastosNoCorrientes
      .filter((item) => occursInMonth(item, fecha))
      .reduce((sum, item) => sum + Number(item.monto), 0)

    const totalDiferidos = diferidos
      .filter((item) => overlapsMonth(item, fecha))
      .reduce((sum, item) => sum + Number(item.cuota_mensual), 0)

    const gastos = roundMoneyNumber(totalGastosCorrientes + totalGastosPuntuales + totalDiferidos)
    const ingresosMes = roundMoneyNumber(totalIngresos + totalIngresosPuntuales)
    return {
      mes,
      ingresos: ingresosMes,
      gastos,
      balance: roundMoneyNumber(ingresosMes - gastos),
    }
  })
}

function construirFlujoBaseDesdeProyeccion(series = [], desiredMonths = series.length) {
  const normalized = series.map((point) => ({
    mes: point.label,
    ingresos: roundMoneyNumber(point.monthly_ingresos || 0),
    gastos: roundMoneyNumber(point.monthly_gastos || 0),
    balance: roundMoneyNumber(point.projected_gap || 0),
  }))

  if (normalized.length === 0 || desiredMonths <= normalized.length) {
    return normalized
  }

  const lastPoint = normalized[normalized.length - 1]
  const extended = [...normalized]
  while (extended.length < desiredMonths) {
    extended.push({ ...lastPoint })
  }
  return extended
}

function fusionarFlujoBaseSimulacion(simpleFlow = [], projectedFlow = []) {
  if (projectedFlow.length === 0) return simpleFlow

  return projectedFlow.map((projectedMonth, index) => {
    const simpleMonth = simpleFlow[index]
    if (!simpleMonth) return projectedMonth

    const ingresos = roundMoneyNumber(Math.max(Number(projectedMonth.ingresos || 0), Number(simpleMonth.ingresos || 0)))
    const gastos = roundMoneyNumber(Math.max(Number(projectedMonth.gastos || 0), Number(simpleMonth.gastos || 0)))

    return {
      ...projectedMonth,
      ingresos,
      gastos,
      balance: roundMoneyNumber(ingresos - gastos),
    }
  })
}

const EMPTY_FORM = {
  nombre: '',
  monto: '',
  banco: '',
  tasa_anual: '',
  plazo_meses: '12',
  colchon_minimo: getInitialColchonMinimo(),
  fecha_inicio: formatDateLocal(new Date()),
}

function resolveSaldoInicial(responseData) {
  if (!responseData) return 0
  const monto = Number(responseData.monto)
  return Number.isFinite(monto) ? roundMoneyNumber(monto) : 0
}

const SIMULATOR_DATE_ACTIONS = [
  { key: 'today', label: 'Hoy', resolve: () => new Date() },
  { key: 'month-end', label: 'Fin de mes', resolve: (base) => endOfMonth(base) },
  { key: 'next-month', label: 'Mes siguiente', resolve: (base) => shiftMonths(base, 1) },
  { key: 'next-month-start', label: 'Prox. inicio', resolve: (base) => startOfMonth(shiftMonths(base, 1)) },
]

export default function Simulador() {
  const { user } = useAuth()
  const advancedProjectionEnabled = Boolean(user?.feature_access?.advanced_projection_enabled)
  const advancedProjectionMaxMonths = Number(user?.feature_access?.advanced_projection_months || 120)
  const todayDate = formatDateLocal(new Date())

  const [bancos, setBancos] = useState([])
  const [simulaciones, setSimulaciones] = useState([])
  const [flujoBase, setFlujoBase] = useState([])
  const [saldoInicial, setSaldoInicial] = useState(0)
  const [simulationProjectionMeta, setSimulationProjectionMeta] = useState({
    mode: advancedProjectionEnabled ? (user?.projection_mode || 'automatica') : 'simple',
    variableProjectionApplied: !advancedProjectionEnabled,
    historyMonthsUsed: 0,
    minVariableHistoryMonths: 3,
    analysisHistoryMonths: 0,
    analysisHistoryCapMonths: 18,
  })
  const [form, setForm] = useState(EMPTY_FORM)
  const [resultado, setResultado] = useState(null)

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
  const flujoRequestIdRef = useRef(0)

  const cargarFlujoBase = useCallback(async ({ monthsNeeded = 24 } = {}) => {
    const requestId = flujoRequestIdRef.current + 1
    flujoRequestIdRef.current = requestId
    if (advancedProjectionEnabled) {
      const months = Math.min(Math.max(24, monthsNeeded), advancedProjectionMaxMonths)
      const [projectionRes, ingresosRes, ingresosPuntualesRes, gastosRes, gastosPuntualesRes, diferidosRes] = await Promise.all([
        api.get(`/finanzas/proyeccion-acumulada/?months=${months}&past_months=${SIMULADOR_PAST_MONTHS}`),
        api.get('/finanzas/ingresos/'),
        api.get('/finanzas/ingresos-puntuales/'),
        api.get('/finanzas/gastos-corrientes/'),
        api.get('/finanzas/gastos-no-corrientes/'),
        api.get('/finanzas/diferidos/'),
      ])
      const data = projectionRes.data
      if (requestId !== flujoRequestIdRef.current) return null
      const projectedSeries = (data.series || []).filter((point) => !point.is_real).slice(0, months)
      const nextSaldoInicial = resolveSaldoInicial({
        monto: projectedSeries[0]?.opening_balance ?? data.starting_balance ?? 0,
      })
      const projectedFlow = construirFlujoBaseDesdeProyeccion(projectedSeries, months)
      const simpleFlow = construirFlujoBaseSimple(
        ingresosRes.data,
        ingresosPuntualesRes.data,
        gastosRes.data,
        gastosPuntualesRes.data,
        diferidosRes.data,
        months,
      )
      const nextFlujoBase = fusionarFlujoBaseSimulacion(simpleFlow, projectedFlow)
      const nextMeta = {
        mode: data.projection_mode || user?.projection_mode || 'automatica',
        variableProjectionApplied: data.variable_projection_applied !== false,
        historyMonthsUsed: Number(data.history_months_used || 0),
        minVariableHistoryMonths: Number(data.min_variable_history_months || 3),
        analysisHistoryMonths: Number(data.analysis_history_months || 0),
        analysisHistoryCapMonths: Number(data.analysis_history_cap_months || 18),
      }
      setSaldoInicial(nextSaldoInicial)
      setFlujoBase(nextFlujoBase)
      setSimulationProjectionMeta(nextMeta)
      return { flujoBase: nextFlujoBase, saldoInicial: nextSaldoInicial, meta: nextMeta }
    }

    const [ingresosRes, ingresosPuntualesRes, gastosRes, gastosPuntualesRes, diferidosRes, saldoRes] = await Promise.all([
      api.get('/finanzas/ingresos/'),
      api.get('/finanzas/ingresos-puntuales/'),
      api.get('/finanzas/gastos-corrientes/'),
      api.get('/finanzas/gastos-no-corrientes/'),
      api.get('/finanzas/diferidos/'),
      api.get('/finanzas/saldo-mes/actual/'),
    ])
    const nextSaldoInicial = resolveSaldoInicial(saldoRes.data)
    const nextFlujoBase = construirFlujoBaseSimple(
      ingresosRes.data,
      ingresosPuntualesRes.data,
      gastosRes.data,
      gastosPuntualesRes.data,
      diferidosRes.data,
      Math.max(24, monthsNeeded),
    )
    const nextMeta = {
      mode: 'simple',
      variableProjectionApplied: true,
      historyMonthsUsed: 0,
      minVariableHistoryMonths: 3,
      analysisHistoryMonths: 0,
      analysisHistoryCapMonths: 18,
    }
    if (requestId !== flujoRequestIdRef.current) return null
    setSaldoInicial(nextSaldoInicial)
    setFlujoBase(nextFlujoBase)
    setSimulationProjectionMeta(nextMeta)
    return { flujoBase: nextFlujoBase, saldoInicial: nextSaldoInicial, meta: nextMeta }
  }, [advancedProjectionEnabled, advancedProjectionMaxMonths, user?.projection_mode])

  const loadInitialData = useCallback(async () => {
    setLoadingData(true)
    try {
      const [bancosRes, simulacionesRes] = await Promise.all([
        api.get('/simulador/bancos/'),
        api.get('/simulador/simulaciones/'),
      ])

      setBancos(bancosRes.data)
      setSimulaciones(simulacionesRes.data)
      await cargarFlujoBase({ monthsNeeded: 24 })
      if (!getInitialColchonMinimo() && simulacionesRes.data.length > 0 && Number(simulacionesRes.data[0].colchon_minimo) > 0) {
        setForm((prev) => ({ ...prev, colchon_minimo: String(simulacionesRes.data[0].colchon_minimo) }))
      }
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo cargar el simulador.') })
    } finally {
      setLoadingData(false)
    }
  }, [cargarFlujoBase])

  useEffect(() => {
    void loadInitialData()
  }, [loadInitialData])

  async function recargarFlujoBase() {
    try {
      await cargarFlujoBase({ monthsNeeded: Math.max(24, Number(form.plazo_meses || 24)) })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo actualizar la base de la proyeccion.') })
    }
  }

  function handleBanco(id) {
    const banco = bancos.find((b) => b.id === Number(id))
    setForm((prev) => ({
      ...prev,
      banco: id,
      tasa_anual: banco ? banco.tasa_anual_minima : prev.tasa_anual,
    }))
  }

  function clampSimulationStartDate(value) {
    if (!value) return value
    return value < todayDate ? todayDate : value
  }

  function setSimulationStartDate(value) {
    setForm((prev) => ({ ...prev, fecha_inicio: clampSimulationStartDate(value) }))
  }

  function ensureFutureSimulationDate() {
    if (form.fecha_inicio < todayDate) {
      setFeedback({ type: 'error', message: PAST_SIMULATION_DATE_MESSAGE })
      return false
    }
    return true
  }

  async function simular(e) {
    e.preventDefault()
    if (simulating) return
    setFeedback({ type: '', message: '' })
    if (!ensureFutureSimulationDate()) return
    setSimulating(true)

    try {
      const monto = Number(form.monto)
      const tasa = Number(form.tasa_anual)
      const plazo = Number(form.plazo_meses)
      const colchonMinimo = Number(form.colchon_minimo)
      if (!monto || monto <= 0 || Number.isNaN(tasa) || tasa < 0 || !plazo || plazo <= 0 || !colchonMinimo || colchonMinimo <= 0) {
        setFeedback({ type: 'error', message: 'Completa monto, tasa, plazo y minimo libre con valores validos.' })
        return
      }
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COLCHON_STORAGE_KEY, String(colchonMinimo))
      }

      const cuota = roundMoneyNumber(calcularCuota(monto, tasa, plazo))
      const totalPagar = roundMoneyNumber(cuota * plazo)
      const totalIntereses = roundMoneyNumber(totalPagar - monto)

      const hoy = new Date()
      const inicio = parseLocalDate(form.fecha_inicio)
      const finPrestamo = new Date(inicio.getFullYear(), inicio.getMonth() + plazo, 1)

      const horizonMonths = Math.max(24, plazo)
      let currentFlujoBase = flujoBase
      let currentSaldoInicial = saldoInicial

      try {
        const baseData = await cargarFlujoBase({ monthsNeeded: horizonMonths })
        currentFlujoBase = baseData.flujoBase
        currentSaldoInicial = baseData.saldoInicial
      } catch (err) {
        setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo calcular la base de la simulacion.') })
        return
      }

      let saldoBaseAcumulado = currentSaldoInicial
      let saldoSimAcumulado = currentSaldoInicial

      const flujoConPrestamo = Array.from({ length: horizonMonths }, (_, i) => {
        const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
        const mes = `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`
        const tieneCuota = fecha >= inicio && fecha < finPrestamo
        const base = currentFlujoBase[i] || { ingresos: 0, gastos: 0, balance: 0 }
        const gastosSim = roundMoneyNumber(base.gastos + (tieneCuota ? cuota : 0))
        const balanceSimMensual = roundMoneyNumber(base.ingresos - gastosSim)
        const saldoBaseInicio = saldoBaseAcumulado
        const saldoSimInicio = saldoSimAcumulado
        const arrastreInicio = saldoSimInicio
        saldoBaseAcumulado = roundMoneyNumber(saldoBaseAcumulado + base.balance)
        saldoSimAcumulado = roundMoneyNumber(saldoSimAcumulado + balanceSimMensual)
        const ingresosVisibles = roundMoneyNumber(base.ingresos + Math.max(arrastreInicio, 0))
        const gastosVisibles = roundMoneyNumber(gastosSim + Math.max(-arrastreInicio, 0))

        return {
          mes,
          ingresos: base.ingresos,
          ingresosVisibles,
          gastosSim,
          gastosVisibles,
          balanceSim: balanceSimMensual,
          balanceBase: base.balance,
          saldoBaseInicio,
          saldoBaseFin: saldoBaseAcumulado,
          saldoSimInicio,
          saldoSimFin: saldoSimAcumulado,
        }
      })

      const mesesConDeficit = flujoConPrestamo.filter((fila) => fila.saldoSimFin < 0)
      const mesesBajoColchon = flujoConPrestamo.filter((fila) => fila.saldoSimFin < colchonMinimo)
      const balanceMinimo = flujoConPrestamo.length > 0
        ? flujoConPrestamo.reduce((min, fila) => Math.min(min, fila.saldoSimFin), flujoConPrestamo[0].saldoSimFin)
        : 0
      const primerMesEnRojo = mesesConDeficit[0]?.mes || null
      const primerMesBajoColchon = mesesBajoColchon[0]?.mes || null

      setResultado({
        cuota,
        totalPagar,
        totalIntereses,
        flujoConPrestamo,
        mesesConDeficit,
        mesesBajoColchon,
        colchonMinimo,
        balanceMinimo,
        primerMesEnRojo,
        primerMesBajoColchon,
        horizonMonths,
        saldoInicial: currentSaldoInicial,
        factible: mesesConDeficit.length === 0 && mesesBajoColchon.length === 0,
      })
    } finally {
      setSimulating(false)
    }
  }

  async function guardarSimulacion() {
    if (!resultado || guardando) return
    if (!ensureFutureSimulationDate()) return
    setGuardando(true)
    setFeedback({ type: '', message: '' })
    try {
      await api.post('/simulador/simulaciones/', {
        nombre: form.nombre,
        monto: form.monto,
        banco: form.banco || null,
        tasa_anual: form.tasa_anual,
        plazo_meses: form.plazo_meses,
        colchon_minimo: form.colchon_minimo,
        cuota_mensual: resultado.cuota.toFixed(2),
        total_a_pagar: resultado.totalPagar.toFixed(2),
        total_intereses: resultado.totalIntereses.toFixed(2),
        fecha_inicio: form.fecha_inicio,
      })

      const { data } = await api.get('/simulador/simulaciones/')
      setSimulaciones(data)
      setFeedback({ type: 'success', message: 'Simulacion guardada correctamente.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo guardar la simulacion.') })
    } finally {
      setGuardando(false)
    }
  }

  async function agregarComoDiferido({ confirmarDuplicado = false } = {}) {
    if (!resultado || agregando) return
    if (!ensureFutureSimulationDate()) return
    if (confirmarDuplicado) setDuplicateDiferidoWarning(null)
    setConfirmAddDiferidoOpen(false)
    setAgregando(true)
    setFeedback({ type: '', message: '' })

    try {
      const ini = parseLocalDate(form.fecha_inicio)
      const fin = new Date(ini.getFullYear(), ini.getMonth() + (Number(form.plazo_meses) - 1), ini.getDate())

      await api.post('/finanzas/diferidos/', {
        descripcion: form.nombre,
        categoria: 'otro',
        monto_total: form.monto,
        num_cuotas: form.plazo_meses,
        cuota_mensual: resultado.cuota.toFixed(2),
        fecha_inicio: form.fecha_inicio,
        fecha_fin: formatDateLocal(fin),
        activo: true,
        confirmar_duplicado: confirmarDuplicado,
      })

      await recargarFlujoBase()
      setDiferidoOk(true)
      setDuplicateDiferidoWarning(null)
      setFeedback({ type: 'success', message: 'Gasto a cuotas agregado a tu plan.' })
      setTimeout(() => setDiferidoOk(false), 3500)
    } catch (err) {
      const duplicateMessage = normalizeApiMessage(err?.response?.data?.duplicado).trim()
      const detectedDuplicates = normalizeDetectedDuplicates(err?.response?.data?.duplicados_detectados)
      if (!confirmarDuplicado && duplicateMessage && detectedDuplicates.length > 0) {
        setDuplicateDiferidoWarning({
          message: duplicateMessage,
          duplicates: detectedDuplicates,
        })
        return
      }
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo agregar el gasto a cuotas.') })
    } finally {
      setAgregando(false)
    }
  }

  function openDeleteConfirm(id) {
    if (deletingId) return
    setConfirmDeleteId(id)
  }

  async function eliminarSimulacion() {
    const id = confirmDeleteId
    if (!id || deletingId) return
    setConfirmDeleteId(null)
    setDeletingId(id)
    setFeedback({ type: '', message: '' })
    try {
      await api.delete(`/simulador/simulaciones/${id}/`)
      setSimulaciones((prev) => prev.filter((item) => item.id !== id))
      setFeedback({ type: 'success', message: 'Simulacion eliminada correctamente.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo eliminar la simulacion.') })
    } finally {
      setDeletingId(null)
    }
  }

  const moneda = user?.moneda_preferida || 'USD'
  const fmt = (value) => formatMoney(value, { currency: moneda })
  const fechaInicioDiferidoLabel = form.fecha_inicio
    ? parseLocalDate(form.fecha_inicio).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''
  const simulationModeLabel = PROJECTION_MODE_LABELS[simulationProjectionMeta.mode] || 'Simple'
  const simulationModeNote = advancedProjectionEnabled
    ? `Usa tu modo actual de proyeccion: ${simulationModeLabel}. Analiza hasta ${simulationProjectionMeta.analysisHistoryCapMonths} meses y hoy esta usando ${simulationProjectionMeta.analysisHistoryMonths || 0}.`
    : 'Usa una lectura simple de tu flujo actual.'

  const filteredSimulaciones = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return simulaciones

    return simulaciones.filter((s) => (
      s.nombre.toLowerCase().includes(q)
      || (s.banco_nombre || '').toLowerCase().includes(q)
      || String(s.monto).toLowerCase().includes(q)
      || String(s.plazo_meses).toLowerCase().includes(q)
      || String(s.colchon_minimo || '').toLowerCase().includes(q)
    ))
  }, [simulaciones, query])

  const pageCount = Math.max(1, Math.ceil(filteredSimulaciones.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const paginatedSimulaciones = filteredSimulaciones.slice(start, start + pageSize)

  function buildDuplicateDiferidoMessage() {
    if (!duplicateDiferidoWarning) return ''
    const duplicates = duplicateDiferidoWarning.duplicates || []
    const firstDuplicate = duplicates[0]
    if (!firstDuplicate) {
      return duplicateDiferidoWarning.message || 'Ya tienes un gasto a cuotas parecido en este periodo.'
    }

    const startLabel = parseLocalDate(firstDuplicate.fecha_inicio)?.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) || firstDuplicate.fecha_inicio
    const endLabel = parseLocalDate(firstDuplicate.fecha_fin)?.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) || firstDuplicate.fecha_fin
    const cuotaLabel = firstDuplicate.cuota_mensual ? fmt(firstDuplicate.cuota_mensual) : null
    const moreLabel = duplicates.length > 1 ? ` Tambien hay ${duplicates.length - 1} parecido(s).` : ''

    return `${duplicateDiferidoWarning.message || 'Ya existe un gasto a cuotas parecido.'} Encontramos "${firstDuplicate.descripcion}"${cuotaLabel ? ` por ${cuotaLabel} al mes` : ''} entre ${startLabel} y ${endLabel}. Si sigues, quedara duplicado en tus egresos.${moreLabel}`
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Simulador de gastos y prestamos</h1>
        <p className="page-subtitle">Mira si una cuota o un gasto futuro te caben antes de cargarlos.</p>
        <p className="dashboard-chart-note" style={{ marginTop: 6 }}>
          {simulationModeNote}
          {advancedProjectionEnabled && !simulationProjectionMeta.variableProjectionApplied
            ? ' Aun no hay suficientes movimientos variables para estimar la parte variable, asi que usa tu base fija.'
            : ''}
        </p>
      </div>

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      {loadingData ? (
        <div className="card" style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.45)' }}>
          Cargando simulador...
        </div>
      ) : (
        <>
          <div className="simulador-main-grid">
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <Calculator size={18} style={{ color: '#C487F6' }} />
                <div>
                  <h2 style={{ fontWeight: 700, fontSize: 15 }}>Haz una simulacion</h2>
                  <p style={{ marginTop: 4, fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45 }}>
                    Si quieres simular un gasto y no un prestamo, deja el banco vacio y usa interes 0%.
                  </p>
                </div>
              </div>

              <form onSubmit={simular}>
                <div className="form-modal-group">
                  <label className="form-modal-label">Que quieres simular?</label>
                  <input
                    className="form-modal-input"
                    required
                    placeholder="Ej: telefono, viaje o gasto futuro"
                    value={form.nombre}
                    onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  />
                </div>

                <div className="form-modal-group">
                  <label className="form-modal-label">Monto</label>
                  <input
                    className="form-modal-input form-modal-input-no-spinner"
                    type="number"
                    required
                    min="1"
                    step="0.01"
                    placeholder="0"
                    value={form.monto}
                    onChange={(e) => setForm({ ...form, monto: e.target.value })}
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                </div>

                <div className="form-modal-group">
                  <label className="form-modal-label">Banco <span>(opcional)</span></label>
                  <select className="form-modal-select" value={form.banco} onChange={(e) => handleBanco(e.target.value)}>
                    <option value="">- Sin banco -</option>
                    {bancos.map((b) => (
                      <option key={b.id} value={b.id}>{b.nombre} ({b.tasa_anual_minima}% - {b.tasa_anual_maxima}% anual)</option>
                    ))}
                  </select>
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
                      placeholder="8.5"
                      value={form.tasa_anual}
                      onChange={(e) => setForm({ ...form, tasa_anual: e.target.value })}
                    />
                  </div>

                  <div className="form-modal-group">
                    <label className="form-modal-label">Plazo (meses)</label>
                    <input
                      className="form-modal-input"
                      type="number"
                      required
                      min="1"
                      max="360"
                      placeholder="12"
                      value={form.plazo_meses}
                      onChange={(e) => setForm({ ...form, plazo_meses: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-modal-group">
                  <label className="form-modal-label">Minimo libre que quieres dejar al mes</label>
                  <input
                    className="form-modal-input"
                    type="number"
                    required
                    min="1"
                    step="0.01"
                    placeholder="Ej: 300"
                    value={form.colchon_minimo}
                    onChange={(e) => setForm({ ...form, colchon_minimo: e.target.value })}
                  />
                  <p style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                    Es tu piso de tranquilidad despues de gastos y cuota.
                  </p>
                </div>

                <div className="form-modal-group">
                  <label className="form-modal-label">Empieza en</label>
                  <div className="date-input-wrap">
                    <input
                      className="form-modal-input"
                      type="date"
                      required
                      min={todayDate}
                      max={DATE_INPUT_MAX}
                      value={form.fecha_inicio}
                      onChange={(e) => setSimulationStartDate(e.target.value)}
                    />
                  </div>
                  <DateQuickActions
                    value={form.fecha_inicio}
                    onChange={setSimulationStartDate}
                    disabled={agregando || simulating}
                    actions={SIMULATOR_DATE_ACTIONS}
                  />
                  <p style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45 }}>
                    Solo puedes arrancar desde hoy hacia adelante. El simulador no acepta fechas pasadas.
                  </p>
                </div>

                <button type="submit" className="btn-modal-save" disabled={simulating} style={{ width: '100%', padding: '12px 0', marginTop: 4 }}>
                  {simulating ? 'Simulando...' : 'Simular'}
                </button>
              </form>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {resultado ? (
                <>
                  <div
                    className="card"
                    style={{
                      padding: 20,
                      background: resultado.factible ? 'rgba(16,185,129,0.08)' : 'rgba(248,113,113,0.08)',
                      border: `1px solid ${resultado.factible ? 'rgba(16,185,129,0.25)' : 'rgba(248,113,113,0.25)'}`,
                    }}
                  >
                    <div className="sim-result-status">
                      {resultado.factible
                        ? <CheckCircle size={36} style={{ color: '#10B981', flexShrink: 0 }} />
                        : <XCircle size={36} style={{ color: '#F87171', flexShrink: 0 }} />}
                      <div>
                        <p style={{ fontWeight: 800, fontSize: 18, color: resultado.factible ? '#10B981' : '#F87171' }}>
                          {resultado.factible ? 'Te alcanza' : 'No te alcanza'}
                        </p>
                          <p style={{ color: 'rgba(255,255,255,0.50)', fontSize: 13 }}>
                            {resultado.factible
                            ? `Esta cuota mantiene tu saldo acumulado por encima de ${fmt(resultado.colchonMinimo)} durante toda la proyeccion.`
                            : resultado.mesesConDeficit.length > 0
                              ? `No te alcanza: ${resultado.mesesConDeficit.length} mes(es) quedarian en negativo. El primero seria ${resultado.primerMesEnRojo}.`
                              : `No te alcanza: ${resultado.mesesBajoColchon.length} mes(es) quedarian por debajo de tu minimo libre acumulado. El primero seria ${resultado.primerMesBajoColchon}.`}
                          </p>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                    {[
                      { label: 'Saldo inicial', value: fmt(resultado.saldoInicial), color: '#C487F6' },
                      { label: 'Cuota al mes', value: fmt(resultado.cuota), color: '#FFFFFF' },
                      { label: 'Total', value: fmt(resultado.totalPagar), color: '#F87171' },
                      { label: 'Intereses', value: fmt(resultado.totalIntereses), color: '#C487F6' },
                      { label: 'Minimo libre', value: fmt(resultado.colchonMinimo), color: '#FBBF24' },
                      {
                        label: 'Saldo acumulado mas bajo',
                        value: fmt(resultado.balanceMinimo),
                        color: resultado.balanceMinimo >= resultado.colchonMinimo ? '#10B981' : '#F87171',
                      },
                    ].map((stat) => (
                      <div key={stat.label} className="card" style={{ padding: 16, textAlign: 'center' }}>
                        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginBottom: 6 }}>{stat.label}</p>
                        <p style={{ fontWeight: 700, color: stat.color, fontSize: 14 }}>{stat.value}</p>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={guardarSimulacion}
                    disabled={guardando}
                    className="btn-modal-cancel"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '12px 0',
                      border: '1.5px solid rgba(196,135,246,0.30)',
                      color: '#C487F6',
                    }}
                  >
                    <Save size={16} /> {guardando ? 'Guardando...' : 'Guardar simulacion'}
                  </button>

                  {resultado.factible && (
                    diferidoOk ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          padding: '12px 0',
                          background: 'rgba(16,185,129,0.10)',
                          border: '1.5px solid rgba(16,185,129,0.25)',
                          borderRadius: 12,
                          color: '#10B981',
                          fontSize: 14,
                          fontWeight: 600,
                        }}
                      >
                        <CheckCircle size={16} /> Ya quedo en gastos a cuotas.
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmAddDiferidoOpen(true)}
                        disabled={agregando}
                        className="btn-modal-save"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '12px 0' }}
                      >
                        <CreditCard size={16} /> {agregando ? 'Agregando...' : 'Agregar como gasto a cuotas'}
                      </button>
                    )
                  )}
                </>
              ) : (
                <div
                  className="card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 300,
                    color: 'rgba(255,255,255,0.25)',
                  }}
                >
                  <p style={{ fontSize: 14 }}>Completa arriba y toca Simular</p>
                </div>
              )}
            </div>
          </div>

          {resultado && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header">
                <h2 className="card-title">Flujo con prestamo · 24 meses</h2>
              </div>
              <div style={{ marginBottom: 14, fontSize: 12, color: 'rgba(255,255,255,0.50)' }}>
                La curva incorpora tu saldo inicial como arrastre visible: saldo positivo suma a ingresos y saldo negativo carga a egresos.
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={resultado.flujoConPrestamo} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gSimIng" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gSimGas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F87171" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#F87171" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="mes" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} tickFormatter={(v) => fmt(v)} width={90} />
                  <Tooltip
                    contentStyle={{ background: 'rgba(26,37,64,0.95)', border: '1px solid rgba(196,135,246,0.2)', borderRadius: 12 }}
                    labelStyle={{ color: '#FFFFFF', marginBottom: 4, fontWeight: 700 }}
                    formatter={(v, n) => [
                      fmt(v),
                      n === 'ingresosVisibles'
                        ? 'Ingresos + arrastre'
                        : 'Egresos + cuotas + arrastre',
                    ]}
                  />
                  <Legend formatter={(v) => (
                    v === 'ingresosVisibles' ? 'Ingresos + arrastre' : 'Egresos + cuotas + arrastre'
                  )} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.20)" strokeDasharray="4 4" />
                  <ReferenceLine
                    y={resultado.colchonMinimo}
                    stroke="#FBBF24"
                    strokeDasharray="6 4"
                    label={{ value: 'Minimo libre', fill: '#FBBF24', position: 'right', fontSize: 11 }}
                  />
                  <Area type="monotone" dataKey="ingresosVisibles" stroke="#10B981" fill="url(#gSimIng)" strokeWidth={2.5} />
                  <Area type="monotone" dataKey="gastosVisibles" stroke="#F87171" fill="url(#gSimGas)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="card" style={{ padding: 0 }}>
            <div className="card-header" style={{ padding: '18px 24px 0' }}>
              <h2 className="card-title">Simulaciones guardadas</h2>
            </div>

            {simulaciones.length === 0 ? (
              <div className="empty-state" style={{ paddingBottom: 26 }}>
                <p className="empty-text">Aun no guardas simulaciones</p>
                <p className="empty-sub">Simula algo y guardalo para compararlo despues.</p>
              </div>
            ) : (
              <>
                <ListControls
                  query={query}
                  onQueryChange={(value) => { setQuery(value); setPage(1) }}
                  placeholder="Buscar por nombre, banco o minimo..."
                  page={safePage}
                  pageCount={pageCount}
                  onPrevPage={() => setPage((prev) => Math.max(1, prev - 1))}
                  onNextPage={() => setPage((prev) => Math.min(pageCount, prev + 1))}
                  pageSize={pageSize}
                  onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
                  totalItems={simulaciones.length}
                  filteredItems={filteredSimulaciones.length}
                />

                <div className="table-wrap" style={{ border: 'none' }}>
                  <table className="table">
                    <thead>
                      <tr>{['Nombre', 'Monto', 'Banco', 'Tasa', 'Plazo', 'Colchon', 'Cuota', ''].map((h) => <th key={h}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {paginatedSimulaciones.map((s) => (
                        <tr key={s.id}>
                          <td style={{ fontWeight: 600 }}>{s.nombre}</td>
                          <td>{fmt(s.monto)}</td>
                          <td>{s.banco_nombre || '-'}</td>
                          <td>{s.tasa_anual}%</td>
                          <td>{s.plazo_meses} m</td>
                          <td>{s.colchon_minimo ? fmt(s.colchon_minimo) : '-'}</td>
                          <td className="table-amount positive">{fmt(s.cuota_mensual)}</td>
                          <td className="table-actions-cell">
                            <button
                              className="btn-icon danger"
                              disabled={deletingId === s.id}
                              onClick={() => openDeleteConfirm(s.id)}
                            >
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
        </>
      )}

      <ConfirmDialog
        open={confirmAddDiferidoOpen}
        title="Agregar cuota a tu flujo"
        message={`Se agregara una cuota mensual de ${fmt(resultado?.cuota || 0)} desde ${fechaInicioDiferidoLabel || form.fecha_inicio} en tus gastos a cuotas.`}
        confirmText="Confirmar"
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
        title="Eliminar simulacion"
        message="Esta simulacion se eliminara de tu historial guardado."
        confirmText="Eliminar"
        cancelText="Cancelar"
        loading={deletingId !== null}
        onConfirm={eliminarSimulacion}
        onClose={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}
