-- Script COMPLETO para limpar TUDO relacionado a envios e resetar sistema
-- ATENÇÃO: Este script é DESTRUTIVO e não pode ser revertido!
-- Use apenas se quiser resetar completamente o sistema de envios

BEGIN;

-- 1. Deletar todos os envios (devocional_envios)
DELETE FROM devocional_envios;
SELECT '✅ Envios deletados' as status;

-- 2. Zerar contadores de envios dos contatos e ativar todos
UPDATE devocional_contatos 
SET 
    total_sent = 0,
    last_sent = NULL,
    active = true;
SELECT '✅ Contadores de contatos zerados e todos ativados' as status;

-- 3. Limpar histórico de engajamento
DELETE FROM engagement_history;
SELECT '✅ Histórico de engajamento limpo' as status;

-- 4. Resetar scores de engajamento para 100
UPDATE contact_engagement 
SET 
    engagement_score = 100.0,
    total_sent = 0,
    total_responded = 0,
    total_read = 0,
    total_delivered = 0,
    consecutive_no_response = 0,
    consecutive_not_read = 0,
    consecutive_not_delivered = 0,
    last_response_date = NULL,
    last_sent_date = NULL,
    last_read_date = NULL,
    last_delivered_date = NULL;
SELECT '✅ Scores de engajamento resetados para 100' as status;

-- 5. Limpar eventos de webhook (opcional - mantém auditoria)
-- DELETE FROM webhook_events;
-- SELECT '✅ Eventos de webhook limpos' as status;

-- 6. Resetar consentimentos (para desenvolvimento/testes)
DELETE FROM contact_consent;
SELECT '✅ Consentimentos deletados' as status;

COMMIT;

-- Verificar resultado final
SELECT 
    '📊 RESUMO APÓS LIMPEZA' as info,
    (SELECT COUNT(*) FROM devocional_envios) as total_envios,
    (SELECT COUNT(*) FROM devocional_contatos) as total_contatos,
    (SELECT SUM(total_sent) FROM devocional_contatos) as total_sent_sum,
    (SELECT COUNT(*) FROM engagement_history) as total_historico_engajamento,
    (SELECT COUNT(*) FROM contact_engagement) as total_contatos_engajamento,
    (SELECT AVG(engagement_score) FROM contact_engagement) as score_medio,
    (SELECT COUNT(*) FROM contact_consent) as total_consentimentos;
