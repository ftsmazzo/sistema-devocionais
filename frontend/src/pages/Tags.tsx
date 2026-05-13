import { useEffect, useState } from 'react';
import api from '@/lib/api';
import {
  Tag as TagIcon,
  Plus,
  Edit,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Users,
} from 'lucide-react';

interface Tag {
  id: number;
  name: string;
  color: string;
  description?: string;
  category: string;
  total_contacts: number;
  created_at: string;
}

const DEFAULT_COLORS = [
  '#f59e0b', '#38bdf8', '#10b981', '#a78bfa', '#f43f5e',
  '#0ea5e9', '#8b5cf6', '#ec4899', '#f97316', '#2dd4bf'
];

export default function Tags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    color: '#f59e0b',
    description: '',
    category: 'custom',
  });

  useEffect(() => {
    loadTags();
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const loadTags = async () => {
    try {
      setLoading(true);
      const response = await api.get('/tags');
      setTags(response.data.tags);
    } catch (error: any) {
      console.error('Erro ao carregar tags:', error);
      setToast({ message: 'Erro ao carregar tags', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingTag) {
        await api.put(`/tags/${editingTag.id}`, formData);
        setToast({ message: 'Tag atualizada com sucesso!', type: 'success' });
      } else {
        await api.post('/tags', formData);
        setToast({ message: 'Tag criada com sucesso!', type: 'success' });
      }
      setShowModal(false);
      setEditingTag(null);
      setFormData({ name: '', color: '#f59e0b', description: '', category: 'custom' });
      loadTags();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao salvar tag', type: 'error' });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja deletar esta tag?')) return;
    try {
      await api.delete(`/tags/${id}`);
      setToast({ message: 'Tag deletada com sucesso!', type: 'success' });
      loadTags();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao deletar tag', type: 'error' });
    }
  };

  const handleEdit = (tag: Tag) => {
    setEditingTag(tag);
    setFormData({
      name: tag.name,
      color: tag.color,
      description: tag.description || '',
      category: tag.category,
    });
    setShowModal(true);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            border: '3px solid var(--gold-primary)', borderTopColor: 'transparent',
            animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
          }} />
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Sincronizando etiquetas...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          background: toast.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)',
          border: `1px solid ${toast.type === 'success' ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)'}`,
          color: toast.type === 'success' ? '#34d399' : '#fb7185',
          backdropFilter: 'blur(12px)',
        }}>
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.875rem', fontWeight: 500 }}>{toast.message}</span>
        </div>
      )}

      {/* Header Section */}
      <div style={{ marginBottom: 40 }}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 20px rgba(245, 158, 11, 0.3)',
              flexShrink: 0,
            }}>
              <TagIcon size={28} color="#0d0c14" strokeWidth={2} />
            </div>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em', fontFamily: 'Outfit, sans-serif' }}>
                Gestão de Tags
              </h1>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Organize e segmente sua base de contatos com inteligência.
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              setEditingTag(null);
              setFormData({ name: '', color: '#f59e0b', description: '', category: 'custom' });
              setShowModal(true);
            }}
            className="btn-gold"
            style={{ padding: '12px 24px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, border: 'none', cursor: 'pointer' }}
          >
            <Plus size={20} strokeWidth={3} />
            <span>Nova Tag</span>
          </button>
        </div>
      </div>

      {/* Tags Grid */}
      {tags.length === 0 ? (
        <div className="glass-card" style={{ padding: '80px 24px', textAlign: 'center' }}>
          <TagIcon size={64} color="var(--border)" strokeWidth={1} style={{ margin: '0 auto 24px' }} />
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Nenhuma tag encontrada</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>Crie etiquetas para começar a organizar seus contatos.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 24 }}>
          {tags.map(tag => (
            <div key={tag.id} className="glass-card hover-glow" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', background: `${tag.color}08`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: `${tag.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${tag.color}40` }}>
                    <TagIcon size={20} color={tag.color} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{tag.name}</h3>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tag.category}</span>
                  </div>
                </div>
                <div style={{ padding: '4px 10px', borderRadius: 100, background: 'rgba(255,255,255,0.05)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Users size={12} /> {tag.total_contacts}
                </div>
              </div>
              
              <div style={{ padding: 24, flex: 1 }}>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {tag.description || 'Nenhuma descrição fornecida para esta etiqueta.'}
                </p>
              </div>

              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, background: 'rgba(0,0,0,0.1)' }}>
                <button
                  onClick={() => handleEdit(tag)}
                  className="btn-outline"
                  style={{ flex: 1, padding: '8px 0', fontSize: '0.8rem', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <Edit size={14} /> Editar
                </button>
                {/* Apenas permite excluir se não for categoria protegida */}
                {!['devocional', 'bloqueado', 'teste'].includes(tag.category) ? (
                  <button
                    onClick={() => handleDelete(tag.id)}
                    style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(244, 63, 94, 0.1)', color: 'var(--rose)', border: '1px solid rgba(244, 63, 94, 0.2)', cursor: 'pointer' }}
                  >
                    <Trash2 size={14} />
                  </button>
                ) : (
                  <div style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'not-allowed', display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem' }} title="Tags de sistema não podem ser excluídas">
                    <Trash2 size={14} />
                    <span>Fixa</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal - Criar/Editar */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: 440, padding: 0, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
            <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit' }}>
                {editingTag ? 'Editar Tag' : 'Nova Tag'}
              </h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={24} /></button>
            </div>
            <form onSubmit={handleSubmit} style={{ padding: 32 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nome da Tag *</label>
                  <input
                    type="text" required value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ex: Cliente VIP, Interessado..."
                    style={{ width: '100%', padding: '12px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Identidade Visual (Cor)</label>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <input
                      type="color" value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      style={{ width: 56, height: 56, padding: 0, border: 'none', borderRadius: 12, background: 'none', cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {DEFAULT_COLORS.map(color => (
                        <button
                          key={color} type="button"
                          onClick={() => setFormData({ ...formData, color })}
                          style={{ width: 24, height: 24, borderRadius: 6, background: color, border: formData.color === color ? '2px solid #fff' : 'none', cursor: 'pointer' }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Descrição (Opcional)</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Para que serve esta etiqueta?"
                    style={{ width: '100%', padding: '12px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none', minHeight: 80, resize: 'none' }}
                  />
                </div>
              </div>

              <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
                <button type="button" onClick={() => setShowModal(false)} className="btn-outline" style={{ flex: 1, padding: '14px 0', borderRadius: 12 }}>Cancelar</button>
                <button type="submit" className="btn-gold" style={{ flex: 1, padding: '14px 0', borderRadius: 12 }}>{editingTag ? 'Salvar Alterações' : 'Criar Tag'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div style={{ height: 60 }} />
    </div>
  );
}

function X({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
