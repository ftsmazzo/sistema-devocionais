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
  baseURL: import.meta.env.VITE_API_URL 
    ? `${import.meta.env.VITE_API_URL}/api`
    : '/api',
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
    const response = await api.get<Devocional[]>('/devocional/devocionais', {
      params: { skip, limit },
    })
    return response.data
  },

  getById: async (id: number): Promise<Devocional> => {
    const response = await api.get<Devocional>(`/devocional/devocionais/${id}`)
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
    const response = await api.put<Devocional>(`/devocional/devocionais/${id}`, data)
    return response.data
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/devocional/devocionais/${id}`)
  },
}

// ============================================
// CONTATOS
// ============================================

export const contatoApi = {
  list: async (skip = 0, limit = 50, active_only?: boolean): Promise<Contato[]> => {
    const response = await api.get<Contato[]>('/devocional/contatos', {
      params: { skip, limit, active_only: active_only !== undefined ? active_only : undefined },
    })
    return response.data
  },

  getById: async (id: number): Promise<Contato> => {
    const response = await api.get<Contato>(`/devocional/contatos/${id}`)
    return response.data
  },

  create: async (data: Partial<Contato>): Promise<Contato> => {
    const response = await api.post<Contato>('/devocional/contatos', data)
    return response.data
  },

  // Nota: Backend não tem endpoint de update, apenas create/delete/toggle
  // Para atualizar, é necessário deletar e criar novamente
  update: async (id: number, data: Partial<Contato>): Promise<Contato> => {
    // Não implementado - backend não suporta update direto
    throw new Error('Update não suportado. Use delete + create')
  },

  toggle: async (id: number): Promise<Contato> => {
    await api.put(`/devocional/contatos/${id}/toggle`)
    // Recarregar lista completa após toggle
    const list = await contatoApi.list(0, 1000, false)
    const updated = list.find(c => c.id === id)
    if (!updated) throw new Error('Contato não encontrado após toggle')
    return updated
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/devocional/contatos/${id}`)
  },
}

// ============================================
// ENVIOS
// ============================================

export const envioApi = {
  list: async (skip = 0, limit = 50): Promise<Envio[]> => {
    const response = await api.get<Envio[]>('/devocional/envios', {
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
    const response = await api.post('/devocional/send', data)
    return response.data
  },

  sendSingle: async (data: {
    phone: string
    message: string
    name?: string
  }): Promise<any> => {
    const response = await api.post('/devocional/send-single', data)
    return response.data
  },
}

// ============================================
// ESTATÍSTICAS
// ============================================

export const statsApi = {
  get: async (): Promise<Stats> => {
    const response = await api.get<Stats>('/devocional/stats')
    return response.data
  },
}

export default api
