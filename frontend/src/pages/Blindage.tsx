/**
 * Configurações do Worker — política operacional (não tabela de ENV).
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import api from '@/lib/api';
import Toast from '@/components/ui/Toast';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  RefreshCw,
  Server,
  Settings,
  Shield,
  ShieldAlert,
} from 'lucide-react';

type OperationalMode = 'blocked' | 'dry_run' | 'real_send' | 'invalid_config';

interface WorkerConfigPayload {
  operational_mode: OperationalMode;
  status_label: string;
  blocking_reasons: Array<{ code: string; message: string }>;
  can_send_real: boolean;
  safety_checks: {
    worker_enabled: boolean;
    real_send_enabled: boolean;
    dry_run_enabled: boolean;
    whatsapp_validation_on_prepare: boolean;
    whatsapp_validation_on_worker: boolean;
    has_pending_whatsapp_validation: boolean;
    all_current_dispatch_contacts_validated: boolean;
    pending_whatsapp_validation_count: number;
  };
  effective_policy: {
    min_delay_ms: number;
    max_delay_ms: number;
    send_timeout_ms: number;
    worker_batch_size: number;
    worker_interval_ms: number;
    cooldowns: {
      rate_limit_ms: number;
      forbidden_ms: number;
      server_error_ms: number;
      network_ms: number;
      default_ms: number;
    };
  };
  whatsapp_safety: {
    validation_on_prepare: boolean;
    validation_on_worker: boolean;
    pending_count: number;
    can_send_safely: boolean;
    all_current_dispatch_contacts_validated: boolean;
  };
  instances: {
    connected_count: number;
    items: Array<{
      id: number;
      instance_name: string;
      status: string;
      next_available_at?: string | null;
      last_sent_at?: string | null;
      cooldown_until?: string | null;
      daily_sent_count: number;
      hourly_sent_count: number;
      violation_count: number;
      phone_masked?: string | null;
    }>;
  };
  inherited_rules?: Array<{ id: number; rule_type: string; rule_name: string; enabled: boolean; note: string }>;
  deprecated_or_inactive_rules?: Array<{ id: number; rule_type: string; rule_name: string; note: string }>;
  technical_details?: {
    env_keys: Array<{ label: string; env_key: string; value: string | number | boolean }>;
  };
}

const modeMeta: Record<OperationalMode, { color: string; label: string }> = {
  blocked: { color: '#ef4444', label: 'Bloqueado' },
  dry_run: { color: '#f59e0b', label: 'Simulação' },
  real_send: { color: '#10b981', label: 'Envio real pronto' },
  invalid_config: { color: '#f97316', label: 'Configuração inválida' },
};

function msLabel(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 6000) / 10} min`;
  if (ms >= 1000) return `${Math.round(ms / 100) / 10} s`;
  return `${ms} ms`;
}

function formatTs(v?: string | null): string {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
}

function OnOff({ on }: { on: boolean }) {
  return (
    <span style={{ fontWeight: 800, color: on ? '#34d399' : '#f87171', fontFamily: 'Outfit, sans-serif' }}>
      {on ? 'Ligado' : 'Desligado'}
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 0',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        fontSize: '0.85rem',
      }}
    >
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

const sectionStyle: CSSProperties = {
  marginBottom: 18,
  padding: '16px 18px',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'rgba(255,255,255,0.02)',
};

export default function Blindage() {
  const [data, setData] = useState<WorkerConfigPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [techOpen, setTechOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const load = useCallback(async (silent?: boolean) => {
    try {
      if (!silent) setLoading(true);
      const { data: payload } = await api.get('/blindage/worker-config');
      setData(payload);
    } catch (error: any) {
      setToast({
        type: 'error',
        message: error.response?.data?.message || error.response?.data?.error || 'Erro ao carregar',
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return <div style={{ padding: 32, color: 'var(--text-secondary)' }}>Carregando política do worker…</div>;
  }

  const mode = data?.operational_mode || 'blocked';
  const meta = modeMeta[mode];
  const s = data?.safety_checks;
  const alerts: string[] = [];
  if (s?.real_send_enabled && s?.dry_run_enabled) {
    alerts.push('Envio real e simulação estão ligados juntos — configuração inválida.');
  }
  if (!s?.worker_enabled) alerts.push('Worker desligado.');
  if (!s?.whatsapp_validation_on_prepare && !s?.whatsapp_validation_on_worker) {
    alerts.push('Validação WhatsApp automática desligada.');
  }
  if (s?.has_pending_whatsapp_validation) {
    alerts.push(`${s.pending_whatsapp_validation_count} contato(s) pendente(s) de validação WhatsApp.`);
  }

  return (
    <div style={{ maxWidth: 880 }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #64748b, #334155)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Settings size={22} color="#e2e8f0" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.55rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
              Configurações do Worker
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Política operacional do motor de envio
            </p>
          </div>
        </div>
        <button type="button" className="btn-secondary" onClick={() => load()} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      {/* Status geral */}
      <div style={{ ...sectionStyle, borderColor: `${meta.color}55` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          {mode === 'real_send' ? <CheckCircle2 size={22} color={meta.color} /> : <ShieldAlert size={22} color={meta.color} />}
          <span style={{ fontSize: '1.2rem', fontWeight: 800, color: meta.color, fontFamily: 'Outfit, sans-serif' }}>
            {data?.status_label || meta.label}
          </span>
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Pode enviar com segurança (real):{' '}
          <strong style={{ color: data?.can_send_real ? '#34d399' : '#f87171' }}>
            {data?.can_send_real ? 'Sim' : 'Não'}
          </strong>
        </div>
      </div>

      {alerts.length > 0 && (
        <div style={{ marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alerts.map((a) => (
            <div
              key={a}
              style={{
                display: 'flex',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#fca5a5',
                fontSize: '0.85rem',
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              {a}
            </div>
          ))}
        </div>
      )}

      {(data?.blocking_reasons || []).length > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
            Motivos
          </div>
          {(data?.blocking_reasons || []).map((r) => (
            <div key={r.code} style={{ fontSize: '0.85rem', color: '#fcd34d', marginBottom: 6 }}>
              <strong>{r.code}</strong> — {r.message}
            </div>
          ))}
        </div>
      )}

      {/* Segurança WhatsApp */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Shield size={18} color="#fbbf24" />
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
            Segurança WhatsApp
          </h2>
        </div>
        <Row label="Validação no prepare" value={<OnOff on={!!data?.whatsapp_safety.validation_on_prepare} />} />
        <Row label="Validação no worker" value={<OnOff on={!!data?.whatsapp_safety.validation_on_worker} />} />
        <Row label="Pendentes WA no envio atual" value={data?.whatsapp_safety.pending_count ?? 0} />
        <Row
          label="Todos os elegíveis já validados"
          value={data?.whatsapp_safety.all_current_dispatch_contacts_validated ? 'Sim' : 'Não'}
        />
        <Row
          label="Pode enviar com segurança"
          value={
            <span style={{ color: data?.whatsapp_safety.can_send_safely ? '#34d399' : '#f87171', fontWeight: 800 }}>
              {data?.whatsapp_safety.can_send_safely ? 'Sim' : 'Não'}
            </span>
          }
        />
      </div>

      {/* Cadência */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Clock size={18} color="#38bdf8" />
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
            Cadência
          </h2>
        </div>
        <Row label="Delay mínimo" value={msLabel(data?.effective_policy.min_delay_ms ?? 0)} />
        <Row label="Delay máximo" value={msLabel(data?.effective_policy.max_delay_ms ?? 0)} />
        <Row label="Timeout de envio" value={msLabel(data?.effective_policy.send_timeout_ms ?? 0)} />
        <Row label="Lote do worker" value={data?.effective_policy.worker_batch_size ?? '—'} />
        <Row label="Intervalo do worker" value={msLabel(data?.effective_policy.worker_interval_ms ?? 0)} />
        <Row label="Cooldown (rate limit)" value={msLabel(data?.effective_policy.cooldowns.rate_limit_ms ?? 0)} />
        <Row label="Cooldown (403)" value={msLabel(data?.effective_policy.cooldowns.forbidden_ms ?? 0)} />
        <Row label="Cooldown (erro servidor)" value={msLabel(data?.effective_policy.cooldowns.server_error_ms ?? 0)} />
        <Row label="Cooldown (rede)" value={msLabel(data?.effective_policy.cooldowns.network_ms ?? 0)} />
      </div>

      {/* Instâncias */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Server size={18} color="#a78bfa" />
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
            Instâncias ({data?.instances.connected_count ?? 0} conectada(s))
          </h2>
        </div>
        {(data?.instances.items || []).length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Nenhuma instância.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>Instância</th>
                  <th style={{ padding: '6px 8px' }}>Status</th>
                  <th style={{ padding: '6px 8px' }}>Próximo envio</th>
                  <th style={{ padding: '6px 8px' }}>Cooldown</th>
                  <th style={{ padding: '6px 8px' }}>Dia / Hora</th>
                </tr>
              </thead>
              <tbody>
                {(data?.instances.items || []).map((i) => (
                  <tr key={i.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '8px', fontWeight: 600, color: 'var(--text-primary)' }}>{i.instance_name}</td>
                    <td style={{ padding: '8px', color: i.status === 'connected' ? '#34d399' : '#f87171' }}>{i.status}</td>
                    <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>{formatTs(i.next_available_at)}</td>
                    <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>{formatTs(i.cooldown_until)}</td>
                    <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>
                      {i.daily_sent_count} / {i.hourly_sent_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Herdadas (secundário) */}
      {(data?.inherited_rules || []).length > 0 && (
        <div style={{ ...sectionStyle, opacity: 0.85, borderStyle: 'dashed' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Regras herdadas
          </h2>
          <p style={{ margin: '0 0 10px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Só valem em mensagem avulsa — não governam o worker de campanha.
          </p>
          {(data?.inherited_rules || []).slice(0, 12).map((r) => (
            <div key={r.id} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>
              {r.rule_name} ({r.rule_type}) — {r.enabled ? 'ON' : 'OFF'}
            </div>
          ))}
        </div>
      )}

      {/* Detalhes técnicos */}
      <button
        type="button"
        onClick={() => setTechOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 14px',
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'transparent',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: '0.82rem',
          fontWeight: 600,
        }}
      >
        {techOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Detalhes técnicos
      </button>
      {techOpen && (
        <div style={{ ...sectionStyle, marginTop: 8 }}>
          {(data?.technical_details?.env_keys || []).map((e) => (
            <Row
              key={e.env_key}
              label={e.label}
              value={
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>
                  {e.env_key} = {String(e.value)}
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
