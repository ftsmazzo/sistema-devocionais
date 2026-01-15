-- =====================================================
-- Migração: Tornar recipient_phone nullable em agendamento_envios
-- =====================================================
-- 
-- Motivo: Agendamentos gerais (para todos os contatos) não precisam
-- de recipient_phone específico. Apenas agendamentos individuais precisam.
--
-- =====================================================

BEGIN;

-- 1. Tornar recipient_phone nullable
ALTER TABLE agendamento_envios 
ALTER COLUMN recipient_phone DROP NOT NULL;

-- 2. Verificar se a alteração foi aplicada
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'agendamento_envios' 
AND column_name = 'recipient_phone';

COMMIT;

-- =====================================================
-- FIM DA MIGRAÇÃO
-- =====================================================

SELECT '✅ Migração concluída: recipient_phone agora é nullable' as resultado;
