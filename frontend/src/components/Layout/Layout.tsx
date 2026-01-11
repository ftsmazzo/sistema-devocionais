import { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { LogOut, Home, BookOpen, Users, Send, Settings, BarChart3 } from 'lucide-react'
import './Layout.css'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const isActive = (path: string) => location.pathname === path

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>📖 Devocionais</h1>
        </div>

        <nav className="sidebar-nav">
          <Link
            to="/dashboard"
            className={`nav-item ${isActive('/dashboard') ? 'active' : ''}`}
          >
            <Home size={20} />
            <span>Dashboard</span>
          </Link>

          <Link
            to="/devocionais"
            className={`nav-item ${isActive('/devocionais') ? 'active' : ''}`}
          >
            <BookOpen size={20} />
            <span>Devocionais</span>
          </Link>

          <Link
            to="/contatos"
            className={`nav-item ${isActive('/contatos') ? 'active' : ''}`}
          >
            <Users size={20} />
            <span>Contatos</span>
          </Link>

          <Link
            to="/envios"
            className={`nav-item ${isActive('/envios') ? 'active' : ''}`}
          >
            <Send size={20} />
            <span>Envios</span>
          </Link>

          <Link
            to="/relatorios"
            className={`nav-item ${isActive('/relatorios') ? 'active' : ''}`}
          >
            <BarChart3 size={20} />
            <span>Relatórios</span>
          </Link>

          <Link
            to="/configuracoes"
            className={`nav-item ${isActive('/configuracoes') ? 'active' : ''}`}
          >
            <Settings size={20} />
            <span>Configurações</span>
          </Link>
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="user-details">
              <span className="user-name">{user?.name || 'Usuário'}</span>
              <span className="user-email">{user?.email || ''}</span>
            </div>
          </div>
          <button onClick={handleLogout} className="logout-btn">
            <LogOut size={18} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-content">
            <h2 className="page-title">
              {location.pathname === '/dashboard' && 'Dashboard'}
              {location.pathname === '/devocionais' && 'Devocionais'}
              {location.pathname === '/contatos' && 'Contatos'}
              {location.pathname === '/envios' && 'Envios'}
              {location.pathname === '/relatorios' && 'Relatórios'}
              {location.pathname === '/configuracoes' && 'Configurações'}
            </h2>
          </div>
        </header>

        <div className="content-wrapper">{children}</div>
      </main>
    </div>
  )
}

