// Tipos TypeScript para o sistema

export interface User {
  id: string
  email: string
  name: string
}

export interface Devocional {
  id: number
  title: string | null
  content: string
  date: string
  source: string
  versiculo_principal_texto: string | null
  versiculo_principal_referencia: string | null
  versiculo_apoio_texto: string | null
  versiculo_apoio_referencia: string | null
  autor: string | null
  tema: string | null
  palavras_chave: string[] | null
  created_at: string
  updated_at: string
}

export interface Contato {
  id: number
  phone: string
  name: string
  active: boolean
  total_sent: number
  last_sent: string | null
  instance_name: string | null
  created_at: string
  updated_at: string
}

export interface Envio {
  id: number
  devocional_id: number | null
  recipient_phone: string
  recipient_name: string | null
  message: string
  status: 'sent' | 'failed' | 'pending' | 'retrying' | 'blocked'
  instance_name: string | null
  error: string | null
  retry_count: number
  sent_at: string | null
  created_at: string
}

export interface Instancia {
  name: string
  status: 'active' | 'inactive' | 'error' | 'blocked'
  api_url: string
  display_name: string
  phone_number: string | null
  messages_sent_today: number
  messages_sent_this_hour: number
  max_messages_per_hour: number
  max_messages_per_day: number
  last_check: string | null
  last_error: string | null
  enabled: boolean
}

export interface Stats {
  total_sent: number
  total_failed: number
  total_blocked: number
  total_retries: number
  instances: Instancia[]
  distribution_strategy: string
  total_instances?: number
  active_instances?: number
  inactive_instances?: number
  error_instances?: number
  shield?: {
    status: string
    total_messages_sent: number
    consecutive_errors: number
    success_rate: number
    current_hourly_limit: number
    current_daily_limit: number
    messages_since_break: number
    last_break_time: string | null
    engagement_tracked: number
    breaks_taken?: number
    blocks_detected?: number
  }
}

export interface LoginRequest {
  email: string
  password: string
  remember?: boolean
}

export interface LoginResponse {
  token: string
  user: User
}

