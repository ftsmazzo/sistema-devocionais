-- Migração: Adicionar tabelas de auditoria e refatorar engajamento para sistema de pontos

-- 1. Atualizar ContactEngagement para usar sistema de pontos (0-100)
-- Primeiro, verificar se precisa converter valores antigos
DO $$
BEGIN
    -- Se houver valores <= 1.0, converter para 0-100
    IF EXISTS (SELECT 1 FROM contact_engagement WHERE engagement_score <= 1.0 AND engagement_score > 0) THEN
        UPDATE contact_engagement 
        SET engagement_score = engagement_score * 100.0 
        WHERE engagement_score <= 1.0 AND engagement_score > 0;
    END IF;
    
    -- Se houver valores NULL ou 0, definir como 100 (padrão inicial)
    UPDATE contact_engagement 
    SET engagement_score = 100.0 
    WHERE engagement_score IS NULL OR engagement_score = 0;
END $$;

-- Garantir que o default seja 100.0
ALTER TABLE contact_engagement 
ALTER COLUMN engagement_score SET DEFAULT 100.0;

-- 2. Criar tabela de eventos de webhook
CREATE TABLE IF NOT EXISTS webhook_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    instance_name VARCHAR(100),
    message_id VARCHAR(100),
    status_received VARCHAR(50),
    phone VARCHAR(20),
    raw_data TEXT,
    processed BOOLEAN DEFAULT FALSE,
    processing_error TEXT,
    updated_message_status VARCHAR(20),
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);

CREATE INDEX idx_webhook_events_event_type ON webhook_events(event_type);
CREATE INDEX idx_webhook_events_message_id ON webhook_events(message_id);
CREATE INDEX idx_webhook_events_phone ON webhook_events(phone);
CREATE INDEX idx_webhook_events_processed ON webhook_events(processed);
CREATE INDEX idx_webhook_events_received_at ON webhook_events(received_at);

-- 3. Criar tabela de histórico de engajamento
CREATE TABLE IF NOT EXISTS engagement_history (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    points_change FLOAT NOT NULL,
    points_before FLOAT NOT NULL,
    points_after FLOAT NOT NULL,
    message_id VARCHAR(100),
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_engagement_history_phone ON engagement_history(phone);
CREATE INDEX idx_engagement_history_action_type ON engagement_history(action_type);
CREATE INDEX idx_engagement_history_created_at ON engagement_history(created_at);
