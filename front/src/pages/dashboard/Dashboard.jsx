import { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { TrendingUp, TrendingDown, Wallet, AlertCircle } from 'lucide-react'
import api from '../../api/client'
import { useAuth } from '../../context/useAuth'

function StatCard({ title, value, icon, color, sub }) {
  const IconComponent = icon
  return (
    <div className="bg-[#1E293B] rounded-xl p-5 border border-[#334155]">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-[#94A3B8]">{title}</p>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          <IconComponent size={18} className="text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-[#475569] mt-1">{sub}</p>}
    </div>
  )
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export default function Dashboard() {
  const { user } = useAuth()
  const [data, setData] = useState({ ingresos: [], gastosCorrientes: [], gastosNoCorrientes: [], diferidos: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/finanzas/ingresos/'),
      api.get('/finanzas/gastos-corrientes/'),
      api.get('/finanzas/gastos-no-corrientes/'),
      api.get('/finanzas/diferidos/'),
    ]).then(([ing, gc, gnc, dif]) => {
      setData({
        ingresos: ing.data,
        gastosCorrientes: gc.data,
        gastosNoCorrientes: gnc.data,
        diferidos: dif.data,
      })
    }).finally(() => setLoading(false))
  }, [])

  const moneda = user?.moneda_preferida || 'USD'

  function fmt(val) {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: moneda, maximumFractionDigits: 0 }).format(val)
  }

  function montoMensual(monto, frecuencia) {
    const map = { diario: 30, semanal: 4.33, quincenal: 2, mensual: 1, bimestral: 0.5, trimestral: 0.333, semestral: 0.167, anual: 0.083 }
    return parseFloat(monto) * (map[frecuencia] || 1)
  }

  const totalIngMensual = data.ingresos.filter(i => i.activo).reduce((s, i) => s + montoMensual(i.monto, i.frecuencia), 0)
  const totalGCMensual = data.gastosCorrientes.filter(g => g.activo).reduce((s, g) => s + montoMensual(g.monto, g.frecuencia), 0)
  const totalDifMensual = data.diferidos.filter(d => d.activo).reduce((s, d) => s + parseFloat(d.cuota_mensual), 0)
  const totalGastosMensual = totalGCMensual + totalDifMensual
  const balanceMensual = totalIngMensual - totalGastosMensual

  // Generar flujo de caja 12 meses
  const hoy = new Date()
  const flujoCaja = Array.from({ length: 12 }, (_, i) => {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
    const mes = MESES[fecha.getMonth()]
    const año = fecha.getFullYear()

    const ing = data.ingresos.filter(item => {
      if (!item.activo) return false
      const ini = new Date(item.fecha_inicio)
      const fin = item.fecha_fin ? new Date(item.fecha_fin) : null
      return ini <= fecha && (!fin || fin >= fecha)
    }).reduce((s, item) => s + montoMensual(item.monto, item.frecuencia), 0)

    const gastos = data.gastosCorrientes.filter(item => {
      if (!item.activo) return false
      const ini = new Date(item.fecha_inicio)
      const fin = item.fecha_fin ? new Date(item.fecha_fin) : null
      return ini <= fecha && (!fin || fin >= fecha)
    }).reduce((s, item) => s + montoMensual(item.monto, item.frecuencia), 0)

    const difs = data.diferidos.filter(item => {
      if (!item.activo) return false
      const ini = new Date(item.fecha_inicio)
      const fin = new Date(item.fecha_fin)
      return ini <= fecha && fin >= fecha
    }).reduce((s, item) => s + parseFloat(item.cuota_mensual), 0)

    const totalGastos = gastos + difs
    return { mes: `${mes} ${año}`, ingresos: Math.round(ing), gastos: Math.round(totalGastos), balance: Math.round(ing - totalGastos) }
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#10B981] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-[#94A3B8] text-sm mt-1">Resumen financiero mensual</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Ingresos mensuales" value={fmt(totalIngMensual)} icon={TrendingUp} color="bg-[#10B981]" sub="Promedio recurrente" />
        <StatCard title="Gastos mensuales" value={fmt(totalGastosMensual)} icon={TrendingDown} color="bg-rose-500" sub="Corrientes + diferidos" />
        <StatCard title="Balance mensual" value={fmt(balanceMensual)} icon={Wallet} color={balanceMensual >= 0 ? 'bg-[#10B981]' : 'bg-rose-500'} sub={balanceMensual >= 0 ? 'Superávit' : 'Déficit'} />
        <StatCard title="Diferidos activos" value={data.diferidos.filter(d => d.activo).length} icon={AlertCircle} color="bg-amber-500" sub={`${fmt(totalDifMensual)}/mes`} />
      </div>

      {/* Gráfico flujo de caja */}
      <div className="bg-[#1E293B] rounded-xl p-6 border border-[#334155]">
        <h2 className="text-base font-semibold text-white mb-4">Flujo de Caja — Próximos 12 meses</h2>
        {flujoCaja.every(f => f.ingresos === 0 && f.gastos === 0) ? (
          <div className="flex flex-col items-center justify-center h-48 text-[#475569]">
            <Wallet size={32} className="mb-2" />
            <p className="text-sm">Agrega ingresos y gastos para ver tu flujo de caja</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={flujoCaja} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="gIngresos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gGastos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="mes" tick={{ fill: '#64748B', fontSize: 11 }} />
              <YAxis tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => fmt(v)} width={80} />
              <Tooltip
                contentStyle={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#CBD5E1', marginBottom: 4 }}
                formatter={(val, name) => [fmt(val), name === 'ingresos' ? 'Ingresos' : name === 'gastos' ? 'Gastos' : 'Balance']}
              />
              <Legend formatter={v => v === 'ingresos' ? 'Ingresos' : v === 'gastos' ? 'Gastos' : 'Balance'} />
              <Area type="monotone" dataKey="ingresos" stroke="#10B981" fill="url(#gIngresos)" strokeWidth={2} />
              <Area type="monotone" dataKey="gastos" stroke="#f43f5e" fill="url(#gGastos)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
