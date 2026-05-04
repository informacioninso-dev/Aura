import { useCallback, useEffect, useState } from 'react'
import { clearAuthTokens, setAccessToken } from '../api/authStorage'
import api, { refreshAccessToken } from '../api/client'
import AuthContext from './auth-context'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

  const fetchPerfil = useCallback(async () => {
    try {
      const { data } = await api.get('/usuarios/perfil/')
      setUser(data)
      return data
    } catch {
      throw new Error('perfil_unavailable')
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrapAuth() {
      try {
        await refreshAccessToken()
        if (cancelled) return
        await fetchPerfil()
      } catch {
        if (cancelled) return
        clearAuthTokens()
        setUser(null)
      } finally {
        if (!cancelled) setCheckingAuth(false)
      }
    }

    void bootstrapAuth()
    return () => {
      cancelled = true
    }
  }, [fetchPerfil])

  async function login(email, password) {
    const { data } = await api.post('/usuarios/login/', { email, password })
    setAccessToken(data.access)
    await fetchPerfil()
    setCheckingAuth(false)
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
        loading: checkingAuth,
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
