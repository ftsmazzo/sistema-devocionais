import { useState } from 'react';
import {
  BookOpen,
  AlertCircle,
  Loader2,
  Phone,
  User,
  Mail,
  Heart,
} from 'lucide-react';

function onlyDigits(s: string): string {
  return s.replace(/\D/g, '');
}

export default function LandingDevocional() {
  const [ddd, setDdd] = useState('');
  const [telefone, setTelefone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [firstName, setFirstName] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const nameTrim = name.trim();
    if (nameTrim.length < 2) {
      setError('Informe seu nome.');
      return;
    }
    const dddDigits = onlyDigits(ddd).slice(0, 2);
    const telDigits = onlyDigits(telefone);
    if (dddDigits.length !== 2) {
      setError('DDD com 2 dígitos.');
      return;
    }
    if (telDigits.length < 8 || telDigits.length > 9) {
      setError('Confira o número do celular.');
      return;
    }
    if (!consent) {
      setError('Marque a opção abaixo para continuar.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/public/inscricao-devocional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ddd: dddDigits,
          telefone: telDigits,
          name: nameTrim,
          email: email.trim() || undefined,
          website: website.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Tente novamente em instantes.');
        return;
      }
      const how = nameTrim.split(/\s+/)[0];
      setFirstName(how);
      setDone(true);
      setDdd('');
      setTelefone('');
      setName('');
      setEmail('');
      setConsent(false);
    } catch {
      setError('Sem conexão. Tente de novo.');
    } finally {
      setLoading(false);
    }
  };

  const resetAnother = () => {
    setDone(false);
    setFirstName('');
    setError(null);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '28px 16px 40px',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div
        style={{
          position: 'fixed',
          top: '10%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 520,
          height: 380,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(245,158,11,0.1) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'fixed',
          bottom: '6%',
          right: '5%',
          width: 280,
          height: 240,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(167,139,250,0.07) 0%, transparent 72%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ width: '100%', maxWidth: 420, position: 'relative' }}>
        {/* Branding — alinhado ao Login / sistema */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              boxShadow: '0 12px 32px rgba(245, 158, 11, 0.3)',
            }}
          >
            <BookOpen size={36} color="#0d0c14" strokeWidth={2.5} />
          </div>
          <h1
            style={{
              fontSize: '2rem',
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
              fontSize: '0.88rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.45,
            }}
          >
            Palavra de Deus no seu dia · pelo WhatsApp
          </p>
        </div>

        {!done ? (
          <div className="glass-card" style={{ padding: '24px 22px', position: 'relative' }}>
            <p
              style={{
                margin: '0 0 20px',
                fontSize: '0.88rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
                textAlign: 'center',
              }}
            >
              Preenche abaixo. É rápido.
            </p>

            {error && (
              <div
                style={{
                  padding: '11px 13px',
                  borderRadius: 12,
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 9,
                  fontSize: '0.84rem',
                  lineHeight: 1.4,
                  background: 'rgba(244,63,94,0.08)',
                  border: '1px solid rgba(244,63,94,0.3)',
                  color: '#fda4af',
                }}
              >
                <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <label className="label-premium" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <User size={14} /> Nome
              </label>
              <input
                className="input-dark"
                type="text"
                autoComplete="name"
                placeholder="Seu nome"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%', marginBottom: 14 }}
              />

              <label className="label-premium" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Phone size={14} /> WhatsApp
              </label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', marginBottom: 14 }}>
                <input
                  className="input-dark"
                  type="text"
                  inputMode="numeric"
                  autoComplete="tel-area-code"
                  placeholder="DDD"
                  aria-label="DDD"
                  maxLength={2}
                  value={ddd}
                  onChange={(e) => setDdd(onlyDigits(e.target.value).slice(0, 2))}
                  style={{ width: 76, textAlign: 'center' }}
                />
                <input
                  className="input-dark"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="Celular"
                  aria-label="Número do celular"
                  maxLength={9}
                  value={telefone}
                  onChange={(e) => setTelefone(onlyDigits(e.target.value).slice(0, 9))}
                  style={{ flex: 1, minWidth: 0 }}
                />
              </div>

              <label className="label-premium" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mail size={14} /> E-mail <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>(opcional)</span>
              </label>
              <input
                className="input-dark"
                type="email"
                autoComplete="email"
                placeholder="Opcional"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: '100%', marginBottom: 14 }}
              />

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
                  marginBottom: 18,
                  lineHeight: 1.45,
                }}
              >
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--gold-primary)', flexShrink: 0 }}
                />
                <span>Quero receber o devocional neste WhatsApp.</span>
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
                  fontSize: '0.95rem',
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
          </div>
        ) : (
          <div
            className="glass-card"
            style={{
              padding: '28px 22px',
              textAlign: 'center',
              borderColor: 'rgba(245, 158, 11, 0.2)',
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                margin: '0 auto 16px',
                background: 'rgba(16,185,129,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(16,185,129,0.28)',
              }}
            >
              <Heart size={24} color="#6ee7b7" fill="rgba(16,185,129,0.25)" strokeWidth={1.8} />
            </div>

            <h2
              style={{
                margin: '0 0 10px',
                fontSize: '1.25rem',
                fontWeight: 800,
                fontFamily: 'Outfit, sans-serif',
                color: 'var(--text-primary)',
              }}
            >
              Obrigado{firstName ? `, ${firstName}` : ''}!
            </h2>

            <p style={{ margin: '0 0 10px', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              Deus te abençoe. <strong style={{ color: 'var(--text-primary)' }}>Amanhã</strong> você pode receber uma
              palavra da Escritura aqui no WhatsApp.
            </p>

            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
              Fique atento às mensagens do dia.
            </p>

            <button
              type="button"
              onClick={resetAnother}
              className="btn-outline"
              style={{
                marginTop: 22,
                width: '100%',
                padding: '11px',
                borderRadius: 12,
                fontSize: '0.84rem',
                fontWeight: 600,
              }}
            >
              Cadastrar outro número
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
