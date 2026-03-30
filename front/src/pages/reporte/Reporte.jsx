import { useCallback, useEffect, useState } from 'react'

import api from '../../api/client'
import { getApiErrorMessage } from '../../api/errors'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import { formatNumber } from '../../utils/formatters'
import '../../components/ui/app.css'

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

function escapeCsvValue(value) {
  if (value == null) return ''
  const text = String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

async function parseBlobError(blob) {
  try {
    const text = await blob.text()
    const parsed = JSON.parse(text)
    return parsed?.error || parsed?.detail || ''
  } catch {
    return ''
  }
}

export default function Reporte() {
  const hoy = new Date()
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth() + 1)
  const [data, setData] = useState(null)

  const [loading, setLoading] = useState(false)
  const [exportingCsv, setExportingCsv] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [feedback, setFeedback] = useState({ type: '', message: '' })

  const fetchReporte = useCallback(async () => {
    setLoading(true)
    setFeedback({ type: '', message: '' })

    try {
      const { data: response } = await api.get(`/finanzas/reporte/?anio=${anio}&mes=${mes}`)
      setData(response)
    } catch (err) {
      setData(null)
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo cargar el reporte.') })
    } finally {
      setLoading(false)
    }
  }, [anio, mes])

  useEffect(() => {
    fetchReporte()
  }, [fetchReporte])

  async function descargarCSV() {
    if (!data || exportingCsv) return

    setExportingCsv(true)
    setFeedback({ type: '', message: '' })
    try {
      const filas = [
        ['Categoria', 'Total', 'Limite', '% del limite'],
        ...data.categorias.map((categoria) => ([
          categoria.categoria,
          categoria.total,
          categoria.limite ?? '',
          categoria.pct_limite != null ? `${categoria.pct_limite}%` : '',
        ])),
        [],
        ['Resumen', ''],
        ['Total ingresos', data.resumen.total_ingresos],
        ['Total gastos', data.resumen.total_gastos],
        ['Balance', data.resumen.balance],
        ['Tasa de ahorro', `${data.resumen.tasa_ahorro}%`],
        ['Gastos corrientes', data.resumen.gastos_corrientes],
        ['Cuotas', data.resumen.cuotas],
        ['Gastos puntuales', data.resumen.gastos_puntuales],
      ]

      const csv = filas
        .map((row) => row.map(escapeCsvValue).join(','))
        .join('\r\n')

      const filename = `reporte_${anio}_${String(mes).padStart(2, '0')}.csv`
      triggerDownload(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }), filename)
      setFeedback({ type: 'success', message: 'CSV descargado correctamente.' })
    } catch {
      setFeedback({ type: 'error', message: 'No se pudo descargar el CSV.' })
    } finally {
      setExportingCsv(false)
    }
  }

  async function descargarPDF() {
    if (!data || exportingPdf) return

    setExportingPdf(true)
    setFeedback({ type: '', message: '' })
    try {
      const response = await api.get(`/finanzas/reporte/pdf/?anio=${anio}&mes=${mes}`, { responseType: 'blob' })
      const filename = `reporte_${anio}_${String(mes).padStart(2, '0')}.pdf`
      triggerDownload(new Blob([response.data], { type: 'application/pdf' }), filename)
      setFeedback({ type: 'success', message: 'PDF descargado correctamente.' })
    } catch (err) {
      let message = 'No se pudo descargar el PDF.'

      if (err?.response?.data instanceof Blob) {
        const blobMessage = await parseBlobError(err.response.data)
        if (blobMessage) message = blobMessage
      } else {
        message = getApiErrorMessage(err, message)
      }

      setFeedback({ type: 'error', message })
    } finally {
      setExportingPdf(false)
    }
  }

  const balanceColor = data
    ? (data.resumen.balance >= 0 ? '#10B981' : '#F87171')
    : '#FFFFFF'

  const anios = []
  for (let year = hoy.getFullYear(); year >= hoy.getFullYear() - 4; year -= 1) {
    anios.push(year)
  }

  return (
    <div className="page-container">
      <div className="reporte-header">
        <div className="page-header-main">
          <h1 className="page-title">Reportes</h1>
          <p className="page-subtitle">Resumen mensual de tus finanzas</p>
        </div>

        <div className="reporte-actions">
          <select
            value={mes}
            onChange={(e) => setMes(Number(e.target.value))}
            className="form-modal-select"
            style={{ width: 140 }}
          >
            {MESES.map((mesNombre, idx) => (
              <option key={idx + 1} value={idx + 1}>{mesNombre}</option>
            ))}
          </select>

          <select
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value))}
            className="form-modal-select"
            style={{ width: 100 }}
          >
            {anios.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>

          {data && (
            <>
              <button
                onClick={descargarCSV}
                disabled={exportingCsv || exportingPdf}
                className="btn-modal-save"
                style={{ padding: '8px 18px', fontSize: 13 }}
              >
                {exportingCsv ? 'Generando CSV...' : 'Descargar CSV'}
              </button>
              <button
                onClick={descargarPDF}
                disabled={exportingPdf || exportingCsv}
                className="btn-modal-cancel"
                style={{ padding: '8px 18px', fontSize: 13 }}
              >
                {exportingPdf ? 'Generando PDF...' : 'Descargar PDF'}
              </button>
            </>
          )}
        </div>
      </div>

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>
          Cargando reporte...
        </div>
      )}

      {!loading && data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 28 }}>
            <SummaryCard label="Ingresos" value={data.resumen.total_ingresos} color="#10B981" prefix="$" />
            <SummaryCard label="Gastos" value={data.resumen.total_gastos} color="#F87171" prefix="$" />
            <SummaryCard label="Balance" value={data.resumen.balance} color={balanceColor} prefix="$" signed />
            <SummaryCard label="Tasa de ahorro" value={data.resumen.tasa_ahorro} color="#C487F6" suffix="%" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 28 }}>
            <MiniCard label="Gastos corrientes" value={data.resumen.gastos_corrientes} />
            <MiniCard label="Cuotas" value={data.resumen.cuotas} />
            <MiniCard label="Gastos puntuales" value={data.resumen.gastos_puntuales} />
          </div>

          {data.categorias.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>Gasto por categoria</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {data.categorias.map((categoria) => {
                  const pct = categoria.pct_limite
                  const barColor = pct == null
                    ? '#C487F6'
                    : pct >= 100
                      ? '#F87171'
                      : pct >= 75
                        ? '#FBBF24'
                        : '#10B981'

                  return (
                    <div key={categoria.categoria}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {categoria.icono} {categoria.categoria}
                        </span>
                        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.60)' }}>
                          ${formatNumber(Number(categoria.total))}
                          {categoria.limite != null && (
                            <span style={{ fontSize: 11, marginLeft: 6, color: 'rgba(255,255,255,0.35)' }}>
                              / ${formatNumber(Number(categoria.limite))}
                            </span>
                          )}
                        </span>
                      </div>

                      {categoria.limite != null && (
                        <div style={{ height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.08)' }}>
                          <div
                            style={{
                              height: '100%',
                              borderRadius: 99,
                              width: `${Math.min(pct, 100)}%`,
                              background: barColor,
                              transition: 'width 0.4s',
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {data.top_gastos.length > 0 && (
            <div className="card">
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Top gastos puntuales</h2>
              <div className="table-wrap" style={{ border: 'none' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Descripcion</th>
                      <th>Categoria</th>
                      <th>Fecha</th>
                      <th style={{ textAlign: 'right' }}>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_gastos.map((gasto, index) => (
                      <tr key={index}>
                        <td>{gasto.descripcion}</td>
                        <td style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>{gasto.categoria}</td>
                        <td style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>{gasto.fecha}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#F87171' }}>
                          ${formatNumber(Number(gasto.monto))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.categorias.length === 0 && data.top_gastos.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'rgba(255,255,255,0.30)', fontSize: 14 }}>
              Sin movimientos registrados para {MESES[mes - 1]} {anio}.
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value, color, prefix = '', suffix = '', signed = false }) {
  const display = signed
    ? `${value >= 0 ? '+' : ''}${prefix}${formatNumber(Number(value))}${suffix}`
    : `${prefix}${formatNumber(Number(value))}${suffix}`

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
    <div
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: '12px 16px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.80)' }}>
        ${formatNumber(Number(value))}
      </div>
    </div>
  )
}
