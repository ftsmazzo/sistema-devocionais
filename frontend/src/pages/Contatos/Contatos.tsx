import { useEffect, useState } from 'react'
import { contatoApi } from '../../services/api'
import type { Contato } from '../../types'
import { Plus, Search, Edit, Trash2, UserCheck, UserX, Phone, Upload, Power, PowerOff } from 'lucide-react'
import './Contatos.css'

export default function Contatos() {
  const [contatos, setContatos] = useState<Contato[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showCsvModal, setShowCsvModal] = useState(false)
  const [editingContato, setEditingContato] = useState<Contato | null>(null)
  const [formData, setFormData] = useState({ phone: '', name: '' })
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvPreview, setCsvPreview] = useState<Array<{ phone: string; name: string }>>([])
  const [csvLoading, setCsvLoading] = useState(false)

  useEffect(() => {
    loadContatos()
    
    // Atualizar em tempo real a cada 10 segundos (sem mostrar loading para não piscar)
    const interval = setInterval(() => {
      loadContatosSilently()
    }, 10000)
    
    return () => clearInterval(interval)
  }, [])

  const loadContatos = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true)
      const data = await contatoApi.list(0, 1000, false) // false = buscar todos (ativos e inativos)
      setContatos(data)
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar contatos')
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  const loadContatosSilently = async () => {
    // Atualização silenciosa sem mostrar loading (não pisca a tela)
    try {
      const data = await contatoApi.list(0, 1000, false)
      setContatos(data)
      setError(null)
    } catch (err: any) {
      // Silencioso - não mostra erro em atualizações automáticas
      console.error('Erro ao atualizar contatos:', err)
    }
  }

  const handleRefresh = () => {
    loadContatos(true)
  }

  const handleCreate = () => {
    setEditingContato(null)
    setFormData({ phone: '', name: '' })
    setShowModal(true)
  }

  const handleEdit = (contato: Contato) => {
    setEditingContato(contato)
    setFormData({ phone: contato.phone, name: contato.name || '' })
    setShowModal(true)
  }

  const handleSave = async () => {
    try {
      if (!formData.phone.trim()) {
        alert('Telefone é obrigatório')
        return
      }

      if (editingContato) {
        // Para editar, precisamos deletar e criar novo (backend não tem update)
        // Ou apenas criar novo se o telefone mudou
        if (formData.phone !== editingContato.phone) {
          await contatoApi.delete(editingContato.id)
          await contatoApi.create(formData)
        } else {
          // Se só o nome mudou, não podemos atualizar (backend não tem endpoint)
          alert('Para alterar apenas o nome, exclua e crie novamente')
          return
        }
      } else {
        await contatoApi.create(formData)
      }

      setShowModal(false)
      loadContatos(true)
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Erro ao salvar contato')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja excluir este contato?')) return

    try {
      await contatoApi.delete(id)
      loadContatos(true)
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Erro ao excluir contato')
    }
  }

  const handleToggle = async (id: number) => {
    try {
      await contatoApi.toggle(id)
      loadContatos(true)
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Erro ao alterar status')
    }
  }

  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.csv')) {
      alert('Por favor, selecione um arquivo CSV')
      return
    }

    setCsvFile(file)
    
    // Ler e fazer preview do CSV
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string
        const lines = text.split('\n').filter(line => line.trim())
        
        if (lines.length === 0) {
          setCsvPreview([])
          return
        }
        
        // Detectar se primeira linha é header
        const firstLine = lines[0].toLowerCase()
        const hasHeader = firstLine.includes('phone') || firstLine.includes('telefone') || 
                         firstLine.includes('name') || firstLine.includes('nome')
        
        // Determinar índices
        let phoneIdx = 0
        let nameIdx = 1
        
        if (hasHeader) {
          const headerParts = lines[0].split(',').map(p => p.trim().replace(/^"|"$/g, '').toLowerCase())
          for (let i = 0; i < headerParts.length; i++) {
            const col = headerParts[i]
            if (col.includes('phone') || col.includes('telefone') || col.includes('celular') || col.includes('whatsapp')) {
              phoneIdx = i
            } else if (col.includes('name') || col.includes('nome')) {
              nameIdx = i
            }
          }
        }
        
        // Processar linhas de dados
        const dataLines = hasHeader ? lines.slice(1) : lines
        const preview: Array<{ phone: string; name: string }> = []
        
        for (const line of dataLines.slice(0, 10)) { // Preview das primeiras 10 linhas
          const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''))
          if (parts.length > phoneIdx) {
            const phone = parts[phoneIdx] || ''
            const name = parts[nameIdx] || ''
            if (phone) {
              preview.push({ phone, name })
            }
          }
        }
        
        setCsvPreview(preview)
      } catch (err) {
        console.error('Erro ao processar preview do CSV:', err)
        setCsvPreview([])
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  const handleCsvImport = async () => {
    if (!csvFile) {
      alert('Por favor, selecione um arquivo CSV')
      return
    }

    setCsvLoading(true)
    try {
      await contatoApi.importCsv(csvFile)
      setShowCsvModal(false)
      setCsvFile(null)
      setCsvPreview([])
      loadContatos(true)
      alert('Contatos importados com sucesso!')
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Erro ao importar CSV')
    } finally {
      setCsvLoading(false)
    }
  }

  const filteredContatos = contatos.filter(
    (contato) =>
      contato.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contato.phone.includes(searchTerm)
  )

  const activeCount = contatos.filter((c) => c.active).length
  const inactiveCount = contatos.filter((c) => !c.active).length

  if (loading) {
    return (
      <div className="contatos-loading">
        <div className="spinner"></div>
        <p>Carregando contatos...</p>
      </div>
    )
  }

  return (
    <div className="contatos-page">
      <div className="contatos-header">
        <div className="header-stats">
          <div className="stat-badge active">
            <UserCheck size={16} />
            <span>{activeCount} Ativos</span>
          </div>
          <div className="stat-badge inactive">
            <UserX size={16} />
            <span>{inactiveCount} Inativos</span>
          </div>
          <div className="stat-badge total">
            <Phone size={16} />
            <span>{contatos.length} Total</span>
          </div>
        </div>
        <div className="header-actions">
          <div className="search-box">
            <Search size={18} />
            <input
              type="text"
              placeholder="Buscar por nome ou telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="btn-secondary" onClick={() => setShowCsvModal(true)}>
            <Upload size={18} />
            <span>Importar CSV</span>
          </button>
          <button className="btn-primary" onClick={handleCreate}>
            <Plus size={18} />
            <span>Adicionar Contato</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={handleRefresh}>Tentar novamente</button>
        </div>
      )}

      <div className="contatos-table-container">
        <table className="contatos-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Telefone</th>
              <th>Status</th>
              <th>Score</th>
              <th>Total Enviados</th>
              <th>Último Envio</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredContatos.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-state">
                  {searchTerm ? 'Nenhum contato encontrado' : 'Nenhum contato cadastrado'}
                </td>
              </tr>
            ) : (
              filteredContatos.map((contato) => (
                <tr key={contato.id}>
                  <td>
                    <div className="contact-name">
                      <div className="contact-avatar">
                        {contato.name?.charAt(0).toUpperCase() || '?'}
                      </div>
                      <span>{contato.name || 'Sem nome'}</span>
                    </div>
                  </td>
                  <td className="phone-cell">{contato.phone}</td>
                  <td>
                    <span className={`status-badge ${contato.active ? 'active' : 'inactive'}`}>
                      {contato.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td>
                    {contato.engagement_score !== null && contato.engagement_score !== undefined ? (
                      <span
                        className={`score-badge ${
                          contato.engagement_score >= 70
                            ? 'score-high'
                            : contato.engagement_score >= 40
                            ? 'score-medium'
                            : 'score-low'
                        }`}
                        title={`Score de engajamento: ${contato.engagement_score.toFixed(1)}%`}
                      >
                        {contato.engagement_score.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="score-badge score-unknown" title="Score não disponível">
                        -
                      </span>
                    )}
                  </td>
                  <td>{contato.total_sent || 0}</td>
                  <td>
                    {contato.last_sent
                      ? new Date(contato.last_sent).toLocaleDateString('pt-BR')
                      : 'Nunca'}
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button
                        className={`btn-icon ${contato.active ? 'warning' : 'success'}`}
                        onClick={() => handleToggle(contato.id)}
                        title={contato.active ? 'Desativar' : 'Ativar'}
                      >
                        {contato.active ? <PowerOff size={16} /> : <Power size={16} />}
                      </button>
                      <button
                        className="btn-icon"
                        onClick={() => handleEdit(contato)}
                        title="Editar"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        className="btn-icon danger"
                        onClick={() => handleDelete(contato.id)}
                        title="Excluir"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingContato ? 'Editar Contato' : 'Novo Contato'}</h2>
            <div className="form-group">
              <label>Telefone *</label>
              <input
                type="text"
                placeholder="5516999999999"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
              <small>Formato: 5516999999999 (sem espaços ou caracteres especiais)</small>
            </div>
            <div className="form-group">
              <label>Nome</label>
              <input
                type="text"
                placeholder="Nome do contato"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowModal(false)}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={handleSave}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {showCsvModal && (
        <div className="modal-overlay" onClick={() => !csvLoading && setShowCsvModal(false)}>
          <div className="modal-content csv-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Importar Contatos via CSV</h2>
            <p className="csv-info">
              O arquivo CSV deve conter pelo menos a coluna de telefone. 
              Campos extras serão ignorados automaticamente.
            </p>
            <div className="form-group">
              <label>Arquivo CSV *</label>
              <input
                type="file"
                accept=".csv"
                onChange={handleCsvFileChange}
                disabled={csvLoading}
              />
              <small>Formato esperado: telefone (obrigatório), nome (opcional)</small>
            </div>
            
            {csvPreview.length > 0 && (
              <div className="csv-preview">
                <h3>Preview (primeiras {csvPreview.length} linhas):</h3>
                <div className="csv-preview-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Telefone</th>
                        <th>Nome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreview.map((row, idx) => (
                        <tr key={idx}>
                          <td>{row.phone}</td>
                          <td>{row.name || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button 
                className="btn-secondary" 
                onClick={() => {
                  setShowCsvModal(false)
                  setCsvFile(null)
                  setCsvPreview([])
                }}
                disabled={csvLoading}
              >
                Cancelar
              </button>
              <button 
                className="btn-primary" 
                onClick={handleCsvImport}
                disabled={!csvFile || csvLoading}
              >
                {csvLoading ? 'Importando...' : 'Importar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

