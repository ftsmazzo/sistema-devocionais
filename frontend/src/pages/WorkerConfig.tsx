/**
 * Configurações do Worker — tela operacional (banco), sem legado de regras.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import api from '@/lib/api';
import Toast from '@/components/ui/Toast';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Lock,
  RefreshCw,
  Save,
  Server,
  Settings,
  Shield,
  ShieldAlert,
} from 'lucide-react';

type OperationalMode = 'blocked' | 'dry_run' | 'real_send' | 'invalid_config';
type ProfileId = 'simulacao' | 'conservador' | 'moderado' | string;

interface EditableConfig {
  enabled: boolean;
  real_send_enabled: boolean;
  dry_run_enabled: boolean;
  whatsapp_auto_validate_on_prepare: boolean;
  whatsapp_auto_validate_on_worker: boolean;
  whatsapp_validation_batch_size: number;
  min_delay_ms: number;
  max_delay_ms: number;
  send_timeout_ms: number;
  worker_batch_size: number;
  worker_interval_ms: number;
  cooldown_rate_limit_ms: number;
  cooldown_forbidden_ms: number;
  cooldown_5xx_ms: number;
  cooldown_network_ms: number;
  cooldown_default_ms: number;
  profile: ProfileId;
}

interface WorkerConfigPayload {
  operational_mode: OperationalMode;
  status_label: string;
  blocking_reasons: Array<{ code: string; message: string }>;
  can_send_real: boolean;
  config: EditableConfig;
  locked_fields?: string[];
  profiles?: Array<{ id: string; label: string; description: string }>;
  whatsapp_safety: {
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
      cooldown_until?: string | null;
      daily_sent_count: number;
      hourly_sent_count: number;
      violation_count?: number;
    }>;
  };
}

const PROFILE_UI: Record<string, { title: string; hint: string }> = {
  simulacao: { title: 'Simulação segura', hint: 'Fila ativa, sem envio real' },
  conservador: { title: 'Conservador recomendado', hint: 'Envio real com delays altos' },
  moderado: { title: 'Moderado', hint: 'Envio real com cadência média' },
};

const modeMeta: Record<OperationalMode, { color: string; label: string }> = {
  blocked: { color: '#ef4444', label: 'Bloqueado' },
  dry_run: { color: '#f59e0b', label: 'Simulação' },
  real_send: { color: '#10b981', label: 'Envio real pronto' },
  invalid_config: { color: '#f97316', label: 'Configuração inválida' },
};

function formatTs(v?: string | null): string {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
}

function defaultForm(): EditableConfig {
  return {
    enabled: true,
    real_send_enabled: false,
    dry_run_enabled: true,
    whatsapp_auto_validate_on_prepare: true,
    whatsapp_auto_validate_on_worker: true,
    whatsapp_validation_batch_size: 10,
    min_delay_ms: 60_000,
    max_delay_ms: 120_000,
    send_timeout_ms: 20_000,
    worker_batch_size: 1,
    worker_interval_ms: 30_000,
    cooldown_rate_limit_ms: 900_000,
    cooldown_forbidden_ms: 1_800_000,
    cooldown_5xx_ms: 600_000,
    cooldown_network_ms: 300_000,
    cooldown_default_ms: 300_000,
    profile: 'conservador',
  };
}

const sectionStyle: CSSProperties = {
  marginBottom: 16,
  padding: '18px 20px',
  borderRadius: 14,
  border: '1px solid var(--border)',
  background: 'rgba(255,255,255,0.02)',
};

const inputStyle: CSSProperties = {
  width: '100%',
  maxWidth: 150,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'rgba(0,0,0,0.25)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
};

function ToggleRow({
  label,
  checked,
  onChange,
  locked,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  locked?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        {locked && (
          <div style={{ fontSize: '0.72rem', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <Lock size={12} /> Travado pelo ambiente
          </div>
        )}
      </div>
      <label className="toggle" style={{ opacity: locked ? 0.5 : 1 }}>
        <input type="checkbox" checked={checked} disabled={locked} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-slider" />
      </label>
    </div>
  );
}

function NumberRow({
  label,
  value,
  onChange,
  locked,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  locked?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const readOnly = locked || disabled;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        {hint && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
        {locked && (
          <div style={{ fontSize: '0.72rem', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <Lock size={12} /> Travado pelo ambiente
          </div>
        )}
      </div>
      <input
        type="number"
        style={{ ...inputStyle, opacity: readOnly ? 0.55 : 1 }}
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export default function WorkerConfig() {
  const [data, setData] = useState<WorkerConfigPayload | null>(null);
  const [form, setForm] = useState<EditableConfig>(defaultForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyingProfile, setApplyingProfile] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const locked = new Set(data?.locked_fields || []);

  const applyPayload = useCallback((payload: WorkerConfigPayload) => {
    setData(payload);
    if (payload.config) setForm({ ...defaultForm(), ...payload.config });
  }, []);

  const load = useCallback(
    async (silent?: boolean) => {
      try {
        if (!silent) setLoading(true);
        const { data: payload } = await api.get('/blindage/worker-config');
        applyPayload(payload);
      } catch (error: any) {
        setToast({
          type: 'error',
          message: error.response?.data?.message || error.response?.data?.error || 'Erro ao carregar',
        });
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [applyPayload]
  );

  useEffect(() => {
    load();
  }, [load]);

  const patch = <K extends keyof EditableConfig>(key: K, value: EditableConfig[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    try {
      setSaving(true);
      const { data: payload } = await api.put('/blindage/worker-config', {
        enabled: form.enabled,
        real_send_enabled: form.real_send_enabled,
        dry_run_enabled: form.dry_run_enabled,
        whatsapp_auto_validate_on_prepare: form.whatsapp_auto_validate_on_prepare,
        whatsapp_auto_validate_on_worker: form.whatsapp_auto_validate_on_worker,
        whatsapp_validation_batch_size: form.whatsapp_validation_batch_size,
        min_delay_ms: form.min_delay_ms,
        max_delay_ms: form.max_delay_ms,
        send_timeout_ms: form.send_timeout_ms,
        worker_batch_size: 1,
        worker_interval_ms: form.worker_interval_ms,
        cooldown_rate_limit_ms: form.cooldown_rate_limit_ms,
        cooldown_forbidden_ms: form.cooldown_forbidden_ms,
        cooldown_5xx_ms: form.cooldown_5xx_ms,
        cooldown_network_ms: form.cooldown_network_ms,
        cooldown_default_ms: form.cooldown_default_ms,
      });
      applyPayload(payload);
      setToast({ type: 'success', message: 'Configuração salva' });
    } catch (error: any) {
      setToast({
        type: 'error',
        message: error.response?.data?.error || error.response?.data?.message || 'Erro ao salvar',
      });
    } finally {
      setSaving(false);
    }
  };

  const applyProfile = async (profile: string) => {
    try {
      setApplyingProfile(profile);
      const { data: payload } = await api.post('/blindage/worker-config/profile', { profile });
      applyPayload(payload);
      setToast({ type: 'success', message: `${PROFILE_UI[profile]?.title || profile} aplicado` });
    } catch (error: any) {
      setToast({
        type: 'error',
        message: error.response?.data?.error || error.response?.data?.message || 'Erro ao aplicar perfil',
      });
    } finally {
      setApplyingProfile(null);
    }
  };

  if (loading && !data) {
    return <div style={{ padding: 32, color: 'var(--text-secondary)' }}>Carregando…</div>;
  }

  const mode = data?.operational_mode || 'blocked';
  const meta = modeMeta[mode];
  const currentProfile = form.profile || data?.config?.profile || 'custom';

  return (
    <div style={{ maxWidth: 900 }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
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
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn-secondary" onClick={() => load()} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <RefreshCw size={16} /> Atualizar
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={save} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Save size={16} /> {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* 1. Status Geral */}
      <div style={{ ...sectionStyle, borderColor: `${meta.color}66`, background: `${meta.color}12` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          {mode === 'real_send' ? <CheckCircle2 size={32} color={meta.color} /> : <ShieldAlert size={32} color={meta.color} />}
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Status geral</div>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: meta.color, fontFamily: 'Outfit, sans-serif', lineHeight: 1.2 }}>
              {data?.status_label || meta.label}
            </div>
          </div>
        </div>
        {(data?.blocking_reasons || []).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(data?.blocking_reasons || []).map((r) => (
              <div
                key={r.code}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                  fontSize: '0.88rem',
                  color: mode === 'real_send' ? 'var(--text-secondary)' : '#fecaca',
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{r.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. Perfil de Operação */}
      <div style={sectionStyle}>
        <h2 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
          Perfil de operação
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {(['simulacao', 'conservador', 'moderado'] as const).map((id) => {
            const active = currentProfile === id;
            const ui = PROFILE_UI[id];
            return (
              <button
                key={id}
                type="button"
                disabled={!!applyingProfile}
                onClick={() => applyProfile(id)}
                style={{
                  padding: '16px 14px',
                  borderRadius: 12,
                  border: `2px solid ${active ? '#38bdf8' : 'var(--border)'}`,
                  background: active ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.02)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  opacity: applyingProfile && applyingProfile !== id ? 0.55 : 1,
                }}
              >
                <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.95rem', fontFamily: 'Outfit, sans-serif' }}>
                  {applyingProfile === id ? 'Aplicando…' : ui.title}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>{ui.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Segurança WhatsApp + operação */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Shield size={18} color="#fbbf24" />
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
            Segurança WhatsApp
          </h2>
        </div>
        <ToggleRow label="Worker ligado" checked={form.enabled} locked={locked.has('enabled')} onChange={(v) => patch('enabled', v)} />
        <ToggleRow
          label="Envio real"
          checked={form.real_send_enabled}
          locked={locked.has('real_send_enabled')}
          onChange={(v) => patch('real_send_enabled', v)}
        />
        <ToggleRow
          label="Simulação (dry-run)"
          checked={form.dry_run_enabled}
          locked={locked.has('dry_run_enabled')}
          onChange={(v) => patch('dry_run_enabled', v)}
        />
        <ToggleRow
          label="Validar WhatsApp ao preparar"
          checked={form.whatsapp_auto_validate_on_prepare}
          locked={locked.has('whatsapp_auto_validate_on_prepare')}
          onChange={(v) => patch('whatsapp_auto_validate_on_prepare', v)}
        />
        <ToggleRow
          label="Validar WhatsApp antes de enviar"
          checked={form.whatsapp_auto_validate_on_worker}
          locked={locked.has('whatsapp_auto_validate_on_worker')}
          onChange={(v) => patch('whatsapp_auto_validate_on_worker', v)}
        />
        <NumberRow
          label="Lote de validação"
          value={form.whatsapp_validation_batch_size}
          locked={locked.has('whatsapp_validation_batch_size')}
          onChange={(v) => patch('whatsapp_validation_batch_size', v)}
        />
        <div style={{ marginTop: 12, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          Pendentes WA: <strong>{data?.whatsapp_safety.pending_count ?? 0}</strong>
          {' · '}
          Contatos do envio validados:{' '}
          <strong>{data?.whatsapp_safety.all_current_dispatch_contacts_validated ? 'Sim' : 'Não'}</strong>
        </div>
      </div>

      {/* 4. Cadência */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Clock size={18} color="#38bdf8" />
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
            Cadência
          </h2>
        </div>
        <NumberRow
          label="Delay mínimo (ms)"
          hint="Com envio real, mínimo 60000"
          value={form.min_delay_ms}
          locked={locked.has('min_delay_ms')}
          onChange={(v) => patch('min_delay_ms', v)}
        />
        <NumberRow
          label="Delay máximo (ms)"
          value={form.max_delay_ms}
          locked={locked.has('max_delay_ms')}
          onChange={(v) => patch('max_delay_ms', v)}
        />
        <NumberRow
          label="Timeout (ms)"
          value={form.send_timeout_ms}
          locked={locked.has('send_timeout_ms')}
          onChange={(v) => patch('send_timeout_ms', v)}
        />
        <NumberRow
          label="Intervalo do worker (ms)"
          value={form.worker_interval_ms}
          locked={locked.has('worker_interval_ms')}
          onChange={(v) => patch('worker_interval_ms', v)}
        />
        <NumberRow label="Lote do worker" value={1} disabled hint="Fixo em 1" onChange={() => undefined} />
        <NumberRow
          label="Cooldown rate limit (ms)"
          value={form.cooldown_rate_limit_ms}
          locked={locked.has('cooldown_rate_limit_ms')}
          onChange={(v) => patch('cooldown_rate_limit_ms', v)}
        />
        <NumberRow
          label="Cooldown 403 (ms)"
          value={form.cooldown_forbidden_ms}
          locked={locked.has('cooldown_forbidden_ms')}
          onChange={(v) => patch('cooldown_forbidden_ms', v)}
        />
        <NumberRow
          label="Cooldown erro servidor (ms)"
          value={form.cooldown_5xx_ms}
          locked={locked.has('cooldown_5xx_ms')}
          onChange={(v) => patch('cooldown_5xx_ms', v)}
        />
        <NumberRow
          label="Cooldown rede (ms)"
          value={form.cooldown_network_ms}
          locked={locked.has('cooldown_network_ms')}
          onChange={(v) => patch('cooldown_network_ms', v)}
        />
      </div>

      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="btn-primary" disabled={saving} onClick={save} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Save size={16} /> {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>

      {/* 5. Instâncias */}
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
                  <th style={{ padding: '6px 8px' }}>Nome</th>
                  <th style={{ padding: '6px 8px' }}>Status</th>
                  <th style={{ padding: '6px 8px' }}>Próximo envio</th>
                  <th style={{ padding: '6px 8px' }}>Cooldown</th>
                  <th style={{ padding: '6px 8px' }}>Hoje / Hora</th>
                  <th style={{ padding: '6px 8px' }}>Violações</th>
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
                    <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>{i.violation_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
