import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import {
  Sparkles,
  Save,
  RefreshCw,
  BookOpen,
  User,
  Zap,
  CheckCircle2,
  AlertCircle,
  Brain,
  MessageSquare,
  History,
  Key,
  Plus,
  Trash2,
  Star
} from 'lucide-react';

interface AIConfig {
  central_theme: string;
  journey_description: string;
  preaching_tone: string;
  bible_version: string;
  signature: string;
  gemini_api_key: string;
  model_name: string;
  character_limit: number;
}

interface DevocionalJourney {
  id: number;
  title: string;
  central_theme: string;
  journey_description: string;
  preaching_tone: string;
  bible_version: string;
  signature: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
}

function todaySaoPauloYmd(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return fmt.format(new Date());
}

function ymd(v: string | Date | null | undefined): string {
  if (v == null || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return '';
}

export default function SessaoDevocional() {
  const [config, setConfig] = useState<AIConfig>({
    central_theme: '',
    journey_description: '',
    preaching_tone: '',
    bible_version: 'ACF',
    signature: '',
    gemini_api_key: '',
    model_name: 'gemini-2.5-flash',
    character_limit: 4000
  });
  const [journeys, setJourneys] = useState<DevocionalJourney[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingJourneyId, setSavingJourneyId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showNewJourney, setShowNewJourney] = useState(false);
  const [newActivate, setNewActivate] = useState(true);

  const navigate = useNavigate();
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    loadAll();
  }, [user, navigate]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [cfgRes, jRes] = await Promise.all([
        api.get('/devocional/ai-config'),
        api.get('/devocional/journeys')
      ]);
      if (cfgRes.data.config) {
        setConfig(cfgRes.data.config);
      }
      const list: DevocionalJourney[] = (jRes.data.journeys || []).map((j: DevocionalJourney) => ({
        ...j,
        start_date: ymd(j.start_date as unknown as string),
        end_date: j.end_date ? ymd(j.end_date as unknown as string) : null
      }));
      setJourneys(list);
    } catch (error) {
      console.error('Erro ao carregar:', error);
      setToast({ message: 'Erro ao carregar configurações ou jornadas.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...config };
      if (payload.gemini_api_key === '********') {
        delete payload.gemini_api_key;
      }
      await api.put('/devocional/ai-config', payload);
      setToast({ message: 'Configurações globais salvas!', type: 'success' });
    } catch (error) {
      setToast({ message: 'Erro ao salvar configurações.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const updateJourneyLocal = (id: number, patch: Partial<DevocionalJourney>) => {
    setJourneys(prev => prev.map(j => (j.id === id ? { ...j, ...patch } : j)));
  };

  const saveJourney = async (j: DevocionalJourney) => {
    setSavingJourneyId(j.id);
    try {
      await api.put(`/devocional/journeys/${j.id}`, {
        title: j.title,
        central_theme: j.central_theme,
        journey_description: j.journey_description,
        preaching_tone: j.preaching_tone,
        bible_version: j.bible_version,
        signature: j.signature,
        start_date: j.start_date,
        end_date: j.end_date || null
      });
      setToast({ message: `Jornada "${j.title}" salva.`, type: 'success' });
      await loadAll();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao salvar jornada.',
        type: 'error'
      });
    } finally {
      setSavingJourneyId(null);
    }
  };

  const activateJourney = async (id: number) => {
    try {
      await api.post(`/devocional/journeys/${id}/activate`);
      setToast({ message: 'Jornada ativa atualizada. A geração usará esta jornada.', type: 'success' });
      await loadAll();
    } catch (error) {
      setToast({ message: 'Erro ao ativar jornada.', type: 'error' });
    }
  };

  const deleteJourney = async (j: DevocionalJourney) => {
    if (!confirm(`Excluir a jornada "${j.title}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await api.delete(`/devocional/journeys/${j.id}`);
      setToast({ message: 'Jornada excluída.', type: 'success' });
      await loadAll();
    } catch (error) {
      setToast({ message: 'Erro ao excluir jornada.', type: 'error' });
    }
  };

  const createJourney = async () => {
    try {
      await api.post('/devocional/journeys', {
        title: `Nova jornada — ${todaySaoPauloYmd()}`,
        central_theme: config.central_theme,
        journey_description: config.journey_description,
        preaching_tone: config.preaching_tone,
        bible_version: config.bible_version,
        signature: config.signature,
        start_date: todaySaoPauloYmd(),
        end_date: null,
        activate: newActivate
      });
      setToast({ message: 'Jornada criada.', type: 'success' });
      setShowNewJourney(false);
      await loadAll();
    } catch (error: any) {
      setToast({
        message: error.response?.data?.error || 'Erro ao criar jornada.',
        type: 'error'
      });
    }
  };

  const [testDate, setTestDate] = useState(todaySaoPauloYmd());

  const handleTestGeneration = async () => {
    if (!testDate) {
      setToast({ message: 'Selecione uma data para o teste.', type: 'error' });
      return;
    }

    if (!confirm(`Deseja gerar um devocional para a data ${testDate}? Isso atualizará o conteúdo dessa data no sistema.`)) return;

    setGenerating(true);
    setTestResult(null);
    try {
      const response = await api.post('/devocional/generate', { date: testDate });
      setTestResult(response.data.devocional);
      setToast({ message: 'Devocional gerado com sucesso!', type: 'success' });
    } catch (error: any) {
      setToast({ message: error.response?.data?.message || 'Erro na geração.', type: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <RefreshCw size={40} className="animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          background: toast.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)',
          border: `1px solid ${toast.type === 'success' ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)'}`,
          padding: '14px 20px', borderRadius: 12, backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', gap: 10, color: toast.type === 'success' ? '#34d399' : '#fb7185',
          animation: 'slideIn 0.3s ease-out'
        }}>
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{toast.message}</span>
        </div>
      )}

      <div style={{ marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 20px rgba(245, 158, 11, 0.3)'
          }}>
            <Brain size={28} color="#0d0c14" strokeWidth={2} />
          </div>
          <div>
            <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, fontFamily: 'Outfit' }}>Sessão Devocional</h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              A geração por IA usa a <strong>jornada ativa</strong> (tom, texto e período). Os valores abaixo viram padrão ao criar uma jornada nova.
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, alignItems: 'start' }}>
        <div className="glass-card" style={{ padding: 32 }}>
          <form onSubmit={handleSave}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <label className="label-premium"><Sparkles size={14} /> Tema central (padrão)</label>
                  <input
                    type="text"
                    value={config.central_theme}
                    onChange={(e) => setConfig({ ...config, central_theme: e.target.value })}
                    className="input-dark"
                    placeholder="Ex: Expressar"
                  />
                  <p className="input-hint">Copiado para novas jornadas; cada jornada pode editar o seu.</p>
                </div>
                <div>
                  <label className="label-premium"><BookOpen size={14} /> Versão bíblica (padrão)</label>
                  <select
                    value={config.bible_version}
                    onChange={(e) => setConfig({ ...config, bible_version: e.target.value })}
                    className="input-dark"
                  >
                    <option value="ACF">Almeida Corrigida Fiel (ACF)</option>
                    <option value="NVI">Nova Versão Internacional (NVI)</option>
                    <option value="ARA">Almeida Revista e Atualizada (ARA)</option>
                    <option value="NTLH">Nova Tradução na Linguagem de Hoje (NTLH)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label-premium"><History size={14} /> Descrição da jornada (padrão)</label>
                <textarea
                  value={config.journey_description}
                  onChange={(e) => setConfig({ ...config, journey_description: e.target.value })}
                  className="input-dark"
                  style={{ minHeight: 100, resize: 'vertical' }}
                  placeholder="Descreva o arco espiritual..."
                />
              </div>

              <div>
                <label className="label-premium"><MessageSquare size={14} /> Tom da pregação (padrão)</label>
                <textarea
                  value={config.preaching_tone}
                  onChange={(e) => setConfig({ ...config, preaching_tone: e.target.value })}
                  className="input-dark"
                  style={{ minHeight: 80, resize: 'vertical' }}
                  placeholder="Ex: Afetuoso, inspirador..."
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <label className="label-premium"><User size={14} /> Assinatura (padrão)</label>
                  <input
                    type="text"
                    value={config.signature}
                    onChange={(e) => setConfig({ ...config, signature: e.target.value })}
                    className="input-dark"
                    placeholder="Ex: Alex e Daniela Mantovani"
                  />
                </div>
                <div>
                  <label className="label-premium"><Zap size={14} /> Modelo de IA</label>
                  <select
                    value={config.model_name}
                    onChange={(e) => setConfig({ ...config, model_name: e.target.value })}
                    className="input-dark"
                  >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Rápido ⚡)</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro (Mais profundo 🧠)</option>
                  </select>
                </div>
              </div>

              <div style={{
                padding: 20, borderRadius: 16, background: 'rgba(245, 158, 11, 0.05)',
                border: '1px solid rgba(245, 158, 11, 0.1)', marginTop: 8
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--gold-primary)' }}>
                    <Key size={18} />
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Credenciais de IA</span>
                  </div>
                  {config.gemini_api_key === '********' && (
                    <span style={{ fontSize: '0.65rem', background: 'rgba(16,185,129,0.1)', color: '#10b981', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                      SALVO NO BANCO
                    </span>
                  )}
                </div>
                <input
                  type="password"
                  value={config.gemini_api_key}
                  onChange={(e) => setConfig({ ...config, gemini_api_key: e.target.value })}
                  className="input-dark"
                  placeholder="Sua API Key do Gemini"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="btn-gold"
                style={{ width: '100%', padding: '16px', marginTop: 12, border: 'none', borderRadius: 12 }}
              >
                {saving ? <RefreshCw size={20} className="animate-spin" /> : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <Save size={20} />
                    <span>Salvar padrões globais</span>
                  </div>
                )}
              </button>
            </div>
          </form>

          <div style={{ height: 1, background: 'var(--border)', margin: '32px 0' }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>Jornadas</h2>
            <button
              type="button"
              onClick={() => setShowNewJourney(v => !v)}
              className="btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', fontSize: '0.85rem' }}
            >
              <Plus size={16} />
              Nova jornada
            </button>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 20px', lineHeight: 1.5 }}>
            Cada jornada é um <strong>novo início</strong>: período próprio, texto e tom. Só a jornada <strong>ativa</strong> entra na geração.
            O primeiro devocional dentro do período (sem registros anteriores nessa jornada) recebe instruções especiais de abertura na IA.
          </p>

          {showNewJourney && (
            <div style={{
              padding: 16, borderRadius: 12, marginBottom: 20,
              border: '1px solid rgba(59, 130, 246, 0.25)', background: 'rgba(59, 130, 246, 0.06)'
            }}>
              <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Será criada com os padrões globais acima, início em <strong>{todaySaoPauloYmd()}</strong> (edite depois no card).
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', marginBottom: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={newActivate} onChange={(e) => setNewActivate(e.target.checked)} />
                Tornar esta jornada a ativa ao criar
              </label>
              <button type="button" onClick={createJourney} className="btn-gold" style={{ padding: '10px 18px', border: 'none', borderRadius: 10 }}>
                Criar jornada
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {journeys.map(j => (
              <div
                key={j.id}
                style={{
                  padding: 20, borderRadius: 16,
                  border: j.is_active ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid var(--border)',
                  background: j.is_active ? 'rgba(245, 158, 11, 0.06)' : 'rgba(0,0,0,0.15)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {j.is_active && (
                      <span style={{
                        fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.06em',
                        padding: '4px 10px', borderRadius: 20, background: 'rgba(245,158,11,0.2)', color: '#fbbf24'
                      }}>
                        ATIVA NA IA
                      </span>
                    )}
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>#{j.id}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {!j.is_active && (
                      <button type="button" onClick={() => activateJourney(j.id)} className="btn-outline" style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Star size={14} /> Ativar
                      </button>
                    )}
                    <button type="button" onClick={() => deleteJourney(j)} className="btn-outline" style={{ padding: '6px 12px', fontSize: '0.75rem', color: '#fb7185', borderColor: 'rgba(251,113,133,0.35)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Trash2 size={14} /> Excluir
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label className="label-premium" style={{ fontSize: '0.7rem' }}>Nome</label>
                  <input
                    className="input-dark"
                    value={j.title}
                    onChange={(e) => updateJourneyLocal(j.id, { title: e.target.value })}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label className="label-premium" style={{ fontSize: '0.7rem' }}>Início</label>
                    <input
                      type="date"
                      className="input-dark"
                      style={{ colorScheme: 'dark' }}
                      value={j.start_date}
                      onChange={(e) => updateJourneyLocal(j.id, { start_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label-premium" style={{ fontSize: '0.7rem' }}>Fim (opcional)</label>
                    <input
                      type="date"
                      className="input-dark"
                      style={{ colorScheme: 'dark' }}
                      value={j.end_date ?? ''}
                      onChange={(e) => updateJourneyLocal(j.id, { end_date: e.target.value || null })}
                    />
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="label-premium" style={{ fontSize: '0.7rem' }}>Tema central</label>
                  <input
                    className="input-dark"
                    value={j.central_theme}
                    onChange={(e) => updateJourneyLocal(j.id, { central_theme: e.target.value })}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="label-premium" style={{ fontSize: '0.7rem' }}>Descrição da jornada</label>
                  <textarea
                    className="input-dark"
                    style={{ minHeight: 72, resize: 'vertical' }}
                    value={j.journey_description}
                    onChange={(e) => updateJourneyLocal(j.id, { journey_description: e.target.value })}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="label-premium" style={{ fontSize: '0.7rem' }}>Tom da pregação</label>
                  <textarea
                    className="input-dark"
                    style={{ minHeight: 56, resize: 'vertical' }}
                    value={j.preaching_tone}
                    onChange={(e) => updateJourneyLocal(j.id, { preaching_tone: e.target.value })}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label className="label-premium" style={{ fontSize: '0.7rem' }}>Bíblia</label>
                    <select
                      className="input-dark"
                      value={j.bible_version}
                      onChange={(e) => updateJourneyLocal(j.id, { bible_version: e.target.value })}
                    >
                      <option value="ACF">ACF</option>
                      <option value="NVI">NVI</option>
                      <option value="ARA">ARA</option>
                      <option value="NTLH">NTLH</option>
                    </select>
                  </div>
                  <div>
                    <label className="label-premium" style={{ fontSize: '0.7rem' }}>Assinatura</label>
                    <input
                      className="input-dark"
                      value={j.signature}
                      onChange={(e) => updateJourneyLocal(j.id, { signature: e.target.value })}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={savingJourneyId === j.id}
                  onClick={() => saveJourney(j)}
                  className="btn-gold"
                  style={{ width: '100%', padding: '12px', border: 'none', borderRadius: 10, marginTop: 4 }}
                >
                  {savingJourneyId === j.id ? <RefreshCw size={18} className="animate-spin" /> : (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Save size={18} /> Salvar esta jornada
                    </span>
                  )}
                </button>
              </div>
            ))}
            {journeys.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Nenhuma jornada cadastrada. Crie uma com o botão acima (o sistema migra uma jornada inicial ao atualizar o servidor).</p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div className="glass-card" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700 }}>Status da Geração</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Motor de IA</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--gold-primary)' }}>Gemini Ativado</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Jornada ativa</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {journeys.find(x => x.is_active)?.title ?? '—'}
                </span>
              </div>

              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

              <div>
                <label className="label-premium" style={{ fontSize: '0.7rem' }}>📅 Data para Gerar</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="date"
                    id="test-date-input"
                    value={testDate}
                    onChange={(e) => setTestDate(e.target.value)}
                    className="input-dark"
                    style={{ padding: '10px 44px 10px 14px', fontSize: '0.9rem', marginBottom: 0, width: '100%', cursor: 'pointer', colorScheme: 'dark' }}
                  />
                  <label
                    htmlFor="test-date-input"
                    style={{
                      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      cursor: 'pointer', color: 'var(--gold-primary)', pointerEvents: 'none'
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
                      <line x1="16" x2="16" y1="2" y2="6"/>
                      <line x1="8" x2="8" y1="2" y2="6"/>
                      <line x1="3" x2="21" y1="10" y2="10"/>
                    </svg>
                  </label>
                </div>
                <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 6 }}>Datas futuras são seguras — não afetam o disparo de hoje.</p>
              </div>

              <button
                onClick={handleTestGeneration}
                disabled={generating}
                className="btn-outline"
                style={{ width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                {generating ? <RefreshCw size={18} className="animate-spin" /> : (
                  <>
                    <Zap size={18} />
                    <span>Gerar Devocional Agora</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {testResult && (
            <div className="glass-card" style={{ padding: 24, background: 'rgba(16, 185, 129, 0.03)', borderColor: 'rgba(16, 185, 129, 0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#10b981', marginBottom: 12 }}>
                <CheckCircle2 size={18} />
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Resultado do Teste</h3>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxHeight: 300, overflowY: 'auto', padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                <div style={{ marginBottom: 10 }}>
                  <strong>Título:</strong> {testResult.title}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.82rem', lineHeight: 1.45 }}>{testResult.text}</div>
              </div>
              <button
                onClick={() => setTestResult(null)}
                style={{ width: '100%', marginTop: 12, padding: '8px', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                Limpar Visualização
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .label-premium {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.8rem;
          font-weight: 700;
          color: var(--text-secondary);
          margin-bottom: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .input-hint {
          font-size: 0.7rem;
          color: var(--text-muted);
          margin: 6px 0 0;
        }
        @keyframes slideIn {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
