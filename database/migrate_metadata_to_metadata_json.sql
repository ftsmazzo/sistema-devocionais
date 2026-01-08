-- Script de migração: Renomear metadata para metadata_json
-- Execute este script ANTES de fazer o redeploy

-- =====================================================
-- PASSO 1: Remover views que dependem da coluna metadata
-- =====================================================

DROP VIEW IF EXISTS devocional_hoje CASCADE;
DROP VIEW IF EXISTS devocional_stats CASCADE;
DROP VIEW IF EXISTS vw_devocional_hoje CASCADE;
DROP VIEW IF EXISTS vw_devocional_contexto CASCADE;

-- =====================================================
-- PASSO 2: Renomear coluna metadata para metadata_json
-- =====================================================

-- Verificar se a coluna metadata existe
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'devocionais' 
        AND column_name = 'metadata'
    ) THEN
        -- Renomear coluna
        ALTER TABLE devocionais RENAME COLUMN metadata TO metadata_json;
        
        -- Alterar tipo de JSONB para TEXT (se necessário)
        ALTER TABLE devocionais ALTER COLUMN metadata_json TYPE TEXT USING metadata_json::TEXT;
        
        RAISE NOTICE 'Coluna metadata renomeada para metadata_json com sucesso!';
    ELSE
        RAISE NOTICE 'Coluna metadata não existe. Pulando renomeação.';
    END IF;
END $$;

-- =====================================================
-- PASSO 3: Remover índice antigo (se existir)
-- =====================================================

DROP INDEX IF EXISTS idx_devocionais_metadata;

-- =====================================================
-- PASSO 4: Recriar views atualizadas
-- =====================================================

-- View para devocional de hoje (recriada com metadata_json)
CREATE OR REPLACE VIEW devocional_hoje AS
SELECT 
    d.id,
    d.title,
    d.content,
    d.date,
    d.versiculo_principal_texto,
    d.versiculo_principal_referencia,
    d.versiculo_apoio_texto,
    d.versiculo_apoio_referencia,
    d.autor,
    d.tema,
    d.palavras_chave,
    d.metadata_json,
    d.source,
    d.sent,
    d.sent_at,
    d.total_sent,
    d.created_at,
    d.updated_at,
    jsonb_build_object(
        'versiculo_principal', jsonb_build_object(
            'texto', d.versiculo_principal_texto,
            'referencia', d.versiculo_principal_referencia
        ),
        'versiculo_apoio', jsonb_build_object(
            'texto', d.versiculo_apoio_texto,
            'referencia', d.versiculo_apoio_referencia
        ),
        'autor', d.autor,
        'tema', d.tema,
        'palavras_chave', d.palavras_chave
    ) as versiculos_metadata
FROM devocionais d
WHERE d.date = CURRENT_DATE
ORDER BY d.created_at DESC
LIMIT 1;

-- Recriar view devocional_stats
CREATE OR REPLACE VIEW devocional_stats AS
SELECT 
    COUNT(DISTINCT d.id) as total_devocionais,
    COUNT(DISTINCT CASE WHEN d.sent THEN d.id END) as devocionais_enviados,
    COUNT(DISTINCT c.id) as total_contatos,
    COUNT(DISTINCT CASE WHEN c.active THEN c.id END) as contatos_ativos,
    COUNT(DISTINCT e.id) as total_envios,
    COUNT(DISTINCT CASE WHEN e.status = 'sent' THEN e.id END) as envios_sucesso,
    COUNT(DISTINCT CASE WHEN e.status = 'failed' THEN e.id END) as envios_falha,
    SUM(e.retry_count) as total_tentativas,
    AVG(CASE WHEN e.status = 'sent' THEN 1.0 ELSE 0.0 END) * 100 as taxa_sucesso
FROM devocionais d
LEFT JOIN devocional_envios e ON e.devocional_id = d.id
CROSS JOIN devocional_contatos c;

-- =====================================================
-- PASSO 5: Atualizar comentários
-- =====================================================

COMMENT ON COLUMN devocionais.metadata_json IS 'Metadados adicionais em formato JSON (TEXT) para flexibilidade';

-- =====================================================
-- FIM DA MIGRAÇÃO
-- =====================================================

SELECT 'Migração concluída com sucesso! Coluna metadata renomeada para metadata_json.' as resultado;
