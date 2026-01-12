-- Migração: Adicionar tabela de engajamento de contatos
-- Execute este script no banco de dados para criar a tabela

CREATE TABLE IF NOT EXISTS contact_engagement (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) UNIQUE NOT NULL,
    engagement_score FLOAT DEFAULT 0.5,
    total_sent INTEGER DEFAULT 0,
    total_responded INTEGER DEFAULT 0,
    total_read INTEGER DEFAULT 0,
    total_delivered INTEGER DEFAULT 0,
    last_response_date TIMESTAMP NULL,
    last_sent_date TIMESTAMP NULL,
    last_read_date TIMESTAMP NULL,
    last_delivered_date TIMESTAMP NULL,
    consecutive_no_response INTEGER DEFAULT 0,
    consecutive_not_read INTEGER DEFAULT 0,
    consecutive_not_delivered INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Criar índices
CREATE INDEX IF NOT EXISTS idx_contact_engagement_phone ON contact_engagement(phone);
CREATE INDEX IF NOT EXISTS idx_contact_engagement_score ON contact_engagement(engagement_score);
CREATE INDEX IF NOT EXISTS idx_contact_engagement_last_read ON contact_engagement(last_read_date);

-- Comentários
COMMENT ON TABLE contact_engagement IS 'Armazena dados de engajamento dos contatos para evitar banimentos';
COMMENT ON COLUMN contact_engagement.engagement_score IS 'Score de engajamento (0.0 a 1.0) - quanto maior, melhor o engajamento';
COMMENT ON COLUMN contact_engagement.total_read IS 'Total de mensagens lidas pelo contato';
COMMENT ON COLUMN contact_engagement.total_delivered IS 'Total de mensagens entregues ao contato';
COMMENT ON COLUMN contact_engagement.consecutive_not_read IS 'Mensagens consecutivas não lidas';
