import axios from 'axios'
import { clearAuthTokens, getAccessToken, setAccessToken } from './authStorage'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

const refreshClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

const AUTH_BYPASS_PATHS = [
  '/usuarios/login/',
  '/usuarios/registro/',
  '/usuarios/password/forgot/',
  '/usuarios/password/reset/',
  '/usuarios/token/refresh/',
  '/usuarios/logout/',
]

let refreshPromise = null

function shouldSkipRefresh(url = '') {
  return AUTH_BYPASS_PATHS.some((path) => url.includes(path))
}

export async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post('/usuarios/token/refresh/', null, {
        headers: { 'X-Aura-Auth-Flow': 'cookie-refresh' },
      })
      .then(({ data }) => {
        setAccessToken(data.access)
        return data.access
      })
      .catch((error) => {
        clearAuthTokens()
        throw error
      })
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

api.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && original && !original._retry && !shouldSkipRefresh(original.url || '')) {
      original._retry = true
      try {
        const access = await refreshAccessToken()
        original.headers = {
          ...(original.headers || {}),
          Authorization: `Bearer ${access}`,
        }
        return api(original)
      } catch {
        clearAuthTokens()
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(error)
  }
)

export default api
