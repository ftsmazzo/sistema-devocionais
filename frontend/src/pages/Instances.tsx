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
  Edit,
  X,
  QrCode,
  Camera,
  Image as ImageIcon,
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
  profile_picture_url?: string | null;
  profile_picture_updated_at?: string | null;
}

function accountBlock(instance: Instance): { label: string; value: string; hint?: string } {
  const phone = instance.phone_number?.trim();
  if (instance.status === 'connected') {
    return {
      label: 'Número na conta',
      value: phone || 'Sincronizando…',
    };
  }
  if (instance.status === 'connecting') {
    return {
      label: 'Conexão em andamento',
      value: phone || 'Leia o QR Code no WhatsApp',
      hint: 'O número aparece após concluir a leitura do código.',
    };
  }
  return {
    label: 'Conta offline',
    value: phone ? `${phone} (último registro)` : 'Não conectado',
    hint: phone
      ? 'Este número não está ativo agora. Toque em Conectar para restabelecer.'
      : 'Use Conectar para vincular o WhatsApp a esta instância.',
  };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
  const [profileModal, setProfileModal] = useState<Instance | null>(null);
  const [profileUrlInput, setProfileUrlInput] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState<Record<number, boolean>>({});
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

  const openProfileModal = (instance: Instance) => {
    setProfileModal(instance);
    setProfileUrlInput('');
  };

  const handleSyncProfilePicture = async (id: number) => {
    setRefreshing(id);
    try {
      await api.post(`/instances/${id}/sync-profile-picture`);
      setToast({ message: 'Foto de perfil atualizada!', type: 'success' });
      loadInstances();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Não foi possível sincronizar a foto',
        type: 'error',
      });
    } finally {
      setRefreshing(null);
    }
  };

  const handleSaveProfilePicture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileModal) return;
    const url = profileUrlInput.trim();
    if (!url) {
      setToast({ message: 'Cole a URL pública da imagem (https://…)', type: 'error' });
      return;
    }
    setProfileSaving(true);
    try {
      await api.post(`/instances/${profileModal.id}/profile-picture`, { pictureUrl: url });
      setToast({ message: 'Foto de perfil enviada para o WhatsApp!', type: 'success' });
      setProfileModal(null);
      setProfileUrlInput('');
      loadInstances();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || error.response?.data?.details || 'Erro ao atualizar foto',
        type: 'error',
      });
    } finally {
      setProfileSaving(false);
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
          {instances.map((instance) => {
            const block = accountBlock(instance);
            const showAvatar =
              instance.status === 'connected' &&
              instance.profile_picture_url &&
              !avatarBroken[instance.id];
            return (
            <div key={instance.id} className="glass-card hover-glow" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {/* Card Header */}
              <div style={{ padding: '20px 24px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 16,
                      flexShrink: 0,
                      overflow: 'hidden',
                      border: '2px solid rgba(245, 158, 11, 0.35)',
                      background: 'linear-gradient(145deg, rgba(245,158,11,0.25), rgba(217,119,6,0.08))',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                    }}
                  >
                    {showAvatar ? (
                      <img
                        key={`${instance.id}-${instance.profile_picture_url}`}
                        src={instance.profile_picture_url!}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={() => setAvatarBroken((prev) => ({ ...prev, [instance.id]: true }))}
                      />
                    ) : (
                      <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--gold-primary)', fontFamily: 'Outfit' }}>
                        {initials(instance.name)}
                      </span>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{instance.name}</h3>
                    <code style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: 4, marginTop: 4, display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {instance.instance_name}
                    </code>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
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
                  marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 12
                }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold-primary)', flexShrink: 0 }}>
                    <Smartphone size={20} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>{block.label}</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                      {block.value}
                    </div>
                    {block.hint && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.45 }}>{block.hint}</div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <button
                    type="button"
                    onClick={() => openProfileModal(instance)}
                    disabled={instance.status !== 'connected' || refreshing === instance.id}
                    className="btn-outline"
                    title={instance.status !== 'connected' ? 'Conecte a instância para alterar a foto' : undefined}
                    style={{
                      padding: '10px',
                      borderRadius: 10,
                      fontSize: '0.8rem',
                      opacity: instance.status !== 'connected' ? 0.45 : 1,
                      cursor: instance.status !== 'connected' ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                  >
                    <Camera size={16} /> Alterar foto
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSyncProfilePicture(instance.id)}
                    disabled={instance.status !== 'connected' || refreshing === instance.id}
                    className="btn-outline"
                    title="Buscar foto atual no WhatsApp"
                    style={{
                      padding: '10px',
                      borderRadius: 10,
                      fontSize: '0.8rem',
                      opacity: instance.status !== 'connected' ? 0.45 : 1,
                      cursor: instance.status !== 'connected' ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                  >
                    <ImageIcon size={16} className={refreshing === instance.id ? 'animate-spin' : ''} /> Atualizar mídia
                  </button>
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
            );
          })}
        </div>
      )}

      {/* Modal foto de perfil */}
      {profileModal && (
        <div className="modal-overlay" style={{ zIndex: 1150 }}>
          <div className="glass-card modal-overlay-panel" style={{ width: '100%', maxWidth: 480, padding: 0 }}>
            <div style={{ padding: '22px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(245,158,11,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold-primary)' }}>
                  <Camera size={22} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit' }}>Foto de perfil</h2>
                  <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{profileModal.name}</p>
                </div>
              </div>
              <button type="button" onClick={() => { setProfileModal(null); setProfileUrlInput(''); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={26} /></button>
            </div>
            <form onSubmit={handleSaveProfilePicture} style={{ padding: 28 }}>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 20px' }}>
                A Evolution API aceita uma <strong>URL pública</strong> da imagem (PNG ou JPG). Envie o arquivo para seu servidor, S3 ou CDN e cole o link abaixo.
              </p>
              <label className="label-premium">URL da imagem (https://)</label>
              <input
                type="url"
                value={profileUrlInput}
                onChange={(e) => setProfileUrlInput(e.target.value)}
                placeholder="https://exemplo.com/minha-foto.jpg"
                className="input-dark"
                autoComplete="off"
                style={{ width: '100%' }}
              />
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 10 }}>
                Opcional: defina <code style={{ fontSize: '0.65rem' }}>EXTERNAL_WEBHOOK_PROFILE_PICTURE_URL</code> no backend (ou o legado <code style={{ fontSize: '0.65rem' }}>N8N_WEBHOOK_PROFILE_PICTURE_URL</code>) para notificar um webhook após o envio.
              </p>
              <div style={{ marginTop: 28, display: 'flex', gap: 14 }}>
                <button type="button" onClick={() => { setProfileModal(null); setProfileUrlInput(''); }} className="btn-outline" style={{ flex: 1, padding: '14px 0', borderRadius: 12 }}>Cancelar</button>
                <button type="submit" className="btn-gold" disabled={profileSaving} style={{ flex: 1, padding: '14px 0', borderRadius: 12, border: 'none', opacity: profileSaving ? 0.7 : 1 }}>
                  {profileSaving ? 'Enviando…' : 'Aplicar no WhatsApp'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Criar/Editar */}
      {showModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-overlay-panel" style={{ width: '100%', maxWidth: 500, padding: 0 }}>
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
        <div className="modal-overlay" style={{ zIndex: 1200, background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
          <div className="glass-card modal-overlay-panel" style={{ width: '100%', maxWidth: 450, padding: 32, textAlign: 'center' }}>
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
