import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Zap } from 'lucide-react'
import api from '../../api/client'
import { useAuth } from '../../context/useAuth'
import { getApiErrorMessage } from '../../api/errors'

export default function Planes() {
  const { user, fetchPerfil } = useAuth()
  const navigate = useNavigate()
  const [planes, setPlanes] = useState([])
  const [loading, setLoading] = useState(true)
  const [pagando, setPagando] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/usuarios/planes/').then(({ data }) => setPlanes(data)).finally(() => setLoading(false))
  }, [])

  async function handleContratar(plan) {
    if (plan.is_default || plan.precio_mensual <= 0) return
    setPagando(plan.id)
    setError('')
    try {
      const { data } = await api.post('/usuarios/pago/iniciar/', { plan_id: plan.id })
      window.location.href = data.pay_url
    } catch (err) {
      setError(getApiErrorMessage(err, 'No se pudo iniciar el pago.'))
      setPagando(null)
    }
  }

  const planActual = user?.plan?.slug

  if (loading) {
    return (
      <div className="loading-screen" style={{ minHeight: 300 }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="page-container">
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 className="page-title">Planes</h1>
        <p style={{ color: 'rgba(255,255,255,0.55)', marginBottom: 32, fontSize: 15 }}>
          Elige el plan que mejor se adapte a tus necesidades.
        </p>

        {error && (
          <div className="feedback-error" style={{ marginBottom: 20 }}>{error}</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          {planes.map((plan) => {
            const esActual = planActual === plan.slug
            const esGratis = plan.precio_mensual <= 0

            return (
              <div
                key={plan.id}
                style={{
                  background: esActual
                    ? 'linear-gradient(135deg, rgba(196,135,246,0.15), rgba(15,22,41,0.95))'
                    : 'rgba(255,255,255,0.04)',
                  border: esActual ? '1.5px solid rgba(196,135,246,0.5)' : '1.5px solid rgba(255,255,255,0.08)',
                  borderRadius: 18,
                  padding: '28px 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                  position: 'relative',
                }}
              >
                {esActual && (
                  <div style={{
                    position: 'absolute', top: 14, right: 14,
                    background: 'rgba(196,135,246,0.2)', color: '#C487F6',
                    fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                    letterSpacing: '0.5px',
                  }}>
                    PLAN ACTUAL
                  </div>
                )}

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    {!esGratis && <Zap size={16} color="#C487F6" />}
                    <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{plan.name}</span>
                  </div>
                  {plan.description && (
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.50)', margin: 0 }}>{plan.description}</p>
                  )}
                </div>

                <div>
                  {esGratis ? (
                    <span style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>Gratis</span>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>$</span>
                      <span style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>
                        {Number(plan.precio_mensual).toFixed(2)}
                      </span>
                      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
                        / {plan.duracion_meses === 1 ? 'mes' : `${plan.duracion_meses} meses`}
                      </span>
                    </div>
                  )}
                </div>

                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {plan.features.filter(f => f.is_highlighted).map((feature) => {
                    const valor = feature.value_type === 'bool'
                      ? (feature.value_bool ? feature.name : null)
                      : feature.value_int != null
                        ? `${feature.name}: ${feature.value_int}`
                        : feature.value_text || feature.name

                    if (feature.value_type === 'bool' && !feature.value_bool) return null

                    return (
                      <li key={feature.code} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
                        <CheckCircle2 size={14} color="#C487F6" style={{ flexShrink: 0 }} />
                        {valor}
                      </li>
                    )
                  })}
                </ul>

                <div style={{ marginTop: 'auto', paddingTop: 8 }}>
                  {esActual ? (
                    <button className="btn-modal-cancel" style={{ width: '100%', opacity: 0.5, cursor: 'default' }} disabled>
                      Plan activo
                    </button>
                  ) : esGratis ? (
                    <button className="btn-modal-cancel" style={{ width: '100%', opacity: 0.5, cursor: 'default' }} disabled>
                      Plan base
                    </button>
                  ) : (
                    <button
                      className="btn-primary"
                      style={{ width: '100%' }}
                      onClick={() => handleContratar(plan)}
                      disabled={pagando === plan.id}
                    >
                      {pagando === plan.id ? 'Redirigiendo...' : 'Contratar'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
