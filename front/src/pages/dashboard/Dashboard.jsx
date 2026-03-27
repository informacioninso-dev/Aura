import { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { TrendingUp, TrendingDown, Wallet, CreditCard, Pencil, Check, X, ToggleLeft, ToggleRight, RefreshCw } from 'lucide-react'
import api from '../../api/client'
import { useAuth } from '../../context/useAuth'
import '../../components/ui/app.css'

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const FREQ  = { diario: 30, semanal: 4.33, quincenal: 2, mensual: 1, bimestral: 0.5, trimestral: 0.333, semestral: 0.167, anual: 0.083 }

export default function Dashboard() {
  const { user } = useAuth()
  const [data, setData]       = useState({ ingresos: [], gastosCorrientes: [], gastosNoCorrientes: [], diferidos: [] })
  const [loading, setLoading] = useState(true)
  const [saldo, setSaldo]     = useState(null)   // { existe, id?, anio, mes, monto, activo, sugerido? }
  const [editSaldo, setEditSaldo]     = useState(false)
  const [valorSaldo, setValorSaldo]   = useState('')
  const [savingSaldo, setSavingSaldo] = useState(false)
  const [recalculando, setRecalculando] = useState(false)
  const [recalcError, setRecalcError]   = useState('')

  useEffect(() => {
    Promise.all([
      api.get('/finanzas/ingresos/'),
      api.get('/finanzas/gastos-corrientes/'),
      api.get('/finanzas/gastos-no-corrientes/'),
      api.get('/finanzas/diferidos/'),
      api.get('/finanzas/saldo-mes/actual/'),
    ]).then(([ing, gc, gnc, dif, sal]) => {
      setData({ ingresos: ing.data, gastosCorrientes: gc.data, gastosNoCorrientes: gnc.data, diferidos: dif.data })
      setSaldo(sal.data)
    }).finally(() => setLoading(false))
  }, [])

  const moneda = user?.moneda_preferida || 'USD'
  const fmt = v => new Intl.NumberFormat('es-CL', { style: 'currency', currency: moneda, maximumFractionDigits: 0 }).format(v)
  const mm  = (monto, freq) => parseFloat(monto) * (FREQ[freq] || 1)

  const saldoActivo = saldo && saldo.activo ? parseFloat(saldo.monto) : 0

  const totalIng    = data.ingresos.filter(i => i.activo).reduce((s, i) => s + mm(i.monto, i.frecuencia), 0) + saldoActivo
  const totalGC     = data.gastosCorrientes.filter(g => g.activo).reduce((s, g) => s + mm(g.monto, g.frecuencia), 0)
  const totalDif    = data.diferidos.filter(d => d.activo).reduce((s, d) => s + parseFloat(d.cuota_mensual), 0)
  const totalGastos = totalGC + totalDif
  const balance     = totalIng - totalGastos

  const hoy = new Date()
  const flujoCaja = Array.from({ length: 12 }, (_, i) => {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
    const mes   = `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`
    const ingBase = data.ingresos.filter(item => {
      if (!item.activo) return false
      const ini = new Date(item.fecha_inicio)
      const fin = item.fecha_fin ? new Date(item.fecha_fin) : null
      return ini <= fecha && (!fin || fin >= fecha)
    }).reduce((s, item) => s + mm(item.monto, item.frecuencia), 0)
    // El saldo mes anterior solo suma en el mes actual (i === 0)
    const ingTotal = ingBase + (i === 0 ? saldoActivo : 0)
    const gastos  = data.gastosCorrientes.filter(item => {
      if (!item.activo) return false
      const ini = new Date(item.fecha_inicio)
      const fin = item.fecha_fin ? new Date(item.fecha_fin) : null
      return ini <= fecha && (!fin || fin >= fecha)
    }).reduce((s, item) => s + mm(item.monto, item.frecuencia), 0)
    const difs = data.diferidos.filter(item => {
      if (!item.activo) return false
      const ini = new Date(item.fecha_inicio)
      const fin = new Date(item.fecha_fin)
      return ini <= fecha && fin >= fecha
    }).reduce((s, item) => s + parseFloat(item.cuota_mensual), 0)
    return { mes, ingresos: Math.round(ingTotal), gastos: Math.round(gastos + difs), balance: Math.round(ingTotal - gastos - difs) }
  })

  // ── Guardar / crear saldo mes ──
  async function guardarSaldo() {
    const monto = parseFloat(valorSaldo)
    if (isNaN(monto) || monto < 0) return
    setSavingSaldo(true)
    try {
      if (saldo?.existe) {
        const { data: d } = await api.patch(`/finanzas/saldo-mes/${saldo.id}/`, { monto })
        setSaldo({ ...saldo, ...d, existe: true })
      } else {
        const { data: d } = await api.post('/finanzas/saldo-mes/', {
          anio: saldo.anio, mes: saldo.mes, monto, activo: true,
        })
        setSaldo({ ...d, existe: true })
      }
      setEditSaldo(false)
    } finally { setSavingSaldo(false) }
  }

  async function recalcular() {
    setRecalculando(true); setRecalcError('')
    try {
      // Recalcula el mes anterior (por defecto en el backend)
      const { data: d } = await api.post('/finanzas/saldo-mes/recalcular/', {})
      setSaldo({ ...d, existe: true })
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al recalcular'
      setRecalcError(msg)
      setTimeout(() => setRecalcError(''), 5000)
    } finally { setRecalculando(false) }
  }

  async function toggleSaldo() {
    if (!saldo) return
    if (!saldo.existe) {
      // Confirmar el saldo sugerido como inactivo (guardarlo con activo=false)
      const { data: d } = await api.post('/finanzas/saldo-mes/', {
        anio: saldo.anio, mes: saldo.mes, monto: saldo.monto, activo: false,
      })
      setSaldo({ ...d, existe: true })
    } else {
      const { data: d } = await api.patch(`/finanzas/saldo-mes/${saldo.id}/`, { activo: !saldo.activo })
      setSaldo({ ...saldo, ...d, existe: true })
    }
  }

  if (loading) {
    return (
      <div className="loading-screen" style={{ minHeight: '60vh' }}>
        <div className="spinner" />
      </div>
    )
  }

  const hora    = new Date().getHours()
  const saludo  = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches'
  const nombre  = user?.username ? `, ${user.username}` : ''
  const montoSaldo = saldo ? parseFloat(saldo.monto) : 0

  return (
    <div>
      {/* ── HEADER ── */}
      <div className="page-header">
        <h1 className="page-title">{saludo}{nombre} 👋</h1>
        <p className="page-subtitle">Así va tu plata este mes — todo en tiempo real.</p>
      </div>

      {/* ── BANNER SALDO MES ANTERIOR ── */}
      {saldo !== null && (
        <div style={{
          marginBottom: 20, borderRadius: 16, padding: '16px 20px',
          background: saldo.activo ? 'rgba(196,135,246,0.08)' : 'rgba(255,255,255,0.03)',
          border: `1.5px solid ${saldo.activo ? 'rgba(196,135,246,0.25)' : 'rgba(255,255,255,0.07)'}`,
        }}>
          {/* Fila superior: título + chips + toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20 }}>💰</span>
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
                déficit
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={toggleSaldo}
                style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: `1px solid ${saldo.activo ? 'rgba(196,135,246,0.30)' : 'rgba(255,255,255,0.10)'}`, borderRadius: 10, padding: '5px 11px', cursor: 'pointer', color: saldo.activo ? '#C487F6' : 'rgba(255,255,255,0.30)', fontSize: 12, fontWeight: 600 }}>
                {saldo.activo ? <><ToggleRight size={16} /> Incluido</> : <><ToggleLeft size={16} /> No incluido</>}
              </button>
            </div>
          </div>

          {/* Fila monto + edición + recalcular */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {editSaldo ? (
              <>
                <input type="number" step="0.01"
                  value={valorSaldo} onChange={e => setValorSaldo(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') guardarSaldo(); if (e.key === 'Escape') setEditSaldo(false) }}
                  autoFocus
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(196,135,246,0.40)', borderRadius: 10, color: '#fff', padding: '6px 12px', fontSize: 15, width: 170, outline: 'none' }}
                />
                <button onClick={guardarSaldo} disabled={savingSaldo}
                  style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.30)', borderRadius: 8, padding: '6px 9px', color: '#10B981', cursor: 'pointer', display: 'flex' }}>
                  <Check size={15} />
                </button>
                <button onClick={() => setEditSaldo(false)}
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, padding: '6px 9px', color: 'rgba(255,255,255,0.40)', cursor: 'pointer', display: 'flex' }}>
                  <X size={15} />
                </button>
              </>
            ) : (
              <>
                <span style={{ fontWeight: 800, fontSize: 22, color: montoSaldo >= 0 ? (saldo.activo ? '#fff' : 'rgba(255,255,255,0.25)') : '#F87171', textDecoration: saldo.activo ? 'none' : 'line-through' }}>
                  {fmt(montoSaldo)}
                </span>
                <button onClick={() => { setValorSaldo(montoSaldo); setEditSaldo(true) }}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.30)', cursor: 'pointer', display: 'flex', padding: 2 }}>
                  <Pencil size={14} />
                </button>
              </>
            )}

            {/* Botón recalcular */}
            <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <button onClick={recalcular}
                disabled={recalculando || (saldo.recalculos_restantes === 0)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '7px 14px', cursor: recalculando || saldo.recalculos_restantes === 0 ? 'not-allowed' : 'pointer', color: recalculando || saldo.recalculos_restantes === 0 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: 600, opacity: saldo.recalculos_restantes === 0 ? 0.5 : 1 }}>
                <RefreshCw size={14} style={{ animation: recalculando ? 'spin 1s linear infinite' : 'none' }} />
                {recalculando ? 'Calculando...' : 'Recalcular'}
              </button>
              {saldo.recalculos_restantes !== undefined && (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
                  {saldo.recalculos_restantes} recálculos restantes hoy
                </span>
              )}
            </div>
          </div>

          {recalcError && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#F87171', background: 'rgba(248,113,113,0.10)', borderRadius: 8, padding: '6px 12px' }}>
              {recalcError}
            </div>
          )}
        </div>
      )}

      {/* ── STAT CARDS ── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <span className="stat-label">Lo que entra</span>
            <TrendingUp size={18} style={{ color: '#10B981', opacity: 0.8 }} />
          </div>
          <div className="stat-value green">{fmt(totalIng)}</div>
          <div className="stat-sub">Ingresos + saldo anterior{saldoActivo > 0 ? ` (inc. ${fmt(saldoActivo)})` : ''}</div>
        </div>
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <span className="stat-label">Lo que sale</span>
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
          <div className="stat-sub">{balance >= 0 ? '✓ Vas bien este mes' : '⚠ Revisa tus gastos'}</div>
        </div>
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <span className="stat-label">Cuotas activas</span>
            <CreditCard size={18} style={{ color: '#C487F6', opacity: 0.8 }} />
          </div>
          <div className="stat-value lila">{data.diferidos.filter(d => d.activo).length}</div>
          <div className="stat-sub">{fmt(totalDif)}/mes en diferidos</div>
        </div>
      </div>

      {/* ── GRÁFICO ── */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Tu flujo de caja — próximos 12 meses</h2>
        </div>
        {flujoCaja.every(f => f.ingresos === 0 && f.gastos === 0) ? (
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <p className="empty-text">Todavía no hay datos para graficar</p>
            <p className="empty-sub">Agrega ingresos y gastos para ver tu proyección</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={flujoCaja} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="gIngresos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10B981" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gGastos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#F87171" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#F87171" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="mes" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} tickFormatter={v => fmt(v)} width={90} />
              <Tooltip
                contentStyle={{ background: 'rgba(26,37,64,0.95)', border: '1px solid rgba(196,135,246,0.2)', borderRadius: 12 }}
                labelStyle={{ color: '#fff', marginBottom: 4, fontWeight: 700 }}
                formatter={(val, name) => [fmt(val), name === 'ingresos' ? '↑ Entra' : name === 'gastos' ? '↓ Sale' : '= Balance']}
              />
              <Legend formatter={v => v === 'ingresos' ? 'Entra' : v === 'gastos' ? 'Sale' : 'Balance'} />
              <Area type="monotone" dataKey="ingresos" stroke="#10B981" fill="url(#gIngresos)" strokeWidth={2.5} />
              <Area type="monotone" dataKey="gastos"   stroke="#F87171" fill="url(#gGastos)"   strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
