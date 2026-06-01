import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, MicOff, Sparkles, X, Check, Loader } from 'lucide-react'
import api from '../../api/client'
import { formatMoney } from '../../utils/formatters'

const TIPO_LABELS = {
  ingreso_fijo: 'Ingreso fijo',
  ingreso_puntual: 'Ingreso puntual',
  gasto_fijo: 'Gasto fijo',
  gasto_puntual: 'Gasto puntual',
}

const ENDPOINT_MAP = {
  ingreso_fijo: '/finanzas/ingresos/',
  ingreso_puntual: '/finanzas/ingresos-puntuales/',
  gasto_fijo: '/finanzas/gastos-corrientes/',
  gasto_puntual: '/finanzas/gastos-no-corrientes/',
}

const FREQ_LABELS = {
  diario: 'Diario', semanal: 'Semanal', quincenal: 'Quincenal',
  mensual: 'Mensual', bimestral: 'Bimestral', trimestral: 'Trimestral',
  semestral: 'Semestral', anual: 'Anual',
}

function buildPayload(parsed) {
  const esFijo = parsed.tipo === 'ingreso_fijo' || parsed.tipo === 'gasto_fijo'
  const esIngreso = parsed.tipo === 'ingreso_fijo' || parsed.tipo === 'ingreso_puntual'

  if (esFijo) {
    return {
      descripcion: parsed.descripcion,
      monto: parsed.monto,
      frecuencia: parsed.frecuencia || 'mensual',
      fecha_inicio: parsed.fecha || new Date().toISOString().slice(0, 10),
      activo: true,
      ...(!esIngreso && { categoria: parsed.categoria || 'otro' }),
    }
  }
  return {
    descripcion: parsed.descripcion,
    monto: parsed.monto,
    fecha: parsed.fecha || new Date().toISOString().slice(0, 10),
    ...(!esIngreso && { categoria: parsed.categoria || 'otro' }),
  }
}

export default function AuraAssistant() {
  const [open, setOpen] = useState(false)
  const [texto, setTexto] = useState('')
  const [escuchando, setEscuchando] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [parsed, setParsed] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState(false)
  const [error, setError] = useState('')
  const [edits, setEdits] = useState({})
  const recognitionRef = useRef(null)
  const micTimeoutRef = useRef(null)

  useEffect(() => { if (parsed) setEdits({}) }, [parsed])

  const campo = (key) => edits[key] !== undefined ? edits[key] : parsed?.[key]
  const setEditar = (key, val) => setEdits((e) => ({ ...e, [key]: val }))

  const resetear = useCallback(() => {
    setTexto('')
    setParsed(null)
    setEdits({})
    setError('')
    setExito(false)
    setCargando(false)
    setGuardando(false)
  }, [])

  const cerrar = useCallback(() => {
    clearTimeout(micTimeoutRef.current)
    recognitionRef.current?.stop()
    setEscuchando(false)
    setOpen(false)
    resetear()
  }, [resetear])

  function detenerMic() {
    clearTimeout(micTimeoutRef.current)
    recognitionRef.current?.stop()
    setEscuchando(false)
  }

  function toggleMic() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      setError('Tu navegador no soporta reconocimiento de voz. Escribí directamente.')
      return
    }
    if (escuchando) {
      detenerMic()
      return
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new SR()
    rec.lang = 'es-ES'
    rec.continuous = false
    rec.interimResults = true
    rec.onresult = (e) => {
      clearTimeout(micTimeoutRef.current)
      let transcripcion = ''
      for (let i = 0; i < e.results.length; i++) {
        transcripcion += e.results[i][0].transcript
      }
      if (transcripcion) setTexto(transcripcion)
      if (e.results[e.results.length - 1].isFinal) setEscuchando(false)
    }
    rec.onerror = () => detenerMic()
    rec.onend = () => detenerMic()
    recognitionRef.current = rec
    rec.start()
    setEscuchando(true)
    // Seguridad para mobile: corta solo si no llegó resultado en 10s
    micTimeoutRef.current = setTimeout(() => {
      recognitionRef.current?.stop()
      setEscuchando(false)
    }, 10000)
  }

  async function parsear() {
    if (!texto.trim()) return
    setCargando(true)
    setError('')
    try {
      const { data } = await api.post('/finanzas/asistente/parsear/', { texto })
      setParsed(data)
    } catch (e) {
      setError(e?.response?.data?.detail || 'No pude entender el registro. Intentá ser más específico.')
    } finally {
      setCargando(false)
    }
  }

  async function confirmar() {
    setGuardando(true)
    setError('')
    const merged = { ...parsed, ...edits, monto: parseFloat(campo('monto')) || parsed.monto }
    try {
      const endpoint = ENDPOINT_MAP[merged.tipo]
      await api.post(endpoint, buildPayload(merged))
      setExito(true)
      setTimeout(cerrar, 1400)
    } catch (e) {
      setError('No se pudo guardar. Revisá los datos e intentá de nuevo.')
      setGuardando(false)
    }
  }

  const esGasto = parsed?.tipo === 'gasto_fijo' || parsed?.tipo === 'gasto_puntual'
  const esFijo = parsed?.tipo === 'ingreso_fijo' || parsed?.tipo === 'gasto_fijo'

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, padding: '8px 12px',
    color: '#fff', fontSize: 14, fontFamily: 'inherit',
    outline: 'none',
  }

  return (
    <>
      {/* Botón flotante */}
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          bottom: 28,
          right: 24,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '11px 18px',
          borderRadius: 999,
          border: 'none',
          background: 'linear-gradient(135deg, #C487F6 0%, #8B5CF6 100%)',
          color: '#fff',
          fontWeight: 700,
          fontSize: 14,
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(196,135,246,0.45)',
        }}
        aria-label="Abrir asistente Aura AI"
      >
        <Sparkles size={16} />
        Aura AI
      </button>

      {/* Modal */}
      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            padding: '0 0 24px',
          }}
          onClick={(e) => e.target === e.currentTarget && cerrar()}
        >
          <div style={{
            width: '100%', maxWidth: 480,
            background: 'rgba(18,26,50,0.98)',
            border: '1px solid rgba(196,135,246,0.25)',
            borderRadius: 20,
            padding: '24px 20px 20px',
            margin: '0 16px',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={18} color="#C487F6" />
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Aura AI</span>
              </div>
              <button onClick={cerrar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            {exito ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <Check size={40} color="#10B981" style={{ margin: '0 auto 10px' }} />
                <p style={{ color: '#10B981', fontWeight: 700, fontSize: 16 }}>¡Registrado!</p>
              </div>
            ) : parsed ? (
              /* Pantalla de confirmación editable */
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, margin: 0 }}>Revisá y editá si hace falta:</p>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: esGasto ? '#F87171' : '#10B981' }}>
                    {TIPO_LABELS[parsed.tipo]}
                  </span>
                </div>

                {/* Descripción */}
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 4 }}>Descripción</label>
                  <input
                    value={campo('descripcion') || ''}
                    onChange={(e) => setEditar('descripcion', e.target.value)}
                    style={inputStyle}
                  />
                </div>

                {/* Monto */}
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 4 }}>Monto</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={campo('monto') || ''}
                    onChange={(e) => setEditar('monto', e.target.value)}
                    style={inputStyle}
                  />
                </div>

                {/* Categoría (solo gastos) */}
                {esGasto && (
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 4 }}>Categoría</label>
                    <select value={campo('categoria') || 'otro'} onChange={(e) => setEditar('categoria', e.target.value)} style={inputStyle}>
                      {['vivienda','alimentacion','transporte','salud','educacion','entretenimiento','ropa','servicios','tecnologia','deudas','ahorro','otro'].map((c) => (
                        <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Frecuencia (solo fijos) */}
                {esFijo && (
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 4 }}>Frecuencia</label>
                    <select value={campo('frecuencia') || 'mensual'} onChange={(e) => setEditar('frecuencia', e.target.value)} style={inputStyle}>
                      {Object.entries(FREQ_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                )}

                {/* Fecha (solo puntuales) */}
                {!esFijo && (
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 4 }}>Fecha</label>
                    <input
                      type="date"
                      value={campo('fecha') || ''}
                      onChange={(e) => setEditar('fecha', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                )}

                {error && <p style={{ color: '#F87171', fontSize: 13, marginBottom: 10 }}>{error}</p>}
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  <button onClick={resetear} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                    Volver
                  </button>
                  <button onClick={confirmar} disabled={guardando} style={{ flex: 2, padding: '10px 0', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #C487F6, #8B5CF6)', color: '#fff', fontWeight: 700, cursor: guardando ? 'not-allowed' : 'pointer', fontSize: 14, opacity: guardando ? 0.7 : 1 }}>
                    {guardando ? 'Guardando...' : 'Confirmar'}
                  </button>
                </div>
              </div>
            ) : (
              /* Pantalla de entrada */
              <div>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 12 }}>
                  Decí o escribí lo que pasó, por ejemplo:<br />
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' }}>"gasté $50 en almuerzo hoy"</span>
                </p>
                <div style={{ position: 'relative', marginBottom: 12 }}>
                  <textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), parsear())}
                    placeholder="gasté $80 en supermercado hoy..."
                    rows={3}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 12, padding: '12px 48px 12px 14px',
                      color: '#fff', fontSize: 15, resize: 'none',
                      outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                  <button
                    onClick={toggleMic}
                    style={{
                      position: 'absolute', right: 10, top: 10,
                      background: escuchando ? 'rgba(248,113,113,0.2)' : 'rgba(196,135,246,0.15)',
                      border: `1px solid ${escuchando ? 'rgba(248,113,113,0.4)' : 'rgba(196,135,246,0.3)'}`,
                      borderRadius: 8, padding: 6, cursor: 'pointer',
                      color: escuchando ? '#F87171' : '#C487F6',
                    }}
                    title={escuchando ? 'Detener' : 'Hablar'}
                  >
                    {escuchando ? <MicOff size={16} /> : <Mic size={16} />}
                  </button>
                </div>
                {escuchando && (
                  <p style={{ color: '#C487F6', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>Escuchando...</p>
                )}
                {error && <p style={{ color: '#F87171', fontSize: 13, marginBottom: 10 }}>{error}</p>}
                <button
                  onClick={parsear}
                  disabled={!texto.trim() || cargando}
                  style={{
                    width: '100%', padding: '12px 0', borderRadius: 12, border: 'none',
                    background: texto.trim() ? 'linear-gradient(135deg, #C487F6, #8B5CF6)' : 'rgba(255,255,255,0.08)',
                    color: texto.trim() ? '#fff' : 'rgba(255,255,255,0.3)',
                    fontWeight: 700, fontSize: 15, cursor: texto.trim() && !cargando ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  {cargando ? <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Analizando...</> : 'Analizar'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
