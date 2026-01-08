-- =====================================================
-- Schema PostgreSQL para Sistema de Devocionais
-- Otimizado para armazenar devocionais do n8n
-- =====================================================

-- Tabela principal de devocionais
CREATE TABLE IF NOT EXISTS devocionais (
    id SERIAL PRIMARY KEY,
    
    -- Conteúdo principal
    title VARCHAR(255),                    -- Título do devocional (sem emoji)
    content TEXT NOT NULL,                -- Texto completo formatado para WhatsApp
    date DATE NOT NULL DEFAULT CURRENT_DATE,  -- Data do devocional
    
    -- Versículos estruturados
    versiculo_principal_texto TEXT,       -- Texto do versículo principal
    versiculo_principal_referencia VARCHAR(100),  -- Referência bíblica
    versiculo_apoio_texto TEXT,           -- Texto do versículo de apoio
    versiculo_apoio_referencia VARCHAR(100),     -- Referência bíblica
    
    -- Metadados
    source VARCHAR(50) DEFAULT 'n8n',     -- Fonte: 'n8n', 'api', 'manual', 'webhook'
    autor VARCHAR(100) DEFAULT 'Alex e Daniela Mantovani',
    tema VARCHAR(100),                     -- Tema principal
    palavras_chave TEXT[],                -- Array de palavras-chave
    
    -- Status e controle
    sent BOOLEAN DEFAULT FALSE,            -- Se já foi enviado
    sent_at TIMESTAMP,                     -- Quando foi enviado
    total_sent INTEGER DEFAULT 0,          -- Quantas vezes foi enviado
    
    -- Metadados adicionais (JSON)
    metadata_json TEXT,                        -- Metadados extras em JSON
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    
    -- Nota: Removida constraint UNIQUE(date) para permitir múltiplos devocionais por dia
);

-- Índices adicionais
CREATE INDEX IF NOT EXISTS idx_devocionais_date ON devocionais(date);
CREATE INDEX IF NOT EXISTS idx_devocionais_sent ON devocionais(sent);
CREATE INDEX IF NOT EXISTS idx_devocionais_source ON devocionais(source);
CREATE INDEX IF NOT EXISTS idx_devocionais_created_at ON devocionais(created_at DESC);

-- Índice GIN para busca em metadata_json JSONB (removido pois agora é TEXT)
-- CREATE INDEX IF NOT EXISTS idx_devocionais_metadata ON devocionais USING GIN(metadata_json);

-- Índice para busca full-text no conteúdo
CREATE INDEX IF NOT EXISTS idx_devocionais_content_search ON devocionais USING GIN(to_tsvector('portuguese', content));

-- =====================================================
-- Tabela de contatos
-- =====================================================

CREATE TABLE IF NOT EXISTS devocional_contatos (
    id SERIAL PRIMARY KEY,
    
    phone VARCHAR(20) UNIQUE NOT NULL,      -- Telefone (formato: 5516996480805)
    name VARCHAR(100),                     -- Nome do contato
    
    -- Status
    active BOOLEAN DEFAULT TRUE,           -- Se está ativo para receber
    
    -- Estatísticas
    last_sent TIMESTAMP,                   -- Último envio
    total_sent INTEGER DEFAULT 0,           -- Total de devocionais recebidos
    
    -- Metadados
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Índices
    CONSTRAINT devocional_contatos_phone_idx UNIQUE (phone)
);

CREATE INDEX IF NOT EXISTS idx_contatos_active ON devocional_contatos(active);
CREATE INDEX IF NOT EXISTS idx_contatos_name ON devocional_contatos(name);

-- =====================================================
-- Tabela de envios (histórico)
-- =====================================================

CREATE TABLE IF NOT EXISTS devocional_envios (
    id SERIAL PRIMARY KEY,
    
    -- Relacionamento
    devocional_id INTEGER REFERENCES devocionais(id) ON DELETE SET NULL,
    recipient_phone VARCHAR(20) NOT NULL,
    recipient_name VARCHAR(100),
    
    -- Mensagem enviada
    message_text TEXT NOT NULL,            -- Texto que foi enviado (pode ter personalização)
    
    -- Status do envio
    status VARCHAR(20) DEFAULT 'pending',   -- pending, sent, failed, retrying, blocked
    message_id VARCHAR(100),                -- ID da mensagem na Evolution API
    error_message TEXT,                     -- Mensagem de erro (se houver)
    retry_count INTEGER DEFAULT 0,          -- Número de tentativas
    
    -- Timestamps
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    scheduled_for TIMESTAMP,                -- Para envios agendados
    
    -- Índices
    CONSTRAINT devocional_envios_status_check CHECK (status IN ('pending', 'sent', 'failed', 'retrying', 'blocked'))
);

CREATE INDEX IF NOT EXISTS idx_envios_devocional_id ON devocional_envios(devocional_id);
CREATE INDEX IF NOT EXISTS idx_envios_phone ON devocional_envios(recipient_phone);
CREATE INDEX IF NOT EXISTS idx_envios_status ON devocional_envios(status);
CREATE INDEX IF NOT EXISTS idx_envios_sent_at ON devocional_envios(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_envios_scheduled ON devocional_envios(scheduled_for) WHERE scheduled_for IS NOT NULL;

-- =====================================================
-- Função para atualizar updated_at automaticamente
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers para atualizar updated_at
CREATE TRIGGER update_devocionais_updated_at 
    BEFORE UPDATE ON devocionais 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contatos_updated_at 
    BEFORE UPDATE ON devocional_contatos 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- View para estatísticas
-- =====================================================

CREATE OR REPLACE VIEW devocional_stats AS
SELECT 
    COUNT(DISTINCT d.id) as total_devocionais,
    COUNT(DISTINCT CASE WHEN d.sent THEN d.id END) as devocionais_enviados,
    COUNT(DISTINCT c.id) as total_contatos,
    COUNT(DISTINCT CASE WHEN c.active THEN c.id END) as contatos_ativos,
    COUNT(DISTINCT e.id) as total_envios,
    COUNT(DISTINCT CASE WHEN e.status = 'sent' THEN e.id END) as envios_sucesso,
    COUNT(DISTINCT CASE WHEN e.status = 'failed' THEN e.id END) as envios_falha,
    SUM(e.retry_count) as total_tentativas,
    AVG(CASE WHEN e.status = 'sent' THEN 1.0 ELSE 0.0 END) * 100 as taxa_sucesso
FROM devocionais d
LEFT JOIN devocional_envios e ON e.devocional_id = d.id
CROSS JOIN devocional_contatos c;

-- =====================================================
-- View para devocional de hoje
-- =====================================================

CREATE OR REPLACE VIEW devocional_hoje AS
SELECT 
    d.*,
    jsonb_build_object(
        'versiculo_principal', jsonb_build_object(
            'texto', d.versiculo_principal_texto,
            'referencia', d.versiculo_principal_referencia
        ),
        'versiculo_apoio', jsonb_build_object(
            'texto', d.versiculo_apoio_texto,
            'referencia', d.versiculo_apoio_referencia
        ),
        'autor', d.autor,
        'tema', d.tema,
        'palavras_chave', d.palavras_chave
    ) as versiculos_metadata
FROM devocionais d
WHERE d.date = CURRENT_DATE
ORDER BY d.created_at DESC
LIMIT 1;

-- =====================================================
-- Função para marcar devocional como enviado
-- =====================================================

CREATE OR REPLACE FUNCTION marcar_devocional_enviado(devocional_id INTEGER)
RETURNS VOID AS $$
BEGIN
    UPDATE devocionais 
    SET 
        sent = TRUE,
        sent_at = CURRENT_TIMESTAMP,
        total_sent = total_sent + 1
    WHERE id = devocional_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Função para obter contatos ativos
-- =====================================================

CREATE OR REPLACE FUNCTION get_contatos_ativos()
RETURNS TABLE (
    id INTEGER,
    phone VARCHAR,
    name VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id,
        c.phone,
        c.name
    FROM devocional_contatos c
    WHERE c.active = TRUE
    ORDER BY c.name, c.phone;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Comentários nas tabelas (documentação)
-- =====================================================

COMMENT ON TABLE devocionais IS 'Armazena devocionais gerados pelo n8n ou outras fontes';
COMMENT ON TABLE devocional_contatos IS 'Lista de contatos que recebem devocionais';
COMMENT ON TABLE devocional_envios IS 'Histórico de envios de devocionais';

COMMENT ON COLUMN devocionais.content IS 'Texto completo formatado para WhatsApp com emojis e formatação';
COMMENT ON COLUMN devocionais.metadata_json IS 'Metadados adicionais em formato JSON (TEXT) para flexibilidade';
COMMENT ON COLUMN devocional_envios.message_text IS 'Texto enviado (pode incluir personalização com nome)';

-- =====================================================
-- FIM DO SCHEMA
-- =====================================================
