import { useCallback, useEffect, useState } from 'react'
import { clearAuthTokens, setAccessToken } from '../api/authStorage'
import api, { refreshAccessToken } from '../api/client'
import AuthContext from './auth-context'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchPerfil = useCallback(async () => {
    try {
      const { data } = await api.get('/usuarios/perfil/')
      setUser(data)
    } catch {
      clearAuthTokens()
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    async function bootstrapAuth() {
      try {
        await refreshAccessToken()
        await fetchPerfil()
      } catch {
        clearAuthTokens()
        setUser(null)
        setLoading(false)
      }
    }

    void bootstrapAuth()
  }, [fetchPerfil])

  async function login(email, password) {
    const { data } = await api.post('/usuarios/login/', { email, password })
    setAccessToken(data.access)
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
