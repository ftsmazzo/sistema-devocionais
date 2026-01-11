import { useEffect, useState } from 'react'
import { statsApi } from '../../services/api'
import type { Stats } from '../../types'
import { Users, Send, CheckCircle, XCircle, Activity } from 'lucide-react'
import './Dashboard.css'

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 30000) // Atualizar a cada 30s
    return () => clearInterval(interval)
  }, [])

  const loadStats = async () => {
    try {
      setLoading(true)
      const data = await statsApi.get()
      setStats(data)
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar estatísticas')
    } finally {
      setLoading(false)
    }
  }

  if (loading && !stats) {
    return (
      <div className="dashboard-loading">
        <div className="spinner"></div>
        <p>Carregando estatísticas...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="dashboard-error">
        <p>{error}</p>
        <button onClick={loadStats}>Tentar novamente</button>
      </div>
    )
  }

  const successRate =
    stats && stats.total_sent + stats.total_failed > 0
      ? ((stats.total_sent / (stats.total_sent + stats.total_failed)) * 100).toFixed(1)
      : '0'

  const activeInstances = stats?.instances.filter((i) => i.status === 'active').length || 0
  const totalInstances = stats?.instances.length || 0

  return (
    <div className="dashboard">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#3b82f6' }}>
            <Send size={24} />
          </div>
          <div className="stat-content">
            <h3>Mensagens Enviadas</h3>
            <p className="stat-value">{stats?.total_sent || 0}</p>
            <p className="stat-label">Total de envios</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#10b981' }}>
            <CheckCircle size={24} />
          </div>
          <div className="stat-content">
            <h3>Taxa de Sucesso</h3>
            <p className="stat-value">{successRate}%</p>
            <p className="stat-label">
              {stats?.total_sent || 0} de{' '}
              {(stats?.total_sent || 0) + (stats?.total_failed || 0)} envios
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#f59e0b' }}>
            <Users size={24} />
          </div>
          <div className="stat-content">
            <h3>Instâncias Ativas</h3>
            <p className="stat-value">
              {activeInstances}/{totalInstances}
            </p>
            <p className="stat-label">Evolution API</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#ef4444' }}>
            <XCircle size={24} />
          </div>
          <div className="stat-content">
            <h3>Falhas</h3>
            <p className="stat-value">{stats?.total_failed || 0}</p>
            <p className="stat-label">Tentativas: {stats?.total_retries || 0}</p>
          </div>
        </div>
      </div>

      {stats?.shield && (
        <div className="shield-section">
          <h2>🛡️ Sistema de Blindagem</h2>
          <div className="shield-grid">
            <div className="shield-item">
              <span className="shield-label">Status:</span>
              <span
                className={`shield-value ${
                  stats.shield.status === 'active' ? 'active' : 'warning'
                }`}
              >
                {stats.shield.status === 'active' ? 'Ativo' : 'Atenção'}
              </span>
            </div>
            <div className="shield-item">
              <span className="shield-label">Taxa de Sucesso:</span>
              <span className="shield-value">
                {(stats.shield.success_rate * 100).toFixed(1)}%
              </span>
            </div>
            <div className="shield-item">
              <span className="shield-label">Limite Atual (Hora/Dia):</span>
              <span className="shield-value">
                {stats.shield.current_hourly_limit}/{stats.shield.current_daily_limit}
              </span>
            </div>
            <div className="shield-item">
              <span className="shield-label">Mensagens desde pausa:</span>
              <span className="shield-value">{stats.shield.messages_since_break}</span>
            </div>
          </div>
        </div>
      )}

      <div className="instances-section">
        <h2>Instâncias Evolution API</h2>
        <div className="instances-list">
          {stats?.instances.map((instance) => (
            <div key={instance.name} className="instance-card">
              <div className="instance-header">
                <h3>{instance.name}</h3>
                <span
                  className={`instance-status ${instance.status} ${
                    instance.enabled ? '' : 'disabled'
                  }`}
                >
                  {instance.status === 'active' && instance.enabled
                    ? 'Ativa'
                    : instance.enabled
                    ? 'Inativa'
                    : 'Desabilitada'}
                </span>
              </div>
              <div className="instance-stats">
                <div className="instance-stat">
                  <span className="stat-label">Hoje:</span>
                  <span className="stat-value">
                    {instance.messages_sent_today}/{instance.max_messages_per_day}
                  </span>
                </div>
                <div className="instance-stat">
                  <span className="stat-label">Esta hora:</span>
                  <span className="stat-value">
                    {instance.messages_sent_this_hour}/{instance.max_messages_per_hour}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

