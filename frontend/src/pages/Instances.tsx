import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import {
  Plus,
  Trash2,
  Power,
  PowerOff,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Shield,
  Smartphone,
  ExternalLink,
  Edit,
  X,
  QrCode,
} from 'lucide-react';

interface Instance {
  id: number;
  name: string;
  instance_name: string;
  status: 'connected' | 'disconnected' | 'connecting';
  phone_number?: string;
  qr_code?: string;
  last_connection?: string;
  created_at: string;
}

export default function Instances() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrInstanceName, setQrInstanceName] = useState<string>('');
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    instance_name: '',
  });
  const [refreshing, setRefreshing] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const navigate = useNavigate();
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    loadInstances();
  }, [user, navigate]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const loadInstances = async () => {
    try {
      setLoading(true);
      const response = await api.get('/instances');
      setInstances(response.data.instances);
    } catch (error) {
      console.error('Erro ao carregar instâncias:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingInstance) {
        await api.put(`/instances/${editingInstance.id}`, formData);
      } else {
        await api.post('/instances', formData);
      }
      setShowModal(false);
      setEditingInstance(null);
      setFormData({ name: '', instance_name: '' });
      setToast({ message: `Instância ${editingInstance ? 'atualizada' : 'criada'} com sucesso!`, type: 'success' });
      loadInstances();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao salvar instância', type: 'error' });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja deletar esta instância?')) return;
    try {
      await api.delete(`/instances/${id}`);
      setToast({ message: 'Instância removida com sucesso!', type: 'success' });
      loadInstances();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao deletar instância', type: 'error' });
    }
  };

  const handleConnect = async (id: number) => {
    setRefreshing(id);
    try {
      const response = await api.post(`/instances/${id}/connect`);
      if (response.data.qr_code) {
        const instance = instances.find((inst) => inst.id === id);
        setQrCode(response.data.qr_code);
        setQrInstanceName(instance?.name || 'Instância');
        setShowQrModal(true);
      }
      loadInstances();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao conectar instância', type: 'error' });
    } finally {
      setRefreshing(null);
    }
  };

  const handleDisconnect = async (id: number) => {
    setRefreshing(id);
    try {
      await api.post(`/instances/${id}/disconnect`);
      setToast({ message: 'Instância desconectada!', type: 'success' });
      loadInstances();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao desconectar instância', type: 'error' });
    } finally {
      setRefreshing(null);
    }
  };

  const handleCheckStatus = async (id: number) => {
    setRefreshing(id);
    try {
      await api.get(`/instances/${id}/status`);
      loadInstances();
    } catch (error: any) {
      setToast({ message: 'Erro ao verificar status da instância', type: 'error' });
    } finally {
      setRefreshing(null);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <RefreshCw size={40} className="animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          background: toast.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)',
          border: `1px solid ${toast.type === 'success' ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)'}`,
          padding: '14px 20px', borderRadius: 12, backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', gap: 10, color: toast.type === 'success' ? '#34d399' : '#fb7185'
        }}>
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
          <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 20px rgba(245, 158, 11, 0.3)'
            }}>
              <Smartphone size={28} color="#0d0c14" strokeWidth={2} />
            </div>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, fontFamily: 'Outfit' }}>Instâncias WhatsApp</h1>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Gerencie e conecte seus números para envios automáticos.</p>
            </div>
          </div>

          <button
            onClick={() => {
              setEditingInstance(null);
              setFormData({ name: '', instance_name: '' });
              setShowModal(true);
            }}
            className="btn-gold"
            style={{ padding: '12px 28px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 10, border: 'none', cursor: 'pointer' }}
          >
            <Plus size={20} strokeWidth={3} />
            <span>Nova Instância</span>
          </button>
        </div>
      </div>

      {/* Instances Grid */}
      {instances.length === 0 ? (
        <div className="glass-card" style={{ padding: '80px 24px', textAlign: 'center' }}>
          <Smartphone size={64} color="var(--border)" style={{ marginBottom: 20 }} />
          <h3 style={{ color: 'var(--text-primary)', margin: 0 }}>Nenhuma instância cadastrada</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>Clique em "Nova Instância" para conectar seu WhatsApp.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {instances.map((instance) => (
            <div key={instance.id} className="glass-card hover-glow" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {/* Card Header */}
              <div style={{ padding: '20px 24px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{instance.name}</h3>
                  <code style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: 4, marginTop: 4, display: 'inline-block' }}>
                    {instance.instance_name}
                  </code>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {instance.status === 'connected' ? (
                    <span style={{ fontSize: '0.65rem', padding: '4px 8px', borderRadius: 20, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <CheckCircle2 size={12} /> Conectado
                    </span>
                  ) : instance.status === 'connecting' ? (
                    <span style={{ fontSize: '0.65rem', padding: '4px 8px', borderRadius: 20, background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={12} className="animate-spin" /> Conectando
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.65rem', padding: '4px 8px', borderRadius: 20, background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <XCircle size={12} /> Offline
                    </span>
                  )}
                </div>
              </div>

              {/* Card Body */}
              <div style={{ padding: 24, flex: 1 }}>
                <div style={{ 
                  padding: '16px', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)',
                  marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12
                }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold-primary)' }}>
                    <Smartphone size={20} />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Número Conectado</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {instance.phone_number || 'Aguardando...'}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {instance.status === 'disconnected' ? (
                    <button
                      onClick={() => handleConnect(instance.id)}
                      disabled={refreshing === instance.id}
                      className="btn-gold"
                      style={{ padding: '10px', borderRadius: 10, fontSize: '0.85rem', border: 'none' }}
                    >
                      {refreshing === instance.id ? <RefreshCw size={18} className="animate-spin" /> : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                          <Power size={16} /> Conectar
                        </div>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDisconnect(instance.id)}
                      disabled={refreshing === instance.id}
                      className="btn-outline"
                      style={{ padding: '10px', borderRadius: 10, fontSize: '0.85rem', color: '#fb7185', borderColor: 'rgba(244,63,94,0.2)' }}
                    >
                      {refreshing === instance.id ? <RefreshCw size={18} className="animate-spin" /> : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                          <PowerOff size={16} /> Desconectar
                        </div>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => handleCheckStatus(instance.id)}
                    disabled={refreshing === instance.id}
                    className="btn-outline"
                    style={{ padding: '10px', borderRadius: 10, fontSize: '0.85rem' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <RefreshCw size={16} className={refreshing === instance.id ? 'animate-spin' : ''} /> Status
                    </div>
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginTop: 12 }}>
                  <button
                    onClick={() => {
                      setEditingInstance(instance);
                      setFormData({ name: instance.name, instance_name: instance.instance_name });
                      setShowModal(true);
                    }}
                    className="btn-outline"
                    style={{ padding: '10px', borderRadius: 10, fontSize: '0.85rem' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Edit size={16} /> Editar
                    </div>
                  </button>
                  <button
                    onClick={() => handleDelete(instance.id)}
                    className="btn-outline"
                    style={{ padding: '10px', borderRadius: 10, color: '#fb7185', borderColor: 'rgba(244,63,94,0.1)', background: 'rgba(244,63,94,0.03)' }}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              {/* Card Footer Action */}
              <button
                onClick={() => navigate(`/blindage/${instance.id}`)}
                style={{
                  width: '100%', padding: '16px', background: 'rgba(167, 139, 250, 0.05)', border: 'none',
                  borderTop: '1px solid var(--border)', color: '#a78bfa', fontWeight: 600, fontSize: '0.85rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer',
                  transition: '0.2s'
                }}
              >
                <Shield size={16} /> Configurar Blindagem
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Modal Criar/Editar */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: 500, padding: 0 }}>
            <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit' }}>
                {editingInstance ? 'Editar Instância' : 'Nova Instância'}
              </h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={28} /></button>
            </div>
            
            <form onSubmit={handleSubmit} style={{ padding: 32 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div>
                  <label className="label-premium">Nome da Instância *</label>
                  <input
                    type="text" value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ex: WhatsApp Principal" className="input-dark" required
                  />
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>Identificação interna no sistema.</p>
                </div>

                <div>
                  <label className="label-premium">Instance Name (ID Técnico) *</label>
                  <input
                    type="text" value={formData.instance_name}
                    onChange={(e) => setFormData({ ...formData, instance_name: e.target.value })}
                    placeholder="Ex: whatsapp-01" className="input-dark" required
                  />
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>ID sem espaços usado na Evolution API.</p>
                </div>
              </div>

              <div style={{ marginTop: 40, display: 'flex', gap: 16 }}>
                <button type="button" onClick={() => setShowModal(false)} className="btn-outline" style={{ flex: 1, padding: '14px 0', borderRadius: 12 }}>Cancelar</button>
                <button type="submit" className="btn-gold" style={{ flex: 1, padding: '14px 0', borderRadius: 12, border: 'none' }}>
                  Salvar Instância
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal QR Code */}
      {showQrModal && qrCode && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 20 }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: 450, padding: 32, textAlign: 'center' }}>
            <div style={{ 
              width: 64, height: 64, borderRadius: 20, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px'
            }}>
              <QrCode size={32} />
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8, fontFamily: 'Outfit' }}>Escaneie o QR Code</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 32 }}>
              Conecte o WhatsApp à instância <strong>{qrInstanceName}</strong>
            </p>

            <div style={{ background: '#fff', padding: 20, borderRadius: 20, display: 'inline-block', boxShadow: '0 0 40px rgba(0,0,0,0.5)', marginBottom: 32 }}>
              <img src={qrCode} alt="QR Code" style={{ width: 260, height: 260 }} />
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 16, padding: 20, textAlign: 'left', marginBottom: 32 }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--gold-primary)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 800, flexShrink: 0 }}>1</span>
                  <span>Abra o WhatsApp no seu celular</span>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--gold-primary)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 800, flexShrink: 0 }}>2</span>
                  <span>Toque em Menu ou Configurações e selecione Aparelhos Conectados</span>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--gold-primary)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 800, flexShrink: 0 }}>3</span>
                  <span>Aponte seu celular para esta tela para capturar o código</span>
                </div>
              </div>
            </div>

            <button onClick={() => setShowQrModal(false)} className="btn-outline" style={{ width: '100%', padding: '14px 0', borderRadius: 12 }}>
              Fechar e Atualizar
            </button>
          </div>
        </div>
      )}

      <style>{`
        .label-premium {
          display: block;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
      `}</style>
    </div>
  );
}
