import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

import { AuthProvider } from './context/AuthContext'
import Home from './pages/home/Home'

const AppLayout = lazy(() => import('./components/layout/AppLayout'))
const Login = lazy(() => import('./pages/auth/Login'))
const Registro = lazy(() => import('./pages/auth/Registro'))
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'))
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'))
const LoQueGanas = lazy(() => import('./pages/ingresos/LoQueGanas'))
const LoQueGastas = lazy(() => import('./pages/gastos/LoQueGastas'))
const Diferidos = lazy(() => import('./pages/diferidos/Diferidos'))
const Simulador = lazy(() => import('./pages/simulador/Simulador'))
const Perfil = lazy(() => import('./pages/perfil/Perfil'))
const Presupuesto = lazy(() => import('./pages/presupuesto/Presupuesto'))
const Importar = lazy(() => import('./pages/importar/Importar'))
const Reporte = lazy(() => import('./pages/reporte/Reporte'))
const SuperAdmin = lazy(() => import('./pages/superadmin/SuperAdmin'))

function AppBootFallback() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'radial-gradient(circle at top, rgba(196,135,246,0.12), rgba(15,23,42,1) 45%)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.16)',
            borderTopColor: '#C487F6',
            margin: '0 auto 10px',
            animation: 'app-loader-spin 0.8s linear infinite',
          }}
        />
        <p style={{ color: 'rgba(255,255,255,0.70)', fontSize: 14 }}>Cargando Aura...</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<AppBootFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/registro" element={<Registro />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/ingresos" element={<LoQueGanas />} />
              <Route path="/ingresos-puntuales" element={<Navigate to="/ingresos?tab=puntuales" replace />} />
              <Route path="/gastos" element={<LoQueGastas />} />
              <Route path="/gastos-corrientes" element={<Navigate to="/gastos?tab=fijos" replace />} />
              <Route path="/gastos-no-corrientes" element={<Navigate to="/gastos?tab=puntuales" replace />} />
              <Route path="/diferidos" element={<Diferidos />} />
              <Route path="/simulador" element={<Simulador />} />
              <Route path="/presupuesto" element={<Presupuesto />} />
              <Route path="/importar" element={<Importar />} />
              <Route path="/reporte" element={<Reporte />} />
              <Route path="/perfil" element={<Perfil />} />
              <Route path="/superadmin" element={<SuperAdmin />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
