import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import { TrendingUp, TrendingDown, Wallet, CreditCard, Lock } from 'lucide-react'

import api from '../../api/client'
import { getApiErrorMessage } from '../../api/errors'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import { useAuth } from '../../context/useAuth'
import { formatMoney } from '../../utils/formatters'
import '../../components/ui/app.css'

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
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

function buildProjectionOptions(maxMonths) {
  const presets = [3, 6, 12, maxMonths]
  const filtered = presets.filter((value) => value > 0 && value <= maxMonths)
  const unique = Array.from(new Set(filtered))
  return unique.length > 0 ? unique : [maxMonths]
}

function getDefaultProjectionSelection(options) {
  if (options.includes(6)) return 6
  return options[options.length - 1] ?? 1
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
  const [saldo, setSaldo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState({ type: '', message: '' })
  const [advancedProjection, setAdvancedProjection] = useState(null)
  const [projectionLoading, setProjectionLoading] = useState(false)
  const [projectionError, setProjectionError] = useState('')

  const projectionMaxMonths = normalizePositiveInt(user?.feature_access?.projection_months, 6)
  const advancedProjectionEnabled = Boolean(user?.feature_access?.advanced_projection_enabled)
  const advancedProjectionMaxMonths = normalizePositiveInt(user?.feature_access?.advanced_projection_months, 60)
  const projectionOptions = useMemo(() => buildProjectionOptions(projectionMaxMonths), [projectionMaxMonths])
  const [visibleMonths, setVisibleMonths] = useState(() => getDefaultProjectionSelection(projectionOptions))

  useEffect(() => {
    setVisibleMonths((current) => (
      projectionOptions.includes(current)
        ? current
        : getDefaultProjectionSelection(projectionOptions)
    ))
  }, [projectionOptions])

  useEffect(() => {
    loadDashboard()
  }, [advancedProjectionEnabled, advancedProjectionMaxMonths])

  async function loadDashboard() {
    setLoading(true)
    setProjectionError('')

    try {
      const [ing, ip, gc, gnc, dif, sal] = await Promise.all([
        api.get('/finanzas/ingresos/'),
        api.get('/finanzas/ingresos-puntuales/'),
        api.get('/finanzas/gastos-corrientes/'),
        api.get('/finanzas/gastos-no-corrientes/'),
        api.get('/finanzas/diferidos/'),
        api.get('/finanzas/saldo-mes/actual/'),
      ])

      setData({
        ingresos: ing.data,
        ingresosPuntuales: ip.data,
        gastosCorrientes: gc.data,
        gastosNoCorrientes: gnc.data,
        diferidos: dif.data,
      })
      setSaldo(sal.data)
      setFeedback({ type: '', message: '' })
    } catch (err) {
      setData({
        ingresos: [],
        ingresosPuntuales: [],
        gastosCorrientes: [],
        gastosNoCorrientes: [],
        diferidos: [],
      })
      setSaldo(null)
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

  async function loadAdvancedProjection() {
    if (!advancedProjectionEnabled) return

    const months = Math.min(60, advancedProjectionMaxMonths)
    setProjectionLoading(true)
    setProjectionError('')

    try {
      const { data: response } = await api.get(`/finanzas/proyeccion-acumulada/?months=${months}`)
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
  const montoSaldo = saldo ? Number(saldo.monto) : 0
  const saldoAplicado = Boolean(saldo?.activo)
  const saldoInicialParaProyeccion = saldoAplicado ? montoSaldo : 0

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

  const flujoCajaCompleto = useMemo(() => {
    const hoy = new Date()

    return Array.from({ length: projectionMaxMonths }, (_, index) => {
      const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + index, 1)

      const ingresosFijosMes = data.ingresos
        .filter((item) => overlapsMonth(item, fecha))
        .reduce((sum, item) => sum + mensualizado(item.monto, item.frecuencia), 0)

      const ingresosPuntualesMes = data.ingresosPuntuales
        .filter((item) => occursInMonth(item, fecha))
        .reduce((sum, item) => sum + Number(item.monto), 0)

      const gastosCorrientesMes = data.gastosCorrientes
        .filter((item) => overlapsMonth(item, fecha))
        .reduce((sum, item) => sum + mensualizado(item.monto, item.frecuencia), 0)

      const gastosPuntualesMes = data.gastosNoCorrientes
        .filter((item) => occursInMonth(item, fecha))
        .reduce((sum, item) => sum + Number(item.monto), 0)

      const diferidosMes = data.diferidos
        .filter((item) => overlapsMonth(item, fecha))
        .reduce((sum, item) => sum + Number(item.cuota_mensual), 0)

      const ingresos = Math.round(ingresosFijosMes + ingresosPuntualesMes + (index === 0 ? saldoInicialParaProyeccion : 0))
      const gastos = Math.round(gastosCorrientesMes + gastosPuntualesMes + diferidosMes)

      return {
        month: `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`,
        mes: `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`,
        ingresos,
        gastos,
        balance: ingresos - gastos,
      }
    })
  }, [data, projectionMaxMonths, saldoInicialParaProyeccion])

  const flujoCaja = useMemo(
    () => flujoCajaCompleto.slice(0, visibleMonths),
    [flujoCajaCompleto, visibleMonths],
  )

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

  const flowChartEmpty = flujoCaja.every((row) => row.ingresos === 0 && row.gastos === 0)
  const advancedSeries = advancedProjection?.series || []
  const advancedChartEmpty = advancedSeries.length === 0 || advancedSeries.every(
    (point) => point.projected_gap === 0 && point.cumulative_balance === 0,
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
  const selectedProjectionLabel = visibleMonths === 1 ? '1 mes' : `${visibleMonths} meses`
  const chartMaxLabel = projectionMaxMonths === 1 ? 'Max 1 mes' : `Max ${projectionMaxMonths} meses`
  const premiumMonths = advancedProjection?.months || Math.min(60, advancedProjectionMaxMonths)

  return (
    <div className="dashboard-shell">
      <div className="page-header">
        <h1 className="page-title">{saludo}{nombre}</h1>
        <p className="page-subtitle">Tu mes, claro y sin vueltas.</p>
      </div>

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      {!hasAnyMovement && (
        <div
          className="card"
          style={{
            marginBottom: 0,
            border: '1.5px solid rgba(196,135,246,0.30)',
            background: 'linear-gradient(120deg, rgba(196,135,246,0.14), rgba(16,185,129,0.08))',
          }}
        >
          <h2 style={{ fontSize: 18, marginBottom: 6 }}>Tu cuenta, lista en minutos.</h2>
          <p style={{ color: 'rgba(255,255,255,0.70)', marginBottom: 14 }}>
            Haz esto una vez y el resto fluye solo.
          </p>

          <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
            {onboardingSteps.map((step) => (
              <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 8, color: step.done ? '#10B981' : 'rgba(255,255,255,0.75)' }}>
                <span style={{ fontWeight: 700 }}>{step.done ? 'OK' : '-'}</span>
                <span>{step.label}</span>
              </div>
            ))}
          </div>

          <div className="dashboard-onboarding-actions">
            <Link to="/ingresos" className="btn-modal-save" style={{ textDecoration: 'none' }}>
              Cargar ingresos
            </Link>
            <Link to="/importar" className="btn-modal-cancel" style={{ textDecoration: 'none' }}>
              Importar archivo
            </Link>
          </div>
        </div>
      )}

      <div className="stats-grid dashboard-stats-grid">
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <span className="stat-label">Lo que ganas</span>
            <TrendingUp size={18} style={{ color: '#10B981', opacity: 0.8 }} />
          </div>
          <div className="stat-value green">{fmt(totalIng)}</div>
          <div className="stat-sub">Fijos y puntuales del mes</div>
        </div>

        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <span className="stat-label">Lo que gastas</span>
            <TrendingDown size={18} style={{ color: '#F87171', opacity: 0.8 }} />
          </div>
          <div className="stat-value red">{fmt(totalGastos)}</div>
          <div className="stat-sub">Fijos, puntuales y cuotas</div>
        </div>

        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <span className="stat-label">Lo que te queda</span>
            <Wallet size={18} style={{ color: balance >= 0 ? '#10B981' : '#F87171', opacity: 0.8 }} />
          </div>
          <div className={`stat-value ${balance >= 0 ? 'green' : 'red'}`}>{fmt(balance)}</div>
          <div className="stat-sub">{balance >= 0 ? 'Tu flujo va positivo' : 'Tu flujo va apretado'}</div>
        </div>

        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <span className="stat-label">Gastos a cuotas</span>
            <CreditCard size={18} style={{ color: '#C487F6', opacity: 0.8 }} />
          </div>
          <div className="stat-value lila">{data.diferidos.filter((item) => item.activo).length}</div>
          <div className="stat-sub">{fmt(totalDif)}/mes comprometidos</div>
        </div>
      </div>

      {saldo !== null && (
        <div className="dashboard-secondary-grid">
          <div className="dashboard-mini-kpi">
            <div className="dashboard-mini-kpi-head">
              <span className="dashboard-mini-kpi-label">Saldo inicial</span>
              <span className={`badge ${saldoAplicado ? 'badge-lila' : 'badge-gray'}`}>
                {saldoAplicado ? 'Aplica' : 'No aplica'}
              </span>
              {saldo?.sugerido && <span className="badge badge-gray">Estimado</span>}
              {montoSaldo < 0 && <span className="badge badge-red">En rojo</span>}
            </div>
            <div className={`dashboard-mini-kpi-value ${montoSaldo < 0 ? 'is-negative' : ''}`}>{fmt(montoSaldo)}</div>
            <p className="dashboard-mini-kpi-copy">
              Base tomada del mes pasado para leer tu caja desde este mes hacia adelante.
            </p>
          </div>
        </div>
      )}

      <div className="card dashboard-chart-card">
        <div className="card-header dashboard-card-header-compact">
          <div className="dashboard-card-copy">
            <h2 className="card-title">Flujo de caja</h2>
            <p className="dashboard-card-subtitle">Ingresos por un lado y egresos por otro, mirando hacia adelante.</p>
          </div>

          <div className="dashboard-chart-toolbar">
            <label className="dashboard-chart-control">
              <span>Ver</span>
              <select
                className="dashboard-chart-select"
                value={visibleMonths}
                onChange={(event) => setVisibleMonths(Number(event.target.value))}
              >
                {projectionOptions.map((option) => (
                  <option key={option} value={option}>
                    {option === 1 ? '1 mes' : `${option} meses`}
                  </option>
                ))}
              </select>
            </label>
            <span className="dashboard-chart-note">{chartMaxLabel}</span>
          </div>
        </div>

        <div className="dashboard-chart-meta">
          <span className="dashboard-chart-chip">{selectedProjectionLabel}</span>
          <span className="dashboard-chart-chip">Ingresos: fijos + puntuales</span>
          <span className="dashboard-chart-chip">Egresos: fijos + puntuales + cuotas</span>
        </div>

        {flowChartEmpty ? (
          <div className="empty-state">
            <p className="empty-text">Aun no hay movimiento</p>
            <p className="empty-sub">Suma ingresos y gastos para ver tu flujo</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={flujoCaja} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gIngresos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gGastos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F87171" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#F87171" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="mes" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} tickFormatter={fmtAxis} width={82} />
              <Tooltip
                contentStyle={{ background: 'rgba(26,37,64,0.95)', border: '1px solid rgba(196,135,246,0.2)', borderRadius: 12 }}
                labelStyle={{ color: '#FFFFFF', marginBottom: 4, fontWeight: 700 }}
                formatter={(value, name) => [fmt(value), name === 'ingresos' ? 'Ingresos' : 'Egresos']}
              />
              <Legend formatter={(value) => (value === 'ingresos' ? 'Ingresos' : 'Egresos')} />
              <Area type="monotone" dataKey="ingresos" stroke="#10B981" fill="url(#gIngresos)" strokeWidth={2.5} />
              <Area type="monotone" dataKey="gastos" stroke="#F87171" fill="url(#gGastos)" strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {advancedProjectionEnabled ? (
        <div className="card dashboard-chart-card dashboard-premium-card">
          <div className="card-header dashboard-card-header-compact">
            <div className="dashboard-card-copy">
              <h2 className="card-title">Proyeccion acumulada</h2>
              <p className="dashboard-card-subtitle">
                Saldo inicial mas tendencia suavizada para ver como podria moverse tu caja a largo plazo.
              </p>
            </div>
            <span className="dashboard-premium-badge">Premium · {premiumMonths === 1 ? '1 mes' : `${premiumMonths} meses`}</span>
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
              <div className="dashboard-premium-meta">
                <div className="dashboard-premium-stat">
                  <span className="dashboard-premium-stat-label">Saldo base</span>
                  <strong className="dashboard-premium-stat-value">{fmt(advancedProjection?.starting_balance ?? 0)}</strong>
                </div>
                <div className="dashboard-premium-stat">
                  <span className="dashboard-premium-stat-label">Gap suavizado</span>
                  <strong className="dashboard-premium-stat-value">{fmt(advancedProjection?.smoothed_variable_gap ?? 0)}</strong>
                </div>
                <div className="dashboard-premium-stat">
                  <span className="dashboard-premium-stat-label">Historial usado</span>
                  <strong className="dashboard-premium-stat-value">{advancedProjection?.history_months_used ?? 0} meses</strong>
                </div>
              </div>

              {advancedChartEmpty ? (
                <div className="empty-state">
                  <p className="empty-text">Aun no hay base suficiente</p>
                  <p className="empty-sub">Cuando registres movimientos, aqui veras tu caja acumulada a futuro.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={advancedSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gAcumulado" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#C487F6" stopOpacity={0.38} />
                        <stop offset="95%" stopColor="#C487F6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="label" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} tickFormatter={fmtAxis} width={82} />
                    <ReferenceLine y={0} stroke="rgba(248,113,113,0.4)" strokeDasharray="4 4" />
                    <Tooltip
                      contentStyle={{ background: 'rgba(26,37,64,0.95)', border: '1px solid rgba(196,135,246,0.2)', borderRadius: 12 }}
                      labelStyle={{ color: '#FFFFFF', marginBottom: 4, fontWeight: 700 }}
                      formatter={(value) => [fmt(value), 'Saldo acumulado']}
                      labelFormatter={(label, payload) => {
                        const gap = payload?.[0]?.payload?.projected_gap ?? 0
                        return `${label} · gap ${fmt(gap)}`
                      }}
                    />
                    <Legend formatter={() => 'Saldo acumulado'} />
                    <Area type="monotone" dataKey="cumulative_balance" stroke="#C487F6" fill="url(#gAcumulado)" strokeWidth={2.6} />
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
