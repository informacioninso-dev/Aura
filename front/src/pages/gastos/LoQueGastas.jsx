import { useSearchParams } from 'react-router-dom'

import GastosCorrientes from './GastosCorrientes'
import GastosNoCorrientes from './GastosNoCorrientes'
import '../../components/ui/app.css'

const TAB_OPTIONS = [
  {
    id: 'fijos',
    label: 'Fijos',
    subtitle: 'Se repiten con el mismo monto.',
  },
  {
    id: 'variables',
    label: 'Variables',
    subtitle: 'Se repiten pero cambia el monto.',
  },
  {
    id: 'puntuales',
    label: 'Puntuales',
    subtitle: 'Compras o imprevistos de una vez.',
  },
]

function renderPanel(tab) {
  if (tab === 'puntuales') return <GastosNoCorrientes embedded />
  if (tab === 'variables') return <GastosCorrientes embedded tipoMonto="variable" />
  return <GastosCorrientes embedded tipoMonto="fijo" />
}

export default function LoQueGastas() {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentTab = TAB_OPTIONS.some((item) => item.id === searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'fijos'

  function changeTab(nextTab) {
    const next = new URLSearchParams(searchParams)
    next.set('tab', nextTab)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="finance-shell">
      <div className="page-header">
        <h1 className="page-title">Lo que gastas</h1>
        <p className="page-subtitle">Todo lo que sale: fijo, variable o puntual.</p>
      </div>

      <div className="finance-tabs" role="tablist" aria-label="Tipos de gastos">
        {TAB_OPTIONS.map((tab) => {
          const active = tab.id === currentTab
          return (
            <button
              key={tab.id}
              type="button"
              className={`finance-tab ${active ? 'is-active' : ''}`}
              onClick={() => changeTab(tab.id)}
              role="tab"
              aria-selected={active}
            >
              <span className="finance-tab-label">{tab.label}</span>
              <span className="finance-tab-subtitle">{tab.subtitle}</span>
            </button>
          )
        })}
      </div>

      <div className="finance-tab-panel">
        {renderPanel(currentTab)}
      </div>
    </div>
  )
}
