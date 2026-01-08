# 🔧 Instruções de Migração: metadata → metadata_json

## ❌ Erro Encontrado

```
ERROR: pq: cannot alter type of a column used by a view or rule
```

Isso acontece porque a coluna `metadata` é usada por views no banco de dados.

## ✅ Solução

Execute o script de migração que remove as views, renomeia a coluna e recria as views.

## 📋 Passo a Passo

### 1. Acesse o Banco de Dados no EasyPanel

1. No EasyPanel, vá ao serviço do PostgreSQL
2. Clique em **"Database"** ou **"SQL Editor"**
3. Ou use o terminal do EasyPanel para conectar via `psql`

### 2. Execute o Script de Migração

Copie e cole o conteúdo completo de `database/migrate_metadata_to_metadata_json.sql` e execute.

**OU** execute diretamente:

```sql
-- Remover views
DROP VIEW IF EXISTS devocional_hoje CASCADE;
DROP VIEW IF EXISTS devocional_stats CASCADE;

-- Renomear coluna
ALTER TABLE devocionais RENAME COLUMN metadata TO metadata_json;
ALTER TABLE devocionais ALTER COLUMN metadata_json TYPE TEXT USING metadata_json::TEXT;

-- Remover índice antigo
DROP INDEX IF EXISTS idx_devocionais_metadata;

-- Recriar view devocional_hoje
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
```

### 3. Verificar Migração

Execute para confirmar:

```sql
-- Verificar se a coluna foi renomeada
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'devocionais' 
AND column_name LIKE '%metadata%';

-- Deve mostrar: metadata_json | text
```

## ✅ Após a Migração

1. Faça o **redeploy** no EasyPanel
2. O sistema deve funcionar normalmente
3. Todas as referências ao campo `metadata` no código já foram atualizadas para `metadata_json`

## 🆘 Se Ainda Der Erro

Se ainda houver problemas, você pode:

1. **Recriar as tabelas do zero** (se não tiver dados importantes):
   ```sql
   DROP TABLE IF EXISTS devocional_envios CASCADE;
   DROP TABLE IF EXISTS devocional_contatos CASCADE;
   DROP TABLE IF EXISTS devocionais CASCADE;
   ```
   
   Depois execute o `database/devocionais_schema.sql` completo.

2. **Ou me avise** e eu ajudo a resolver!

---

**O script de migração está em: `database/migrate_metadata_to_metadata_json.sql`** 📁
