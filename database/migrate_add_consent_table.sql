-- Migração: Adicionar tabela de consentimento de contatos

-- Criar tabela de consentimento
CREATE TABLE IF NOT EXISTS contact_consent (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) UNIQUE NOT NULL,
    consented BOOLEAN,
    consent_message_sent BOOLEAN DEFAULT FALSE,
    consent_message_sent_at TIMESTAMP,
    response_received BOOLEAN DEFAULT FALSE,
    response_received_at TIMESTAMP,
    response_text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_contact_consent_phone ON contact_consent(phone);
CREATE INDEX idx_contact_consent_consented ON contact_consent(consented);
CREATE INDEX idx_contact_consent_message_sent ON contact_consent(consent_message_sent);
