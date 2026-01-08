-- Script para remover constraint UNIQUE do campo date
-- Execute este SQL no banco de dados

-- Remover constraint UNIQUE se existir
ALTER TABLE devocionais 
DROP CONSTRAINT IF EXISTS devocionais_date_idx;

-- Verificar se foi removida
SELECT 
    constraint_name,
    constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'devocionais'
AND constraint_name LIKE '%date%';
