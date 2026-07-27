import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { ChevronLeft, Home, Activity, Calendar, CreditCard, ArrowRight } from 'lucide-react'

import GastosCorrientes from './GastosCorrientes'
import GastosNoCorrientes from './GastosNoCorrientes'
import GastosVariables from './GastosVariables'
import GastosResumen from './GastosResumen'
import Diferidos from '../diferidos/Diferidos'
import Modal from '../../components/ui/Modal'
import '../../components/ui/app.css'

// Los cuatro tipos de gasto, unificados bajo "Lo que gastas".
const TIPOS = {
  fijos:     { titulo: 'Gastos fijos' },
  variables: { titulo: 'Gastos variables' },
  puntuales: { titulo: 'Gastos puntuales' },
  cuotas:    { titulo: 'Gastos a cuotas' },
}

// Opciones del selector "que quieres registrar" (clasifica por comportamiento).
const CHOOSER = [
  { id: 'fijos',     icon: Home,       titulo: 'Gasto fijo',      desc: 'Se repite con el mismo valor. Ej: arriendo, seguro.', tint: '#4ADE80' },
  { id: 'variables', icon: Activity,   titulo: 'Consumo variable', desc: 'Se repite, pero cambia. Puedes sumarlo varias veces en el mes.', tint: '#C487F6' },
  { id: 'puntuales', icon: Calendar,   titulo: 'Gasto puntual',   desc: 'Ocurre una sola vez. Ej: matricula, reparacion.', tint: '#4ADE80' },
  { id: 'cuotas',    icon: CreditCard, titulo: 'Gasto a cuotas',  desc: 'Lo pagaras en varios meses. Ej: electrodomestico, prestamo.', tint: '#C487F6' },
]

function renderPanel(tab, autoNew) {
  if (tab === 'puntuales') return <GastosNoCorrientes embedded autoNew={autoNew} />
  if (tab === 'variables') return <GastosVariables autoNew={autoNew} />
  if (tab === 'cuotas') return <Diferidos embedded autoNew={autoNew} />
  return <GastosCorrientes embedded tipoMonto="fijo" autoNew={autoNew} />
}

export default function LoQueGastas() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = TIPOS[searchParams.get('tab')] ? searchParams.get('tab') : null
  const chooserOpen = searchParams.get('nuevo') === 'tipo'
  const autoNew = searchParams.get('nuevo') === '1'

  // Limpia el flag de auto-abrir una vez consumido, para no reabrir el form.
  useEffect(() => {
    if (autoNew) {
      const next = new URLSearchParams(searchParams)
      next.delete('nuevo')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoNew])

  function irATipo(id) {
    const next = new URLSearchParams()
    next.set('tab', id)
    setSearchParams(next)
  }

  function abrirChooser() {
    const next = new URLSearchParams(searchParams)
    next.set('nuevo', 'tipo')
    setSearchParams(next)
  }

  function cerrarChooser() {
    const next = new URLSearchParams(searchParams)
    next.delete('nuevo')
    setSearchParams(next, { replace: true })
  }

  function elegirTipo(id) {
    const next = new URLSearchParams()
    next.set('tab', id)
    next.set('nuevo', '1')   // que el tipo abra su formulario al llegar
    setSearchParams(next)
  }

  function volverAlHub() {
    setSearchParams(new URLSearchParams())
  }

  // — Vista de un tipo concreto (llegaste desde una card del hub) —
  if (tab) {
    return (
      <div className="finance-shell">
        <button type="button" className="gastos-back" onClick={volverAlHub}>
          <ChevronLeft size={16} /> Lo que gastas
        </button>
        <div className="finance-tab-panel">
          {renderPanel(tab, autoNew)}
        </div>
      </div>
    )
  }

  // — Hub (landing) —
  return (
    <div className="finance-shell">
      <div className="page-header">
        <h1 className="page-title">Lo que gastas</h1>
        <p className="page-subtitle">Organiza tus gastos sin complicarte.</p>
      </div>

      <GastosResumen onOpenTipo={irATipo} onAgregar={abrirChooser} />

      <Modal open={chooserOpen} onClose={cerrarChooser} title="Que quieres registrar?">
        <p style={{ marginTop: -8, marginBottom: 16, fontSize: 13, color: 'rgba(var(--app-ink-rgb),0.5)' }}>
          Elige el tipo de gasto segun como se comporta.
        </p>
        <div className="gastos-chooser-grid">
          {CHOOSER.map((op) => {
            const Icon = op.icon
            return (
              <button key={op.id} type="button" className="gastos-chooser-card" onClick={() => elegirTipo(op.id)}>
                <span className="gastos-chooser-icon" style={{ background: `${op.tint}22`, color: op.tint }}><Icon size={20} /></span>
                <span className="gastos-chooser-title">{op.titulo}</span>
                <span className="gastos-chooser-desc">{op.desc}</span>
                <span className="gastos-chooser-arrow"><ArrowRight size={16} /></span>
              </button>
            )
          })}
        </div>
      </Modal>
    </div>
  )
}
