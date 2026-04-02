import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import { TrendingUp, TrendingDown, Wallet, Lock, PiggyBank } from 'lucide-react'

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

export default function Dashboard() {
  const { user } = useAuth()

  const [data, setData] = useState({
    ingresos: [],
    ingresosPuntuales: [],
    gastosCorrientes: [],
    gastosNoCorrientes: [],
    diferidos: [],
  })

  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState({ type: '', message: '' })
  const [advancedProjection, setAdvancedProjection] = useState(null)
  const [projectionLoading, setProjectionLoading] = useState(false)
  const [projectionError, setProjectionError] = useState('')
  const [pastMonths, setPastMonths] = useState(6)
  const [futureMonths, setFutureMonths] = useState(12)

  const advancedProjectionEnabled = Boolean(user?.feature_access?.advanced_projection_enabled)
  const advancedProjectionMaxMonths = normalizePositiveInt(user?.feature_access?.advanced_projection_months, 60)

  useEffect(() => {
    loadDashboard()
  }, [advancedProjectionEnabled, advancedProjectionMaxMonths])

  async function loadDashboard() {
    setLoading(true)
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
    }

    if (advancedProjectionEnabled) {
      void loadAdvancedProjection()
    } else {
      setAdvancedProjection(null)
      setProjectionLoading(false)
      setProjectionError('')
    }
  }

  async function loadAdvancedProjection(fm = futureMonths, pm = pastMonths) {
    if (!advancedProjectionEnabled) return

    const months = Math.min(fm, advancedProjectionMaxMonths)
    setProjectionLoading(true)
    setProjectionError('')

    try {
      const { data: response } = await api.get(`/finanzas/proyeccion-acumulada/?months=${months}&past_months=${pm}`)
      setAdvancedProjection(response)
    } catch (err) {
      setAdvancedProjection(null)
      setProjectionError(getApiErrorMessage(err, 'No se pudo cargar la proyeccion premium.'))
    } finally {
      setProjectionLoading(false)
    }
  }

  const moneda = user?.moneda_preferida || 'USD'
  const fmt = (value) => formatMoney(value, { currency: moneda })
  const fmtAxis = (value) => formatMoney(value, {
    currency: moneda,
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
      return {
        label: point.label,
        month: point.month,
        is_real: point.is_real,
        ing_real:     isConnectReal ? point.cumulative_ingresos : null,
        ing_proj:     isConnectProj ? point.cumulative_ingresos : null,
        gasto_real:   isConnectReal ? point.cumulative_gastos   : null,
        gasto_proj:   isConnectProj ? point.cumulative_gastos   : null,
        balance_real: isConnectReal ? point.cumulative_balance  : null,
        balance_proj: isConnectProj ? point.cumulative_balance  : null,
      }
    })
  }, [advancedSeries])

  const advancedChartEmpty = advancedSeries.length === 0 || advancedSeries.every(
    (point) => point.cumulative_ingresos === 0 && point.cumulative_gastos === 0,
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
        <div>
          <h1 className="page-title">{saludo}{nombre}</h1>
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
              <h2 className="card-title">Proyeccion acumulada</h2>
              <p className="dashboard-card-subtitle">
                Historico real + tendencia proyectada hacia adelante.
              </p>
            </div>
            <span className="dashboard-premium-badge">Premium</span>
          </div>

          <div className="dashboard-chart-toolbar" style={{ marginBottom: 12 }}>
            <label className="dashboard-chart-control">
              <span>Historico</span>
              <select
                className="dashboard-chart-select"
                value={pastMonths}
                onChange={(e) => {
                  const val = Number(e.target.value)
                  setPastMonths(val)
                  loadAdvancedProjection(futureMonths, val)
                }}
              >
                <option value={3}>3 meses</option>
                <option value={6}>6 meses</option>
                <option value={12}>12 meses</option>
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
                  loadAdvancedProjection(val, pastMonths)
                }}
              >
                <option value={12}>1 año</option>
                <option value={24}>2 años</option>
                <option value={60}>5 años</option>
              </select>
            </label>
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
          ) : (
            <>
              {(() => {
                const histMeses = advancedProjection?.history_months_used ?? 0
                const svgap = advancedProjection?.smoothed_variable_gap ?? 0
                return (
                  <div className="dashboard-premium-meta">
                    <div className="dashboard-premium-stat">
                      <span className="dashboard-premium-stat-label">Saldo inicial</span>
                      <strong className="dashboard-premium-stat-value">{fmt(advancedProjection?.starting_balance ?? 0)}</strong>
                    </div>
                    <div className="dashboard-premium-stat">
                      <span className="dashboard-premium-stat-label">Variable mensual promedio</span>
                      <strong className="dashboard-premium-stat-value" style={{ color: svgap >= 0 ? '#10B981' : '#F87171' }}>
                        {svgap >= 0 ? '+' : ''}{fmt(svgap)}
                      </strong>
                    </div>
                    <div className="dashboard-premium-stat">
                      <span className="dashboard-premium-stat-label">Historial de puntuales</span>
                      <strong className="dashboard-premium-stat-value">{histMeses} {histMeses === 1 ? 'mes' : 'meses'}</strong>
                    </div>
                  </div>
                )
              })()}

              {(() => {
                const histMesesAviso = advancedProjection?.history_months_used ?? 0
                if (histMesesAviso === 0) return (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 12, padding: '10px 14px', marginBottom: 14 }}>
                    <span style={{ fontSize: 16, lineHeight: 1 }}>⚠️</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#FBBF24', marginBottom: 2 }}>Parte variable con poco historial</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                        {histMesesAviso === 0
                          ? 'Tus ingresos y gastos fijos estan proyectados correctamente. Agrega gastos o ingresos puntuales para afinar la parte variable.'
                          : `Solo ${histMesesAviso} ${histMesesAviso === 1 ? 'mes' : 'meses'} de movimientos puntuales. Los fijos ya estan incluidos — con mas meses de puntuales la estimacion variable mejora.`}
                      </div>
                    </div>
                  </div>
                )
                return null
              })()}

              {advancedChartEmpty ? (
                <div className="empty-state">
                  <p className="empty-text">Aun no hay base suficiente</p>
                  <p className="empty-sub">Cuando registres movimientos, aqui veras tu caja acumulada a futuro.</p>
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
                      <linearGradient id="gBalReal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#C487F6" stopOpacity={0.30} />
                        <stop offset="95%" stopColor="#C487F6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gBalProj" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#C487F6" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="#C487F6" stopOpacity={0} />
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
                    <Tooltip
                      contentStyle={{ background: 'rgba(26,37,64,0.97)', border: '1px solid rgba(196,135,246,0.2)', borderRadius: 12 }}
                      labelStyle={{ color: '#FFFFFF', marginBottom: 6, fontWeight: 700 }}
                      formatter={(value, name) => {
                        if (value == null) return null
                        const labels = {
                          ing_real: 'Ingresos acum. (real)', ing_proj: 'Ingresos acum. (proy.)',
                          gasto_real: 'Gastos acum. (real)',  gasto_proj: 'Gastos acum. (proy.)',
                          balance_real: 'Balance acum. (real)', balance_proj: 'Balance acum. (proy.)',
                        }
                        return [fmt(value), labels[name] || name]
                      }}
                      labelFormatter={(label, payload) => {
                        const point = payload?.[0]?.payload
                        return point ? `${label} · ${point.is_real ? 'Real' : 'Proyectado'}` : label
                      }}
                    />
                    <Legend formatter={(name) => ({
                      ing_real: 'Ingresos (real)', ing_proj: 'Ingresos (proy.)',
                      gasto_real: 'Gastos (real)', gasto_proj: 'Gastos (proy.)',
                      balance_real: 'Balance (real)', balance_proj: 'Balance (proy.)',
                    }[name] || name)} />
                    <Area connectNulls={false} type="monotone" dataKey="balance_real" stroke="#C487F6" strokeWidth={2.5} fill="url(#gBalReal)"   dot={false} />
                    <Area connectNulls={false} type="monotone" dataKey="balance_proj" stroke="#C487F6" strokeWidth={2}   fill="url(#gBalProj)"   strokeDasharray="5 4" dot={false} />
                    <Area connectNulls={false} type="monotone" dataKey="ing_real"     stroke="#10B981" strokeWidth={2.5} fill="url(#gIngReal)"   dot={false} />
                    <Area connectNulls={false} type="monotone" dataKey="ing_proj"     stroke="#10B981" strokeWidth={2}   fill="url(#gIngProj)"   strokeDasharray="5 4" dot={false} />
                    <Area connectNulls={false} type="monotone" dataKey="gasto_real"   stroke="#F87171" strokeWidth={2.5} fill="url(#gGastoReal)" dot={false} />
                    <Area connectNulls={false} type="monotone" dataKey="gasto_proj"   stroke="#F87171" strokeWidth={2}   fill="url(#gGastoProj)" strokeDasharray="5 4" dot={false} />
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
              <h2 className="card-title">Proyeccion acumulada</h2>
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
