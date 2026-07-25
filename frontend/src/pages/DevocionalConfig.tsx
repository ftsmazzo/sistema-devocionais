import { useState, useEffect, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import api from '@/lib/api';
import Toast from '@/components/ui/Toast';
import Switch from '@/components/ui/Switch';
import {
  Activity,
  AlertCircle,
  BookOpen,
  Save,
  Clock,
  List,
  Bell,
  RefreshCw,
  CheckCircle2,
  Trash2,
  Server,
  ShieldAlert,
  ExternalLink,
  Globe,
} from 'lucide-react';

const DEFAULT_RESET_PHRASE = 'LIMPAR_DADOS_DEVOCIONAL';

const TIMEZONE_OPTIONS = [
  { value: 'America/Sao_Paulo', label: 'Brasília (America/Sao_Paulo)' },
  { value: 'America/Manaus', label: 'Manaus (America/Manaus)' },
  { value: 'America/Fortaleza', label: 'Fortaleza (America/Fortaleza)' },
  { value: 'America/Recife', label: 'Recife (America/Recife)' },
  { value: 'America/Belem', label: 'Belém (America/Belem)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (America/Cuiaba)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (America/Rio_Branco)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (America/Noronha)' },
];

type OperationalMode = 'bloqueado' | 'dry_run' | 'envio_real';

interface DevocionalConfigData {
  id?: number;
  list_id?: number;
  dispatch_hour: number;
  dispatch_minute: number;
  timezone: string;
  notification_phone?: string;
  enabled: boolean;
}

interface ContactList {
  id: number;
  name: string;
  total_contacts: number;
  list_type: string;
}

interface Devocional {
  id: number;
  title: string;
  date: string;
  text: string;
  versiculo_principal?: {
    texto: string;
    referencia: string;
  };
  versiculo_apoio?: {
    texto: string;
    referencia: string;
  };
  metadata?: unknown;
}

interface OperationStatus {
  date: string;
  timezone: string;
  operational_mode: OperationalMode;
  list: { id: number; name: string; list_type: string; total_contacts_list?: number } | null;
  audience: {
    total_potential?: number;
    eligible_now?: number;
    needs_whatsapp_validation?: number;
    excluded_opt_out?: number;
    excluded_no_opt_in?: number;
    excluded_invalid_phone?: number;
    excluded_by_filter?: number;
  };
  audience_legacy?: { estimated_total: number; estimated_eligible: number };
  runtime: {
    worker_enabled: boolean;
    real_send_enabled: boolean;
    dry_run_enabled: boolean;
  };
  blocks: Array<{ code: string; message: string }>;
}

const modeLabel: Record<OperationalMode, string> = {
  bloqueado: 'Bloqueado',
  dry_run: 'Dry-run',
  envio_real: 'Envio real',
};

const modeColor: Record<OperationalMode, string> = {
  bloqueado: '#ef4444',
  dry_run: '#f59e0b',
  envio_real: '#10b981',
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** Formata a data do devocional como dia civil (evita viés de timezone: backend envia DATE como meia-noite UTC) */
function formatDevocionalDate(dateValue: string | Date): string {
  const raw = typeof dateValue === 'string' ? dateValue : (dateValue as Date).toISOString?.() ?? String(dateValue);
  const dateOnly = raw.slice(0, 10);
  const [y, m, d] = dateOnly.split('-').map(Number);
  const localDate = new Date(y, m - 1, d);
  return localDate.toLocaleDateString('pt-BR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function RuntimeBadge({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 999,
        fontSize: '0.78rem',
        fontWeight: 700,
        background: on ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.12)',
        color: on ? '#34d399' : '#f87171',
        border: `1px solid ${on ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.3)'}`,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: on ? '#34d399' : '#f87171',
        }}
      />
      {label}: {on ? 'ON' : 'OFF'}
    </span>
  );
}

export default function DevocionalConfig() {
  const [config, setConfig] = useState<DevocionalConfigData>({
    dispatch_hour: 6,
    dispatch_minute: 0,
    timezone: 'America/Sao_Paulo',
    enabled: true,
  });
  const [lists, setLists] = useState<ContactList[]>([]);
  const [todayDevocional, setTodayDevocional] = useState<Devocional | null>(null);
  const [operationStatus, setOperationStatus] = useState<OperationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [resetPhrase, setResetPhrase] = useState('');
  const [resetIncludeJourneys, setResetIncludeJourneys] = useState(false);
  const [resetContactStats, setResetContactStats] = useState(true);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  const loadOperationStatus = async (silent?: boolean) => {
    try {
      if (!silent) setStatusLoading(true);
      const { data } = await api.get('/devocional/operation/status');
      setOperationStatus(data);
    } catch (error: unknown) {
      console.error('Erro ao carregar status operacional:', error);
    } finally {
      if (!silent) setStatusLoading(false);
    }
  };

  const loadConfig = async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoading(true);
      const response = await api.get('/devocional/config');
      if (response.data.config) {
        setConfig(response.data.config);
      }
      if (response.data.today_devocional) {
        setTodayDevocional(response.data.today_devocional);
      } else {
        setTodayDevocional(null);
      }
    } catch (error: unknown) {
      console.error('Erro ao carregar configuração:', error);
      const err = error as { response?: { data?: { error?: string } } };
      setToast({
        message: err.response?.data?.error || 'Erro ao carregar configuração',
        type: 'error',
      });
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  };

  const loadLists = async () => {
    try {
      const response = await api.get('/lists');
      const raw = response.data.lists || [];
      const sorted = [...raw].sort((a: ContactList & { created_at?: string }, b: ContactList & { created_at?: string }) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      });
      setLists(sorted);
    } catch (error) {
      console.error('Erro ao carregar listas:', error);
    }
  };

  const loadAll = async () => {
    await Promise.all([loadConfig(), loadLists(), loadOperationStatus(true)]);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.put('/devocional/config', config);
      setToast({
        message: 'Configuração salva. Para preparar e acompanhar o envio de hoje, acesse Operação Devocional.',
        type: 'success',
      });
      await loadOperationStatus(true);
    } catch (error: unknown) {
      console.error('Erro ao salvar configuração:', error);
      const err = error as { response?: { data?: { error?: string } } };
      setToast({
        message: err.response?.data?.error || 'Erro ao salvar configuração',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetTestData = async () => {
    try {
      setResetting(true);
      const { data } = await api.post('/devocional/reset-test-data', {
        phrase: resetPhrase.trim(),
        include_journeys: resetIncludeJourneys,
        reset_contact_stats: resetContactStats,
      });
      setToast({
        type: 'success',
        message:
          `Limpeza concluída: ${data.deleted_devocionais ?? 0} devocionais, ${data.deleted_dispatches ?? 0} disparos.` +
          (data.journeys_reseeded ? ` Jornadas recriadas a partir do motor de IA.` : '') +
          (data.contact_stats_reset ? ` Estatísticas de contatos zeradas.` : ''),
      });
      setResetPhrase('');
      await loadConfig({ silent: true });
      await loadOperationStatus(true);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; message?: string; expected?: string } } };
      const msg = err.response?.data?.error || err.response?.data?.message || 'Erro ao limpar dados';
      const hint = err.response?.data?.expected;
      setToast({
        type: 'error',
        message: hint && hint !== '(definida em DEVOCIONAL_RESET_PHRASE)' ? `${msg} (frase esperada: ${hint})` : msg,
      });
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '48vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <RefreshCw className="h-9 w-9 animate-spin mx-auto mb-4" style={{ color: 'var(--gold-primary)' }} />
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Carregando configuração…</p>
        </div>
      </div>
    );
  }

  const labelStyle: CSSProperties = {
    display: 'block',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  };

  const devSnippet =
    todayDevocional && todayDevocional.text.length > 200
      ? `${todayDevocional.text.slice(0, 200)}…`
      : todayDevocional?.text ?? '';

  const mode = operationStatus?.operational_mode ?? 'bloqueado';
  const potential =
    operationStatus?.audience?.total_potential ?? operationStatus?.audience_legacy?.estimated_total ?? null;
  const eligible =
    operationStatus?.audience?.eligible_now ?? operationStatus?.audience_legacy?.estimated_eligible ?? null;
  const needsValidation = operationStatus?.audience?.needs_whatsapp_validation ?? 0;

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
            <BookOpen size={28} color="#0d0c14" strokeWidth={2.5} />
          </div>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: '2rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                fontFamily: 'Outfit, sans-serif',
                letterSpacing: '-0.02em',
              }}
            >
              Configuração do devocional
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: 520, lineHeight: 1.5 }}>
              Ajustes permanentes: lista, horário, fuso e disparo automático. Para preparar a fila e acompanhar o envio de hoje, use{' '}
              <strong style={{ color: 'var(--text-primary)' }}>Operação Devocional</strong>.
            </p>
          </div>
        </div>
        <Link
          to="/devocional/operacao"
          className="btn-gold"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 20px',
            borderRadius: 12,
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: '0.9rem',
          }}
        >
          <Activity size={18} />
          Ver operação de hoje
          <ExternalLink size={14} style={{ opacity: 0.75 }} />
        </Link>
      </div>

      {/* Status operacional */}
      <div className="glass-card" style={{ padding: 22, marginBottom: 22 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Server size={18} style={{ color: 'var(--gold-primary)' }} />
            <h2
              style={{
                margin: 0,
                fontSize: '1.05rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                fontFamily: 'Outfit, sans-serif',
              }}
            >
              Status operacional
            </h2>
          </div>
          <button
            type="button"
            onClick={() => loadOperationStatus()}
            disabled={statusLoading}
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', padding: '8px 14px' }}
          >
            <RefreshCw size={14} className={statusLoading ? 'animate-spin' : ''} />
            Atualizar status
          </button>
        </div>

        {operationStatus ? (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 14px',
                  borderRadius: 999,
                  background: `${modeColor[mode]}22`,
                  color: modeColor[mode],
                  fontWeight: 700,
                  fontSize: '0.85rem',
                }}
              >
                {mode === 'bloqueado' ? <ShieldAlert size={15} /> : <CheckCircle2 size={15} />}
                Modo: {modeLabel[mode]}
              </span>
              <RuntimeBadge label="Worker" on={operationStatus.runtime.worker_enabled} />
              <RuntimeBadge label="Envio real" on={operationStatus.runtime.real_send_enabled} />
              <RuntimeBadge label="Dry-run" on={operationStatus.runtime.dry_run_enabled} />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Ref. {operationStatus.date} ({operationStatus.timezone})
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  padding: '14px 16px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'rgba(0,0,0,0.12)',
                }}
              >
                <div style={{ ...labelStyle, marginBottom: 4, fontSize: '0.68rem' }}>Lista selecionada</div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                  {operationStatus.list?.name || 'Nenhuma lista configurada'}
                </div>
                {operationStatus.list && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    {operationStatus.list.list_type}
                    {operationStatus.list.total_contacts_list != null
                      ? ` · ${operationStatus.list.total_contacts_list} contatos na lista`
                      : ''}
                  </div>
                )}
              </div>

              {(potential != null || eligible != null) && (
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: 12,
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    background: 'rgba(16, 185, 129, 0.06)',
                  }}
                >
                  <div style={{ ...labelStyle, marginBottom: 4, fontSize: '0.68rem' }}>Público estimado</div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {potential != null && (
                      <div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Potenciais</div>
                        <div style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
                          {potential}
                        </div>
                      </div>
                    )}
                    {eligible != null && (
                      <div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Elegíveis agora</div>
                        <div style={{ fontWeight: 800, fontSize: '1.2rem', color: '#34d399', fontFamily: 'Outfit, sans-serif' }}>
                          {eligible}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {needsValidation > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 12,
                  marginBottom: 16,
                  border: '1px solid rgba(245, 158, 11, 0.4)',
                  background: 'rgba(245, 158, 11, 0.08)',
                }}
              >
                <AlertCircle size={18} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {needsValidation} contato{needsValidation !== 1 ? 's' : ''} aguardando validação de WhatsApp.
                  </strong>{' '}
                  Valide ou revise o público antes do envio de hoje.{' '}
                  <Link
                    to="/devocional/operacao"
                    style={{ color: 'var(--gold-primary)', fontWeight: 700, textDecoration: 'none' }}
                  >
                    Ir para Operação Devocional →
                  </Link>
                </div>
              </div>
            )}

            {operationStatus.blocks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ ...labelStyle, marginBottom: 4 }}>Bloqueios que impedem o envio</div>
                {operationStatus.blocks.map((b) => (
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
                    <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>
                      <strong>{b.code}</strong> — {b.message}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {operationStatus.blocks.length === 0 && needsValidation === 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  background: 'rgba(16, 185, 129, 0.06)',
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <CheckCircle2 size={18} style={{ color: '#34d399' }} />
                Nenhum bloqueio crítico detectado. Use Operação Devocional para preparar e acompanhar a fila de hoje.
              </div>
            )}
          </>
        ) : (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Não foi possível carregar o status operacional. Tente atualizar ou acesse{' '}
            <Link to="/devocional/operacao" style={{ color: 'var(--gold-primary)', fontWeight: 600 }}>
              Operação Devocional
            </Link>
            .
          </p>
        )}
      </div>

      <div className="glass-card" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            <List size={16} style={{ opacity: 0.85 }} />
            Lista de contatos *
          </label>
          <select
            value={config.list_id || ''}
            onChange={(e) =>
              setConfig({ ...config, list_id: e.target.value ? parseInt(e.target.value, 10) : undefined })
            }
            className="input-dark"
          >
            <option value="">Selecione uma lista</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({list.total_contacts || 0} contatos) — {list.list_type}
              </option>
            ))}
          </select>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.45 }}>
            Lista padrão para o disparo automático diário. A preparação da fila de hoje é feita em Operação Devocional.
          </p>
        </div>

        <div>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Globe size={16} style={{ opacity: 0.85 }} />
            Fuso horário
          </label>
          <select
            value={config.timezone}
            onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
            className="input-dark"
          >
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
            Define qual dia civil conta como &quot;hoje&quot; e em qual fuso o horário de disparo é interpretado.
          </p>
        </div>

        <div>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={16} style={{ opacity: 0.85 }} />
            Horário de disparo ({config.timezone})
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <span style={{ ...labelStyle, fontSize: '0.68rem', marginBottom: 6 }}>Hora</span>
              <input
                type="number"
                min={0}
                max={23}
                value={config.dispatch_hour}
                onChange={(e) => setConfig({ ...config, dispatch_hour: parseInt(e.target.value, 10) || 0 })}
                className="input-dark"
              />
            </div>
            <div>
              <span style={{ ...labelStyle, fontSize: '0.68rem', marginBottom: 6 }}>Minuto</span>
              <input
                type="number"
                min={0}
                max={59}
                value={config.dispatch_minute}
                onChange={(e) => setConfig({ ...config, dispatch_minute: parseInt(e.target.value, 10) || 0 })}
                className="input-dark"
              />
            </div>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
            Execução diária às {pad2(config.dispatch_hour)}:{pad2(config.dispatch_minute)} no fuso configurado.
          </p>
        </div>

        <div>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bell size={16} style={{ opacity: 0.85 }} />
            Telefone para notificações (opcional)
          </label>
          <input
            type="text"
            value={config.notification_phone || ''}
            onChange={(e) => setConfig({ ...config, notification_phone: e.target.value })}
            placeholder="5516999999999"
            className="input-dark"
          />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
            Recebe avisos quando o disparo iniciar, concluir ou em caso de erro.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: 18,
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.12)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem', marginBottom: 4 }}>
              Disparo automático
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              Quando ativo, o sistema envia o devocional do dia no horário configurado, sem precisar preparar manualmente
              a cada manhã — desde que a operação do dia esteja preparada.
            </p>
          </div>
          <Switch checked={config.enabled} onCheckedChange={(enabled) => setConfig({ ...config, enabled })} />
        </div>

        {todayDevocional ? (
          <div
            style={{
              borderRadius: 14,
              border: '1px solid rgba(16, 185, 129, 0.35)',
              background: 'linear-gradient(145deg, rgba(16, 185, 129, 0.12) 0%, rgba(5, 150, 105, 0.06) 50%, rgba(0,0,0,0.15) 100%)',
              padding: 22,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: 'rgba(16, 185, 129, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#34d399',
                }}
              >
                <BookOpen size={22} />
              </div>
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '1.05rem',
                    fontWeight: 800,
                    color: 'var(--text-primary)',
                    fontFamily: 'Outfit, sans-serif',
                  }}
                >
                  Prévia do devocional de hoje
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  {formatDevocionalDate(todayDevocional.date)}
                </p>
              </div>
            </div>
            <div
              style={{
                borderRadius: 12,
                padding: 16,
                border: '1px solid var(--border)',
                background: 'var(--bg-elevated)',
              }}
            >
              <h4 style={{ margin: '0 0 10px', fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>
                {todayDevocional.title}
              </h4>
              {todayDevocional.versiculo_principal && (
                <p style={{ margin: '0 0 10px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Versículo principal:</strong>{' '}
                  {todayDevocional.versiculo_principal.referencia}
                </p>
              )}
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{devSnippet}</p>
            </div>
          </div>
        ) : (
          <div
            style={{
              borderRadius: 14,
              padding: 18,
              border: '1px solid rgba(245, 158, 11, 0.35)',
              background: 'rgba(245, 158, 11, 0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <AlertCircle className="h-5 w-5 flex-shrink-0" style={{ color: '#fbbf24', marginTop: 2 }} />
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <p style={{ margin: 0, fontWeight: 700, color: 'var(--text-primary)' }}>Nenhum devocional encontrado para hoje</p>
                <p style={{ margin: '8px 0 0' }}>
                  Gere o conteúdo em <strong>Devocional Criativo</strong> (teste por data) ou aguarde o agendamento interno.
                  Depois, prepare o envio em{' '}
                  <Link to="/devocional/operacao" style={{ color: 'var(--gold-primary)', fontWeight: 600, textDecoration: 'none' }}>
                    Operação Devocional
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>
        )}

        {config.enabled ? (
          <div
            style={{
              borderRadius: 12,
              padding: 16,
              border: '1px solid rgba(16, 185, 129, 0.35)',
              background: 'rgba(16, 185, 129, 0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" style={{ color: '#34d399', marginTop: 2 }} />
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-primary)' }}>Disparo automático ativo</p>
                <p style={{ margin: 0 }}>
                  Envios diários às{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {pad2(config.dispatch_hour)}:{pad2(config.dispatch_minute)}
                  </strong>{' '}
                  ({config.timezone}). A fila do dia é preparada e monitorada em Operação Devocional.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              borderRadius: 12,
              padding: 16,
              border: '1px solid rgba(245, 158, 11, 0.3)',
              background: 'rgba(245, 158, 11, 0.06)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <AlertCircle className="h-5 w-5 flex-shrink-0" style={{ color: '#fbbf24', marginTop: 2 }} />
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-primary)' }}>Disparo automático desligado</p>
                <p style={{ margin: 0 }}>Ative o interruptor acima para retomar os envios automáticos no horário configurado.</p>
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            borderRadius: 12,
            padding: 16,
            border: '1px solid rgba(56, 189, 248, 0.35)',
            background: 'rgba(56, 189, 248, 0.06)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertCircle className="h-5 w-5 flex-shrink-0" style={{ color: '#38bdf8', marginTop: 2 }} />
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-primary)' }}>Config vs Operação</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>
                  <strong>Config. Devocional</strong> (esta página): lista, horário, fuso, notificações e ligar/desligar o
                  disparo automático.
                </li>
                <li>
                  <strong>Operação Devocional</strong>: preparar a fila de hoje, validar público, acompanhar envios, retries e
                  dry-run.
                </li>
                <li>
                  O conteúdo do dia vem de <strong>Devocional Criativo</strong> ou ingestão HTTP; esta tela só mostra a prévia.
                </li>
                <li>Mensagens usam saudação e primeiro nome quando disponível, respeitando opt-in, opt-out e validação de WhatsApp.</li>
              </ul>
              <Link
                to="/devocional/operacao"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 12,
                  color: 'var(--gold-primary)',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  textDecoration: 'none',
                }}
              >
                <Activity size={16} />
                Ver operação de hoje
              </Link>
            </div>
          </div>
        </div>

        <div
          style={{
            borderRadius: 14,
            padding: 20,
            border: '1px solid rgba(239, 68, 68, 0.45)',
            background: 'rgba(239, 68, 68, 0.06)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Trash2 size={20} style={{ color: '#f87171' }} />
            <h3
              style={{
                margin: 0,
                fontSize: '1rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                fontFamily: 'Outfit, sans-serif',
              }}
            >
              Limpeza para teste (ambiente de homologação)
            </h3>
          </div>
          <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Remove todos os registros de <strong>devocionais</strong> e <strong>disparos</strong> vinculados (incluindo histórico
            de envio do devocional), e desassocia mensagens do devocional. Use antes de gerar vários dias no Devocional Criativo
            e validar o disparo automático. Em produção, defina{' '}
            <code style={{ fontSize: '0.75rem' }}>DISABLE_DEVOCIONAL_DATA_RESET=true</code> no servidor para bloquear esta ação.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, fontSize: '0.85rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={resetIncludeJourneys}
              onChange={(e) => setResetIncludeJourneys(e.target.checked)}
            />
            Apagar jornadas e recriar uma jornada inicial a partir do motor de IA (devocional_ai_config)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, fontSize: '0.85rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={resetContactStats}
              onChange={(e) => setResetContactStats(e.target.checked)}
            />
            Zerar estatísticas de devocional nos contatos (último envio/leitura, falhas, score)
          </label>
          <label style={{ ...labelStyle, marginBottom: 6 }}>Confirmação (digite exatamente a frase)</label>
          <input
            type="text"
            value={resetPhrase}
            onChange={(e) => setResetPhrase(e.target.value)}
            placeholder={DEFAULT_RESET_PHRASE}
            autoComplete="off"
            className="input-dark"
            style={{ marginBottom: 8 }}
          />
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 14px' }}>
            Frase padrão: <code>{DEFAULT_RESET_PHRASE}</code>. Se o backend usar <code>DEVOCIONAL_RESET_PHRASE</code>, use essa
            frase no lugar.
          </p>
          <button
            type="button"
            onClick={handleResetTestData}
            disabled={resetting || !resetPhrase.trim()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 10,
              border: '1px solid rgba(239, 68, 68, 0.5)',
              background: resetting || !resetPhrase.trim() ? 'rgba(0,0,0,0.2)' : 'rgba(239, 68, 68, 0.15)',
              color: '#fecaca',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: resetting || !resetPhrase.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {resetting ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Limpando…
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Limpar dados de devocional
              </>
            )}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !config.list_id}
            className="btn-gold"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 24px',
              borderRadius: 12,
              border: 'none',
              cursor: saving || !config.list_id ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              opacity: saving || !config.list_id ? 0.55 : 1,
            }}
          >
            {saving ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Salvar configuração
              </>
            )}
          </button>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} duration={4000} onClose={() => setToast(null)} />}
    </div>
  );
}
