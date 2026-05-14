import { useState, useEffect, type CSSProperties } from 'react';
import api from '@/lib/api';
import Toast from '@/components/ui/Toast';
import Switch from '@/components/ui/Switch';
import {
  BookOpen,
  Save,
  Clock,
  List,
  Bell,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Trash2,
} from 'lucide-react';

const DEFAULT_RESET_PHRASE = 'LIMPAR_DADOS_DEVOCIONAL';

interface DevocionalConfig {
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
  metadata?: any;
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

export default function DevocionalConfig() {
  const [config, setConfig] = useState<DevocionalConfig>({
    dispatch_hour: 6,
    dispatch_minute: 0,
    timezone: 'America/Sao_Paulo',
    enabled: true,
  });
  const [lists, setLists] = useState<ContactList[]>([]);
  const [todayDevocional, setTodayDevocional] = useState<Devocional | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [resetPhrase, setResetPhrase] = useState('');
  const [resetIncludeJourneys, setResetIncludeJourneys] = useState(false);
  const [resetContactStats, setResetContactStats] = useState(true);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    loadConfig();
    loadLists();
  }, []);

  const loadConfig = async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoading(true);
      const response = await api.get('/devocional/config');
      if (response.data.config) {
        setConfig(response.data.config);
      }
      if (response.data.today_devocional) {
        setTodayDevocional(response.data.today_devocional);
      }
    } catch (error: any) {
      console.error('Erro ao carregar configuração:', error);
      setToast({
        message: error.response?.data?.error || 'Erro ao carregar configuração',
        type: 'error'
      });
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  };

  const loadLists = async () => {
    try {
      const response = await api.get('/lists');
      const raw = response.data.lists || [];
      const sorted = [...raw].sort((a: any, b: any) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      });
      setLists(sorted);
    } catch (error) {
      console.error('Erro ao carregar listas:', error);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.put('/devocional/config', config);
      setToast({
        message: 'Configuração salva com sucesso!',
        type: 'success'
      });
    } catch (error: any) {
      console.error('Erro ao salvar configuração:', error);
      setToast({
        message: error.response?.data?.error || 'Erro ao salvar configuração',
        type: 'error'
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
    } catch (error: any) {
      const msg =
        error.response?.data?.error ||
        error.response?.data?.message ||
        'Erro ao limpar dados';
      const hint = error.response?.data?.expected;
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

  return (
    <div>
      <div style={{ marginBottom: 36 }}>
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
            <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif', letterSpacing: '-0.02em' }}>
              Configuração do devocional
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Disparo automático diário e prévia do conteúdo de hoje
            </p>
          </div>
        </div>
      </div>

      <div className="glass-card" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            <List size={16} style={{ opacity: 0.85 }} />
            Lista de contatos *
          </label>
          <select
            value={config.list_id || ''}
            onChange={(e) => setConfig({ ...config, list_id: e.target.value ? parseInt(e.target.value, 10) : undefined })}
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
            A lista deve incluir contatos com a tag &quot;devocional&quot; e WhatsApp validado.
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
            Execução diária às {String(config.dispatch_hour).padStart(2, '0')}:{String(config.dispatch_minute).padStart(2, '0')} (horário da configuração).
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
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem', marginBottom: 4 }}>Disparo automático</div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              Quando ativo, o sistema envia o devocional do dia no horário configurado, sem precisar criar disparo manual.
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
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
                  Devocional de hoje
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{formatDevocionalDate(todayDevocional.date)}</p>
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
              <h4 style={{ margin: '0 0 10px', fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>{todayDevocional.title}</h4>
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
                  Gere o devocional em <strong>Jornada Bíblica</strong> (teste por data) ou aguarde o agendamento interno. Verifique também a jornada ativa e o horário em Config. Devocional.
                </p>
              </div>
            </div>
          </div>
        )}

        {config.enabled ? (
          <div style={{ borderRadius: 12, padding: 16, border: '1px solid rgba(16, 185, 129, 0.35)', background: 'rgba(16, 185, 129, 0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" style={{ color: '#34d399', marginTop: 2 }} />
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-primary)' }}>Disparo automático ativo</p>
                <p style={{ margin: 0 }}>
                  Envios diários às <strong style={{ color: 'var(--text-primary)' }}>{String(config.dispatch_hour).padStart(2, '0')}:{String(config.dispatch_minute).padStart(2, '0')}</strong> ({config.timezone}). Não é necessário criar disparos manuais na página Disparos para o devocional diário.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ borderRadius: 12, padding: 16, border: '1px solid rgba(245, 158, 11, 0.3)', background: 'rgba(245, 158, 11, 0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <AlertCircle className="h-5 w-5 flex-shrink-0" style={{ color: '#fbbf24', marginTop: 2 }} />
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-primary)' }}>Disparo automático desligado</p>
                <p style={{ margin: 0 }}>Ative o interruptor acima para retomar os envios automáticos.</p>
              </div>
            </div>
          </div>
        )}

        <div style={{ borderRadius: 12, padding: 16, border: '1px solid rgba(56, 189, 248, 0.35)', background: 'rgba(56, 189, 248, 0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertCircle className="h-5 w-5 flex-shrink-0" style={{ color: '#38bdf8', marginTop: 2 }} />
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-primary)' }}>Como funciona</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>O conteúdo do dia fica na tabela de devocionais (geração na <strong>Jornada Bíblica</strong> ou ingestão HTTP opcional).</li>
                <li>O backend agenda o disparo no horário configurado.</li>
                <li>Mensagens usam saudação e primeiro nome quando disponível.</li>
                <li>Respeitam validação de WhatsApp, opt-in e opt-out.</li>
                <li>Falhas repetidas podem marcar o contato como bloqueado.</li>
              </ul>
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
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
              Limpeza para teste (ambiente de homologação)
            </h3>
          </div>
          <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Remove todos os registros de <strong>devocionais</strong> e <strong>disparos</strong> vinculados (incluindo histórico de envio do devocional), e desassocia mensagens do devocional. Use antes de gerar vários dias na Jornada e validar o disparo automático. Em produção, defina{' '}
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
            Frase padrão: <code>{DEFAULT_RESET_PHRASE}</code>. Se o backend usar <code>DEVOCIONAL_RESET_PHRASE</code>, use essa frase no lugar.
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

      {toast && (
        <Toast message={toast.message} type={toast.type} duration={4000} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
