-- ============================================
-- MIGRAÇÕES E ESTRUTURAS DO BANCO DE DADOS
-- Sistema de Monitoramento e Métricas
-- ============================================

-- ============================================
-- 1. ATUALIZAR TABELA INSTANCES
-- ============================================

-- Adicionar campos de monitoramento e estatísticas
ALTER TABLE instances 
ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS total_messages_sent INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_messages_received INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_message_sent_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS last_message_received_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS health_status VARCHAR(50) DEFAULT 'healthy',
ADD COLUMN IF NOT EXISTS health_checked_at TIMESTAMP;

-- ============================================
-- 2. TABELA MESSAGES
-- ============================================

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
  failed_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para messages
CREATE INDEX IF NOT EXISTS idx_messages_instance_id ON messages(instance_id);
CREATE INDEX IF NOT EXISTS idx_messages_remote_jid ON messages(remote_jid);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_from_me ON messages(from_me);
CREATE INDEX IF NOT EXISTS idx_messages_instance_status ON messages(instance_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);

-- ============================================
-- 3. TABELA MESSAGE_METRICS
-- ============================================

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
);

-- Índices para message_metrics
CREATE INDEX IF NOT EXISTS idx_message_metrics_instance_date ON message_metrics(instance_id, metric_date);
CREATE INDEX IF NOT EXISTS idx_message_metrics_date ON message_metrics(metric_date);

-- ============================================
-- 4. TABELA INSTANCE_HEALTH_LOG
-- ============================================

CREATE TABLE IF NOT EXISTS instance_health_log (
  id SERIAL PRIMARY KEY,
  instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  check_type VARCHAR(50),
  response_time INTEGER,
  error_message TEXT,
  checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para instance_health_log
CREATE INDEX IF NOT EXISTS idx_health_log_instance ON instance_health_log(instance_id);
CREATE INDEX IF NOT EXISTS idx_health_log_checked_at ON instance_health_log(checked_at);
CREATE INDEX IF NOT EXISTS idx_health_log_status ON instance_health_log(status);

-- ============================================
-- 5. TABELA DISPATCHES
-- ============================================

CREATE TABLE IF NOT EXISTS dispatches (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  message_template TEXT NOT NULL,
  instance_ids INTEGER[],
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
);

-- Índices para dispatches
CREATE INDEX IF NOT EXISTS idx_dispatches_status ON dispatches(status);
CREATE INDEX IF NOT EXISTS idx_dispatches_created_at ON dispatches(created_at);
CREATE INDEX IF NOT EXISTS idx_dispatches_created_by ON dispatches(created_by);

-- ============================================
-- 6. TABELA DISPATCH_CONTACTS
-- ============================================

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
);

-- Índices para dispatch_contacts
CREATE INDEX IF NOT EXISTS idx_dispatch_contacts_dispatch ON dispatch_contacts(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_contacts_status ON dispatch_contacts(status);
CREATE INDEX IF NOT EXISTS idx_dispatch_contacts_instance ON dispatch_contacts(instance_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_contacts_contact ON dispatch_contacts(contact_number);

-- ============================================
-- 7. TABELA BLINDAGE_RULES
-- ============================================

CREATE TABLE IF NOT EXISTS blindage_rules (
  id SERIAL PRIMARY KEY,
  instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
  rule_name VARCHAR(255) NOT NULL,
  rule_type VARCHAR(50) NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  config JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para blindage_rules
CREATE INDEX IF NOT EXISTS idx_blindage_rules_instance ON blindage_rules(instance_id);
CREATE INDEX IF NOT EXISTS idx_blindage_rules_enabled ON blindage_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_blindage_rules_type ON blindage_rules(rule_type);

-- ============================================
-- 8. TABELA BLINDAGE_ACTIONS
-- ============================================

CREATE TABLE IF NOT EXISTS blindage_actions (
  id SERIAL PRIMARY KEY,
  instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
  rule_id INTEGER REFERENCES blindage_rules(id) ON DELETE SET NULL,
  action_type VARCHAR(50) NOT NULL,
  action_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para blindage_actions
CREATE INDEX IF NOT EXISTS idx_blindage_actions_instance ON blindage_actions(instance_id);
CREATE INDEX IF NOT EXISTS idx_blindage_actions_rule ON blindage_actions(rule_id);
CREATE INDEX IF NOT EXISTS idx_blindage_actions_type ON blindage_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_blindage_actions_created_at ON blindage_actions(created_at);

-- ============================================
-- 9. MELHORAR TABELA WEBHOOK_EVENTS
-- ============================================

ALTER TABLE webhook_events
ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS processing_time INTEGER,
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- ============================================
-- 10. FUNÇÕES SQL
-- ============================================

-- Função: Atualizar Métricas Automaticamente
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

-- Função: Atualizar Estatísticas da Instância
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

-- Função: Atualizar Status de Mensagem
CREATE OR REPLACE FUNCTION update_message_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Atualizar timestamps baseado no status
  IF NEW.status = 'delivered' AND OLD.status != 'delivered' THEN
    NEW.delivered_at = CURRENT_TIMESTAMP;
  END IF;
  
  IF NEW.status = 'read' AND OLD.status != 'read' THEN
    NEW.read_at = CURRENT_TIMESTAMP;
  END IF;
  
  IF NEW.status = 'failed' AND OLD.status != 'failed' THEN
    NEW.failed_at = CURRENT_TIMESTAMP;
  END IF;
  
  NEW.status_updated_at = CURRENT_TIMESTAMP;
  NEW.updated_at = CURRENT_TIMESTAMP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Função: Detectar Queda de Instância
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
    -- Se não teve atividade nos últimos 5 minutos, considerar degradada
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
      -- Se teve atividade recente, marcar como healthy
      UPDATE instances
      SET 
        health_status = 'healthy', 
        health_checked_at = NOW()
      WHERE id = inst.id AND health_status != 'healthy';
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 11. TRIGGERS
-- ============================================

-- Trigger: Atualizar Métricas ao Criar/Atualizar Mensagem
DROP TRIGGER IF EXISTS trigger_update_message_metrics ON messages;
CREATE TRIGGER trigger_update_message_metrics
AFTER INSERT OR UPDATE ON messages
FOR EACH ROW
EXECUTE FUNCTION update_message_metrics();

-- Trigger: Atualizar Estatísticas da Instância
DROP TRIGGER IF EXISTS trigger_update_instance_stats ON messages;
CREATE TRIGGER trigger_update_instance_stats
AFTER INSERT OR UPDATE ON messages
FOR EACH ROW
EXECUTE FUNCTION update_instance_stats();

-- Trigger: Atualizar Status de Mensagem
DROP TRIGGER IF EXISTS trigger_update_message_status ON messages;
CREATE TRIGGER trigger_update_message_status
BEFORE UPDATE ON messages
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION update_message_status();

-- ============================================
-- 12. VIEWS ÚTEIS
-- ============================================

-- View: Estatísticas de Instâncias
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

-- View: Métricas Diárias
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
