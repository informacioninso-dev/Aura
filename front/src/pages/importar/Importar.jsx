import { useRef, useState } from 'react'
import { Upload, FileSpreadsheet, CheckCircle, XCircle, AlertTriangle, Download } from 'lucide-react'
import api from '../../api/client'
import '../../components/ui/app.css'

const TEMPLATE_CSV = `fecha,descripcion,monto,tipo,categoria
2025-12-01,Sueldo diciembre,1500000,ingreso,
2025-12-05,Supermercado,-85000,gasto,alimentacion
2025-12-10,Arriendo,-600000,gasto,vivienda
2025-12-15,Freelance,200000,ingreso,
2025-12-20,Farmacia,-32000,gasto,salud`

export default function Importar() {
  const inputRef      = useRef(null)
  const [fase, setFase]           = useState('upload')   // upload | preview | confirmado
  const [drag, setDrag]           = useState(false)
  const [cargando, setCargando]   = useState(false)
  const [error, setError]         = useState('')
  const [preview, setPreview]     = useState(null)       // resultado del backend
  const [seleccion, setSeleccion] = useState([])         // índices de filas seleccionadas
  const [resultado, setResultado] = useState(null)

  function descargarTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'plantilla_aura.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  async function procesarArchivo(file) {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      setError('Solo se aceptan archivos .csv o .xlsx'); return
    }
    setError(''); setCargando(true)
    try {
      const fd = new FormData()
      fd.append('archivo', file)
      const { data } = await api.post('/finanzas/importar/preview/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setPreview(data)
      setSeleccion(data.filas_ok.map((_, i) => i))  // todo seleccionado por defecto
      setFase('preview')
    } catch (err) {
      setError(err.response?.data?.error || 'Error al procesar el archivo')
    } finally { setCargando(false) }
  }

  function onDrop(e) {
    e.preventDefault(); setDrag(false)
    procesarArchivo(e.dataTransfer.files[0])
  }

  function toggleFila(i) {
    setSeleccion(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])
  }

  function toggleTodo() {
    setSeleccion(prev => prev.length === preview.filas_ok.length ? [] : preview.filas_ok.map((_, i) => i))
  }

  async function confirmar() {
    setCargando(true); setError('')
    try {
      const filas = seleccion.map(i => preview.filas_ok[i])
      const { data } = await api.post('/finanzas/importar/confirmar/', { filas })
      setResultado(data)
      setFase('confirmado')
    } catch (err) {
      setError(err.response?.data?.error || 'Error al importar')
    } finally { setCargando(false) }
  }

  function reiniciar() {
    setFase('upload'); setPreview(null); setSeleccion([]); setResultado(null); setError('')
  }

  // ── FASE: CONFIRMADO ──
  if (fase === 'confirmado' && resultado) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Importación completada</h1>
        </div>
        <div className="card" style={{ maxWidth: 520, textAlign: 'center', padding: 40 }}>
          <CheckCircle size={56} style={{ color: '#10B981', marginBottom: 16 }} />
          <p style={{ fontWeight: 800, fontSize: 20, marginBottom: 8 }}>¡Todo importado!</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 32, margin: '20px 0' }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: 28, color: '#10B981' }}>{resultado.ingresos_creados}</p>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>ingresos históricos</p>
            </div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 28, color: '#F87171' }}>{resultado.gastos_creados}</p>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>gastos registrados</p>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 24 }}>
            Los ingresos históricos se guardan como <strong>inactivos</strong> para no distorsionar tu proyección mensual. Puedes activarlos en el módulo "Lo que entra".
          </p>
          <button className="btn-modal-save" style={{ padding: '11px 28px' }} onClick={reiniciar}>
            Importar otro archivo
          </button>
        </div>
      </div>
    )
  }

  // ── FASE: PREVIEW ──
  if (fase === 'preview' && preview) {
    const filasSeleccionadas = seleccion.length
    return (
      <div>
        <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page-title">Revisar importación</h1>
            <p className="page-subtitle">
              {preview.total} filas detectadas — {preview.filas_ok.length} válidas, {preview.filas_error.length} con error
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-modal-cancel" onClick={reiniciar}>Cancelar</button>
            <button className="btn-modal-save" onClick={confirmar}
              disabled={cargando || filasSeleccionadas === 0}
              style={{ padding: '10px 22px' }}>
              {cargando ? 'Importando...' : `Importar ${filasSeleccionadas} filas`}
            </button>
          </div>
        </div>

        {/* Columnas detectadas */}
        <div className="card" style={{ marginBottom: 16, padding: '14px 20px' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Columnas detectadas</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(preview.mapa_columnas).map(([campo, col]) => (
              <span key={campo} className="badge badge-gray">
                <span style={{ color: '#C487F6' }}>{campo}</span> ← {col}
              </span>
            ))}
          </div>
        </div>

        {/* Filas válidas */}
        {preview.filas_ok.length > 0 && (
          <div className="card" style={{ padding: 0, marginBottom: 16 }}>
            <div style={{ padding: '14px 20px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle size={16} style={{ color: '#10B981' }} />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Filas válidas ({preview.filas_ok.length})</span>
              <button onClick={toggleTodo}
                style={{ marginLeft: 'auto', fontSize: 12, color: '#C487F6', background: 'none', border: 'none', cursor: 'pointer' }}>
                {seleccion.length === preview.filas_ok.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
              </button>
            </div>
            <div className="table-wrap" style={{ border: 'none', maxHeight: 380, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}></th>
                    {['Fecha', 'Descripción', 'Monto', 'Tipo', 'Categoría'].map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.filas_ok.map((f, i) => (
                    <tr key={i} style={{ opacity: seleccion.includes(i) ? 1 : 0.35 }}>
                      <td>
                        <input type="checkbox" checked={seleccion.includes(i)} onChange={() => toggleFila(i)}
                          style={{ accentColor: '#C487F6', cursor: 'pointer' }} />
                      </td>
                      <td style={{ fontSize: 13 }}>{f.fecha}</td>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{f.descripcion}</td>
                      <td className={`table-amount ${f.tipo === 'ingreso' ? 'positive' : 'negative'}`}>
                        {f.tipo === 'ingreso' ? '+' : '-'}${parseFloat(f.monto).toLocaleString('es-CL')}
                      </td>
                      <td>
                        <span className={`badge ${f.tipo === 'ingreso' ? 'badge-green' : 'badge-gray'}`}
                          style={{ textTransform: 'capitalize' }}>{f.tipo}</span>
                      </td>
                      <td style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', textTransform: 'capitalize' }}>{f.categoria}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Filas con error */}
        {preview.filas_error.length > 0 && (
          <div className="card" style={{ padding: '14px 20px', background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <XCircle size={16} style={{ color: '#F87171' }} />
              <span style={{ fontWeight: 700, fontSize: 14, color: '#F87171' }}>Filas con error ({preview.filas_error.length}) — no se importarán</span>
            </div>
            {preview.filas_error.slice(0, 5).map((e, i) => (
              <div key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.50)', marginBottom: 4 }}>
                Fila {e.fila}: {e.error}
              </div>
            ))}
            {preview.filas_error.length > 5 && (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)' }}>…y {preview.filas_error.length - 5} más</div>
            )}
          </div>
        )}

        {error && <div style={{ marginTop: 12, color: '#F87171', fontSize: 13 }}>{error}</div>}
      </div>
    )
  }

  // ── FASE: UPLOAD ──
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Importar historial</h1>
        <p className="page-subtitle">Sube tu estado de cuenta o planilla de gastos anteriores en Excel o CSV.</p>
      </div>

      {/* Zona de drop */}
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${drag ? '#C487F6' : 'rgba(255,255,255,0.12)'}`,
          borderRadius: 20,
          padding: '60px 40px',
          textAlign: 'center',
          cursor: 'pointer',
          background: drag ? 'rgba(196,135,246,0.06)' : 'rgba(255,255,255,0.02)',
          transition: 'all 0.2s',
          marginBottom: 24,
        }}>
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
          onChange={e => procesarArchivo(e.target.files[0])} />
        {cargando ? (
          <>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />
            <p style={{ color: 'rgba(255,255,255,0.55)' }}>Procesando archivo...</p>
          </>
        ) : (
          <>
            <Upload size={44} style={{ color: drag ? '#C487F6' : 'rgba(255,255,255,0.25)', marginBottom: 16 }} />
            <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
              {drag ? 'Suelta aquí el archivo' : 'Arrastra tu archivo aquí'}
            </p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.40)' }}>o haz clic para seleccionarlo</p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', marginTop: 10 }}>.csv · .xlsx · .xls · máx. 5 MB</p>
          </>
        )}
      </div>

      {error && (
        <div style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 12, padding: '12px 16px', color: '#F87171', fontSize: 13, marginBottom: 20 }}>
          {error}
        </div>
      )}

      {/* Instrucciones + template */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <FileSpreadsheet size={18} style={{ color: '#C487F6' }} />
            <span style={{ fontWeight: 700, fontSize: 14 }}>Formato esperado</span>
          </div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 10 }}>
            El archivo debe tener al menos estas columnas (el nombre puede variar):
          </p>
          {[
            { col: 'fecha', desc: 'YYYY-MM-DD, DD/MM/YYYY, etc.' },
            { col: 'descripcion', desc: 'Concepto o glosa del movimiento' },
            { col: 'monto', desc: 'Positivo = ingreso, negativo = gasto' },
            { col: 'tipo', desc: '"ingreso" o "gasto" (opcional)' },
            { col: 'categoria', desc: 'Nombre de categoría (opcional)' },
          ].map(r => (
            <div key={r.col} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: '#C487F6', minWidth: 90, fontSize: 12 }}>{r.col}</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)' }}>{r.desc}</span>
            </div>
          ))}
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 10 }}>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', marginBottom: 2 }}>También detecta:</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>concepto, detalle, glosa, importe, valor, amount, abono, cargo…</p>
          </div>
        </div>

        <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <AlertTriangle size={16} style={{ color: '#FBBF24' }} />
              <span style={{ fontWeight: 700, fontSize: 14 }}>A tener en cuenta</span>
            </div>
            {[
              'Los ingresos históricos se guardan como inactivos para no afectar la proyección.',
              'Los gastos puntuales (no corrientes) se registran con la fecha exacta.',
              'Máximo 2.000 filas por importación.',
              'Puedes revisar y deseleccionar filas antes de confirmar.',
            ].map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 7, alignItems: 'flex-start' }}>
                <span style={{ color: '#C487F6', marginTop: 1 }}>·</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{t}</span>
              </div>
            ))}
          </div>

          <button onClick={descargarTemplate}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 0', border: '1.5px solid rgba(196,135,246,0.30)', borderRadius: 12, background: 'rgba(196,135,246,0.07)', color: '#C487F6', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 'auto' }}>
            <Download size={15} /> Descargar plantilla CSV
          </button>
        </div>
      </div>
    </div>
  )
}
