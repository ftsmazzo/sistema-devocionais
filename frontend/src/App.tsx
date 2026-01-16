import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Login from './pages/Login';
import Instances from './pages/Instances';
import Blindage from './pages/Blindage';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, init } = useAuthStore();
  const [isInitialized, setIsInitialized] = useState(false);
  
  useEffect(() => {
    init();
    setIsInitialized(true);
  }, [init]);
  
  // Aguardar inicialização antes de verificar user
  if (!isInitialized) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>;
  }
  
  return user ? <>{children}</> : <Navigate to="/login" />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Instances />
            </PrivateRoute>
          }
        />
        <Route
          path="/blindage/:instanceId?"
          element={
            <PrivateRoute>
              <Blindage />
            </PrivateRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
