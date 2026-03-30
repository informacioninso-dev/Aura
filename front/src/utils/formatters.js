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
  const { currency = 'USD', locale, ...restOptions } = options
  return new Intl.NumberFormat(resolveLocale(locale), {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
    ...restOptions,
  }).format(toFiniteNumber(value))
}
