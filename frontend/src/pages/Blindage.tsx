import { useEffect, useState } from 'react';
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
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      setToast({ message: 'Erro ao carregar configurações de blindagem', type: 'error' });
    } finally {
      setLoading(false);
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
    rotation: rules.find(r => r.rule_type === 'instance_rotation'),
    hours: rules.find(r => r.rule_type === 'allowed_hours'),
    health: rules.find(r => r.rule_type === 'health_check'),
    content: rules.find(r => r.rule_type === 'content_validation'),
    number: rules.find(r => r.rule_type === 'number_validation'),
    selection: rules.find(r => r.rule_type === 'instance_selection'),
    pacing: rules.find(r => r.rule_type === 'dispatch_pacing'),
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
              <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.2)', display: 'flex', gap: 10 }}>
                <Info size={16} color="var(--violet)" style={{ flexShrink: 0, marginTop: 2 }} />
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>O rodízio ajuda a simular comportamento humano e distribui o risco entre as contas.</p>
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
