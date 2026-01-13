import { useEffect, useState } from 'react'
import { devocionalApi } from '../../services/api'
import type { Devocional } from '../../types'
import { BookOpen, Calendar, Search, Eye } from 'lucide-react'
import './Devocionais.css'

export default function Devocionais() {
  const [devocionais, setDevocionais] = useState<Devocional[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedDevocional, setSelectedDevocional] = useState<Devocional | null>(null)

  useEffect(() => {
    loadDevocionais()
  }, [])

  const loadDevocionais = async () => {
    try {
      setLoading(true)
      const data = await devocionalApi.list(0, 100)
      setDevocionais(data)
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar devocionais')
    } finally {
      setLoading(false)
    }
  }

  const filteredDevocionais = devocionais.filter(
    (devocional) =>
      devocional.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      devocional.content?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (loading) {
    return (
      <div className="devocionais-loading">
        <div className="spinner"></div>
        <p>Carregando devocionais...</p>
      </div>
    )
  }

  return (
    <div className="devocionais-page">
      <div className="devocionais-header">
        <div className="header-info">
          <BookOpen size={24} />
          <h2>Devocionais</h2>
          <span className="count-badge">{devocionais.length} devocionais</span>
        </div>
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Buscar devocionais..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={loadDevocionais}>Tentar novamente</button>
        </div>
      )}

      {selectedDevocional ? (
        <div className="devocional-detail">
          <button className="back-button" onClick={() => setSelectedDevocional(null)}>
            ← Voltar
          </button>
          <div className="devocional-content">
            <h1>{selectedDevocional.title || 'Sem título'}</h1>
            <div className="devocional-meta">
              <span>
                <Calendar size={16} />
                {selectedDevocional.date
                  ? new Date(selectedDevocional.date).toLocaleDateString('pt-BR')
                  : 'Sem data'}
              </span>
            </div>
            <div className="devocional-text">
              {selectedDevocional.content.split('\n').map((paragraph, idx) => (
                <p key={idx}>{paragraph || '\u00A0'}</p>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="devocionais-grid">
          {filteredDevocionais.length === 0 ? (
            <div className="empty-state">
              <BookOpen size={48} />
              <p>{searchTerm ? 'Nenhum devocional encontrado' : 'Nenhum devocional cadastrado'}</p>
            </div>
          ) : (
            filteredDevocionais.map((devocional) => (
              <div key={devocional.id} className="devocional-card">
                <div className="devocional-card-header">
                  <h3>{devocional.title || 'Sem título'}</h3>
                  <span className="date-badge">
                    <Calendar size={14} />
                    {devocional.date
                      ? new Date(devocional.date).toLocaleDateString('pt-BR')
                      : 'Sem data'}
                  </span>
                </div>
                <div className="devocional-card-content">
                  <p>{devocional.content.substring(0, 150)}...</p>
                </div>
                <div className="devocional-card-actions">
                  <button
                    className="btn-view"
                    onClick={() => setSelectedDevocional(devocional)}
                  >
                    <Eye size={16} />
                    <span>Ver completo</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

