/**
 * Criar mensagem personalizada → pipeline oficial (dispatch + dispatch_items + worker).
 * Não envia direto; enfileira para o worker.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  ListOrdered,
  MessageCircle,
  RefreshCw,
  Send,
} from 'lucide-react';

interface ListRow {
  id: number;
  name: string;
  total_contacts?: number;
  list_type?: string;
}

interface AudienceSummary {
  total_potential: number;
  eligible_now: number;
  needs_whatsapp_validation: number;
}

interface CreateSuccess {
  dispatch: { id: number; name: string; status: string; total_contacts: number; dispatch_type: string };
  audience: AudienceSummary;
  items_enqueued: number;
  items_created: number;
  warning?: string | null;
  message?: string;
}

export default function MensagensPersonalizadas() {
  const navigate = useNavigate();
  const [lists, setLists] = useState<ListRow[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [success, setSuccess] = useState<CreateSuccess | null>(null);
  const [form, setForm] = useState({
    name: '',
    list_id: '',
    message_template: '',
  });

  useEffect(() => {
    (async () => {
      try {
        setLoadingLists(true);
        const { data } = await api.get('/lists');
        setLists(data.lists || []);
      } catch {
        setToast({ type: 'error', message: 'Erro ao carregar listas' });
      } finally {
        setLoadingLists(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleCreateAndEnqueue = async () => {
    if (submitting) return;
    if (!form.name.trim() || !form.list_id || !form.message_template.trim()) {
      setToast({ type: 'error', message: 'Preencha nome, lista e mensagem' });
      return;
    }
    try {
      setSubmitting(true);
      setSuccess(null);
      const { data } = await api.post('/dispatches/personalizada', {
        name: form.name.trim(),
        list_id: parseInt(form.list_id, 10),
        message_template: form.message_template,
      });
      setSuccess({
        dispatch: data.dispatch,
        audience: data.audience,
        items_enqueued: data.items_enqueued,
        items_created: data.items_created,
        warning: data.warning,
        message: data.message,
      });
      setToast({ type: 'success', message: 'Mensagem criada e enfileirada no worker' });
      setForm({ name: '', list_id: '', message_template: '' });
    } catch (error: any) {
      const aud = error.response?.data?.audience;
      const msg =
        error.response?.data?.error ||
        error.response?.data?.message ||
        'Erro ao criar e enfileirar';
      setToast({ type: 'error', message: msg });
      if (aud) {
        setSuccess({
          dispatch: { id: 0, name: form.name, status: 'failed', total_contacts: 0, dispatch_type: 'personalizada' },
          audience: aud,
          items_enqueued: 0,
          items_created: 0,
          warning: msg,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 18px',
            borderRadius: 12,
            background: toast.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)',
            border: `1px solid ${toast.type === 'success' ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)'}`,
            color: toast.type === 'success' ? '#34d399' : '#fb7185',
          }}
        >
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{toast.message}</span>
        </div>
      )}

      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #38bdf8, #0284c7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MessageCircle size={28} color="#fff" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.85rem', fontWeight: 800, fontFamily: 'Outfit, sans-serif', color: 'var(--text-primary)' }}>
            Mensagem personalizada
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Cria um disparo operacional, enfileira itens e o worker envia — não há envio direto.
          </p>
        </div>
      </div>

      <div
        className="glass-card"
        style={{
          padding: 20,
          marginBottom: 20,
          border: '1px solid rgba(56,189,248,0.25)',
          background: 'rgba(56,189,248,0.06)',
        }}
      >
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Pipeline oficial</div>
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          mensagem → público/lista → dispatch tipo <code>personalizada</code> → dispatch_items → Disparos → worker →
          Evolution (protegido).
        </p>
      </div>

      <div className="glass-card" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label className="label-premium">Nome do disparo *</label>
            <input
              className="input-dark"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex: Convite evento — março"
            />
          </div>
          <div>
            <label className="label-premium">Lista de destinatários *</label>
            <select
              className="input-dark"
              value={form.list_id}
              disabled={loadingLists}
              onChange={(e) => setForm({ ...form, list_id: e.target.value })}
            >
              <option value="">Selecione a lista…</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.total_contacts ?? 0} · {l.list_type || 'lista'})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-premium">Mensagem *</label>
            <textarea
              className="input-dark"
              style={{ minHeight: 140, resize: 'vertical' }}
              value={form.message_template}
              onChange={(e) => setForm({ ...form, message_template: e.target.value })}
              placeholder="Olá {{name}}, …"
            />
            <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Use <code>{'{{name}}'}</code> para o nome do contato. Pendentes de WhatsApp não entram na fila.
            </p>
          </div>

          <button
            type="button"
            className="btn-gold"
            disabled={submitting}
            onClick={handleCreateAndEnqueue}
            style={{
              padding: '14px 22px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              border: 'none',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
            {submitting ? 'Enfileirando…' : 'Criar e enfileirar'}
          </button>
        </div>
      </div>

      {success && (
        <div className="glass-card" style={{ padding: 24, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <ListOrdered size={20} color="#38bdf8" />
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
              Resultado do enfileiramento
            </h2>
          </div>

          {success.dispatch.id > 0 && (
            <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Dispatch <strong>#{success.dispatch.id}</strong> — {success.dispatch.name} · status{' '}
              <strong>{success.dispatch.status}</strong>
            </p>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            {[
              { label: 'Potencial', value: success.audience?.total_potential ?? '—' },
              { label: 'Elegíveis', value: success.audience?.eligible_now ?? '—' },
              { label: 'Pendentes WA', value: success.audience?.needs_whatsapp_validation ?? '—' },
              { label: 'Itens enfileirados', value: success.items_enqueued },
            ].map((c) => (
              <div
                key={c.label}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  {c.label}
                </div>
                <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>{c.value}</div>
              </div>
            ))}
          </div>

          {success.warning && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(245,158,11,0.1)',
                border: '1px solid rgba(245,158,11,0.35)',
                color: '#fcd34d',
                fontSize: '0.82rem',
                marginBottom: 14,
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              {success.warning}
            </div>
          )}

          {success.dispatch.id > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => navigate(`/dispatches?focus=${success.dispatch.id}`)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <ExternalLink size={16} /> Ver acompanhamento
              </button>
              <Link to="/dispatches" className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
                Ver em Disparos
              </Link>
            </div>
          )}
        </div>
      )}

      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        Acompanhe status e contadores em <Link to="/dispatches" style={{ color: '#7dd3fc' }}>Disparos</Link>. Operação
        Devocional permanece só para o fluxo diário — mensagens personalizadas não misturam lá.
      </p>
    </div>
  );
}
