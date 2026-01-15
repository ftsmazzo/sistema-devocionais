-- =====================================================
-- Script para APAGAR TODOS OS DEVOCIONAIS
-- =====================================================
-- 
-- ATENÇÃO: Este script é DESTRUTIVO e não pode ser revertido!
-- Ele vai apagar:
--   ✅ Todos os devocionais (tabela devocionais)
--   ✅ Todos os envios relacionados (tabela devocional_envios)
--   ✅ Todos os agendamentos relacionados (tabela agendamento_envios)
--
-- Ele NÃO vai apagar:
--   ❌ Contatos (devocional_contatos)
--   ❌ Consentimentos (contact_consent)
--   ❌ Engajamento (contact_engagement)
--   ❌ Histórico de engajamento (engagement_history)
--   ❌ Instâncias (evolution_instances)
--   ❌ Configurações (system_configs)
--   ❌ Usuários (users)
--
-- =====================================================

BEGIN;

-- =====================================================
-- 1. VERIFICAÇÕES ANTES DE APAGAR
-- =====================================================

DO $$
DECLARE
    total_devocionais INTEGER;
    total_envios INTEGER;
    total_agendamentos INTEGER;
BEGIN
    -- Contar registros antes de apagar
    SELECT COUNT(*) INTO total_devocionais FROM devocionais;
    SELECT COUNT(*) INTO total_envios FROM devocional_envios;
    SELECT COUNT(*) INTO total_agendamentos FROM agendamento_envios;
    
    RAISE NOTICE '📊 ESTATÍSTICAS ANTES DA LIMPEZA:';
    RAISE NOTICE '   - Devocionais: %', total_devocionais;
    RAISE NOTICE '   - Envios: %', total_envios;
    RAISE NOTICE '   - Agendamentos: %', total_agendamentos;
END $$;

-- =====================================================
-- 2. APAGAR ENVIOS PRIMEIRO (devido à foreign key)
-- =====================================================

DELETE FROM devocional_envios;
SELECT '✅ Todos os envios foram apagados' as status;

-- =====================================================
-- 3. APAGAR AGENDAMENTOS
-- =====================================================

DELETE FROM agendamento_envios;
SELECT '✅ Todos os agendamentos foram apagados' as status;

-- =====================================================
-- 4. APAGAR DEVOCIONAIS
-- =====================================================

DELETE FROM devocionais;
SELECT '✅ Todos os devocionais foram apagados' as status;

-- =====================================================
-- 5. RESETAR SEQUÊNCIAS (IDs voltam a começar do 1)
-- =====================================================

ALTER SEQUENCE IF EXISTS devocionais_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS devocional_envios_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS agendamento_envios_id_seq RESTART WITH 1;
SELECT '✅ Sequências resetadas (IDs voltarão a começar do 1)' as status;

-- =====================================================
-- 6. VERIFICAÇÕES APÓS APAGAR
-- =====================================================

DO $$
DECLARE
    total_devocionais INTEGER;
    total_envios INTEGER;
    total_agendamentos INTEGER;
    total_contatos INTEGER;
BEGIN
    -- Contar registros após apagar
    SELECT COUNT(*) INTO total_devocionais FROM devocionais;
    SELECT COUNT(*) INTO total_envios FROM devocional_envios;
    SELECT COUNT(*) INTO total_agendamentos FROM agendamento_envios;
    SELECT COUNT(*) INTO total_contatos FROM devocional_contatos;
    
    RAISE NOTICE '';
    RAISE NOTICE '📊 ESTATÍSTICAS APÓS A LIMPEZA:';
    RAISE NOTICE '   - Devocionais: % (deve ser 0)', total_devocionais;
    RAISE NOTICE '   - Envios: % (deve ser 0)', total_envios;
    RAISE NOTICE '   - Agendamentos: % (deve ser 0)', total_agendamentos;
    RAISE NOTICE '   - Contatos: % (mantidos intactos)', total_contatos;
    
    -- Verificar se apagou tudo
    IF total_devocionais = 0 AND total_envios = 0 AND total_agendamentos = 0 THEN
        RAISE NOTICE '';
        RAISE NOTICE '✅ LIMPEZA CONCLUÍDA COM SUCESSO!';
    ELSE
        RAISE WARNING '⚠️ ATENÇÃO: Alguns registros ainda existem!';
    END IF;
END $$;

-- =====================================================
-- 7. COMMIT (ou ROLLBACK se quiser desfazer)
-- =====================================================

-- Para confirmar e apagar de verdade, execute:
COMMIT;

-- Para desfazer tudo (se mudou de ideia), execute:
-- ROLLBACK;

-- =====================================================
-- FIM DO SCRIPT
-- =====================================================

SELECT 
    '🎯 RESUMO FINAL' as info,
    (SELECT COUNT(*) FROM devocionais) as devocionais_restantes,
    (SELECT COUNT(*) FROM devocional_envios) as envios_restantes,
    (SELECT COUNT(*) FROM agendamento_envios) as agendamentos_restantes,
    (SELECT COUNT(*) FROM devocional_contatos) as contatos_mantidos;
