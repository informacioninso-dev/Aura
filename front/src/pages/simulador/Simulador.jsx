import { useEffect, useState } from 'react'
import { Calculator, CheckCircle, XCircle, Save, Trash2, CreditCard } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import api from '../../api/client'
import { useAuth } from '../../context/useAuth'
import '../../components/ui/app.css'

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function calcularCuota(monto, tasaAnual, plazoMeses) {
  if (!monto || !tasaAnual || !plazoMeses) return 0
  const r = parseFloat(tasaAnual) / 100 / 12
  const n = parseInt(plazoMeses)
  const P = parseFloat(monto)
  if (r === 0) return P / n
  return P * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
}

export default function Simulador() {
  const { user } = useAuth()
  const [bancos, setBancos]           = useState([])
  const [simulaciones, setSimulaciones] = useState([])
  const [flujoBase, setFlujoBase]     = useState([])
  const [form, setForm]               = useState({ nombre: '', monto: '', banco: '', tasa_anual: '', plazo_meses: '12', fecha_inicio: new Date().toISOString().split('T')[0] })
  const [resultado, setResultado]     = useState(null)
  const [guardando, setGuardando]     = useState(false)
  const [diferidoOk, setDiferidoOk]  = useState(false)
  const [agregando, setAgregando]     = useState(false)

  useEffect(() => {
    api.get('/simulador/bancos/').then(r => setBancos(r.data))
    api.get('/simulador/simulaciones/').then(r => setSimulaciones(r.data))
    cargarFlujoBase()
  }, [])

  async function cargarFlujoBase() {
    const [ing, gc, dif] = await Promise.all([
      api.get('/finanzas/ingresos/'),
      api.get('/finanzas/gastos-corrientes/'),
      api.get('/finanzas/diferidos/'),
    ])
    const hoy  = new Date()
    const mapa = { diario: 30, semanal: 4.33, quincenal: 2, mensual: 1, bimestral: 0.5, trimestral: 0.333, semestral: 0.167, anual: 0.083 }
    const flujo = Array.from({ length: 24 }, (_, i) => {
      const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
      const mes   = `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`
      const ingresos = ing.data.filter(item => {
        if (!item.activo) return false
        const ini = new Date(item.fecha_inicio)
        const fin = item.fecha_fin ? new Date(item.fecha_fin) : null
        return ini <= fecha && (!fin || fin >= fecha)
      }).reduce((s, item) => s + parseFloat(item.monto) * (mapa[item.frecuencia] || 1), 0)
      const gastos = gc.data.filter(item => {
        if (!item.activo) return false
        const ini = new Date(item.fecha_inicio)
        const fin = item.fecha_fin ? new Date(item.fecha_fin) : null
        return ini <= fecha && (!fin || fin >= fecha)
      }).reduce((s, item) => s + parseFloat(item.monto) * (mapa[item.frecuencia] || 1), 0)
      const difs = dif.data.filter(item => {
        if (!item.activo) return false
        const ini = new Date(item.fecha_inicio)
        const fin = new Date(item.fecha_fin)
        return ini <= fecha && fin >= fecha
      }).reduce((s, item) => s + parseFloat(item.cuota_mensual), 0)
      return { mes, ingresos: Math.round(ingresos), gastos: Math.round(gastos + difs), balance: Math.round(ingresos - gastos - difs) }
    })
    setFlujoBase(flujo)
  }

  function handleBanco(id) {
    const banco = bancos.find(b => b.id === parseInt(id))
    setForm({ ...form, banco: id, tasa_anual: banco ? banco.tasa_anual_minima : form.tasa_anual })
  }

  function simular(e) {
    e.preventDefault()
    const cuota          = calcularCuota(form.monto, form.tasa_anual, form.plazo_meses)
    const totalPagar     = cuota * parseInt(form.plazo_meses)
    const totalIntereses = totalPagar - parseFloat(form.monto)
    const hoy = new Date()
    const flujoConPrestamo = Array.from({ length: 24 }, (_, i) => {
      const fecha      = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
      const mes        = `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`
      const inicio     = new Date(form.fecha_inicio)
      const finPrestamo = new Date(inicio.getFullYear(), inicio.getMonth() + parseInt(form.plazo_meses), 1)
      const tieneCuota = fecha >= inicio && fecha < finPrestamo
      const base       = flujoBase[i] || { ingresos: 0, gastos: 0, balance: 0 }
      const gastosSim  = base.gastos + (tieneCuota ? Math.round(cuota) : 0)
      return { mes, ingresos: base.ingresos, gastosSim, balanceSim: base.ingresos - gastosSim, balanceBase: base.balance }
    })
    const mesesConDeficit = flujoConPrestamo.filter((f, i) => {
      const inicio = new Date(form.fecha_inicio)
      const fecha  = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
      const finPrestamo = new Date(inicio.getFullYear(), inicio.getMonth() + parseInt(form.plazo_meses), 1)
      return fecha >= inicio && fecha < finPrestamo && f.balanceSim < 0
    })
    setResultado({ cuota, totalPagar, totalIntereses, flujoConPrestamo, mesesConDeficit, factible: mesesConDeficit.length === 0 })
  }

  async function guardarSimulacion() {
    setGuardando(true)
    try {
      await api.post('/simulador/simulaciones/', {
        nombre: form.nombre, monto: form.monto, banco: form.banco || null,
        tasa_anual: form.tasa_anual, plazo_meses: form.plazo_meses,
        cuota_mensual: resultado.cuota.toFixed(2), total_a_pagar: resultado.totalPagar.toFixed(2),
        total_intereses: resultado.totalIntereses.toFixed(2), fecha_inicio: form.fecha_inicio,
      })
      const { data } = await api.get('/simulador/simulaciones/')
      setSimulaciones(data)
    } finally { setGuardando(false) }
  }

  async function agregarComoDiferido() {
    setAgregando(true)
    try {
      const ini = new Date(form.fecha_inicio + 'T00:00:00')
      const fin = new Date(ini.getFullYear(), ini.getMonth() + parseInt(form.plazo_meses), ini.getDate())
      await api.post('/finanzas/diferidos/', {
        descripcion:    form.nombre,
        categoria:      'otro',
        monto_total:    form.monto,
        num_cuotas:     form.plazo_meses,
        cuota_mensual:  resultado.cuota.toFixed(2),
        fecha_inicio:   form.fecha_inicio,
        fecha_fin:      fin.toISOString().split('T')[0],
        activo:         true,
      })
      setDiferidoOk(true)
      setTimeout(() => setDiferidoOk(false), 4000)
    } finally { setAgregando(false) }
  }

  async function eliminarSimulacion(id) {
    if (!confirm('¿Eliminar esta simulación?')) return
    await api.delete(`/simulador/simulaciones/${id}/`)
    setSimulaciones(simulaciones.filter(s => s.id !== id))
  }

  const moneda = user?.moneda_preferida || 'USD'
  const fmt = v => new Intl.NumberFormat('es-CL', { style: 'currency', currency: moneda, maximumFractionDigits: 0 }).format(v)

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Simulador de préstamos</h1>
        <p className="page-subtitle">¿Te alcanza para ese crédito? Simúlalo antes de firmar.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* ── FORMULARIO ── */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <Calculator size={18} style={{ color: '#C487F6' }} />
            <h2 style={{ fontWeight: 700, fontSize: 15 }}>Nueva simulación</h2>
          </div>
          <form onSubmit={simular}>
            <div className="form-modal-group">
              <label className="form-modal-label">¿Qué quieres comprar?</label>
              <input className="form-modal-input" required placeholder="Ej: iPhone, moto, viaje..."
                value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">Monto del préstamo</label>
              <input className="form-modal-input" type="number" required min="1" step="0.01" placeholder="0"
                value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })} />
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">Banco <span>(opcional)</span></label>
              <select className="form-modal-select" value={form.banco} onChange={e => handleBanco(e.target.value)}>
                <option value="">— Sin banco específico —</option>
                {bancos.map(b => <option key={b.id} value={b.id}>{b.nombre} ({b.tasa_anual_minima}%–{b.tasa_anual_maxima}% anual)</option>)}
              </select>
            </div>
            <div className="form-modal-row">
              <div className="form-modal-group">
                <label className="form-modal-label">Tasa anual (%)</label>
                <input className="form-modal-input" type="number" required min="0" step="0.01" placeholder="8.5"
                  value={form.tasa_anual} onChange={e => setForm({ ...form, tasa_anual: e.target.value })} />
              </div>
              <div className="form-modal-group">
                <label className="form-modal-label">Plazo (meses)</label>
                <input className="form-modal-input" type="number" required min="1" max="360" placeholder="12"
                  value={form.plazo_meses} onChange={e => setForm({ ...form, plazo_meses: e.target.value })} />
              </div>
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">¿Desde cuándo empieza?</label>
              <div className="date-input-wrap">
                <input className="form-modal-input" type="date" required
                  value={form.fecha_inicio} onChange={e => setForm({ ...form, fecha_inicio: e.target.value })} />
              </div>
            </div>
            <button type="submit" className="btn-modal-save" style={{ width: '100%', padding: '12px 0', marginTop: 4 }}>
              Simular
            </button>
          </form>
        </div>

        {/* ── RESULTADO ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {resultado ? (
            <>
              <div className="card" style={{ padding: 20, background: resultado.factible ? 'rgba(16,185,129,0.08)' : 'rgba(248,113,113,0.08)', border: `1px solid ${resultado.factible ? 'rgba(16,185,129,0.25)' : 'rgba(248,113,113,0.25)'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {resultado.factible
                    ? <CheckCircle size={36} style={{ color: '#10B981', flexShrink: 0 }} />
                    : <XCircle    size={36} style={{ color: '#F87171', flexShrink: 0 }} />
                  }
                  <div>
                    <p style={{ fontWeight: 800, fontSize: 18, color: resultado.factible ? '#10B981' : '#F87171' }}>
                      {resultado.factible ? '¡Te alcanza!' : 'No te alcanza'}
                    </p>
                    <p style={{ color: 'rgba(255,255,255,0.50)', fontSize: 13 }}>
                      {resultado.factible
                        ? 'Tu flujo de caja aguanta este préstamo.'
                        : `${resultado.mesesConDeficit.length} mes(es) con déficit durante el crédito.`}
                    </p>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Cuota mensual', value: fmt(resultado.cuota),          color: '#fff' },
                  { label: 'Total a pagar',  value: fmt(resultado.totalPagar),     color: '#F87171' },
                  { label: 'En intereses',   value: fmt(resultado.totalIntereses), color: '#C487F6' },
                ].map(s => (
                  <div key={s.label} className="card" style={{ padding: 16, textAlign: 'center' }}>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginBottom: 6 }}>{s.label}</p>
                    <p style={{ fontWeight: 700, color: s.color, fontSize: 14 }}>{s.value}</p>
                  </div>
                ))}
              </div>

              <button onClick={guardarSimulacion} disabled={guardando} className="btn-modal-cancel"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0', border: '1.5px solid rgba(196,135,246,0.30)', color: '#C487F6' }}>
                <Save size={16} /> {guardando ? 'Guardando...' : 'Guardar simulación'}
              </button>

              {resultado.factible && (
                diferidoOk ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0', background: 'rgba(16,185,129,0.10)', border: '1.5px solid rgba(16,185,129,0.25)', borderRadius: 12, color: '#10B981', fontSize: 14, fontWeight: 600 }}>
                    <CheckCircle size={16} /> ¡Agregado a tus cuotas!
                  </div>
                ) : (
                  <button onClick={agregarComoDiferido} disabled={agregando} className="btn-modal-save"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0' }}>
                    <CreditCard size={16} /> {agregando ? 'Agregando...' : 'Agregar como cuota a mi plan'}
                  </button>
                )
              )}
            </>
          ) : (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'rgba(255,255,255,0.25)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
              <p style={{ fontSize: 14 }}>Completa el formulario y presiona Simular</p>
            </div>
          )}
        </div>
      </div>

      {/* ── GRÁFICO ── */}
      {resultado && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <h2 className="card-title">Flujo de caja con el préstamo — 24 meses</h2>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={resultado.flujoConPrestamo} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="gSimIng" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10B981" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gSimGas" x1="0" y1="0" x2="0" y2="1">
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
                formatter={(v, n) => [fmt(v), n === 'ingresos' ? '↑ Entra' : n === 'gastosSim' ? '↓ Sale + cuota' : n === 'balanceSim' ? '= Con préstamo' : '= Sin préstamo']}
              />
              <Legend formatter={v => v === 'ingresos' ? 'Entra' : v === 'gastosSim' ? 'Sale + cuota' : 'Balance con préstamo'} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.20)" strokeDasharray="4 4" />
              <Area type="monotone" dataKey="ingresos"  stroke="#10B981" fill="url(#gSimIng)" strokeWidth={2.5} />
              <Area type="monotone" dataKey="gastosSim" stroke="#F87171" fill="url(#gSimGas)" strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── SIMULACIONES GUARDADAS ── */}
      {simulaciones.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-header" style={{ padding: '18px 24px 0' }}>
            <h2 className="card-title">Simulaciones guardadas</h2>
          </div>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead>
                <tr>{['Nombre', 'Monto', 'Banco', 'Tasa', 'Plazo', 'Cuota', ''].map(h => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {simulaciones.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.nombre}</td>
                    <td>{fmt(s.monto)}</td>
                    <td>{s.banco_nombre || '—'}</td>
                    <td>{s.tasa_anual}%</td>
                    <td>{s.plazo_meses} m</td>
                    <td className="table-amount positive">{fmt(s.cuota_mensual)}</td>
                    <td>
                      <button className="btn-icon danger" onClick={() => eliminarSimulacion(s.id)}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
