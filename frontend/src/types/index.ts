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
  engagement_score: number | null  // Score de engajamento (0.0 a 1.0)
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
  message_status: 'sent' | 'delivered' | 'read' | 'failed' | 'pending'  // Status detalhado da mensagem
  instance_name: string | null
  error: string | null
  retry_count: number
  sent_at: string | null
  delivered_at: string | null  // Quando foi entregue
  read_at: string | null  // Quando foi lida
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

export interface DashboardStats {
  messages: {
    total: number
    sent: number
    delivered: number
    read: number
    failed: number
    blocked: number
    retries: number
    delivery_rate: number
    read_rate: number
    success_rate: number
    today: number
    week: number
    month: number
    last_sent_at: string | null
    by_status: Record<string, number>
    by_message_status: Record<string, number>
  }
  contacts: {
    total: number
    active: number
    inactive: number
    with_messages: number
    today: number
    week: number
    month: number
  }
  consents: {
    total: number
    accepted: number
    denied: number
    pending: number
    awaiting_response: number
    acceptance_rate: number
  }
  devocionais: {
    total: number
    sent: number
    pending: number
    today: number
    week: number
    month: number
    last_created_at: string | null
  }
  webhooks: {
    total: number
    processed: number
    pending: number
    processing_rate: number
    today: number
    week: number
    month: number
    by_type: Record<string, number>
    last_received_at: string | null
  }
  engagement: {
    total_records: number
    avg_score: number
    total_responses: number
    total_read: number
    total_delivered: number
    low_engagement_count: number
    high_engagement_count: number
  }
  instances: {
    total: number
    active: number
    inactive: number
    error: number
    messages_today: number
    messages_this_hour: number
  }
  periods: {
    today: {
      messages: number
      contacts: number
      devocionais: number
      webhooks: number
    }
    week: {
      messages: number
      contacts: number
      devocionais: number
      webhooks: number
    }
    month: {
      messages: number
      contacts: number
      devocionais: number
      webhooks: number
    }
  }
}
