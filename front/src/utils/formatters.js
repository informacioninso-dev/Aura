// Formato fijo para toda la app: 1,146.42 (coma de miles, punto decimal).
// Antes se usaba navigator.language, asi que el mismo dato se veia "1.234,50" o
// "1,234.50" segun el equipo y dos personas mirando la misma cuenta veian
// puntuaciones distintas. El formato de la plata no debe depender del navegador.
const DEFAULT_LOCALE = 'en-US'

function resolveLocale(locale) {
  return locale || DEFAULT_LOCALE
}

function toFiniteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

export function formatNumber(value, options = {}, locale) {
  return new Intl.NumberFormat(resolveLocale(locale), options).format(toFiniteNumber(value))
}

export function formatAmount(value, options = {}, locale) {
  return formatNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  }, locale)
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

  const hasMinDigits = Object.prototype.hasOwnProperty.call(restOptions, 'minimumFractionDigits')
  const hasMaxDigits = Object.prototype.hasOwnProperty.call(restOptions, 'maximumFractionDigits')
  const numberFormatOptions = {
    style: 'decimal',
    ...restOptions,
  }
  if (!hasMinDigits && !hasMaxDigits) {
    numberFormatOptions.minimumFractionDigits = 2
    numberFormatOptions.maximumFractionDigits = 2
  }

  const numberPortion = new Intl.NumberFormat(resolvedLocale, numberFormatOptions).format(absoluteValue)

  return `${numericValue < 0 ? '-' : ''}${currencySymbol}${numberPortion}`
}
