# 🗄️ Arquitetura de Banco de Dados - Sistema de Monitoramento e Métricas

## 📊 Visão Geral

Estrutura completa para monitoramento, métricas, blindagens e controle de disparos.

---

## 📋 Tabelas Propostas

### 1. **instances** (já existe - melhorar)
Armazena informações das instâncias do WhatsApp.

**Campos adicionais necessários:**
- `last_activity_at` - Última atividade detectada
- `total_messages_sent` - Total de mensagens enviadas
- `total_messages_received` - Total de mensagens recebidas
- `last_message_sent_at` - Data da última mensagem enviada
- `last_message_received_at` - Data da última mensagem recebida
- `health_status` - Status de saúde (healthy, degraded, down)
- `health_checked_at` - Última verificação de saúde

### 2. **messages** (NOVA)
Armazena todas as mensagens (enviadas e recebidas).

```sql
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
  message_id VARCHAR(255) UNIQUE NOT NULL, -- ID da mensagem no WhatsApp
  remote_jid VARCHAR(255) NOT NULL, -- Número/ID do destinatário/remetente
  from_me BOOLEAN NOT NULL, -- true = enviada, false = recebida
  message_type VARCHAR(50), -- text, image, video, audio, document, etc
  message_body TEXT, -- Conteúdo da mensagem
  media_url TEXT, -- URL da mídia (se houver)
  media_base64 TEXT, -- Mídia em base64 (se base64 habilitado)
  timestamp TIMESTAMP NOT NULL,
  status VARCHAR(50), -- sent, delivered, read, failed, pending
  status_updated_at TIMESTAMP,
  read_at TIMESTAMP,
  delivered_at TIMESTAMP,
  failed_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3. **message_metrics** (NOVA)
Métricas agregadas por instância e período.

```sql
CREATE TABLE message_metrics (
  id SERIAL PRIMARY KEY,
  instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  hour INTEGER, -- 0-23 (NULL = métrica diária)
  messages_sent INTEGER DEFAULT 0,
  messages_received INTEGER DEFAULT 0,
  messages_delivered INTEGER DEFAULT 0,
  messages_read INTEGER DEFAULT 0,
  messages_failed INTEGER DEFAULT 0,
  avg_delivery_time INTEGER, -- em segundos
  avg_read_time INTEGER, -- em segundos
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(instance_id, metric_date, hour)
);
```

### 4. **instance_health_log** (NOVA)
Log de saúde das instâncias (detecta quedas).

```sql
CREATE TABLE instance_health_log (
  id SERIAL PRIMARY KEY,
  instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL, -- connected, disconnected, degraded, down
  check_type VARCHAR(50), -- automatic, manual, webhook
  response_time INTEGER, -- tempo de resposta em ms
  error_message TEXT,
  checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 5. **dispatches** (NOVA)
Controle de disparos em massa.

```sql
CREATE TABLE dispatches (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  message_template TEXT NOT NULL,
  instance_ids INTEGER[], -- Array de IDs de instâncias
  total_contacts INTEGER DEFAULT 0,
  contacts_processed INTEGER DEFAULT 0,
  contacts_success INTEGER DEFAULT 0,
  contacts_failed INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending', -- pending, running, paused, completed, failed, stopped
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  stopped_at TIMESTAMP,
  stopped_by INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 6. **dispatch_contacts** (NOVA)
Contatos de cada disparo.

```sql
CREATE TABLE dispatch_contacts (
  id SERIAL PRIMARY KEY,
  dispatch_id INTEGER REFERENCES dispatches(id) ON DELETE CASCADE,
  instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
  contact_number VARCHAR(50) NOT NULL,
  contact_name VARCHAR(255),
  message_sent_id INTEGER REFERENCES messages(id),
  status VARCHAR(50) DEFAULT 'pending', -- pending, sent, delivered, read, failed
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  read_at TIMESTAMP,
  failed_at TIMESTAMP,
  failed_reason TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 7. **blindage_rules** (NOVA)
Regras de blindagem por instância.

```sql
CREATE TABLE blindage_rules (
  id SERIAL PRIMARY KEY,
  instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
  rule_name VARCHAR(255) NOT NULL,
  rule_type VARCHAR(50) NOT NULL, -- delay, limit, rotation, etc
  enabled BOOLEAN DEFAULT TRUE,
  config JSONB NOT NULL, -- Configurações específicas da regra
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 8. **blindage_actions** (NOVA)
Log de ações de blindagem aplicadas.

```sql
CREATE TABLE blindage_actions (
  id SERIAL PRIMARY KEY,
  instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
  rule_id INTEGER REFERENCES blindage_rules(id) ON DELETE SET NULL,
  action_type VARCHAR(50) NOT NULL, -- delay_applied, limit_reached, rotation, etc
  action_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 9. **webhook_events** (já existe - melhorar)
Melhorar estrutura para processamento.

**Campos adicionais:**
- `processed_at` - Quando foi processado
- `processing_time` - Tempo de processamento em ms
- `error_message` - Se houver erro no processamento

---

## 🔧 Funções e Triggers

### 1. **Função: Atualizar Métricas Automaticamente**

```sql
CREATE OR REPLACE FUNCTION update_message_metrics()
RETURNS TRIGGER AS $$
BEGIN
  -- Atualizar métricas quando mensagem é criada/atualizada
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
    EXTRACT(HOUR FROM NEW.timestamp),
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
```

### 2. **Trigger: Atualizar Métricas ao Criar Mensagem**

```sql
CREATE TRIGGER trigger_update_message_metrics
AFTER INSERT OR UPDATE ON messages
FOR EACH ROW
EXECUTE FUNCTION update_message_metrics();
```

### 3. **Função: Atualizar Estatísticas da Instância**

```sql
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
```

### 4. **Trigger: Atualizar Estatísticas da Instância**

```sql
CREATE TRIGGER trigger_update_instance_stats
AFTER INSERT OR UPDATE ON messages
FOR EACH ROW
EXECUTE FUNCTION update_instance_stats();
```

### 5. **Função: Detectar Queda de Instância**

```sql
CREATE OR REPLACE FUNCTION check_instance_health()
RETURNS void AS $$
DECLARE
  inst RECORD;
  last_activity INTERVAL;
BEGIN
  FOR inst IN SELECT id, name, last_activity_at FROM instances WHERE status = 'connected'
  LOOP
    -- Se não teve atividade nos últimos 5 minutos, considerar degradada
    last_activity := NOW() - COALESCE(inst.last_activity_at, NOW() - INTERVAL '10 minutes');
    
    IF last_activity > INTERVAL '5 minutes' THEN
      INSERT INTO instance_health_log (instance_id, status, check_type, error_message)
      VALUES (inst.id, 'degraded', 'automatic', 
        'Sem atividade há ' || EXTRACT(EPOCH FROM last_activity)::INTEGER || ' segundos');
      
      UPDATE instances
      SET health_status = 'degraded', health_checked_at = NOW()
      WHERE id = inst.id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

### 6. **Função: Processar Webhook de Mensagem**

```sql
CREATE OR REPLACE FUNCTION process_message_webhook(
  p_instance_id INTEGER,
  p_event_data JSONB
)
RETURNS INTEGER AS $$
DECLARE
  v_message_id INTEGER;
BEGIN
  -- Inserir ou atualizar mensagem
  INSERT INTO messages (
    instance_id,
    message_id,
    remote_jid,
    from_me,
    message_type,
    message_body,
    media_url,
    media_base64,
    timestamp,
    status
  )
  VALUES (
    p_instance_id,
    p_event_data->>'key'->>'id',
    p_event_data->>'key'->>'remoteJid',
    (p_event_data->>'key'->>'fromMe')::BOOLEAN,
    p_event_data->>'messageType',
    p_event_data->>'message'->>'conversation',
    p_event_data->>'mediaUrl',
    p_event_data->>'mediaBase64',
    TO_TIMESTAMP((p_event_data->>'messageTimestamp')::BIGINT),
    'sent'
  )
  ON CONFLICT (message_id) 
  DO UPDATE SET
    status = COALESCE(p_event_data->>'status', messages.status),
    updated_at = CURRENT_TIMESTAMP
  RETURNING id INTO v_message_id;
  
  RETURN v_message_id;
END;
$$ LANGUAGE plpgsql;
```

---

## 📊 Índices para Performance

```sql
-- Índices para messages
CREATE INDEX idx_messages_instance_id ON messages(instance_id);
CREATE INDEX idx_messages_remote_jid ON messages(remote_jid);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_from_me ON messages(from_me);
CREATE INDEX idx_messages_instance_status ON messages(instance_id, status);

-- Índices para message_metrics
CREATE INDEX idx_message_metrics_instance_date ON message_metrics(instance_id, metric_date);
CREATE INDEX idx_message_metrics_date ON message_metrics(metric_date);

-- Índices para instance_health_log
CREATE INDEX idx_health_log_instance ON instance_health_log(instance_id);
CREATE INDEX idx_health_log_checked_at ON instance_health_log(checked_at);

-- Índices para dispatches
CREATE INDEX idx_dispatches_status ON dispatches(status);
CREATE INDEX idx_dispatches_created_at ON dispatches(created_at);

-- Índices para dispatch_contacts
CREATE INDEX idx_dispatch_contacts_dispatch ON dispatch_contacts(dispatch_id);
CREATE INDEX idx_dispatch_contacts_status ON dispatch_contacts(status);
CREATE INDEX idx_dispatch_contacts_instance ON dispatch_contacts(instance_id);
```

---

## 🔄 Fluxo de Dados

### 1. **Webhook → Banco de Dados**
```
Webhook recebido → webhook_events (salvo)
                → Processa evento
                → messages (inserido/atualizado)
                → Triggers automáticos
                → message_metrics (atualizado)
                → instances (estatísticas atualizadas)
```

### 2. **Disparo → Controle**
```
Criar disparo → dispatches (criado)
            → dispatch_contacts (contatos adicionados)
            → Aplicar blindagens
            → Enviar mensagem
            → messages (registrado)
            → dispatch_contacts (status atualizado)
```

### 3. **Monitoramento → Alertas**
```
Health check → instance_health_log (registrado)
            → Se degradada/down → Alerta
            → Atualizar instances.health_status
```

---

## 🎯 Benefícios desta Estrutura

✅ **Automático**: Triggers atualizam métricas automaticamente  
✅ **Eficiente**: Índices otimizam consultas  
✅ **Completo**: Nada se perde, tudo é registrado  
✅ **Escalável**: Suporta milhões de mensagens  
✅ **Rastreável**: Histórico completo de tudo  
✅ **Métricas em Tempo Real**: Atualizações instantâneas  
✅ **Detecção de Problemas**: Identifica quedas automaticamente  

---

## 📈 Consultas Úteis

### Mensagens por Instância (últimas 24h)
```sql
SELECT 
  i.name,
  COUNT(*) as total,
  SUM(CASE WHEN m.from_me THEN 1 ELSE 0 END) as enviadas,
  SUM(CASE WHEN NOT m.from_me THEN 1 ELSE 0 END) as recebidas
FROM instances i
LEFT JOIN messages m ON m.instance_id = i.id 
  AND m.timestamp > NOW() - INTERVAL '24 hours'
GROUP BY i.id, i.name;
```

### Taxa de Entrega por Instância
```sql
SELECT 
  i.name,
  COUNT(*) FILTER (WHERE m.status = 'delivered') * 100.0 / 
    NULLIF(COUNT(*) FILTER (WHERE m.from_me = TRUE), 0) as taxa_entrega
FROM instances i
JOIN messages m ON m.instance_id = i.id
WHERE m.from_me = TRUE
GROUP BY i.id, i.name;
```

### Instâncias com Problemas
```sql
SELECT 
  i.name,
  i.health_status,
  i.last_activity_at,
  NOW() - i.last_activity_at as tempo_sem_atividade
FROM instances i
WHERE i.status = 'connected' 
  AND (i.health_status != 'healthy' 
    OR i.last_activity_at < NOW() - INTERVAL '5 minutes');
```

---

**Próximo passo**: Implementar esta estrutura no código!
