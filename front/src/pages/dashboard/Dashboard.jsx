import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { TrendingUp, TrendingDown, Wallet, CreditCard, Pencil, Check, X, ToggleLeft, ToggleRight, RefreshCw } from 'lucide-react'

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

function isActiveOnDate(item, date) {
  if (!item.activo) return false
  const ini = parseLocalDate(item.fecha_inicio)
  const fin = item.fecha_fin ? parseLocalDate(item.fecha_fin) : null
  return ini <= date && (!fin || fin >= date)
}

export default function Dashboard() {
  const { user } = useAuth()

  const [data, setData] = useState({ ingresos: [], gastosCorrientes: [], gastosNoCorrientes: [], diferidos: [] })
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState({ type: '', message: '' })

  const [saldo, setSaldo] = useState(null)
  const [editSaldo, setEditSaldo] = useState(false)
  const [valorSaldo, setValorSaldo] = useState('')
  const [savingSaldo, setSavingSaldo] = useState(false)
  const [recalculando, setRecalculando] = useState(false)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)
    try {
      const [ing, gc, gnc, dif, sal] = await Promise.all([
        api.get('/finanzas/ingresos/'),
        api.get('/finanzas/gastos-corrientes/'),
        api.get('/finanzas/gastos-no-corrientes/'),
        api.get('/finanzas/diferidos/'),
        api.get('/finanzas/saldo-mes/actual/'),
      ])

      setData({
        ingresos: ing.data,
        gastosCorrientes: gc.data,
        gastosNoCorrientes: gnc.data,
        diferidos: dif.data,
      })
      setSaldo(sal.data)
    } catch (err) {
      setData({ ingresos: [], gastosCorrientes: [], gastosNoCorrientes: [], diferidos: [] })
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo cargar el dashboard.') })
    } finally {
      setLoading(false)
    }
  }

  const moneda = user?.moneda_preferida || 'USD'
  const fmt = (value) => formatMoney(value, { currency: moneda })
  const mensualizado = (monto, freq) => Number(monto) * (FREQ[freq] || 1)
  const hoy = new Date()

  const saldoActivo = saldo && saldo.activo ? Number(saldo.monto) : 0
  const totalIng = data.ingresos.filter((i) => isActiveOnDate(i, hoy)).reduce((sum, i) => sum + mensualizado(i.monto, i.frecuencia), 0) + saldoActivo
  const totalGC = data.gastosCorrientes.filter((g) => isActiveOnDate(g, hoy)).reduce((sum, g) => sum + mensualizado(g.monto, g.frecuencia), 0)
  const totalDif = data.diferidos.filter((d) => isActiveOnDate(d, hoy)).reduce((sum, d) => sum + Number(d.cuota_mensual), 0)
  const totalGastos = totalGC + totalDif
  const balance = totalIng - totalGastos

  const projectionMonths = user?.feature_access?.projection_months ?? 6

  const flujoCaja = useMemo(() => {
    const hoy = new Date()
    return Array.from({ length: projectionMonths }, (_, i) => {
      const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
      const mes = `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`

      const ingresosBase = data.ingresos
        .filter((item) => {
          if (!item.activo) return false
          const ini = parseLocalDate(item.fecha_inicio)
          const fin = item.fecha_fin ? parseLocalDate(item.fecha_fin) : null
          return ini <= fecha && (!fin || fin >= fecha)
        })
        .reduce((sum, item) => sum + mensualizado(item.monto, item.frecuencia), 0)

      const ingresosConSaldo = ingresosBase + (i === 0 ? saldoActivo : 0)

      const gastosCorrientesMes = data.gastosCorrientes
        .filter((item) => {
          if (!item.activo) return false
          const ini = parseLocalDate(item.fecha_inicio)
          const fin = item.fecha_fin ? parseLocalDate(item.fecha_fin) : null
          return ini <= fecha && (!fin || fin >= fecha)
        })
        .reduce((sum, item) => sum + mensualizado(item.monto, item.frecuencia), 0)

      const diferidosMes = data.diferidos
        .filter((item) => {
          if (!item.activo) return false
          const ini = parseLocalDate(item.fecha_inicio)
          const fin = parseLocalDate(item.fecha_fin)
          return ini <= fecha && fin >= fecha
        })
        .reduce((sum, item) => sum + Number(item.cuota_mensual), 0)

      const gastos = Math.round(gastosCorrientesMes + diferidosMes)
      const ingresos = Math.round(ingresosConSaldo)
      return {
        mes,
        ingresos,
        gastos,
        balance: ingresos - gastos,
      }
    })
  }, [data, saldoActivo, projectionMonths])

  async function guardarSaldo() {
    if (savingSaldo) return

    const monto = Number(valorSaldo)
    if (Number.isNaN(monto) || monto < 0) {
      setFeedback({ type: 'error', message: 'Ingresa un saldo valido (0 o mayor).' })
      return
    }

    setSavingSaldo(true)
    setFeedback({ type: '', message: '' })
    try {
      if (saldo?.existe) {
        const { data: d } = await api.patch(`/finanzas/saldo-mes/${saldo.id}/`, { monto })
        setSaldo({ ...saldo, ...d, existe: true })
      } else {
        const { data: d } = await api.post('/finanzas/saldo-mes/', {
          anio: saldo.anio,
          mes: saldo.mes,
          monto,
          activo: true,
        })
        setSaldo({ ...d, existe: true })
      }
      setEditSaldo(false)
      setFeedback({ type: 'success', message: 'Saldo actualizado correctamente.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo guardar el saldo.') })
    } finally {
      setSavingSaldo(false)
    }
  }

  async function recalcular() {
    if (recalculando) return

    setRecalculando(true)
    setFeedback({ type: '', message: '' })
    try {
      const { data: d } = await api.post('/finanzas/saldo-mes/recalcular/', {})
      setSaldo({ ...d, existe: true })
      setFeedback({ type: 'success', message: 'Saldo actualizado.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'Error al recalcular el saldo.') })
    } finally {
      setRecalculando(false)
    }
  }

  async function toggleSaldo() {
    if (!saldo) return

    setFeedback({ type: '', message: '' })
    try {
      if (!saldo.existe) {
        const { data: d } = await api.post('/finanzas/saldo-mes/', {
          anio: saldo.anio,
          mes: saldo.mes,
          monto: saldo.monto,
          activo: false,
        })
        setSaldo({ ...d, existe: true })
      } else {
        const { data: d } = await api.patch(`/finanzas/saldo-mes/${saldo.id}/`, { activo: !saldo.activo })
        setSaldo({ ...saldo, ...d, existe: true })
      }
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo cambiar el estado del saldo.') })
    }
  }

  const onboardingSteps = [
    { label: 'Agrega tu primer ingreso', done: data.ingresos.length > 0 },
    { label: 'Registra tus gastos corrientes', done: data.gastosCorrientes.length > 0 },
    { label: 'Carga un gasto puntual o diferido', done: data.gastosNoCorrientes.length > 0 || data.diferidos.length > 0 },
    { label: 'Revisa tu simulador para tomar decisiones', done: false },
  ]

  const hasAnyMovement = data.ingresos.length > 0 || data.gastosCorrientes.length > 0 || data.gastosNoCorrientes.length > 0 || data.diferidos.length > 0

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
  const montoSaldo = saldo ? Number(saldo.monto) : 0

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{saludo}{nombre}</h1>
        <p className="page-subtitle">Asi va tu plata este mes, en tiempo real.</p>
      </div>

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      {!hasAnyMovement && (
        <div
          className="card"
          style={{
            marginBottom: 20,
            border: '1.5px solid rgba(196,135,246,0.30)',
            background: 'linear-gradient(120deg, rgba(196,135,246,0.14), rgba(16,185,129,0.08))',
          }}
        >
          <h2 style={{ fontSize: 18, marginBottom: 6 }}>Bienvenido. Dejemos tu cuenta lista para usar.</h2>
          <p style={{ color: 'rgba(255,255,255,0.70)', marginBottom: 14 }}>
            Completa estos pasos para que reportes y alertas sean utiles desde hoy.
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
              Empezar con ingresos
            </Link>
            <Link to="/importar" className="btn-modal-cancel" style={{ textDecoration: 'none' }}>
              Importar desde archivo
            </Link>
          </div>
        </div>
      )}

      {saldo !== null && (
        <div
          className="dashboard-saldo-card"
          style={{
            background: saldo.activo ? 'rgba(196,135,246,0.08)' : 'rgba(255,255,255,0.03)',
            border: `1.5px solid ${saldo.activo ? 'rgba(196,135,246,0.25)' : 'rgba(255,255,255,0.07)'}`,
          }}
        >
          <div className="dashboard-saldo-top">
            <span style={{ fontWeight: 700, fontSize: 14, color: saldo.activo ? '#C487F6' : 'rgba(255,255,255,0.35)' }}>
              Saldo del mes anterior
            </span>

            {saldo.sugerido && (
              <span style={{ fontSize: 11, background: 'rgba(196,135,246,0.15)', color: '#C487F6', borderRadius: 6, padding: '2px 8px' }}>
                estimado
              </span>
            )}

            {montoSaldo < 0 && (
              <span style={{ fontSize: 11, background: 'rgba(248,113,113,0.15)', color: '#F87171', borderRadius: 6, padding: '2px 8px' }}>
                deficit
              </span>
            )}

            <div className="dashboard-saldo-top-spacer">
              <button
                onClick={toggleSaldo}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  background: 'none',
                  border: `1px solid ${saldo.activo ? 'rgba(196,135,246,0.30)' : 'rgba(255,255,255,0.10)'}`,
                  borderRadius: 10,
                  padding: '5px 11px',
                  cursor: 'pointer',
                  color: saldo.activo ? '#C487F6' : 'rgba(255,255,255,0.30)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {saldo.activo ? <><ToggleRight size={16} /> Incluido</> : <><ToggleLeft size={16} /> No incluido</>}
              </button>
            </div>
          </div>

          <div className="dashboard-saldo-main">
            {editSaldo ? (
              <>
                <input
                  className="dashboard-saldo-input"
                  type="number"
                  step="0.01"
                  value={valorSaldo}
                  onChange={(e) => setValorSaldo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') guardarSaldo()
                    if (e.key === 'Escape') setEditSaldo(false)
                  }}
                  autoFocus
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1.5px solid rgba(196,135,246,0.40)',
                    borderRadius: 10,
                    color: '#FFFFFF',
                    padding: '6px 12px',
                    fontSize: 15,
                    outline: 'none',
                  }}
                />
                <div className="dashboard-saldo-edit">
                  <button
                    onClick={guardarSaldo}
                    disabled={savingSaldo}
                    style={{
                      background: 'rgba(16,185,129,0.15)',
                      border: '1px solid rgba(16,185,129,0.30)',
                      borderRadius: 8,
                      padding: '6px 9px',
                      color: '#10B981',
                      cursor: 'pointer',
                      display: 'flex',
                    }}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    onClick={() => setEditSaldo(false)}
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      borderRadius: 8,
                      padding: '6px 9px',
                      color: 'rgba(255,255,255,0.40)',
                      cursor: 'pointer',
                      display: 'flex',
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
              </>
            ) : (
              <div className="dashboard-saldo-value-wrap">
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: 22,
                    color: montoSaldo >= 0 ? (saldo.activo ? '#FFFFFF' : 'rgba(255,255,255,0.25)') : '#F87171',
                    textDecoration: saldo.activo ? 'none' : 'line-through',
                  }}
                >
                  {fmt(montoSaldo)}
                </span>
                <button
                  onClick={() => {
                    setValorSaldo(montoSaldo)
                    setEditSaldo(true)
                  }}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.30)', cursor: 'pointer', display: 'flex', padding: 2 }}
                >
                  <Pencil size={14} />
                </button>
              </div>
            )}

            <div className="dashboard-saldo-recalc">
              <button
                onClick={recalcular}
                disabled={recalculando}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 10,
                  padding: '7px 14px',
                  cursor: recalculando ? 'not-allowed' : 'pointer',
                  color: recalculando ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.65)',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <RefreshCw size={14} style={{ animation: recalculando ? 'spin 1s linear infinite' : 'none' }} />
                {recalculando ? 'Calculando...' : 'Actualizar'}
              </button>
            </div>
          </div>

        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <span className="stat-label">Lo que ganas</span>
            <TrendingUp size={18} style={{ color: '#10B981', opacity: 0.8 }} />
          </div>
          <div className="stat-value green">{fmt(totalIng)}</div>
          <div className="stat-sub">Ingresos + saldo anterior{saldoActivo > 0 ? ` (inc. ${fmt(saldoActivo)})` : ''}</div>
        </div>

        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <span className="stat-label">Gastos frecuentes</span>
            <TrendingDown size={18} style={{ color: '#F87171', opacity: 0.8 }} />
          </div>
          <div className="stat-value red">{fmt(totalGastos)}</div>
          <div className="stat-sub">Gastos + cuotas mensuales</div>
        </div>

        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <span className="stat-label">Lo que te queda</span>
            <Wallet size={18} style={{ color: balance >= 0 ? '#10B981' : '#F87171', opacity: 0.8 }} />
          </div>
          <div className={`stat-value ${balance >= 0 ? 'green' : 'red'}`}>{fmt(balance)}</div>
          <div className="stat-sub">{balance >= 0 ? 'Vas bien este mes' : 'Revisa tus gastos'}</div>
        </div>

        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <span className="stat-label">Cuotas activas</span>
            <CreditCard size={18} style={{ color: '#C487F6', opacity: 0.8 }} />
          </div>
          <div className="stat-value lila">{data.diferidos.filter((d) => d.activo).length}</div>
          <div className="stat-sub">{fmt(totalDif)}/mes en diferidos</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Tu flujo de caja - proximos {projectionMonths} meses</h2>
        </div>

        {flujoCaja.every((row) => row.ingresos === 0 && row.gastos === 0) ? (
          <div className="empty-state">
            <p className="empty-text">Aun no hay datos para graficar</p>
            <p className="empty-sub">Agrega ingresos y gastos para ver tu proyeccion mensual</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={flujoCaja} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
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
              <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} tickFormatter={(value) => fmt(value)} width={90} />
              <Tooltip
                contentStyle={{ background: 'rgba(26,37,64,0.95)', border: '1px solid rgba(196,135,246,0.2)', borderRadius: 12 }}
                labelStyle={{ color: '#FFFFFF', marginBottom: 4, fontWeight: 700 }}
                formatter={(value, name) => [fmt(value), name === 'ingresos' ? 'Entra' : name === 'gastos' ? 'Sale' : 'Balance']}
              />
              <Legend formatter={(value) => (value === 'ingresos' ? 'Entra' : value === 'gastos' ? 'Sale' : 'Balance')} />
              <Area type="monotone" dataKey="ingresos" stroke="#10B981" fill="url(#gIngresos)" strokeWidth={2.5} />
              <Area type="monotone" dataKey="gastos" stroke="#F87171" fill="url(#gGastos)" strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
