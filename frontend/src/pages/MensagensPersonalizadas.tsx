import { useState, useEffect } from 'react';
import api from '@/lib/api';
import {
  MessageCircle,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Link,
  Key,
  X,
  Info,
  Sparkles,
} from 'lucide-react';

interface MensagensConfig {
  id?: number;
  ai_webhook_url?: string;
  positive_keywords: string[];
  sentiment_analysis_enabled: boolean;
  enabled: boolean;
}

export default function MensagensPersonalizadas() {
  const [config, setConfig] = useState<MensagensConfig>({
    positive_keywords: ['interesse', 'quero', 'me chama', 'gostei'],
    sentiment_analysis_enabled: true,
    enabled: true,
  });
  const [newKeyword, setNewKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const response = await api.get('/marketing/config');
      if (response.data.config) setConfig(response.data.config);
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao carregar configuração', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.put('/marketing/config', config);
      setToast({ message: 'Configuração salva com sucesso!', type: 'success' });
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Erro ao salvar configuração', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const addKeyword = () => {
    const kw = newKeyword.trim().toLowerCase();
    if (kw && !config.positive_keywords.includes(kw)) {
      setConfig({ ...config, positive_keywords: [...config.positive_keywords, kw] });
      setNewKeyword('');
    }
  };

  const removeKeyword = (keyword: string) => {
    setConfig({ ...config, positive_keywords: config.positive_keywords.filter((k) => k !== keyword) });
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
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Carregando configuração...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          background: toast.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)',
          border: `1px solid ${toast.type === 'success' ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)'}`,
          color: toast.type === 'success' ? '#34d399' : '#fb7185',
          backdropFilter: 'blur(12px)',
        }}>
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.875rem', fontWeight: 500 }}>{toast.message}</span>
        </div>
      )}

      {/* Header Section */}
      <div style={{ marginBottom: 40 }}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: 'linear-gradient(135deg, #a78bfa, #6d28d9)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 20px rgba(167, 139, 250, 0.3)',
              flexShrink: 0,
            }}>
              <MessageCircle size={28} color="#fff" strokeWidth={2} />
            </div>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em', fontFamily: 'Outfit, sans-serif' }}>
                Mensagens Personalizadas
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span className="badge badge-violet">Inteligência Artificial</span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Automate seu atendimento com IA</span>
              </div>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !config.ai_webhook_url}
            className="btn-gold"
            style={{
              padding: '12px 28px', fontSize: '0.95rem',
              display: 'flex', alignItems: 'center', gap: 10,
              opacity: (saving || !config.ai_webhook_url) ? 0.6 : 1,
              cursor: (saving || !config.ai_webhook_url) ? 'not-allowed' : 'pointer',
              border: 'none',
            }}
          >
            {saving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
            {saving ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column - Configuration */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Card Webhook */}
          <div className="glass-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(245, 158, 11, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Link size={18} color="var(--gold-primary)" />
              </div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Webhook da IA Externa</h3>
            </div>
            
            <div style={{ position: 'relative' }}>
              <input
                type="url"
                value={config.ai_webhook_url || ''}
                onChange={(e) => setConfig({ ...config, ai_webhook_url: e.target.value })}
                placeholder="https://sua-ia.com/webhook"
                className="input-dark"
                style={{ width: '100%', padding: '14px 16px', borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
              />
            </div>
            
            <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 12, background: 'rgba(167, 139, 250, 0.05)', border: '1px solid rgba(167, 139, 250, 0.1)' }}>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                O sistema enviará os seguintes dados para o webhook quando uma intenção positiva for detectada:
                <br />
                <code style={{ color: 'var(--violet)', fontWeight: 600 }}>dispatch_id, contact_name, contact_phone, user_message</code>
              </p>
            </div>
          </div>

          {/* Card Keywords */}
          <div className="glass-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(245, 158, 11, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Key size={18} color="var(--gold-primary)" />
              </div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Palavras-chave de Resposta Positiva</h3>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                placeholder="Adicionar nova palavra-chave..."
                className="input-dark"
                style={{ flex: 1, padding: '14px 16px', borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
              />
              <button
                onClick={addKeyword}
                className="btn-gold"
                style={{ padding: '0 24px', borderRadius: 12, border: 'none', cursor: 'pointer' }}
              >
                Adicionar
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {config.positive_keywords.map((keyword) => (
                <div
                  key={keyword}
                  style={{
                    padding: '8px 16px', borderRadius: 12, background: 'rgba(167, 139, 250, 0.1)',
                    border: '1px solid rgba(167, 139, 250, 0.2)', color: 'var(--text-primary)',
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem', fontWeight: 600,
                  }}
                >
                  {keyword}
                  <button
                    onClick={() => removeKeyword(keyword)}
                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 0, display: 'flex' }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {config.positive_keywords.length === 0 && (
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Nenhuma palavra-chave definida</span>
              )}
            </div>
          </div>

          {/* Card Settings */}
          <div className="glass-card" style={{ padding: 24 }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(245, 158, 11, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Sparkles size={18} color="var(--gold-primary)" />
              </div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Configurações Inteligentes</h3>
            </div>

            <div className="space-y-4">
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '16px 20px', borderRadius: 16, background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border)',
              }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>Análise de Sentimento (OpenAI)</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>Usa IA para analisar o sentimento além das palavras-chave</div>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={config.sentiment_analysis_enabled}
                    onChange={(e) => setConfig({ ...config, sentiment_analysis_enabled: e.target.checked })}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '16px 20px', borderRadius: 16, background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border)',
              }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>Sistema de IA Habilitado</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>Ativa ou desativa o envio automático para a IA</div>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Info */}
        <div className="lg:col-span-4">
          <div className="glass-card" style={{ padding: 24, background: 'linear-gradient(180deg, rgba(167, 139, 250, 0.05) 0%, transparent 100%)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <Info size={20} color="var(--violet)" />
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Como funciona?</h3>
            </div>
            
            <div className="space-y-6">
              {[
                { title: 'Interação', desc: 'O contato responde a um de seus disparos de devocional ou interação.' },
                { title: 'Detecção', desc: 'O sistema analisa a resposta buscando palavras-chave positivas ou usando análise de sentimento via IA.' },
                { title: 'Encaminhamento', desc: 'Se a resposta for positiva, os dados são enviados para seu webhook da IA externa.' },
                { title: 'Atendimento', desc: 'Sua IA externa assume a conversa e inicia o atendimento personalizado imediatamente.' },
              ].map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', background: 'rgba(167, 139, 250, 0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.75rem', fontWeight: 800, color: 'var(--violet)', flexShrink: 0, marginTop: 2
                  }}>
                    {i + 1}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.85rem' }}>{step.title}</div>
                    <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 32, padding: 20, borderRadius: 16, background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.1)' }}>
              <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: 'var(--gold-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={14} /> Dica de Especialista
              </h4>
              <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Use palavras-chave como "quero", "interesse" e "preço" para garantir que apenas leads qualificados sejam enviados para a IA, economizando seus tokens.
              </p>
            </div>
          </div>
        </div>
      </div>
      
      <div style={{ height: 60 }} />
    </div>
  );
}
