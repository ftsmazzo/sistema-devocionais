import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CheckCircle2, AlertCircle, Loader2, Sparkles, Phone, User, Mail } from 'lucide-react';

export default function LandingDevocional() {
  const [phone_number, setPhoneNumber] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!consent) {
      setMessage({ text: 'Marque que deseja receber o devocional para continuar.', type: 'err' });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/public/inscricao-devocional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number: phone_number.trim(),
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          website: website.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: data.error || 'Não foi possível enviar. Tente novamente.', type: 'err' });
        return;
      }
      setMessage({ text: data.message || 'Obrigado pela inscrição!', type: 'ok' });
      setPhoneNumber('');
      setName('');
      setEmail('');
      setConsent(false);
    } catch {
      setMessage({ text: 'Erro de rede. Verifique sua conexão.', type: 'err' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div
        style={{
          position: 'fixed',
          top: '12%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 560,
          height: 420,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(245,158,11,0.09) 0%, transparent 68%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'fixed',
          bottom: '8%',
          right: '8%',
          width: 320,
          height: 280,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(167,139,250,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ width: '100%', maxWidth: 460, position: 'relative' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              boxShadow: '0 12px 32px rgba(245, 158, 11, 0.28)',
            }}
          >
            <BookOpen size={32} color="#0d0c14" strokeWidth={2.5} />
          </div>
          <h1
            style={{
              fontSize: '1.85rem',
              fontWeight: 800,
              margin: '0 0 8px',
              fontFamily: 'Outfit, sans-serif',
              background: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Devocional Diário
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '0.92rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <Sparkles size={16} color="var(--gold-primary)" />
            Receba uma mensagem de fé no seu WhatsApp
          </p>
        </div>

        <div className="glass-card" style={{ padding: '28px 26px', position: 'relative' }}>
          <p style={{ margin: '0 0 20px', fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Preencha seus dados. Você será cadastrado com <strong style={{ color: 'var(--text-primary)' }}>opt-in</strong>{' '}
            e a etiqueta <strong style={{ color: 'var(--emerald)' }}>devocional</strong> no sistema. Quem administra o
            disparo deve incluir pessoas com essa etiqueta (ou este número) na lista configurada no painel.
          </p>

          {message && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                marginBottom: 18,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                fontSize: '0.84rem',
                lineHeight: 1.45,
                background: message.type === 'ok' ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
                border: `1px solid ${message.type === 'ok' ? 'rgba(16,185,129,0.35)' : 'rgba(244,63,94,0.35)'}`,
                color: message.type === 'ok' ? '#6ee7b7' : '#fb7185',
              }}
            >
              {message.type === 'ok' ? <CheckCircle2 size={18} style={{ flexShrink: 0 }} /> : <AlertCircle size={18} style={{ flexShrink: 0 }} />}
              {message.text}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <label className="label-premium" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Phone size={14} /> WhatsApp (com DDD e país)
            </label>
            <input
              className="input-dark"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="ex.: 5511999998888"
              required
              value={phone_number}
              onChange={(e) => setPhoneNumber(e.target.value)}
              style={{ width: '100%', marginBottom: 16 }}
            />

            <label className="label-premium" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <User size={14} /> Nome (opcional)
            </label>
            <input
              className="input-dark"
              type="text"
              autoComplete="name"
              placeholder="Como podemos te chamar"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: '100%', marginBottom: 16 }}
            />

            <label className="label-premium" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Mail size={14} /> E-mail (opcional)
            </label>
            <input
              className="input-dark"
              type="email"
              autoComplete="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', marginBottom: 16 }}
            />

            {/* Honeypot anti-bot */}
            <div style={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }} aria-hidden>
              <label htmlFor="landing-website">Website</label>
              <input id="landing-website" tabIndex={-1} value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                cursor: 'pointer',
                fontSize: '0.82rem',
                color: 'var(--text-secondary)',
                marginBottom: 20,
                lineHeight: 1.45,
              }}
            >
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--gold-primary)' }}
              />
              <span>
                Quero receber o <strong style={{ color: 'var(--text-primary)' }}>Devocional Diário</strong> no número
                informado e concordo em ser contatado por WhatsApp para esse fim.
              </span>
            </label>

            <button
              type="submit"
              disabled={loading}
              className="btn-gold"
              style={{
                width: '100%',
                padding: '14px',
                border: 'none',
                borderRadius: 12,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                opacity: loading ? 0.85 : 1,
              }}
            >
              {loading ? <Loader2 size={22} className="animate-spin" /> : 'Quero receber'}
            </button>
          </form>

          <p style={{ margin: '20px 0 0', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            <Link to="/login" style={{ color: 'var(--sky)', textDecoration: 'none' }}>
              Acesso administrativo
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
