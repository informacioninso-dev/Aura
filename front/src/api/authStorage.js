let accessToken = null

const SESSION_HINT_KEY = 'aura_has_session'

export function getAccessToken() {
  return accessToken
}

export function hasSessionHint() {
  return window.localStorage.getItem(SESSION_HINT_KEY) === '1'
}

export function setAccessToken(token) {
  accessToken = token || null
  if (accessToken) window.localStorage.setItem(SESSION_HINT_KEY, '1')
}

export function setAuthTokens({ access }) {
  setAccessToken(access)
}

export function clearAuthTokens() {
  accessToken = null
  window.localStorage.removeItem(SESSION_HINT_KEY)
}