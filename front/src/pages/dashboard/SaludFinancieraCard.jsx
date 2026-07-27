import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'

import api from '../../api/client'
import Modal from '../../components/ui/Modal'
import '../../components/ui/app.css'

function bandaColor(puntaje) {
  if (puntaje >= 80) return '#4ADE80'
  if (puntaje >= 60) return '#A3E635'
  if (puntaje >= 40) return '#FBBF24'
  return '#F87171'
}

function ScoreRing({ score, color, size = 92 }) {
  const stroke = 8
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score)) / 100
  return (
    <svg width={size} height={size} className="salud-ring" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(var(--app-ink-rgb),0.12)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="salud-ring-num">
        {score}
      </text>
    </svg>
  )
}

function valorTexto(comp) {
  if (comp.valor_pct != null) return `${comp.valor_pct}%`
  if (comp.valor_meses != null) return `${comp.valor_meses} ${comp.valor_meses === 1 ? 'mes' : 'meses'}`
  return comp.valor_texto || ''
}

export default function SaludFinancieraCard({ anio, mes, enabled }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [detail, setDetail] = useState(false)

  const cargar = useCallback(async () => {
    if (!enabled) return
    try {
      const { data: resp } = await api.get('/finanzas/salud-financiera/', { params: { anio, mes } })
      setData(resp)
      setError(false)
    } catch {
      setError(true)
      setData(null)
    }
  }, [enabled, anio, mes])

  useEffect(() => { cargar() }, [cargar])

  if (!enabled || error || !data) return null

  if (!data.disponible) {
    return (
      <div className="salud-card salud-card-empty">
        <ShieldCheck size={18} />
        <span>{data.motivo}</span>
      </div>
    )
  }

  const { score, banda, componentes, consejos } = data

  return (
    <>
      <div className="salud-card">
        <ScoreRing score={score} color={banda.color} />
        <div className="salud-card-body">
          <span className="salud-card-kicker">Salud financiera</span>
          <span className="salud-card-banda" style={{ color: banda.color }}>{banda.label}</span>
          <span className="salud-card-sub">Como la mide un banco: ingresos, gastos, cuotas y ahorro.</span>
        </div>
        <button type="button" className="salud-card-detalle" onClick={() => setDetail(true)}>
          Ver detalle
        </button>
      </div>

      <Modal open={detail} onClose={() => setDetail(false)} title="Tu salud financiera">
        <div className="salud-detalle">
          <div className="salud-detalle-head">
            <ScoreRing score={score} color={banda.color} size={104} />
            <div>
              <div className="salud-detalle-banda" style={{ color: banda.color }}>{banda.label}</div>
              <p className="salud-detalle-sub">
                Calculado como lo hace un banco, con tus ingresos, gastos, cuotas y ahorro.
              </p>
            </div>
          </div>

          <div className="salud-comps">
            {componentes.map((comp) => (
              <div key={comp.clave} className="salud-comp">
                <div className="salud-comp-top">
                  <span className="salud-comp-label">{comp.label}</span>
                  <span className="salud-comp-val">{valorTexto(comp)}</span>
                </div>
                <div className="salud-comp-bar">
                  <div
                    className="salud-comp-fill"
                    style={{ width: `${comp.puntaje}%`, background: bandaColor(comp.puntaje) }}
                  />
                </div>
                <div className="salud-comp-meta">{comp.descripcion} · Meta: {comp.meta}</div>
              </div>
            ))}
          </div>

          {consejos.length > 0 && (
            <div className="salud-consejos">
              <span className="salud-consejos-title">Consejos</span>
              {consejos.map((consejo, i) => (
                <p key={consejo.clave || i} className="salud-consejo">{consejo.texto}</p>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
