import { useEffect, useState } from 'react'
import { clearAuthTokens, getAccessToken, setAuthTokens } from '../api/authStorage'
import api from '../api/client'
import AuthContext from './auth-context'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getAccessToken()
    if (token) fetchPerfil()
    else setLoading(false)
  }, [])

  async function fetchPerfil() {
    try {
      const { data } = await api.get('/usuarios/perfil/')
      setUser(data)
    } catch {
      clearAuthTokens()
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  async function login(email, password) {
    const { data } = await api.post('/usuarios/login/', { email, password })
    setAuthTokens(data)
    await fetchPerfil()
  }

  async function registro(datos) {
    await api.post('/usuarios/registro/', datos)
    await login(datos.email, datos.password)
  }

  function logout() {
    clearAuthTokens()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, registro, logout, fetchPerfil }}>
      {children}
    </AuthContext.Provider>
  )
}
