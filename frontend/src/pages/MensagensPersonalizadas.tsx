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
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
    <div style={{ maxWidth: 720 }}>
      {/* Toast */}
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
          {toast.type === 'success'
            ? <CheckCircle2 size={18} strokeWidth={2} />
            : <AlertCircle size={18} strokeWidth={2} />
          }
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.875rem', fontWeight: 500 }}>
            {toast.message}
          </span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', marginLeft: 4 }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, flexShrink: 0,
            background: 'linear-gradient(135deg, #a78bfa, #6d28d9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 15px rgba(167,139,250,0.35)',
          }}>
            <MessageCircle size={24} color="#fff" strokeWidth={2} />
          </div>
          <div>
            <h1 style={{
              fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '1.5rem',
              color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em',
            }}>
              Mensagens Personalizadas
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0, fontFamily: 'Inter, sans-serif' }}>
              Configure respostas automáticas com IA para interações personalizadas
            </p>
          </div>
        </div>
      </div>

      {/* Card Webhook */}
      <div className="glass-card" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Link size={16} style={{ color: 'var(--gold-primary)' }} />
          <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
            Webhook da IA Externa
          </span>
        </div>
        <input
          type="url"
          value={config.ai_webhook_url || ''}
          onChange={(e) => setConfig({ ...config, ai_webhook_url: e.target.value })}
          placeholder="https://sua-ia.com/webhook"
          className="input-dark"
          style={{ marginBottom: 8 }}
        />
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>
          Quando detectar intenção positiva, o sistema enviará: <code style={{ color: 'var(--violet)', background: 'rgba(167,139,250,0.1)', padding: '1px 6px', borderRadius: 4 }}>dispatch_id, contact_name, contact_phone, user_message</code>
        </p>
      </div>

      {/* Card Keywords */}
      <div className="glass-card" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Key size={16} style={{ color: 'var(--gold-primary)' }} />
          <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
            Palavras-chave de Resposta Positiva
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            type="text"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
            placeholder="Digite uma palavra-chave e pressione Enter"
            className="input-dark"
            style={{ flex: 1 }}
          />
          <button
            onClick={addKeyword}
            className="btn-gold"
            style={{ padding: '10px 18px', fontSize: '0.85rem', whiteSpace: 'nowrap', cursor: 'pointer', border: 'none' }}
          >
            Adicionar
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {config.positive_keywords.map((keyword) => (
            <span key={keyword} className="badge badge-violet" style={{ paddingRight: 8 }}>
              {keyword}
              <button
                onClick={() => removeKeyword(keyword)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', alignItems: 'center', marginLeft: 4, padding: 0 }}
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </span>
          ))}
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif', marginTop: 12 }}>
          Mensagens contendo essas palavras serão consideradas respostas positivas e encaminhadas à IA
        </p>
      </div>

      {/* Card Toggles */}
      <div className="glass-card" style={{ padding: 24, marginBottom: 16 }}>
        {/* Análise de Sentimento */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderRadius: 12, background: 'var(--bg-elevated)',
          marginBottom: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: 3 }}>
              Análise de Sentimento (OpenAI)
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>
              Usa IA para analisar o sentimento além das palavras-chave
            </div>
          </div>
          <label className="toggle" style={{ marginLeft: 16 }}>
            <input
              type="checkbox"
              checked={config.sentiment_analysis_enabled}
              onChange={(e) => setConfig({ ...config, sentiment_analysis_enabled: e.target.checked })}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        {/* Sistema habilitado */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderRadius: 12, background: 'var(--bg-elevated)',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: 3 }}>
              Sistema de IA Habilitado
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>
              Quando habilitado, respostas positivas são enviadas para a IA externa
            </div>
          </div>
          <label className="toggle" style={{ marginLeft: 16 }}>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      {/* Info Box */}
      <div style={{
        borderRadius: 14,
        background: 'rgba(167,139,250,0.06)',
        border: '1px solid rgba(167,139,250,0.2)',
        padding: '16px 20px',
        marginBottom: 24,
        display: 'flex',
        gap: 12,
      }}>
        <Info size={18} style={{ color: 'var(--violet)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <p style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '0.85rem', color: '#c4b5fd', marginBottom: 8 }}>
            ✨ Como funcionam as Mensagens Personalizadas:
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[
              'Um contato responde a um disparo de mensagem personalizada',
              'O sistema verifica palavras-chave e/ou análise de sentimento',
              'Se positivo, envia para a IA externa com todos os dados do contato',
              'A IA externa inicia a conversa automaticamente',
              'Todas as interações são registradas no banco de dados',
            ].map((text, i) => (
              <li key={i} style={{ fontSize: '0.8rem', color: '#a09ac0', fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <span style={{ color: 'var(--violet)', marginTop: 1, flexShrink: 0 }}>→</span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Save Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handleSave}
          disabled={saving || !config.ai_webhook_url}
          className="btn-gold"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 28px', fontSize: '0.9rem', cursor: saving || !config.ai_webhook_url ? 'not-allowed' : 'pointer',
            border: 'none', opacity: saving || !config.ai_webhook_url ? 0.6 : 1,
          }}
        >
          {saving ? (
            <><RefreshCw size={16} strokeWidth={2} style={{ animation: 'spin 0.8s linear infinite' }} /> Salvando...</>
          ) : (
            <><Save size={16} strokeWidth={2} /> Salvar Configuração</>
          )}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </button>
      </div>
    </div>
  );
}
