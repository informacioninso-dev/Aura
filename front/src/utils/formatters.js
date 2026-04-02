const DEFAULT_LOCALE = 'es-419'

function resolveLocale(locale) {
  if (locale) return locale
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language
  return DEFAULT_LOCALE
}

function toFiniteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

export function formatNumber(value, options = {}, locale) {
  return new Intl.NumberFormat(resolveLocale(locale), options).format(toFiniteNumber(value))
}

export function formatMoney(value, options = {}) {
  const { currency = 'USD', locale, currencyDisplay = 'symbol', ...restOptions } = options
  const resolvedLocale = resolveLocale(locale)
  const numericValue = toFiniteNumber(value)
  const absoluteValue = Math.abs(numericValue)

  const currencySymbol = new Intl.NumberFormat(resolvedLocale, {
    style: 'currency',
    currency,
    currencyDisplay,
  })
    .formatToParts(1)
    .find((part) => part.type === 'currency')?.value || currency

  const numberPortion = new Intl.NumberFormat(resolvedLocale, {
    style: 'decimal',
    maximumFractionDigits: 0,
    ...restOptions,
  }).format(absoluteValue)

  return `${numericValue < 0 ? '-' : ''}${currencySymbol}${numberPortion}`
}
