import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import { TrendingUp, TrendingDown, Wallet, PiggyBank, RefreshCw, ChevronDown, ChevronLeft, ChevronRight, X, LayoutList, Tag } from 'lucide-react'

import api from '../../api/client'
import { getApiErrorMessage } from '../../api/errors'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import { useAuth } from '../../context/useAuth'
import { formatMoney } from '../../utils/formatters'
import '../../components/ui/app.css'

const MESES_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const FREQ = {
  diario: 30,
  semanal: 4.33,
  quincenal: 2,
  mensual: 1,
  bimestral: 0.5,
  trimestral: 0.333,
  semestral: 0.167,
  anual: 0.083,
}
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
  { value: 'automatica', label: 'Automatica' },
  { value: 'simple', label: 'Simple' },
  { value: 'personalizada', label: 'Personalizada' },
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


function getProjectionAnalysisHelp(mode, analysisMonths, analysisCapMonths) {
  const historyText = analysisMonths > 0
    ? (analysisMonths < analysisCapMonths
        ? `La proyeccion analiza ${analysisMonths} meses porque es la historia disponible.`
        : `La proyeccion analiza hasta ${analysisCapMonths} meses de historial disponible.`)
    : 'Aun no hay historial suficiente para analizar ingresos y gastos puntuales.'

  if (mode === 'simple') return `${historyText} Simple toma todos tus ingresos y gastos puntuales con una lectura directa.`
  if (mode === 'personalizada') return `${historyText} Personalizada solo toma los ingresos y gastos puntuales que marques.`
  return `${historyText} Automatica amortigua picos con esa historia.`
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
  return `${new Intl.NumberFormat('es-EC', { maximumFractionDigits: 1 }).format(percentage)}%`
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
  const [advancedProjection, setAdvancedProjection] = useState(null)
  const [projectionLoading, setProjectionLoading] = useState(false)
  const [projectionError, setProjectionError] = useState('')
  const [projectionMode, setProjectionMode] = useState('simple')
  const [projectionModeSaving, setProjectionModeSaving] = useState(false)
  const [pastMonths, setPastMonths] = useState(6)
  const [futureMonths, setFutureMonths] = useState(12)
  const [seriesFocus, setSeriesFocus] = useState('all')
  const [activeSummaryDetail, setActiveSummaryDetail] = useState(null)
  const [detailSort, setDetailSort] = useState('amount-desc')
  const [showCategoryView, setShowCategoryView] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()))
  const [isCompactProjectionChart, setIsCompactProjectionChart] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < MOBILE_CHART_BREAKPOINT,
  )
  const [projectionChartDragging, setProjectionChartDragging] = useState(false)
  const [projectionWindow, setProjectionWindow] = useState({ startIndex: 0, endIndex: 0 })
  const [showFullChart, setShowFullChart] = useState(false)
  const projectionDebounceRef = useRef(null)
  const projectionRequestIdRef = useRef(0)
  const loadProjectionChartRef = useRef(null)
  const projectionGestureRef = useRef(null)

  const advancedProjectionEnabled = Boolean(user?.feature_access?.advanced_projection_enabled)
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

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setProjectionError('')

    try {
      const { data: resumen } = await api.get('/finanzas/dashboard/')

      setData({
        ingresos: resumen.ingresos || [],
        ingresosPuntuales: resumen.ingresos_puntuales || [],
        gastosCorrientes: resumen.gastos_corrientes || [],
        gastosNoCorrientes: resumen.gastos_no_corrientes || [],
        diferidos: resumen.diferidos || [],
      })
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

    await loadProjectionChartRef.current()
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  function handleManualRefresh() {
    if (advancedProjectionEnabled) {
      void loadProjectionChart(futureMonths, pastMonths, { forceRecalculate: true })
      return
    }
    void loadDashboard({ silent: true })
  }

  function toggleSummaryDetail(kind) {
    setActiveSummaryDetail((current) => (current === kind ? null : kind))
    setShowCategoryView(false)
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
  const mensualizado = (monto, freq) => Number(monto) * (FREQ[freq] || 1)
  const realMonth = useMemo(() => startOfMonth(new Date()), [])

  const dashboardMonthBounds = useMemo(() => {
    const minCandidates = [realMonth]
    const maxCandidates = [realMonth, addMonths(realMonth, DASHBOARD_FUTURE_MONTHS)]

    data.ingresos.forEach((item) => {
      if (item.fecha_inicio) minCandidates.push(startOfMonth(parseLocalDate(item.fecha_inicio)))
      if (item.fecha_fin) maxCandidates.push(startOfMonth(parseLocalDate(item.fecha_fin)))
      else maxCandidates.push(addMonths(realMonth, DASHBOARD_FUTURE_MONTHS))
    })

    data.gastosCorrientes.forEach((item) => {
      if (item.fecha_inicio) minCandidates.push(startOfMonth(parseLocalDate(item.fecha_inicio)))
      if (item.fecha_fin) maxCandidates.push(startOfMonth(parseLocalDate(item.fecha_fin)))
      else maxCandidates.push(addMonths(realMonth, DASHBOARD_FUTURE_MONTHS))
    })

    data.diferidos.forEach((item) => {
      if (item.fecha_inicio) minCandidates.push(startOfMonth(parseLocalDate(item.fecha_inicio)))
      if (item.fecha_fin) maxCandidates.push(startOfMonth(parseLocalDate(item.fecha_fin)))
      else maxCandidates.push(addMonths(realMonth, DASHBOARD_FUTURE_MONTHS))
    })

    data.ingresosPuntuales.forEach((item) => {
      if (item.fecha) {
        const monthDate = startOfMonth(parseLocalDate(item.fecha))
        minCandidates.push(monthDate)
        maxCandidates.push(monthDate)
      }
    })

    data.gastosNoCorrientes.forEach((item) => {
      if (item.fecha) {
        const monthDate = startOfMonth(parseLocalDate(item.fecha))
        minCandidates.push(monthDate)
        maxCandidates.push(monthDate)
      }
    })

    const minMonth = minCandidates.reduce((earliest, date) => (date < earliest ? date : earliest), minCandidates[0])
    const maxMonth = maxCandidates.reduce((latest, date) => (date > latest ? date : latest), maxCandidates[0])

    return { minMonth, maxMonth }
  }, [data, realMonth])

  useEffect(() => {
    setSelectedMonth((current) => {
      if (current < dashboardMonthBounds.minMonth) return dashboardMonthBounds.minMonth
      if (current > dashboardMonthBounds.maxMonth) return dashboardMonthBounds.maxMonth
      return current
    })
  }, [dashboardMonthBounds])

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
    () => data.gastosCorrientes.filter((item) => overlapsMonth(item, selectedMonth)),
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
    .reduce((sum, item) => sum + mensualizado(item.monto, item.frecuencia), 0)
  const totalIngPuntuales = punctualIncomesThisMonth
    .reduce((sum, item) => sum + Number(item.monto), 0)
  const totalIng = totalIngFijos + totalIngPuntuales

  const totalGC = fixedExpensesThisMonth
    .reduce((sum, item) => sum + mensualizado(item.monto, item.frecuencia), 0)
  const totalGNC = punctualExpensesThisMonth
    .reduce((sum, item) => sum + Number(item.monto), 0)
  const totalDif = installmentsThisMonth
    .reduce((sum, item) => sum + Number(item.cuota_mensual), 0)
  const totalGastos = totalGC + totalGNC + totalDif
  const balance = totalIng - totalGastos

  function applySortDetail(items) {
    return [...items].sort((a, b) => {
      if (detailSort === 'amount-asc') return a.amount - b.amount
      if (detailSort === 'date-desc') return (b.date || '').localeCompare(a.date || '')
      if (detailSort === 'date-asc') return (a.date || '').localeCompare(b.date || '')
      return b.amount - a.amount
    })
  }

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
        amount: mensualizado(item.monto, item.frecuencia),
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
      total: totalGC,
      emptyLabel: `No tienes gastos fijos activos en ${monthReferenceText}.`,
      items: applySortDetail(fixedExpensesThisMonth.map((item) => ({
        id: `expense-fixed-${item.id}`,
        label: item.descripcion,
        meta: `${item.categoria || 'Sin categoria'} - ${getFrequencyLabel(item.frecuencia)}`,
        amount: mensualizado(item.monto, item.frecuencia),
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
        amount: Number(item.cuota_mensual),
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

  const expenseCategoryMap = useMemo(() => {
    const map = {}
    fixedExpensesThisMonth.forEach((item) => {
      const cat = item.categoria || 'Sin categoria'
      map[cat] = (map[cat] || 0) + mensualizado(item.monto, item.frecuencia)
    })
    punctualExpensesThisMonth.forEach((item) => {
      const cat = item.categoria || 'Sin categoria'
      map[cat] = (map[cat] || 0) + Number(item.monto)
    })
    installmentsThisMonth.forEach((item) => {
      const cat = item.categoria || 'Sin categoria'
      map[cat] = (map[cat] || 0) + Number(item.cuota_mensual)
    })
    return Object.entries(map)
      .map(([cat, total]) => ({ cat, total }))
      .sort((a, b) => b.total - a.total)
  }, [fixedExpensesThisMonth, punctualExpensesThisMonth, installmentsThisMonth])

  const activeSummarySections = activeSummaryDetail === 'income' ? incomeDetailSections : expenseDetailSections
  const activeSummaryTitle = activeSummaryDetail === 'income'
    ? `Detalle de ingresos de ${selectedMonthLabel}`
    : `Detalle de gastos de ${selectedMonthLabel}`
  const activeSummarySubtitle = activeSummaryDetail === 'income'
    ? `Aqui ves rapido los ingresos guardados que cuentan en ${monthReferenceText}.`
    : `Aqui ves rapido los gastos guardados que cuentan en ${monthReferenceText}.`


  const hasAnyMovement = data.ingresos.length > 0
    || data.ingresosPuntuales.length > 0
    || data.gastosCorrientes.length > 0
    || data.gastosNoCorrientes.length > 0
    || data.diferidos.length > 0

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

  function resetProjectionGesture() {
    projectionGestureRef.current = null
    setProjectionChartDragging(false)
  }

  function handleProjectionPointerDown(event) {
    if (!showProjectionNavigator) return
    if (event.pointerType === 'mouse' && event.button !== 0) return

    projectionGestureRef.current = {
      startX: event.clientX,
      startIndex: projectionWindow.startIndex,
      width: event.currentTarget.getBoundingClientRect().width,
      moved: false,
    }
    setProjectionChartDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function handleProjectionPointerMove(event) {
    const gesture = projectionGestureRef.current
    if (!gesture || !showProjectionNavigator) return

    const deltaX = event.clientX - gesture.startX
    if (Math.abs(deltaX) < 12) return

    gesture.moved = true
    const pixelPerMonth = Math.max(24, gesture.width / Math.max(1, projectionWindowSize))
    const monthOffset = Math.round((-deltaX) / pixelPerMonth)
    const nextStartIndex = gesture.startIndex + monthOffset
    setProjectionWindow(clampProjectionWindow(nextStartIndex, chartSeries.length, projectionWindowSize))
  }

  function handleProjectionPointerUp(event) {
    const gesture = projectionGestureRef.current
    if (gesture && !gesture.moved && showProjectionNavigator && event.pointerType === 'touch') {
      const tapX = event.clientX - event.currentTarget.getBoundingClientRect().left
      const tapZone = tapX / gesture.width
      if (tapZone < 0.3) slideProjectionPage(-1)
      else if (tapZone > 0.7) slideProjectionPage(1)
    }
    resetProjectionGesture()
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
                ing_real: 'Total de ingresos del mes (real)',
                ing_proj: 'Total de ingresos del mes (proyectado)',
                gasto_real: 'Total de gastos del mes (real)',
                gasto_proj: 'Total de gastos del mes (proyectado)',
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
      <div style={{ background: 'rgba(26,37,64,0.97)', border: '1px solid rgba(196,135,246,0.2)', borderRadius: 12, padding: '10px 12px' }}>
        <div style={{ color: '#FFFFFF', marginBottom: 6, fontWeight: 700 }}>
          {`${label} - ${point.is_real ? 'Real' : 'Proyectado'}`}
        </div>
        {advancedProjectionEnabled && point.gapAcumulado != null && (
          <div style={{ color: '#C487F6', fontWeight: 700, marginBottom: 4 }}>
            {`Saldo disponible: ${fmt(point.gapAcumulado)}`}
          </div>
        )}
        <div style={{ color: '#10B981' }}>{`Ingresos del mes: ${fmt(ingDisponible)}`}</div>
        <div style={{ color: '#F87171' }}>{`Gastos del mes: ${fmt(gastoDisplay)}`}</div>
        {advancedProjectionEnabled && point.opening != null && (
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 4 }}>
            {`Saldo anterior: ${fmt(point.opening)} + ingresos: ${fmt(point.ingMes)}`}
          </div>
        )}
      </div>
    )
  }

  const advancedChartEmpty = advancedSeries.length === 0 || advancedSeries.every(
    (point) => point.monthly_ingresos === 0 && point.monthly_gastos === 0,
  )

  function renderProjectionAreaChart({ interactive = false } = {}) {
    const chart = (
      <ResponsiveContainer width="100%" height={isCompactProjectionChart ? 320 : 360}>
        <AreaChart data={visibleProjectionSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gIngReal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gIngProj" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10B981" stopOpacity={0.10} />
              <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gGastoReal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F87171" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#F87171" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gGastoProj" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F87171" stopOpacity={0.10} />
              <stop offset="95%" stopColor="#F87171" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="label" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} />
          <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} tickFormatter={fmtAxis} width={82} />
          {visibleCurrentMonthLabel && (
            <ReferenceLine
              x={visibleCurrentMonthLabel}
              stroke="rgba(255,255,255,0.25)"
              strokeDasharray="4 4"
              label={{ value: 'Hoy', position: 'insideTopRight', fill: 'rgba(255,255,255,0.40)', fontSize: 11 }}
            />
          )}
          <ReferenceLine y={0} stroke="rgba(248,113,113,0.35)" strokeDasharray="4 3" />
          <Tooltip
            content={renderProjectionTooltip}
            contentStyle={{ background: 'rgba(26,37,64,0.97)', border: '1px solid rgba(196,135,246,0.2)', borderRadius: 12 }}
            labelStyle={{ color: '#FFFFFF', marginBottom: 6, fontWeight: 700 }}
            itemSorter={(item) => ({
              ing_real: 0,
              ing_proj: 1,
              gasto_real: 2,
              gasto_proj: 3,
            }[item?.dataKey] ?? 99)}
            formatter={(value, name) => {
              if (value == null) return null
              const labels = {
                ing_real: 'Total de ingresos del mes (real)',
                ing_proj: 'Total de ingresos del mes (proyectado)',
                gasto_real: 'Total de gastos del mes (real)',
                gasto_proj: 'Total de gastos del mes (proyectado)',
              }
              return [fmt(value), labels[name] || name]
            }}
            labelFormatter={(label, payload) => {
              const point = payload?.[0]?.payload
              return point ? `${label} - ${point.is_real ? 'Real' : 'Proyectado'}` : label
            }}
          />
          {!isCompactProjectionChart && <Legend content={renderProjectionLegend} />}
          {shouldShowSeries('income') && (
            <>
              <Area connectNulls={false} type="monotone" dataKey="ing_real" stroke="#10B981" strokeWidth={2.5} fill="url(#gIngReal)" dot={false} />
              <Area connectNulls={false} type="monotone" dataKey="ing_proj" stroke="#10B981" strokeWidth={2} fill="url(#gIngProj)" strokeDasharray="5 4" dot={false} />
            </>
          )}
          {shouldShowSeries('expense') && (
            <>
              <Area connectNulls={false} type="monotone" dataKey="gasto_real" stroke="#F87171" strokeWidth={2.5} fill="url(#gGastoReal)" dot={false} />
              <Area connectNulls={false} type="monotone" dataKey="gasto_proj" stroke="#F87171" strokeWidth={2} fill="url(#gGastoProj)" strokeDasharray="5 4" dot={false} />
            </>
          )}
        </AreaChart>
      </ResponsiveContainer>
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
      <ResponsiveContainer width="100%" height={420}>
        <AreaChart data={chartSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gIngRealF" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gIngProjF" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10B981" stopOpacity={0.10} />
              <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gGastoRealF" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F87171" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#F87171" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gGastoProjF" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F87171" stopOpacity={0.10} />
              <stop offset="95%" stopColor="#F87171" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="label" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} tickFormatter={fmtAxis} width={82} />
          {currentMonthKey && (
            <ReferenceLine
              x={chartSeries.find(p => p.month === currentMonthKey)?.label}
              stroke="rgba(255,255,255,0.25)"
              strokeDasharray="4 4"
              label={{ value: 'Hoy', position: 'insideTopRight', fill: 'rgba(255,255,255,0.40)', fontSize: 11 }}
            />
          )}
          <ReferenceLine y={0} stroke="rgba(248,113,113,0.35)" strokeDasharray="4 3" />
          <Tooltip
            content={renderProjectionTooltip}
            contentStyle={{ background: 'rgba(26,37,64,0.97)', border: '1px solid rgba(196,135,246,0.2)', borderRadius: 12 }}
            labelStyle={{ color: '#FFFFFF', marginBottom: 6, fontWeight: 700 }}
          />
          <Legend content={renderProjectionLegend} />
          {shouldShowSeries('income') && (
            <>
              <Area connectNulls={false} type="monotone" dataKey="ing_real" stroke="#10B981" strokeWidth={2} fill="url(#gIngRealF)" dot={false} />
              <Area connectNulls={false} type="monotone" dataKey="ing_proj" stroke="#10B981" strokeWidth={1.5} fill="url(#gIngProjF)" strokeDasharray="5 4" dot={false} />
            </>
          )}
          {shouldShowSeries('expense') && (
            <>
              <Area connectNulls={false} type="monotone" dataKey="gasto_real" stroke="#F87171" strokeWidth={2} fill="url(#gGastoRealF)" dot={false} />
              <Area connectNulls={false} type="monotone" dataKey="gasto_proj" stroke="#F87171" strokeWidth={1.5} fill="url(#gGastoProjF)" strokeDasharray="5 4" dot={false} />
            </>
          )}
        </AreaChart>
      </ResponsiveContainer>
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
        <div
          className={`dashboard-chart-gesture-surface ${projectionChartDragging ? 'is-dragging' : ''}`}
          tabIndex={-1}
          onPointerDown={handleProjectionPointerDown}
          onPointerMove={handleProjectionPointerMove}
          onPointerUp={handleProjectionPointerUp}
          onPointerCancel={resetProjectionGesture}
          onLostPointerCapture={resetProjectionGesture}
        >
          {chart}
        </div>
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
  const barColor = gastoPct >= 90 ? '#F87171' : gastoPct >= 75 ? '#FB923C' : gastoPct >= 50 ? '#FBBF24' : '#10B981'
  const tasaColor = tasaAhorro >= 20 ? '#10B981' : tasaAhorro >= 0 ? '#FBBF24' : '#F87171'

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
            <TrendingUp size={16} style={{ color: '#10B981' }} />
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
            <TrendingDown size={16} style={{ color: '#F87171' }} />
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
            <Wallet size={16} style={{ color: balance >= 0 ? '#10B981' : '#F87171' }} />
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
              onClick={() => setActiveSummaryDetail(null)}
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
                onClick={() => setShowCategoryView((v) => !v)}
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
                {expenseCategoryMap.length ? (
                  <div className="dashboard-summary-detail-list">
                    {expenseCategoryMap.map(({ cat, total }) => {
                      const share = formatDetailShare(total, totalGastos)
                      return (
                        <div key={cat} className="dashboard-summary-detail-item">
                          <div className="dashboard-summary-detail-item-copy">
                            <span className="dashboard-summary-detail-item-label">{cat}</span>
                          </div>
                          <div className="dashboard-summary-detail-item-trailing">
                            <span className="dashboard-summary-detail-item-amount expense">{fmt(total)}</span>
                            {share && <span className="dashboard-summary-detail-item-share expense">({share})</span>}
                          </div>
                        </div>
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

      {advancedProjectionEnabled ? (
        <div className="card dashboard-chart-card dashboard-premium-card">

          {/* ── Header ── */}
          <div className="card-header dashboard-card-header-compact">
            <div className="dashboard-card-copy">
              <h2 className="card-title">Proyeccion mensual</h2>
            </div>
            <span className="dashboard-premium-badge">Pro</span>
          </div>

          {/* ── 1. Stats clave — se muestran con datos anteriores mientras recalcula ── */}
          {advancedProjection && !projectionError && !advancedChartEmpty && (() => {
            const histMeses = advancedProjection?.history_months_used ?? 0
            const svi = advancedProjection?.smoothed_variable_ingresos ?? 0
            const svg = advancedProjection?.smoothed_variable_gastos ?? 0
            const projectedGap = latestProjectedPoint?.gapAcumulado ?? 0
            const projectedGapLabel = latestProjectedPoint?.label ?? 'fin del horizonte'
            const variableProjectionApplied = advancedProjection?.variable_projection_applied ?? true
            const minVariableHistoryMonths = advancedProjection?.min_variable_history_months ?? 3
            const analysisHistoryMonths = advancedProjection?.analysis_history_months ?? 0
            return (
              <div className="dashboard-premium-meta">
                <div className="dashboard-premium-stat">
                  <span className="dashboard-premium-stat-label">Si sigues asi, terminarias con</span>
                  <strong className="dashboard-premium-stat-value" style={{ color: projectedGap >= 0 ? '#C487F6' : '#F87171' }}>
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
                  <span className="dashboard-premium-stat-label">Promedio de ingresos puntuales</span>
                  <strong className="dashboard-premium-stat-value" style={{ color: '#10B981' }}>{fmt(svi)}</strong>
                </div>
                <div className="dashboard-premium-stat">
                  <span className="dashboard-premium-stat-label">Promedio de gastos puntuales</span>
                  <strong className="dashboard-premium-stat-value" style={{ color: '#F87171' }}>{fmt(svg)}</strong>
                </div>
                <div className="dashboard-premium-stat">
                  <span className="dashboard-premium-stat-label">Calculado usando</span>
                  <strong className="dashboard-premium-stat-value">
                    {histMeses} {histMeses === 1 ? 'mes con puntuales' : 'meses con puntuales'}
                  </strong>
                  <span className="dashboard-chart-note">
                    {variableProjectionApplied
                      ? `Proyeccion basada en ${analysisHistoryMonths} meses de historia`
                      : `Necesitas al menos ${minVariableHistoryMonths} meses con puntuales`}
                  </span>
                </div>
              </div>
            )
          })()}

          {/* ── 2. Controles ── */}
          <div className="dashboard-chart-toolbar">
            {/* Fila 1: selectores */}
            <div className="dashboard-chart-toolbar-row">
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
            {/* Fila 2: toggles + recalcular + ver todo (desktop) */}
            <div className="dashboard-chart-toolbar-row">
              <div className="dashboard-chart-toggle-group" role="tablist" aria-label="Curvas de la proyeccion">
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
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={handleManualRefresh}
                disabled={loading || refreshing || projectionLoading}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 13px', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                <RefreshCw size={14} style={{ opacity: refreshing || projectionLoading ? 0.7 : 1 }} />
                {projectionLoading ? 'Recalculando...' : 'Recalcular'}
              </button>
              <button type="button" className="dashboard-chart-view-all" onClick={() => setShowFullChart(true)}>
                Ver todo
              </button>
            </div>
          </div>

          {/* ── 3. Nota de analisis ── */}
          <p className="dashboard-chart-note" style={{ marginTop: 10 }}>
            {getProjectionAnalysisHelp(
              projectionMode,
              advancedProjection?.analysis_history_months ?? 0,
              advancedProjection?.analysis_history_cap_months ?? 18,
            )}
          </p>
          {advancedProjection && !projectionError && !advancedChartEmpty && (() => {
            const histMesesAviso = advancedProjection?.history_months_used ?? 0
            const variableProjectionApplied = advancedProjection?.variable_projection_applied ?? true
            const minVariableHistoryMonths = advancedProjection?.min_variable_history_months ?? 3
            const analysisHistoryMonths = advancedProjection?.analysis_history_months ?? 0
            if (!variableProjectionApplied) return (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 12, padding: '10px 14px', marginTop: 8 }}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>!</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#FBBF24', marginBottom: 2 }}>La base fija ya esta proyectada</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                    {histMesesAviso === 0
                      ? `Tus ingresos, gastos fijos y cuotas ya estan incluidos. Los puntuales aun no entran porque necesitas ${minVariableHistoryMonths} meses con ingresos o gastos puntuales dentro de la historia analizada (${analysisHistoryMonths} meses disponibles hoy).`
                      : `Tus ingresos, gastos fijos y cuotas ya estan incluidos. Los puntuales aun no entran porque solo hay ${histMesesAviso} ${histMesesAviso === 1 ? 'mes' : 'meses'} con ingresos o gastos puntuales dentro de la historia analizada (${analysisHistoryMonths} meses disponibles hoy); necesitas ${minVariableHistoryMonths}.`}
                  </div>
                </div>
              </div>
            )
            return null
          })()}

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
