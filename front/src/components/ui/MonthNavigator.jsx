import { ChevronLeft, ChevronRight } from 'lucide-react'

import { MESES_FULL, startOfMonth, addMonths } from '../../utils/months'
import './app.css'

/**
 * Navegador de mes compartido (‹ Julio 2026 ›).
 * value: Date del primer dia del mes seleccionado.
 * onChange: recibe el nuevo Date.
 * allowFuture: por defecto no deja avanzar mas alla del mes actual, porque los
 *   datos reales (gastos del mes, montos pagados) solo existen hasta hoy.
 */
export default function MonthNavigator({ value, onChange, allowFuture = false }) {
  const current = startOfMonth(value || new Date())
  const nextDisabled = !allowFuture && addMonths(current, 1) > startOfMonth(new Date())

  return (
    <div className="month-nav">
      <button
        type="button"
        className="month-nav-btn"
        onClick={() => onChange(addMonths(current, -1))}
        aria-label="Mes anterior"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="month-nav-label">
        {MESES_FULL[current.getMonth()]} {current.getFullYear()}
      </span>
      <button
        type="button"
        className="month-nav-btn"
        onClick={() => onChange(addMonths(current, 1))}
        disabled={nextDisabled}
        aria-label="Mes siguiente"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
