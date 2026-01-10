-- =====================================================
-- Migração: Adicionar campo instance_name
-- Data: 2024
-- Descrição: Adiciona campo para rastrear qual instância Evolution API enviou cada mensagem
-- =====================================================

-- Adicionar coluna instance_name na tabela devocional_envios
ALTER TABLE devocional_envios 
ADD COLUMN IF NOT EXISTS instance_name VARCHAR(100);

-- Criar índice para melhor performance em consultas por instância
CREATE INDEX IF NOT EXISTS idx_envios_instance_name ON devocional_envios(instance_name);

-- Comentário na coluna
COMMENT ON COLUMN devocional_envios.instance_name IS 'Nome da instância Evolution API que enviou a mensagem';

-- =====================================================
-- FIM DA MIGRAÇÃO
-- =====================================================

