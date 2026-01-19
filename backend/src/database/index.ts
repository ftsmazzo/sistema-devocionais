import { Pool, PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export async function initializeDatabase() {
  const client = await pool.connect();
  
  try {
    // Criar tabela de usuários
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar tabela de instâncias
    await client.query(`
      CREATE TABLE IF NOT EXISTS instances (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        api_key VARCHAR(255) NOT NULL,
        api_url VARCHAR(500) NOT NULL,
        instance_name VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'disconnected',
        phone_number VARCHAR(20),
        qr_code TEXT,
        last_connection TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Adicionar coluna phone_number se não existir (migração)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'instances' AND column_name = 'phone_number'
        ) THEN
          ALTER TABLE instances ADD COLUMN phone_number VARCHAR(20);
        END IF;
      END $$;
    `);

    // Criar tabela de webhooks
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id SERIAL PRIMARY KEY,
        instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
        event_type VARCHAR(100) NOT NULL,
        event_data JSONB NOT NULL,
        received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed BOOLEAN DEFAULT FALSE
      )
    `);

    // Criar índices para webhooks
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_webhook_events_instance ON webhook_events(instance_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed);
    `);

    // Criar tabela de configurações de webhook por instância
    await client.query(`
      CREATE TABLE IF NOT EXISTS instance_webhook_config (
        id SERIAL PRIMARY KEY,
        instance_id INTEGER UNIQUE REFERENCES instances(id) ON DELETE CASCADE,
        webhook_url VARCHAR(500) NOT NULL,
        events TEXT[] DEFAULT ARRAY[]::TEXT[],
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar índice para busca
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_instances_status ON instances(status)
    `);

    // ============================================
    // ESTRUTURA COMPLETA DE MONITORAMENTO
    // ============================================

    // Adicionar campos de monitoramento à tabela instances
    await client.query(`
      ALTER TABLE instances 
      ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS total_messages_sent INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_messages_received INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_message_sent_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_message_received_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS health_status VARCHAR(50) DEFAULT 'healthy',
      ADD COLUMN IF NOT EXISTS health_checked_at TIMESTAMP
    `);

    // Criar tabela de mensagens
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
        message_id VARCHAR(255) UNIQUE NOT NULL,
        remote_jid VARCHAR(255) NOT NULL,
        from_me BOOLEAN NOT NULL,
        message_type VARCHAR(50),
        message_body TEXT,
        media_url TEXT,
        media_base64 TEXT,
        timestamp TIMESTAMP NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        status_updated_at TIMESTAMP,
        read_at TIMESTAMP,
        delivered_at TIMESTAMP,
        failed_at TIMESTAMP,
        failed_reason TEXT,
        dispatch_id INTEGER REFERENCES dispatches(id),
        dispatch_type VARCHAR(50),
        contact_id INTEGER REFERENCES contacts(id),
        devocional_id INTEGER REFERENCES devocionais(id),
        message_category VARCHAR(50),
        tags TEXT[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Adicionar colunas de disparo se não existirem (migração)
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'messages' AND column_name = 'dispatch_id') THEN
          ALTER TABLE messages ADD COLUMN dispatch_id INTEGER REFERENCES dispatches(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'messages' AND column_name = 'dispatch_type') THEN
          ALTER TABLE messages ADD COLUMN dispatch_type VARCHAR(50);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'messages' AND column_name = 'contact_id') THEN
          ALTER TABLE messages ADD COLUMN contact_id INTEGER REFERENCES contacts(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'messages' AND column_name = 'devocional_id') THEN
          ALTER TABLE messages ADD COLUMN devocional_id INTEGER REFERENCES devocionais(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'messages' AND column_name = 'message_category') THEN
          ALTER TABLE messages ADD COLUMN message_category VARCHAR(50);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'messages' AND column_name = 'tags') THEN
          ALTER TABLE messages ADD COLUMN tags TEXT[];
        END IF;
      END $$;
    `);

    // Índices para messages
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_instance_id ON messages(instance_id);
      CREATE INDEX IF NOT EXISTS idx_messages_remote_jid ON messages(remote_jid);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
      CREATE INDEX IF NOT EXISTS idx_messages_from_me ON messages(from_me);
      CREATE INDEX IF NOT EXISTS idx_messages_instance_status ON messages(instance_id, status);
      CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
      CREATE INDEX IF NOT EXISTS idx_messages_dispatch ON messages(dispatch_id);
      CREATE INDEX IF NOT EXISTS idx_messages_dispatch_type ON messages(dispatch_type);
      CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);
      CREATE INDEX IF NOT EXISTS idx_messages_devocional ON messages(devocional_id);
      CREATE INDEX IF NOT EXISTS idx_messages_category ON messages(message_category);
    `);

    // Criar tabela de métricas
    await client.query(`
      CREATE TABLE IF NOT EXISTS message_metrics (
        id SERIAL PRIMARY KEY,
        instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
        metric_date DATE NOT NULL,
        hour INTEGER,
        messages_sent INTEGER DEFAULT 0,
        messages_received INTEGER DEFAULT 0,
        messages_delivered INTEGER DEFAULT 0,
        messages_read INTEGER DEFAULT 0,
        messages_failed INTEGER DEFAULT 0,
        avg_delivery_time INTEGER,
        avg_read_time INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(instance_id, metric_date, hour)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_message_metrics_instance_date ON message_metrics(instance_id, metric_date);
      CREATE INDEX IF NOT EXISTS idx_message_metrics_date ON message_metrics(metric_date);
    `);

    // Criar tabela de health log
    await client.query(`
      CREATE TABLE IF NOT EXISTS instance_health_log (
        id SERIAL PRIMARY KEY,
        instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL,
        check_type VARCHAR(50),
        response_time INTEGER,
        error_message TEXT,
        checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_health_log_instance ON instance_health_log(instance_id);
      CREATE INDEX IF NOT EXISTS idx_health_log_checked_at ON instance_health_log(checked_at);
      CREATE INDEX IF NOT EXISTS idx_health_log_status ON instance_health_log(status);
    `);

    // Criar tabela de dispatches
    await client.query(`
      CREATE TABLE IF NOT EXISTS dispatches (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        message_template TEXT NOT NULL,
        instance_ids INTEGER[],
        dispatch_type VARCHAR(50) NOT NULL DEFAULT 'marketing',
        list_id INTEGER REFERENCES contact_lists(id),
        contact_ids INTEGER[],
        devocional_id INTEGER REFERENCES devocionais(id),
        template_id INTEGER,
        blindage_config JSONB DEFAULT '{}',
        schedule_config JSONB DEFAULT '{}',
        metadata JSONB DEFAULT '{}',
        total_contacts INTEGER DEFAULT 0,
        contacts_processed INTEGER DEFAULT 0,
        contacts_success INTEGER DEFAULT 0,
        contacts_failed INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'pending',
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        stopped_at TIMESTAMP,
        stopped_by INTEGER REFERENCES users(id),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Adicionar colunas se não existirem (migração)
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'dispatches' AND column_name = 'dispatch_type') THEN
          ALTER TABLE dispatches ADD COLUMN dispatch_type VARCHAR(50) NOT NULL DEFAULT 'marketing';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'dispatches' AND column_name = 'list_id') THEN
          ALTER TABLE dispatches ADD COLUMN list_id INTEGER REFERENCES contact_lists(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'dispatches' AND column_name = 'contact_ids') THEN
          ALTER TABLE dispatches ADD COLUMN contact_ids INTEGER[];
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'dispatches' AND column_name = 'devocional_id') THEN
          ALTER TABLE dispatches ADD COLUMN devocional_id INTEGER REFERENCES devocionais(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'dispatches' AND column_name = 'blindage_config') THEN
          ALTER TABLE dispatches ADD COLUMN blindage_config JSONB DEFAULT '{}';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'dispatches' AND column_name = 'schedule_config') THEN
          ALTER TABLE dispatches ADD COLUMN schedule_config JSONB DEFAULT '{}';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'dispatches' AND column_name = 'metadata') THEN
          ALTER TABLE dispatches ADD COLUMN metadata JSONB DEFAULT '{}';
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dispatches_status ON dispatches(status);
      CREATE INDEX IF NOT EXISTS idx_dispatches_created_at ON dispatches(created_at);
      CREATE INDEX IF NOT EXISTS idx_dispatches_created_by ON dispatches(created_by);
    `);

    // Criar tabela de dispatch_contacts
    await client.query(`
      CREATE TABLE IF NOT EXISTS dispatch_contacts (
        id SERIAL PRIMARY KEY,
        dispatch_id INTEGER REFERENCES dispatches(id) ON DELETE CASCADE,
        instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
        contact_number VARCHAR(50) NOT NULL,
        contact_name VARCHAR(255),
        message_sent_id INTEGER REFERENCES messages(id),
        status VARCHAR(50) DEFAULT 'pending',
        sent_at TIMESTAMP,
        delivered_at TIMESTAMP,
        read_at TIMESTAMP,
        failed_at TIMESTAMP,
        failed_reason TEXT,
        retry_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dispatch_contacts_dispatch ON dispatch_contacts(dispatch_id);
      CREATE INDEX IF NOT EXISTS idx_dispatch_contacts_status ON dispatch_contacts(status);
      CREATE INDEX IF NOT EXISTS idx_dispatch_contacts_instance ON dispatch_contacts(instance_id);
      CREATE INDEX IF NOT EXISTS idx_dispatch_contacts_contact ON dispatch_contacts(contact_number);
    `);

    // Criar tabela de blindage_rules
    await client.query(`
      CREATE TABLE IF NOT EXISTS blindage_rules (
        id SERIAL PRIMARY KEY,
        instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
        rule_name VARCHAR(255) NOT NULL,
        rule_type VARCHAR(50) NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        config JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Permitir instance_id NULL para regras globais
    await client.query(`
      DO $$ 
      BEGIN 
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'blindage_rules' 
          AND column_name = 'instance_id' 
          AND is_nullable = 'NO'
        ) THEN
          ALTER TABLE blindage_rules ALTER COLUMN instance_id DROP NOT NULL;
        END IF;
      END $$;
    `);

    // Criar índice único para regra global de seleção (apenas uma regra global por tipo)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_blindage_rules_global_type 
      ON blindage_rules(rule_type) 
      WHERE instance_id IS NULL;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_blindage_rules_instance ON blindage_rules(instance_id);
      CREATE INDEX IF NOT EXISTS idx_blindage_rules_enabled ON blindage_rules(enabled);
      CREATE INDEX IF NOT EXISTS idx_blindage_rules_type ON blindage_rules(rule_type);
    `);

    // Criar tabela de blindage_actions
    await client.query(`
      CREATE TABLE IF NOT EXISTS blindage_actions (
        id SERIAL PRIMARY KEY,
        instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
        rule_id INTEGER REFERENCES blindage_rules(id) ON DELETE SET NULL,
        action_type VARCHAR(50) NOT NULL,
        action_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_blindage_actions_instance ON blindage_actions(instance_id);
      CREATE INDEX IF NOT EXISTS idx_blindage_actions_rule ON blindage_actions(rule_id);
      CREATE INDEX IF NOT EXISTS idx_blindage_actions_type ON blindage_actions(action_type);
      CREATE INDEX IF NOT EXISTS idx_blindage_actions_created_at ON blindage_actions(created_at);
    `);

    // Criar tabela de cache de validação de números
    await client.query(`
      CREATE TABLE IF NOT EXISTS number_validation_cache (
        phone_number VARCHAR(20) PRIMARY KEY,
        is_valid BOOLEAN NOT NULL,
        checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_number_validation_cache_checked_at 
      ON number_validation_cache(checked_at);
    `);

    // Criar tabela de devocionais
    await client.query(`
      CREATE TABLE IF NOT EXISTS devocionais (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        title VARCHAR(255) NOT NULL,
        date DATE UNIQUE NOT NULL,
        versiculo_principal JSONB,
        versiculo_apoio JSONB,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar tabela de configuração do devocional
    await client.query(`
      CREATE TABLE IF NOT EXISTS devocional_config (
        id SERIAL PRIMARY KEY,
        list_id INTEGER REFERENCES contact_lists(id),
        dispatch_hour INTEGER DEFAULT 6,
        dispatch_minute INTEGER DEFAULT 0,
        timezone VARCHAR(50) DEFAULT 'America/Sao_Paulo',
        notification_phone VARCHAR(20),
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar tabela de configuração de IA para marketing
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketing_ai_config (
        id SERIAL PRIMARY KEY,
        ai_webhook_url TEXT,
        positive_keywords TEXT[] DEFAULT ARRAY['interesse', 'quero', 'me chama', 'gostei', 'tenho interesse', 'quero saber mais', 'me passa', 'informação', 'detalhes', 'contato', 'ligar', 'ligue'],
        sentiment_analysis_enabled BOOLEAN DEFAULT TRUE,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar tabela de detecções de IA
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_detections (
        id SERIAL PRIMARY KEY,
        contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
        dispatch_id INTEGER REFERENCES dispatches(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        is_positive BOOLEAN NOT NULL,
        confidence DECIMAL(3,2) NOT NULL,
        method VARCHAR(20) NOT NULL,
        detected_keywords TEXT[],
        sentiment_score DECIMAL(3,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_detections_contact ON ai_detections(contact_id);
      CREATE INDEX IF NOT EXISTS idx_ai_detections_dispatch ON ai_detections(dispatch_id);
      CREATE INDEX IF NOT EXISTS idx_ai_detections_positive ON ai_detections(is_positive);
    `);

    // Criar tabela de interações de IA
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_interactions (
        id SERIAL PRIMARY KEY,
        dispatch_id INTEGER REFERENCES dispatches(id) ON DELETE CASCADE,
        contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
        user_message TEXT NOT NULL,
        triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_interactions_dispatch ON ai_interactions(dispatch_id);
      CREATE INDEX IF NOT EXISTS idx_ai_interactions_contact ON ai_interactions(contact_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_devocionais_date ON devocionais(date);
      CREATE INDEX IF NOT EXISTS idx_devocionais_created_at ON devocionais(created_at);
    `);

    // ============================================
    // SISTEMA DE CONTATOS, TAGS E LISTAS
    // ============================================

    // Criar tabela de contatos
    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        phone_number VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(255),
        email VARCHAR(255),
        whatsapp_validated BOOLEAN DEFAULT FALSE,
        whatsapp_validated_at TIMESTAMP,
        opt_in BOOLEAN DEFAULT TRUE,
        opt_in_at TIMESTAMP,
        opt_out BOOLEAN DEFAULT FALSE,
        opt_out_at TIMESTAMP,
        opt_out_reason TEXT,
        source VARCHAR(100) DEFAULT 'manual',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_message_sent_at TIMESTAMP,
        last_message_received_at TIMESTAMP,
        total_messages_sent INTEGER DEFAULT 0,
        total_messages_received INTEGER DEFAULT 0
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_number);
      CREATE INDEX IF NOT EXISTS idx_contacts_opt_in ON contacts(opt_in);
      CREATE INDEX IF NOT EXISTS idx_contacts_opt_out ON contacts(opt_out);
      CREATE INDEX IF NOT EXISTS idx_contacts_whatsapp_validated ON contacts(whatsapp_validated);
      CREATE INDEX IF NOT EXISTS idx_contacts_source ON contacts(source);
    `);

    // Adicionar colunas de pontuação de devocional se não existirem
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'contacts' AND column_name = 'devocional_score') THEN
          ALTER TABLE contacts ADD COLUMN devocional_score INTEGER DEFAULT 100;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'contacts' AND column_name = 'last_devocional_sent_at') THEN
          ALTER TABLE contacts ADD COLUMN last_devocional_sent_at TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'contacts' AND column_name = 'last_devocional_read_at') THEN
          ALTER TABLE contacts ADD COLUMN last_devocional_read_at TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'contacts' AND column_name = 'last_devocional_interaction_at') THEN
          ALTER TABLE contacts ADD COLUMN last_devocional_interaction_at TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'contacts' AND column_name = 'consecutive_devocional_failures') THEN
          ALTER TABLE contacts ADD COLUMN consecutive_devocional_failures INTEGER DEFAULT 0;
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contacts_devocional_score ON contacts(devocional_score);
    `);

    // Criar tabela de tags
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_tags (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        color VARCHAR(7) DEFAULT '#6366f1',
        description TEXT,
        category VARCHAR(50) DEFAULT 'custom',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar tags padrão se não existirem
    const defaultTags = [
      { name: 'devocional', color: '#10b981', category: 'devocional', description: 'Contatos que recebem devocionais' },
      { name: 'marketing', color: '#3b82f6', category: 'marketing', description: 'Contatos para campanhas de marketing' },
      { name: 'vip', color: '#f59e0b', category: 'vip', description: 'Contatos VIP' },
      { name: 'teste', color: '#8b5cf6', category: 'teste', description: 'Contatos para testes' },
      { name: 'bloqueado', color: '#ef4444', category: 'bloqueado', description: 'Contatos bloqueados/opt-out' }
    ];

    for (const tag of defaultTags) {
      await client.query(
        `INSERT INTO contact_tags (name, color, category, description)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO NOTHING`,
        [tag.name, tag.color, tag.category, tag.description]
      );
    }

    // Criar tabela de relação contato-tag
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_tag_relations (
        contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
        tag_id INTEGER REFERENCES contact_tags(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (contact_id, tag_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_tag_contact ON contact_tag_relations(contact_id);
      CREATE INDEX IF NOT EXISTS idx_contact_tag_tag ON contact_tag_relations(tag_id);
    `);

    // Criar tabela de listas
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_lists (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        list_type VARCHAR(50) NOT NULL DEFAULT 'static',
        filter_config JSONB DEFAULT '{}',
        total_contacts INTEGER DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_lists_type ON contact_lists(list_type);
      CREATE INDEX IF NOT EXISTS idx_contact_lists_created_by ON contact_lists(created_by);
    `);

    // Criar tabela de itens de lista
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_list_items (
        id SERIAL PRIMARY KEY,
        list_id INTEGER REFERENCES contact_lists(id) ON DELETE CASCADE,
        contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(list_id, contact_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_list_items_list ON contact_list_items(list_id);
      CREATE INDEX IF NOT EXISTS idx_list_items_contact ON contact_list_items(contact_id);
    `);

    // Melhorar tabela webhook_events
    await client.query(`
      ALTER TABLE webhook_events
      ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS processing_time INTEGER,
      ADD COLUMN IF NOT EXISTS error_message TEXT
    `);

    // ============================================
    // FUNÇÕES SQL
    // ============================================

    // Função: Atualizar Métricas Automaticamente
    await client.query(`
      CREATE OR REPLACE FUNCTION update_message_metrics()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO message_metrics (
          instance_id,
          metric_date,
          hour,
          messages_sent,
          messages_received,
          messages_delivered,
          messages_read,
          messages_failed
        )
        VALUES (
          NEW.instance_id,
          DATE(NEW.timestamp),
          EXTRACT(HOUR FROM NEW.timestamp)::INTEGER,
          CASE WHEN NEW.from_me THEN 1 ELSE 0 END,
          CASE WHEN NOT NEW.from_me THEN 1 ELSE 0 END,
          CASE WHEN NEW.status = 'delivered' THEN 1 ELSE 0 END,
          CASE WHEN NEW.status = 'read' THEN 1 ELSE 0 END,
          CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END
        )
        ON CONFLICT (instance_id, metric_date, hour)
        DO UPDATE SET
          messages_sent = message_metrics.messages_sent + 
            CASE WHEN NEW.from_me THEN 1 ELSE 0 END,
          messages_received = message_metrics.messages_received + 
            CASE WHEN NOT NEW.from_me THEN 1 ELSE 0 END,
          messages_delivered = message_metrics.messages_delivered + 
            CASE WHEN NEW.status = 'delivered' THEN 1 ELSE 0 END,
          messages_read = message_metrics.messages_read + 
            CASE WHEN NEW.status = 'read' THEN 1 ELSE 0 END,
          messages_failed = message_metrics.messages_failed + 
            CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END,
          updated_at = CURRENT_TIMESTAMP;
        
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Função: Atualizar Estatísticas da Instância
    await client.query(`
      CREATE OR REPLACE FUNCTION update_instance_stats()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE instances
        SET
          total_messages_sent = (
            SELECT COUNT(*) FROM messages 
            WHERE instance_id = NEW.instance_id AND from_me = TRUE
          ),
          total_messages_received = (
            SELECT COUNT(*) FROM messages 
            WHERE instance_id = NEW.instance_id AND from_me = FALSE
          ),
          last_message_sent_at = (
            SELECT MAX(timestamp) FROM messages 
            WHERE instance_id = NEW.instance_id AND from_me = TRUE
          ),
          last_message_received_at = (
            SELECT MAX(timestamp) FROM messages 
            WHERE instance_id = NEW.instance_id AND from_me = FALSE
          ),
          last_activity_at = NEW.timestamp,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.instance_id;
        
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Função: Atualizar Status de Mensagem
    await client.query(`
      CREATE OR REPLACE FUNCTION update_message_status()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.status = 'delivered' AND (OLD.status IS NULL OR OLD.status != 'delivered') THEN
          NEW.delivered_at = CURRENT_TIMESTAMP;
        END IF;
        
        IF NEW.status = 'read' AND (OLD.status IS NULL OR OLD.status != 'read') THEN
          NEW.read_at = CURRENT_TIMESTAMP;
        END IF;
        
        IF NEW.status = 'failed' AND (OLD.status IS NULL OR OLD.status != 'failed') THEN
          NEW.failed_at = CURRENT_TIMESTAMP;
        END IF;
        
        NEW.status_updated_at = CURRENT_TIMESTAMP;
        NEW.updated_at = CURRENT_TIMESTAMP;
        
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Função: Detectar Queda de Instância
    await client.query(`
      CREATE OR REPLACE FUNCTION check_instance_health()
      RETURNS void AS $$
      DECLARE
        inst RECORD;
        last_activity INTERVAL;
      BEGIN
        FOR inst IN 
          SELECT id, name, last_activity_at, status 
          FROM instances 
          WHERE status = 'connected'
        LOOP
          last_activity := NOW() - COALESCE(inst.last_activity_at, NOW() - INTERVAL '10 minutes');
          
          IF last_activity > INTERVAL '5 minutes' THEN
            INSERT INTO instance_health_log (instance_id, status, check_type, error_message)
            VALUES (
              inst.id, 
              'degraded', 
              'automatic', 
              'Sem atividade há ' || EXTRACT(EPOCH FROM last_activity)::INTEGER || ' segundos'
            );
            
            UPDATE instances
            SET 
              health_status = 'degraded', 
              health_checked_at = NOW()
            WHERE id = inst.id;
          ELSIF last_activity <= INTERVAL '2 minutes' THEN
            UPDATE instances
            SET 
              health_status = 'healthy', 
              health_checked_at = NOW()
            WHERE id = inst.id AND health_status != 'healthy';
          END IF;
        END LOOP;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // ============================================
    // TRIGGERS
    // ============================================

    // Trigger: Atualizar Métricas
    await client.query(`
      DROP TRIGGER IF EXISTS trigger_update_message_metrics ON messages;
      CREATE TRIGGER trigger_update_message_metrics
      AFTER INSERT OR UPDATE ON messages
      FOR EACH ROW
      EXECUTE FUNCTION update_message_metrics();
    `);

    // Trigger: Atualizar Estatísticas da Instância
    await client.query(`
      DROP TRIGGER IF EXISTS trigger_update_instance_stats ON messages;
      CREATE TRIGGER trigger_update_instance_stats
      AFTER INSERT OR UPDATE ON messages
      FOR EACH ROW
      EXECUTE FUNCTION update_instance_stats();
    `);

    // Trigger: Atualizar Status de Mensagem
    await client.query(`
      DROP TRIGGER IF EXISTS trigger_update_message_status ON messages;
      CREATE TRIGGER trigger_update_message_status
      BEFORE UPDATE ON messages
      FOR EACH ROW
      WHEN (OLD.status IS DISTINCT FROM NEW.status)
      EXECUTE FUNCTION update_message_status();
    `);

    // ============================================
    // VIEWS ÚTEIS
    // ============================================

    // View: Estatísticas de Instâncias
    await client.query(`
      CREATE OR REPLACE VIEW v_instance_stats AS
      SELECT 
        i.id,
        i.name,
        i.instance_name,
        i.status,
        i.health_status,
        i.phone_number,
        i.total_messages_sent,
        i.total_messages_received,
        i.last_activity_at,
        i.last_message_sent_at,
        i.last_message_received_at,
        COALESCE(
          (SELECT COUNT(*) FROM messages m 
           WHERE m.instance_id = i.id 
           AND m.from_me = TRUE 
           AND m.timestamp > NOW() - INTERVAL '24 hours'), 
          0
        ) as messages_sent_24h,
        COALESCE(
          (SELECT COUNT(*) FROM messages m 
           WHERE m.instance_id = i.id 
           AND m.from_me = FALSE 
           AND m.timestamp > NOW() - INTERVAL '24 hours'), 
          0
        ) as messages_received_24h,
        COALESCE(
          (SELECT COUNT(*) FILTER (WHERE status = 'delivered') * 100.0 / 
           NULLIF(COUNT(*) FILTER (WHERE from_me = TRUE), 0)
           FROM messages 
           WHERE instance_id = i.id AND from_me = TRUE), 
          0
        ) as delivery_rate
      FROM instances i;
    `);

    // View: Métricas Diárias
    await client.query(`
      CREATE OR REPLACE VIEW v_daily_metrics AS
      SELECT 
        mm.instance_id,
        i.name as instance_name,
        mm.metric_date,
        SUM(mm.messages_sent) as total_sent,
        SUM(mm.messages_received) as total_received,
        SUM(mm.messages_delivered) as total_delivered,
        SUM(mm.messages_read) as total_read,
        SUM(mm.messages_failed) as total_failed,
        CASE 
          WHEN SUM(mm.messages_sent) > 0 
          THEN (SUM(mm.messages_delivered) * 100.0 / SUM(mm.messages_sent))
          ELSE 0 
        END as delivery_rate,
        CASE 
          WHEN SUM(mm.messages_delivered) > 0 
          THEN (SUM(mm.messages_read) * 100.0 / SUM(mm.messages_delivered))
          ELSE 0 
        END as read_rate
      FROM message_metrics mm
      JOIN instances i ON i.id = mm.instance_id
      GROUP BY mm.instance_id, i.name, mm.metric_date
      ORDER BY mm.metric_date DESC, mm.instance_id;
    `);

    // Criar usuário admin padrão se não existir
    const adminCheck = await client.query('SELECT id FROM users WHERE email = $1', [
      process.env.ADMIN_EMAIL || 'admin@example.com'
    ]);

    if (adminCheck.rows.length === 0) {
      const hashedPassword = await bcrypt.hash(
        process.env.ADMIN_PASSWORD || 'admin123',
        10
      );
      
      await client.query(
        'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)',
        [
          process.env.ADMIN_EMAIL || 'admin@example.com',
          hashedPassword,
          'Administrador',
          'admin'
        ]
      );
      console.log('👤 Usuário admin criado');
    }

    console.log('✅ Tabelas criadas/verificadas');
  } finally {
    client.release();
  }
}

export { pool };
export default pool;
