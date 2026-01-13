import { useState } from 'react'
import { contatoApi, envioApi } from '../../services/api'
import type { Contato } from '../../types'
import { Send, Image, Video, FileText, X, Upload, Users, CheckCircle, AlertCircle, Loader, Mic, MicOff, Square } from 'lucide-react'
import './Mensagens.css'
import './Mensagens-responsive.css'

export default function Mensagens() {
  const [message, setMessage] = useState('')
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'audio' | null>(null)
  const [selectedContacts, setSelectedContacts] = useState<Contato[]>([])
  const [showContactSelector, setShowContactSelector] = useState(false)
  const [allContacts, setAllContacts] = useState<Contato[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ success: boolean; total: number; sent: number; failed: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  // Estados para gravação de áudio
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [audioChunks, setAudioChunks] = useState<Blob[]>([])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Determinar tipo de mídia
    if (file.type.startsWith('image/')) {
      setMediaType('image')
      setMediaFile(file)
      
      // Criar preview
      const reader = new FileReader()
      reader.onload = (event) => {
        setMediaPreview(event.target?.result as string)
      }
      reader.readAsDataURL(file)
    } else if (file.type.startsWith('video/')) {
      setMediaType('video')
      setMediaFile(file)
      
      // Criar preview para vídeo
      const reader = new FileReader()
      reader.onload = (event) => {
        setMediaPreview(event.target?.result as string)
      }
      reader.readAsDataURL(file)
    } else if (file.type.startsWith('audio/')) {
      setMediaType('audio')
      setMediaFile(file)
      
      // Criar preview para áudio
      const reader = new FileReader()
      reader.onload = (event) => {
        setMediaPreview(event.target?.result as string)
      }
      reader.readAsDataURL(file)
    } else {
      alert('Por favor, selecione uma imagem, vídeo ou áudio')
      return
    }
  }
  
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      // Tentar usar o melhor formato suportado pelo navegador
      // WhatsApp prefere: audio/ogg;codecs=opus, audio/mpeg, audio/mp4
      let mimeType = 'audio/webm;codecs=opus' // Fallback padrão
      let finalType = 'audio/ogg;codecs=opus'
      let finalExtension = 'ogg'
      
      // Verificar formatos suportados em ordem de preferência
      const supportedTypes = [
        'audio/ogg;codecs=opus',
        'audio/opus',
        'audio/webm;codecs=opus',
        'audio/webm'
      ]
      
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type
          if (type.includes('ogg') || type.includes('opus')) {
            finalType = 'audio/ogg;codecs=opus'
            finalExtension = 'ogg'
          } else {
            finalType = type
            finalExtension = 'webm'
          }
          break
        }
      }
      
      const recorder = new MediaRecorder(stream, { mimeType })
      
      const chunks: Blob[] = []
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      }
      
      recorder.onstop = async () => {
        const audioBlob = new Blob(chunks, { type: mimeType })
        
        // Criar arquivo com o tipo correto para WhatsApp
        // WhatsApp prefere OGG/Opus, mas aceita WebM se necessário
        const audioFile = new File([audioBlob], `audio-${Date.now()}.${finalExtension}`, {
          type: finalType
        })
        
        setMediaFile(audioFile)
        setMediaType('audio')
        
        // Criar preview
        const audioUrl = URL.createObjectURL(audioBlob)
        setMediaPreview(audioUrl)
        
        // Parar todas as tracks do stream
        stream.getTracks().forEach(track => track.stop())
      }
      
      recorder.start()
      setMediaRecorder(recorder)
      setAudioChunks(chunks)
      setIsRecording(true)
      setRecordingTime(0)
      
      // Timer para mostrar duração da gravação
      const timer = setInterval(() => {
        setRecordingTime((prev) => prev + 1)
      }, 1000)
      
      // Armazenar timer para limpar depois
      ;(recorder as any).timer = timer
    } catch (err) {
      console.error('Erro ao iniciar gravação:', err)
      alert('Não foi possível acessar o microfone. Verifique as permissões.')
    }
  }
  
  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop()
      setIsRecording(false)
      
      // Limpar timer
      if ((mediaRecorder as any).timer) {
        clearInterval((mediaRecorder as any).timer)
      }
    }
  }

  const handleRemoveMedia = () => {
    // Parar gravação se estiver gravando
    if (isRecording) {
      stopRecording()
    }
    
    // Limpar preview URL se for áudio
    if (mediaPreview && mediaType === 'audio') {
      URL.revokeObjectURL(mediaPreview)
    }
    
    setMediaFile(null)
    setMediaPreview(null)
    setMediaType(null)
    setRecordingTime(0)
  }

  const loadContacts = async () => {
    try {
      const contacts = await contatoApi.list(0, 1000, true) // Apenas ativos
      setAllContacts(contacts)
    } catch (err: any) {
      console.error('Erro ao carregar contatos:', err)
    }
  }

  const handleToggleContact = (contact: Contato) => {
    setSelectedContacts((prev) => {
      const exists = prev.find((c) => c.id === contact.id)
      if (exists) {
        return prev.filter((c) => c.id !== contact.id)
      } else {
        return [...prev, contact]
      }
    })
  }

  const handleSelectAll = () => {
    if (selectedContacts.length === allContacts.length) {
      setSelectedContacts([])
    } else {
      setSelectedContacts([...allContacts])
    }
  }

  const handleSend = async () => {
    if (!message.trim() && !mediaFile) {
      alert('Por favor, escreva uma mensagem ou selecione uma imagem/vídeo/áudio')
      return
    }
    
    // Parar gravação se estiver gravando
    if (isRecording) {
      stopRecording()
      // Aguardar um pouco para o áudio ser processado
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    if (selectedContacts.length === 0 && allContacts.length === 0) {
      alert('Nenhum contato disponível. Adicione contatos primeiro.')
      return
    }

    setSending(true)
    setError(null)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('message', message || '')
      
      console.log('📤 Preparando envio:', { 
        hasMediaFile: !!mediaFile, 
        mediaType, 
        fileName: mediaFile?.name,
        fileSize: mediaFile?.size,
        fileType: mediaFile?.type
      })
      
      if (mediaFile && mediaType) {
        formData.append('media_file', mediaFile)
        formData.append('media_type', mediaType)
        console.log('✅ Arquivo de mídia adicionado ao FormData')
      } else {
        console.warn('⚠️ Nenhum arquivo de mídia para enviar')
      }

      // Se contatos selecionados, enviar apenas para eles; senão, enviar para todos
      if (selectedContacts.length > 0) {
        formData.append('contacts', JSON.stringify(
          selectedContacts.map(c => ({ id: c.id, phone: c.phone, name: c.name }))
        ))
      }

      // Fazer requisição
      const response = await fetch(
        `${import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api'}/devocional/send-custom`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: formData
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || 'Erro ao enviar mensagens')
      }

      setResult(data)
      
      // Limpar formulário após sucesso
      if (data.success) {
        setMessage('')
        setMediaFile(null)
        setMediaPreview(null)
        setMediaType(null)
        setSelectedContacts([])
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar mensagens')
      console.error('Erro ao enviar:', err)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mensagens-page">
      <div className="mensagens-header">
        <div className="header-title">
          <Send size={28} />
          <div>
            <h1>Enviar Mensagem Personalizada</h1>
            <p>Envie mensagens de texto, imagens, vídeos ou áudios para seus contatos</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className={`alert ${result.success ? 'alert-success' : 'alert-warning'}`}>
          {result.success ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <div>
            <strong>{result.success ? 'Envio concluído!' : 'Envio parcial'}</strong>
            <p>
              {result.sent} de {result.total} mensagens enviadas com sucesso.
              {result.failed > 0 && ` ${result.failed} falharam.`}
            </p>
          </div>
        </div>
      )}

      <div className="mensagens-content">
        {/* Editor de Mensagem */}
        <div className="message-editor-card">
          <div className="card-header">
            <FileText size={20} />
            <h3>Mensagem</h3>
          </div>
          <div className="card-content">
            <textarea
              className="message-input"
              placeholder="Digite sua mensagem aqui..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
            />
            <div className="char-count">
              {message.length} caracteres
            </div>
          </div>
        </div>

        {/* Upload de Mídia */}
        <div className="media-upload-card">
          <div className="card-header">
            <Image size={20} />
            <h3>Mídia (Opcional)</h3>
          </div>
          <div className="card-content">
            {!mediaFile ? (
              <div className="upload-area">
                <input
                  type="file"
                  id="media-upload"
                  accept="image/*,video/*,audio/*"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <label htmlFor="media-upload" className="upload-button">
                  <Upload size={24} />
                  <div>
                    <strong>Clique para fazer upload</strong>
                    <span>Imagem (máx. 16MB), Vídeo (máx. 64MB) ou Áudio (máx. 16MB)</span>
                  </div>
                </label>
                <div className="upload-options">
                  <label htmlFor="media-upload" className="upload-option">
                    <Image size={20} />
                    <span>Imagem</span>
                  </label>
                  <label htmlFor="media-upload" className="upload-option">
                    <Video size={20} />
                    <span>Vídeo</span>
                  </label>
                  <label htmlFor="media-upload" className="upload-option">
                    <Mic size={20} />
                    <span>Áudio</span>
                  </label>
                </div>
                <div className="record-audio-section">
                  <div className="record-divider">
                    <span>ou</span>
                  </div>
                  <button
                    className={`btn-record ${isRecording ? 'recording' : ''}`}
                    onClick={isRecording ? stopRecording : startRecording}
                    type="button"
                  >
                    {isRecording ? (
                      <>
                        <Square size={20} />
                        <span>Parar Gravação</span>
                        <span className="recording-time">
                          {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
                        </span>
                      </>
                    ) : (
                      <>
                        <Mic size={20} />
                        <span>Gravar Áudio</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="media-preview">
                {mediaType === 'image' && mediaPreview && (
                  <img src={mediaPreview} alt="Preview" className="preview-image" />
                )}
                {mediaType === 'video' && mediaPreview && (
                  <video src={mediaPreview} controls className="preview-video" />
                )}
                {mediaType === 'audio' && mediaPreview && (
                  <div className="preview-audio">
                    <audio src={mediaPreview} controls className="audio-player" />
                  </div>
                )}
                <div className="media-info">
                  <span className="media-name">{mediaFile.name}</span>
                  <span className="media-size">
                    {(mediaFile.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>
                <button className="btn-remove-media" onClick={handleRemoveMedia}>
                  <X size={18} />
                  Remover
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Seleção de Contatos */}
        <div className="contacts-card">
          <div className="card-header">
            <Users size={20} />
            <h3>Destinatários</h3>
            <button
              className="btn-select-contacts"
              onClick={() => {
                if (!showContactSelector) {
                  loadContacts()
                }
                setShowContactSelector(!showContactSelector)
              }}
            >
              <Users size={16} />
              {selectedContacts.length > 0
                ? `${selectedContacts.length} selecionados`
                : 'Selecionar contatos'}
            </button>
          </div>
          <div className="card-content">
            {selectedContacts.length === 0 ? (
              <p className="info-text">
                {allContacts.length === 0
                  ? 'Carregando contatos...'
                  : 'Nenhum contato selecionado. A mensagem será enviada para todos os contatos ativos.'}
              </p>
            ) : (
              <div className="selected-contacts">
                <p className="info-text">
                  Enviando para <strong>{selectedContacts.length}</strong> contato(s) selecionado(s)
                </p>
                <div className="contacts-list">
                  {selectedContacts.slice(0, 5).map((contact) => (
                    <span key={contact.id} className="contact-tag">
                      {contact.name || contact.phone}
                    </span>
                  ))}
                  {selectedContacts.length > 5 && (
                    <span className="contact-tag more">
                      +{selectedContacts.length - 5} mais
                    </span>
                  )}
                </div>
              </div>
            )}

            {showContactSelector && (
              <div className="contact-selector">
                <div className="selector-header">
                  <button className="btn-select-all" onClick={handleSelectAll}>
                    {selectedContacts.length === allContacts.length ? 'Desmarcar todos' : 'Selecionar todos'}
                  </button>
                  <button
                    className="btn-close-selector"
                    onClick={() => setShowContactSelector(false)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="contacts-list-selector">
                  {allContacts.map((contact) => (
                    <label
                      key={contact.id}
                      className={`contact-item ${selectedContacts.find(c => c.id === contact.id) ? 'selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={!!selectedContacts.find(c => c.id === contact.id)}
                        onChange={() => handleToggleContact(contact)}
                      />
                      <div className="contact-info">
                        <span className="contact-name">{contact.name || 'Sem nome'}</span>
                        <span className="contact-phone">{contact.phone}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Botão de Envio */}
        <div className="send-actions">
          <button
            className="btn-send"
            onClick={handleSend}
            disabled={sending || (!message.trim() && !mediaFile)}
          >
            {sending ? (
              <>
                <Loader size={20} className="spinning" />
                <span>Enviando...</span>
              </>
            ) : (
              <>
                <Send size={20} />
                <span>
                  Enviar para{' '}
                  {selectedContacts.length > 0
                    ? `${selectedContacts.length} contato(s)`
                    : 'todos os contatos'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
