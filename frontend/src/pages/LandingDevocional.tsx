import { useState } from 'react';
import {
  BookOpen,
  AlertCircle,
  Loader2,
  Sparkles,
  Phone,
  User,
  Mail,
  Heart,
  Sunrise,
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
      setError('Como podemos te chamar? Escreve seu nome com carinho.');
      return;
    }
    const dddDigits = onlyDigits(ddd).slice(0, 2);
    const telDigits = onlyDigits(telefone);
    if (dddDigits.length !== 2) {
      setError('Qual é o DDD da sua região? São dois númerinhos.');
      return;
    }
    if (telDigits.length < 8 || telDigits.length > 9) {
      setError('Confere o número do celular? Falta algum dígito.');
      return;
    }
    if (!consent) {
      setError('Marca a caixinha abaixo para a gente poder te mandar mensagem no WhatsApp.');
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
        setError(data.error || 'Deu um probleminha. Tenta de novo daqui a pouquinho?');
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
      setError('Sem internet agora? Verifica sua conexão e tenta outra vez.');
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

      <div style={{ width: '100%', maxWidth: 440, position: 'relative' }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: 20,
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 18px',
              boxShadow: '0 14px 36px rgba(245, 158, 11, 0.25)',
            }}
          >
            <BookOpen size={34} color="#0d0c14" strokeWidth={2.2} />
          </div>
          <h1
            style={{
              fontSize: '1.75rem',
              fontWeight: 800,
              margin: '0 0 10px',
              fontFamily: 'Outfit, sans-serif',
              background: 'linear-gradient(135deg, #fde68a, #fbbf24, #f59e0b)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Um abraço no seu dia
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '0.95rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.55,
              maxWidth: 380,
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle' }}>
              <Sparkles size={15} color="var(--gold-primary)" style={{ flexShrink: 0 }} />
            </span>
            Deixa seu contato aqui embaixo e a gente te manda, no WhatsApp, um carinho em forma de mensagem — uma
            palavra para fortalecer sua fé no dia a dia.
          </p>
        </div>

        {!done ? (
          <div className="glass-card" style={{ padding: '26px 22px', position: 'relative' }}>
            <p
              style={{
                margin: '0 0 22px',
                fontSize: '0.9rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                textAlign: 'center',
              }}
            >
              É rapidinho: nome, DDD e número do celular. Se quiser, deixa seu e-mail também — é opcional.
            </p>

            {error && (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  marginBottom: 18,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  fontSize: '0.86rem',
                  lineHeight: 1.45,
                  background: 'rgba(244,63,94,0.08)',
                  border: '1px solid rgba(244,63,94,0.3)',
                  color: '#fda4af',
                }}
              >
                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <label className="label-premium" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <User size={14} /> Seu nome
              </label>
              <input
                className="input-dark"
                type="text"
                autoComplete="name"
                placeholder="Ex.: Maria, João, como você gosta"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%', marginBottom: 16 }}
              />

              <label className="label-premium" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Phone size={14} /> Seu WhatsApp
              </label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', marginBottom: 16 }}>
                <input
                  className="input-dark"
                  type="text"
                  inputMode="numeric"
                  autoComplete="tel-area-code"
                  placeholder="DDD"
                  aria-label="DDD do celular"
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
                  placeholder="Número do celular"
                  aria-label="Número do celular"
                  maxLength={9}
                  value={telefone}
                  onChange={(e) => setTelefone(onlyDigits(e.target.value).slice(0, 9))}
                  style={{ flex: 1, minWidth: 0 }}
                />
              </div>

              <label className="label-premium" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mail size={14} /> E-mail{' '}
                <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: '0.78rem' }}>se quiser</span>
              </label>
              <input
                className="input-dark"
                type="email"
                autoComplete="email"
                placeholder="Só se você quiser receber novidades por e-mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: '100%', marginBottom: 16 }}
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
                  fontSize: '0.84rem',
                  color: 'var(--text-secondary)',
                  marginBottom: 22,
                  lineHeight: 1.5,
                }}
              >
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  style={{ marginTop: 4, width: 17, height: 17, accentColor: 'var(--gold-primary)', flexShrink: 0 }}
                />
                <span>
                  Sim, quero receber essas mensagens de fé no meu WhatsApp. Sei que posso parar quando quiser falando
                  com a equipe.
                </span>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="btn-gold"
                style={{
                  width: '100%',
                  padding: '15px',
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
                {loading ? <Loader2 size={22} className="animate-spin" /> : 'Quero receber no meu WhatsApp'}
              </button>
            </form>
          </div>
        ) : (
          <div
            className="glass-card"
            style={{
              padding: '32px 26px',
              textAlign: 'center',
              borderColor: 'rgba(245, 158, 11, 0.22)',
              boxShadow: '0 0 40px rgba(245, 158, 11, 0.08)',
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                margin: '0 auto 18px',
                background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(245,158,11,0.15))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(16,185,129,0.25)',
              }}
            >
              <Heart size={26} color="#6ee7b7" fill="rgba(16,185,129,0.35)" strokeWidth={1.8} />
            </div>

            <h2
              style={{
                margin: '0 0 12px',
                fontSize: '1.35rem',
                fontWeight: 800,
                fontFamily: 'Outfit, sans-serif',
                color: 'var(--text-primary)',
              }}
            >
              Obrigado{firstName ? `, ${firstName}` : ''}!
            </h2>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                marginBottom: 14,
                color: 'var(--gold-light)',
                fontSize: '0.82rem',
                fontWeight: 600,
              }}
            >
              <Sunrise size={18} strokeWidth={2.2} />
              Amanhã começa um novo amanhecer na sua palma
            </div>

            <p style={{ margin: '0 0 18px', fontSize: '0.92rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              Guarda um cantinho do coração: <strong style={{ color: 'var(--text-primary)' }}>a partir de amanhã</strong>,
              quando o sol levantar, uma <strong style={{ color: 'var(--gold-light)' }}>Palavra de Deus</strong> pode
              chegar no seu WhatsApp — leve, para te lembrar que Ele caminha com você em cada passo.
            </p>

            <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
              Fica de olho nas mensagens. Se demorar um pouquinho, sem pressa: boas coisas valem a espera. Deus te
              abençoe hoje e sempre.
            </p>

            <button
              type="button"
              onClick={resetAnother}
              className="btn-outline"
              style={{
                marginTop: 26,
                width: '100%',
                padding: '12px',
                borderRadius: 12,
                fontSize: '0.85rem',
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
