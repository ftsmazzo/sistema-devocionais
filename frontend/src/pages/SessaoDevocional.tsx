import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import {
  Save,
  RefreshCw,
  BookOpen,
  Zap,
  CheckCircle2,
  AlertCircle,
  Brain,
  History,
  Key,
  Plus,
  Trash2,
  Star,
  Cpu
} from 'lucide-react';

/** Só o que é realmente global para o motor de IA (Gemini). */
interface GlobalAIConfig {
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

interface NewJourneyDraft {
  title: string;
  central_theme: string;
  journey_description: string;
  preaching_tone: string;
  bible_version: string;
  signature: string;
  start_date: string;
  end_date: string;
}

const CREATIVE_DEFAULTS = {
  central_theme: 'Expressar',
  journey_description: 'Uma jornada de fé focada em expressar Cristo no dia a dia.',
  preaching_tone: 'Afetuoso, inspirador, levemente bem humorado e acolhedor.',
  bible_version: 'ACF',
  signature: ''
};

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
  const [globalCfg, setGlobalCfg] = useState<GlobalAIConfig>({
    gemini_api_key: '',
    model_name: 'gemini-2.5-flash',
    character_limit: 4000
  });
  const [journeys, setJourneys] = useState<DevocionalJourney[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingJourneyId, setSavingJourneyId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showNewJourney, setShowNewJourney] = useState(false);
  const [newActivate, setNewActivate] = useState(true);
  const [newDraft, setNewDraft] = useState<NewJourneyDraft>(() => ({
    title: '',
    ...CREATIVE_DEFAULTS,
    start_date: todaySaoPauloYmd(),
    end_date: ''
  }));

  const navigate = useNavigate();
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    loadAll();
  }, [user, navigate]);

  function buildNewDraft(): NewJourneyDraft {
    const active = journeys.find(j => j.is_active);
    const day = todaySaoPauloYmd();
    if (active) {
      return {
        title: `Nova jornada — ${day}`,
        central_theme: active.central_theme,
        journey_description: active.journey_description,
        preaching_tone: active.preaching_tone,
        bible_version: active.bible_version,
        signature: active.signature,
        start_date: day,
        end_date: ''
      };
    }
    return {
      title: `Nova jornada — ${day}`,
      ...CREATIVE_DEFAULTS,
      start_date: day,
      end_date: ''
    };
  }

  const loadAll = async () => {
    try {
      setLoading(true);
      const [cfgRes, jRes] = await Promise.all([
        api.get('/devocional/ai-config'),
        api.get('/devocional/journeys')
      ]);
      const c = cfgRes.data.config;
      if (c) {
        setGlobalCfg({
          gemini_api_key: c.gemini_api_key ?? '',
          model_name: c.model_name ?? 'gemini-2.5-flash',
          character_limit: Number(c.character_limit) || 4000
        });
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

  const handleSaveGlobal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingGlobal(true);
    try {
      const payload: Record<string, unknown> = {
        model_name: globalCfg.model_name,
        character_limit: globalCfg.character_limit
      };
      if (globalCfg.gemini_api_key && globalCfg.gemini_api_key !== '********') {
        payload.gemini_api_key = globalCfg.gemini_api_key.trim();
      }
      await api.put('/devocional/ai-config', payload);
      setToast({ message: 'Motor de IA (global) salvo.', type: 'success' });
      await loadAll();
    } catch (error) {
      setToast({ message: 'Erro ao salvar.', type: 'error' });
    } finally {
      setSavingGlobal(false);
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
      setToast({ message: 'Jornada ativa atualizada.', type: 'success' });
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
        title: newDraft.title.trim() || `Nova jornada — ${todaySaoPauloYmd()}`,
        central_theme: newDraft.central_theme,
        journey_description: newDraft.journey_description,
        preaching_tone: newDraft.preaching_tone,
        bible_version: newDraft.bible_version,
        signature: newDraft.signature,
        start_date: newDraft.start_date,
        end_date: newDraft.end_date.trim() || null,
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
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
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

      <div style={{ marginBottom: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 20px rgba(245, 158, 11, 0.3)'
          }}>
            <Brain size={28} color="#0d0c14" strokeWidth={2} />
          </div>
          <div>
            <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, fontFamily: 'Outfit' }}>Jornada Bíblica</h1>
            <p style={{ margin: '6px 0 0', fontSize: '0.88rem', color: 'var(--text-secondary)', maxWidth: 640, lineHeight: 1.45 }}>
              Motor Gemini (global) e jornadas com tema, tom e período. A IA usa sempre a jornada marcada como <strong>ativa</strong>.
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Card — Global */}
          <div className="glass-card" style={{ padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Cpu size={22} color="var(--gold-primary)" />
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>Motor de IA (global)</h2>
            </div>
            <p className="input-hint" style={{ marginBottom: 20 }}>
              Aqui fica só o que vale para <strong>todo</strong> o sistema: credencial Gemini, modelo e limite de caracteres. Tom, tema e texto ficam em cada jornada.
            </p>
            <form onSubmit={handleSaveGlobal}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 }}>
                <div>
                  <label className="label-premium"><Zap size={14} /> Modelo</label>
                  <select
                    value={globalCfg.model_name}
                    onChange={(e) => setGlobalCfg({ ...globalCfg, model_name: e.target.value })}
                    className="input-dark"
                  >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                  </select>
                </div>
                <div>
                  <label className="label-premium"><BookOpen size={14} /> Limite de caracteres</label>
                  <input
                    type="number"
                    min={500}
                    max={32000}
                    value={globalCfg.character_limit}
                    onChange={(e) => setGlobalCfg({ ...globalCfg, character_limit: parseInt(e.target.value, 10) || 4000 })}
                    className="input-dark"
                  />
                </div>
              </div>
              <div style={{
                padding: 18, borderRadius: 14, background: 'rgba(245, 158, 11, 0.05)',
                border: '1px solid rgba(245, 158, 11, 0.12)', marginBottom: 18
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gold-primary)' }}>
                    <Key size={18} />
                    <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>API Key do Gemini</span>
                  </div>
                  {globalCfg.gemini_api_key === '********' && (
                    <span style={{ fontSize: '0.62rem', background: 'rgba(16,185,129,0.12)', color: '#10b981', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                      SALVO
                    </span>
                  )}
                </div>
                <input
                  type="password"
                  value={globalCfg.gemini_api_key}
                  onChange={(e) => setGlobalCfg({ ...globalCfg, gemini_api_key: e.target.value })}
                  className="input-dark"
                  placeholder="Cole uma chave nova para substituir a salva"
                />
                <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 8 }}>
                  Deixe em branco ou mantenha <strong>********</strong> para não alterar a chave já gravada. Ou defina <code style={{ fontSize: '0.65rem' }}>GEMINI_API_KEY</code> no servidor.
                </p>
              </div>
              <button
                type="submit"
                disabled={savingGlobal}
                className="btn-gold"
                style={{ width: '100%', padding: '14px', border: 'none', borderRadius: 12 }}
              >
                {savingGlobal ? <RefreshCw size={20} className="animate-spin" /> : (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <Save size={20} /> Salvar motor global
                  </span>
                )}
              </button>
            </form>
          </div>

          {/* Card — Jornadas */}
          <div className="glass-card" style={{ padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <h2 style={{ margin: '0 0 8px', fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>Suas jornadas</h2>
                <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  Crie sua Jornada da Palavra de Deus e compartilhe com seus irmãos.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (showNewJourney) setShowNewJourney(false);
                  else {
                    setNewDraft(buildNewDraft());
                    setShowNewJourney(true);
                  }
                }}
                className="btn-outline"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', fontSize: '0.88rem', flexShrink: 0 }}
              >
                <Plus size={18} />
                {showNewJourney ? 'Fechar' : 'Nova jornada'}
              </button>
            </div>
            <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0 0 20px', lineHeight: 1.5 }}>
              Cada jornada é um <strong>novo início</strong> (período, tema e tom). Só a <strong>ativa</strong> entra na geração. O primeiro dia da jornada recebe instruções especiais na IA.
            </p>

            {showNewJourney && (
              <div style={{
                padding: 20, borderRadius: 14, marginBottom: 22,
                border: '1px solid rgba(59, 130, 246, 0.28)', background: 'rgba(59, 130, 246, 0.07)'
              }}>
                <p style={{ margin: '0 0 16px', fontSize: '0.8rem', fontWeight: 700, color: '#93c5fd' }}>Nova jornada — preencha e crie</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label className="label-premium" style={{ fontSize: '0.68rem' }}>Nome</label>
                    <input className="input-dark" value={newDraft.title} onChange={(e) => setNewDraft({ ...newDraft, title: e.target.value })} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label className="label-premium" style={{ fontSize: '0.68rem' }}>Início</label>
                      <input type="date" className="input-dark" style={{ colorScheme: 'dark' }} value={newDraft.start_date} onChange={(e) => setNewDraft({ ...newDraft, start_date: e.target.value })} />
                    </div>
                    <div>
                      <label className="label-premium" style={{ fontSize: '0.68rem' }}>Fim (opcional)</label>
                      <input type="date" className="input-dark" style={{ colorScheme: 'dark' }} value={newDraft.end_date} onChange={(e) => setNewDraft({ ...newDraft, end_date: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="label-premium" style={{ fontSize: '0.68rem' }}>Tema central</label>
                    <input className="input-dark" value={newDraft.central_theme} onChange={(e) => setNewDraft({ ...newDraft, central_theme: e.target.value })} />
                  </div>
                  <div>
                    <label className="label-premium" style={{ fontSize: '0.68rem' }}>Descrição da jornada</label>
                    <textarea className="input-dark" style={{ minHeight: 80, resize: 'vertical' }} value={newDraft.journey_description} onChange={(e) => setNewDraft({ ...newDraft, journey_description: e.target.value })} />
                  </div>
                  <div>
                    <label className="label-premium" style={{ fontSize: '0.68rem' }}>Tom da pregação</label>
                    <textarea className="input-dark" style={{ minHeight: 64, resize: 'vertical' }} value={newDraft.preaching_tone} onChange={(e) => setNewDraft({ ...newDraft, preaching_tone: e.target.value })} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label className="label-premium" style={{ fontSize: '0.68rem' }}>Bíblia</label>
                      <select className="input-dark" value={newDraft.bible_version} onChange={(e) => setNewDraft({ ...newDraft, bible_version: e.target.value })}>
                        <option value="ACF">ACF</option>
                        <option value="NVI">NVI</option>
                        <option value="ARA">ARA</option>
                        <option value="NTLH">NTLH</option>
                      </select>
                    </div>
                    <div>
                      <label className="label-premium" style={{ fontSize: '0.68rem' }}>Assinatura</label>
                      <input className="input-dark" value={newDraft.signature} onChange={(e) => setNewDraft({ ...newDraft, signature: e.target.value })} />
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={newActivate} onChange={(e) => setNewActivate(e.target.checked)} />
                    Tornar esta jornada a ativa ao criar
                  </label>
                  <button type="button" onClick={createJourney} className="btn-gold" style={{ padding: '12px 18px', border: 'none', borderRadius: 10, alignSelf: 'flex-start' }}>
                    Criar jornada
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {journeys.map(j => (
                <div
                  key={j.id}
                  style={{
                    padding: 20, borderRadius: 16,
                    border: j.is_active ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid var(--border)',
                    background: j.is_active ? 'rgba(245, 158, 11, 0.06)' : 'rgba(0,0,0,0.12)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {j.is_active && (
                        <span style={{
                          fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.06em',
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
                    <label className="label-premium" style={{ fontSize: '0.68rem' }}>Nome</label>
                    <input className="input-dark" value={j.title} onChange={(e) => updateJourneyLocal(j.id, { title: e.target.value })} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label className="label-premium" style={{ fontSize: '0.68rem' }}>Início</label>
                      <input type="date" className="input-dark" style={{ colorScheme: 'dark' }} value={j.start_date} onChange={(e) => updateJourneyLocal(j.id, { start_date: e.target.value })} />
                    </div>
                    <div>
                      <label className="label-premium" style={{ fontSize: '0.68rem' }}>Fim (opcional)</label>
                      <input type="date" className="input-dark" style={{ colorScheme: 'dark' }} value={j.end_date ?? ''} onChange={(e) => updateJourneyLocal(j.id, { end_date: e.target.value || null })} />
                    </div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label className="label-premium" style={{ fontSize: '0.68rem' }}>Tema central</label>
                    <input className="input-dark" value={j.central_theme} onChange={(e) => updateJourneyLocal(j.id, { central_theme: e.target.value })} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label className="label-premium" style={{ fontSize: '0.68rem' }}>Descrição da jornada</label>
                    <textarea className="input-dark" style={{ minHeight: 72, resize: 'vertical' }} value={j.journey_description} onChange={(e) => updateJourneyLocal(j.id, { journey_description: e.target.value })} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label className="label-premium" style={{ fontSize: '0.68rem' }}>Tom da pregação</label>
                    <textarea className="input-dark" style={{ minHeight: 56, resize: 'vertical' }} value={j.preaching_tone} onChange={(e) => updateJourneyLocal(j.id, { preaching_tone: e.target.value })} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label className="label-premium" style={{ fontSize: '0.68rem' }}>Bíblia</label>
                      <select className="input-dark" value={j.bible_version} onChange={(e) => updateJourneyLocal(j.id, { bible_version: e.target.value })}>
                        <option value="ACF">ACF</option>
                        <option value="NVI">NVI</option>
                        <option value="ARA">ARA</option>
                        <option value="NTLH">NTLH</option>
                      </select>
                    </div>
                    <div>
                      <label className="label-premium" style={{ fontSize: '0.68rem' }}>Assinatura</label>
                      <input className="input-dark" value={j.signature} onChange={(e) => updateJourneyLocal(j.id, { signature: e.target.value })} />
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
              {journeys.length === 0 && !showNewJourney && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Nenhuma jornada. Clique em <strong>+ Nova jornada</strong> para começar.</p>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div className="glass-card" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', fontWeight: 700 }}>Testar geração</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Jornada ativa</span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-primary)', textAlign: 'right', maxWidth: 180 }}>
                  {journeys.find(x => x.is_active)?.title ?? '—'}
                </span>
              </div>
              <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
              <div>
                <label className="label-premium" style={{ fontSize: '0.68rem' }}>Data</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="date"
                    id="test-date-input"
                    value={testDate}
                    onChange={(e) => setTestDate(e.target.value)}
                    className="input-dark"
                    style={{ padding: '10px 40px 10px 12px', fontSize: '0.88rem', marginBottom: 0, width: '100%', cursor: 'pointer', colorScheme: 'dark' }}
                  />
                  <label htmlFor="test-date-input" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--gold-primary)', pointerEvents: 'none' }}>
                    <History size={16} />
                  </label>
                </div>
                <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 6 }}>Atualiza o devocional dessa data no banco.</p>
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
                    <span>Gerar agora</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {testResult && (
            <div className="glass-card" style={{ padding: 22, background: 'rgba(16, 185, 129, 0.03)', borderColor: 'rgba(16, 185, 129, 0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#10b981', marginBottom: 12 }}>
                <CheckCircle2 size={18} />
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Pré-visualização</h3>
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxHeight: 280, overflowY: 'auto', padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                <div style={{ marginBottom: 10 }}>
                  <strong>Título:</strong> {testResult.title}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', lineHeight: 1.45 }}>{testResult.text}</div>
              </div>
              <button
                onClick={() => setTestResult(null)}
                style={{ width: '100%', marginTop: 12, padding: '8px', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.78rem', cursor: 'pointer' }}
              >
                Limpar
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
          font-size: 0.72rem;
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
