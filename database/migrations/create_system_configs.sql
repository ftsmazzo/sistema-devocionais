-- Tabela para armazenar configurações do sistema
-- Criada em: 2026-01-12
-- Descrição: Armazena configurações dinâmicas do sistema (ex: horário de envio)

CREATE TABLE IF NOT EXISTS system_configs (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Índice para busca rápida por chave
CREATE INDEX IF NOT EXISTS idx_system_configs_key ON system_configs(key);

-- Inserir configuração inicial do horário de envio (se não existir)
-- Pega do .env ou usa padrão 06:00
INSERT INTO system_configs (key, value, description)
VALUES ('devocional_send_time', '06:00', 'Horário de envio automático de devocionais (formato HH:MM, horário de Brasília)')
ON CONFLICT (key) DO NOTHING;

-- Comentários nas colunas
COMMENT ON TABLE system_configs IS 'Armazena configurações dinâmicas do sistema';
COMMENT ON COLUMN system_configs.key IS 'Chave única da configuração';
COMMENT ON COLUMN system_configs.value IS 'Valor da configuração (pode ser JSON)';
COMMENT ON COLUMN system_configs.description IS 'Descrição da configuração';
