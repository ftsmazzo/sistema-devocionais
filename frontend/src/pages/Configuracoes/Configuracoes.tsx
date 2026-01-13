import { useEffect, useState } from 'react'
import { configApi } from '../../services/api'
import { 
  Send, RefreshCw, Shield, Clock, Zap, AlertCircle, 
  Info, CheckCircle, Save, TrendingUp, Activity, 
  Timer, Repeat, Target
} from 'lucide-react'
import './Configuracoes.css'

interface ConfigData {
  shield: {
    enabled: boolean
    delay_variation: number
    break_interval: number
    break_duration_min: number
    break_duration_max: number
    min_engagement_score: number
    adaptive_limits_enabled: boolean
    block_detection_enabled: boolean
  }
  rate_limit: {
    delay_between_messages: number
    max_messages_per_hour: number
    max_messages_per_day: number
    max_retries: number
    retry_delay: number
  }
  schedule: {
    send_time: string
  }
}

interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

export default function Configuracoes() {
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      setLoading(true)
      const data = await configApi.get()
      setConfig(data)
    } catch (err: any) {
      showToast('Erro ao carregar configurações', 'error')
    } finally {
      setLoading(false)
    }
  }

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4000)
  }

  const handleSave = async (section: 'shield' | 'rate_limit' | 'schedule', data: any) => {
    if (!config) return

    setSaving((prev) => ({ ...prev, [section]: true }))
    try {
      if (section === 'shield') {
        await configApi.updateShield(data)
      } else if (section === 'rate_limit') {
        await configApi.updateRateLimit(data)
      } else if (section === 'schedule') {
        await configApi.updateSchedule(data)
      }
      showToast('Configuração salva com sucesso!', 'success')
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Erro ao salvar configuração', 'error')
    } finally {
      setSaving((prev) => ({ ...prev, [section]: false }))
    }
  }

  const updateConfig = (section: keyof ConfigData, field: string, value: any) => {
    if (!config) return
    setConfig({
      ...config,
      [section]: {
        ...config[section],
        [field]: value,
      },
    })
  }

  if (loading) {
    return (
      <div className="disparador-loading">
        <div className="spinner"></div>
        <p>Carregando configurações...</p>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="disparador-error">
        <AlertCircle size={24} />
        <p>Erro ao carregar configurações</p>
        <button onClick={loadConfig} className="btn-primary">
          <RefreshCw size={18} />
          Tentar novamente
        </button>
      </div>
    )
  }

  return (
    <div className="disparador-page">
      {/* Header */}
      <div className="disparador-header">
        <div className="header-title">
          <Send size={28} />
          <div>
            <h1>Disparador</h1>
            <p>Configure como suas mensagens serão enviadas</p>
          </div>
        </div>
        <button className="btn-refresh" onClick={loadConfig}>
          <RefreshCw size={18} />
          <span>Atualizar</span>
        </button>
      </div>

      {/* Toasts */}
      <div className="toasts-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            {toast.type === 'success' && <CheckCircle size={18} />}
            {toast.type === 'error' && <AlertCircle size={18} />}
            {toast.type === 'info' && <Info size={18} />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Config Cards */}
      <div className="disparador-grid">
        {/* Blindagem Anti-Bloqueio */}
        <div className="config-card shield-card">
          <div className="card-header">
            <div className="card-icon shield-icon">
              <Shield size={24} />
            </div>
            <div className="card-title">
              <h3>Blindagem Anti-Bloqueio</h3>
              <p>Proteja sua conta de bloqueios</p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={config.shield.enabled}
                onChange={(e) => {
                  updateConfig('shield', 'enabled', e.target.checked)
                  handleSave('shield', { ...config.shield, enabled: e.target.checked })
                }}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="card-content">
            <div className="config-item">
              <div className="config-label">
                <span>Variação de Delay</span>
                <span title="Varia o tempo entre mensagens para parecer mais natural">
                  <Info size={14} className="info-icon" />
                </span>
              </div>
              <div className="slider-container">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={config.shield.delay_variation}
                  onChange={(e) => updateConfig('shield', 'delay_variation', parseFloat(e.target.value))}
                  onMouseUp={() => handleSave('shield', config.shield)}
                />
                <span className="slider-value">{Math.round(config.shield.delay_variation * 100)}%</span>
              </div>
            </div>

            <div className="config-item">
              <div className="config-label">
                <span>Pausa a cada</span>
                <span title="Quantas mensagens enviar antes de fazer uma pausa">
                  <Info size={14} className="info-icon" />
                </span>
              </div>
              <div className="input-group">
                <input
                  type="number"
                  min="1"
                  value={config.shield.break_interval}
                  onChange={(e) => updateConfig('shield', 'break_interval', parseInt(e.target.value))}
                  onBlur={() => handleSave('shield', config.shield)}
                />
                <span className="input-suffix">mensagens</span>
              </div>
            </div>

            <div className="config-row">
              <div className="config-item">
                <div className="config-label">
                  <span>Pausa Mínima</span>
                  <span title="Tempo mínimo de pausa em segundos">
                    <Info size={14} className="info-icon" />
                  </span>
                </div>
                <div className="input-group">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={config.shield.break_duration_min}
                    onChange={(e) => updateConfig('shield', 'break_duration_min', parseFloat(e.target.value))}
                    onBlur={() => handleSave('shield', config.shield)}
                  />
                  <span className="input-suffix">seg</span>
                </div>
              </div>

              <div className="config-item">
                <div className="config-label">
                  <span>Pausa Máxima</span>
                  <span title="Tempo máximo de pausa em segundos">
                    <Info size={14} className="info-icon" />
                  </span>
                </div>
                <div className="input-group">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={config.shield.break_duration_max}
                    onChange={(e) => updateConfig('shield', 'break_duration_max', parseFloat(e.target.value))}
                    onBlur={() => handleSave('shield', config.shield)}
                  />
                  <span className="input-suffix">seg</span>
                </div>
              </div>
            </div>

            <div className="config-item">
              <div className="config-label">
                <span>Score Mínimo de Engajamento</span>
                <span title="Apenas contatos com este score mínimo receberão mensagens">
                  <Info size={14} className="info-icon" />
                </span>
              </div>
              <div className="slider-container">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={config.shield.min_engagement_score}
                  onChange={(e) => updateConfig('shield', 'min_engagement_score', parseFloat(e.target.value))}
                  onMouseUp={() => handleSave('shield', config.shield)}
                />
                <span className="slider-value">{Math.round(config.shield.min_engagement_score * 100)}%</span>
              </div>
            </div>

            <div className="config-checkboxes">
              <label className="checkbox-item">
                <input
                  type="checkbox"
                  checked={config.shield.adaptive_limits_enabled}
                  onChange={(e) => {
                    updateConfig('shield', 'adaptive_limits_enabled', e.target.checked)
                    handleSave('shield', { ...config.shield, adaptive_limits_enabled: e.target.checked })
                  }}
                />
                <span>Limites Adaptativos</span>
                <span title="Ajusta automaticamente os limites baseado no comportamento">
                  <Info size={14} className="info-icon" />
                </span>
              </label>

              <label className="checkbox-item">
                <input
                  type="checkbox"
                  checked={config.shield.block_detection_enabled}
                  onChange={(e) => {
                    updateConfig('shield', 'block_detection_enabled', e.target.checked)
                    handleSave('shield', { ...config.shield, block_detection_enabled: e.target.checked })
                  }}
                />
                <span>Detecção de Bloqueios</span>
                <span title="Detecta quando você foi bloqueado e pausa os envios">
                  <Info size={14} className="info-icon" />
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Rate Limiting */}
        <div className="config-card rate-card">
          <div className="card-header">
            <div className="card-icon rate-icon">
              <Zap size={24} />
            </div>
            <div className="card-title">
              <h3>Velocidade de Envio</h3>
              <p>Controle a frequência das mensagens</p>
            </div>
          </div>

          <div className="card-content">
            <div className="config-item">
              <div className="config-label">
                <span>Delay entre Mensagens</span>
                <span title="Tempo de espera entre cada mensagem enviada">
                  <Info size={14} className="info-icon" />
                </span>
              </div>
              <div className="input-group">
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={config.rate_limit.delay_between_messages}
                  onChange={(e) => updateConfig('rate_limit', 'delay_between_messages', parseFloat(e.target.value))}
                  onBlur={() => handleSave('rate_limit', config.rate_limit)}
                />
                <span className="input-suffix">segundos</span>
              </div>
            </div>

            <div className="config-row">
              <div className="config-item">
                <div className="config-label">
                  <span>Máx. por Hora</span>
                  <span title="Número máximo de mensagens que podem ser enviadas em uma hora">
                    <Info size={14} className="info-icon" />
                  </span>
                </div>
                <div className="input-group">
                  <input
                    type="number"
                    min="1"
                    value={config.rate_limit.max_messages_per_hour}
                    onChange={(e) => updateConfig('rate_limit', 'max_messages_per_hour', parseInt(e.target.value))}
                    onBlur={() => handleSave('rate_limit', config.rate_limit)}
                  />
                  <span className="input-suffix">msg/h</span>
                </div>
              </div>

              <div className="config-item">
                <div className="config-label">
                  <span>Máx. por Dia</span>
                  <span title="Número máximo de mensagens que podem ser enviadas em um dia">
                    <Info size={14} className="info-icon" />
                  </span>
                </div>
                <div className="input-group">
                  <input
                    type="number"
                    min="1"
                    value={config.rate_limit.max_messages_per_day}
                    onChange={(e) => updateConfig('rate_limit', 'max_messages_per_day', parseInt(e.target.value))}
                    onBlur={() => handleSave('rate_limit', config.rate_limit)}
                  />
                  <span className="input-suffix">msg/dia</span>
                </div>
              </div>
            </div>

            <div className="config-row">
              <div className="config-item">
                <div className="config-label">
                  <span>Máx. Tentativas</span>
                  <span title="Quantas vezes tentar reenviar uma mensagem que falhou">
                    <Info size={14} className="info-icon" />
                  </span>
                </div>
                <div className="input-group">
                  <input
                    type="number"
                    min="0"
                    value={config.rate_limit.max_retries}
                    onChange={(e) => updateConfig('rate_limit', 'max_retries', parseInt(e.target.value))}
                    onBlur={() => handleSave('rate_limit', config.rate_limit)}
                  />
                  <span className="input-suffix">tentativas</span>
                </div>
              </div>

              <div className="config-item">
                <div className="config-label">
                  <span>Delay entre Tentativas</span>
                  <span title="Tempo de espera antes de tentar reenviar">
                    <Info size={14} className="info-icon" />
                  </span>
                </div>
                <div className="input-group">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={config.rate_limit.retry_delay}
                    onChange={(e) => updateConfig('rate_limit', 'retry_delay', parseFloat(e.target.value))}
                    onBlur={() => handleSave('rate_limit', config.rate_limit)}
                  />
                  <span className="input-suffix">segundos</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Agendamento */}
        <div className="config-card schedule-card">
          <div className="card-header">
            <div className="card-icon schedule-icon">
              <Clock size={24} />
            </div>
            <div className="card-title">
              <h3>Agendamento Automático</h3>
              <p>Configure o horário de envio diário</p>
            </div>
          </div>

          <div className="card-content">
            <div className="config-item large">
              <div className="config-label">
                <span>Horário de Envio</span>
                <span title="O devocional será enviado automaticamente neste horário todos os dias">
                  <Info size={14} className="info-icon" />
                </span>
              </div>
              <div className="time-input-container">
                <Clock size={20} />
                <input
                  type="time"
                  value={config.schedule.send_time}
                  onChange={(e) => updateConfig('schedule', 'send_time', e.target.value)}
                  onBlur={() => handleSave('schedule', config.schedule)}
                />
              </div>
              <p className="config-hint">O sistema enviará automaticamente todos os dias neste horário</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
