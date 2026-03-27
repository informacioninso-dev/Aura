import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import AppLayout from './components/layout/AppLayout'
import Home from './pages/home/Home'
import Login from './pages/auth/Login'
import Registro from './pages/auth/Registro'
import Dashboard from './pages/dashboard/Dashboard'
import Ingresos from './pages/ingresos/Ingresos'
import GastosCorrientes from './pages/gastos/GastosCorrientes'
import GastosNoCorrientes from './pages/gastos/GastosNoCorrientes'
import Diferidos from './pages/diferidos/Diferidos'
import Simulador from './pages/simulador/Simulador'
import Perfil from './pages/perfil/Perfil'
import Presupuesto from './pages/presupuesto/Presupuesto'
import Importar from './pages/importar/Importar'
import Reporte from './pages/reporte/Reporte'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/registro" element={<Registro />} />
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/ingresos" element={<Ingresos />} />
            <Route path="/gastos-corrientes" element={<GastosCorrientes />} />
            <Route path="/gastos-no-corrientes" element={<GastosNoCorrientes />} />
            <Route path="/diferidos" element={<Diferidos />} />
            <Route path="/simulador" element={<Simulador />} />
            <Route path="/presupuesto" element={<Presupuesto />} />
            <Route path="/importar" element={<Importar />} />
            <Route path="/reporte" element={<Reporte />} />
            <Route path="/perfil" element={<Perfil />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
