import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Login from './pages/Login';
import Instances from './pages/Instances';
import Blindage from './pages/Blindage';
import Contacts from './pages/Contacts';
import Tags from './pages/Tags';
import Lists from './pages/Lists';
import Dispatches from './pages/Dispatches';
import DevocionalConfig from './pages/DevocionalConfig';
import MensagensPersonalizadas from './pages/MensagensPersonalizadas';
import Logs from './pages/Logs';
import Layout from './components/Layout';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, init } = useAuthStore();
  const [isInitialized, setIsInitialized] = useState(false);
  
  useEffect(() => {
    init();
    setIsInitialized(true);
  }, [init]);
  
  if (!isInitialized) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            border: '3px solid var(--gold-primary)',
            borderTopColor: 'transparent',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 16px',
          }} />
          <p style={{ color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif', fontSize: '0.9rem' }}>
            Carregando...
          </p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }
  
  return user ? <Layout>{children}</Layout> : <Navigate to="/login" />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<PrivateRoute><Instances /></PrivateRoute>} />
        <Route path="/blindage/:instanceId?" element={<PrivateRoute><Blindage /></PrivateRoute>} />
        <Route path="/contacts" element={<PrivateRoute><Contacts /></PrivateRoute>} />
        <Route path="/tags" element={<PrivateRoute><Tags /></PrivateRoute>} />
        <Route path="/lists" element={<PrivateRoute><Lists /></PrivateRoute>} />
        <Route path="/dispatches" element={<PrivateRoute><Dispatches /></PrivateRoute>} />
        <Route path="/devocional/config" element={<PrivateRoute><DevocionalConfig /></PrivateRoute>} />
        {/* Rota nova: Mensagens Personalizadas (antigo /marketing/config) */}
        <Route path="/mensagens/config" element={<PrivateRoute><MensagensPersonalizadas /></PrivateRoute>} />
        {/* Compatibilidade retroativa */}
        <Route path="/marketing/config" element={<Navigate to="/mensagens/config" replace />} />
        <Route path="/logs" element={<PrivateRoute><Logs /></PrivateRoute>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
