import { useEffect, useState } from 'react';
import api from '@/lib/api';
import Toast from '@/components/ui/Toast';
import Switch from '@/components/ui/Switch';
import {
  List,
  Plus,
  Edit,
  Trash2,
  Users,
  Filter,
  RefreshCw,
  Eye,
  X,
} from 'lucide-react';

interface ContactList {
  id: number;
  name: string;
  description?: string;
  list_type: 'static' | 'dynamic' | 'hybrid';
  filter_config: any;
  total_contacts: number;
  static_contacts_count: number;
  created_by?: number;
  created_at: string;
}

interface Tag {
  id: number;
  name: string;
  color: string;
}

export default function Lists() {
  const [lists, setLists] = useState<ContactList[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewContacts, setPreviewContacts] = useState<any[]>([]);
  const [editingList, setEditingList] = useState<ContactList | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    list_type: 'static' as 'static' | 'dynamic' | 'hybrid',
    filter_config: {
      tags: [] as number[],
      exclude_tags: [] as number[],
      opt_in: undefined as boolean | undefined,
      opt_out: undefined as boolean | undefined,
      whatsapp_validated: undefined as boolean | undefined,
    },
  });

  useEffect(() => {
    loadLists();
    loadTags();
  }, []);

  const loadLists = async () => {
    try {
      setLoading(true);
      const response = await api.get('/lists');
      const raw = response.data.lists || [];
      const sorted = [...raw].sort((a: any, b: any) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      });
      setLists(sorted);
    } catch (error: any) {
      console.error('Erro ao carregar listas:', error);
      setToast({
        message: 'Erro ao carregar listas',
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadTags = async () => {
    try {
      const response = await api.get('/tags');
      setTags(response.data.tags);
    } catch (error) {
      console.error('Erro ao carregar tags:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      
      // Validar se lista dinâmica tem pelo menos uma tag selecionada
      if ((formData.list_type === 'dynamic' || formData.list_type === 'hybrid') && 
          (!formData.filter_config.tags || formData.filter_config.tags.length === 0)) {
        setToast({
          message: 'Listas dinâmicas precisam ter pelo menos uma tag selecionada',
          type: 'error'
        });
        setLoading(false);
        return;
      }

      if (editingList) {
        await api.put(`/lists/${editingList.id}`, formData);
        setToast({ message: 'Lista atualizada com sucesso!', type: 'success' });
      } else {
        const response = await api.post('/lists', formData);
        const createdList = response.data.list;
        setToast({ 
          message: `Lista criada com sucesso! ${createdList.total_contacts || 0} contatos encontrados.`, 
          type: 'success' 
        });
      }
      setShowModal(false);
      setEditingList(null);
      setFormData({
        name: '',
        description: '',
        list_type: 'static',
        filter_config: {
          tags: [],
          exclude_tags: [],
          opt_in: undefined,
          opt_out: undefined,
          whatsapp_validated: undefined,
        },
      });
      await loadLists();
    } catch (error: any) {
      console.error('Erro ao salvar lista:', error);
      setToast({
        message: error.response?.data?.error || error.response?.data?.message || 'Erro ao salvar lista',
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja deletar esta lista?')) return;
    try {
      await api.delete(`/lists/${id}`);
      setToast({ message: 'Lista deletada com sucesso!', type: 'success' });
      loadLists();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao deletar lista',
        type: 'error'
      });
    }
  };

  const handleEdit = (list: ContactList) => {
    setEditingList(list);
    setFormData({
      name: list.name,
      description: list.description || '',
      list_type: list.list_type,
      filter_config: list.filter_config || {
        tags: [],
        exclude_tags: [],
        opt_in: undefined,
        opt_out: undefined,
        whatsapp_validated: undefined,
      },
    });
    setShowModal(true);
  };

  const handlePreview = async (id: number) => {
    try {
      const response = await api.get(`/lists/${id}/preview?limit=10`);
      setPreviewContacts(response.data.contacts);
      setShowPreview(true);
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao fazer preview',
        type: 'error'
      });
    }
  };

  const handleRefresh = async (id: number) => {
    try {
      await api.post(`/lists/${id}/refresh`);
      setToast({ message: 'Lista atualizada com sucesso!', type: 'success' });
      loadLists();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao atualizar lista',
        type: 'error'
      });
    }
  };

  const getListTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      static: 'Estática',
      dynamic: 'Dinâmica',
      hybrid: 'Híbrida'
    };
    return labels[type] || type;
  };

  const getListTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      static: 'from-blue-500 to-cyan-500',
      dynamic: 'from-purple-500 to-pink-500',
      hybrid: 'from-green-500 to-emerald-500'
    };
    return colors[type] || 'from-gray-500 to-gray-600';
  };

  const listTypeHeaderBg = (type: string) => {
    const m: Record<string, string> = {
      static: 'linear-gradient(135deg, rgba(14, 165, 233, 0.22) 0%, rgba(6, 182, 212, 0.06) 100%)',
      dynamic: 'linear-gradient(135deg, rgba(168, 85, 247, 0.26) 0%, rgba(236, 72, 153, 0.08) 100%)',
      hybrid: 'linear-gradient(135deg, rgba(16, 185, 129, 0.22) 0%, rgba(5, 150, 105, 0.07) 100%)',
    };
    return m[type] ?? 'linear-gradient(135deg, rgba(71, 85, 105, 0.2), rgba(30, 41, 59, 0.15))';
  };

  return (
    <div>
      <style>{`
        .lists-label {
          display: block;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        @media (max-width: 520px) {
          .lists-type-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(124, 58, 237, 0.25)',
            }}>
              <List size={28} color="#0d0c14" strokeWidth={2.5} />
            </div>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em', fontFamily: 'Outfit, sans-serif' }}>
                Listas de contatos
              </h1>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Crie listas estáticas, dinâmicas ou híbridas para seus disparos.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setEditingList(null);
              setFormData({
                name: '',
                description: '',
                list_type: 'static',
                filter_config: {
                  tags: [],
                  exclude_tags: [],
                  opt_in: undefined,
                  opt_out: undefined,
                  whatsapp_validated: undefined,
                },
              });
              setShowModal(true);
            }}
            className="btn-gold"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem' }}
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} />
            Nova lista
          </button>
        </div>
      </div>

      {/* Lista de Listas */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-2 border-transparent border-t-amber-500 border-r-amber-500/40 mx-auto mb-4" />
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Carregando listas…</p>
          </div>
        </div>
      ) : lists.length === 0 ? (
        <div className="glass-card" style={{ padding: 48, textAlign: 'center' }}>
          <List className="h-16 w-16 mx-auto mb-4" style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>Nenhuma lista encontrada</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: '0.9rem' }}>Crie sua primeira lista de contatos.</p>
          <button
            type="button"
            onClick={() => {
              setEditingList(null);
              setFormData({
                name: '',
                description: '',
                list_type: 'static',
                filter_config: {
                  tags: [],
                  exclude_tags: [],
                  opt_in: undefined,
                  opt_out: undefined,
                  whatsapp_validated: undefined,
                },
              });
              setShowModal(true);
            }}
            className="btn-gold"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700 }}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Criar lista
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {lists.map((list) => (
            <div key={list.id} className="glass-card" style={{ overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  padding: '20px 22px',
                  background: listTypeHeaderBg(list.list_type),
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
                  {list.name}
                </h3>
                <div style={{ marginTop: 10 }}>
                  <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-bold bg-gradient-to-r ${getListTypeColor(list.list_type)} text-white shadow-sm`}>
                    {getListTypeLabel(list.list_type)}
                  </span>
                </div>
                {list.description ? (
                  <p style={{ margin: '12px 0 0', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                    {list.description}
                  </p>
                ) : null}
              </div>
              <div style={{ padding: 22, flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                    <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Users className="h-4 w-4" />
                      Total de contatos
                    </span>
                    <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{list.total_contacts || 0}</span>
                  </div>
                  {list.list_type === 'hybrid' && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Contatos estáticos</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{list.static_contacts_count || 0}</span>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
                  <button
                    type="button"
                    className="btn-outline"
                    style={{ flex: '1 1 100px', minHeight: 40, borderRadius: 10, fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}
                    onClick={() => handlePreview(list.id)}
                  >
                    <Eye className="h-4 w-4" />
                    Preview
                  </button>
                  {(list.list_type === 'dynamic' || list.list_type === 'hybrid') && (
                    <button
                      type="button"
                      className="btn-outline"
                      style={{ minWidth: 44, minHeight: 40, borderRadius: 10, padding: '0 12px', cursor: 'pointer', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.35)' }}
                      onClick={() => handleRefresh(list.id)}
                      title="Atualizar lista"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-outline"
                    style={{ minWidth: 44, minHeight: 40, borderRadius: 10, padding: '0 12px', cursor: 'pointer' }}
                    onClick={() => handleEdit(list)}
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="btn-outline"
                    style={{ minWidth: 44, minHeight: 40, borderRadius: 10, padding: '0 12px', cursor: 'pointer', color: '#fb7185', borderColor: 'rgba(244, 63, 94, 0.25)' }}
                    onClick={() => handleDelete(list.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Criar/Editar — tema escuro alinhado ao restante do app */}
      {showModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-overlay-panel" style={{ width: '100%', maxWidth: 640, padding: 0, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
            <div style={{ padding: '22px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(16, 185, 129, 0.08)' }}>
              <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
                {editingList ? 'Editar Lista' : 'Nova Lista'}
              </h2>
              <button
                type="button"
                onClick={() => { setShowModal(false); setEditingList(null); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                aria-label="Fechar"
              >
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleSubmit} style={{ padding: 28 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <div>
                  <label className="lists-label">Nome *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Nome da lista"
                    required
                    className="input-dark"
                    style={{ width: '100%', padding: '12px 16px' }}
                  />
                </div>
                <div>
                  <label className="lists-label">Descrição</label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Descrição opcional"
                    className="input-dark"
                    style={{ width: '100%', padding: '12px 16px' }}
                  />
                </div>

                <div>
                  <label className="lists-label">Tipo de lista *</label>
                  <div className="lists-type-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 8 }}>
                    {(['static', 'dynamic', 'hybrid'] as const).map((type) => {
                      const selected = formData.list_type === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setFormData({ ...formData, list_type: type })}
                          style={{
                            padding: '14px 12px',
                            borderRadius: 12,
                            border: selected ? '2px solid var(--gold-primary)' : '1px solid var(--border)',
                            background: selected ? 'rgba(245, 158, 11, 0.12)' : 'var(--bg-elevated)',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'border-color 0.2s, background 0.2s',
                          }}
                        >
                          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                            {getListTypeLabel(type)}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                            {type === 'static' && 'Contatos fixos'}
                            {type === 'dynamic' && 'Baseada em filtros'}
                            {type === 'hybrid' && 'Estática + dinâmica'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {(formData.list_type === 'dynamic' || formData.list_type === 'hybrid') && (
                  <div style={{ paddingTop: 20, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Filter size={18} color="var(--text-muted)" />
                      <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>Filtros</h3>
                    </div>

                    <div>
                      <label className="lists-label">Tags (incluir)</label>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '6px 0 10px', lineHeight: 1.45 }}>
                        Contatos que tenham pelo menos uma das tags selecionadas entram na lista.
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)', minHeight: 56 }}>
                        {tags.length === 0 ? (
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Nenhuma tag. Crie na página Tags.</span>
                        ) : (
                          tags.map((tag) => {
                            const isSelected = formData.filter_config.tags?.includes(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => {
                                  const current = formData.filter_config.tags || [];
                                  if (isSelected) {
                                    setFormData({
                                      ...formData,
                                      filter_config: { ...formData.filter_config, tags: current.filter((id) => id !== tag.id) },
                                    });
                                  } else {
                                    setFormData({
                                      ...formData,
                                      filter_config: { ...formData.filter_config, tags: [...current, tag.id] },
                                    });
                                  }
                                }}
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: 8,
                                  fontSize: '0.8rem',
                                  fontWeight: 600,
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: isSelected ? '#fff' : 'var(--text-secondary)',
                                  background: isSelected ? tag.color : 'rgba(255,255,255,0.06)',
                                  boxShadow: isSelected ? '0 2px 8px rgba(0,0,0,0.25)' : undefined,
                                }}
                              >
                                {isSelected ? '✓ ' : ''}{tag.name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="lists-label">Tags (excluir)</label>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '6px 0 10px', lineHeight: 1.45 }}>
                        Contatos com qualquer uma destas tags ficam de fora.
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)', minHeight: 56 }}>
                        {tags.length === 0 ? (
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Nenhuma tag.</span>
                        ) : (
                          tags.map((tag) => {
                            const isSelected = formData.filter_config.exclude_tags?.includes(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => {
                                  const current = formData.filter_config.exclude_tags || [];
                                  if (isSelected) {
                                    setFormData({
                                      ...formData,
                                      filter_config: { ...formData.filter_config, exclude_tags: current.filter((id) => id !== tag.id) },
                                    });
                                  } else {
                                    setFormData({
                                      ...formData,
                                      filter_config: { ...formData.filter_config, exclude_tags: [...current, tag.id] },
                                    });
                                  }
                                }}
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: 8,
                                  fontSize: '0.8rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  border: isSelected ? '2px solid #fb7185' : '1px solid var(--border)',
                                  color: isSelected ? '#fb7185' : 'var(--text-secondary)',
                                  background: isSelected ? 'rgba(244, 63, 94, 0.1)' : 'rgba(255,255,255,0.04)',
                                }}
                              >
                                {isSelected ? '✕ ' : ''}{tag.name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div style={{ padding: 14, borderRadius: 12, border: '1px solid rgba(56, 189, 248, 0.35)', background: 'rgba(56, 189, 248, 0.08)', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>Validação e disparos</strong>
                      <p style={{ margin: '8px 0 0' }}>
                        Disparos usam contatos com WhatsApp validado, opt-in e sem opt-out. Revalide números na página Contatos se necessário.
                      </p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.88rem', color: 'var(--text-primary)', fontWeight: 500 }}>Apenas opt-in</span>
                        <Switch
                          checked={formData.filter_config.opt_in === true}
                          onCheckedChange={(checked) =>
                            setFormData({
                              ...formData,
                              filter_config: { ...formData.filter_config, opt_in: checked ? true : undefined },
                            })
                          }
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.88rem', color: 'var(--text-primary)', fontWeight: 500 }}>Apenas WhatsApp validado</span>
                        <Switch
                          checked={formData.filter_config.whatsapp_validated === true}
                          onCheckedChange={(checked) =>
                            setFormData({
                              ...formData,
                              filter_config: { ...formData.filter_config, whatsapp_validated: checked ? true : undefined },
                            })
                          }
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.88rem', color: 'var(--text-primary)', fontWeight: 500 }}>Excluir opt-out</span>
                        <Switch
                          checked={formData.filter_config.opt_out === false}
                          onCheckedChange={(checked) =>
                            setFormData({
                              ...formData,
                              filter_config: { ...formData.filter_config, opt_out: checked ? false : undefined },
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 12, paddingTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => { setShowModal(false); setEditingList(null); }}
                    className="btn-outline"
                    style={{ flex: 1, padding: '14px 0', borderRadius: 12, cursor: 'pointer' }}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="btn-gold" style={{ flex: 1, padding: '14px 0', borderRadius: 12, border: 'none', cursor: 'pointer' }}>
                    {editingList ? 'Atualizar' : 'Criar'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Preview */}
      {showPreview && (
        <div className="modal-overlay">
          <div className="glass-card modal-overlay-panel" style={{ width: '100%', maxWidth: 560, padding: 0, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
            <div style={{ padding: '22px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(16, 185, 129, 0.08)' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
                Preview de contatos
              </h2>
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                aria-label="Fechar"
              >
                <X size={24} />
              </button>
            </div>
            <div style={{ padding: 24, maxHeight: 'min(70vh, 420px)', overflowY: 'auto' }}>
              {previewContacts.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0', margin: 0 }}>Nenhum contato encontrado</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {previewContacts.map((contact: any) => (
                    <div
                      key={contact.id}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-elevated)',
                      }}
                    >
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{contact.name || 'Sem nome'}</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: 4 }}>{contact.phone_number}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn-outline" style={{ width: '100%', padding: '12px 0', borderRadius: 12, cursor: 'pointer' }} onClick={() => setShowPreview(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
