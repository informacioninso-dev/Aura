import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import api from '../../api/client'
import { useAuth } from '../../context/useAuth'

export default function PagoResultado() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { fetchPerfil } = useAuth()
  const [estado, setEstado] = useState('loading')
  const [planNombre, setPlanNombre] = useState('')
  const confirmed = useRef(false)

  useEffect(() => {
    if (confirmed.current) return
    confirmed.current = true

    const id = searchParams.get('id')
    const clientTransactionId = searchParams.get('clientTransactionId')

    if (!id || !clientTransactionId) {
      setEstado('error')
      return
    }

    api.post('/usuarios/pago/confirmar/', { id, clientTransactionId })
      .then(({ data }) => {
        if (data.status === 'approved') {
          setPlanNombre(data.plan)
          setEstado('approved')
          fetchPerfil()
        } else if (data.status === 'cancelled') {
          setEstado('cancelled')
        } else {
          setEstado('error')
        }
      })
      .catch(() => setEstado('error'))
  }, [])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      padding: 24,
      background: 'radial-gradient(circle at top, rgba(196,135,246,0.12), rgba(15,23,42,1) 45%)',
    }}>
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1.5px solid rgba(255,255,255,0.08)',
        borderRadius: 20,
        padding: '48px 40px',
        maxWidth: 420,
        width: '100%',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
      }}>
        {estado === 'loading' && (
          <>
            <div className="spinner" />
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15 }}>Verificando pago...</p>
          </>
        )}

        {estado === 'approved' && (
          <>
            <CheckCircle2 size={56} color="#22c55e" strokeWidth={1.5} />
            <div>
              <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
                ¡Pago exitoso!
              </h2>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, margin: 0 }}>
                Tu plan <strong style={{ color: '#C487F6' }}>{planNombre}</strong> ha sido activado.
              </p>
            </div>
            <button className="btn-primary" style={{ width: '100%' }} onClick={() => navigate('/dashboard')}>
              Ir al dashboard
            </button>
          </>
        )}

        {estado === 'cancelled' && (
          <>
            <XCircle size={56} color="#f59e0b" strokeWidth={1.5} />
            <div>
              <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
                Pago cancelado
              </h2>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, margin: 0 }}>
                No se realizó ningún cobro.
              </p>
            </div>
            <button className="btn-primary" style={{ width: '100%' }} onClick={() => navigate('/planes')}>
              Ver planes
            </button>
          </>
        )}

        {estado === 'error' && (
          <>
            <AlertCircle size={56} color="#ef4444" strokeWidth={1.5} />
            <div>
              <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
                Error al verificar
              </h2>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, margin: 0 }}>
                No pudimos confirmar tu pago. Contacta soporte si ya fue debitado.
              </p>
            </div>
            <button className="btn-primary" style={{ width: '100%' }} onClick={() => navigate('/planes')}>
              Volver a planes
            </button>
          </>
        )}
      </div>
    </div>
  )
}
