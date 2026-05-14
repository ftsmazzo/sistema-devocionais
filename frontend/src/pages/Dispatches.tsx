import { useState, useEffect } from 'react';
import api from '@/lib/api';
import {
  Send,
  Plus,
  Play,
  Square,
  Trash2,
  CheckCircle2,
  BookOpen,
  Megaphone,
  MessageCircle,
  RefreshCw,
  X,
  AlertCircle,
  Users,
  ExternalLink,
  Pencil,
  Copy,
  CalendarClock,
} from 'lucide-react';

interface Dispatch {
  id: number;
  name: string;
  message_template?: string;
  dispatch_type: 'devocional' | 'marketing' | 'individual';
  status: 'pending' | 'running' | 'completed' | 'stopped' | 'failed';
  total_contacts: number;
  contacts_processed: number;
  contacts_success: number;
  contacts_failed: number;
  list_id?: number;
  list_name?: string;
  list_type?: string;
  devocional_id?: number;
  metadata?: Record<string, unknown> | string | null;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

interface FormData {
  name: string;
  list_id: string;
  message_template: string;
  instance_ids: number[];
  media_url?: string;
  media_type?: 'image' | 'video' | 'audio' | 'pdf' | 'document';
}

function parseDispatchMetadata(d: Dispatch): Record<string, unknown> {
  const m = d.metadata;
  if (!m) return {};
  if (typeof m === 'string') {
    try {
      return JSON.parse(m) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return m as Record<string, unknown>;
}

function isScheduledDevocional(dispatch: Dispatch): boolean {
  if (dispatch.dispatch_type !== 'devocional') return false;
  const meta = parseDispatchMetadata(dispatch);
  const t = meta.devocional_trigger;
  if (t === 'scheduled') return true;
  if (t === 'manual') return false;
  const n = (dispatch.name || '').trim();
  return /^Devocional\s+\d{1,2}\/\d{1,2}\/\d{4}$/i.test(n);
}

function dispatchKind(dispatch: Dispatch): {
  label: string;
  sub: string;
  icon: 'marketing' | 'dev-auto' | 'dev-manual';
} {
  if (dispatch.dispatch_type === 'marketing') {
    return {
      label: 'Mensagem personalizada',
      sub: 'Texto e mídia definidos por você',
      icon: 'marketing',
    };
  }
  if (isScheduledDevocional(dispatch)) {
    return {
      label: 'Devocional automático',
      sub: 'Agendamento diário (Config. Devocional)',
      icon: 'dev-auto',
    };
  }
  return {
    label: 'Devocional manual',
    sub: 'Teste ou envio avulso criado nesta tela',
    icon: 'dev-manual',
  };
}

export default function Dispatches() {
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [dispatchType, setDispatchType] = useState<'devocional' | 'marketing'>('marketing');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [formData, setFormData] = useState<FormData>({
    name: '',
    list_id: '',
    message_template: '',
    instance_ids: [],
    media_url: '',
    media_type: undefined,
  });
  const [lists, setLists] = useState<any[]>([]);
  const [startingDispatch, setStartingDispatch] = useState<number | null>(null);
  const [creatingDispatch, setCreatingDispatch] = useState(false);
  const [totalDispatches, setTotalDispatches] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 10;
  const [detailDispatch, setDetailDispatch] = useState<Dispatch | null>(null);
  const [detailContacts, setDetailContacts] = useState<any[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingUpload, setLoadingUpload] = useState(false);
  const [editModal, setEditModal] = useState<Dispatch | null>(null);
  const [editForm, setEditForm] = useState<FormData>({
    name: '',
    list_id: '',
    message_template: '',
    instance_ids: [],
    media_url: '',
    media_type: undefined,
  });
  const [editDevocionalId, setEditDevocionalId] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [devOptions, setDevOptions] = useState<Array<{ id: number; title: string; date: string }>>([]);
  const [cloneModal, setCloneModal] = useState<Dispatch | null>(null);
  const [cloneNameInput, setCloneNameInput] = useState('');
  const [cloneLoading, setCloneLoading] = useState(false);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    loadLists();
  }, []);

  useEffect(() => {
    loadDispatches();
  }, [page]);

  const loadDispatches = async () => {
    try {
      setLoading(true);
      const response = await api.get('/dispatches', {
        params: { limit, offset: page * limit }
      });
      setDispatches(response.data.dispatches || []);
      setTotalDispatches(response.data.total ?? 0);
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao carregar disparos', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const loadLists = async () => {
    try {
      const response = await api.get('/lists');
      setLists(response.data.lists || []);
    } catch (error) {
      console.error('Erro ao carregar listas:', error);
    }
  };



  const handleCreate = async () => {
    if (creatingDispatch) return;
    try {
      if (!formData.name) {
        setToast({ message: 'Nome é obrigatório', type: 'error' });
        return;
      }
      setCreatingDispatch(true);
      const payload: any = {
        name: formData.name,
        list_id: parseInt(formData.list_id),
        instance_ids: formData.instance_ids,
      };
      if (dispatchType === 'marketing') {
        payload.message_template = formData.message_template;
        if (formData.media_url) {
          payload.media_url = formData.media_url;
          payload.media_type = formData.media_type;
        }
      }
      await api.post(`/dispatches/${dispatchType}`, payload);
      setToast({ message: 'Disparo criado com sucesso!', type: 'success' });
      setShowCreateModal(false);
      setFormData({ name: '', list_id: '', message_template: '', instance_ids: [], media_url: '', media_type: undefined });
      await loadDispatches();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao criar disparo', type: 'error' });
    } finally {
      setCreatingDispatch(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoadingUpload(true);
      const uploadFormData = new FormData();
      uploadFormData.append('media', file);

      setToast({ message: 'Fazendo upload do arquivo...', type: 'success' });
      
      const response = await api.post('/dispatches/upload-media', uploadFormData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 300000, // 5 minutos para vídeos grandes
      });

      console.log('✅ Upload response:', response.data);

      setFormData(prev => ({
        ...prev,
        media_url: response.data.media_url,
        media_type: response.data.media_type,
      }));
      setToast({ message: 'Upload concluído com sucesso!', type: 'success' });
    } catch (error: any) {
      console.error('Erro no upload:', error);
      setToast({ 
        message: error.response?.data?.error || 'Erro ao fazer upload do arquivo', 
        type: 'error' 
      });
    } finally {
      setLoadingUpload(false);
    }
  };

  const handleStart = async (id: number) => {
    if (startingDispatch === id) return;
    try {
      setStartingDispatch(id);
      await api.post(`/dispatches/${id}/start`);
      setToast({ message: 'Disparo iniciado!', type: 'success' });
      await loadDispatches();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao iniciar disparo', type: 'error' });
    } finally {
      setStartingDispatch(null);
    }
  };

  const handleStop = async (id: number) => {
    try {
      await api.post(`/dispatches/${id}/stop`);
      setToast({ message: 'Disparo parado!', type: 'success' });
      await loadDispatches();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao parar disparo', type: 'error' });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja deletar este disparo?')) return;
    try {
      await api.delete(`/dispatches/${id}`);
      setToast({ message: 'Disparo deletado!', type: 'success' });
      await loadDispatches();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao deletar disparo', type: 'error' });
    }
  };

  const openDetail = async (dispatch: Dispatch) => {
    setDetailDispatch(dispatch);
    setLoadingDetail(true);
    try {
      const response = await api.get(`/dispatches/${dispatch.id}/contacts`);
      setDetailContacts(response.data.contacts || []);
    } catch (error) {
      setToast({ message: 'Erro ao carregar detalhes', type: 'error' });
    } finally {
      setLoadingDetail(false);
    }
  };

  const openEditPending = async (d: Dispatch) => {
    const meta = parseDispatchMetadata(d);
    setEditModal(d);
    setEditForm({
      name: d.name,
      list_id: d.list_id != null ? String(d.list_id) : '',
      message_template: d.message_template || '',
      instance_ids: [],
      media_url: (meta.media_url as string) || '',
      media_type: (meta.media_type as FormData['media_type']) || undefined,
    });
    setEditDevocionalId(d.devocional_id != null ? String(d.devocional_id) : '');
    setDevOptions([]);
    if (d.dispatch_type === 'devocional') {
      try {
        const r = await api.get('/devocional', { params: { limit: 30, offset: 0 } });
        const rows = (r.data.devocionais || []).map((x: { id: number; title: string; date: string }) => ({
          id: x.id,
          title: x.title,
          date: x.date,
        }));
        setDevOptions(rows);
      } catch {
        setDevOptions([]);
      }
    }
  };

  const handleSaveEditPending = async () => {
    if (!editModal) return;
    setEditSaving(true);
    try {
      if (editModal.dispatch_type === 'marketing') {
        if (!editForm.name?.trim() || !editForm.message_template?.trim() || !editForm.list_id) {
          setToast({ message: 'Preencha nome, lista e mensagem', type: 'error' });
          setEditSaving(false);
          return;
        }
        await api.put(`/dispatches/${editModal.id}`, {
          name: editForm.name.trim(),
          message_template: editForm.message_template,
          list_id: parseInt(editForm.list_id, 10),
          media_url: editForm.media_url || null,
          media_type: editForm.media_type || null,
        });
      } else {
        if (!editForm.name?.trim() || !editForm.list_id || !editDevocionalId) {
          setToast({ message: 'Preencha nome, lista e devocional', type: 'error' });
          setEditSaving(false);
          return;
        }
        await api.put(`/dispatches/${editModal.id}`, {
          name: editForm.name.trim(),
          list_id: parseInt(editForm.list_id, 10),
          devocional_id: parseInt(editDevocionalId, 10),
        });
      }
      setToast({ message: 'Disparo atualizado. Revise e clique em Iniciar.', type: 'success' });
      setEditModal(null);
      await loadDispatches();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao salvar alterações', type: 'error' });
    } finally {
      setEditSaving(false);
    }
  };

  const openCloneModal = (d: Dispatch) => {
    setCloneModal(d);
    setCloneNameInput(`${d.name} (cópia)`);
  };

  const handleCloneDispatch = async () => {
    if (!cloneModal || !cloneNameInput.trim()) return;
    setCloneLoading(true);
    try {
      await api.post(`/dispatches/${cloneModal.id}/clone`, { name: cloneNameInput.trim() });
      setToast({ message: 'Novo disparo pendente criado. Você pode editar antes de iniciar.', type: 'success' });
      setCloneModal(null);
      setCloneNameInput('');
      await loadDispatches();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao duplicar disparo', type: 'error' });
    } finally {
      setCloneLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running': return <span className="badge badge-sky animate-pulse">Processando</span>;
      case 'completed': return <span className="badge badge-emerald">Concluído</span>;
      case 'stopped': return <span className="badge badge-amber">Interrompido</span>;
      case 'failed': return <span className="badge badge-rose">Falhou</span>;
      default: return <span className="badge badge-violet">Pendente</span>;
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
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
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
              <Send size={28} color="#0d0c14" strokeWidth={2} />
            </div>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, fontFamily: 'Outfit' }}>Disparos</h1>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Gerencie e acompanhe o status de suas mensagens personalizadas e devocionais.</p>
            </div>
          </div>

          <button
            onClick={() => {
              setFormData({ name: '', list_id: '', message_template: '', instance_ids: [], media_url: '', media_type: undefined });
              setShowCreateModal(true);
            }}
            className="btn-gold"
            style={{ padding: '12px 28px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 10, border: 'none', cursor: 'pointer' }}
          >
            <Plus size={20} strokeWidth={3} />
            <span>Novo Disparo</span>
          </button>
        </div>
      </div>

      {/* Info Alert */}
      <div style={{
        padding: '16px 24px', borderRadius: 16, background: 'rgba(56, 189, 248, 0.05)',
        border: '1px solid rgba(56, 189, 248, 0.15)', marginBottom: 32, display: 'flex', gap: 16
      }}>
        <Info size={20} color="#38bdf8" style={{ marginTop: 2, flexShrink: 0 }} />
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#7dd3fc', lineHeight: 1.5 }}>
          <strong>Nota:</strong> o devocional <strong>automático do dia</strong> é disparado pelo agendamento em <em>Config. Devocional</em> e aparece aqui como &quot;Devocional automático&quot;.
          Use esta página para <strong>mensagens personalizadas</strong> ou <strong>testes manuais</strong> de devocional; antes de iniciar você pode <strong>Editar</strong> o pendente; depois de concluído use <strong>Duplicar</strong> para reaproveitar com outro nome.
        </p>
      </div>

      {/* Dispatches Grid */}
      {dispatches.length === 0 ? (
        <div className="glass-card" style={{ padding: '80px 24px', textAlign: 'center' }}>
          <Megaphone size={64} color="var(--border)" style={{ marginBottom: 20 }} />
          <h3 style={{ color: 'var(--text-primary)', margin: 0 }}>Nenhum disparo realizado</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>Clique em "Novo Disparo" para começar.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
          {dispatches.map((dispatch) => {
            const kind = dispatchKind(dispatch);
            let iconBg = 'rgba(56, 189, 248, 0.1)';
            let iconFg = '#0ea5e9';
            if (kind.icon === 'dev-auto') {
              iconBg = 'rgba(245, 158, 11, 0.14)';
              iconFg = '#fbbf24';
            } else if (kind.icon === 'dev-manual') {
              iconBg = 'rgba(16, 185, 129, 0.1)';
              iconFg = '#10b981';
            }

            const canEditPending = dispatch.status === 'pending';
            const canClone =
              dispatch.status !== 'running' &&
              dispatch.status !== 'pending';

            return (
            <div key={dispatch.id} className="glass-card hover-glow" style={{ padding: '24px 32px' }}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 10, background: iconBg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: iconFg,
                    }}>
                      {kind.icon === 'marketing' && <MessageCircle size={20} />}
                      {kind.icon === 'dev-auto' && <CalendarClock size={20} />}
                      {kind.icon === 'dev-manual' && <BookOpen size={20} />}
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>{dispatch.name}</h3>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <span style={{
                          fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                          padding: '4px 10px', borderRadius: 8,
                          background: kind.icon === 'dev-auto' ? 'rgba(245, 158, 11, 0.15)' : kind.icon === 'dev-manual' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(56, 189, 248, 0.12)',
                          color: kind.icon === 'dev-auto' ? '#fbbf24' : kind.icon === 'dev-manual' ? '#34d399' : '#7dd3fc',
                          border: `1px solid ${kind.icon === 'dev-auto' ? 'rgba(245,158,11,0.35)' : kind.icon === 'dev-manual' ? 'rgba(16,185,129,0.25)' : 'rgba(56,189,248,0.25)'}`,
                        }}>
                          {kind.label}
                        </span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{kind.sub}</span>
                        <span style={{ color: 'var(--border)' }}>•</span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{dispatch.list_name || 'Sem lista'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-4">
                    {getStatusBadge(dispatch.status)}
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Users size={14} /> <strong>{dispatch.contacts_processed || 0}</strong> / {dispatch.total_contacts || 0}
                    </div>
                    {dispatch.contacts_success > 0 && (
                      <div style={{ fontSize: '0.85rem', color: '#34d399', fontWeight: 600 }}>✓ {dispatch.contacts_success}</div>
                    )}
                    {dispatch.contacts_failed > 0 && (
                      <div style={{ fontSize: '0.85rem', color: '#fb7185', fontWeight: 600 }}>✗ {dispatch.contacts_failed}</div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                  {canEditPending && (
                    <button
                      type="button"
                      onClick={() => openEditPending(dispatch)}
                      className="btn-outline"
                      style={{ padding: '8px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}
                      title="Ajustar nome, lista ou texto antes de iniciar"
                    >
                      <Pencil size={16} />
                      Editar
                    </button>
                  )}
                  {dispatch.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => handleStart(dispatch.id)}
                      className="btn-outline"
                      style={{ color: '#34d399', borderColor: 'rgba(52, 211, 153, 0.2)', padding: '8px 16px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      {startingDispatch === dispatch.id ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                      {startingDispatch === dispatch.id ? 'Iniciando...' : 'Iniciar'}
                    </button>
                  )}
                  {dispatch.status === 'running' && (
                    <button
                      type="button"
                      onClick={() => handleStop(dispatch.id)}
                      className="btn-outline"
                      style={{ color: '#fb7185', borderColor: 'rgba(251, 113, 133, 0.2)', padding: '8px 16px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      <Square size={16} fill="currentColor" /> Parar
                    </button>
                  )}
                  {canClone && (
                    <button
                      type="button"
                      onClick={() => openCloneModal(dispatch)}
                      className="btn-outline"
                      style={{ padding: '8px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}
                      title="Criar novo disparo pendente com os mesmos dados"
                    >
                      <Copy size={16} />
                      Duplicar
                    </button>
                  )}
                  <button type="button" onClick={() => openDetail(dispatch)} className="btn-outline" style={{ padding: '10px', borderRadius: 10 }} title="Ver detalhes">
                    <ExternalLink size={18} />
                  </button>
                  {dispatch.status !== 'running' && (
                    <button type="button" onClick={() => handleDelete(dispatch.id)} style={{ padding: '10px', borderRadius: 10, background: 'rgba(244, 63, 94, 0.05)', color: '#fb7185', border: '1px solid rgba(244, 63, 94, 0.1)', cursor: 'pointer' }}>
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalDispatches > limit && (
        <div style={{ marginTop: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-outline" style={{ padding: '10px 20px', borderRadius: 12, opacity: page === 0 ? 0.5 : 1 }}>Anterior</button>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Página {page + 1} de {Math.ceil(totalDispatches / limit)}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= totalDispatches} className="btn-outline" style={{ padding: '10px 20px', borderRadius: 12, opacity: (page + 1) * limit >= totalDispatches ? 0.5 : 1 }}>Próxima</button>
        </div>
      )}

      {/* Modal: editar disparo pendente */}
      {editModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-overlay-panel" style={{ width: '100%', maxWidth: 640, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit' }}>
                Ajustar antes de enviar
              </h2>
              <button type="button" onClick={() => setEditModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>
            <div style={{ padding: 24, maxHeight: 'min(72vh, 640px)', overflowY: 'auto' }}>
              {editModal.dispatch_type === 'marketing' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <div>
                    <label className="label-premium">Nome</label>
                    <input className="input-dark" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="label-premium">Lista</label>
                    <select
                      className="input-dark"
                      value={editForm.list_id}
                      onChange={(e) => setEditForm({ ...editForm, list_id: e.target.value })}
                    >
                      <option value="">Selecione...</option>
                      {lists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name} ({list.total_contacts})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label-premium">Mensagem</label>
                    <textarea
                      className="input-dark"
                      style={{ minHeight: 140, resize: 'vertical' }}
                      value={editForm.message_template}
                      onChange={(e) => setEditForm({ ...editForm, message_template: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="label-premium">Tipo de anexo</label>
                      <select
                        className="input-dark"
                        value={editForm.media_type || ''}
                        onChange={(e) =>
                          setEditForm({ ...editForm, media_type: (e.target.value || undefined) as FormData['media_type'] })
                        }
                      >
                        <option value="">Apenas texto</option>
                        <option value="image">Imagem</option>
                        <option value="video">Vídeo</option>
                        <option value="audio">Áudio</option>
                        <option value="pdf">PDF</option>
                      </select>
                    </div>
                    <div>
                      <label className="label-premium">URL da mídia</label>
                      <input
                        className="input-dark"
                        value={editForm.media_url || ''}
                        onChange={(e) => setEditForm({ ...editForm, media_url: e.target.value })}
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <div>
                    <label className="label-premium">Nome</label>
                    <input className="input-dark" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="label-premium">Lista</label>
                    <select
                      className="input-dark"
                      value={editForm.list_id}
                      onChange={(e) => setEditForm({ ...editForm, list_id: e.target.value })}
                    >
                      <option value="">Selecione...</option>
                      {lists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name} ({list.total_contacts})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label-premium">Conteúdo (devocional)</label>
                    <select
                      className="input-dark"
                      value={editDevocionalId}
                      onChange={(e) => setEditDevocionalId(e.target.value)}
                    >
                      <option value="">Selecione o devocional...</option>
                      {devOptions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.date} — {d.title}
                        </option>
                      ))}
                    </select>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 8 }}>
                      O texto enviado será o deste registro; a personalização por contato ocorre no envio.
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 12 }}>
              <button type="button" className="btn-outline" style={{ flex: 1, padding: '12px 0', borderRadius: 12 }} onClick={() => setEditModal(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-gold"
                style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', opacity: editSaving ? 0.7 : 1 }}
                disabled={editSaving}
                onClick={() => handleSaveEditPending()}
              >
                {editSaving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: duplicar disparo */}
      {cloneModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-overlay-panel" style={{ width: '100%', maxWidth: 440, padding: 24 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit' }}>Duplicar como novo disparo</h3>
            <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Será criado um disparo <strong>pendente</strong> com a mesma mensagem, lista e configurações. Depois você pode editar e iniciar quando quiser.
            </p>
            <label className="label-premium">Nome do novo disparo</label>
            <input className="input-dark" value={cloneNameInput} onChange={(e) => setCloneNameInput(e.target.value)} style={{ marginBottom: 20 }} />
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="button" className="btn-outline" style={{ flex: 1, padding: '12px 0', borderRadius: 12 }} onClick={() => { setCloneModal(null); setCloneNameInput(''); }}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-gold"
                style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', opacity: cloneLoading ? 0.7 : 1 }}
                disabled={cloneLoading || !cloneNameInput.trim()}
                onClick={() => handleCloneDispatch()}
              >
                {cloneLoading ? 'Criando…' : 'Criar cópia'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Criar Disparo */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-overlay-panel" style={{ width: '100%', maxWidth: 700, maxHeight: 'min(90vh, 900px)', overflowY: 'auto', padding: 0 }}>
            <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit' }}>Configurar Novo Disparo</h2>
              <button onClick={() => setShowCreateModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={28} /></button>
            </div>
            
            <div style={{ padding: 32 }}>
              {/* Type Switcher */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
                <button
                  onClick={() => setDispatchType('marketing')}
                  style={{
                    padding: '20px', borderRadius: 16, border: '2px solid', textAlign: 'center', transition: '0.2s',
                    background: dispatchType === 'marketing' ? 'rgba(56, 189, 248, 0.1)' : 'var(--bg-elevated)',
                    borderColor: dispatchType === 'marketing' ? '#0ea5e9' : 'var(--border)',
                    cursor: 'pointer'
                  }}
                >
                  <MessageCircle size={28} color={dispatchType === 'marketing' ? '#0ea5e9' : 'var(--text-muted)'} style={{ margin: '0 auto 12px' }} />
                  <div style={{ fontWeight: 700, color: dispatchType === 'marketing' ? 'var(--text-primary)' : 'var(--text-muted)' }}>Mensagem Personalizada</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>Disparo direto para listas de contatos</div>
                </button>
                <button
                  onClick={() => setDispatchType('devocional')}
                  style={{
                    padding: '20px', borderRadius: 16, border: '2px solid', textAlign: 'center', transition: '0.2s',
                    background: dispatchType === 'devocional' ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-elevated)',
                    borderColor: dispatchType === 'devocional' ? '#10b981' : 'var(--border)',
                    cursor: 'pointer'
                  }}
                >
                  <BookOpen size={28} color={dispatchType === 'devocional' ? '#10b981' : 'var(--text-muted)'} style={{ margin: '0 auto 12px' }} />
                  <div style={{ fontWeight: 700, color: dispatchType === 'devocional' ? 'var(--text-primary)' : 'var(--text-muted)' }}>Devocional Manual</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>Envio de teste com conteúdo do dia</div>
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div>
                  <label className="label-premium">Nome Identificador *</label>
                  <input
                    type="text" value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ex: Mensagem Especial de Segunda" className="input-dark"
                  />
                </div>

                <div>
                  <label className="label-premium">Lista de Destinatários *</label>
                  <select
                    value={formData.list_id}
                    onChange={(e) => setFormData({ ...formData, list_id: e.target.value })}
                    className="input-dark"
                  >
                    <option value="">Selecione a base de contatos...</option>
                    {lists.map(list => (
                      <option key={list.id} value={list.id}>{list.name} ({list.total_contacts} contatos)</option>
                    ))}
                  </select>
                </div>

                {dispatchType === 'marketing' && (
                  <>
                    <div>
                      <label className="label-premium">Conteúdo da Mensagem *</label>
                      <textarea
                        value={formData.message_template}
                        onChange={(e) => setFormData({ ...formData, message_template: e.target.value })}
                        placeholder="Olá {{name}}, como vai você?..."
                        style={{ minHeight: 120, resize: 'none' }} className="input-dark"
                      />
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>Use <code>{"{{name}}"}</code> para personalizar com o nome do contato.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="label-premium">Tipo de Anexo</label>
                        <select
                          value={formData.media_type || ''}
                          onChange={(e) => setFormData({ ...formData, media_type: e.target.value as any })}
                          className="input-dark"
                        >
                          <option value="">Apenas Texto</option>
                          <option value="image">Imagem</option>
                          <option value="video">Vídeo</option>
                          <option value="audio">Áudio (PTT)</option>
                          <option value="pdf">Documento PDF</option>
                        </select>
                      </div>
                      
                      {formData.media_type && (
                        <div>
                          <label className="label-premium">Upload de Arquivo</label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <input
                              type="file"
                              onChange={handleFileUpload}
                              className="input-dark"
                              disabled={loadingUpload}
                              accept={
                                formData.media_type === 'image' ? 'image/*' :
                                formData.media_type === 'video' ? 'video/*' :
                                formData.media_type === 'audio' ? 'audio/*' :
                                '.pdf,.doc,.docx'
                              }
                            />
                            {loadingUpload && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--gold-primary)' }}>
                                <RefreshCw size={14} className="animate-spin" /> Fazendo upload...
                              </div>
                            )}
                            {!loadingUpload && formData.media_url && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: '#34d399' }}>
                                <CheckCircle2 size={14} /> Arquivo pronto para envio ({formData.media_type})
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {formData.media_url && (
                      <div>
                        <label className="label-premium">URL do Arquivo (Automático)</label>
                        <input
                          type="url" value={formData.media_url}
                          onChange={(e) => setFormData({ ...formData, media_url: e.target.value })}
                          placeholder="https://exemplo.com/arquivo.mp4" className="input-dark"
                          readOnly
                        />
                      </div>
                    )}
                  </>
                )}
              </div>

              <div style={{ marginTop: 40, display: 'flex', gap: 16 }}>
                <button onClick={() => setShowCreateModal(false)} className="btn-outline" style={{ flex: 1, padding: '14px 0', borderRadius: 12 }}>Cancelar</button>
                <button
                  onClick={handleCreate} disabled={creatingDispatch}
                  className="btn-gold" style={{ flex: 1, padding: '14px 0', borderRadius: 12, border: 'none' }}
                >
                  {creatingDispatch ? 'Salvando...' : 'Salvar como pendente'}
                </button>
              </div>
              <p style={{ marginTop: 16, fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                O disparo fica pendente até você clicar em <strong>Iniciar</strong> na lista. Use <strong>Editar</strong> para ajustar texto ou lista antes do envio.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailDispatch && (
        <div className="modal-overlay">
          <div className="glass-card modal-overlay-panel" style={{ width: '100%', maxWidth: 800, maxHeight: 'min(85vh, 880px)', overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>{detailDispatch.name}</h3>
                <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Detalhes de entrega e logs</p>
              </div>
              <button onClick={() => setDetailDispatch(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={24} /></button>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 32px 32px' }}>
              {loadingDetail ? (
                <div style={{ padding: 100, textAlign: 'center' }}><RefreshCw size={32} className="animate-spin text-amber-500 mx-auto" /></div>
              ) : (
                <div style={{ marginTop: 24 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
                    <div style={{ padding: 16, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>{detailDispatch.total_contacts}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total</div>
                    </div>
                    <div style={{ padding: 16, borderRadius: 12, background: 'rgba(52, 211, 153, 0.05)', border: '1px solid rgba(52, 211, 153, 0.1)', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#34d399' }}>{detailDispatch.contacts_success}</div>
                      <div style={{ fontSize: '0.65rem', color: '#34d399', textTransform: 'uppercase' }}>Sucesso</div>
                    </div>
                    <div style={{ padding: 16, borderRadius: 12, background: 'rgba(251, 113, 133, 0.05)', border: '1px solid rgba(251, 113, 133, 0.1)', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fb7185' }}>{detailDispatch.contacts_failed}</div>
                      <div style={{ fontSize: '0.65rem', color: '#fb7185', textTransform: 'uppercase' }}>Falhas</div>
                    </div>
                    <div style={{ padding: 16, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>{Math.round((detailDispatch.contacts_success / (detailDispatch.total_contacts || 1)) * 100)}%</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Taxa</div>
                    </div>
                  </div>

                  <div style={{ border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '12px 20px', color: 'var(--text-secondary)' }}>Destinatário</th>
                          <th style={{ textAlign: 'left', padding: '12px 20px', color: 'var(--text-secondary)' }}>Status</th>
                          <th style={{ textAlign: 'left', padding: '12px 20px', color: 'var(--text-secondary)' }}>Horário</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailContacts.map(c => (
                          <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: '12px 20px' }}>
                              <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{c.contact_name || '—'}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.contact_number}</div>
                            </td>
                            <td style={{ padding: '12px 20px' }}>
                              {c.status === 'sent' || c.status === 'delivered' ? <span style={{ color: '#34d399' }}>✓ Enviado</span> : <span style={{ color: '#fb7185' }}>✗ Falhou</span>}
                              {c.failed_reason && <div style={{ fontSize: '0.7rem', color: '#fb7185' }}>{c.failed_reason}</div>}
                            </td>
                            <td style={{ padding: '12px 20px', color: 'var(--text-muted)' }}>
                              {c.sent_at ? new Date(c.sent_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ height: 60 }} />
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

function Info({ size, color, style }: { size: number, color?: string, style?: any }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
    </svg>
  );
}
