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
  Key
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
  const navigate = useNavigate();
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    loadConfig();
  }, [user, navigate]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const response = await api.get('/devocional/ai-config');
      if (response.data.config) {
        setConfig(response.data.config);
      }
    } catch (error) {
      console.error('Erro ao carregar config de IA:', error);
      setToast({ message: 'Erro ao carregar configurações.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/devocional/ai-config', config);
      setToast({ message: 'Configurações de IA salvas com sucesso!', type: 'success' });
    } catch (error) {
      setToast({ message: 'Erro ao salvar configurações.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const [testDate, setTestDate] = useState(new Date().toISOString().split('T')[0]);

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
      {/* Toast */}
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

      {/* Header */}
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
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Configure o "Pastor Virtual" e controle a jornada espiritual da sua lista.</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, alignItems: 'start' }}>
        {/* Main Config Form */}
        <div className="glass-card" style={{ padding: 32 }}>
          <form onSubmit={handleSave}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <label className="label-premium"><Sparkles size={14} /> Tema Central</label>
                  <input
                    type="text"
                    value={config.central_theme}
                    onChange={(e) => setConfig({ ...config, central_theme: e.target.value })}
                    className="input-dark"
                    placeholder="Ex: Expressar"
                  />
                  <p className="input-hint">O coração da jornada espiritual.</p>
                </div>
                <div>
                  <label className="label-premium"><BookOpen size={14} /> Versão Bíblica</label>
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
                  <p className="input-hint">Tradução usada nos versículos.</p>
                </div>
              </div>

              <div>
                <label className="label-premium"><History size={14} /> Descrição da Jornada</label>
                <textarea
                  value={config.journey_description}
                  onChange={(e) => setConfig({ ...config, journey_description: e.target.value })}
                  className="input-dark"
                  style={{ minHeight: 100, resize: 'vertical' }}
                  placeholder="Descreva como a jornada deve evoluir ao longo do tempo..."
                />
                <p className="input-hint">Instruções para a IA manter a progressão teológica.</p>
              </div>

              <div>
                <label className="label-premium"><MessageSquare size={14} /> Tom da Pregação</label>
                <textarea
                  value={config.preaching_tone}
                  onChange={(e) => setConfig({ ...config, preaching_tone: e.target.value })}
                  className="input-dark"
                  style={{ minHeight: 80, resize: 'vertical' }}
                  placeholder="Ex: Afetuoso, inspirador, levemente bem humorado e acolhedor."
                />
                <p className="input-hint">Define a "personalidade" do devocional.</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <label className="label-premium"><User size={14} /> Assinatura Final</label>
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
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 8 }}>
                  {config.gemini_api_key === '********' 
                    ? 'A chave está salva de forma segura. Insira uma nova para substituir.' 
                    : 'Insira sua chave API do Gemini para habilitar a geração.'}
                </p>
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
                    <span>Salvar Configurações Criativas</span>
                  </div>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Sidebar: Status & Testing */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div className="glass-card" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700 }}>Status da Geração</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Motor de IA</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--gold-primary)' }}>Gemini Ativado</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Geração Automática</span>
                <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 20, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontWeight: 700 }}>ATIVO</span>
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
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap', padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                <strong>Título:</strong> {testResult.title}\n\n
                {testResult.text}
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
