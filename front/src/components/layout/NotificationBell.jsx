import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Bell, CheckCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'

export default function NotificationBell() {
  const navigate = useNavigate()
  const [notifs, setNotifs]   = useState([])
  const [open, setOpen]       = useState(false)
  const ref                   = useRef(null)

  const fetchNotifs = useCallback(async () => {
    try {
      const { data } = await api.get('/finanzas/notificaciones/')
      setNotifs(data)
    } catch {
      // silencioso
    }
  }, [])

  useEffect(() => {
    const bootstrapId = setTimeout(fetchNotifs, 0)
    const id = setInterval(fetchNotifs, 60_000) // refresca cada minuto
    return () => {
      clearTimeout(bootstrapId)
      clearInterval(id)
    }
  }, [fetchNotifs])

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function getNotificationTarget(notification) {
    const params = new URLSearchParams()
    if (notification.anio) params.set('anio', notification.anio)
    if (notification.mes) params.set('mes', notification.mes)

    if (notification.tipo === 'variables_pendientes') {
      params.set('tab', 'variables')
      return `/gastos?${params.toString()}`
    }

    if (notification.categoria) params.set('categoria', notification.categoria)
    return `/presupuesto?${params.toString()}`
  }

  function abrirNotificacion(notification) {
    setOpen(false)
    if (!notification.leida) {
      setNotifs(prev => prev.map(n => n.id === notification.id ? { ...n, leida: true } : n))
      void api.patch(`/finanzas/notificaciones/${notification.id}/leer/`).catch(fetchNotifs)
    }
    navigate(getNotificationTarget(notification))
  }

  async function marcarTodas() {
    await api.post('/finanzas/notificaciones/marcar_todas_leidas/')
    setNotifs(prev => prev.map(n => ({ ...n, leida: true })))
  }

  const noLeidas = notifs.filter(n => !n.leida).length

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'relative', background: open ? 'rgba(196,135,246,0.15)' : 'rgba(var(--app-ink-rgb),0.06)',
          border: `1px solid ${open ? 'rgba(196,135,246,0.35)' : 'rgba(var(--app-ink-rgb),0.08)'}`,
          borderRadius: 12, padding: '8px 10px', cursor: 'pointer',
          color: noLeidas > 0 ? 'var(--app-lila)' : 'rgba(var(--app-ink-rgb),0.45)',
          display: 'flex', alignItems: 'center', transition: 'all 0.15s',
        }}>
        <Bell size={18} />
        {noLeidas > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            background: 'var(--app-danger)', color: 'var(--app-on-accent)', borderRadius: 99,
            fontSize: 10, fontWeight: 800, minWidth: 16, height: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px',
          }}>
            {noLeidas > 9 ? '9+' : noLeidas}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)',
          width: 320, background: 'var(--app-popover)', border: '1px solid rgba(196,135,246,0.20)',
          borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(20px)', zIndex: 1000, overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid rgba(var(--app-ink-rgb),0.07)' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Notificaciones</span>
            {noLeidas > 0 && (
              <button onClick={marcarTodas}
                style={{ background: 'none', border: 'none', color: 'var(--app-lila)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCheck size={14} /> Leer todas
              </button>
            )}
          </div>

          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {notifs.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'rgba(var(--app-ink-rgb),0.30)', fontSize: 13 }}>
                Sin notificaciones 🎉
              </div>
            ) : notifs.map(n => (
              <button
                key={n.id}
                type="button"
                onClick={() => abrirNotificacion(n)}
                style={{
                  width: '100%', border: 'none', color: 'inherit', font: 'inherit', textAlign: 'left',
                  padding: '12px 16px', borderBottom: '1px solid rgba(var(--app-ink-rgb),0.05)',
                  background: n.leida ? 'transparent' : 'rgba(196,135,246,0.05)',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>
                    {n.tipo === 'presupuesto_superado' ? '🔴' : '🟡'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 3, color: n.leida ? 'rgba(var(--app-ink-rgb),0.55)' : 'var(--app-text)' }}>
                      {n.titulo}
                    </p>
                    <p style={{ fontSize: 12, color: 'rgba(var(--app-ink-rgb),0.40)', lineHeight: 1.4 }}>{n.mensaje}</p>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 7, color: 'var(--app-lila)', fontSize: 11, fontWeight: 700 }}>
                      Ver detalle <ArrowRight size={12} />
                    </span>
                  </div>
                  {!n.leida && (
                    <div style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--app-lila)', flexShrink: 0, marginTop: 4 }} />
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
