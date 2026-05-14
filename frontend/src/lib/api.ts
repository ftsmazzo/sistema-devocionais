import axios from 'axios';

// Sempre usa proxy relativo para evitar problemas de Mixed Content (HTTP/HTTPS)
// O nginx faz o proxy de /api para o backend
const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor para adicionar token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const fullUrl = `${config.baseURL || ''}${config.url || ''}`;
  console.log('📤 Requisição:', config.method?.toUpperCase(), config.url, fullUrl);
  return config;
});

// Interceptor para tratar erros
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Só redireciona para login se o erro 401 vier do nosso backend (rotas /api/auth)
    // Erros 401 de outras rotas não devem deslogar o usuário
    if (error.response?.status === 401 && error.config?.url?.includes('/auth') && !error.config?.url?.includes('/branding')) {
      console.log('🔒 Token inválido, redirecionando para login...');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
