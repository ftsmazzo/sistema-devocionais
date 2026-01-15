-- =====================================================
-- Script SIMPLES para apagar todos os devocionais
-- Execute este script se quiser uma limpeza rápida
-- =====================================================

-- 1. Apagar envios
DELETE FROM devocional_envios;

-- 2. Apagar agendamentos
DELETE FROM agendamento_envios;

-- 3. Apagar devocionais
DELETE FROM devocionais;

-- 4. Resetar sequências
ALTER SEQUENCE IF EXISTS devocionais_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS devocional_envios_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS agendamento_envios_id_seq RESTART WITH 1;

-- 5. Verificar resultado
SELECT 
    'Limpeza concluída!' as status,
    (SELECT COUNT(*) FROM devocionais) as devocionais_restantes,
    (SELECT COUNT(*) FROM devocional_envios) as envios_restantes,
    (SELECT COUNT(*) FROM devocional_contatos) as contatos_mantidos;
