-- Migração: Adicionar campos faltantes na tabela evolution_instance_configs
-- Execute este script no banco de dados para adicionar os campos necessários

-- Adicionar campo status se não existir
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'evolution_instance_configs' 
        AND column_name = 'status'
    ) THEN
        ALTER TABLE evolution_instance_configs 
        ADD COLUMN status VARCHAR(20) DEFAULT 'unknown';
    END IF;
END $$;

-- Adicionar campo phone_number se não existir
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'evolution_instance_configs' 
        AND column_name = 'phone_number'
    ) THEN
        ALTER TABLE evolution_instance_configs 
        ADD COLUMN phone_number VARCHAR(20) NULL;
    END IF;
END $$;

-- Adicionar campo last_check se não existir
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'evolution_instance_configs' 
        AND column_name = 'last_check'
    ) THEN
        ALTER TABLE evolution_instance_configs 
        ADD COLUMN last_check TIMESTAMP NULL;
    END IF;
END $$;

-- Adicionar campo messages_sent_today se não existir
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'evolution_instance_configs' 
        AND column_name = 'messages_sent_today'
    ) THEN
        ALTER TABLE evolution_instance_configs 
        ADD COLUMN messages_sent_today INTEGER DEFAULT 0;
    END IF;
END $$;

-- Adicionar campo messages_sent_this_hour se não existir
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'evolution_instance_configs' 
        AND column_name = 'messages_sent_this_hour'
    ) THEN
        ALTER TABLE evolution_instance_configs 
        ADD COLUMN messages_sent_this_hour INTEGER DEFAULT 0;
    END IF;
END $$;

-- Adicionar campo error_count se não existir
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'evolution_instance_configs' 
        AND column_name = 'error_count'
    ) THEN
        ALTER TABLE evolution_instance_configs 
        ADD COLUMN error_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- Adicionar campo last_error se não existir
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'evolution_instance_configs' 
        AND column_name = 'last_error'
    ) THEN
        ALTER TABLE evolution_instance_configs 
        ADD COLUMN last_error VARCHAR(500) NULL;
    END IF;
END $$;

-- Criar índice no status se não existir
CREATE INDEX IF NOT EXISTS idx_evolution_instance_configs_status 
ON evolution_instance_configs(status);
