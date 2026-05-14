import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '@/lib/api';
import {
  Shield,
  Clock,
  BarChart3,
  RotateCcw,
  Calendar,
  Heart,
  Save,
  CheckCircle2,
  Server,
  Info,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Gauge,
  Zap,
  Activity,
  PauseCircle,
  FileDown,
} from 'lucide-react';

interface BlindageRule {
  id: number;
  instance_id: number | null;
  rule_name: string;
  rule_type: string;
  enabled: boolean;
  config: any;
}

interface Instance {
  id: number;
  name: string;
  instance_name: string;
}

interface ProfileMeta {
  id: string;
  label: string;
  description: string;
}

interface BlindageStatRow {
  action_type: string;
  count: string | number;
  last_24h: string | number;
  last_hour: string | number;
}

function actionTypeLabel(type: string): string {
  const map: Record<string, string> = {
    blindage_applied: 'Envio autorizado',
    content_blocked: 'Conteúdo bloqueado',
    limit_reached: 'Limite atingido',
    health_blocked: 'Pausa (saúde)',
    time_blocked: 'Fora do horário',
    number_blocked: 'Número bloqueado',
    number_check_failed: 'Falha verificação número',
  };
  return map[type] || type;
}

const OBS_PAGE_SIZE = 40;

const BLINDAGE_ACTION_FILTER_IDS = [
  '',
  'blindage_applied',
  'content_blocked',
  'limit_reached',
  'health_blocked',
  'time_blocked',
  'number_blocked',
  'number_check_failed',
] as const;

function summarizeActionData(data: unknown): string {
  if (data == null) return '—';
  if (typeof data === 'string') {
    return data.length > 140 ? `${data.slice(0, 137)}…` : data;
  }
  try {
    const s = JSON.stringify(data);
    return s.length > 140 ? `${s.slice(0, 137)}…` : s;
  } catch {
    return '—';
  }
}

export default function Blindage() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [rules, setRules] = useState<BlindageRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyingProfile, setApplyingProfile] = useState<string | null>(null);
  const [profilesFromApi, setProfilesFromApi] = useState<ProfileMeta[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [allInstances, setAllInstances] = useState<any[]>([]);
  const [obsStats, setObsStats] = useState<BlindageStatRow[]>([]);
  const [obsActions, setObsActions] = useState<any[]>([]);
  const [obsTotal, setObsTotal] = useState(0);
  const [obsRefreshing, setObsRefreshing] = useState(false);
  const [obsActionFilter, setObsActionFilter] = useState<string>('');
  const [obsLoadingMore, setObsLoadingMore] = useState(false);
  const [obsExporting, setObsExporting] = useState(false);
  const obsActionsRef = useRef<any[]>([]);
  const lastObsContextKey = useRef<string | null>(null);

  useEffect(() => {
    obsActionsRef.current = obsActions;
  }, [obsActions]);

  useEffect(() => {
    loadData();
  }, [instanceId]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      if (instanceId) {
        const instanceRes = await api.get(`/instances/${instanceId}`);
        setInstance(instanceRes.data.instance);
      } else {
        setInstance(null);
      }

      const instancesRes = await api.get('/instances');
      setAllInstances(instancesRes.data.instances || []);

      try {
        const profRes = await api.get('/blindage/profiles');
        const list = profRes.data?.profiles;
        if (Array.isArray(list) && list.length > 0) {
          setProfilesFromApi(list);
        }
      } catch {
        setProfilesFromApi([]);
      }

      const rulesRes = await api.get(`/blindage/rules${instanceId ? `?instanceId=${instanceId}` : ''}`);
      let loadedRules = (rulesRes.data.rules || []).map((rule: any) => ({
        ...rule,
        config: typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config,
      }));
      
      // Auto-create selection rule if missing
      const selectionRule = loadedRules.find((r: any) => r.rule_type === 'instance_selection');
      if (!selectionRule) {
        try {
          await api.post('/blindage/rules', {
            instance_id: null,
            rule_name: 'Seleção de Instâncias',
            rule_type: 'instance_selection',
            enabled: true,
            config: {
              selected_instance_ids: [],
              max_simultaneous: 1,
              auto_switch_on_failure: true,
              retry_after_pause: true,
            },
          });
          const newRulesRes = await api.get(`/blindage/rules${instanceId ? `?instanceId=${instanceId}` : ''}`);
          loadedRules = (newRulesRes.data.rules || []).map((rule: any) => ({
            ...rule,
            config: typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config,
          }));
        } catch (error) {
          console.error('Erro ao criar regra de seleção:', error);
        }
      }
      
      setRules(loadedRules);

      const obsKey = instanceId ?? '';
      if (lastObsContextKey.current !== obsKey) {
        lastObsContextKey.current = obsKey;
        setObsActionFilter('');
        await loadObservability({ actionFilter: '' });
      } else {
        await loadObservability();
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      setToast({ message: 'Erro ao carregar configurações de blindagem', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const loadObservability = async (opts?: {
    append?: boolean;
    fromRefresh?: boolean;
    actionFilter?: string;
  }) => {
    const filter = opts?.actionFilter !== undefined ? opts.actionFilter : obsActionFilter;
    const append = opts?.append === true;
    const fromRefresh = opts?.fromRefresh === true;

    try {
      if (fromRefresh) setObsRefreshing(true);
      if (append) setObsLoadingMore(true);

      const offset = append ? obsActionsRef.current.length : 0;

      const statsQs = new URLSearchParams();
      if (instanceId) statsQs.set('instanceId', instanceId);
      if (filter) statsQs.set('actionType', filter);
      const statsUrl = statsQs.toString() ? `/blindage/stats?${statsQs}` : '/blindage/stats';

      const actQs = new URLSearchParams();
      actQs.set('limit', String(OBS_PAGE_SIZE));
      actQs.set('offset', String(offset));
      if (instanceId) actQs.set('instanceId', instanceId);
      if (filter) actQs.set('actionType', filter);
      const actionsUrl = `/blindage/actions?${actQs}`;

      const [st, ac] = await Promise.all([api.get(statsUrl), api.get(actionsUrl)]);
      setObsStats(Array.isArray(st.data?.stats) ? st.data.stats : []);
      const next = Array.isArray(ac.data?.actions) ? ac.data.actions : [];
      setObsActions((prev) => (append ? [...prev, ...next] : next));
      setObsTotal(typeof ac.data?.total === 'number' ? ac.data.total : 0);
    } catch {
      if (!append) {
        setObsStats([]);
        setObsActions([]);
        setObsTotal(0);
      }
    } finally {
      if (fromRefresh) setObsRefreshing(false);
      if (append) setObsLoadingMore(false);
    }
  };

  const handleExportBlindageCsv = async () => {
    setObsExporting(true);
    try {
      const p = new URLSearchParams();
      p.set('limit', '8000');
      if (instanceId) p.set('instanceId', instanceId);
      if (obsActionFilter) p.set('actionType', obsActionFilter);
      const res = await api.get(`/blindage/actions/export?${p.toString()}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(
        new Blob([res.data], { type: 'text/csv;charset=utf-8;' })
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `blindagem-acoes-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      setToast({ message: 'Arquivo CSV gerado.', type: 'success' });
    } catch (e: any) {
      let msg = 'Erro ao exportar CSV';
      const data = e?.response?.data;
      if (data instanceof Blob) {
        try {
          const t = await data.text();
          const j = JSON.parse(t);
          if (j?.error) msg = j.error;
        } catch {
          /* ignore */
        }
      }
      setToast({ message: msg, type: 'error' });
    } finally {
      setObsExporting(false);
    }
  };

  const updateRule = (ruleId: number, updates: Partial<BlindageRule>) => {
    setRules(rules.map(rule => 
      rule.id === ruleId ? { ...rule, ...updates } : rule
    ));
    setHasChanges(true);
  };

  const updateRuleConfig = (ruleId: number, configKey: string, value: any) => {
    setRules(rules.map(rule => {
      if (rule.id === ruleId) {
        return {
          ...rule,
          config: {
            ...rule.config,
            [configKey]: value,
          },
        };
      }
      return rule;
    }));
    setHasChanges(true);
  };

  const handleSave = async (ruleId?: number) => {
    try {
      setSaving(true);

      const rulesToSave = ruleId 
        ? rules.filter(r => r.id === ruleId)
        : rules;

      let savedCount = 0;
      
      for (const rule of rulesToSave) {
        await api.put(`/blindage/rules/${rule.id}`, {
          enabled: rule.enabled,
          config: rule.config,
        });
        savedCount++;
      }

      if (!ruleId) setHasChanges(false);
      setToast({
        message: `${savedCount} configuração(ões) salva(s) com sucesso!`,
        type: 'success',
      });
      
      await loadData();
    } catch (error: any) {
      console.error('Erro ao salvar:', error);
      setToast({
        message: `Erro ao salvar: ${error.response?.data?.error || error.message}`,
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const fallbackProfiles: ProfileMeta[] = [
    { id: 'conservative', label: 'Conservador', description: 'Máxima proteção, menor volume.' },
    { id: 'moderate', label: 'Moderado', description: 'Recomendado para a maioria.' },
    { id: 'aggressive', label: 'Agressivo', description: 'Maior volume, mais risco.' },
  ];

  const displayProfiles = profilesFromApi.length > 0 ? profilesFromApi : fallbackProfiles;

  const handleApplyProfile = async (profileId: string) => {
    const label = displayProfiles.find((p) => p.id === profileId)?.label || profileId;
    if (!window.confirm(`Aplicar o perfil "${label}" às regras globais de blindagem? Os valores atuais dessas regras serão substituídos pelo pacote do perfil.`)) {
      return;
    }
    try {
      setApplyingProfile(profileId);
      await api.post('/blindage/profiles/apply', { profileId });
      setHasChanges(false);
      setToast({ message: `Perfil "${label}" aplicado às regras globais.`, type: 'success' });
      await loadData();
    } catch (error: any) {
      console.error(error);
      setToast({
        message: error.response?.data?.error || `Erro ao aplicar perfil: ${error.message}`,
        type: 'error',
      });
    } finally {
      setApplyingProfile(null);
    }
  };

  const handleTimeRangeChange = (ruleId: number, startHour: number, endHour: number) => {
    const hours = [];
    for (let h = startHour; h <= endHour; h++) {
      hours.push(h);
    }
    updateRuleConfig(ruleId, 'allowed_hours', hours);
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
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Carregando blindagens...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  const groupedRules = {
    delay: rules.find(r => r.rule_type === 'message_delay'),
    limit: rules.find(r => r.rule_type === 'message_limit'),
    rotation:
      rules.find((r) => r.rule_type === 'instance_rotation' && r.instance_id == null) ||
      rules.find((r) => r.rule_type === 'instance_rotation'),
    hours: rules.find(r => r.rule_type === 'allowed_hours'),
    health: rules.find(r => r.rule_type === 'health_check'),
    content: rules.find(r => r.rule_type === 'content_validation'),
    number: rules.find(r => r.rule_type === 'number_validation'),
    selection: rules.find(r => r.rule_type === 'instance_selection'),
    pacing:
      rules.find((r) => r.rule_type === 'dispatch_pacing' && r.instance_id == null) ||
      rules.find((r) => r.rule_type === 'dispatch_pacing'),
  };

  const allowedHours = Array.isArray(groupedRules.hours?.config.allowed_hours) 
    ? groupedRules.hours.config.allowed_hours 
    : [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const startHour = allowedHours.length > 0 ? Math.min(...allowedHours) : 8;
  const endHour = allowedHours.length > 0 ? Math.max(...allowedHours) : 20;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 100,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          background: toast.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)',
          border: `1px solid ${toast.type === 'success' ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)'}`,
          color: toast.type === 'success' ? '#34d399' : '#fb7185',
          backdropFilter: 'blur(12px)',
        }}>
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.875rem', fontWeight: 500 }}>{toast.message}</span>
        </div>
      )}

      {/* Header Area */}
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
              <Shield size={28} color="#0d0c14" strokeWidth={2} />
            </div>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em', fontFamily: 'Outfit, sans-serif' }}>
                Blindagem de Contas
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span className="badge badge-gold">Proteção Ativa</span>
                {instance && (
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Server size={14} /> {instance.name}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={() => handleSave()}
            disabled={saving || !hasChanges}
            className="btn-gold"
            style={{
              padding: '12px 28px', fontSize: '0.95rem',
              display: 'flex', alignItems: 'center', gap: 10,
              opacity: (saving || !hasChanges) ? 0.6 : 1,
              cursor: (saving || !hasChanges) ? 'not-allowed' : 'pointer',
              border: 'none',
            }}
          >
            {saving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
            {saving ? 'Salvando Alterações...' : hasChanges ? 'Salvar Configurações' : 'Tudo Atualizado'}
          </button>
        </div>
      </div>

      {/* Perfis pré-configurados (regras globais) */}
      <div className="glass-card" style={{ padding: '22px 24px', marginBottom: 28 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flex: '1 1 280px' }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: 'linear-gradient(135deg, rgba(245,158,11,0.25), rgba(217,119,6,0.12))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Sparkles size={24} color="#fbbf24" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
                Perfis de envio
              </h2>
              <p style={{ margin: '8px 0 0', fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Um clique aplica um pacote às <strong>regras globais</strong> (todas as instâncias): limites, horários, delay, pacing de lotes, rotação e conteúdo.
                {instanceId ? ' Você está vendo também regras desta instância; o perfil altera só as regras globais.' : ''}
              </p>
            </div>
          </div>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 14,
        }}>
          {displayProfiles.map((p) => {
            const Icon = p.id === 'conservative' ? Shield : p.id === 'aggressive' ? Zap : Gauge;
            const busy = applyingProfile === p.id;
            return (
              <button
                key={p.id}
                type="button"
                disabled={!!applyingProfile}
                onClick={() => handleApplyProfile(p.id)}
                style={{
                  textAlign: 'left',
                  padding: '16px 18px',
                  borderRadius: 14,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-elevated)',
                  cursor: applyingProfile ? 'wait' : 'pointer',
                  opacity: applyingProfile && !busy ? 0.55 : 1,
                  transition: 'transform 0.15s, border-color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!applyingProfile) {
                    e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.45)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  {busy ? (
                    <RefreshCw size={20} className="animate-spin" color="#f59e0b" />
                  ) : (
                    <Icon size={20} color={p.id === 'aggressive' ? '#f97316' : p.id === 'conservative' ? '#94a3b8' : '#38bdf8'} />
                  )}
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{p.label}</span>
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>{p.description}</p>
                <span style={{ display: 'inline-block', marginTop: 10, fontSize: '0.75rem', fontWeight: 600, color: '#f59e0b' }}>
                  {busy ? 'Aplicando…' : 'Aplicar perfil →'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Rules Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 24 }}>
        
        {/* 1. Delay Inteligente */}
        {groupedRules.delay && (
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', background: 'rgba(56, 189, 248, 0.03)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(56, 189, 248, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Clock size={20} color="#38bdf8" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Delay Inteligente</h3>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>Intervalo entre envios</p>
                </div>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={groupedRules.delay.enabled}
                  onChange={(e) => updateRule(groupedRules.delay!.id, { enabled: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div style={{ padding: 24, flex: 1 }} className="flex flex-col gap-5">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Mínimo (segundos)</span>
                    <span style={{ fontWeight: 700, color: 'var(--sky)' }}>{groupedRules.delay.config.min_delay_seconds || 3}s</span>
                  </div>
                  <input
                    type="range" min="1" max="60"
                    value={groupedRules.delay.config.min_delay_seconds || 3}
                    onChange={(e) => updateRuleConfig(groupedRules.delay!.id, 'min_delay_seconds', parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--sky)' }}
                  />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Máximo (segundos)</span>
                    <span style={{ fontWeight: 700, color: 'var(--sky)' }}>{groupedRules.delay.config.max_delay_seconds || 10}s</span>
                  </div>
                  <input
                    type="range" min="1" max="300"
                    value={groupedRules.delay.config.max_delay_seconds || 10}
                    onChange={(e) => updateRuleConfig(groupedRules.delay!.id, 'max_delay_seconds', parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--sky)' }}
                  />
                </div>
                <div style={{ padding: '12px 16px', borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>Delay Progressivo</span>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={groupedRules.delay.config.progressive !== false}
                      onChange={(e) => updateRuleConfig(groupedRules.delay!.id, 'progressive', e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. Limite de Volume */}
        {groupedRules.limit && (
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', background: 'rgba(16, 185, 129, 0.03)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <BarChart3 size={20} color="#10b981" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Limite de Volume</h3>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>Controle de disparos</p>
                </div>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={groupedRules.limit.enabled}
                  onChange={(e) => updateRule(groupedRules.limit!.id, { enabled: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div style={{ padding: 24, flex: 1 }}>
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Por Hora</span>
                  <span style={{ fontWeight: 700, color: 'var(--emerald)' }}>{groupedRules.limit.config.max_per_hour || 50} msg</span>
                </div>
                <input
                  type="range" min="1" max="500"
                  value={groupedRules.limit.config.max_per_hour || 50}
                  onChange={(e) => updateRuleConfig(groupedRules.limit!.id, 'max_per_hour', parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--emerald)' }}
                />
              </div>
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Por Dia</span>
                  <span style={{ fontWeight: 700, color: 'var(--emerald)' }}>{groupedRules.limit.config.max_per_day || 500} msg</span>
                </div>
                <input
                  type="range" min="10" max="5000"
                  value={groupedRules.limit.config.max_per_day || 500}
                  onChange={(e) => updateRuleConfig(groupedRules.limit!.id, 'max_per_day', parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--emerald)' }}
                />
              </div>
            </div>
          </div>
        )}

        {/* 3. Janela de Horário */}
        {groupedRules.hours && (
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', background: 'rgba(245, 158, 11, 0.03)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(245, 158, 11, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Calendar size={20} color="#f59e0b" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Janela de Horário</h3>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>Horários permitidos</p>
                </div>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={groupedRules.hours.enabled}
                  onChange={(e) => updateRule(groupedRules.hours!.id, { enabled: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div style={{ padding: 24, flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div style={{ background: 'var(--bg-elevated)', padding: 16, borderRadius: 12, border: '1px solid var(--border)', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', marginBottom: 4 }}>Início</span>
                  <input
                    type="number" min="0" max="23"
                    value={startHour}
                    onChange={(e) => handleTimeRangeChange(groupedRules.hours!.id, parseInt(e.target.value), endHour)}
                    style={{ background: 'none', border: 'none', fontSize: '1.5rem', fontWeight: 800, color: 'var(--gold-primary)', width: '100%', textAlign: 'center', outline: 'none' }}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>horas</span>
                </div>
                <div style={{ background: 'var(--bg-elevated)', padding: 16, borderRadius: 12, border: '1px solid var(--border)', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', marginBottom: 4 }}>Fim</span>
                  <input
                    type="number" min="0" max="23"
                    value={endHour}
                    onChange={(e) => handleTimeRangeChange(groupedRules.hours!.id, startHour, parseInt(e.target.value))}
                    style={{ background: 'none', border: 'none', fontSize: '1.5rem', fontWeight: 800, color: 'var(--gold-primary)', width: '100%', textAlign: 'center', outline: 'none' }}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>horas</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {Array.from({ length: 24 }).map((_, h) => {
                  const isActive = h >= startHour && h <= endHour;
                  return (
                    <div key={h} style={{
                      width: 'calc(100% / 12 - 4px)', height: 20, borderRadius: 4,
                      background: isActive ? 'var(--gold-primary)' : 'var(--bg-elevated)',
                      opacity: isActive ? 1 : 0.3,
                    }} title={`${h}h`} />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 4. Saúde da Conta */}
        {groupedRules.health && (
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', background: 'rgba(244, 63, 94, 0.03)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(244, 63, 94, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Heart size={20} color="#f43f5e" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Saúde da Conta</h3>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>Pausa em erros</p>
                </div>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={groupedRules.health.enabled}
                  onChange={(e) => updateRule(groupedRules.health!.id, { enabled: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div style={{ padding: 24, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 12, background: 'var(--bg-elevated)', marginBottom: 12 }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>Pausar se Degradada</span>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={groupedRules.health.config.pause_if_degraded !== false}
                    onChange={(e) => updateRuleConfig(groupedRules.health!.id, 'pause_if_degraded', e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 12, background: 'var(--bg-elevated)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>Pausar se Desconectada</span>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={groupedRules.health.config.pause_if_down !== false}
                    onChange={(e) => updateRuleConfig(groupedRules.health!.id, 'pause_if_down', e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* 5. Rodízio Automático */}
        {groupedRules.rotation && (
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', background: 'rgba(167, 139, 250, 0.03)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(167, 139, 250, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <RotateCcw size={20} color="#a78bfa" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Rodízio Ativo</h3>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>Múltiplas instâncias</p>
                </div>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={groupedRules.rotation.enabled}
                  onChange={(e) => updateRule(groupedRules.rotation!.id, { enabled: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div style={{ padding: 24, flex: 1 }}>
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Intervalo entre Trocas</span>
                  <span style={{ fontWeight: 700, color: 'var(--violet)' }}>{groupedRules.rotation.config.min_delay_between_instances || 1}s</span>
                </div>
                <input
                  type="range" min="0" max="60"
                  value={groupedRules.rotation.config.min_delay_between_instances || 1}
                  onChange={(e) => updateRuleConfig(groupedRules.rotation!.id, 'min_delay_between_instances', parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--violet)' }}
                />
              </div>
              <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.2)', display: 'flex', gap: 10, marginBottom: 20 }}>
                <Info size={16} color="var(--violet)" style={{ flexShrink: 0, marginTop: 2 }} />
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>O rodízio ajuda a simular comportamento humano e distribui o risco entre as contas.</p>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Trocar instância a cada N envios (sucesso)</span>
                  <span style={{ fontWeight: 700, color: 'var(--violet)' }}>
                    {(Number(groupedRules.rotation.config.rotate_every_n_messages) || 0) === 0 ? 'Off' : `${Number(groupedRules.rotation.config.rotate_every_n_messages) || 0} msgs`}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={1}
                  value={Math.min(200, Math.max(0, Number(groupedRules.rotation.config.rotate_every_n_messages) || 0))}
                  onChange={(e) =>
                    updateRuleConfig(groupedRules.rotation!.id, 'rotate_every_n_messages', parseInt(e.target.value, 10))
                  }
                  style={{ width: '100%', accentColor: 'var(--violet)' }}
                />
                <p style={{ margin: '8px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  0 = sem troca por volume no mesmo disparo. Valores maiores alternam a instância preferida após N envios com sucesso (Fase B).
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Pacing de disparos (lotes) — Fase B na UI / Fase C */}
        {groupedRules.pacing && (
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', background: 'rgba(14, 165, 233, 0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(14, 165, 233, 0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PauseCircle size={20} color="#0ea5e9" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Pacing entre lotes</h3>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>Pausas longas no mesmo disparo (fora da fila global)</p>
                </div>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={groupedRules.pacing.enabled}
                  onChange={(e) => updateRule(groupedRules.pacing!.id, { enabled: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div style={{ padding: 24, flex: 1 }} className="flex flex-col gap-5">
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Mensagens por lote</span>
                  <span style={{ fontWeight: 700, color: '#0ea5e9' }}>{groupedRules.pacing.config.messages_per_batch ?? 20}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={120}
                  value={Math.min(120, Math.max(1, Number(groupedRules.pacing.config.messages_per_batch) || 20))}
                  onChange={(e) => updateRuleConfig(groupedRules.pacing!.id, 'messages_per_batch', parseInt(e.target.value, 10))}
                  style={{ width: '100%', accentColor: '#0ea5e9' }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Pausa entre lotes (min)</span>
                  <span style={{ fontWeight: 700, color: '#0ea5e9' }}>{groupedRules.pacing.config.pause_between_batches_minutes ?? 15} min</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={180}
                  value={Math.min(180, Math.max(1, Number(groupedRules.pacing.config.pause_between_batches_minutes) || 15))}
                  onChange={(e) =>
                    updateRuleConfig(groupedRules.pacing!.id, 'pause_between_batches_minutes', parseInt(e.target.value, 10))
                  }
                  style={{ width: '100%', accentColor: '#0ea5e9' }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Pausa longa a cada N envios (0 = off)</span>
                  <span style={{ fontWeight: 700, color: '#0ea5e9' }}>
                    {(Number(groupedRules.pacing.config.long_pause_every_n_messages) || 0) === 0
                      ? 'Off'
                      : `${Number(groupedRules.pacing.config.long_pause_every_n_messages)} msgs`}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={1}
                  value={Math.min(200, Math.max(0, Number(groupedRules.pacing.config.long_pause_every_n_messages) || 0))}
                  onChange={(e) =>
                    updateRuleConfig(groupedRules.pacing!.id, 'long_pause_every_n_messages', parseInt(e.target.value, 10))
                  }
                  style={{ width: '100%', accentColor: '#0ea5e9' }}
                />
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Duração da pausa longa (min)</span>
                  <span style={{ fontWeight: 700, color: '#0ea5e9' }}>{groupedRules.pacing.config.long_pause_minutes ?? 60} min</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={240}
                  value={Math.min(240, Math.max(1, Number(groupedRules.pacing.config.long_pause_minutes) || 60))}
                  onChange={(e) => updateRuleConfig(groupedRules.pacing!.id, 'long_pause_minutes', parseInt(e.target.value, 10))}
                  style={{ width: '100%', accentColor: '#0ea5e9' }}
                />
              </div>
              <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.2)', display: 'flex', gap: 10 }}>
                <Info size={16} color="#0ea5e9" style={{ flexShrink: 0, marginTop: 2 }} />
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Essas pausas rodam após cada envio bem-sucedido no disparo e não travam a fila global de outras campanhas.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 6. Seleção de Instâncias */}
        {groupedRules.selection && (
          <div className="glass-card flex flex-col col-span-1 md:col-span-2" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', background: 'rgba(245, 158, 11, 0.03)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(245, 158, 11, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Server size={20} color="#f59e0b" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Pool de Disparo</h3>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>Selecione as contas do rodízio</p>
                </div>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={groupedRules.selection.enabled}
                  onChange={(e) => updateRule(groupedRules.selection!.id, { enabled: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div style={{ padding: 24, flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {allInstances.map((inst) => {
                  const isSelected = Array.isArray(groupedRules.selection?.config.selected_instance_ids) 
                    ? groupedRules.selection.config.selected_instance_ids.includes(inst.id)
                    : false;
                  
                  return (
                    <div
                      key={inst.id}
                      onClick={() => {
                        const current = Array.isArray(groupedRules.selection?.config.selected_instance_ids) ? [...groupedRules.selection.config.selected_instance_ids] : [];
                        const updated = isSelected ? current.filter(id => id !== inst.id) : [...current, inst.id];
                        updateRuleConfig(groupedRules.selection!.id, 'selected_instance_ids', updated);
                      }}
                      style={{
                        padding: '12px 16px', borderRadius: 12, cursor: 'pointer',
                        border: '1px solid',
                        borderColor: isSelected ? 'var(--gold-primary)' : 'var(--border)',
                        background: isSelected ? 'rgba(245, 158, 11, 0.08)' : 'var(--bg-elevated)',
                        transition: 'all 0.2s',
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}
                    >
                      <div style={{
                        width: 18, height: 18, borderRadius: 4, border: '2px solid',
                        borderColor: isSelected ? 'var(--gold-primary)' : 'var(--text-muted)',
                        background: isSelected ? 'var(--gold-primary)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {isSelected && <CheckCircle2 size={12} color="#0d0c14" strokeWidth={3} />}
                      </div>
                      <span style={{ fontSize: '0.85rem', fontWeight: isSelected ? 600 : 400, color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {inst.instance_name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Atividade e estatísticas (Fases C / D) */}
      <div className="glass-card" style={{ padding: '22px 24px', marginTop: 32 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: 'linear-gradient(135deg, rgba(52,211,153,0.2), rgba(14,165,233,0.12))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Activity size={24} color="#34d399" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
                Atividade da blindagem
              </h2>
              <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                Resumo por tipo, log recente, filtro por tipo, exportação CSV e paginação
                {instanceId ? ' (instância atual).' : ' (todas as instâncias).'}
                {obsTotal > obsActions.length ? ` Total no filtro: ${obsTotal}.` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadObservability({ fromRefresh: true })}
            disabled={obsRefreshing}
            className="btn-gold"
            style={{
              padding: '10px 20px', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 8,
              opacity: obsRefreshing ? 0.65 : 1, cursor: obsRefreshing ? 'wait' : 'pointer', border: 'none',
            }}
          >
            <RefreshCw size={16} className={obsRefreshing ? 'animate-spin' : ''} />
            Atualizar painel
          </button>
        </div>

        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
          marginBottom: 20, paddingBottom: 18, borderBottom: '1px solid var(--border)',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Tipo</span>
            <select
              value={obsActionFilter}
              onChange={(e) => {
                const v = e.target.value;
                setObsActionFilter(v);
                void loadObservability({ actionFilter: v });
              }}
              style={{
                minWidth: 200,
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
              }}
            >
              <option value="">Todos os tipos</option>
              {BLINDAGE_ACTION_FILTER_IDS.filter(Boolean).map((id) => (
                <option key={id} value={id}>
                  {actionTypeLabel(id)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void handleExportBlindageCsv()}
            disabled={obsExporting}
            style={{
              padding: '10px 18px', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 8,
              borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-elevated)',
              color: 'var(--text-primary)', cursor: obsExporting ? 'wait' : 'pointer', opacity: obsExporting ? 0.65 : 1,
            }}
          >
            <FileDown size={16} />
            {obsExporting ? 'Exportando…' : 'Exportar CSV'}
          </button>
        </div>

        {obsStats.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
            marginBottom: 24,
          }}>
            {obsStats.map((row) => (
              <div
                key={row.action_type}
                style={{
                  padding: '14px 16px', borderRadius: 12, border: '1px solid var(--border)',
                  background: 'var(--bg-elevated)',
                }}
              >
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>
                  {actionTypeLabel(row.action_type)}
                </div>
                <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)' }}>{Number(row.count) || 0}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 6 }}>
                  24h: {Number(row.last_24h) || 0} · 1h: {Number(row.last_hour) || 0}
                </div>
              </div>
            ))}
          </div>
        )}

        {obsStats.length === 0 && obsActions.length === 0 && (
          <p style={{ margin: '0 0 16px', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            Ainda não há registros de blindagem no período consultado. Eles aparecem quando há bloqueios, limites ou envios autorizados pela camada.
          </p>
        )}

        {obsActions.length > 0 && (
          <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid var(--border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '10px 14px', fontWeight: 600 }}>Quando</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600 }}>Tipo</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600 }}>Instância</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600 }}>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {obsActions.map((a) => (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                      {a.created_at ? new Date(a.created_at).toLocaleString('pt-BR') : '—'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>{actionTypeLabel(a.action_type)}</td>
                    <td style={{ padding: '10px 14px' }}>{a.instance_name || (a.instance_id != null ? `#${a.instance_id}` : '—')}</td>
                    <td style={{ padding: '10px 14px', maxWidth: 360 }} title={summarizeActionData(a.action_data)}>
                      {summarizeActionData(a.action_data)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {obsActions.length > 0 && obsActions.length < obsTotal && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <button
              type="button"
              onClick={() => void loadObservability({ append: true })}
              disabled={obsLoadingMore}
              style={{
                padding: '10px 22px', fontSize: '0.875rem', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                cursor: obsLoadingMore ? 'wait' : 'pointer', opacity: obsLoadingMore ? 0.65 : 1,
              }}
            >
              {obsLoadingMore ? 'Carregando…' : `Carregar mais (${obsActions.length} de ${obsTotal})`}
            </button>
          </div>
        )}
      </div>

      {/* Info Banner */}
      <div style={{
        marginTop: 40, padding: '24px 32px', borderRadius: 20,
        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.05), rgba(167, 139, 250, 0.05))',
        border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 24,
      }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <SparklesIcon size={24} color="var(--gold-primary)" />
        </div>
        <div style={{ flex: 1 }}>
          <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Dica do Sistema de Blindagem</h4>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Para máxima segurança, recomendamos utilizar um <strong>Pool de pelo menos 3 instâncias</strong> com <strong>Delay Inteligente entre 5s e 15s</strong>. 
            Isso reduz drasticamente o risco de banimento ao simular interações naturais.
          </p>
        </div>
      </div>
      
      <div style={{ height: 60 }} />
    </div>
  );
}

function SparklesIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" /><path d="M3 5h4" /><path d="M21 17v4" /><path d="M19 19h4" />
    </svg>
  );
}
