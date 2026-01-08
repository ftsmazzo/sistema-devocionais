-- Script para limpar devocionais e envios, mantendo contatos
-- Execute este SQL no banco de dados

-- =====================================================
-- ATENÇÃO: Este script vai APAGAR todos os devocionais e envios
-- Mas vai MANTER os contatos
-- =====================================================

-- 1. Remover todos os envios (devocional_envios)
DELETE FROM devocional_envios;

-- 2. Remover todos os devocionais (devocionais)
DELETE FROM devocionais;

-- 3. Resetar sequências (para IDs começarem do 1 novamente)
ALTER SEQUENCE devocionais_id_seq RESTART WITH 1;
ALTER SEQUENCE devocional_envios_id_seq RESTART WITH 1;

-- 4. Verificar contatos (devem estar intactos)
SELECT 
    COUNT(*) as total_contatos,
    COUNT(CASE WHEN active = true THEN 1 END) as contatos_ativos
FROM devocional_contatos;

-- 5. Verificar se devocionais foram removidos
SELECT COUNT(*) as total_devocionais FROM devocionais;
-- Deve retornar: 0

-- 6. Verificar se envios foram removidos
SELECT COUNT(*) as total_envios FROM devocional_envios;
-- Deve retornar: 0

-- =====================================================
-- FIM DA LIMPEZA
-- =====================================================

SELECT 'Limpeza concluída! Devocionais e envios removidos. Contatos mantidos.' as resultado;
