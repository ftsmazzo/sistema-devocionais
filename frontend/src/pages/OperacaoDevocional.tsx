import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import api from '@/lib/api';
import Toast from '@/components/ui/Toast';
import {
  Activity,
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock,
  List,
  RefreshCw,
  Server,
  Settings,
  ShieldAlert,
  Users,
} from 'lucide-react';

type OperationalMode = 'bloqueado' | 'dry_run' | 'envio_real' | 'config_invalida';

interface StatusPayload {
  date: string;
  timezone: string;
  operational_mode: OperationalMode;
  can_send_real?: boolean;
  cannot_send_reasons?: Array<{ code: string; message: string }>;
  pending_whatsapp_validation_count?: number;
  status_label?: string;
  config: {
    enabled: boolean;
    dispatch_hour: number;
    dispatch_minute: number;
    timezone: string;
    list_id?: number;
  } | null;
  list: { id: number; name: string; list_type: string; total_contacts_list?: number } | null;
  audience: {
    total_potential?: number;
    eligible_now?: number;
    needs_whatsapp_validation?: number;
    excluded_opt_out?: number;
    excluded_no_opt_in?: number;
    excluded_invalid_phone?: number;
    excluded_whatsapp_invalid?: number;
    excluded_by_score?: number;
    excluded_by_filter?: number;
    estimated_total?: number;
    estimated_eligible?: number;
  };
  audience_legacy?: { estimated_total: number; estimated_eligible: number };
  runtime: {
    worker_enabled: boolean;
    real_send_enabled: boolean;
    dry_run_enabled: boolean;
    batch_size: number;
    interval_ms: number;
  };
  instances: {
    connected_count: number;
    cooldown_count: number;
    items: Array<{
      id: number;
      instance_name: string;
      status: string;
      next_available_at?: string | null;
      cooldown_until?: string | null;
      last_error?: string | null;
      phone_masked?: string | null;
    }>;
  };
  next_dispatch: { next_at: string; is_today: boolean } | null;
  blocks: Array<{ code: string; message: string }>;
}

interface TodayPayload {
  date: string;
  devocional: {
    id: number;
    title: string;
    date: string;
    text_preview: string;
    versiculo_principal?: { texto?: string; referencia?: string };
  } | null;
  dispatch: {
    id: number;
    name: string;
    status: string;
    total_contacts: number;
    contacts_success: number;
    contacts_failed: number;
  } | null;
  items_summary: {
    total: number;
    pending: number;
    processing: number;
    sent: number;
    failed: number;
    skipped: number;
    pending_retry: number;
  } | null;
  dry_run_marked: number;
  recent_errors: Array<{
    id: number;
    contact_name?: string;
    contact_number_masked: string;
    status: string;
    error_category?: string;
    error_message?: string;
  }>;
  inconsistencies?: Array<{ code: string; message: string }>;
  next_items: Array<{
    id: number;
    contact_name?: string;
    contact_number_masked: string;
    status: string;
    next_retry_at?: string;
  }>;
  instances_guard: Array<{
    id: number;
    instance_name: string;
    next_available_at?: string | null;
    cooldown_until?: string | null;
  }>;
}

interface QueueItem {
  id: number;
  contact_name?: string;
  contact_number_masked: string;
  status: string;
  instance_name?: string;
  error_message?: string | null;
  sent_at?: string;
  failed_at?: string;
  next_retry_at?: string;
}

const modeLabel: Record<OperationalMode, string> = {
  bloqueado: 'Bloqueado',
  dry_run: 'Dry-run (sem Evolution)',
  envio_real: 'Envio real',
  config_invalida: 'Configuração inválida',
};

const modeColor: Record<OperationalMode, string> = {
  bloqueado: '#ef4444',
  dry_run: '#f59e0b',
  envio_real: '#10b981',
  config_invalida: '#f97316',
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function StatChip({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 14,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        minWidth: 110,
      }}
    >
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: '1.35rem', fontWeight: 800, color: tone || 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
        {value}
      </div>
    </div>
  );
}

export default function OperacaoDevocional() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [today, setToday] = useState<TodayPayload | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [prepareResult, setPrepareResult] = useState<any>(null);

  const loadAll = useCallback(async (silent?: boolean) => {
    try {
      if (!silent) setLoading(true);
      const [st, td, q] = await Promise.all([
        api.get('/devocional/operation/status'),
        api.get('/devocional/operation/today'),
        api.get('/devocional/operation/queue', { params: { page: 1, page_size: 30 } }),
      ]);
      setStatus(st.data);
      setToday(td.data);
      setQueue(q.data.items || []);
      setQueueTotal(q.data.total || 0);
    } catch (error: any) {
      setToast({
        type: 'error',
        message: error.response?.data?.message || error.response?.data?.error || 'Erro ao carregar operação',
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    const t = setInterval(() => loadAll(true), 30000);
    return () => clearInterval(t);
  }, [loadAll]);

  const handlePrepare = async () => {
    try {
      setPreparing(true);
      const { data } = await api.post('/devocional/operation/prepare-today');
      setPrepareResult(data);
      setToast({
        type: 'success',
        message: `Preparação ok: ${data.audience?.eligible ?? 0} elegíveis → ${data.items?.total ?? data.items?.created ?? 0} dispatch_items (novos: ${data.items?.created ?? 0}, sem envio).`,
      });
      await loadAll(true);
    } catch (error: any) {
      setToast({
        type: 'error',
        message: error.response?.data?.message || error.response?.data?.error || 'Falha ao preparar',
      });
    } finally {
      setPreparing(false);
    }
  };

  const labelStyle: CSSProperties = {
    fontSize: '0.7rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 8,
  };

  if (loading && !status) {
    return (
      <div style={{ minHeight: '48vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <RefreshCw className="h-9 w-9 animate-spin mx-auto mb-4" style={{ color: 'var(--gold-primary)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Carregando operação…</p>
        </div>
      </div>
    );
  }

  const mode = status?.operational_mode || 'bloqueado';
  const summary = today?.items_summary;
  const hour = status?.config ? `${pad2(status.config.dispatch_hour)}:${pad2(status.config.dispatch_minute)}` : '—';

  return (
    <div>
      <div style={{ marginBottom: 28, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: 'linear-gradient(135deg, #10b981, #059669)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(16, 185, 129, 0.25)',
            }}
          >
            <Activity size={28} color="#0d0c14" strokeWidth={2.5} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
              Operação Devocional
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Preparar público, fila e acompanhamento do envio de hoje. Configuração permanente fica em Config. Devocional.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link
            to="/devocional/config"
            className="btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}
          >
            <Settings size={16} />
            Ajustar Config. Devocional
          </Link>
          <button type="button" className="btn-secondary" onClick={() => loadAll()} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RefreshCw size={16} />
            Atualizar
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={preparing}
            onClick={handlePrepare}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            {preparing ? <RefreshCw size={16} className="animate-spin" /> : <List size={16} />}
            Preparar envio de hoje
          </button>
        </div>
      </div>

      {/* Modo / bloqueios */}
      <div className="glass-card" style={{ padding: 22, marginBottom: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={labelStyle}>Modo operacional</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 14px',
                  borderRadius: 999,
                  background: `${modeColor[mode]}22`,
                  color: modeColor[mode],
                  fontWeight: 700,
                  fontSize: '0.9rem',
                }}
              >
                {mode === 'bloqueado' ? <ShieldAlert size={16} /> : <CheckCircle2 size={16} />}
                {modeLabel[mode]}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{status?.date}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <span><Clock size={14} style={{ display: 'inline', marginRight: 6 }} />Horário {hour} ({status?.timezone})</span>
            <span><Users size={14} style={{ display: 'inline', marginRight: 6 }} />Lista: {status?.list?.name || '—'}</span>
            <span><Server size={14} style={{ display: 'inline', marginRight: 6 }} />Worker {status?.runtime.worker_enabled ? 'ON' : 'OFF'}</span>
          </div>
        </div>

        {status && status.blocks.length > 0 && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {status.blocks.map((b) => (
              <div
                key={b.code}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  color: '#fca5a5',
                  fontSize: '0.85rem',
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span><strong>{b.code}</strong> — {b.message}</span>
              </div>
            ))}
            {status.blocks.some((b) => ['NO_CONFIG', 'DISABLED', 'NO_LIST'].includes(b.code)) && (
              <Link
                to="/devocional/config"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 4,
                  color: 'var(--gold-primary)',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  textDecoration: 'none',
                }}
              >
                <Settings size={16} />
                Ajustar Config. Devocional
              </Link>
            )}
          </div>
        )}

        {today?.inconsistencies && today.inconsistencies.length > 0 && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Inconsistência da fila
            </div>
            {today.inconsistencies.map((inc) => (
              <div
                key={inc.code}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  color: '#fcd34d',
                  fontSize: '0.85rem',
                }}
              >
                <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span><strong>{inc.code}</strong> — {inc.message}</span>
              </div>
            ))}
          </div>
        )}

        {status?.next_dispatch && (
          <p style={{ margin: '14px 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Próximo horário agendado: <strong style={{ color: 'var(--text-secondary)' }}>{status.next_dispatch.next_at}</strong>
            {status.next_dispatch.is_today ? ' (hoje)' : ' (próximo dia)'}
          </p>
        )}
      </div>

      {/* Público estimado + fila */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 18 }}>
        <div className="glass-card" style={{ padding: 22 }}>
          <div style={labelStyle}>Público estimado (lista)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <StatChip label="Potenciais" value={status?.audience?.total_potential ?? status?.audience_legacy?.estimated_total ?? 0} />
            <StatChip label="Elegíveis agora" value={status?.audience?.eligible_now ?? status?.audience_legacy?.estimated_eligible ?? 0} tone="#10b981" />
            <StatChip label="Pendentes WA" value={status?.audience?.needs_whatsapp_validation ?? 0} tone="#f59e0b" />
            <StatChip label="WA inválido" value={status?.audience?.excluded_whatsapp_invalid ?? 0} tone="#ef4444" />
            <StatChip label="Opt-out" value={status?.audience?.excluded_opt_out ?? 0} tone="#ef4444" />
            <StatChip label="Sem opt-in" value={status?.audience?.excluded_no_opt_in ?? 0} />
            <StatChip label="Tel. inválido" value={status?.audience?.excluded_invalid_phone ?? 0} />
            <StatChip label="Pontuação/bloqueio" value={status?.audience?.excluded_by_score ?? status?.audience?.excluded_by_filter ?? 0} />
          </div>
          {prepareResult?.audience && (
            <div style={{ marginTop: 14, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Última preparação: {prepareResult.audience.eligible} elegíveis / {prepareResult.audience.excluded} excluídos
              {prepareResult.audience.exclusion_reasons && (
                <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>
                  {Object.entries(prepareResult.audience.exclusion_reasons).map(([k, v]) => (
                    <span key={k} style={{ marginRight: 10 }}>{k}: {String(v)}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="glass-card" style={{ padding: 22 }}>
          <div style={labelStyle}>Fila do dia (dispatch_items)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <StatChip label="Pendentes" value={summary?.pending ?? 0} />
            <StatChip label="Processando" value={summary?.processing ?? 0} tone="#34d399" />
            <StatChip label="Enviados" value={summary?.sent ?? 0} tone="#10b981" />
            <StatChip label="Falhas" value={summary?.failed ?? 0} tone="#ef4444" />
            <StatChip label="Dry-run" value={today?.dry_run_marked ?? 0} tone="#f59e0b" />
            <StatChip label="Retry" value={summary?.pending_retry ?? 0} />
          </div>
          {today?.dispatch && (
            <p style={{ margin: '12px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Dispatch #{today.dispatch.id} — status <strong>{today.dispatch.status}</strong>
            </p>
          )}
        </div>
      </div>

      {/* Devocional + instâncias */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 18 }}>
        <div className="glass-card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <BookOpen size={18} style={{ color: 'var(--gold-primary)' }} />
            <div style={{ ...labelStyle, marginBottom: 0 }}>Devocional de hoje</div>
          </div>
          {today?.devocional ? (
            <>
              <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {today.devocional.title}
              </h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {today.devocional.text_preview}
              </p>
            </>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Ainda não há devocional para hoje. Use “Preparar envio de hoje” para gerar/localizar.
            </p>
          )}
        </div>

        <div className="glass-card" style={{ padding: 22 }}>
          <div style={labelStyle}>Instâncias / cooldown</div>
          <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Conectadas: <strong>{status?.instances.connected_count ?? 0}</strong>
            {' · '}
            Em cooldown: <strong>{status?.instances.cooldown_count ?? 0}</strong>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
            {(status?.instances.items || []).map((inst) => (
              <div
                key={inst.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.03)',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {inst.instance_name}{' '}
                  <span style={{ color: inst.status === 'connected' ? '#10b981' : '#ef4444' }}>({inst.status})</span>
                </div>
                {inst.next_available_at && (
                  <div style={{ marginTop: 4 }}>next_available: {new Date(inst.next_available_at).toLocaleString('pt-BR')}</div>
                )}
                {inst.cooldown_until && (
                  <div>cooldown até: {new Date(inst.cooldown_until).toLocaleString('pt-BR')}</div>
                )}
                {inst.last_error && <div style={{ color: '#fca5a5', marginTop: 4 }}>{inst.last_error}</div>}
              </div>
            ))}
            {(status?.instances.items || []).length === 0 && (
              <p style={{ color: 'var(--text-muted)' }}>Nenhuma instância cadastrada.</p>
            )}
          </div>
        </div>
      </div>

      {/* Erros + fila */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 18 }}>
        <div className="glass-card" style={{ padding: 22 }}>
          <div style={labelStyle}>Últimos erros</div>
          {(today?.recent_errors || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Nenhum erro recente.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
              {today!.recent_errors.map((e) => (
                <div key={e.id} style={{ fontSize: '0.8rem', padding: '8px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.06)' }}>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                    {e.contact_name || '—'} · {e.contact_number_masked}
                  </div>
                  <div style={{ color: '#fca5a5' }}>{e.error_category}: {e.error_message}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-card" style={{ padding: 22 }}>
          <div style={labelStyle}>Itens da fila ({queueTotal})</div>
          {queue.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Fila vazia. Prepare o envio de hoje.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>Contato</th>
                    <th style={{ padding: '6px 8px' }}>Status</th>
                    <th style={{ padding: '6px 8px' }}>Instância</th>
                    <th style={{ padding: '6px 8px' }}>Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((item) => (
                    <tr key={item.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <td style={{ padding: '8px', color: 'var(--text-primary)' }}>
                        {item.contact_name || '—'}
                        <div style={{ color: 'var(--text-muted)' }}>{item.contact_number_masked}</div>
                      </td>
                      <td style={{ padding: '8px' }}>{item.status}</td>
                      <td style={{ padding: '8px' }}>{item.instance_name || '—'}</td>
                      <td style={{ padding: '8px', color: '#fca5a5', maxWidth: 180 }}>{item.error_message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Esta tela não dispara WhatsApp. O cron e o worker processam a fila conforme as variáveis
        DISPATCH_WORKER_ENABLED / DISPATCH_REAL_SEND_ENABLED / DISPATCH_DRY_RUN_ENABLED.
      </p>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
