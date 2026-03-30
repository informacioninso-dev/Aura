function flattenMessages(value) {
  if (Array.isArray(value)) return value.map(flattenMessages).filter(Boolean).join(' ')
  if (value && typeof value === 'object') return Object.values(value).map(flattenMessages).filter(Boolean).join(' ')
  if (value == null) return ''
  return String(value)
}

export function getApiErrorMessage(error, fallback = 'Ocurrió un error. Intenta nuevamente.') {
  const data = error?.response?.data
  if (!data) return fallback

  if (typeof data === 'string') {
    const trimmed = data.trim()
    const looksLikeHtml = /<!doctype html|<html[\s>]/i.test(trimmed)
    if (looksLikeHtml) return 'Error interno del servidor. Intenta nuevamente en unos segundos.'
    return trimmed || fallback
  }
  if (typeof data.detail === 'string') return data.detail

  const flattened = flattenMessages(data).trim()
  return flattened || fallback
}
