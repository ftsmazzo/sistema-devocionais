/**
 * Configurações do Worker — diagnóstico do motor de envio.
 * Caminho real: dispatch_items → dispatchWorker → evolutionSafeSender → instance_send_guard.
 * Sem botão de envio/teste. Flags ENV = somente leitura.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import api from '@/lib/api';
import Toast from '@/components/ui/Toast';
import {
  Activity,
  AlertCircle,
  Clock,
  RefreshCw,
  Server,
  Settings,
  Shield,
  ShieldAlert,
} from 'lucide-react';

interface ConfigEntry {
  key: string;
  label: string;
  value: string | number | boolean | null;
  source: 'env' | 'database' | 'runtime';
  editable: boolean;
  classification: string;
  note?: string;
}

interface InstanceGuard {
  id: number;
  instance_name: string;
  name?: string;
  status: string;
  health_status?: string;
  phone_masked?: string | null;
  next_available_at?: string | null;
  last_sent_at?: string | null;
  cooldown_until?: string | null;
  daily_sent_count: number;
  hourly_sent_count: number;
  violation_count: number;
  last_error?: string | null;
}

interface InheritedRule {
  id: number;
  rule_type: string;
  rule_name: string;
  enabled: boolean;
  instance_id: number | null;
  instance_name: string | null;
  config_summary: Record<string, unknown>;
  note: string;
}

interface DeprecatedRule {
  id: number;
  rule_type: string;
  rule_name: string;
  enabled: boolean;
  note: string;
}

interface WorkerConfigPayload {
  path: string;
  runtime: ConfigEntry[];
  cadence: ConfigEntry[];
  whatsapp_validation: ConfigEntry[];
  instances: InstanceGuard[];
  inherited_rules: InheritedRule[];
  deprecated_or_inactive_rules: DeprecatedRule[];
  note?: string;
}

const labelStyle: CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 700,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 10,
};

function formatVal(v: string | number | boolean | null): string {
  if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
  if (v == null) return '—';
  return String(v);
}

function formatTs(v?: string | null): string {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('pt-BR');
  } catch {
    return String(v);
  }
}

function FlagRow({ entry }: { entry: ConfigEntry }) {
  const on = entry.value === true;
  const off = entry.value === false;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(160px, 1.4fr) minmax(90px, 0.6fr) 70px',
        gap: 10,
        alignItems: 'center',
        padding: '8px 0',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        fontSize: '0.82rem',
      }}
    >
      <div>
        <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{entry.label}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace' }}>
          {entry.key}
        </div>
      </div>
      <div
        style={{
          fontWeight: 800,
          fontFamily: 'Outfit, sans-serif',
          color: on ? '#34d399' : off ? '#f87171' : 'var(--text-primary)',
        }}
      >
        {formatVal(entry.value)}
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'right' }}>
        {entry.source}
        {!entry.editable ? ' · RO' : ''}
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
  muted,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <section
      style={{
        marginBottom: 22,
        padding: '18px 20px',
        borderRadius: 12,
        border: muted ? '1px dashed rgba(255,255,255,0.12)' : '1px solid var(--border)',
        background: muted ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.02)',
        opacity: muted ? 0.92 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        {icon}
        <h2
          style={{
            margin: 0,
            fontSize: '1rem',
            fontWeight: 800,
            color: muted ? 'var(--text-secondary)' : 'var(--text-primary)',
            fontFamily: 'Outfit, sans-serif',
          }}
        >
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

export default function Blindage() {
  const [data, setData] = useState<WorkerConfigPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const load = useCallback(async (silent?: boolean) => {
    try {
      if (!silent) setLoading(true);
      const { data: payload } = await api.get('/blindage/worker-config');
      setData(payload);
    } catch (error: any) {
      setToast({
        type: 'error',
        message: error.response?.data?.message || error.response?.data?.error || 'Erro ao carregar configurações',
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <div style={{ padding: 40, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        Carregando configurações do worker…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960 }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div style={{ marginBottom: 22, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #64748b, #334155)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Settings size={24} color="#e2e8f0" strokeWidth={2.2} />
          </div>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: '1.65rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                fontFamily: 'Outfit, sans-serif',
              }}
            >
              Configurações do Worker
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>
              {data?.path || 'dispatch_items → worker → guard → Evolution'}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => load()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <RefreshCw size={16} />
          Atualizar
        </button>
      </div>

      <div
        style={{
          marginBottom: 18,
          padding: '10px 12px',
          borderRadius: 10,
          border: '1px solid rgba(148, 163, 184, 0.25)',
          background: 'rgba(148, 163, 184, 0.08)',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
        }}
      >
        <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2, color: '#94a3b8' }} />
        <span>
          Flags com source=<strong>env</strong> são somente leitura (redeploy). Esta tela não dispara envio.
        </span>
      </div>

      <Section title="Runtime" icon={<Activity size={18} color="#34d399" />}>
        <div style={labelStyle}>DISPATCH_*</div>
        {(data?.runtime || []).map((e) => (
          <FlagRow key={e.key + e.label} entry={e} />
        ))}
      </Section>

      <Section title="Cadência" icon={<Clock size={18} color="#38bdf8" />}>
        <div style={labelStyle}>Guard Evolution (ENV)</div>
        {(data?.cadence || []).map((e) => (
          <FlagRow key={e.key + e.label} entry={e} />
        ))}
      </Section>

      <Section title="Validação WhatsApp" icon={<Shield size={18} color="#fbbf24" />}>
        <div style={labelStyle}>WHATSAPP_*</div>
        {(data?.whatsapp_validation || []).map((e) => (
          <FlagRow key={e.key} entry={e} />
        ))}
      </Section>

      <Section title="Instâncias e cooldown" icon={<Server size={18} color="#a78bfa" />}>
        <div style={labelStyle}>instance_send_guard</div>
        {(data?.instances || []).length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Nenhuma instância.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>Instância</th>
                  <th style={{ padding: '6px 8px' }}>Status</th>
                  <th style={{ padding: '6px 8px' }}>Next avail.</th>
                  <th style={{ padding: '6px 8px' }}>Last sent</th>
                  <th style={{ padding: '6px 8px' }}>Cooldown</th>
                  <th style={{ padding: '6px 8px' }}>Dia / Hora</th>
                  <th style={{ padding: '6px 8px' }}>Viol.</th>
                </tr>
              </thead>
              <tbody>
                {(data?.instances || []).map((i) => (
                  <tr key={i.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '8px', color: 'var(--text-primary)', fontWeight: 600 }}>
                      {i.instance_name}
                      {i.phone_masked ? (
                        <div style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.7rem' }}>{i.phone_masked}</div>
                      ) : null}
                    </td>
                    <td style={{ padding: '8px', color: i.status === 'connected' ? '#34d399' : '#f87171' }}>{i.status}</td>
                    <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>{formatTs(i.next_available_at)}</td>
                    <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>{formatTs(i.last_sent_at)}</td>
                    <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>{formatTs(i.cooldown_until)}</td>
                    <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>
                      {i.daily_sent_count} / {i.hourly_sent_count}
                    </td>
                    <td style={{ padding: '8px', color: i.violation_count > 0 ? '#fbbf24' : 'var(--text-muted)' }}>
                      {i.violation_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Regras herdadas" icon={<ShieldAlert size={18} color="#94a3b8" />} muted>
        <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Compatibilidade · só se <code>applyBlindage</code> for chamado (mensagem avulsa). Não governa o worker de campanha.
        </p>
        {(data?.inherited_rules || []).length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Nenhuma regra herdada.</p>
        ) : (
          (data?.inherited_rules || []).map((r) => (
            <div
              key={r.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: 10,
                padding: '8px 0',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                fontSize: '0.8rem',
              }}
            >
              <div>
                <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {r.rule_name}{' '}
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 400, color: 'var(--text-muted)' }}>
                    ({r.rule_type})
                  </span>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {r.instance_id == null ? 'global' : r.instance_name || `inst #${r.instance_id}`}
                </div>
              </div>
              <span style={{ color: r.enabled ? '#86efac' : '#f87171', fontWeight: 700 }}>
                {r.enabled ? 'ON' : 'OFF'}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>compat</span>
            </div>
          ))
        )}
      </Section>

      <Section title="Regras removidas / inativas" icon={<AlertCircle size={18} color="#78716c" />} muted>
        <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Sem efeito no caminho real de campanha (ex.: dispatch_pacing).
        </p>
        {(data?.deprecated_or_inactive_rules || []).length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Nenhuma.</p>
        ) : (
          (data?.deprecated_or_inactive_rules || []).map((r) => (
            <div
              key={r.id}
              style={{
                padding: '8px 0',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
              }}
            >
              <strong style={{ color: 'var(--text-secondary)' }}>{r.rule_type}</strong> — {r.rule_name}{' '}
              ({r.enabled ? 'enabled' : 'disabled'})
              <div style={{ fontSize: '0.72rem', marginTop: 2 }}>{r.note}</div>
            </div>
          ))
        )}
      </Section>
    </div>
  );
}
