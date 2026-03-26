import { useEffect, useState } from 'react'
import { BarChart2, Calculator, CheckCircle, XCircle, Save, Trash2 } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import api from '../../api/client'
import { useAuth } from '../../context/useAuth'

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
  const [bancos, setBancos] = useState([])
  const [simulaciones, setSimulaciones] = useState([])
  const [flujoBase, setFlujoBase] = useState([])

  const [form, setForm] = useState({ nombre: '', monto: '', banco: '', tasa_anual: '', plazo_meses: '12', fecha_inicio: new Date().toISOString().split('T')[0] })
  const [resultado, setResultado] = useState(null)
  const [guardando, setGuardando] = useState(false)

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

    const hoy = new Date()
    const mapa = { diario: 30, semanal: 4.33, quincenal: 2, mensual: 1, bimestral: 0.5, trimestral: 0.333, semestral: 0.167, anual: 0.083 }

    const flujo = Array.from({ length: 24 }, (_, i) => {
      const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
      const mes = `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`

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
    const cuota = calcularCuota(form.monto, form.tasa_anual, form.plazo_meses)
    const totalPagar = cuota * parseInt(form.plazo_meses)
    const totalIntereses = totalPagar - parseFloat(form.monto)

    const hoy = new Date()
    const flujoConPrestamo = Array.from({ length: 24 }, (_, i) => {
      const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
      const mes = `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`
      const inicio = new Date(form.fecha_inicio)
      const finPrestamo = new Date(inicio.getFullYear(), inicio.getMonth() + parseInt(form.plazo_meses), 1)
      const tieneCuota = fecha >= inicio && fecha < finPrestamo

      const base = flujoBase[i] || { ingresos: 0, gastos: 0, balance: 0 }
      const gastosSim = base.gastos + (tieneCuota ? Math.round(cuota) : 0)
      return { mes, ingresos: base.ingresos, gastosSim, balanceSim: base.ingresos - gastosSim, balanceBase: base.balance }
    })

    const mesesConDeficit = flujoConPrestamo.filter((f, i) => {
      const inicio = new Date(form.fecha_inicio)
      const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
      const finPrestamo = new Date(inicio.getFullYear(), inicio.getMonth() + parseInt(form.plazo_meses), 1)
      return fecha >= inicio && fecha < finPrestamo && f.balanceSim < 0
    })

    setResultado({ cuota, totalPagar, totalIntereses, flujoConPrestamo, mesesConDeficit, factible: mesesConDeficit.length === 0 })
  }

  async function guardarSimulacion() {
    setGuardando(true)
    try {
      await api.post('/simulador/simulaciones/', {
        nombre: form.nombre,
        monto: form.monto,
        banco: form.banco || null,
        tasa_anual: form.tasa_anual,
        plazo_meses: form.plazo_meses,
        cuota_mensual: resultado.cuota.toFixed(2),
        total_a_pagar: resultado.totalPagar.toFixed(2),
        total_intereses: resultado.totalIntereses.toFixed(2),
        fecha_inicio: form.fecha_inicio,
      })
      const { data } = await api.get('/simulador/simulaciones/')
      setSimulaciones(data)
    } finally { setGuardando(false) }
  }

  async function eliminarSimulacion(id) {
    if (!confirm('¿Eliminar esta simulación?')) return
    await api.delete(`/simulador/simulaciones/${id}/`)
    setSimulaciones(simulaciones.filter(s => s.id !== id))
  }

  const moneda = user?.moneda_preferida || 'USD'
  const fmt = v => new Intl.NumberFormat('es-CL', { style: 'currency', currency: moneda, maximumFractionDigits: 0 }).format(v)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Simulador de Préstamos</h1>
        <p className="text-[#94A3B8] text-sm mt-1">Evalúa si una compra o inversión es factible en tu flujo de caja</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Formulario */}
        <div className="bg-[#1E293B] rounded-xl border border-[#334155] p-6">
          <h2 className="font-semibold text-white mb-4 flex items-center gap-2"><Calculator size={18} /> Nueva simulación</h2>
          <form onSubmit={simular} className="space-y-4">
            <div>
              <label className="text-sm text-[#94A3B8] block mb-1.5">¿Qué quieres comprar?</label>
              <input required value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]"
                placeholder="Ej: iPhone 15 Pro, Casa en Santiago..." />
            </div>
            <div>
              <label className="text-sm text-[#94A3B8] block mb-1.5">Monto del préstamo</label>
              <input type="number" required min="1" step="0.01" value={form.monto}
                onChange={e => setForm({ ...form, monto: e.target.value })}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]"
                placeholder="0" />
            </div>
            <div>
              <label className="text-sm text-[#94A3B8] block mb-1.5">Banco <span className="text-[#475569]">(opcional)</span></label>
              <select value={form.banco} onChange={e => handleBanco(e.target.value)}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]">
                <option value="">— Sin banco específico —</option>
                {bancos.map(b => <option key={b.id} value={b.id}>{b.nombre} ({b.tasa_anual_minima}% – {b.tasa_anual_maxima}% anual)</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-[#94A3B8] block mb-1.5">Tasa anual (%)</label>
                <input type="number" required min="0" step="0.01" value={form.tasa_anual}
                  onChange={e => setForm({ ...form, tasa_anual: e.target.value })}
                  className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]"
                  placeholder="Ej: 8.5" />
              </div>
              <div>
                <label className="text-sm text-[#94A3B8] block mb-1.5">Plazo (meses)</label>
                <input type="number" required min="1" max="360" value={form.plazo_meses}
                  onChange={e => setForm({ ...form, plazo_meses: e.target.value })}
                  className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]"
                  placeholder="12" />
              </div>
            </div>
            <div>
              <label className="text-sm text-[#94A3B8] block mb-1.5">Fecha de inicio del préstamo</label>
              <input type="date" required value={form.fecha_inicio}
                onChange={e => setForm({ ...form, fecha_inicio: e.target.value })}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#10B981]" />
            </div>
            <button type="submit" className="w-full bg-[#10B981] hover:bg-[#059669] text-white font-semibold py-2.5 rounded-lg transition-colors">
              Simular
            </button>
          </form>
        </div>

        {/* Resultado */}
        <div className="space-y-4">
          {resultado ? (
            <>
              <div className={`rounded-xl border p-5 flex items-center gap-4 ${resultado.factible ? 'bg-[#10B981]/10 border-[#10B981]/30' : 'bg-red-500/10 border-red-500/30'}`}>
                {resultado.factible
                  ? <CheckCircle size={32} className="text-[#10B981] shrink-0" />
                  : <XCircle size={32} className="text-red-400 shrink-0" />
                }
                <div>
                  <p className={`font-bold text-lg ${resultado.factible ? 'text-[#10B981]' : 'text-red-400'}`}>
                    {resultado.factible ? '¡Es factible!' : 'No es factible'}
                  </p>
                  <p className="text-[#94A3B8] text-sm">
                    {resultado.factible
                      ? 'Tu flujo de caja soporta este préstamo.'
                      : `Hay ${resultado.mesesConDeficit.length} mes(es) con déficit.`}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Cuota mensual', value: fmt(resultado.cuota), color: 'text-white' },
                  { label: 'Total a pagar', value: fmt(resultado.totalPagar), color: 'text-amber-400' },
                  { label: 'Total intereses', value: fmt(resultado.totalIntereses), color: 'text-rose-400' },
                ].map(s => (
                  <div key={s.label} className="bg-[#1E293B] rounded-xl border border-[#334155] p-4 text-center">
                    <p className="text-xs text-[#475569] mb-1">{s.label}</p>
                    <p className={`font-bold text-sm ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              <button onClick={guardarSimulacion} disabled={guardando}
                className="w-full flex items-center justify-center gap-2 border border-[#10B981]/50 text-[#10B981] hover:bg-[#10B981]/10 py-2.5 rounded-lg transition-colors text-sm font-medium">
                <Save size={16} /> {guardando ? 'Guardando...' : 'Guardar simulación'}
              </button>
            </>
          ) : (
            <div className="bg-[#1E293B] rounded-xl border border-[#334155] flex flex-col items-center justify-center h-64 text-[#475569]">
              <BarChart2 size={32} className="mb-2" />
              <p className="text-sm">Completa el formulario y presiona Simular</p>
            </div>
          )}
        </div>
      </div>

      {/* Gráfico flujo con préstamo */}
      {resultado && (
        <div className="bg-[#1E293B] rounded-xl border border-[#334155] p-6">
          <h2 className="font-semibold text-white mb-4">Flujo de Caja con Préstamo (24 meses)</h2>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={resultado.flujoConPrestamo} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="gIng" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gGas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} /><stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="mes" tick={{ fill: '#64748B', fontSize: 10 }} />
              <YAxis tick={{ fill: '#64748B', fontSize: 10 }} tickFormatter={v => fmt(v)} width={90} />
              <Tooltip contentStyle={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#CBD5E1' }}
                formatter={(v, n) => [fmt(v), n === 'ingresos' ? 'Ingresos' : n === 'gastosSim' ? 'Gastos+Cuota' : n === 'balanceSim' ? 'Balance con préstamo' : 'Balance actual']} />
              <Legend formatter={v => v === 'ingresos' ? 'Ingresos' : v === 'gastosSim' ? 'Gastos + Cuota' : v === 'balanceSim' ? 'Balance con préstamo' : 'Balance actual'} />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" />
              <Area type="monotone" dataKey="ingresos" stroke="#10B981" fill="url(#gIng)" strokeWidth={2} />
              <Area type="monotone" dataKey="gastosSim" stroke="#f43f5e" fill="url(#gGas)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Simulaciones guardadas */}
      {simulaciones.length > 0 && (
        <div className="bg-[#1E293B] rounded-xl border border-[#334155] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#334155]">
            <h2 className="font-semibold text-white">Simulaciones guardadas</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#334155]">
                {['Nombre', 'Monto', 'Banco', 'Tasa', 'Plazo', 'Cuota', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-[#475569] uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {simulaciones.map(s => (
                <tr key={s.id} className="border-b border-[#334155]/50 hover:bg-[#334155]/20 transition-colors">
                  <td className="px-4 py-3 text-white text-sm">{s.nombre}</td>
                  <td className="px-4 py-3 text-[#94A3B8] text-sm">{fmt(s.monto)}</td>
                  <td className="px-4 py-3 text-[#94A3B8] text-sm">{s.banco_nombre || '—'}</td>
                  <td className="px-4 py-3 text-[#94A3B8] text-sm">{s.tasa_anual}%</td>
                  <td className="px-4 py-3 text-[#94A3B8] text-sm">{s.plazo_meses} m</td>
                  <td className="px-4 py-3 text-[#10B981] font-semibold text-sm">{fmt(s.cuota_mensual)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => eliminarSimulacion(s.id)} className="text-[#475569] hover:text-red-400 transition-colors"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
