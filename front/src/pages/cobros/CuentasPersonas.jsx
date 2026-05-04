import { useSearchParams } from 'react-router-dom'

import CuentasPersonasPanel from './LoQueMeDeben'
import '../../components/ui/app.css'

const TAB_OPTIONS = [
  {
    id: 'me_deben',
    label: 'Me deben',
    subtitle: 'Prestamos, vueltas o favores pendientes contigo.',
  },
  {
    id: 'debo',
    label: 'Debo',
    subtitle: 'Lo que aun tienes por devolver o pagar.',
  },
]

export default function CuentasPersonas() {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentTab = TAB_OPTIONS.some((item) => item.id === searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'me_deben'

  function changeTab(nextTab) {
    const next = new URLSearchParams(searchParams)
    next.set('tab', nextTab)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="finance-shell">
      <div className="page-header">
        <h1 className="page-title">Cuentas con personas</h1>
        <p className="page-subtitle">Pequenas deudas, vueltas y prestamos informales con conocidos.</p>
      </div>

      <div className="finance-tabs" role="tablist" aria-label="Tipos de cuentas con personas">
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
        <CuentasPersonasPanel key={currentTab} direction={currentTab} embedded />
      </div>
    </div>
  )
}
