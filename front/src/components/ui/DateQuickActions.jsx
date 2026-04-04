function parseLocalDate(value) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function formatLocalDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftMonths(date, amount) {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(date.getDate(), lastDay))
  return target
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

const DEFAULT_ACTIONS = [
  { key: 'today', label: 'Hoy', resolve: () => new Date() },
  { key: 'prev-month', label: 'Mes pasado', resolve: (base) => shiftMonths(base, -1) },
  { key: 'month-start', label: 'Inicio de mes', resolve: (base) => startOfMonth(base) },
  { key: 'month-end', label: 'Fin de mes', resolve: (base) => endOfMonth(base) },
]

export default function DateQuickActions({
  value,
  onChange,
  allowClear = false,
  disabled = false,
  actions = DEFAULT_ACTIONS,
}) {
  const baseDate = parseLocalDate(value) ?? new Date()

  return (
    <div className="date-shortcuts" aria-label="Atajos de fecha">
      {actions.map((action) => {
        const nextValue = formatLocalDate(action.resolve(baseDate))
        return (
          <button
            key={action.key}
            type="button"
            className={`date-shortcut${value === nextValue ? ' is-active' : ''}`}
            onClick={() => onChange(nextValue)}
            aria-pressed={value === nextValue}
            disabled={disabled}
          >
            {action.label}
          </button>
        )
      })}
      {allowClear && value && (
        <button
          type="button"
          className={`date-shortcut date-shortcut-clear${!value ? ' is-active' : ''}`}
          onClick={() => onChange('')}
          aria-pressed={!value}
          disabled={disabled}
        >
          Limpiar
        </button>
      )}
    </div>
  )
}
