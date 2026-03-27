import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, AlertTriangle, TrendingDown } from 'lucide-react'
import api from '../../api/client'

export default function NotificationBell() {
  const [notifs, setNotifs]   = useState([])
  const [open, setOpen]       = useState(false)
  const ref                   = useRef(null)

  useEffect(() => {
    fetchNotifs()
    const id = setInterval(fetchNotifs, 60_000) // refresca cada minuto
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function fetchNotifs() {
    try {
      const { data } = await api.get('/finanzas/notificaciones/')
      setNotifs(data)
    } catch { /* silencioso */ }
  }

  async function marcarLeida(id) {
    await api.patch(`/finanzas/notificaciones/${id}/leer/`)
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, leida: true } : n))
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
          position: 'relative', background: open ? 'rgba(196,135,246,0.15)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${open ? 'rgba(196,135,246,0.35)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: 12, padding: '8px 10px', cursor: 'pointer',
          color: noLeidas > 0 ? '#C487F6' : 'rgba(255,255,255,0.45)',
          display: 'flex', alignItems: 'center', transition: 'all 0.15s',
        }}>
        <Bell size={18} />
        {noLeidas > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            background: '#F87171', color: '#fff', borderRadius: 99,
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
          width: 320, background: 'rgba(15,23,42,0.97)', border: '1px solid rgba(196,135,246,0.20)',
          borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(20px)', zIndex: 1000, overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Notificaciones</span>
            {noLeidas > 0 && (
              <button onClick={marcarTodas}
                style={{ background: 'none', border: 'none', color: '#C487F6', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCheck size={14} /> Leer todas
              </button>
            )}
          </div>

          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {notifs.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.30)', fontSize: 13 }}>
                Sin notificaciones 🎉
              </div>
            ) : notifs.map(n => (
              <div key={n.id}
                onClick={() => !n.leida && marcarLeida(n.id)}
                style={{
                  padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)',
                  background: n.leida ? 'transparent' : 'rgba(196,135,246,0.05)',
                  cursor: n.leida ? 'default' : 'pointer',
                  transition: 'background 0.15s',
                }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>
                    {n.tipo === 'presupuesto_superado' ? '🔴' : '🟡'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 3, color: n.leida ? 'rgba(255,255,255,0.55)' : '#fff' }}>
                      {n.titulo}
                    </p>
                    <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', lineHeight: 1.4 }}>{n.mensaje}</p>
                  </div>
                  {!n.leida && (
                    <div style={{ width: 7, height: 7, borderRadius: 99, background: '#C487F6', flexShrink: 0, marginTop: 4 }} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
