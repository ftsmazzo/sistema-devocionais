import axios, { AxiosError } from 'axios'
import type {
  Devocional,
  Contato,
  Envio,
  Stats,
  LoginRequest,
  LoginResponse,
} from '../types'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Interceptor para adicionar token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Interceptor para tratar erros
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Token inválido, fazer logout
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ============================================
// AUTENTICAÇÃO
// ============================================

export const authApi = {
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const response = await api.post<LoginResponse>('/auth/login', data)
    return response.data
  },

  logout: async (): Promise<void> => {
    await api.post('/auth/logout')
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  },

  getCurrentUser: async (): Promise<any> => {
    const response = await api.get('/auth/me')
    return response.data
  },
}

// ============================================
// DEVCIONAIS
// ============================================

export const devocionalApi = {
  list: async (skip = 0, limit = 50): Promise<Devocional[]> => {
    const response = await api.get<Devocional[]>('/devocionais', {
      params: { skip, limit },
    })
    return response.data
  },

  getById: async (id: number): Promise<Devocional> => {
    const response = await api.get<Devocional>(`/devocionais/${id}`)
    return response.data
  },

  getToday: async (): Promise<Devocional | null> => {
    const response = await api.get<Devocional>('/devocional/today')
    return response.data
  },

  create: async (data: Partial<Devocional>): Promise<Devocional> => {
    const response = await api.post<Devocional>('/devocional/webhook', data)
    return response.data
  },

  update: async (id: number, data: Partial<Devocional>): Promise<Devocional> => {
    const response = await api.put<Devocional>(`/devocionais/${id}`, data)
    return response.data
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/devocionais/${id}`)
  },
}

// ============================================
// CONTATOS
// ============================================

export const contatoApi = {
  list: async (skip = 0, limit = 50, active?: boolean): Promise<Contato[]> => {
    const response = await api.get<Contato[]>('/contatos', {
      params: { skip, limit, active },
    })
    return response.data
  },

  getById: async (id: number): Promise<Contato> => {
    const response = await api.get<Contato>(`/contatos/${id}`)
    return response.data
  },

  create: async (data: Partial<Contato>): Promise<Contato> => {
    const response = await api.post<Contato>('/contatos', data)
    return response.data
  },

  update: async (id: number, data: Partial<Contato>): Promise<Contato> => {
    const response = await api.put<Contato>(`/contatos/${id}`, data)
    return response.data
  },

  toggle: async (id: number): Promise<Contato> => {
    const response = await api.patch<Contato>(`/contatos/${id}/toggle`)
    return response.data
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/contatos/${id}`)
  },
}

// ============================================
// ENVIOS
// ============================================

export const envioApi = {
  list: async (skip = 0, limit = 50): Promise<Envio[]> => {
    const response = await api.get<Envio[]>('/envios', {
      params: { skip, limit },
    })
    return response.data
  },

  send: async (data: {
    contacts?: Array<{ phone: string; name?: string }>
    message?: string
    devocional_id?: number
    delay?: number
  }): Promise<any> => {
    const response = await api.post('/send-devocional', data)
    return response.data
  },

  sendSingle: async (data: {
    phone: string
    message: string
    name?: string
  }): Promise<any> => {
    const response = await api.post('/send-single-devocional', data)
    return response.data
  },
}

// ============================================
// ESTATÍSTICAS
// ============================================

export const statsApi = {
  get: async (): Promise<Stats> => {
    const response = await api.get<Stats>('/stats')
    return response.data
  },
}

export default api
