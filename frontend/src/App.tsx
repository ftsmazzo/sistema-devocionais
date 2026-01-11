import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout/Layout'
import Login from './pages/Login/Login'
import Dashboard from './pages/Dashboard/Dashboard'
import Contatos from './pages/Contatos/Contatos'
import Devocionais from './pages/Devocionais/Devocionais'
import Envios from './pages/Envios/Envios'
import Configuracoes from './pages/Configuracoes/Configuracoes'
import './App.css'

function App() {
  const { checkAuth } = useAuthStore()

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Layout>
                <Dashboard />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/contatos"
          element={
            <ProtectedRoute>
              <Layout>
                <Contatos />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/devocionais"
          element={
            <ProtectedRoute>
              <Layout>
                <Devocionais />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/envios"
          element={
            <ProtectedRoute>
              <Layout>
                <Envios />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/configuracoes"
          element={
            <ProtectedRoute>
              <Layout>
                <Configuracoes />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
