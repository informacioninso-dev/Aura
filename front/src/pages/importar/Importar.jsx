import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, FileSpreadsheet, CheckCircle, XCircle, AlertTriangle, Download } from 'lucide-react'

import api from '../../api/client'
import { useAuth } from '../../context/useAuth'
import { formatAmount, formatNumber } from '../../utils/formatters'
import '../../components/ui/app.css'

const TEMPLATE_CSV = `fecha,descripcion,monto,tipo,categoria,frecuencia,tipo_monto
2025-12-01,Sueldo,1500000,ingreso,,mensual,
2025-12-10,Arriendo,-600000,gasto,vivienda,mensual,fijo
2025-12-01,Luz,-45000,gasto,servicios,mensual,variable
2025-12-05,Supermercado,-85000,gasto,alimentacion,,
2025-12-20,Farmacia,-32000,gasto,salud,,`

const PREVIEW_PAGE_SIZE = 100

export default function Importar() {
  const { user, fetchPerfil } = useAuth()
  const inputRef = useRef(null)

  const [fase, setFase] = useState('upload')
  const [drag, setDrag] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [seleccion, setSeleccion] = useState([])
  const [resultado, setResultado] = useState(null)
  const [previewPage, setPreviewPage] = useState(1)

  const maxFilasPlan = user?.feature_access?.import_max_rows ?? 2000
  const maxFilasDetectadas = preview?.max_filas_permitidas ?? maxFilasPlan

  useEffect(() => {
    void fetchPerfil()
    // Esta vista debe reflejar el limite vigente del plan aunque el admin
    // lo haya cambiado despues del login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalValidas = preview?.filas_ok?.length ?? 0
  const previewPageCount = Math.max(1, Math.ceil(totalValidas / PREVIEW_PAGE_SIZE))
  const safePreviewPage = Math.min(previewPage, previewPageCount)
  const previewSliceStart = (safePreviewPage - 1) * PREVIEW_PAGE_SIZE
  const previewSliceEnd = previewSliceStart + PREVIEW_PAGE_SIZE
  const visibleRows = useMemo(
    () => (preview?.filas_ok || []).slice(previewSliceStart, previewSliceEnd),
    [preview, previewSliceStart, previewSliceEnd],
  )
  const visibleIndexes = useMemo(
    () => visibleRows.map((_, index) => previewSliceStart + index),
    [visibleRows, previewSliceStart],
  )
  const visibleSelectedCount = visibleIndexes.filter((index) => seleccion.includes(index)).length

  function descargarTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'plantilla_aura.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function procesarArchivo(file) {
    if (!file) return

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['csv', 'xlsx'].includes(ext)) {
      setError('Solo se aceptan archivos .csv o .xlsx')
      return
    }

    setError('')
    setCargando(true)
    try {
      const formData = new FormData()
      formData.append('archivo', file)

      const { data } = await api.post('/finanzas/importar/preview/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      setPreview(data)
      setSeleccion(data.filas_ok.map((_, index) => index))
      setPreviewPage(1)
      setFase('preview')
    } catch (err) {
      setError(err.response?.data?.error || 'Error al procesar el archivo')
    } finally {
      setCargando(false)
    }
  }

  function onDrop(event) {
    event.preventDefault()
    setDrag(false)
    procesarArchivo(event.dataTransfer.files?.[0])
  }

  function toggleFila(index) {
    setSeleccion((prev) => (
      prev.includes(index) ? prev.filter((item) => item !== index) : [...prev, index]
    ))
  }

  function toggleTodo() {
    if (!preview) return
    setSeleccion((prev) => (
      prev.length === preview.filas_ok.length ? [] : preview.filas_ok.map((_, index) => index)
    ))
  }

  function togglePaginaActual() {
    const allVisibleSelected = visibleIndexes.every((index) => seleccion.includes(index))
    if (allVisibleSelected) {
      setSeleccion((prev) => prev.filter((index) => !visibleIndexes.includes(index)))
      return
    }

    setSeleccion((prev) => {
      const merged = new Set(prev)
      visibleIndexes.forEach((index) => merged.add(index))
      return Array.from(merged).sort((a, b) => a - b)
    })
  }

  async function confirmar() {
    setCargando(true)
    setError('')
    try {
      const filas = seleccion.map((index) => preview.filas_ok[index])
      const { data } = await api.post('/finanzas/importar/confirmar/', { filas })
      setResultado(data)
      setFase('confirmado')
    } catch (err) {
      setError(err.response?.data?.error || 'Error al importar')
    } finally {
      setCargando(false)
    }
  }

  function reiniciar() {
    setFase('upload')
    setPreview(null)
    setSeleccion([])
    setResultado(null)
    setError('')
    setPreviewPage(1)
  }

  if (fase === 'confirmado' && resultado) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Importacion completada</h1>
        </div>

        <div className="card" style={{ maxWidth: 520, textAlign: 'center', padding: 40 }}>
          <CheckCircle size={56} style={{ color: '#10B981', marginBottom: 16 }} />
          <p style={{ fontWeight: 800, fontSize: 20, marginBottom: 8 }}>Todo importado</p>

          <div className="import-result-stats">
            <div>
              <p style={{ fontWeight: 700, fontSize: 28, color: '#10B981' }}>{resultado.ingresos_creados}</p>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>ingresos puntuales</p>
            </div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 28, color: '#F87171' }}>{resultado.gastos_creados}</p>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>gastos puntuales</p>
            </div>
          </div>

          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 24 }}>
            Los movimientos del archivo se guardan como puntuales en su fecha original.
            Asi no se vuelven recurrentes ni alteran tus meses futuros.
          </p>

          <button className="btn-modal-save" style={{ padding: '11px 28px' }} onClick={reiniciar}>
            Importar otro archivo
          </button>
        </div>
      </div>
    )
  }

  if (fase === 'preview' && preview) {
    return (
      <div>
        <div className="page-header page-header-actions">
          <div className="page-header-main">
            <h1 className="page-title">Revisar importacion</h1>
            <p className="page-subtitle">
              {preview.total} filas detectadas, {preview.filas_ok.length} validas, {preview.filas_error.length} con error y un limite actual de {formatNumber(maxFilasDetectadas)} filas.
            </p>
          </div>

          <div className="inline-actions-wrap">
            <button type="button" className="btn-modal-cancel" onClick={reiniciar}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-modal-save"
              onClick={confirmar}
              disabled={cargando || seleccion.length === 0}
              style={{ padding: '10px 22px' }}
            >
              {cargando ? 'Importando...' : `Importar ${seleccion.length} filas`}
            </button>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16, padding: '14px 20px' }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.35)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 8,
            }}
          >
            Columnas detectadas
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(preview.mapa_columnas || {}).map(([campo, columna]) => (
              <span key={campo} className="badge badge-gray">
                <span style={{ color: '#C487F6' }}>{campo}</span> {'<-'} {columna}
              </span>
            ))}
          </div>
        </div>

        {preview.filas_ok.length > 0 && (
          <div className="card" style={{ padding: 0, marginBottom: 16 }}>
            <div className="import-preview-toolbar">
              <CheckCircle size={16} style={{ color: '#10B981' }} />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Filas validas ({preview.filas_ok.length})</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)' }}>
                Mostrando {previewSliceStart + 1}-{Math.min(previewSliceEnd, preview.filas_ok.length)} de {preview.filas_ok.length}
              </span>

              <div className="inline-actions-wrap" style={{ marginLeft: 'auto' }}>
                <button
                  type="button"
                  onClick={togglePaginaActual}
                  style={{ fontSize: 12, color: '#C487F6', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  {visibleSelectedCount === visibleIndexes.length ? 'Deseleccionar pagina' : 'Seleccionar pagina'}
                </button>
                <button
                  type="button"
                  onClick={toggleTodo}
                  style={{ fontSize: 12, color: '#C487F6', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  {seleccion.length === preview.filas_ok.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
                </button>
              </div>
            </div>

            <div className="import-preview-pagination">
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => setPreviewPage((page) => Math.max(1, page - 1))}
                disabled={safePreviewPage <= 1}
                style={{ padding: '8px 10px' }}
              >
                Anterior
              </button>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', minWidth: 70, textAlign: 'center' }}>
                {safePreviewPage}/{previewPageCount}
              </span>
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => setPreviewPage((page) => Math.min(previewPageCount, page + 1))}
                disabled={safePreviewPage >= previewPageCount}
                style={{ padding: '8px 10px' }}
              >
                Siguiente
              </button>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
                La tabla se pagina para mantener la carga rapida aun con archivos grandes.
              </span>
            </div>

            <div className="table-wrap" style={{ border: 'none', maxHeight: 420, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}></th>
                    {['Fecha', 'Descripcion', 'Monto', 'Tipo', 'Categoria', 'Clase'].map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((fila, visibleIndex) => {
                    const absoluteIndex = previewSliceStart + visibleIndex
                    const selected = seleccion.includes(absoluteIndex)
                    return (
                      <tr key={`${fila.fecha}-${absoluteIndex}`} style={{ opacity: selected ? 1 : 0.35 }}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleFila(absoluteIndex)}
                            style={{ accentColor: '#C487F6', cursor: 'pointer' }}
                          />
                        </td>
                        <td style={{ fontSize: 13 }}>{fila.fecha}</td>
                        <td style={{ fontWeight: 600, fontSize: 13 }}>{fila.descripcion}</td>
                        <td className={`table-amount ${fila.tipo === 'ingreso' ? 'positive' : 'negative'}`}>
                          {fila.tipo === 'ingreso' ? '+' : '-'}${formatAmount(parseFloat(fila.monto))}
                        </td>
                        <td>
                          <span
                            className={`badge ${fila.tipo === 'ingreso' ? 'badge-green' : 'badge-gray'}`}
                            style={{ textTransform: 'capitalize' }}
                          >
                            {fila.tipo}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', textTransform: 'capitalize' }}>
                          {fila.categoria}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {fila.frecuencia
                            ? `${fila.tipo === 'gasto' && fila.tipo_monto === 'variable' ? 'Variable' : 'Fijo'} · ${fila.frecuencia}`
                            : <span style={{ color: 'rgba(255,255,255,0.4)' }}>Puntual</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {preview.filas_error.length > 0 && (
          <div
            className="card"
            style={{
              padding: '14px 20px',
              background: 'rgba(248,113,113,0.05)',
              border: '1px solid rgba(248,113,113,0.15)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <XCircle size={16} style={{ color: '#F87171' }} />
              <span style={{ fontWeight: 700, fontSize: 14, color: '#F87171' }}>
                Filas con error ({preview.filas_error.length}) - no se importaran
              </span>
            </div>

            {preview.filas_error.slice(0, 5).map((filaError, index) => (
              <div key={`${filaError.fila}-${index}`} style={{ fontSize: 12, color: 'rgba(255,255,255,0.50)', marginBottom: 4 }}>
                Fila {filaError.fila}: {filaError.error}
              </div>
            ))}

            {preview.filas_error.length > 5 && (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)' }}>
                ...y {preview.filas_error.length - 5} mas
              </div>
            )}
          </div>
        )}

        {error && <div style={{ marginTop: 12, color: '#F87171', fontSize: 13 }}>{error}</div>}
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Importar historial</h1>
        <p className="page-subtitle">Sube tu estado de cuenta o tu planilla de movimientos en Excel o CSV.</p>
      </div>

      <div
        className="import-dropzone"
        onDragOver={(event) => {
          event.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${drag ? '#C487F6' : 'rgba(255,255,255,0.12)'}`,
          background: drag ? 'rgba(196,135,246,0.06)' : 'rgba(255,255,255,0.02)',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          style={{ display: 'none' }}
          onChange={(event) => procesarArchivo(event.target.files?.[0])}
        />

        {cargando ? (
          <>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />
            <p style={{ color: 'rgba(255,255,255,0.55)' }}>Procesando archivo...</p>
          </>
        ) : (
          <>
            <Upload size={44} style={{ color: drag ? '#C487F6' : 'rgba(255,255,255,0.25)', marginBottom: 16 }} />
            <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
              {drag ? 'Suelta aqui el archivo' : 'Arrastra tu archivo aqui'}
            </p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.40)' }}>o haz clic para seleccionarlo</p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', marginTop: 10 }}>.csv · .xlsx · max. 5 MB</p>
          </>
        )}
      </div>

      {error && (
        <div
          style={{
            background: 'rgba(248,113,113,0.10)',
            border: '1px solid rgba(248,113,113,0.25)',
            borderRadius: 12,
            padding: '12px 16px',
            color: '#F87171',
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      <div className="responsive-grid-2">
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <FileSpreadsheet size={18} style={{ color: '#C487F6' }} />
            <span style={{ fontWeight: 700, fontSize: 14 }}>Formato esperado</span>
          </div>

          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 10 }}>
            El archivo debe tener al menos estas columnas. Los nombres pueden variar y el sistema intenta detectarlos.
          </p>

          {[
            { col: 'fecha', desc: 'YYYY-MM-DD, DD/MM/YYYY o formatos equivalentes.' },
            { col: 'descripcion', desc: 'Concepto o glosa del movimiento.' },
            { col: 'monto', desc: 'Positivo para ingreso, negativo para gasto.' },
            { col: 'tipo', desc: '"ingreso" o "gasto" si ya lo conoces. Es opcional.' },
            { col: 'categoria', desc: 'Nombre libre de la categoria. Es opcional.' },
            { col: 'frecuencia', desc: 'mensual, quincenal, anual... si se repite. Vacio = una sola vez (puntual). Opcional.' },
            { col: 'tipo_monto', desc: 'Para gastos que se repiten: "fijo" (mismo monto) o "variable" (cambia). Opcional.' },
          ].map((item) => (
            <div key={item.col} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: '#C487F6', minWidth: 90, fontSize: 12 }}>{item.col}</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)' }}>{item.desc}</span>
            </div>
          ))}

          <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 10 }}>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', marginBottom: 2 }}>Tambien detecta alias comunes:</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
              concepto, detalle, glosa, importe, valor, amount, abono, cargo, movement.
            </p>
          </div>
        </div>

        <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <AlertTriangle size={16} style={{ color: '#FBBF24' }} />
              <span style={{ fontWeight: 700, fontSize: 14 }}>A tener en cuenta</span>
            </div>

            {[
              'Sin columna frecuencia, todo entra como puntual (movimiento de una sola vez).',
              'Con frecuencia (mensual, anual...) se crea un ingreso o gasto recurrente. Ponlo una sola vez, no uno por mes.',
              'En gastos que se repiten, "variable" es para los que cambian de monto (luz, agua); "fijo" para los que no (arriendo).',
              `Tu plan permite hasta ${formatNumber(maxFilasPlan)} filas por importacion.`,
            ].map((text, index) => (
              <div key={`${index}-${text}`} style={{ display: 'flex', gap: 8, marginBottom: 7, alignItems: 'flex-start' }}>
                <span style={{ color: '#C487F6', marginTop: 1 }}>·</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{text}</span>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 4,
              padding: '10px 14px',
              borderRadius: 10,
              background: 'rgba(196,135,246,0.08)',
              border: '1px solid rgba(196,135,246,0.20)',
              fontSize: 12,
              color: 'rgba(255,255,255,0.55)',
            }}
          >
            Si necesitas una carga masiva con reglas especiales o mas volumen, ese flujo debe vivir en un plan superior y con un
            proceso mas controlado.
          </div>

          <button
            type="button"
            onClick={descargarTemplate}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '11px 0',
              border: '1.5px solid rgba(196,135,246,0.30)',
              borderRadius: 12,
              background: 'rgba(196,135,246,0.07)',
              color: '#C487F6',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              marginTop: 'auto',
            }}
          >
            <Download size={15} />
            Descargar plantilla CSV
          </button>
        </div>
      </div>
    </div>
  )
}
