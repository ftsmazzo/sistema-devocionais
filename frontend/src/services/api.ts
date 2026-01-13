import axios, { AxiosError } from 'axios'
import type {
  Devocional,
  Contato,
  Envio,
  Stats,
  Instancia,
  LoginRequest,
  LoginResponse,
  DashboardStats,
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

  importCsv: async (file: File): Promise<{ imported: number; skipped: number; errors: string[] }> => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await api.post<{ imported: number; skipped: number; errors: string[] }>(
      '/devocional/contatos/import-csv',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    )
    return response.data
  },
}

// ============================================
// ENVIOS
// ============================================

export const envioApi = {
  list: async (skip = 0, limit = 50, status?: string): Promise<Envio[]> => {
    const params: any = { skip, limit }
    if (status) params.status = status
    const response = await api.get<Envio[]>('/devocional/envios', { params })
    // Adaptar formato do backend para o frontend
    return response.data.map((e: any) => ({
      id: e.id,
      devocional_id: e.devocional_id || null,
      recipient_phone: e.recipient_phone,
      recipient_name: e.recipient_name || null,
      message: e.message || '',
      status: e.status,
      message_status: e.message_status || 'sent',  // sent, delivered, read
      instance_name: e.instance_name || null,
      error: e.error_message || e.error || null,
      retry_count: e.retry_count || 0,
      sent_at: e.sent_at || null,
      delivered_at: e.delivered_at || null,
      read_at: e.read_at || null,
      created_at: e.created_at || e.sent_at || new Date().toISOString(),
    }))
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

// ============================================
// CONFIGURAÇÕES
// ============================================

export const configApi = {
  get: async () => {
    const response = await api.get('/config/')
    return response.data
  },
  updateShield: async (data: any) => {
    const response = await api.put('/config/shield', data)
    return response.data
  },
  updateRateLimit: async (data: any) => {
    const response = await api.put('/config/rate-limit', data)
    return response.data
  },
  updateSchedule: async (data: { send_time: string }) => {
    const response = await api.put('/config/schedule', data)
    return response.data
  },
}

// ============================================
// INSTÂNCIAS
// ============================================

export const instancesApi = {
  list: async (sync: boolean = true) => {
    // Nova API sempre sincroniza por padrão
    const response = await api.get('/instances/', {
      params: { sync }
    })
    return { instances: response.data }  // Nova API retorna lista direta
  },
  create: async (instanceData: {
    name: string
    display_name: string
    max_messages_per_hour?: number
    max_messages_per_day?: number
    priority?: number
  }) => {
    // Nova API não precisa de api_url e api_key (vem do .env)
    const response = await api.post('/instances/create', instanceData)
    return response.data
  },
  generateQR: async (instanceName: string) => {
    const response = await api.post(`/instances/${instanceName}/qr`)
    return response.data
  },
  connect: async (instanceName: string) => {
    const response = await api.post(`/instances/${instanceName}/connect`)
    return response.data
  },
  refresh: async (instanceName: string) => {
    const response = await api.post(`/instances/${instanceName}/refresh`)
    return response.data
  },
}

// ============================================
// ESTATÍSTICAS
// ============================================

// ============================================
// DASHBOARD STATS
// ============================================

export const dashboardApi = {
  getStats: async (): Promise<DashboardStats> => {
    const response = await api.get<DashboardStats>('/dashboard/stats')
    return response.data
  },
}

// ============================================
// ESTATÍSTICAS (Legado - manter compatibilidade)
// ============================================

export const statsApi = {
  get: async (): Promise<Stats> => {
    const defaultStats: Stats = {
      total_sent: 0,
      total_failed: 0,
      total_blocked: 0,
      total_retries: 0,
      instances: [],
      distribution_strategy: 'round_robin'
    }

    try {
      // Tentar primeiro o endpoint de notificações que tem formato mais completo
      const response = await api.get<any>('/notifications/instances')
      const data: any = response.data
      
      // Verificar se já está no formato correto
      if (data && 'total_sent' in data && 'instances' in data) {
        // Garantir que instances seja um array
        let instances = data.instances
        if (!Array.isArray(instances)) {
          // Se instances é um objeto com 'instances' dentro, extrair
          if (instances && typeof instances === 'object' && 'instances' in instances) {
            instances = instances.instances
          } else {
            instances = []
          }
        }
        
        return {
          total_sent: (data.total_sent ?? 0) as number,
          total_failed: (data.total_failed ?? 0) as number,
          total_blocked: (data.total_blocked ?? 0) as number,
          total_retries: (data.total_retries ?? 0) as number,
          instances: (instances ?? []) as Instancia[],
          distribution_strategy: (data.distribution_strategy ?? 'round_robin') as string,
          shield: data.shield
        }
      }
      
      // Se retornou objeto com 'instances' dentro
      if (data && data.instances) {
        // Garantir que instances seja um array
        let instances = data.instances
        if (!Array.isArray(instances)) {
          // Se instances é um objeto com 'instances' dentro, extrair
          if (instances && typeof instances === 'object' && 'instances' in instances) {
            instances = instances.instances
          } else {
            instances = []
          }
        }
        
        return {
          total_sent: (data.total_sent ?? 0) as number,
          total_failed: (data.total_failed ?? 0) as number,
          total_blocked: (data.total_blocked ?? 0) as number,
          total_retries: (data.total_retries ?? 0) as number,
          instances: instances as Instancia[],
          distribution_strategy: (data.distribution_strategy ?? 'round_robin') as string,
          shield: data.shield
        }
      }
    } catch (err) {
      console.warn('Erro ao buscar stats de /notifications/instances:', err)
    }
    
    // Fallback para endpoint antigo
    try {
      const response = await api.get<any>('/devocional/stats')
      const data: any = response.data
      
      // Se já está no formato correto, retornar direto
      if (data && 'total_sent' in data && 'instances' in data) {
        return {
          total_sent: (data.total_sent ?? 0) as number,
          total_failed: (data.total_failed ?? 0) as number,
          total_blocked: (data.total_blocked ?? 0) as number,
          total_retries: (data.total_retries ?? 0) as number,
          instances: (data.instances ?? []) as Instancia[],
          distribution_strategy: (data.distribution_strategy ?? 'round_robin') as string,
          shield: data.shield
        }
      }
      
      // Se está no formato antigo {stats: {...}, instance_status: {...}}
      if (data && data.stats) {
        const stats: any = data.stats
        return {
          total_sent: (stats.total_sent ?? 0) as number,
          total_failed: (stats.total_failed ?? 0) as number,
          total_blocked: (stats.total_blocked ?? 0) as number,
          total_retries: (stats.total_retries ?? 0) as number,
          instances: (stats.instances ?? []) as any[],
          distribution_strategy: (stats.distribution_strategy ?? 'round_robin') as string,
          shield: stats.shield
        }
      }
    } catch (err2) {
      console.warn('Erro ao buscar stats de /devocional/stats:', err2)
    }
    
    // Se ambos falharem, retornar estrutura vazia
    return defaultStats
  },
}

export default api
