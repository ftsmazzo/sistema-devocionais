# 🚀 Arquitetura Completa de Disparos - Sistema Multi-Tipo

## 🎯 Visão Geral

Sistema unificado de disparos que suporta múltiplos tipos de mensagens (marketing, devocional, individual) com blindagem inteligente, tags de contatos, listas dinâmicas e rastreamento completo.

---

## 📊 Estrutura de Dados

### 1. **Tabela: `contacts`** (Nova)
Gerenciamento centralizado de contatos com tags e categorias.

```sql
CREATE TABLE contacts (
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
  source VARCHAR(100), -- 'manual', 'import', 'webhook', 'api'
  metadata JSONB, -- Dados adicionais flexíveis
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_message_sent_at TIMESTAMP,
  last_message_received_at TIMESTAMP,
  total_messages_sent INTEGER DEFAULT 0,
  total_messages_received INTEGER DEFAULT 0
);

-- Índices
CREATE INDEX idx_contacts_phone ON contacts(phone_number);
CREATE INDEX idx_contacts_opt_in ON contacts(opt_in);
CREATE INDEX idx_contacts_opt_out ON contacts(opt_out);
CREATE INDEX idx_contacts_whatsapp_validated ON contacts(whatsapp_validated);
```

### 2. **Tabela: `contact_tags`** (Nova)
Sistema de tags para categorizar contatos.

```sql
CREATE TABLE contact_tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  color VARCHAR(7), -- Hex color para UI
  description TEXT,
  category VARCHAR(50), -- 'marketing', 'devocional', 'vip', 'custom'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tags padrão serão criadas automaticamente:
-- 'devocional', 'marketing', 'vip', 'teste', 'bloqueado'
```

### 3. **Tabela: `contact_tag_relations`** (Nova)
Relação muitos-para-muitos entre contatos e tags.

```sql
CREATE TABLE contact_tag_relations (
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES contact_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (contact_id, tag_id)
);

CREATE INDEX idx_contact_tag_contact ON contact_tag_relations(contact_id);
CREATE INDEX idx_contact_tag_tag ON contact_tag_relations(tag_id);
```

### 4. **Tabela: `contact_lists`** (Nova)
Listas de contatos com filtros dinâmicos.

```sql
CREATE TABLE contact_lists (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  list_type VARCHAR(50) NOT NULL, -- 'static', 'dynamic', 'hybrid'
  filter_config JSONB, -- Configuração de filtros para listas dinâmicas
  total_contacts INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- filter_config exemplo:
-- {
--   "tags": [1, 2, 3],
--   "exclude_tags": [4],
--   "opt_in": true,
--   "whatsapp_validated": true,
--   "last_message_sent_before": "2024-01-01",
--   "last_message_sent_after": "2024-12-01"
-- }
```

### 5. **Tabela: `contact_list_items`** (Nova)
Itens de listas estáticas (para listas híbridas ou estáticas).

```sql
CREATE TABLE contact_list_items (
  id SERIAL PRIMARY KEY,
  list_id INTEGER REFERENCES contact_lists(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(list_id, contact_id)
);

CREATE INDEX idx_list_items_list ON contact_list_items(list_id);
CREATE INDEX idx_list_items_contact ON contact_list_items(contact_id);
```

### 6. **Tabela: `devocionais`** (Nova - Específica para Devocionais)
Armazena devocionais gerados pelo N8N.

```sql
CREATE TABLE devocionais (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  title VARCHAR(255) NOT NULL,
  date DATE UNIQUE NOT NULL,
  versiculo_principal JSONB,
  versiculo_apoio JSONB,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_devocionais_date ON devocionais(date);
CREATE INDEX idx_devocionais_created_at ON devocionais(created_at);
```

### 7. **Refatorar: `dispatches`**
Adicionar campos para suportar múltiplos tipos.

```sql
ALTER TABLE dispatches
ADD COLUMN IF NOT EXISTS dispatch_type VARCHAR(50) NOT NULL DEFAULT 'marketing',
  -- 'marketing', 'devocional', 'individual', 'campaign'
ADD COLUMN IF NOT EXISTS list_id INTEGER REFERENCES contact_lists(id),
ADD COLUMN IF NOT EXISTS contact_ids INTEGER[], -- Para disparos individuais
ADD COLUMN IF NOT EXISTS devocional_id INTEGER REFERENCES devocionais(id), -- Para disparos de devocional
ADD COLUMN IF NOT EXISTS template_id INTEGER, -- Referência a templates (futuro)
ADD COLUMN IF NOT EXISTS blindage_config JSONB, -- Configuração específica de blindagem
ADD COLUMN IF NOT EXISTS schedule_config JSONB, -- Agendamento (futuro)
ADD COLUMN IF NOT EXISTS metadata JSONB; -- Dados adicionais por tipo

-- Exemplos de blindage_config:
-- {
--   "override_delay": 5, -- Override do delay padrão
--   "override_limits": {"max_per_hour": 100}, -- Override de limites
--   "priority": "high", -- Prioridade do disparo
--   "skip_health_check": false
-- }

-- Exemplos de metadata por tipo:
-- Marketing: {"campaign_name": "Black Friday", "utm_source": "whatsapp"}
-- Devocional: {"date": "2024-01-15", "versiculo": "João 3:16"}
-- Individual: {"reason": "follow_up", "related_dispatch_id": 123}
```

### 8. **Refatorar: `messages`**
Adicionar campos para rastreamento por tipo.

```sql
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS dispatch_id INTEGER REFERENCES dispatches(id),
ADD COLUMN IF NOT EXISTS dispatch_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS contact_id INTEGER REFERENCES contacts(id),
ADD COLUMN IF NOT EXISTS devocional_id INTEGER REFERENCES devocionais(id), -- Para mensagens de devocional
ADD COLUMN IF NOT EXISTS message_category VARCHAR(50), -- 'marketing', 'devocional', 'individual', 'system'
ADD COLUMN IF NOT EXISTS tags TEXT[]; -- Tags aplicadas no momento do envio

CREATE INDEX idx_messages_dispatch ON messages(dispatch_id);
CREATE INDEX idx_messages_dispatch_type ON messages(dispatch_type);
CREATE INDEX idx_messages_contact ON messages(contact_id);
CREATE INDEX idx_messages_devocional ON messages(devocional_id);
CREATE INDEX idx_messages_category ON messages(message_category);
```

---

## 🏗️ Arquitetura de Tipos de Disparos

### 1. **Disparo de Marketing**
- **Objetivo**: Campanhas promocionais, ofertas, anúncios
- **Características**:
  - Listas grandes (milhares de contatos)
  - Blindagem mais rigorosa (delays maiores)
  - Horários comerciais (8h-20h)
  - Tags: `marketing`, `promocao`, etc.
  - Métricas: taxa de abertura, conversão

### 2. **Disparo de Devocional**
- **Objetivo**: Envio diário automático de devocionais
- **Características**:
  - Lista específica de devocionais
  - Horário fixo (3h30 via N8N)
  - Blindagem padrão
  - Tags: `devocional`, `diario`
  - Personalização: nome do contato
  - Métricas: engajamento, leitura

### 3. **Disparo Individual**
- **Objetivo**: Mensagens pontuais para contatos específicos
- **Características**:
  - 1 ou poucos contatos
  - Blindagem mínima (prioridade alta)
  - Sem lista (contatos diretos)
  - Tags: `individual`, `follow_up`
  - Métricas: resposta, tempo de resposta

### 4. **Disparo de Campanha** (Futuro)
- **Objetivo**: Campanhas complexas com múltiplas etapas
- **Características**:
  - Sequência de mensagens
  - Condições e gatilhos
  - Automação avançada

---

## 🔄 Fluxo de Disparos

### Fluxo Unificado (Todos os Tipos)

```
1. Criação do Disparo
   ↓
2. Seleção de Contatos
   ├─ Lista estática → contact_list_items
   ├─ Lista dinâmica → Query com filtros
   └─ Individual → contact_ids diretos
   ↓
3. Aplicação de Blindagem
   ├─ Verifica regras globais
   ├─ Aplica overrides do disparo
   ├─ Seleciona instância (rotação)
   └─ Calcula delay
   ↓
4. Processamento (Loop)
   ├─ Para cada contato:
   │  ├─ Valida contato (opt-in, WhatsApp)
   │  ├─ Personaliza mensagem (se necessário)
   │  ├─ Aplica blindagem
   │  ├─ Envia mensagem
   │  ├─ Registra em messages
   │  ├─ Atualiza dispatch_contacts
   │  └─ Atualiza contact (last_message_sent_at)
   │  ↓
   └─ Atualiza métricas do disparo
   ↓
5. Finalização
   ├─ Atualiza status do disparo
   ├─ Gera relatório
   └─ Notifica (se configurado)
```

---

## 🛡️ Blindagem por Tipo

### Configuração Base (Global)
- Delay mínimo: 3s
- Limite diário: 500
- Limite horário: 50
- Horários: 8h-20h

### Overrides por Tipo

#### Marketing
```json
{
  "delay_multiplier": 1.5, // 4.5s mínimo
  "max_per_hour": 30, // Mais conservador
  "max_per_day": 300,
  "priority": "normal"
}
```

#### Devocional
```json
{
  "delay_multiplier": 1.0, // Delay padrão
  "max_per_hour": 50,
  "max_per_day": 500,
  "priority": "normal",
  "allowed_hours": [3, 4, 5, 6, 7, 8] // Horário específico
}
```

#### Individual
```json
{
  "delay_multiplier": 0.5, // Delay reduzido (1.5s)
  "skip_limits": true, // Ignora limites
  "priority": "high",
  "skip_health_check": false
}
```

---

## 📋 Sistema de Listas

### Tipos de Listas

#### 1. **Lista Estática**
- Contatos adicionados manualmente
- Não muda automaticamente
- Uso: Listas específicas, VIPs

#### 2. **Lista Dinâmica**
- Baseada em filtros (tags, opt-in, etc.)
- Atualiza automaticamente
- Uso: "Todos com tag marketing", "Opt-in ativo"

#### 3. **Lista Híbrida**
- Combina estática + dinâmica
- Uso: "VIPs + Marketing opt-in"

### Filtros Disponíveis

```typescript
interface ListFilter {
  // Tags
  tags?: number[]; // IDs de tags (AND)
  exclude_tags?: number[]; // Tags a excluir
  
  // Status
  opt_in?: boolean;
  opt_out?: boolean;
  whatsapp_validated?: boolean;
  
  // Datas
  last_message_sent_before?: string; // ISO date
  last_message_sent_after?: string;
  created_after?: string;
  created_before?: string;
  
  // Limites
  max_contacts?: number; // Limite de contatos
  random_sample?: boolean; // Amostra aleatória
}
```

---

## 🏷️ Sistema de Tags

### Tags Padrão (Criadas Automaticamente)

1. **`devocional`** - Contatos que recebem devocionais
2. **`marketing`** - Contatos para campanhas de marketing
3. **`vip`** - Contatos VIP (prioridade)
4. **`teste`** - Contatos para testes
5. **`bloqueado`** - Contatos bloqueados/opt-out

### Uso de Tags

- **Categorização**: Organizar contatos por interesse
- **Filtros**: Criar listas dinâmicas
- **Blindagem**: Regras específicas por tag
- **Métricas**: Análise por segmento
- **Automação**: Ações baseadas em tags

---

## 📊 Estrutura de Rotas (Backend)

### Contatos
```
GET    /api/contacts              - Listar contatos (com filtros)
POST   /api/contacts              - Criar contato
GET    /api/contacts/:id           - Detalhes do contato
PUT    /api/contacts/:id           - Atualizar contato
DELETE /api/contacts/:id           - Deletar contato
POST   /api/contacts/import        - Importar CSV/Excel
GET    /api/contacts/:id/tags      - Tags do contato
POST   /api/contacts/:id/tags      - Adicionar tag
DELETE /api/contacts/:id/tags/:tagId - Remover tag
```

### Tags
```
GET    /api/tags                   - Listar tags
POST   /api/tags                   - Criar tag
PUT    /api/tags/:id               - Atualizar tag
DELETE /api/tags/:id               - Deletar tag
```

### Listas
```
GET    /api/lists                  - Listar listas
POST   /api/lists                  - Criar lista
GET    /api/lists/:id              - Detalhes da lista
PUT    /api/lists/:id              - Atualizar lista
DELETE /api/lists/:id             - Deletar lista
GET    /api/lists/:id/contacts     - Contatos da lista (com paginação)
POST   /api/lists/:id/contacts     - Adicionar contato à lista
DELETE /api/lists/:id/contacts/:contactId - Remover contato
POST   /api/lists/:id/refresh      - Atualizar lista dinâmica
GET    /api/lists/:id/preview      - Preview de contatos (sem salvar)
```

### Disparos
```
GET    /api/dispatches             - Listar disparos
POST   /api/dispatches             - Criar disparo
GET    /api/dispatches/:id         - Detalhes do disparo
PUT    /api/dispatches/:id         - Atualizar disparo
DELETE /api/dispatches/:id         - Deletar disparo
POST   /api/dispatches/:id/start   - Iniciar disparo
POST   /api/dispatches/:id/pause   - Pausar disparo
POST   /api/dispatches/:id/resume  - Retomar disparo
POST   /api/dispatches/:id/stop    - Parar disparo
GET    /api/dispatches/:id/stats   - Estatísticas do disparo
GET    /api/dispatches/:id/contacts - Contatos do disparo
```

### Tipos Específicos

#### Marketing
```
POST   /api/dispatches/marketing   - Criar disparo de marketing
```

#### Devocional
```
POST   /api/dispatches/devocional - Criar disparo de devocional
POST   /api/devocional/webhook     - Webhook do N8N (recebe devocional gerado)
GET    /api/devocional/context/para-ia?days=30 - Contexto histórico para IA
GET    /api/devocional              - Listar devocionais
GET    /api/devocional/:id          - Buscar devocional por ID
GET    /api/devocional/date/:date  - Buscar devocional por data (YYYY-MM-DD)
```

#### Individual
```
POST   /api/dispatches/individual  - Criar disparo individual
POST   /api/messages/send          - Envio direto (já existe, melhorar)
```

---

## 🎨 Interface (Frontend)

### Páginas Principais

1. **Contatos** (`/contacts`)
   - Lista de contatos com filtros
   - Adicionar/editar contatos
   - Gerenciar tags
   - Importar CSV/Excel
   - Visualizar histórico

2. **Tags** (`/tags`)
   - Gerenciar tags
   - Cores e categorias
   - Estatísticas por tag

3. **Listas** (`/lists`)
   - Listar listas
   - Criar lista (estática/dinâmica/híbrida)
   - Configurar filtros
   - Preview de contatos
   - Gerenciar contatos da lista

4. **Disparos** (`/dispatches`)
   - Lista de disparos
   - Criar disparo por tipo
   - Monitorar em tempo real
   - Estatísticas e relatórios

5. **Dashboard** (`/dashboard`)
   - Métricas gerais
   - Gráficos por tipo
   - Performance de instâncias
   - Alertas

---

## 🔧 Implementação - Fases

### Fase 1: Base de Dados e Estrutura
- [ ] Criar tabelas: `contacts`, `contact_tags`, `contact_tag_relations`
- [ ] Criar tabelas: `contact_lists`, `contact_list_items`
- [ ] Refatorar `dispatches` e `messages`
- [ ] Criar tags padrão
- [ ] Migrações de dados existentes

### Fase 2: Backend - Contatos e Tags
- [ ] Rotas de contatos (CRUD)
- [ ] Rotas de tags (CRUD)
- [ ] Sistema de importação (CSV/Excel)
- [ ] Validação de WhatsApp
- [ ] Opt-in/Opt-out

### Fase 3: Backend - Listas
- [ ] Rotas de listas (CRUD)
- [ ] Sistema de filtros dinâmicos
- [ ] Preview de listas
- [ ] Refresh de listas dinâmicas
- [ ] Gerenciamento de itens

### Fase 4: Backend - Disparos Refatorados
- [ ] Refatorar sistema de disparos
- [ ] Suporte a múltiplos tipos
- [ ] Integração com listas
- [ ] Blindagem por tipo
- [ ] Controle de pausa/retomada

### Fase 5: Frontend - Contatos e Tags
- [ ] Página de contatos
- [ ] Página de tags
- [ ] Importação de CSV/Excel
- [ ] Gerenciamento de tags por contato

### Fase 6: Frontend - Listas
- [ ] Página de listas
- [ ] Criador de listas (estática/dinâmica)
- [ ] Configurador de filtros
- [ ] Preview de contatos

### Fase 7: Frontend - Disparos
- [ ] Refatorar página de disparos
- [ ] Criador por tipo
- [ ] Monitoramento em tempo real
- [ ] Estatísticas e relatórios

### Fase 8: Dashboard e Métricas
- [ ] Dashboard geral
- [ ] Gráficos por tipo
- [ ] Métricas de contatos
- [ ] Performance de listas

---

## 📝 Exemplos de Uso

### Exemplo 1: Disparo de Marketing

```typescript
// 1. Criar lista dinâmica
POST /api/lists
{
  "name": "Marketing - Opt-in Ativo",
  "list_type": "dynamic",
  "filter_config": {
    "tags": [2], // tag "marketing"
    "opt_in": true,
    "whatsapp_validated": true,
    "exclude_tags": [5] // tag "bloqueado"
  }
}

// 2. Criar disparo
POST /api/dispatches/marketing
{
  "name": "Black Friday 2024",
  "list_id": 1,
  "message_template": "🎉 Black Friday! Desconto de 50%...",
  "blindage_config": {
    "delay_multiplier": 1.5,
    "max_per_hour": 30
  }
}

// 3. Iniciar disparo
POST /api/dispatches/1/start
```

### Exemplo 2: Disparo de Devocional

```typescript
// 1. Criar disparo (automático via N8N)
POST /api/dispatches/devocional
{
  "name": "Devocional 2024-01-15",
  "list_id": 2, // Lista "Devocionais Diários"
  "message_template": "Bom dia, *{{name}}*!\n\n📅 Segunda-feira, 15/01/2024\n\n🌟 *Título*...",
  "dispatch_type": "devocional",
  "metadata": {
    "date": "2024-01-15",
    "versiculo": "João 3:16"
  }
}

// 2. Sistema inicia automaticamente
```

### Exemplo 3: Disparo Individual

```typescript
// Enviar para contatos específicos
POST /api/dispatches/individual
{
  "name": "Follow-up Cliente XYZ",
  "contact_ids": [123, 456],
  "message_template": "Olá *{{name}}*, como está?",
  "blindage_config": {
    "delay_multiplier": 0.5,
    "skip_limits": true,
    "priority": "high"
  }
}
```

---

## 🎯 Vantagens da Arquitetura

✅ **Unificado**: Um sistema para todos os tipos  
✅ **Flexível**: Tags e listas dinâmicas  
✅ **Escalável**: Suporta milhões de contatos  
✅ **Rastreável**: Histórico completo  
✅ **Inteligente**: Blindagem adaptativa  
✅ **Organizado**: Tags e categorias  
✅ **Eficiente**: Listas dinâmicas (sem duplicação)  

---

## 📊 Métricas e Relatórios

### Por Tipo de Disparo
- Total enviado
- Taxa de entrega
- Taxa de leitura
- Taxa de resposta
- Tempo médio de entrega

### Por Lista
- Total de contatos
- Taxa de engajamento
- Crescimento da lista
- Churn (opt-out)

### Por Tag
- Distribuição de contatos
- Performance por tag
- Engajamento por segmento

### Por Contato
- Histórico de mensagens
- Tags aplicadas
- Última interação
- Status (opt-in/out)

---

**Status**: Plano completo - Pronto para implementação faseada
