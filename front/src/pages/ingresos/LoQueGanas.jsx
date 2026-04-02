import { useSearchParams } from 'react-router-dom'

import Ingresos from './Ingresos'
import IngresosPuntuales from './IngresosPuntuales'
import '../../components/ui/app.css'

const TAB_OPTIONS = [
  {
    id: 'fijos',
    label: 'Fijos',
    subtitle: 'Lo que entra mes a mes.',
  },
  {
    id: 'puntuales',
    label: 'Puntuales',
    subtitle: 'Extras que llegan una sola vez.',
  },
]

export default function LoQueGanas() {
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
        <h1 className="page-title">Lo que ganas</h1>
        <p className="page-subtitle">Todo lo que te entra, fijo o puntual.</p>
      </div>

      <div className="finance-tabs" role="tablist" aria-label="Tipos de ingresos">
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
        {currentTab === 'puntuales' ? <IngresosPuntuales embedded /> : <Ingresos embedded />}
      </div>
    </div>
  )
}
