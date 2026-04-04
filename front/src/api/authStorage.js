let accessToken = null

export function getAccessToken() {
  return accessToken
}

export function setAccessToken(token) {
  accessToken = token || null
}

export function setAuthTokens({ access }) {
  setAccessToken(access)
}

export function clearAuthTokens() {
  accessToken = null
}
