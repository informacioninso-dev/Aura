import { useState, useEffect } from 'react'
import api from '../../api/client'
import '../../components/ui/app.css'

const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

export default function Reporte() {
  const hoy    = new Date()
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes,  setMes]  = useState(hoy.getMonth() + 1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => { fetchReporte() }, [anio, mes])

  async function fetchReporte() {
    setLoading(true)
    setError('')
    try {
      const { data: d } = await api.get(`/finanzas/reporte/?anio=${anio}&mes=${mes}`)
      setData(d)
    } catch {
      setError('No se pudo cargar el reporte.')
    } finally {
      setLoading(false)
    }
  }

  function descargarCSV() {
    if (!data) return
    const filas = [
      ['Categoría', 'Total', 'Límite', '% del límite'],
      ...data.categorias.map(c => [
        c.categoria,
        c.total,
        c.limite ?? '',
        c.pct_limite != null ? `${c.pct_limite}%` : '',
      ]),
      [],
      ['Resumen', ''],
      ['Total ingresos',   data.resumen.total_ingresos],
      ['Total gastos',     data.resumen.total_gastos],
      ['Balance',          data.resumen.balance],
      ['Tasa de ahorro',   `${data.resumen.tasa_ahorro}%`],
      ['Gastos corrientes',data.resumen.gastos_corrientes],
      ['Cuotas',           data.resumen.cuotas],
      ['Gastos puntuales', data.resumen.gastos_puntuales],
    ]
    const csv = filas.map(r => r.join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a   = document.createElement('a')
    a.href     = url
    a.download = `reporte_${anio}_${String(mes).padStart(2,'0')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const balanceColor = data
    ? data.resumen.balance >= 0 ? '#10B981' : '#F87171'
    : '#fff'

  const anios = []
  for (let y = hoy.getFullYear(); y >= hoy.getFullYear() - 4; y--) anios.push(y)

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 className="page-title">Reportes</h1>
          <p className="page-subtitle">Resumen mensual de tus finanzas</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select
            value={mes}
            onChange={e => setMes(Number(e.target.value))}
            className="form-modal-select"
            style={{ width: 140 }}
          >
            {MESES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <select
            value={anio}
            onChange={e => setAnio(Number(e.target.value))}
            className="form-modal-select"
            style={{ width: 100 }}
          >
            {anios.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {data && (
            <button onClick={descargarCSV} className="btn-modal-save" style={{ padding: '8px 18px', fontSize: 13 }}>
              ↓ CSV
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.30)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, color: '#F87171', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>
          Cargando reporte…
        </div>
      )}

      {!loading && data && (
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 28 }}>
            <SummaryCard label="Ingresos" value={data.resumen.total_ingresos} color="#10B981" prefix="$" />
            <SummaryCard label="Gastos" value={data.resumen.total_gastos} color="#F87171" prefix="$" />
            <SummaryCard label="Balance" value={data.resumen.balance} color={balanceColor} prefix="$" signed />
            <SummaryCard label="Tasa de ahorro" value={data.resumen.tasa_ahorro} color="#C487F6" suffix="%" />
          </div>

          {/* Sub-breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 28 }}>
            <MiniCard label="Gastos corrientes" value={data.resumen.gastos_corrientes} />
            <MiniCard label="Cuotas" value={data.resumen.cuotas} />
            <MiniCard label="Gastos puntuales" value={data.resumen.gastos_puntuales} />
          </div>

          {/* Category breakdown */}
          {data.categorias.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>Gasto por categoría</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {data.categorias.map(c => {
                  const pct = c.pct_limite
                  const barColor = pct == null ? '#C487F6'
                    : pct >= 100 ? '#F87171'
                    : pct >= 75  ? '#FBBF24'
                    : '#10B981'
                  return (
                    <div key={c.categoria}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {c.icono} {c.categoria}
                        </span>
                        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.60)' }}>
                          ${c.total.toLocaleString('es-AR')}
                          {c.limite != null && (
                            <span style={{ fontSize: 11, marginLeft: 6, color: 'rgba(255,255,255,0.35)' }}>
                              / ${c.limite.toLocaleString('es-AR')}
                            </span>
                          )}
                        </span>
                      </div>
                      {c.limite != null && (
                        <div style={{ height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.08)' }}>
                          <div style={{
                            height: '100%', borderRadius: 99,
                            width: `${Math.min(pct, 100)}%`,
                            background: barColor,
                            transition: 'width 0.4s',
                          }} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Top one-off expenses */}
          {data.top_gastos.length > 0 && (
            <div className="card">
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Top gastos puntuales</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Descripción</th>
                    <th>Categoría</th>
                    <th>Fecha</th>
                    <th style={{ textAlign: 'right' }}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_gastos.map((g, i) => (
                    <tr key={i}>
                      <td>{g.descripcion}</td>
                      <td style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>{g.categoria}</td>
                      <td style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>{g.fecha}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: '#F87171' }}>
                        ${Number(g.monto).toLocaleString('es-AR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.categorias.length === 0 && data.top_gastos.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'rgba(255,255,255,0.30)', fontSize: 14 }}>
              Sin movimientos registrados para {MESES[mes-1]} {anio}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value, color, prefix = '', suffix = '', signed = false }) {
  const display = signed
    ? `${value >= 0 ? '+' : ''}${prefix}${Number(value).toLocaleString('es-AR')}${suffix}`
    : `${prefix}${Number(value).toLocaleString('es-AR')}${suffix}`

  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color }}>
        {display}
      </div>
    </div>
  )
}

function MiniCard({ label, value }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12, padding: '12px 16px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.80)' }}>
        ${Number(value).toLocaleString('es-AR')}
      </div>
    </div>
  )
}
