import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { TrendingUp, TrendingDown, Wallet, PiggyBank, RefreshCw, ChevronDown, ChevronLeft, ChevronRight, Maximize2, X, LayoutList, Tag } from 'lucide-react'

import api from '../../api/client'
import { getApiErrorMessage } from '../../api/errors'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import Modal from '../../components/ui/Modal'
import SaludFinancieraCard from './SaludFinancieraCard'
import { useAuth } from '../../context/useAuth'
import { formatMoney, formatNumber } from '../../utils/formatters'
import { montoEfectivoMes } from '../../utils/frecuencias'
import '../../components/ui/app.css'

const MESES_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const FREQUENCY_LABELS = {
  diario: 'Diario',
  semanal: 'Semanal',
  quincenal: 'Quincenal',
  mensual: 'Mensual',
  bimestral: 'Bimestral',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual',
}

const SERIES_FOCUS_OPTIONS = [
  { value: 'all', label: 'Todas' },
  { value: 'income', label: 'Ingresos' },
  { value: 'expense', label: 'Gastos' },
]
const PROJECTION_MODE_OPTIONS = [
  { value: 'simple', label: 'Simple' },
  { value: 'automatica', label: 'Inteligente' },
  { value: 'conservadora', label: 'Conservadora' },
]
const FUTURE_PROJECTION_OPTIONS = [
  { value: 12, label: '1 ano' },
  { value: 24, label: '2 anos' },
  { value: 60, label: '5 anos' },
  { value: 120, label: '10 anos' },
]
const DASHBOARD_FUTURE_MONTHS = 12
const DEFAULT_FREE_PROJECTION_DISPLAY_MONTHS = 6
const MOBILE_PROJECTION_WINDOW_MONTHS = 12
const DESKTOP_PROJECTION_WINDOW_MONTHS = 12
const MOBILE_CHART_BREAKPOINT = 768
const ProjectionChartCanvas = lazy(() => import('../../components/charts/ProjectionChartCanvas'))


function getProjectionAnalysisHelp(mode, variableHistoryMonths, variableHistoryObservations) {
  if (mode === 'simple') {
    return 'Simple proyecta tus fijos, variables y diferidos con los montos estimados que registraste. No proyecta gastos puntuales al futuro.'
  }

  const variableHistoryText = variableHistoryObservations > 0
    ? `Usa ${variableHistoryObservations} registros reales de variables en ${variableHistoryMonths} ${variableHistoryMonths === 1 ? 'mes' : 'meses'}, dentro de una ventana de hasta 18 meses. El ultimo ano tiene peso doble.`
    : 'Aun no hay montos reales de variables; mientras los registras, usa tus estimados.'

  if (mode === 'conservadora') {
    return `${variableHistoryText} Conservadora tambien distribuye entre 12 meses los gastos puntuales que marcaste para incluir.`
  }
  return `${variableHistoryText} Inteligente no proyecta gastos puntuales historicos.`
}

function getFrequencyLabel(frequency) {
  return FREQUENCY_LABELS[frequency] || 'Mensual'
}

function parseLocalDate(value) {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date, amount) {
  return startOfMonth(new Date(date.getFullYear(), date.getMonth() + amount, 1))
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
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

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function getSeriesFamily(dataKey = '') {
  if (dataKey.startsWith('ing_')) return 'income'
  if (dataKey.startsWith('gasto_')) return 'expense'
  return 'all'
}

function formatDetailShare(amount, total) {
  const safeAmount = Number(amount || 0)
  const safeTotal = Number(total || 0)
  if (!Number.isFinite(safeAmount) || !Number.isFinite(safeTotal) || safeTotal <= 0) return null

  const percentage = (safeAmount / safeTotal) * 100
  return `${formatNumber(percentage, { maximumFractionDigits: 1 })}%`
}

function clampProjectionWindow(startIndex, totalPoints, windowSize) {
  if (totalPoints <= 0) {
    return { startIndex: 0, endIndex: 0 }
  }

  const safeWindowSize = Math.max(1, Math.min(windowSize, totalPoints))
  const maxStartIndex = Math.max(0, totalPoints - safeWindowSize)
  const safeStartIndex = Math.min(Math.max(0, startIndex), maxStartIndex)

  return {
    startIndex: safeStartIndex,
    endIndex: Math.min(totalPoints - 1, safeStartIndex + safeWindowSize - 1),
  }
}

function buildProjectionWindowAroundIndex(targetIndex, totalPoints, windowSize) {
  if (totalPoints <= 0) {
    return { startIndex: 0, endIndex: 0 }
  }

  const safeWindowSize = Math.max(1, Math.min(windowSize, totalPoints))
  const centeredStartIndex = Math.max(0, targetIndex - Math.floor(safeWindowSize / 2))
  return clampProjectionWindow(centeredStartIndex, totalPoints, safeWindowSize)
}

export default function Dashboard() {
  const { user, fetchPerfil } = useAuth()

  const [data, setData] = useState({
    ingresos: [],
    ingresosPuntuales: [],
    gastosCorrientes: [],
    gastosNoCorrientes: [],
    diferidos: [],
  })

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [feedback, setFeedback] = useState({ type: '', message: '' })
  const [ahorroInicial, setAhorroInicial] = useState('')
  const [savingAhorro, setSavingAhorro] = useState(false)
  const [advancedProjection, setAdvancedProjection] = useState(null)
  const [projectionLoading, setProjectionLoading] = useState(false)
  const [projectionError, setProjectionError] = useState('')
  const [projectionMode, setProjectionMode] = useState('simple')
  const [projectionModeSaving, setProjectionModeSaving] = useState(false)
  const [pastMonths, setPastMonths] = useState(6)
  const [futureMonths, setFutureMonths] = useState(12)
  const [showProjectionPeriod, setShowProjectionPeriod] = useState(false)
  const [seriesFocus, setSeriesFocus] = useState('all')
  const [activeSummaryDetail, setActiveSummaryDetail] = useState(null)
  const [detailSort, setDetailSort] = useState('amount-desc')
  const [showCategoryView, setShowCategoryView] = useState(false)
  const [selectedExpenseCategory, setSelectedExpenseCategory] = useState(null)
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()))
  const [dashboardMonthBounds, setDashboardMonthBounds] = useState(() => {
    const current = startOfMonth(new Date())
    return { minMonth: current, maxMonth: addMonths(current, DASHBOARD_FUTURE_MONTHS) }
  })
  const [hasAnyMovement, setHasAnyMovement] = useState(false)
  const [isCompactProjectionChart, setIsCompactProjectionChart] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < MOBILE_CHART_BREAKPOINT,
  )
  const [projectionWindow, setProjectionWindow] = useState({ startIndex: 0, endIndex: 0 })
  const [showFullChart, setShowFullChart] = useState(false)
  const projectionDebounceRef = useRef(null)
  const projectionRequestIdRef = useRef(0)
  const loadProjectionChartRef = useRef(null)
  const projectionChartAnchorRef = useRef(null)
  const [shouldLoadProjectionCharts, setShouldLoadProjectionCharts] = useState(false)
  const advancedProjectionEnabled = Boolean(user?.feature_access?.advanced_projection_enabled)
  const healthScoreEnabled = Boolean(user?.feature_access?.health_score_enabled)
  const projectionDisplayMonths = Math.max(2, normalizePositiveInt(
    user?.feature_access?.projection_months,
    DEFAULT_FREE_PROJECTION_DISPLAY_MONTHS,
  ))
  const freeProjectionFutureMonths = Math.max(1, Math.floor(projectionDisplayMonths / 2))
  const freeProjectionPastMonths = Math.max(1, projectionDisplayMonths - freeProjectionFutureMonths)
  const advancedProjectionMaxMonths = normalizePositiveInt(user?.feature_access?.advanced_projection_months, 120)
  const currentPlanLabel = user?.plan?.slug === 'pro' ? 'Pro' : 'Gratis'
  const currentPlanBadgeClass = user?.plan?.slug === 'pro' ? 'is-pro' : 'is-free'
  const availableFutureProjectionOptions = useMemo(() => {
    const baseOptions = FUTURE_PROJECTION_OPTIONS.filter((option) => option.value <= advancedProjectionMaxMonths)
    if (!baseOptions.length || baseOptions[baseOptions.length - 1].value !== advancedProjectionMaxMonths) {
      baseOptions.push({
        value: advancedProjectionMaxMonths,
        label: advancedProjectionMaxMonths % 12 === 0
          ? `${advancedProjectionMaxMonths / 12} anos`
          : `${advancedProjectionMaxMonths} meses`,
      })
    }
    return baseOptions
  }, [advancedProjectionMaxMonths])

  useEffect(() => {
    if (!advancedProjectionEnabled) {
      setProjectionMode('simple')
      return
    }
    setProjectionMode(user?.projection_mode || 'automatica')
  }, [advancedProjectionEnabled, user?.projection_mode])

  useEffect(() => {
    if (futureMonths <= advancedProjectionMaxMonths) return
    setFutureMonths(advancedProjectionMaxMonths)
  }, [advancedProjectionMaxMonths, futureMonths])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    function handleResize() {
      setIsCompactProjectionChart(window.innerWidth < MOBILE_CHART_BREAKPOINT)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const anchor = projectionChartAnchorRef.current
    if (!anchor || !('IntersectionObserver' in window)) {
      setShouldLoadProjectionCharts(true)
      return undefined
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      setShouldLoadProjectionCharts(true)
    }, { rootMargin: '320px' })
    observer.observe(anchor)
    return () => observer.disconnect()
  }, [])
  const loadProjectionChart = useCallback(async (fm = futureMonths, pm = pastMonths, { forceRecalculate = false } = {}) => {
    const requestId = projectionRequestIdRef.current + 1
    projectionRequestIdRef.current = requestId
    const months = advancedProjectionEnabled
      ? Math.min(fm, advancedProjectionMaxMonths)
      : freeProjectionFutureMonths
    const realPastMonths = advancedProjectionEnabled ? pm : freeProjectionPastMonths
    setProjectionLoading(true)
    setProjectionError('')

    try {
      if (forceRecalculate) {
        await api.post('/finanzas/saldo-mes/recalcular/')
      }
      const { data: response } = await api.get(`/finanzas/proyeccion-acumulada/?months=${months}&past_months=${realPastMonths}`)
      if (requestId !== projectionRequestIdRef.current) return
      setAdvancedProjection(response)
    } catch (err) {
      if (requestId !== projectionRequestIdRef.current) return
      setAdvancedProjection(null)
      setProjectionError(getApiErrorMessage(
        err,
        advancedProjectionEnabled ? 'No se pudo cargar la proyeccion Pro.' : 'No se pudo cargar la proyeccion.',
      ))
    } finally {
      if (requestId === projectionRequestIdRef.current) {
        setProjectionLoading(false)
      }
    }
  }, [
    advancedProjectionEnabled,
    advancedProjectionMaxMonths,
    freeProjectionFutureMonths,
    freeProjectionPastMonths,
    futureMonths,
    pastMonths,
  ])
  loadProjectionChartRef.current = loadProjectionChart

  const loadDashboard = useCallback(async (month, { silent = false } = {}) => {
    if (silent) setRefreshing(true)
    else setLoading(true)

    try {
      const { data: resumen } = await api.get('/finanzas/dashboard/', {
        params: { anio: month.getFullYear(), mes: month.getMonth() + 1 },
      })

      setData({
        ingresos: resumen.ingresos || [],
        ingresosPuntuales: resumen.ingresos_puntuales || [],
        gastosCorrientes: resumen.gastos_corrientes || [],
        gastosNoCorrientes: resumen.gastos_no_corrientes || [],
        diferidos: resumen.diferidos || [],
      })
      setHasAnyMovement(Boolean(resumen.has_any_movement))
      if (resumen.bounds?.min_month && resumen.bounds?.max_month) {
        setDashboardMonthBounds({
          minMonth: startOfMonth(parseLocalDate(resumen.bounds.min_month)),
          maxMonth: startOfMonth(parseLocalDate(resumen.bounds.max_month)),
        })
      }
      setFeedback({ type: '', message: '' })
    } catch (err) {
      setData({
        ingresos: [],
        ingresosPuntuales: [],
        gastosCorrientes: [],
        gastosNoCorrientes: [],
        diferidos: [],
      })
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo cargar el dashboard.') })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboard(selectedMonth)
  }, [loadDashboard, selectedMonth])

  useEffect(() => {
    void loadProjectionChartRef.current()
  }, [])

  function handleManualRefresh() {
    void loadDashboard(selectedMonth, { silent: true })
    void loadProjectionChart(futureMonths, pastMonths, { forceRecalculate: advancedProjectionEnabled })
  }

  function toggleSummaryDetail(kind) {
    setActiveSummaryDetail((current) => (current === kind ? null : kind))
    setShowCategoryView(false)
    setSelectedExpenseCategory(null)
  }

  function toggleCategoryView() {
    setShowCategoryView((current) => {
      const next = !current
      if (!next) setSelectedExpenseCategory(null)
      return next
    })
  }

  async function handleProjectionModeChange(nextMode) {
    if (!advancedProjectionEnabled || projectionModeSaving || nextMode === projectionMode) return
    const previousMode = projectionMode
    setProjectionMode(nextMode)
    setProjectionModeSaving(true)
    setProjectionError('')

    try {
      await api.patch('/usuarios/perfil/', { projection_mode: nextMode })
      await fetchPerfil()
      await loadProjectionChart(futureMonths, pastMonths)
    } catch (err) {
      setProjectionMode(previousMode)
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo actualizar el modo de proyeccion.') })
    } finally {
      setProjectionModeSaving(false)
    }
  }

  const moneda = user?.moneda_preferida || 'USD'
  const fmt = (value) => formatMoney(value, { currency: moneda, currencyDisplay: 'narrowSymbol' })
  const fmtAxis = (value) => formatMoney(value, {
    currency: moneda,
    currencyDisplay: 'narrowSymbol',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  // Un rubro variable con consumos registrados en el mes vale su gasto real; el
  // estimado solo aplica mientras no haya consumos (mes en curso o sin registrar).
  // El backend entrega monto_real_mes solo para el mes consultado.
  const montoDelMes = (item) => (item.monto_real_mes ?? item.monto)
  const mensualizado = (item) => montoEfectivoMes(montoDelMes(item), item.frecuencia, item.fecha_inicio, selectedMonth.getFullYear(), selectedMonth.getMonth() + 1)

  // Ahorro inicial: se guarda como un ingreso puntual "Ahorros iniciales" con
  // fecha de hoy, para que el saldo/proyeccion/colchon arranquen con ese valor.
  async function guardarAhorroInicial() {
    const monto = parseFloat(ahorroInicial)
    if (!monto || monto <= 0 || savingAhorro) return
    setSavingAhorro(true)
    setFeedback({ type: '', message: '' })
    try {
      const hoy = new Date()
      const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
      await api.post('/finanzas/ingresos-puntuales/', {
        descripcion: 'Ahorros iniciales',
        monto,
        fecha,
        notas: 'Saldo con el que empiezo a usar Aura',
        incluir_en_proyeccion: true,
      })
      setAhorroInicial('')
      setFeedback({ type: 'success', message: `Listo, empiezas con ${fmt(monto)} de saldo.` })
      await loadDashboard(selectedMonth)
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo guardar tu ahorro inicial.') })
    } finally {
      setSavingAhorro(false)
    }
  }
  const realMonth = useMemo(() => startOfMonth(new Date()), [])

  useEffect(() => {
    setSelectedMonth((current) => {
      if (current < dashboardMonthBounds.minMonth) return dashboardMonthBounds.minMonth
      if (current > dashboardMonthBounds.maxMonth) return dashboardMonthBounds.maxMonth
      return current
    })
  }, [dashboardMonthBounds])

  useEffect(() => {
    setSelectedExpenseCategory(null)
  }, [selectedMonth])

  function moveSelectedMonth(offset) {
    setSelectedMonth((current) => {
      const next = addMonths(current, offset)
      if (next < dashboardMonthBounds.minMonth) return dashboardMonthBounds.minMonth
      if (next > dashboardMonthBounds.maxMonth) return dashboardMonthBounds.maxMonth
      return next
    })
  }

  const canGoPrevMonth = selectedMonth > dashboardMonthBounds.minMonth
  const canGoNextMonth = selectedMonth < dashboardMonthBounds.maxMonth
  const isFutureSelectedMonth = selectedMonth > realMonth
  const selectedMonthLabel = `${MESES_FULL[selectedMonth.getMonth()]} ${selectedMonth.getFullYear()}`
  const monthReferenceText = selectedMonthLabel.toLowerCase()

  const fixedIncomesThisMonth = useMemo(
    () => data.ingresos.filter((item) => overlapsMonth(item, selectedMonth)),
    [data.ingresos, selectedMonth],
  )
  const punctualIncomesThisMonth = useMemo(
    () => data.ingresosPuntuales.filter((item) => occursInMonth(item, selectedMonth)),
    [data.ingresosPuntuales, selectedMonth],
  )
  const fixedExpensesThisMonth = useMemo(
    () => data.gastosCorrientes.filter((item) => (item.tipo_monto || 'fijo') !== 'variable' && overlapsMonth(item, selectedMonth)),
    [data.gastosCorrientes, selectedMonth],
  )
  const variableExpensesThisMonth = useMemo(
    () => data.gastosCorrientes.filter((item) => item.tipo_monto === 'variable' && overlapsMonth(item, selectedMonth)),
    [data.gastosCorrientes, selectedMonth],
  )
  const punctualExpensesThisMonth = useMemo(
    () => data.gastosNoCorrientes.filter((item) => occursInMonth(item, selectedMonth)),
    [data.gastosNoCorrientes, selectedMonth],
  )
  const installmentsThisMonth = useMemo(
    () => data.diferidos.filter((item) => overlapsMonth(item, selectedMonth)),
    [data.diferidos, selectedMonth],
  )

  const totalIngFijos = fixedIncomesThisMonth
    .reduce((sum, item) => sum + mensualizado(item), 0)
  const totalIngPuntuales = punctualIncomesThisMonth
    .reduce((sum, item) => sum + Number(item.monto), 0)
  const totalIng = totalIngFijos + totalIngPuntuales

  const totalGCFijos = fixedExpensesThisMonth
    .reduce((sum, item) => sum + mensualizado(item), 0)
  const totalGCVariables = variableExpensesThisMonth
    .reduce((sum, item) => sum + mensualizado(item), 0)
  const totalGC = totalGCFijos + totalGCVariables
  const totalGNC = punctualExpensesThisMonth
    .reduce((sum, item) => sum + Number(item.monto), 0)
  const totalDif = installmentsThisMonth
    .reduce((sum, item) => sum + Number(item.cuota_mes ?? item.cuota_mensual), 0)
  const totalGastos = totalGC + totalGNC + totalDif
  const balance = totalIng - totalGastos

  const applySortDetail = useCallback((items) => {
    return [...items].sort((a, b) => {
      if (detailSort === 'amount-asc') return a.amount - b.amount
      if (detailSort === 'date-desc') return (b.date || '').localeCompare(a.date || '')
      if (detailSort === 'date-asc') return (a.date || '').localeCompare(b.date || '')
      return b.amount - a.amount
    })
  }, [detailSort])

  const incomeDetailSections = [
    {
      id: 'income-fixed',
      title: 'Ingresos fijos',
      tone: 'income',
      total: totalIngFijos,
      emptyLabel: `No tienes ingresos fijos activos en ${monthReferenceText}.`,
      items: applySortDetail(fixedIncomesThisMonth.map((item) => ({
        id: `income-fixed-${item.id}`,
        label: item.descripcion,
        meta: `${getFrequencyLabel(item.frecuencia)} - impacto mensual`,
        amount: mensualizado(item),
        date: item.fecha_inicio || '',
      }))),
    },
    {
      id: 'income-punctual',
      title: 'Ingresos puntuales',
      tone: 'income',
      total: totalIngPuntuales,
      emptyLabel: `No tienes ingresos puntuales guardados en ${monthReferenceText}.`,
      items: applySortDetail(punctualIncomesThisMonth.map((item) => ({
        id: `income-punctual-${item.id}`,
        label: item.descripcion,
        meta: `Puntual - ${item.fecha}`,
        amount: Number(item.monto),
        date: item.fecha || '',
      }))),
    },
  ]

  const expenseDetailSections = [
    {
      id: 'expense-fixed',
      title: 'Gastos fijos',
      tone: 'expense',
      total: totalGCFijos,
      emptyLabel: `No tienes gastos fijos activos en ${monthReferenceText}.`,
      items: applySortDetail(fixedExpensesThisMonth.map((item) => ({
        id: `expense-fixed-${item.id}`,
        label: item.descripcion,
        meta: `${item.categoria || 'Sin categoria'} - ${getFrequencyLabel(item.frecuencia)}`,
        amount: mensualizado(item),
        date: item.fecha_inicio || '',
      }))),
    },
    {
      id: 'expense-variable',
      title: 'Gastos variables',
      tone: 'expense',
      total: totalGCVariables,
      emptyLabel: `No tienes gastos variables en ${monthReferenceText}.`,
      items: applySortDetail(variableExpensesThisMonth.map((item) => ({
        id: `expense-variable-${item.id}`,
        label: item.descripcion,
        meta: `${item.categoria || 'Sin categoria'} - variable`,
        amount: mensualizado(item),
        date: item.fecha_inicio || '',
      }))),
    },
    {
      id: 'expense-installment',
      title: 'Cuotas activas',
      tone: 'expense',
      total: totalDif,
      emptyLabel: `No tienes cuotas activas en ${monthReferenceText}.`,
      items: applySortDetail(installmentsThisMonth.map((item) => ({
        id: `expense-installment-${item.id}`,
        label: item.descripcion,
        meta: `${item.categoria || 'Sin categoria'} - cuota mensual`,
        amount: Number(item.cuota_mes ?? item.cuota_mensual),
        date: item.fecha_inicio || '',
      }))),
    },
    {
      id: 'expense-punctual',
      title: 'Gastos puntuales',
      tone: 'expense',
      total: totalGNC,
      emptyLabel: `No tienes gastos puntuales guardados en ${monthReferenceText}.`,
      items: applySortDetail(punctualExpensesThisMonth.map((item) => ({
        id: `expense-punctual-${item.id}`,
        label: item.descripcion,
        meta: `${item.categoria || 'Sin categoria'} - ${item.fecha}`,
        amount: Number(item.monto),
        date: item.fecha || '',
      }))),
    },
  ]

  const expenseCategoryBreakdown = useMemo(() => {
    const map = new Map()

    function registerExpenseItem(category, item) {
      const cat = category || 'Sin categoria'
      const current = map.get(cat) || { cat, total: 0, items: [] }
      current.total += item.amount
      current.items.push(item)
      map.set(cat, current)
    }

    fixedExpensesThisMonth.forEach((item) => {
      registerExpenseItem(item.categoria, {
        id: `expense-fixed-${item.id}`,
        label: item.descripcion,
        meta: getFrequencyLabel(item.frecuencia),
        amount: mensualizado(item),
        date: item.fecha_inicio || '',
        kind: 'fixed',
        kindLabel: 'Fijo',
      })
    })

    variableExpensesThisMonth.forEach((item) => {
      registerExpenseItem(item.categoria, {
        id: `expense-variable-${item.id}`,
        label: item.descripcion,
        meta: 'Variable',
        amount: mensualizado(item),
        date: item.fecha_inicio || '',
        kind: 'variable',
        kindLabel: 'Variable',
      })
    })

    punctualExpensesThisMonth.forEach((item) => {
      registerExpenseItem(item.categoria, {
        id: `expense-punctual-${item.id}`,
        label: item.descripcion,
        meta: '',
        amount: Number(item.monto),
        date: item.fecha || '',
        kind: 'punctual',
        kindLabel: 'Puntual',
      })
    })

    installmentsThisMonth.forEach((item) => {
      registerExpenseItem(item.categoria, {
        id: `expense-installment-${item.id}`,
        label: item.descripcion,
        meta: 'Cuota mensual',
        amount: Number(item.cuota_mes ?? item.cuota_mensual),
        date: item.fecha_inicio || '',
        kind: 'installment',
        kindLabel: 'Cuota',
      })
    })

    return Array.from(map.values())
      .map((entry) => ({
        ...entry,
        items: applySortDetail(entry.items),
      }))
      .sort((a, b) => b.total - a.total)
  }, [applySortDetail, fixedExpensesThisMonth, variableExpensesThisMonth, punctualExpensesThisMonth, installmentsThisMonth])

  const activeExpenseCategory = useMemo(
    () => expenseCategoryBreakdown.find(({ cat }) => cat === selectedExpenseCategory) || null,
    [expenseCategoryBreakdown, selectedExpenseCategory],
  )

  const activeSummarySections = activeSummaryDetail === 'income' ? incomeDetailSections : expenseDetailSections
  const activeSummaryTitle = activeSummaryDetail === 'income'
    ? `Detalle de ingresos de ${selectedMonthLabel}`
    : `Detalle de gastos de ${selectedMonthLabel}`
  const activeSummarySubtitle = activeSummaryDetail === 'income'
    ? `Aqui ves rapido los ingresos guardados que cuentan en ${monthReferenceText}.`
    : `Aqui ves rapido los gastos guardados que cuentan en ${monthReferenceText}.`




  const tasaAhorro = totalIng > 0 ? Math.round((balance / totalIng) * 100) : 0

  const advancedSeries = useMemo(() => advancedProjection?.series || [], [advancedProjection])
  const currentMonthKey = advancedProjection?.current_month || null

  // Dividir series en real/proyectado manteniendo un punto de conexión
  const chartSeries = useMemo(() => {
    if (!advancedSeries.length) return []
    const lastRealIdx = advancedSeries.reduce((acc, p, i) => p.is_real ? i : acc, -1)

    return advancedSeries.map((point, i) => {
      const isConnectReal = point.is_real || i === lastRealIdx + 1
      const isConnectProj = !point.is_real || i === lastRealIdx
      // Ingresos disponibles = saldo anterior (opening) + ingresos del mes
      // El excedente o déficit del mes anterior se arrastra al siguiente (bola de nieve)
      const opening = Number(point.opening_balance ?? 0)
      const ingMes = Number(point.monthly_ingresos ?? 0)
      const gastoMes = Number(point.monthly_gastos ?? 0)
      const ingDisponible = advancedProjectionEnabled ? opening + ingMes : ingMes
      // Saldo al cierre del mes (closing_balance)
      const gapAcumulado = Number(point.closing_balance ?? 0)

      return {
        label: point.label,
        month: point.month,
        is_real: point.is_real,
        opening,
        ingMes,
        gastoMes,
        gapAcumulado,
        ing_real: isConnectReal ? ingDisponible : null,
        ing_proj: isConnectProj ? ingDisponible : null,
        gasto_real: isConnectReal ? gastoMes : null,
        gasto_proj: isConnectProj ? gastoMes : null,
      }
    })
  }, [advancedProjectionEnabled, advancedSeries])

  const projectionWindowSize = isCompactProjectionChart
    ? MOBILE_PROJECTION_WINDOW_MONTHS
    : DESKTOP_PROJECTION_WINDOW_MONTHS
  const currentMonthIndex = useMemo(
    () => chartSeries.findIndex((point) => point.month === currentMonthKey),
    [chartSeries, currentMonthKey],
  )
  const showProjectionNavigator = chartSeries.length > projectionWindowSize

  useEffect(() => {
    if (!chartSeries.length) {
      setProjectionWindow({ startIndex: 0, endIndex: 0 })
      return
    }

    setProjectionWindow((current) => {
      const currentWindowSize = current.endIndex >= current.startIndex
        ? current.endIndex - current.startIndex + 1
        : 0
      const expectedWindowSize = Math.min(projectionWindowSize, chartSeries.length)
      if (
        currentWindowSize === expectedWindowSize
        && current.startIndex >= 0
        && current.endIndex < chartSeries.length
      ) {
        return clampProjectionWindow(current.startIndex, chartSeries.length, projectionWindowSize)
      }

      const anchorIndex = currentMonthIndex >= 0 ? currentMonthIndex : 0
      return buildProjectionWindowAroundIndex(anchorIndex, chartSeries.length, projectionWindowSize)
    })
  }, [chartSeries.length, currentMonthIndex, projectionWindowSize])

  const latestProjectedPoint = chartSeries.filter((point) => !point.is_real).at(-1) || null
  const visibleProjectionSeries = chartSeries.slice(projectionWindow.startIndex, projectionWindow.endIndex + 1)
  const visibleCurrentMonthLabel = visibleProjectionSeries.find((point) => point.month === currentMonthKey)?.label || null
  const isCurrentMonthVisible = visibleProjectionSeries.some((p) => p.month === currentMonthKey)

  function slideProjectionPage(direction) {
    const step = Math.max(1, Math.round(projectionWindowSize / 4))
    const nextStart = projectionWindow.startIndex + direction * step
    setProjectionWindow(clampProjectionWindow(nextStart, chartSeries.length, projectionWindowSize))
  }

  function resetToCurrentMonth() {
    const anchorIndex = currentMonthIndex >= 0 ? currentMonthIndex : 0
    setProjectionWindow(buildProjectionWindowAroundIndex(anchorIndex, chartSeries.length, projectionWindowSize))
  }

  function preserveScroll(fn) {
    const y = window.scrollY
    fn()
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' })))
  }

  function shouldShowSeries(kind) {
    return seriesFocus === 'all' || seriesFocus === kind
  }

  function toggleSeriesFocus(kind) {
    setSeriesFocus((current) => (current === kind ? 'all' : kind))
  }

  function renderProjectionLegend({ payload = [] }) {
    return (
      <div className="dashboard-chart-toggle-group dashboard-legend-group">
        {payload.map((entry) => {
          const family = getSeriesFamily(entry.dataKey)
          if (family === 'all') return null
          const isActive = seriesFocus !== 'all' && seriesFocus === family
          return (
            <button
              key={entry.dataKey}
              type="button"
              className={`dashboard-chart-toggle dashboard-legend-toggle ${isActive ? 'active' : ''}`}
              onClick={() => toggleSeriesFocus(family)}
              aria-pressed={isActive}
              title="Filtrar esta curva"
            >
              <span
                className="dashboard-legend-dot"
                style={{
                  background: entry.color,
                  opacity: entry.dataKey.endsWith('_proj') ? 0.7 : 1,
                }}
              />
              {({
                ing_real: 'Total disponible este mes (real)',
                ing_proj: 'Total disponible este mes (proyectado)',
                gasto_real: 'Gastos del mes (real)',
                gasto_proj: 'Gastos del mes (proyectado)',
              }[entry.dataKey] || entry.value)}
            </button>
          )
        })}
      </div>
    )
  }

  function renderProjectionTooltip({ active, label, payload = [] }) {
    if (!active || !payload.length) return null
    const point = payload[0]?.payload
    if (!point) return null
    const ingDisponible = point.is_real ? point.ing_real : point.ing_proj
    const gastoDisplay = point.is_real ? point.gasto_real : point.gasto_proj

    return (
      <div style={{ background: 'var(--app-popover)', border: '1px solid rgba(196,135,246,0.2)', borderRadius: 12, padding: '10px 12px' }}>
        <div style={{ color: 'var(--app-text)', marginBottom: 6, fontWeight: 700 }}>
          {`${label} - ${point.is_real ? 'Real' : 'Proyectado'}`}
        </div>
        {advancedProjectionEnabled && point.gapAcumulado != null && (
          <div style={{ color: 'var(--app-lila)', fontWeight: 700, marginBottom: 4 }}>
            {`Saldo disponible: ${fmt(point.gapAcumulado)}`}
          </div>
        )}
        <div style={{ color: 'var(--app-green)' }}>{`Total disponible este mes: ${fmt(ingDisponible)}`}</div>
        {advancedProjectionEnabled && point.opening != null && (
          <div style={{ color: 'rgba(var(--app-ink-rgb),0.45)', fontSize: 11, marginBottom: 4 }}>
            {`Saldo anterior: ${fmt(point.opening)} + ingresos: ${fmt(point.ingMes)}`}
          </div>
        )}
        <div style={{ color: 'var(--app-danger)' }}>{`Gastos del mes: ${fmt(gastoDisplay)}`}</div>
      </div>
    )
  }

  const advancedChartEmpty = advancedSeries.length === 0 || advancedSeries.every(
    (point) => point.monthly_ingresos === 0 && point.monthly_gastos === 0,
  )

  function renderProjectionAreaChart({ interactive = false } = {}) {
    if (!shouldLoadProjectionCharts) {
      return (
        <div className="loading-screen" style={{ minHeight: '280px' }}>
          <div className="spinner" />
        </div>
      )
    }
    const chart = (
      <Suspense fallback={<div className="loading-screen" style={{ minHeight: '280px' }}><div className="spinner" /></div>}>
        <ProjectionChartCanvas
          data={visibleProjectionSeries}
          height={isCompactProjectionChart ? 320 : 360}
          compact={isCompactProjectionChart}
          currentMonthLabel={visibleCurrentMonthLabel}
          formatAxis={fmtAxis}
          renderTooltip={renderProjectionTooltip}
          renderLegend={renderProjectionLegend}
          showIncome={shouldShowSeries('income')}
          showExpense={shouldShowSeries('expense')}
        />
      </Suspense>
    )
    const rangeLabel = visibleProjectionSeries.length > 0
      ? `${visibleProjectionSeries[0].label} — ${visibleProjectionSeries.at(-1).label}`
      : null

    const canGoPrev = projectionWindow.startIndex > 0
    const canGoNext = projectionWindow.endIndex < chartSeries.length - 1

    const footer = (
      <div className="dashboard-chart-window-row">
        <button
          type="button"
          className="dashboard-chart-window-button"
          onClick={() => slideProjectionPage(-1)}
          disabled={!canGoPrev}
          aria-label="Periodo anterior"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="dashboard-chart-window-label">
          {!isCurrentMonthVisible && (
            <button type="button" className="dashboard-chart-window-today" onClick={resetToCurrentMonth}>
              Hoy
            </button>
          )}
          {rangeLabel && <span>{rangeLabel}</span>}
        </div>
        <button
          type="button"
          className="dashboard-chart-window-button"
          onClick={() => slideProjectionPage(1)}
          disabled={!canGoNext}
          aria-label="Periodo siguiente"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    )

    const fullChart = (
      <Suspense fallback={<div className="loading-screen" style={{ minHeight: '360px' }}><div className="spinner" /></div>}>
        <ProjectionChartCanvas
          data={chartSeries}
          height={420}
          full
          currentMonthLabel={chartSeries.find((point) => point.month === currentMonthKey)?.label}
          formatAxis={fmtAxis}
          renderTooltip={renderProjectionTooltip}
          renderLegend={renderProjectionLegend}
          showIncome={shouldShowSeries('income')}
          showExpense={shouldShowSeries('expense')}
        />
      </Suspense>
    )
    if (!interactive) return chart

    return (
      <div>
        {showFullChart && (
          <div className="dashboard-fullchart-overlay" onClick={() => setShowFullChart(false)}>
            <div className="dashboard-fullchart-box" onClick={e => e.stopPropagation()}>
              <div className="dashboard-fullchart-header">
                <span className="dashboard-fullchart-title">Proyeccion completa</span>
                <button className="dashboard-fullchart-close" onClick={() => setShowFullChart(false)} aria-label="Cerrar">
                  <X size={18} />
                </button>
              </div>
              {fullChart}
            </div>
          </div>
        )}
        {chart}
        {footer}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="loading-screen" style={{ minHeight: '60vh' }}>
        <div className="spinner" />
      </div>
    )
  }

  const hora = new Date().getHours()
  const saludo = hora < 12 ? 'Buenos dias' : hora < 19 ? 'Buenas tardes' : 'Buenas noches'
  const nombre = user?.username ? `, ${user.username}` : ''


  const gastoPct = totalIng > 0 ? Math.min(100, Math.round((totalGastos / totalIng) * 100)) : 0
  const barColor = gastoPct >= 90 ? 'var(--app-danger)' : gastoPct >= 75 ? '#FB923C' : gastoPct >= 50 ? '#FBBF24' : 'var(--app-green)'
  const tasaColor = tasaAhorro >= 20 ? 'var(--app-green)' : tasaAhorro >= 0 ? '#FBBF24' : 'var(--app-danger)'

  return (
    <div className="dashboard-shell">

      {/* ── Header ── */}
      <div className="dashboard-header-row">
        <div className="page-title-stack">
          <div className="page-title-row">
            <h1 className="page-title">{saludo}{nombre}</h1>
            <span className={`subtle-plan-badge ${currentPlanBadgeClass}`}>Plan {currentPlanLabel}</span>
          </div>
          <p className="page-subtitle">Tu mes, claro y sin vueltas.</p>
        </div>
        <div className="dashboard-month-switcher" aria-label="Cambiar mes del dashboard">
          <button
            type="button"
            className="dashboard-month-nav"
            onClick={() => moveSelectedMonth(-1)}
            disabled={!canGoPrevMonth}
            aria-label="Ver mes anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="dashboard-month-indicator">
            <span className={`dashboard-mes-badge ${isFutureSelectedMonth ? 'is-future' : ''}`}>{selectedMonthLabel}</span>
            {isFutureSelectedMonth && (
              <span className="dashboard-month-future-hint">Proyectado</span>
            )}
          </div>
          <button
            type="button"
            className="dashboard-month-nav"
            onClick={() => moveSelectedMonth(1)}
            disabled={!canGoNextMonth}
            aria-label="Ver mes siguiente"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      {/* ── Onboarding ── */}
      {!hasAnyMovement && (
        <div className="dashboard-onboarding-card">
          <h2 className="dashboard-onboarding-title">Empieza en 10 segundos.</h2>
          <p className="dashboard-onboarding-sub">
            Carga un ingreso, un gasto o importa tu historial. Con eso Aura ya te empieza a servir.
          </p>
          <div className="dashboard-onboarding-points">
            <span className="dashboard-onboarding-point">Tu saldo del mes empieza a tomar forma</span>
            <span className="dashboard-onboarding-point">La proyeccion ya puede darte una primera lectura</span>
            <span className="dashboard-onboarding-point">Lo demas lo completas despues, sin apuro</span>
          </div>

          <div className="dashboard-onboarding-ahorro">
            <label className="dashboard-onboarding-ahorro-label">¿Ya tienes ahorros? Empieza con tu saldo real</label>
            <div className="dashboard-onboarding-ahorro-row">
              <span className="dashboard-onboarding-ahorro-prefix">$</span>
              <input
                type="number" min="0" step="0.01" inputMode="decimal" placeholder="Ej: 500"
                className="dashboard-onboarding-ahorro-input"
                value={ahorroInicial}
                onChange={(e) => setAhorroInicial(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') guardarAhorroInicial() }}
              />
              <button
                type="button" className="btn-modal-save"
                disabled={savingAhorro || !ahorroInicial}
                onClick={guardarAhorroInicial}
              >
                {savingAhorro ? 'Guardando...' : 'Empezar con esto'}
              </button>
            </div>
            <p className="dashboard-onboarding-ahorro-hint">
              Suma todo lo que tengas ahorrado hoy. Lo guardamos como tu punto de partida para que tu proyeccion y tu colchon arranquen bien.
            </p>
          </div>

          <div className="dashboard-onboarding-actions">
            <Link to="/ingresos" className="btn-modal-save" style={{ textDecoration: 'none' }}>Cargar ingreso</Link>
            <Link to="/gastos-corrientes" className="btn-modal-cancel" style={{ textDecoration: 'none' }}>Cargar gasto</Link>
            <Link to="/importar" className="btn-modal-cancel" style={{ textDecoration: 'none' }}>Importar historial</Link>
          </div>
        </div>
      )}

      {/* ── 4 KPI Cards ── */}
      <div className="stats-grid dashboard-stats-grid">
        <button
          type="button"
          className={`stat-card stat-card-button ${activeSummaryDetail === 'income' ? 'is-active' : ''}`}
          onClick={() => toggleSummaryDetail('income')}
          aria-expanded={activeSummaryDetail === 'income'}
        >
          <div className="stat-card-header">
            <span className="stat-label">Ingresos</span>
            <TrendingUp size={16} style={{ color: 'var(--app-green)' }} />
          </div>
          <div className="stat-value green">{fmt(totalIng)}</div>
          <div className="stat-sub">Fijos + puntuales en {monthReferenceText}</div>
          <div className="stat-card-action">
            <span>{activeSummaryDetail === 'income' ? 'Ocultar detalle' : 'Ver detalle'}</span>
            <ChevronDown size={16} className={activeSummaryDetail === 'income' ? 'is-open' : ''} />
          </div>
        </button>

        <button
          type="button"
          className={`stat-card stat-card-button ${activeSummaryDetail === 'expense' ? 'is-active' : ''}`}
          onClick={() => toggleSummaryDetail('expense')}
          aria-expanded={activeSummaryDetail === 'expense'}
        >
          <div className="stat-card-header">
            <span className="stat-label">Gastos</span>
            <TrendingDown size={16} style={{ color: 'var(--app-danger)' }} />
          </div>
          <div className="stat-value red">{fmt(totalGastos)}</div>
          <div className="stat-sub">Fijos + puntuales + cuotas en {monthReferenceText}</div>
          <div className="stat-card-action">
            <span>{activeSummaryDetail === 'expense' ? 'Ocultar detalle' : 'Ver detalle'}</span>
            <ChevronDown size={16} className={activeSummaryDetail === 'expense' ? 'is-open' : ''} />
          </div>
        </button>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-label">Balance</span>
            <Wallet size={16} style={{ color: balance >= 0 ? 'var(--app-green)' : 'var(--app-danger)' }} />
          </div>
          <div className={`stat-value ${balance >= 0 ? 'green' : 'red'}`}>{fmt(balance)}</div>
          <div className="stat-sub">{balance >= 0 ? 'Flujo positivo' : 'Flujo apretado'}</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-label">Tasa de ahorro</span>
            <PiggyBank size={16} style={{ color: tasaColor }} />
          </div>
          <div className="stat-value" style={{ color: tasaColor }}>{tasaAhorro}%</div>
          <div className="stat-sub">{tasaAhorro >= 20 ? 'Buen ritmo de ahorro' : tasaAhorro >= 0 ? 'Margen ajustado' : 'Gastas mas de lo que ganas'}</div>
        </div>
      </div>

      {healthScoreEnabled && (
        <SaludFinancieraCard
          anio={selectedMonth.getFullYear()}
          mes={selectedMonth.getMonth() + 1}
          enabled={healthScoreEnabled}
        />
      )}

      {activeSummaryDetail && (
        <div className="dashboard-summary-detail-card">
          <div className="dashboard-summary-detail-head">
            <div className="dashboard-summary-detail-copy">
              <h2 className="dashboard-summary-detail-title">{activeSummaryTitle}</h2>
              <p className="dashboard-summary-detail-subtitle">{activeSummarySubtitle}</p>
            </div>
            <button
              type="button"
              className="dashboard-summary-detail-close"
              onClick={() => {
                setActiveSummaryDetail(null)
                setShowCategoryView(false)
                setSelectedExpenseCategory(null)
              }}
            >
              Ocultar
            </button>
          </div>

          <div className="dashboard-detail-controls">
            <div className="dashboard-detail-sort-group">
              {[
                { field: 'amount', label: 'Valor' },
                { field: 'date', label: 'Fecha' },
              ].map(({ field, label }) => {
                const isAsc = detailSort === `${field}-asc`
                const isDesc = detailSort === `${field}-desc`
                const active = isAsc || isDesc
                return (
                  <button
                    key={field}
                    type="button"
                    className={`dashboard-detail-sort-btn ${active ? 'active' : ''}`}
                    onClick={() => setDetailSort(active && isDesc ? `${field}-asc` : `${field}-desc`)}
                  >
                    {label}{active && <span>{isDesc ? ' ↓' : ' ↑'}</span>}
                  </button>
                )
              })}
            </div>
            {activeSummaryDetail === 'expense' && (
              <button
                type="button"
                className={`dashboard-detail-sort-btn dashboard-detail-cat-btn ${showCategoryView ? 'active' : ''}`}
                onClick={toggleCategoryView}
              >
                <Tag size={12} />
                Por categorias
              </button>
            )}
          </div>

          {showCategoryView && activeSummaryDetail === 'expense' ? (
            <div className="dashboard-summary-detail-grid">
              <section className="dashboard-summary-detail-section" style={{ gridColumn: '1 / -1' }}>
                <div className="dashboard-summary-detail-section-head">
                  <span className="dashboard-summary-detail-section-title">
                    <LayoutList size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
                    Gastos por categoria — {selectedMonthLabel}
                  </span>
                  <strong className="dashboard-summary-detail-section-total expense">{fmt(totalGastos)}</strong>
                </div>
                {expenseCategoryBreakdown.length ? (
                  <div className="dashboard-summary-detail-list">
                    {expenseCategoryBreakdown.map(({ cat, total, items }) => {
                      const share = formatDetailShare(total, totalGastos)
                      return (
                        <button
                          key={cat}
                          type="button"
                          className="dashboard-category-row-button"
                          onClick={() => setSelectedExpenseCategory(cat)}
                        >
                          <div className="dashboard-summary-detail-item-copy">
                            <span className="dashboard-summary-detail-item-label">{cat}</span>
                            <span className="dashboard-summary-detail-item-meta">
                              {items.length} {items.length === 1 ? 'movimiento' : 'movimientos'} - ver desglose
                            </span>
                          </div>
                          <div className="dashboard-summary-detail-item-trailing">
                            <span className="dashboard-summary-detail-item-amount expense">{fmt(total)}</span>
                            {share && <span className="dashboard-summary-detail-item-share expense">({share})</span>}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="dashboard-summary-detail-empty">No hay gastos en {monthReferenceText}.</p>
                )}
              </section>
            </div>
          ) : (
            <div className="dashboard-summary-detail-grid">
              {activeSummarySections.map((section) => (
                <section key={section.id} className="dashboard-summary-detail-section">
                  <div className="dashboard-summary-detail-section-head">
                    <span className="dashboard-summary-detail-section-title">{section.title}</span>
                    <strong className={`dashboard-summary-detail-section-total ${section.tone}`}>
                      {fmt(section.total)}
                    </strong>
                  </div>

                  {section.items.length ? (
                    <div className="dashboard-summary-detail-list">
                      {section.items.map((item) => {
                        const share = formatDetailShare(item.amount, section.total)
                        return (
                          <div key={item.id} className="dashboard-summary-detail-item">
                            <div className="dashboard-summary-detail-item-copy">
                              <span className="dashboard-summary-detail-item-label">{item.label}</span>
                              <span className="dashboard-summary-detail-item-meta">{item.meta}</span>
                            </div>
                            <div className="dashboard-summary-detail-item-trailing">
                              <span className={`dashboard-summary-detail-item-amount ${section.tone}`}>
                                {fmt(item.amount)}
                              </span>
                              {share && (
                                <span className={`dashboard-summary-detail-item-share ${section.tone}`}>
                                  ({share})
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="dashboard-summary-detail-empty">{section.emptyLabel}</p>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Barra de salud ── */}
      <Modal
        open={Boolean(activeExpenseCategory)}
        onClose={() => setSelectedExpenseCategory(null)}
        title={activeExpenseCategory ? `${activeExpenseCategory.cat} - ${selectedMonthLabel}` : 'Detalle por categoria'}
      >
        {activeExpenseCategory && (
          <>
            <div className="dashboard-category-modal-summary">
              <div className="dashboard-category-modal-summary-top">
                <span className="dashboard-category-modal-summary-label">Total de la categoria</span>
                <span className="dashboard-category-modal-summary-pill">
                  {activeExpenseCategory.items.length} {activeExpenseCategory.items.length === 1 ? 'mov.' : 'movs.'}
                </span>
              </div>
              <div className="dashboard-category-modal-summary-main">
                <strong className="dashboard-category-modal-summary-total expense">{fmt(activeExpenseCategory.total)}</strong>
              </div>
            </div>

            <div className="dashboard-category-modal-list">
              {activeExpenseCategory.items.map((item) => (
                <article key={item.id} className="dashboard-category-modal-item">
                  <div className="dashboard-category-modal-item-head">
                    <div className="dashboard-category-modal-item-copy">
                      <div className="dashboard-category-modal-item-topline">
                        <span className="dashboard-category-modal-item-label">{item.label}</span>
                        <strong className="dashboard-category-modal-item-amount expense">{fmt(item.amount)}</strong>
                      </div>
                      <div className="dashboard-category-modal-item-meta-row">
                        <span className={`dashboard-category-modal-item-badge is-${item.kind}`}>{item.kindLabel}</span>
                        {item.meta ? <span className="dashboard-category-modal-item-meta">{item.meta}</span> : null}
                        {item.meta && item.date ? <span className="dashboard-category-modal-item-divider">•</span> : null}
                        {item.date ? <span className="dashboard-category-modal-item-date">{item.date}</span> : null}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </Modal>

      {totalIng > 0 && (
        <div className="dashboard-health-card">
          <div className="dashboard-health-header">
            <span className="dashboard-health-label">Gastos vs ingresos</span>
            <span className="dashboard-health-pct" style={{ color: barColor }}>{gastoPct}%</span>
          </div>
          <div className="dashboard-health-track">
            <div className="dashboard-health-fill" style={{ width: `${gastoPct}%`, background: barColor }} />
          </div>
          <div className="dashboard-health-hint">
            {gastoPct >= 90 ? 'Atención: casi sin margen' : gastoPct >= 75 ? 'Cuidado: margen estrecho' : gastoPct >= 50 ? 'Moderado: hay espacio' : 'Saludable: buen colchón'}
          </div>
        </div>
      )}

      <div ref={projectionChartAnchorRef} aria-hidden="true" />
      {advancedProjectionEnabled ? (        <div className="card dashboard-chart-card dashboard-premium-card">

          {/* ── Header ── */}
          <div className="card-header dashboard-card-header-compact">
            <div className="dashboard-card-copy">
              <h2 className="card-title">Proyeccion mensual</h2>
            </div>
            <span className="dashboard-premium-badge">Pro</span>
          </div>

          {/* ── 1. Stats clave — se muestran con datos anteriores mientras recalcula ── */}
          {advancedProjection && !projectionError && !advancedChartEmpty && (() => {
            const projectedGap = latestProjectedPoint?.gapAcumulado ?? 0
            const projectedGapLabel = latestProjectedPoint?.label ?? 'fin del horizonte'
            const variableHistoryMonths = advancedProjection?.variable_history_months_used ?? 0
            const variableHistoryObservations = advancedProjection?.variable_history_observations ?? 0
            const variableHistoryCap = advancedProjection?.variable_history_cap_months ?? 18
            const punctualReserve = advancedProjection?.smoothed_variable_gastos ?? 0
            const variableMonthlyEstimate = advancedProjection?.variable_monthly_estimate ?? 0
            const punctualTotal = advancedProjection?.conservative_punctual_total ?? 0
            const punctualHistoryMonths = advancedProjection?.conservative_punctual_history_months ?? 12
            const isSimpleMode = projectionMode === 'simple'
            const isConservativeMode = projectionMode === 'conservadora'
            return (
              <div className="dashboard-premium-meta">
                <div className="dashboard-premium-stat">
                  <span className="dashboard-premium-stat-label">Si sigues asi, terminarias con</span>
                  <strong className="dashboard-premium-stat-value" style={{ color: projectedGap >= 0 ? 'var(--app-lila)' : 'var(--app-danger)' }}>
                    {fmt(projectedGap)}
                  </strong>
                  <span className="dashboard-chart-note">Saldo estimado al cierre de {projectedGapLabel}</span>
                </div>
                <div className="dashboard-premium-stat">
                  <span className="dashboard-premium-stat-label">Hoy partes con</span>
                  <strong className="dashboard-premium-stat-value">{fmt(advancedProjection?.starting_balance ?? 0)}</strong>
                  <span className="dashboard-chart-note">Saldo con el que arranca esta proyeccion</span>
                </div>
                <div className="dashboard-premium-stat">
                  <span className="dashboard-premium-stat-label">Calculo de variables</span>
                  <strong className="dashboard-premium-stat-value">{isSimpleMode ? 'Estimado' : 'Ponderado'}</strong>
                  <span className="dashboard-chart-note">
                    {isSimpleMode ? 'Usa los montos que registraste' : 'El ultimo ano tiene peso doble'}
                  </span>
                </div>
                <div className="dashboard-premium-stat">
                  <span className="dashboard-premium-stat-label">Historial variable</span>
                  <strong className="dashboard-premium-stat-value">
                    {isSimpleMode ? 'No aplica' : `${variableHistoryObservations} ${variableHistoryObservations === 1 ? 'registro' : 'registros'}`}
                  </strong>
                  <span className="dashboard-chart-note">
                    {isSimpleMode
                      ? 'Simple no ajusta montos con el historial'
                      : variableHistoryObservations > 0
                        ? `${variableHistoryMonths} ${variableHistoryMonths === 1 ? 'mes con datos' : 'meses con datos'} de hasta ${variableHistoryCap}`
                        : 'Usa estimados hasta que registres valores reales'}
                  </span>
                </div>
                <div className="dashboard-premium-stat">
                  <span className="dashboard-premium-stat-label">
                    {isConservativeMode ? 'Reserva por puntuales' : 'Gastos variables / mes'}
                  </span>
                  <strong className="dashboard-premium-stat-value" style={{ color: isConservativeMode ? 'var(--app-danger)' : 'var(--app-danger)' }}>
                    {isConservativeMode ? fmt(punctualReserve) : fmt(variableMonthlyEstimate)}
                  </strong>
                  <span className="dashboard-chart-note">
                    {isConservativeMode
                      ? `${fmt(punctualTotal)} seleccionados / ${punctualHistoryMonths} meses`
                      : isSimpleMode
                        ? 'Con tus estimados registrados'
                        : 'Estimado del historial (ponderado)'}
                  </span>
                </div>
              </div>
            )
          })()}
          {/* ── 2. Controles ── */}
          <div className="dashboard-chart-toolbar">
            <div className="dashboard-chart-toolbar-primary">
              <label className="dashboard-chart-control">
                <span>Modo</span>
                <select
                  className="dashboard-chart-select"
                  value={projectionMode}
                  onChange={(e) => void handleProjectionModeChange(e.target.value)}
                  disabled={projectionModeSaving || projectionLoading}
                >
                  {PROJECTION_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <div className="dashboard-chart-toolbar-actions">
                <button
                  type="button"
                  className="dashboard-chart-icon-button"
                  onClick={handleManualRefresh}
                  disabled={loading || refreshing || projectionLoading}
                  aria-label={projectionLoading ? 'Actualizando proyeccion' : 'Actualizar proyeccion'}
                  title={projectionLoading ? 'Actualizando proyeccion' : 'Actualizar proyeccion'}
                >
                  <RefreshCw size={17} className={projectionLoading ? 'is-spinning' : ''} />
                </button>
                <button
                  type="button"
                  className="dashboard-chart-icon-button dashboard-chart-view-all"
                  onClick={() => setShowFullChart(true)}
                  aria-label="Ampliar proyeccion"
                  title="Ampliar proyeccion"
                >
                  <Maximize2 size={17} />
                </button>
              </div>
            </div>

            <button
              type="button"
              className="dashboard-chart-period-trigger"
              onClick={() => setShowProjectionPeriod((current) => !current)}
              aria-expanded={showProjectionPeriod}
              aria-controls="dashboard-projection-period"
            >
              <span>Ajustar periodo</span>
              <span className="dashboard-chart-period-summary">
                {pastMonths} meses / {futureMonths === 12 ? '1 año' : `${futureMonths / 12} años`}
                <ChevronDown size={16} className={showProjectionPeriod ? 'is-open' : ''} />
              </span>
            </button>

            <div className="dashboard-chart-options-row">
              <div
                id="dashboard-projection-period"
                className={`dashboard-chart-period-controls ${showProjectionPeriod ? 'is-open' : ''}`}
              >
                <label className="dashboard-chart-control">
                  <span>Historia</span>
                  <select
                    className="dashboard-chart-select"
                    value={pastMonths}
                    onChange={(e) => {
                      const val = Number(e.target.value)
                      preserveScroll(() => setPastMonths(val))
                      clearTimeout(projectionDebounceRef.current)
                      projectionDebounceRef.current = setTimeout(() => loadProjectionChart(futureMonths, val), 300)
                    }}
                  >
                    <option value={3}>3 meses</option>
                    <option value={6}>6 meses</option>
                    <option value={12}>12 meses</option>
                    <option value={24}>24 meses</option>
                  </select>
                </label>
                <label className="dashboard-chart-control">
                  <span>Horizonte</span>
                  <select
                    className="dashboard-chart-select"
                    value={futureMonths}
                    onChange={(e) => {
                      const val = Number(e.target.value)
                      preserveScroll(() => setFutureMonths(val))
                      clearTimeout(projectionDebounceRef.current)
                      projectionDebounceRef.current = setTimeout(() => loadProjectionChart(val, pastMonths), 300)
                    }}
                  >
                    <option value={12}>1 año</option>
                    <option value={24}>2 años</option>
                    <option value={60}>5 años</option>
                    {availableFutureProjectionOptions.some((option) => option.value === 120) && (
                      <option value={120}>10 años</option>
                    )}
                  </select>
                </label>
              </div>

              <div className="dashboard-chart-toggle-group dashboard-chart-series-control" role="tablist" aria-label="Curvas de la proyeccion">
                {SERIES_FOCUS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`dashboard-chart-toggle ${seriesFocus === option.value ? 'active' : ''}`}
                    onClick={() => setSeriesFocus(option.value)}
                    aria-pressed={seriesFocus === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* ── 3. Nota de analisis ── */}
          <p className="dashboard-chart-note" style={{ marginTop: 10 }}>
            {getProjectionAnalysisHelp(
              projectionMode,
              advancedProjection?.variable_history_months_used ?? 0,
              advancedProjection?.variable_history_observations ?? 0,
            )}
          </p>
          {/* ── 4. Chart ── */}
          {projectionError ? (
            <div className="empty-state">
              <p className="empty-text">No pudimos cargar la proyeccion</p>
              <p className="empty-sub">{projectionError}</p>
            </div>
          ) : advancedChartEmpty && !projectionLoading ? (
            <div className="empty-state">
              <p className="empty-text">Aun no hay base suficiente</p>
              <p className="empty-sub">Cuando registres movimientos, aqui veras tus ingresos y gastos mensuales proyectados.</p>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              {projectionLoading && chartSeries.length === 0 && (
                <div className="loading-screen" style={{ minHeight: '280px' }}>
                  <div className="spinner" />
                </div>
              )}
              {projectionLoading && chartSeries.length > 0 && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,22,41,0.55)', borderRadius: 16, zIndex: 10 }}>
                  <div className="spinner" />
                </div>
              )}
              {chartSeries.length > 0 && renderProjectionAreaChart({ interactive: showProjectionNavigator && !projectionLoading })}
            </div>
          )}
        </div>
      ) : (
        <div className="card dashboard-chart-card dashboard-free-card">
          <div className="dashboard-premium-lock-head">
            <div className="dashboard-card-copy">
              <h2 className="card-title">Proyeccion mensual</h2>
              <p className="dashboard-card-subtitle">
                Vista simple con {freeProjectionPastMonths} meses reales y {freeProjectionFutureMonths} proyectados.
              </p>
            </div>
            <span className="dashboard-free-badge">Gratis</span>
          </div>

          <p className="dashboard-premium-lock-text">
            Tu plan gratuito muestra una lectura corta y directa de lo que entra y sale por mes, sin controles avanzados.
          </p>

          <div className="dashboard-premium-chip-row">
            <span className="dashboard-premium-chip">Modo simple</span>
            <span className="dashboard-premium-chip">{freeProjectionPastMonths} meses reales</span>
            <span className="dashboard-premium-chip">{freeProjectionFutureMonths} proyectados</span>
          </div>

          {projectionLoading ? (
            <div className="loading-screen" style={{ minHeight: '220px' }}>
              <div className="spinner" />
            </div>
          ) : projectionError ? (
            <div className="empty-state">
              <p className="empty-text">No pudimos cargar la proyeccion</p>
              <p className="empty-sub">{projectionError}</p>
            </div>
          ) : advancedChartEmpty ? (
            <div className="empty-state">
              <p className="empty-text">Aun no hay base suficiente</p>
              <p className="empty-sub">Cuando registres movimientos, aqui veras tus ultimos meses y una proyeccion corta.</p>
            </div>
          ) : (
            renderProjectionAreaChart()
          )}
        </div>
      )}
    </div>
  )
}
