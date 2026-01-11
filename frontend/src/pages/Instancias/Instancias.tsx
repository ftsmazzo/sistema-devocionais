import { useEffect, useState } from 'react'
import { instancesApi } from '../../services/api'
import { Server, RefreshCw, QrCode, CheckCircle, XCircle, AlertCircle, Loader } from 'lucide-react'
import './Instancias.css'

interface Instancia {
  name: string
  api_url: string
  display_name: string
  status: 'active' | 'inactive' | 'error' | 'blocked'
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

  useEffect(() => {
    loadInstances()
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
      const data = await instancesApi.generateQR(instanceName)
      setQrCode({
        instance: instanceName,
        qr: data.qr_code || data.base64 || '',
      })
    } catch (err: any) {
      setError(err.message || 'Erro ao gerar QR code')
    }
  }

  const handleConnect = async (instanceName: string) => {
    try {
      setError(null)
      const data = await instancesApi.connect(instanceName)
      if (data.connected) {
        setSuccess(`Instância ${instanceName} conectada com sucesso!`)
      } else {
        setError(`Instância ${instanceName} não está conectada. Estado: ${data.state}`)
      }
      await loadInstances()
    } catch (err: any) {
      setError(err.message || 'Erro ao verificar conexão')
    }
  }

  const handleRefresh = async (instanceName: string) => {
    try {
      setRefreshing(instanceName)
      setError(null)
      await instancesApi.refresh(instanceName)
      await loadInstances()
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar status')
    } finally {
      setRefreshing(null)
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
      active: 'Ativa',
      inactive: 'Inativa',
      error: 'Erro',
      blocked: 'Bloqueada',
    }
    return labels[status] || status
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
    <div className="instancias-page">
      <div className="instancias-header">
        <Server size={24} />
        <h2>Gerenciar Instâncias WhatsApp</h2>
        <button className="btn-refresh" onClick={loadInstances}>
          <RefreshCw size={18} />
          <span>Atualizar</span>
        </button>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertCircle size={18} />
          <p>{error}</p>
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          <CheckCircle size={18} />
          <p>{success}</p>
        </div>
      )}

      {qrCode && (
        <div className="qr-modal">
          <div className="qr-modal-content">
            <h3>QR Code - {qrCode.instance}</h3>
            <p>Escaneie este QR code com o WhatsApp para conectar a instância</p>
            {qrCode.qr && (
              <img
                src={qrCode.qr.startsWith('data:') ? qrCode.qr : `data:image/png;base64,${qrCode.qr}`}
                alt="QR Code"
                className="qr-image"
              />
            )}
            <button className="btn-close" onClick={() => setQrCode(null)}>
              Fechar
            </button>
          </div>
        </div>
      )}

      <div className="instances-grid">
        {instances.length === 0 ? (
          <div className="empty-state">
            <Server size={48} />
            <p>Nenhuma instância configurada</p>
            <small>Configure instâncias no arquivo .env</small>
          </div>
        ) : (
          instances.map((instance) => (
            <div key={instance.name} className="instance-card">
              <div className="instance-header">
                <div className="instance-title">
                  <h3>{instance.name}</h3>
                  <span className="display-name">{instance.display_name}</span>
                </div>
                <div className={`status-badge ${instance.status}`}>
                  {getStatusIcon(instance.status)}
                  {getStatusLabel(instance.status)}
                </div>
              </div>

              <div className="instance-details">
                <div className="detail-row">
                  <span className="label">URL:</span>
                  <span className="value">{instance.api_url}</span>
                </div>
                {instance.phone_number && (
                  <div className="detail-row">
                    <span className="label">Telefone:</span>
                    <span className="value">{instance.phone_number}</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="label">Mensagens hoje:</span>
                  <span className="value">
                    {instance.messages_sent_today} / {instance.max_messages_per_day}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="label">Mensagens esta hora:</span>
                  <span className="value">
                    {instance.messages_sent_this_hour} / {instance.max_messages_per_hour}
                  </span>
                </div>
                {instance.last_error && (
                  <div className="detail-row error">
                    <span className="label">Último erro:</span>
                    <span className="value">{instance.last_error.substring(0, 100)}...</span>
                  </div>
                )}
              </div>

              <div className="instance-actions">
                <button
                  className="btn-action"
                  onClick={() => handleRefresh(instance.name)}
                  disabled={refreshing === instance.name}
                >
                  {refreshing === instance.name ? (
                    <Loader size={16} className="spinning" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  <span>Atualizar Status</span>
                </button>
                <button
                  className="btn-action"
                  onClick={() => handleGenerateQR(instance.name)}
                >
                  <QrCode size={16} />
                  <span>Gerar QR Code</span>
                </button>
                <button
                  className="btn-action"
                  onClick={() => handleConnect(instance.name)}
                >
                  <CheckCircle size={16} />
                  <span>Verificar Conexão</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

