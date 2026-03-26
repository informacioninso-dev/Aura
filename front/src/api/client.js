import axios from 'axios'
import { clearAuthTokens, getAccessToken, getRefreshToken, setAuthTokens } from './authStorage'

const api = axios.create({
  baseURL: '/api',
})

api.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      const refresh = getRefreshToken()
      if (refresh) {
        try {
          const { data } = await axios.post('/api/usuarios/token/refresh/', { refresh })
          setAuthTokens({ access: data.access, refresh })
          original.headers.Authorization = `Bearer ${data.access}`
          return api(original)
        } catch {
          clearAuthTokens()
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(error)
  }
)

export default api
