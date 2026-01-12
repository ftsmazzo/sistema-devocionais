import { useEffect, useState } from 'react'
import { instancesApi } from '../../services/api'
import { 
  Server, 
  RefreshCw, 
  QrCode, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  Loader,
  Wifi,
  WifiOff,
  Phone,
  Clock,
  TrendingUp,
  Plus
} from 'lucide-react'
import './Instancias.css'

interface Instancia {
  name: string
  api_url: string
  display_name: string
  status: 'active' | 'inactive' | 'error' | 'blocked' | 'unknown'
  phone_number: string | null
  messages_sent_today: number
  messages_sent_this_hour: number
  max_messages_per_hour: number
  max_messages_per_day: number
  priority: number
  enabled: boolean
  last_check: string | null
  last_error: string | null
  error_count: number
}

export default function Instancias() {
  const [instances, setInstances] = useState<Instancia[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<{ instance: string; qr: string } | null>(null)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [checkingConnection, setCheckingConnection] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newInstance, setNewInstance] = useState({
    name: '',
    api_url: 'https://imobmiq-evolution-api.90qhxz.easypanel.host',
    api_key: '429683C4C977415CAAFCCE10F7D57E11',
    display_name: 'Devocional Diário',
    max_messages_per_hour: 20,
    max_messages_per_day: 200,
    priority: 1,
    enabled: true
  })

  useEffect(() => {
    loadInstances()
    const interval = setInterval(loadInstances, 30000) // Atualizar a cada 30s
    return () => clearInterval(interval)
  }, [])

  const loadInstances = async () => {
    try {
      setLoading(true)
      const data = await instancesApi.list()
      setInstances(data.instances || [])
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar instâncias')
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateQR = async (instanceName: string) => {
    try {
      setError(null)
      setSuccess(null)
      const data = await instancesApi.generateQR(instanceName)
      setQrCode({
        instance: instanceName,
        qr: data.qr_code || data.base64 || '',
      })
      setSuccess('QR Code gerado com sucesso! Escaneie com o WhatsApp.')
    } catch (err: any) {
      setError(err.message || 'Erro ao gerar QR code')
      setQrCode(null)
    }
  }

  const handleConnect = async (instanceName: string) => {
    try {
      setCheckingConnection(instanceName)
      setError(null)
      setSuccess(null)
      const data = await instancesApi.connect(instanceName)
      if (data.connected) {
        setSuccess(`✅ Instância ${instanceName} está conectada!`)
      } else {
        setError(`⚠️ Instância ${instanceName} não está conectada. Estado: ${data.state || 'desconhecido'}`)
      }
      await loadInstances()
    } catch (err: any) {
      setError(err.message || 'Erro ao verificar conexão')
    } finally {
      setCheckingConnection(null)
    }
  }

  const handleRefresh = async (instanceName: string) => {
    try {
      setRefreshing(instanceName)
      setError(null)
      setSuccess(null)
      await instancesApi.refresh(instanceName)
      setSuccess(`Status da instância ${instanceName} atualizado!`)
      await loadInstances()
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar status')
    } finally {
      setRefreshing(null)
    }
  }

  const handleCreateInstance = async () => {
    try {
      setCreating(true)
      setError(null)
      setSuccess(null)
      const data = await instancesApi.create(newInstance)
      setQrCode({
        instance: newInstance.name,
        qr: data.qr_code || data.base64 || '',
      })
      setSuccess('Instância criada! Escaneie o QR code para conectar.')
      setShowCreateModal(false)
      // Reset form
      setNewInstance({
        name: '',
        api_url: 'https://imobmiq-evolution-api.90qhxz.easypanel.host',
        api_key: '429683C4C977415CAAFCCE10F7D57E11',
        display_name: 'Devocional Diário',
        max_messages_per_hour: 20,
        max_messages_per_day: 200,
        priority: 1,
        enabled: true
      })
    } catch (err: any) {
      setError(err.message || 'Erro ao criar instância')
    } finally {
      setCreating(false)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle size={20} className="status-icon active" />
      case 'error':
        return <XCircle size={20} className="status-icon error" />
      case 'blocked':
        return <AlertCircle size={20} className="status-icon blocked" />
      default:
        return <AlertCircle size={20} className="status-icon inactive" />
    }
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      active: 'Conectada',
      inactive: 'Desconectada',
      error: 'Erro',
      blocked: 'Bloqueada',
      unknown: 'Desconhecida',
    }
    return labels[status] || status
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: '#10b981',
      inactive: '#f59e0b',
      error: '#ef4444',
      blocked: '#dc2626',
      unknown: '#6b7280',
    }
    return colors[status] || '#6b7280'
  }

  if (loading) {
    return (
      <div className="instancias-loading">
        <div className="spinner"></div>
        <p>Carregando instâncias...</p>
      </div>
    )
  }

  return (
    <div className="instancias-page-modern">
      <div className="instancias-header-modern">
        <div>
          <h1>Gerenciar Instâncias WhatsApp</h1>
          <p className="instancias-subtitle">Configure e monitore suas instâncias Evolution API</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            className="btn-refresh-modern" 
            onClick={() => setShowCreateModal(true)}
            style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
          >
            <Plus size={18} />
            <span>Nova Instância</span>
          </button>
          <button className="btn-refresh-modern" onClick={loadInstances} disabled={loading}>
            <RefreshCw size={18} className={loading ? 'spinning' : ''} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-modern alert-error-modern">
          <AlertCircle size={18} />
          <p>{error}</p>
        </div>
      )}

      {success && (
        <div className="alert-modern alert-success-modern">
          <CheckCircle size={18} />
          <p>{success}</p>
        </div>
      )}

      {qrCode && (
        <div className="qr-modal-modern" onClick={() => setQrCode(null)}>
          <div className="qr-modal-content-modern" onClick={(e) => e.stopPropagation()}>
            <div className="qr-modal-header">
              <h3>QR Code - {qrCode.instance}</h3>
              <button className="btn-close-modern" onClick={() => setQrCode(null)}>
                <XCircle size={20} />
              </button>
            </div>
            <p className="qr-instructions">
              Escaneie este QR code com o WhatsApp para conectar a instância
            </p>
            {qrCode.qr && (
              <div className="qr-image-container">
                <img
                  src={qrCode.qr.startsWith('data:') ? qrCode.qr : `data:image/png;base64,${qrCode.qr}`}
                  alt="QR Code"
                  className="qr-image-modern"
                />
              </div>
            )}
            <button className="btn-primary-modern" onClick={() => {
              setQrCode(null)
              loadInstances()
            }}>
              Fechar
            </button>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="qr-modal-modern" onClick={() => setShowCreateModal(false)}>
          <div className="qr-modal-content-modern" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
            <div className="qr-modal-header">
              <h3>Criar Nova Instância</h3>
              <button className="btn-close-modern" onClick={() => setShowCreateModal(false)}>
                <XCircle size={20} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Nome da Instância *</label>
                <input
                  type="text"
                  value={newInstance.name}
                  onChange={(e) => setNewInstance({ ...newInstance, name: e.target.value })}
                  placeholder="Ex: Devocional-1"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>URL da API *</label>
                <input
                  type="text"
                  value={newInstance.api_url}
                  onChange={(e) => setNewInstance({ ...newInstance, api_url: e.target.value })}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>API Key *</label>
                <input
                  type="text"
                  value={newInstance.api_key}
                  onChange={(e) => setNewInstance({ ...newInstance, api_key: e.target.value })}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Nome de Exibição *</label>
                <input
                  type="text"
                  value={newInstance.display_name}
                  onChange={(e) => setNewInstance({ ...newInstance, display_name: e.target.value })}
                  placeholder="Nome que aparece no WhatsApp"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Mensagens/Hora</label>
                  <input
                    type="number"
                    value={newInstance.max_messages_per_hour}
                    onChange={(e) => setNewInstance({ ...newInstance, max_messages_per_hour: parseInt(e.target.value) || 20 })}
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Mensagens/Dia</label>
                  <input
                    type="number"
                    value={newInstance.max_messages_per_day}
                    onChange={(e) => setNewInstance({ ...newInstance, max_messages_per_day: parseInt(e.target.value) || 200 })}
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                  />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button
                className="btn-primary-modern"
                onClick={handleCreateInstance}
                disabled={creating || !newInstance.name || !newInstance.api_url || !newInstance.api_key}
                style={{ flex: 1 }}
              >
                {creating ? (
                  <>
                    <Loader size={16} className="spinning" />
                    <span>Criando...</span>
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    <span>Criar e Gerar QR Code</span>
                  </>
                )}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setShowCreateModal(false)}
                style={{ padding: '0.75rem 1.5rem' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="instances-grid-modern">
        {instances.length === 0 ? (
          <div className="empty-state-modern">
            <Server size={64} />
            <p>Nenhuma instância configurada</p>
            <small>Crie uma nova instância para começar</small>
            <button 
              className="btn-refresh-modern" 
              onClick={() => setShowCreateModal(true)}
              style={{ marginTop: '1rem', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
            >
              <Plus size={18} />
              <span>Criar Primeira Instância</span>
            </button>
          </div>
        ) : (
          instances.map((instance) => (
            <div key={instance.name} className="instance-card-modern">
              <div className="instance-card-header-modern">
                <div className="instance-title-section">
                  <div className="instance-name-row">
                    <h3>{instance.name}</h3>
                    <span className={`status-badge-modern ${instance.status}`}>
                      {getStatusIcon(instance.status)}
                      {getStatusLabel(instance.status)}
                    </span>
                  </div>
                  <p className="instance-display-name">{instance.display_name}</p>
                </div>
                <div 
                  className="status-indicator-modern"
                  style={{ backgroundColor: getStatusColor(instance.status) }}
                >
                  {instance.status === 'active' ? <Wifi size={16} /> : <WifiOff size={16} />}
                </div>
              </div>

              <div className="instance-details-modern">
                {instance.phone_number ? (
                  <div className="detail-item-modern">
                    <Phone size={16} />
                    <span className="detail-value">{instance.phone_number}</span>
                  </div>
                ) : (
                  <div className="detail-item-modern detail-warning">
                    <AlertCircle size={16} />
                    <span>Número não identificado</span>
                  </div>
                )}

                <div className="instance-stats-modern">
                  <div className="instance-stat-modern">
                    <Clock size={16} />
                    <div>
                      <span className="stat-label-small">Hoje</span>
                      <span className="stat-value-small">
                        {instance.messages_sent_today} / {instance.max_messages_per_day}
                      </span>
                    </div>
                  </div>
                  <div className="instance-stat-modern">
                    <TrendingUp size={16} />
                    <div>
                      <span className="stat-label-small">Esta hora</span>
                      <span className="stat-value-small">
                        {instance.messages_sent_this_hour} / {instance.max_messages_per_hour}
                      </span>
                    </div>
                  </div>
                </div>

                {instance.last_error && (
                  <div className="detail-item-modern detail-error">
                    <AlertCircle size={16} />
                    <span className="error-text">{instance.last_error.substring(0, 100)}...</span>
                  </div>
                )}
              </div>

              <div className="instance-actions-modern">
                <button
                  className="btn-action-modern btn-primary"
                  onClick={() => handleRefresh(instance.name)}
                  disabled={refreshing === instance.name}
                >
                  {refreshing === instance.name ? (
                    <Loader size={16} className="spinning" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  <span>Atualizar</span>
                </button>
                {instance.status !== 'active' && (
                  <button
                    className="btn-action-modern btn-secondary"
                    onClick={() => handleGenerateQR(instance.name)}
                  >
                    <QrCode size={16} />
                    <span>Conectar</span>
                  </button>
                )}
                <button
                  className="btn-action-modern btn-success"
                  onClick={() => handleConnect(instance.name)}
                  disabled={checkingConnection === instance.name}
                >
                  {checkingConnection === instance.name ? (
                    <Loader size={16} className="spinning" />
                  ) : (
                    <CheckCircle size={16} />
                  )}
                  <span>Verificar</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
