import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { BookOpen, Mail, Lock, Loader } from 'lucide-react'
import './Login.css'

export default function Login() {
  const navigate = useNavigate()
  const { login, isLoading } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email || !password) {
      setError('Por favor, preencha todos os campos')
      return
    }

    try {
      await login(email, password, remember)
      navigate('/dashboard')
    } catch (err: any) {
      setError(
        err.response?.data?.detail || 'Erro ao fazer login. Verifique suas credenciais.'
      )
    }
  }

  return (
    <div className="login-page-modern">
      <div className="login-background">
        <div className="login-background-shapes">
          <div className="shape shape-1"></div>
          <div className="shape shape-2"></div>
          <div className="shape shape-3"></div>
        </div>
      </div>

      <div className="login-container-modern">
        <div className="login-card-modern">
          <div className="login-header-modern">
            <div className="login-icon-wrapper">
              <BookOpen size={40} />
            </div>
            <h1>Sistema de Devocionais</h1>
            <p>Entre com suas credenciais para continuar</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form-modern">
            {error && (
              <div className="error-message-modern">
                <span>{error}</span>
              </div>
            )}

            <div className="form-group-modern">
              <label htmlFor="email">
                <Mail size={18} />
                <span>Email</span>
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                autoComplete="email"
                className="input-modern"
              />
            </div>

            <div className="form-group-modern">
              <label htmlFor="password">
                <Lock size={18} />
                <span>Senha</span>
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="input-modern"
              />
            </div>

            <div className="form-options-modern">
              <label className="checkbox-modern">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span>Lembrar-me</span>
              </label>
            </div>

            <button
              type="submit"
              className="login-button-modern"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader size={20} className="spinning" />
                  <span>Entrando...</span>
                </>
              ) : (
                <span>Entrar</span>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
