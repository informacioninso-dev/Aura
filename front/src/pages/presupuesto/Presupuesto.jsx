import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import api from '../../api/client'
import Modal from '../../components/ui/Modal'
import '../../components/ui/app.css'

const FREQ = { diario: 30, semanal: 4.33, quincenal: 2, mensual: 1, bimestral: 0.5, trimestral: 0.333, semestral: 0.167, anual: 0.083 }

const ICONOS_SUGERIDOS = ['📦','🏠','🛒','🚗','💊','📚','🎬','👕','💡','💻','💳','🐷','✈️','🏋️','🎵','🍔','☕','🎮','🐾','🌿','💰','🎁','🔧','📱']

const EMPTY_FORM = { nombre: '', icono: '📦', limite_mensual: '' }

export default function Presupuesto() {
  const [categorias, setCategorias] = useState([])
  const [gastos, setGastos]         = useState({})
  const [modal, setModal]           = useState(false)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [editId, setEditId]         = useState(null)
  const [saving, setSaving]         = useState(false)
  const [editPresup, setEditPresup] = useState(null) // id de cat editando presupuesto inline
  const [valorPresup, setValorPresup] = useState('')

  useEffect(() => { cargarTodo() }, [])

  async function cargarTodo() {
    const [cats, gc, gnc] = await Promise.all([
      api.get('/finanzas/categorias/'),
      api.get('/finanzas/gastos-corrientes/'),
      api.get('/finanzas/gastos-no-corrientes/'),
    ])
    setCategorias(cats.data)

    // Gasto real del mes actual por categoría
    const hoy  = new Date()
    const mes  = hoy.getMonth()
    const anio = hoy.getFullYear()
    const totales = {}

    gc.data.filter(g => g.activo).forEach(g => {
      const ini   = new Date(g.fecha_inicio)
      const fin   = g.fecha_fin ? new Date(g.fecha_fin) : null
      const fecha = new Date(anio, mes, 1)
      if (ini <= fecha && (!fin || fin >= fecha)) {
        totales[g.categoria] = (totales[g.categoria] || 0) + parseFloat(g.monto) * (FREQ[g.frecuencia] || 1)
      }
    })
    gnc.data.forEach(g => {
      const d = new Date(g.fecha)
      if (d.getMonth() === mes && d.getFullYear() === anio) {
        totales[g.categoria] = (totales[g.categoria] || 0) + parseFloat(g.monto)
      }
    })
    setGastos(totales)
  }

  function openNew() { setForm(EMPTY_FORM); setEditId(null); setModal(true) }
  function openEdit(cat) {
    setForm({ nombre: cat.nombre, icono: cat.icono, limite_mensual: cat.limite_mensual || '' })
    setEditId(cat.id); setModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault(); setSaving(true)
    try {
      if (editId) {
        const { data } = await api.put(`/finanzas/categorias/${editId}/`, form)
        setCategorias(prev => prev.map(c => c.id === editId ? data : c))
      } else {
        const { data } = await api.post('/finanzas/categorias/', form)
        setCategorias(prev => [...prev, data])
      }
      setModal(false)
    } finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar esta categoría? Los gastos que la usan quedarán con ese nombre.')) return
    await api.delete(`/finanzas/categorias/${id}/`)
    setCategorias(prev => prev.filter(c => c.id !== id))
  }

  async function guardarPresupuesto(cat) {
    const limite = parseFloat(valorPresup)
    if (!valorPresup || isNaN(limite) || limite <= 0) { setEditPresup(null); return }
    const { data } = await api.patch(`/finanzas/categorias/${cat.id}/`, { limite_mensual: limite })
    setCategorias(prev => prev.map(c => c.id === cat.id ? data : c))
    setEditPresup(null)
  }

  async function quitarPresupuesto(cat) {
    const { data } = await api.patch(`/finanzas/categorias/${cat.id}/`, { limite_mensual: null })
    setCategorias(prev => prev.map(c => c.id === cat.id ? data : c))
    setEditPresup(null)
  }

  const conLimite    = categorias.filter(c => c.limite_mensual !== null && c.limite_mensual !== undefined)
  const sinLimite    = categorias.filter(c => c.limite_mensual === null || c.limite_mensual === undefined)

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Categorías y presupuesto</h1>
          <p className="page-subtitle">Crea tus categorías y ponles un límite mensual para no pasarte.</p>
        </div>
        <button className="btn-add" onClick={openNew}><Plus size={16} /> Nueva categoría</button>
      </div>

      {/* ── CON PRESUPUESTO ── */}
      {conLimite.length > 0 && (
        <>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Con límite mensual</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 14, marginBottom: 28 }}>
            {conLimite.map(cat => (
              <TarjetaCategoria key={cat.id} cat={cat} gasto={gastos[cat.nombre] || 0}
                openEdit={openEdit} handleDelete={handleDelete}
                editPresup={editPresup} setEditPresup={setEditPresup}
                valorPresup={valorPresup} setValorPresup={setValorPresup}
                guardarPresupuesto={guardarPresupuesto} quitarPresupuesto={quitarPresupuesto} />
            ))}
          </div>
        </>
      )}

      {/* ── SIN PRESUPUESTO ── */}
      {sinLimite.length > 0 && (
        <>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Sin límite definido</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 14 }}>
            {sinLimite.map(cat => (
              <TarjetaCategoria key={cat.id} cat={cat} gasto={gastos[cat.nombre] || 0}
                openEdit={openEdit} handleDelete={handleDelete}
                editPresup={editPresup} setEditPresup={setEditPresup}
                valorPresup={valorPresup} setValorPresup={setValorPresup}
                guardarPresupuesto={guardarPresupuesto} quitarPresupuesto={quitarPresupuesto} />
            ))}
          </div>
        </>
      )}

      {/* ── MODAL CREAR / EDITAR CATEGORÍA ── */}
      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar categoría' : '+ Nueva categoría'}>
        <form onSubmit={handleSubmit}>
          <div className="form-modal-group">
            <label className="form-modal-label">Nombre</label>
            <input className="form-modal-input" required placeholder="Ej: mascota, gimnasio..."
              value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">Ícono</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {ICONOS_SUGERIDOS.map(ic => (
                <button key={ic} type="button"
                  onClick={() => setForm({ ...form, icono: ic })}
                  style={{ fontSize: 22, background: form.icono === ic ? 'rgba(196,135,246,0.20)' : 'rgba(255,255,255,0.05)', border: form.icono === ic ? '1.5px solid rgba(196,135,246,0.50)' : '1.5px solid transparent', borderRadius: 10, padding: '4px 8px', cursor: 'pointer', transition: 'all 0.15s' }}>
                  {ic}
                </button>
              ))}
            </div>
            <input className="form-modal-input" placeholder="O escribe un emoji directamente"
              value={form.icono} onChange={e => setForm({ ...form, icono: e.target.value })}
              style={{ width: 140 }} />
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">Presupuesto mensual <span>(opcional)</span></label>
            <input className="form-modal-input" type="number" min="0" step="0.01" placeholder="Sin límite"
              value={form.limite_mensual} onChange={e => setForm({ ...form, limite_mensual: e.target.value })} />
          </div>
          <div className="form-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={() => setModal(false)}>Cancelar</button>
            <button type="submit" className="btn-modal-save" disabled={saving}>
              {saving ? 'Guardando...' : editId ? 'Guardar cambios' : 'Crear categoría'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function TarjetaCategoria({ cat, gasto, openEdit, handleDelete, editPresup, setEditPresup, valorPresup, setValorPresup, guardarPresupuesto, quitarPresupuesto }) {
  const limite = cat.limite_mensual ? parseFloat(cat.limite_mensual) : null
  const pct    = limite ? Math.min(100, Math.round((gasto / limite) * 100)) : null
  const over   = pct !== null && pct >= 100
  const warn   = pct !== null && pct >= 75 && pct < 100
  const barColor = over ? '#F87171' : warn ? '#FBBF24' : '#10B981'

  return (
    <div className="card" style={{ padding: 18 }}>
      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>{cat.icono}</span>
          <span style={{ fontWeight: 700, fontSize: 15, textTransform: 'capitalize' }}>{cat.nombre}</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn-icon edit" onClick={() => openEdit(cat)}><Pencil size={13} /></button>
          <button className="btn-icon danger" onClick={() => handleDelete(cat.id)}><Trash2 size={13} /></button>
        </div>
      </div>

      {/* Barra de progreso si tiene límite */}
      {limite !== null && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
            <span style={{ color: over ? '#F87171' : warn ? '#FBBF24' : 'rgba(255,255,255,0.55)' }}>
              ${Math.round(gasto).toLocaleString('es-CL')}
              {over && ' ⚠'}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.30)' }}>${Math.round(limite).toLocaleString('es-CL')}</span>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 99, height: 6, marginBottom: 4 }}>
            <div style={{ width: `${pct}%`, height: 6, borderRadius: 99, background: barColor, transition: 'width 0.4s' }} />
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', textAlign: 'right', marginBottom: 10 }}>{pct}% usado</div>
        </>
      )}

      {/* Sin límite: solo muestra gasto si hay */}
      {limite === null && gasto > 0 && (
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 10 }}>
          Gastado este mes: <strong style={{ color: '#fff' }}>${Math.round(gasto).toLocaleString('es-CL')}</strong>
        </div>
      )}

      {/* Edición inline del presupuesto */}
      {editPresup === cat.id ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
          <input className="form-modal-input" type="number" min="0" step="0.01" placeholder="Límite mensual"
            value={valorPresup} onChange={e => setValorPresup(e.target.value)}
            style={{ flex: 1, padding: '7px 10px', fontSize: 13 }}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') guardarPresupuesto(cat); if (e.key === 'Escape') setEditPresup(null) }} />
          <button onClick={() => guardarPresupuesto(cat)}
            style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.30)', borderRadius: 8, padding: '6px 8px', color: '#10B981', cursor: 'pointer', display: 'flex' }}>
            <Check size={14} />
          </button>
          {limite !== null && (
            <button onClick={() => quitarPresupuesto(cat)}
              style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.20)', borderRadius: 8, padding: '6px 8px', color: '#F87171', cursor: 'pointer', display: 'flex' }}>
              <X size={14} />
            </button>
          )}
        </div>
      ) : (
        <button onClick={() => { setEditPresup(cat.id); setValorPresup(cat.limite_mensual || '') }}
          style={{ width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 600, color: limite ? 'rgba(255,255,255,0.35)' : '#C487F6', background: limite ? 'rgba(255,255,255,0.04)' : 'rgba(196,135,246,0.08)', border: limite ? '1px solid rgba(255,255,255,0.07)' : '1px dashed rgba(196,135,246,0.35)', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s' }}>
          {limite ? '✏ Cambiar límite' : '+ Añadir límite mensual'}
        </button>
      )}
    </div>
  )
}
