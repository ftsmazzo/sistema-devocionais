import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import {
  BookOpen,
  Shield,
  MessageCircle,
  LogOut,
  Menu,
  X,
  Users,
  Tag,
  List,
  Send,
  Settings,
  FileText,
  Smartphone,
  ChevronRight,
} from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
}

const navSections = [
  {
    label: 'WhatsApp',
    items: [
      { name: 'Instâncias', href: '/', icon: Smartphone },
      { name: 'Blindagens', href: '/blindage', icon: Shield },
    ],
  },
  {
    label: 'Contatos',
    items: [
      { name: 'Contatos', href: '/contacts', icon: Users },
      { name: 'Tags', href: '/tags', icon: Tag },
      { name: 'Listas', href: '/lists', icon: List },
    ],
  },
  {
    label: 'Disparos',
    items: [
      { name: 'Disparos', href: '/dispatches', icon: Send },
      { name: 'Config. Devocional', href: '/devocional/config', icon: Settings },
      { name: 'Mensagens Personalizadas', href: '/mensagens/config', icon: MessageCircle },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { name: 'Logs', href: '/logs', icon: FileText },
    ],
  },
];

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  const userInitial = user?.email?.charAt(0).toUpperCase() || 'A';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex' }}>

      {/* ── Sidebar Desktop ── */}
      <aside
        className="hidden md:flex"
        style={{
          width: 260,
          minWidth: 260,
          flexDirection: 'column',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 40,
          overflowY: 'auto',
        }}
      >
        {/* Logo */}
        <div style={{
          padding: '24px 20px 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Icon container */}
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 15px rgba(245,158,11,0.4)',
              flexShrink: 0,
            }}>
              <BookOpen size={22} color="#0d0c14" strokeWidth={2.5} />
            </div>
            <div>
              <div style={{
                fontFamily: 'Outfit, sans-serif',
                fontWeight: 800,
                fontSize: '1rem',
                letterSpacing: '-0.02em',
                background: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                Devocional Diário
              </div>
              <div style={{
                fontSize: '0.68rem',
                color: 'var(--text-muted)',
                fontWeight: 500,
                fontFamily: 'Inter, sans-serif',
                letterSpacing: '0.04em',
                marginTop: 1,
              }}>
                Envios Automáticos & Interações
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
          {navSections.map((section) => (
            <div key={section.label} style={{ marginBottom: 4 }}>
              <div className="nav-section">{section.label}</div>
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    className={`nav-item${active ? ' active' : ''}`}
                  >
                    <Icon size={17} strokeWidth={2} style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{item.name}</span>
                    {active && <ChevronRight size={14} strokeWidth={2.5} />}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User Footer */}
        <div style={{
          padding: '14px 10px',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderRadius: 12,
            marginBottom: 8,
            background: 'var(--bg-elevated)',
          }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #a78bfa, #6d28d9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontFamily: 'Outfit, sans-serif',
              fontSize: '0.875rem',
              color: '#fff',
              flexShrink: 0,
            }}>
              {userInitial}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                fontFamily: 'Outfit, sans-serif',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {user?.name || user?.email || 'Admin'}
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 1 }}>
                Administrador
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '9px 14px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontFamily: 'Inter, sans-serif',
              fontWeight: 500,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(244,63,94,0.4)';
              (e.currentTarget as HTMLButtonElement).style.color = '#fb7185';
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(244,63,94,0.07)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)';
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            <LogOut size={15} strokeWidth={2} />
            Sair da Conta
          </button>
        </div>
      </aside>

      {/* ── Mobile Header ── */}
      <div
        className="md:hidden"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(245,158,11,0.35)',
            }}>
              <BookOpen size={18} color="#0d0c14" strokeWidth={2.5} />
            </div>
            <div>
              <div style={{
                fontFamily: 'Outfit, sans-serif',
                fontWeight: 800,
                fontSize: '0.9rem',
                background: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                Devocional Diário
              </div>
            </div>
          </div>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={{
              padding: 8,
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile Menu Dropdown */}
        {mobileMenuOpen && (
          <div style={{
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            padding: '8px 10px 16px',
            maxHeight: '70vh',
            overflowY: 'auto',
          }}>
            {navSections.map((section) => (
              <div key={section.label}>
                <div className="nav-section">{section.label}</div>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      className={`nav-item${active ? ' active' : ''}`}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <Icon size={17} strokeWidth={2} />
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
              <button
                onClick={handleLogout}
                className="nav-item"
                style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', color: '#fb7185' }}
              >
                <LogOut size={17} strokeWidth={2} />
                Sair da Conta
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Main Content ── */}
      <div
        id="main-content-area"
        style={{
          marginLeft: 260,
          minWidth: 0,
          flex: 1,
        }}
      >
        <main
          style={{
            minHeight: '100vh',
            padding: '32px 24px',
            background: 'var(--bg-primary)',
          }}
          className="page-enter"
        >
          <div style={{ maxWidth: 1280, margin: '0 auto' }}>
            {children}
          </div>
        </main>
      </div>

      {/* Decorative background orbs */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: '10%',
          left: '15%',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(245,158,11,0.04) 0%, transparent 70%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          bottom: '10%',
          right: '10%',
          width: 350,
          height: 350,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(167,139,250,0.05) 0%, transparent 70%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
    </div>
  );
}
