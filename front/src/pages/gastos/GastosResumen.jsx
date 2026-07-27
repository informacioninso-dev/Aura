import { useEffect, useState, useCallback } from 'react'
import { Home, Activity, CreditCard, Calendar, Plus, LineChart } from 'lucide-react'

import api from '../../api/client'
import { formatAmount } from '../../utils/formatters'
import { montoEfectivoMes } from '../../utils/frecuencias'
import '../../components/ui/app.css'

function overlapsMes(item, anio, mes) {
  const inicio = item.fecha_inicio
  const fin = item.fecha_fin
  const primer = `${anio}-${String(mes).padStart(2, '0')}-01`
  const ultimo = `${anio}-${String(mes).padStart(2, '0')}-31`
  return (!inicio || inicio <= ultimo) && (!fin || fin >= primer)
}

export default function GastosResumen({ onOpenTipo, onAgregar }) {
  const [t, setT] = useState(null)

  const cargar = useCallback(async () => {
    const now = new Date()
    const anio = now.getFullYear()
    const mes = now.getMonth() + 1
    try {
      const [dash, vars] = await Promise.all([
        api.get('/finanzas/dashboard/'),
        api.get(`/finanzas/gastos-corrientes/resumen_variables/?anio=${anio}&mes=${mes}`).catch(() => ({ data: [] })),
      ])
      const d = dash.data || {}
      const gc = d.gastos_corrientes || []

      const fijos = gc.filter((g) => (g.tipo_monto || 'fijo') === 'fijo' && g.activo && overlapsMes(g, anio, mes))
      const fijosTotal = fijos.reduce((s, g) => s + montoEfectivoMes(g.monto, g.frecuencia, g.fecha_inicio, anio, mes), 0)

      const variables = gc.filter((g) => g.tipo_monto === 'variable' && g.activo)
      // Total del mes por rubro: lo registrado o, si sigue pendiente, su sugerencia.
      const varTotal = (vars.data || []).reduce((s, f) => {
        const valor = f.real != null ? f.real : (f.sugerido ?? f.estimado ?? 0)
        return s + parseFloat(valor || 0)
      }, 0)
      const varPend = (vars.data || []).filter((f) => f.situacion === 'pendiente').length

      const dif = (d.diferidos || []).filter((x) => x.activo && overlapsMes(x, anio, mes))
      const cuotasTotal = dif.reduce((s, x) => s + parseFloat(x.cuota_mensual || 0), 0)

      const puntuales = (d.gastos_no_corrientes || []).length

      setT({
        fijosTotal, fijosCount: fijos.length,
        varTotal, varCount: variables.length, varPend,
        cuotasTotal, cuotasCount: dif.length,
        puntuales,
        proyeccion: fijosTotal + varTotal + cuotasTotal,
      })
    } catch {
      setT({ fijosTotal: 0, fijosCount: 0, varTotal: 0, varCount: 0, varPend: 0, cuotasTotal: 0, cuotasCount: 0, puntuales: 0, proyeccion: 0 })
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const cards = t && [
    { id: 'fijos', icon: Home, tint: '#4ADE80', title: 'Gastos fijos', valor: `$${formatAmount(t.fijosTotal)}`, unidad: '/ mes', sub: `${t.fijosCount} gasto${t.fijosCount !== 1 ? 's' : ''}` },
    { id: 'variables', icon: Activity, tint: '#C487F6', title: 'Gastos variables', valor: `$${formatAmount(t.varTotal)}`, unidad: '/ este mes', sub: t.varPend > 0 ? `${t.varPend} por registrar` : `${t.varCount} gasto${t.varCount !== 1 ? 's' : ''}` },
    { id: 'cuotas', icon: CreditCard, tint: '#C487F6', title: 'Gastos a cuotas', valor: `$${formatAmount(t.cuotasTotal)}`, unidad: '/ cuota del mes', sub: `${t.cuotasCount} cuota${t.cuotasCount !== 1 ? 's' : ''} activa${t.cuotasCount !== 1 ? 's' : ''}` },
    { id: 'puntuales', icon: Calendar, tint: '#4ADE80', title: 'Gastos puntuales', valor: `${t.puntuales} registrado${t.puntuales !== 1 ? 's' : ''}`, unidad: '', sub: 'No afectan tu proyeccion' },
  ]

  return (
    <div>
      <div className="gastos-hub-proj">
        <div>
          <span className="gastos-hub-proj-label">Tu gasto mensual proyectado</span>
          <div className="gastos-hub-proj-value">${t ? formatAmount(t.proyeccion) : '—'}</div>
          <span className="gastos-hub-proj-sub">Incluye fijos, variables y cuotas activas.</span>
        </div>
        <div className="gastos-hub-proj-icon"><LineChart size={22} /></div>
      </div>

      <div className="gastos-hub-grid">
        {(cards || []).map((c) => {
          const Icon = c.icon
          return (
            <button key={c.id} type="button" className="gastos-hub-card" onClick={() => onOpenTipo(c.id)}>
              <span className="gastos-hub-card-icon" style={{ background: `${c.tint}22`, color: c.tint }}><Icon size={18} /></span>
              <span className="gastos-hub-card-title">{c.title}</span>
              <span className="gastos-hub-card-value">
                {c.valor} {c.unidad && <em>{c.unidad}</em>}
              </span>
              <span className="gastos-hub-card-sub">{c.sub}</span>
            </button>
          )
        })}
      </div>

      <button className="btn-add page-primary-action gastos-hub-add" onClick={onAgregar}>
        <Plus size={18} /> Agregar gasto
      </button>
    </div>
  )
}
