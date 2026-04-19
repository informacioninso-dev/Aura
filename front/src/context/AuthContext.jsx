import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { clearAuthTokens, setAccessToken } from '../api/authStorage'
import api, { refreshAccessToken } from '../api/client'
import AuthContext from './auth-context'

const PUBLIC_PATHS = new Set([
  '/',
  '/login',
  '/registro',
  '/forgot-password',
  '/reset-password',
])

function isPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname)
}

export function AuthProvider({ children }) {
  const location = useLocation()
  const [user, setUser] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(false)
  const [lastProtectedPathChecked, setLastProtectedPathChecked] = useState(null)
  const publicPath = isPublicPath(location.pathname)
  const shouldBootstrapProtectedRoute =
    !publicPath &&
    !user &&
    lastProtectedPathChecked !== location.pathname
  const loading = checkingAuth || shouldBootstrapProtectedRoute

  const fetchPerfil = useCallback(async () => {
    try {
      const { data } = await api.get('/usuarios/perfil/')
      setUser(data)
    } catch {
      clearAuthTokens()
      setUser(null)
    } finally {
      setCheckingAuth(false)
    }
  }, [])

  useEffect(() => {
    if (!shouldBootstrapProtectedRoute) return

    let cancelled = false

    async function bootstrapAuth() {
      setCheckingAuth(true)
      try {
        await refreshAccessToken()
        if (cancelled) return
        await fetchPerfil()
      } catch {
        if (cancelled) return
        clearAuthTokens()
        setUser(null)
        setCheckingAuth(false)
      } finally {
        if (!cancelled) {
          setLastProtectedPathChecked(location.pathname)
        }
      }
    }

    void bootstrapAuth()
    return () => {
      cancelled = true
    }
  }, [fetchPerfil, location.pathname, shouldBootstrapProtectedRoute])

  async function login(email, password) {
    const { data } = await api.post('/usuarios/login/', { email, password })
    setAccessToken(data.access)
    setLastProtectedPathChecked(null)
    await fetchPerfil()
  }

  async function registro(datos) {
    await api.post('/usuarios/registro/', datos)
    await login(datos.email, datos.password)
  }

  async function forgotPassword(email) {
    const { data } = await api.post('/usuarios/password/forgot/', { email })
    return data
  }

  async function resetPassword(payload) {
    const { data } = await api.post('/usuarios/password/reset/', payload)
    return data
  }

  async function changePassword(payload) {
    const { data } = await api.post('/usuarios/password/change/', payload)
    return data
  }

  async function logout() {
    try {
      await api.post(
        '/usuarios/logout/',
        null,
        { headers: { 'X-Aura-Auth-Flow': 'logout' } },
      )
    } catch {
      // Even if the backend session is already stale, clear the local auth state.
    } finally {
      clearAuthTokens()
      setUser(null)
      setCheckingAuth(false)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        registro,
        logout,
        fetchPerfil,
        forgotPassword,
        resetPassword,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
