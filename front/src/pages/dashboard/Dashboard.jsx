import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import { TrendingUp, TrendingDown, Wallet, Lock, PiggyBank, RefreshCw } from 'lucide-react'

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

function getProjectionModeHelp(mode) {
  if (mode === 'simple') return 'Simple: usa una lectura directa de tus extras.'
  if (mode === 'personalizada') return 'Personalizada: usa solo los extras que marques.'
  return 'Automatica: amortigua picos y aprende de tus extras.'
}

function getProjectionAnalysisHelp(mode, analysisMonths, analysisCapMonths) {
  const historyText = analysisMonths > 0
    ? (analysisMonths < analysisCapMonths
        ? `La proyeccion analiza ${analysisMonths} meses porque es la historia disponible.`
        : `La proyeccion analiza hasta ${analysisCapMonths} meses de historial disponible.`)
    : 'Aun no hay historial suficiente para analizar extras.'

  if (mode === 'simple') return `${historyText} Simple toma todos tus extras con una lectura directa.`
  if (mode === 'personalizada') return `${historyText} Personalizada solo toma los extras que marques.`
  return `${historyText} Automatica amortigua picos con esa historia.`
}

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
  const projectionDebounceRef = useRef(null)
  const projectionRequestIdRef = useRef(0)

  const advancedProjectionEnabled = Boolean(user?.feature_access?.advanced_projection_enabled)
  const advancedProjectionMaxMonths = normalizePositiveInt(user?.feature_access?.advanced_projection_months, 60)
  const currentPlanLabel = user?.plan?.slug === 'pro' ? 'Pro' : 'Free'
  const currentPlanBadgeClass = user?.plan?.slug === 'pro' ? 'is-pro' : 'is-free'

  useEffect(() => {
    if (!advancedProjectionEnabled) {
      setProjectionMode('simple')
      return
    }
    setProjectionMode(user?.projection_mode || 'automatica')
  }, [advancedProjectionEnabled, user?.projection_mode])

  useEffect(() => {
    loadDashboard()
  }, [advancedProjectionEnabled, advancedProjectionMaxMonths])

  async function loadDashboard({ silent = false } = {}) {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setProjectionError('')

    try {
      const [ing, ip, gc, gnc, dif] = await Promise.all([
        api.get('/finanzas/ingresos/'),
        api.get('/finanzas/ingresos-puntuales/'),
        api.get('/finanzas/gastos-corrientes/'),
        api.get('/finanzas/gastos-no-corrientes/'),
        api.get('/finanzas/diferidos/'),
      ])

      setData({
        ingresos: ing.data,
        ingresosPuntuales: ip.data,
        gastosCorrientes: gc.data,
        gastosNoCorrientes: gnc.data,
        diferidos: dif.data,
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

    if (advancedProjectionEnabled) {
      void loadAdvancedProjection()
    } else {
      setAdvancedProjection(null)
      setProjectionLoading(false)
      setProjectionError('')
    }
  }

  async function loadAdvancedProjection(fm = futureMonths, pm = pastMonths, { forceRecalculate = false } = {}) {
    if (!advancedProjectionEnabled) return

    const requestId = projectionRequestIdRef.current + 1
    projectionRequestIdRef.current = requestId
    const months = Math.min(fm, advancedProjectionMaxMonths)
    setProjectionLoading(true)
    setProjectionError('')

    try {
      if (forceRecalculate) {
        await api.post('/finanzas/saldo-mes/recalcular/')
      }
      const { data: response } = await api.get(`/finanzas/proyeccion-acumulada/?months=${months}&past_months=${pm}`)
      if (requestId !== projectionRequestIdRef.current) return
      setAdvancedProjection(response)
    } catch (err) {
      if (requestId !== projectionRequestIdRef.current) return
      setAdvancedProjection(null)
      setProjectionError(getApiErrorMessage(err, 'No se pudo cargar la proyeccion premium.'))
    } finally {
      if (requestId !== projectionRequestIdRef.current) return
      setProjectionLoading(false)
    }
  }

  function handleManualRefresh() {
    if (advancedProjectionEnabled) {
      void loadAdvancedProjection(futureMonths, pastMonths, { forceRecalculate: true })
      return
    }
    void loadDashboard({ silent: true })
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
      await loadAdvancedProjection(futureMonths, pastMonths)
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
  const mesActual = startOfMonth(new Date())

  const totalIngFijos = data.ingresos
    .filter((item) => overlapsMonth(item, mesActual))
    .reduce((sum, item) => sum + mensualizado(item.monto, item.frecuencia), 0)
  const totalIngPuntuales = data.ingresosPuntuales
    .filter((item) => occursInMonth(item, mesActual))
    .reduce((sum, item) => sum + Number(item.monto), 0)
  const totalIng = totalIngFijos + totalIngPuntuales

  const totalGC = data.gastosCorrientes
    .filter((item) => overlapsMonth(item, mesActual))
    .reduce((sum, item) => sum + mensualizado(item.monto, item.frecuencia), 0)
  const totalGNC = data.gastosNoCorrientes
    .filter((item) => occursInMonth(item, mesActual))
    .reduce((sum, item) => sum + Number(item.monto), 0)
  const totalDif = data.diferidos
    .filter((item) => overlapsMonth(item, mesActual))
    .reduce((sum, item) => sum + Number(item.cuota_mensual), 0)
  const totalGastos = totalGC + totalGNC + totalDif
  const balance = totalIng - totalGastos


  const onboardingSteps = [
    { label: 'Agrega un ingreso fijo o puntual', done: data.ingresos.length > 0 || data.ingresosPuntuales.length > 0 },
    { label: 'Suma tus gastos fijos', done: data.gastosCorrientes.length > 0 },
    { label: 'Carga un gasto puntual o a cuotas', done: data.gastosNoCorrientes.length > 0 || data.diferidos.length > 0 },
    { label: 'Prueba el simulador', done: false },
  ]

  const hasAnyMovement = data.ingresos.length > 0
    || data.ingresosPuntuales.length > 0
    || data.gastosCorrientes.length > 0
    || data.gastosNoCorrientes.length > 0
    || data.diferidos.length > 0

  const tasaAhorro = totalIng > 0 ? Math.round((balance / totalIng) * 100) : 0

  const advancedSeries = advancedProjection?.series || []
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
      const ingDisponible = opening + ingMes
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
  }, [advancedSeries])

  const latestProjectedPoint = chartSeries.filter((point) => !point.is_real).at(-1) || null

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
                ing_real: 'Disponible (real)',
                ing_proj: 'Disponible (proy.)',
                gasto_real: 'Gastos del mes (real)',
                gasto_proj: 'Gastos del mes (proy.)',
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
          {`${label} · ${point.is_real ? 'Real' : 'Proyectado'}`}
        </div>
        {point.gapAcumulado != null && (
          <div style={{ color: '#C487F6', fontWeight: 700, marginBottom: 4 }}>
            {`${point.is_real ? 'Saldo al cierre' : 'Saldo proyectado'}: ${fmt(point.gapAcumulado)}`}
          </div>
        )}
        <div style={{ color: '#10B981' }}>{`Disponible este mes: ${fmt(ingDisponible)}`}</div>
        <div style={{ color: '#F87171' }}>{`Gastos del mes: ${fmt(gastoDisplay)}`}</div>
        {point.opening != null && (
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
        <span className="dashboard-mes-badge">
          {MESES_FULL[mesActual.getMonth()]} {mesActual.getFullYear()}
        </span>
      </div>

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      {/* ── Onboarding ── */}
      {!hasAnyMovement && (
        <div className="dashboard-onboarding-card">
          <h2 className="dashboard-onboarding-title">Tu cuenta, lista en minutos.</h2>
          <p className="dashboard-onboarding-sub">Haz esto una vez y el resto fluye solo.</p>
          <div className="dashboard-onboarding-steps">
            {onboardingSteps.map((step) => (
              <div key={step.label} className={`dashboard-onboarding-step ${step.done ? 'done' : ''}`}>
                <span className="dashboard-onboarding-dot">{step.done ? '✓' : '○'}</span>
                <span>{step.label}</span>
              </div>
            ))}
          </div>
          <div className="dashboard-onboarding-actions">
            <Link to="/ingresos" className="btn-modal-save" style={{ textDecoration: 'none' }}>Cargar ingresos</Link>
            <Link to="/importar" className="btn-modal-cancel" style={{ textDecoration: 'none' }}>Importar archivo</Link>
          </div>
        </div>
      )}

      {/* ── 4 KPI Cards ── */}
      <div className="stats-grid dashboard-stats-grid">
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-label">Ingresos</span>
            <TrendingUp size={16} style={{ color: '#10B981' }} />
          </div>
          <div className="stat-value green">{fmt(totalIng)}</div>
          <div className="stat-sub">Fijos + puntuales este mes</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-label">Gastos</span>
            <TrendingDown size={16} style={{ color: '#F87171' }} />
          </div>
          <div className="stat-value red">{fmt(totalGastos)}</div>
          <div className="stat-sub">Fijos + puntuales + cuotas</div>
        </div>

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

      {/* ── Desglose ── */}
      <div className="dashboard-breakdown-section">
        <div className="dashboard-breakdown-group">
          <div className="dashboard-breakdown-group-title income">↑ Ingresos</div>
          <div className="dashboard-breakdown-cols">
            {[
              { label: 'Fijos', value: totalIngFijos },
              { label: 'Puntuales', value: totalIngPuntuales },
            ].map(({ label, value }) => (
              <div key={label} className="dashboard-breakdown-item income">
                <div className="dashboard-breakdown-item-label">{label}</div>
                <div className="dashboard-breakdown-item-value">{fmt(value)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-breakdown-group">
          <div className="dashboard-breakdown-group-title expense">↓ Gastos</div>
          <div className="dashboard-breakdown-cols">
            {[
              { label: 'Fijos', value: totalGC },
              { label: 'Cuotas', value: totalDif },
              { label: 'Puntuales', value: totalGNC },
            ].map(({ label, value }) => (
              <div key={label} className="dashboard-breakdown-item expense">
                <div className="dashboard-breakdown-item-label">{label}</div>
                <div className="dashboard-breakdown-item-value">{fmt(value)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {advancedProjectionEnabled ? (
        <div className="card dashboard-chart-card dashboard-premium-card">
          <div className="card-header dashboard-card-header-compact">
            <div className="dashboard-card-copy">
              <h2 className="card-title">Proyeccion mensual</h2>
              <p className="dashboard-card-subtitle">
                {getProjectionModeHelp(projectionMode)}
              </p>
            </div>
            <span className="dashboard-premium-badge">Premium</span>
          </div>

          <div className="dashboard-chart-toolbar" style={{ marginBottom: 12 }}>
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
              <span>Vista</span>
              <select
                className="dashboard-chart-select"
                value={pastMonths}
                onChange={(e) => {
                  const val = Number(e.target.value)
                  setPastMonths(val)
                  clearTimeout(projectionDebounceRef.current)
                  projectionDebounceRef.current = setTimeout(() => loadAdvancedProjection(futureMonths, val), 300)
                }}
              >
                <option value={3}>3 meses</option>
                <option value={6}>6 meses</option>
                <option value={12}>12 meses</option>
                <option value={24}>24 meses</option>
              </select>
            </label>
            <label className="dashboard-chart-control">
              <span>Proyeccion</span>
              <select
                className="dashboard-chart-select"
                value={futureMonths}
                onChange={(e) => {
                  const val = Number(e.target.value)
                  setFutureMonths(val)
                  clearTimeout(projectionDebounceRef.current)
                  projectionDebounceRef.current = setTimeout(() => loadAdvancedProjection(val, pastMonths), 300)
                }}
              >
                <option value={12}>1 año</option>
                <option value={24}>2 años</option>
                <option value={60}>5 años</option>
              </select>
            </label>
            <button
              type="button"
              className="btn-modal-cancel"
              onClick={handleManualRefresh}
              disabled={loading || refreshing || projectionLoading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}
            >
              <RefreshCw size={15} style={{ opacity: refreshing || projectionLoading ? 0.7 : 1 }} />
              {advancedProjectionEnabled
                ? (projectionLoading ? 'Recalculando...' : 'Recalcular proyeccion')
                : (refreshing ? 'Recargando...' : 'Recargar')}
            </button>
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
          </div>

          <p className="dashboard-chart-note" style={{ marginTop: 0, marginBottom: 12 }}>
            {getProjectionAnalysisHelp(
              projectionMode,
              advancedProjection?.analysis_history_months ?? 0,
              advancedProjection?.analysis_history_cap_months ?? 18,
            )}
          </p>

          {projectionLoading ? (
            <div className="loading-screen" style={{ minHeight: '220px' }}>
              <div className="spinner" />
            </div>
          ) : projectionError ? (
            <div className="empty-state">
              <p className="empty-text">No pudimos cargar la proyeccion</p>
              <p className="empty-sub">{projectionError}</p>
            </div>
          ) : (
            <>
              {(() => {
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
                      <span className="dashboard-premium-stat-label">Ingresos extra promedio</span>
                      <strong className="dashboard-premium-stat-value" style={{ color: '#10B981' }}>
                        {fmt(svi)}
                      </strong>
                    </div>
                    <div className="dashboard-premium-stat">
                      <span className="dashboard-premium-stat-label">Gastos extra promedio</span>
                      <strong className="dashboard-premium-stat-value" style={{ color: '#F87171' }}>
                        {fmt(svg)}
                      </strong>
                    </div>
                    <div className="dashboard-premium-stat">
                      <span className="dashboard-premium-stat-label">Calculado usando</span>
                      <strong className="dashboard-premium-stat-value">
                        {histMeses} {histMeses === 1 ? 'mes con movimientos extra' : 'meses con movimientos extra'}
                      </strong>
                      <span className="dashboard-chart-note">
                        {variableProjectionApplied
                          ? `La proyeccion usa ${analysisHistoryMonths} meses de historia para estimar tus extras`
                          : `La parte variable necesita al menos ${minVariableHistoryMonths} meses dentro de la historia analizada`}
                      </span>
                    </div>
                  </div>
                )
              })()}

              {(() => {
                const histMesesAviso = advancedProjection?.history_months_used ?? 0
                const variableProjectionApplied = advancedProjection?.variable_projection_applied ?? true
                const minVariableHistoryMonths = advancedProjection?.min_variable_history_months ?? 3
                const analysisHistoryMonths = advancedProjection?.analysis_history_months ?? 0
                if (!variableProjectionApplied) return (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 12, padding: '10px 14px', marginBottom: 14 }}>
                    <span style={{ fontSize: 16, lineHeight: 1 }}>⚠️</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#FBBF24', marginBottom: 2 }}>La base fija ya esta proyectada</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                        {histMesesAviso === 0
                          ? `Tus ingresos, gastos fijos y cuotas ya estan incluidos. La parte variable aun no entra porque necesitas ${minVariableHistoryMonths} meses con extras elegibles dentro de la historia analizada (${analysisHistoryMonths} meses disponibles hoy).`
                          : `Tus ingresos, gastos fijos y cuotas ya estan incluidos. La parte variable aun no entra porque solo hay ${histMesesAviso} ${histMesesAviso === 1 ? 'mes' : 'meses'} con extras elegibles dentro de la historia analizada (${analysisHistoryMonths} meses disponibles hoy); necesitas ${minVariableHistoryMonths}.`}
                      </div>
                    </div>
                  </div>
                )
                return null
              })()}


              {advancedChartEmpty ? (
                <div className="empty-state">
                  <p className="empty-text">Aun no hay base suficiente</p>
                  <p className="empty-sub">Cuando registres movimientos, aqui veras tus ingresos y gastos mensuales proyectados.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                    {currentMonthKey && (
                      <ReferenceLine
                        x={chartSeries.find((p) => p.month === currentMonthKey)?.label}
                        stroke="rgba(255,255,255,0.25)"
                        strokeDasharray="4 4"
                        label={{ value: 'Hoy', position: 'insideTopRight', fill: 'rgba(255,255,255,0.40)', fontSize: 11 }}
                      />
                    )}
                    <ReferenceLine y={0} stroke="rgba(248,113,113,0.35)" strokeDasharray="4 3" />
                    <Tooltip content={renderProjectionTooltip}
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
                          ing_real: 'Disponible (real)', ing_proj: 'Disponible (proy.)',
                          gasto_real: 'Gastos del mes (real)', gasto_proj: 'Gastos del mes (proy.)',
                        }
                        return [fmt(value), labels[name] || name]
                      }}
                      labelFormatter={(label, payload) => {
                        const point = payload?.[0]?.payload
                        return point ? `${label} · ${point.is_real ? 'Real' : 'Proyectado'}` : label
                      }}
                    />
                    <Legend content={renderProjectionLegend} />
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
              )}
            </>
          )}
        </div>
      ) : (
        <div className="card dashboard-chart-card dashboard-premium-locked">
          <div className="dashboard-premium-lock-head">
            <div className="dashboard-card-copy">
              <h2 className="card-title">Proyeccion mensual</h2>
              <p className="dashboard-card-subtitle">
                Mira como podria crecer o caer tu caja con el paso de los meses.
              </p>
            </div>
            <span className="dashboard-premium-lock-badge">
              <Lock size={14} />
              Premium
            </span>
          </div>

          <p className="dashboard-premium-lock-text">
            Esta vista usa tu saldo inicial, suaviza picos fuertes y proyecta la tendencia para ayudarte a evitar bolas de nieve financieras.
          </p>

          <div className="dashboard-premium-chip-row">
            <span className="dashboard-premium-chip">Hasta 5 anos</span>
            <span className="dashboard-premium-chip">Picos suavizados</span>
            <span className="dashboard-premium-chip">Saldo acumulado</span>
          </div>
        </div>
      )}
    </div>
  )
}
