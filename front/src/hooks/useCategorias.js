import { useEffect, useState } from 'react'
import api from '../api/client'

export function useCategorias() {
  const [categorias, setCategorias] = useState([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    api.get('/finanzas/categorias/')
      .then(r => setCategorias(r.data))
      .finally(() => setLoading(false))
  }, [])

  return { categorias, loading, setCategorias }
}
