-- Script ALTERNATIVO usando TRUNCATE (mais rápido)
-- Limpa devocionais e envios, mantendo contatos

-- =====================================================
-- ATENÇÃO: Este script vai APAGAR todos os devocionais e envios
-- Mas vai MANTER os contatos
-- =====================================================

-- Desabilitar verificação de foreign keys temporariamente
SET session_replication_role = 'replica';

-- 1. Limpar envios (devocional_envios)
TRUNCATE TABLE devocional_envios RESTART IDENTITY CASCADE;

-- 2. Limpar devocionais (devocionais)
TRUNCATE TABLE devocionais RESTART IDENTITY CASCADE;

-- Reabilitar verificação de foreign keys
SET session_replication_role = 'origin';

-- 3. Verificar contatos (devem estar intactos)
SELECT 
    COUNT(*) as total_contatos,
    COUNT(CASE WHEN active = true THEN 1 END) as contatos_ativos
FROM devocional_contatos;

-- 4. Verificar limpeza
SELECT 
    (SELECT COUNT(*) FROM devocionais) as total_devocionais,
    (SELECT COUNT(*) FROM devocional_envios) as total_envios,
    (SELECT COUNT(*) FROM devocional_contatos) as total_contatos;

-- =====================================================
-- FIM DA LIMPEZA
-- =====================================================

SELECT 'Limpeza concluída! Devocionais e envios removidos. Contatos mantidos.' as resultado;
