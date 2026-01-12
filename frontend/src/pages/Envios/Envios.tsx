import { useEffect, useState } from 'react'
import { envioApi } from '../../services/api'
import type { Envio } from '../../types'
import { Send, CheckCircle, XCircle, Clock, Search, Filter } from 'lucide-react'
import './Envios.css'

export default function Envios() {
  const [envios, setEnvios] = useState<Envio[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  useEffect(() => {
    loadEnvios()
    
    // Atualizar em tempo real a cada 10 segundos (sem mostrar loading para não piscar)
    const interval = setInterval(() => {
      loadEnviosSilently()
    }, 10000)
    
    return () => clearInterval(interval)
  }, [])

  const loadEnvios = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true)
      const data = await envioApi.list(0, 200)
      setEnvios(data)
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar envios')
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  const loadEnviosSilently = async () => {
    // Atualização silenciosa sem mostrar loading (não pisca a tela)
    try {
      const data = await envioApi.list(0, 200)
      setEnvios(data)
      setError(null)
    } catch (err: any) {
      // Silencioso - não mostra erro em atualizações automáticas
      console.error('Erro ao atualizar envios:', err)
    }
  }

  const handleRefresh = () => {
    loadEnvios(true)
  }

  const filteredEnvios = envios.filter((envio) => {
    const matchesSearch =
      envio.recipient_phone.includes(searchTerm) ||
      envio.recipient_name?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === 'all' || envio.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'sent':
        return <CheckCircle size={16} className="status-icon sent" />
      case 'failed':
        return <XCircle size={16} className="status-icon failed" />
      case 'pending':
        return <Clock size={16} className="status-icon pending" />
      default:
        return <Clock size={16} className="status-icon" />
    }
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      sent: 'Enviado',
      failed: 'Falhou',
      pending: 'Pendente',
      retrying: 'Tentando novamente',
      blocked: 'Bloqueado',
    }
    return labels[status] || status
  }

  const getMessageStatusLabel = (messageStatus?: string) => {
    if (!messageStatus) return 'Pendente'
    const labels: Record<string, string> = {
      sent: 'Enviado',
      delivered: 'Entregue',
      read: 'Lida',
      failed: 'Falhou',
      pending: 'Pendente',
    }
    return labels[messageStatus] || messageStatus
  }

  const getMessageStatusColor = (messageStatus?: string) => {
    if (!messageStatus) return 'pending'
    return messageStatus
  }

  const stats = {
    total: envios.length,
    sent: envios.filter((e) => e.status === 'sent').length,
    failed: envios.filter((e) => e.status === 'failed').length,
    pending: envios.filter((e) => e.status === 'pending').length,
  }

  if (loading) {
    return (
      <div className="envios-loading">
        <div className="spinner"></div>
        <p>Carregando histórico de envios...</p>
      </div>
    )
  }

  return (
    <div className="envios-page">
      <div className="envios-header">
        <div className="header-stats">
          <div className="stat-card">
            <Send size={20} />
            <div>
              <span className="stat-value">{stats.total}</span>
              <span className="stat-label">Total</span>
            </div>
          </div>
          <div className="stat-card success">
            <CheckCircle size={20} />
            <div>
              <span className="stat-value">{stats.sent}</span>
              <span className="stat-label">Enviados</span>
            </div>
          </div>
          <div className="stat-card error">
            <XCircle size={20} />
            <div>
              <span className="stat-value">{stats.failed}</span>
              <span className="stat-label">Falhas</span>
            </div>
          </div>
          <div className="stat-card pending">
            <Clock size={20} />
            <div>
              <span className="stat-value">{stats.pending}</span>
              <span className="stat-label">Pendentes</span>
            </div>
          </div>
        </div>
        <div className="header-filters">
          <div className="search-box">
            <Search size={18} />
            <input
              type="text"
              placeholder="Buscar por telefone ou nome..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filter-box">
            <Filter size={18} />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Todos os status</option>
              <option value="sent">Enviados</option>
              <option value="failed">Falhas</option>
              <option value="pending">Pendentes</option>
              <option value="retrying">Tentando novamente</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={handleRefresh}>Tentar novamente</button>
        </div>
      )}

      <div className="envios-table-container">
        <table className="envios-table">
          <thead>
            <tr>
              <th>Data/Hora</th>
              <th>Destinatário</th>
              <th>Telefone</th>
              <th>Status</th>
              <th>Instância</th>
              <th>Erro</th>
            </tr>
          </thead>
          <tbody>
            {filteredEnvios.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  {searchTerm || statusFilter !== 'all'
                    ? 'Nenhum envio encontrado'
                    : 'Nenhum envio registrado'}
                </td>
              </tr>
            ) : (
              filteredEnvios.map((envio) => (
                <tr key={envio.id}>
                  <td className="date-cell">
                    {envio.sent_at
                      ? new Date(envio.sent_at).toLocaleString('pt-BR')
                      : envio.created_at
                      ? new Date(envio.created_at).toLocaleString('pt-BR')
                      : '-'}
                  </td>
                  <td>{envio.recipient_name || '-'}</td>
                  <td className="phone-cell">{envio.recipient_phone}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {envio.message_status === 'read' && envio.read_at ? (
                        <span className="message-status-badge read">
                          Lida - {new Date(envio.read_at).toLocaleString('pt-BR')}
                        </span>
                      ) : envio.message_status === 'delivered' && envio.delivered_at ? (
                        <span className="message-status-badge delivered">
                          Entregue - {new Date(envio.delivered_at).toLocaleString('pt-BR')}
                        </span>
                      ) : envio.sent_at ? (
                        <span className="message-status-badge sent">
                          Enviada - {new Date(envio.sent_at).toLocaleString('pt-BR')}
                        </span>
                      ) : (
                        <span className={`status-badge ${envio.status}`}>
                          {getStatusIcon(envio.status)}
                          {getStatusLabel(envio.status)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="instance-cell">{envio.instance_name || '-'}</td>
                  <td className="error-cell">
                    {envio.error ? (
                      <span className="error-text" title={envio.error}>
                        {envio.error.substring(0, 50)}...
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

