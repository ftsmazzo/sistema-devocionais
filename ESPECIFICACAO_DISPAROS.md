# 📋 Especificação Técnica - Sistema de Disparos

## 🎯 Visão Geral

Sistema completo de disparos com dois tipos principais:
1. **Devocional**: Automático, diário, com sistema de pontuação
2. **Marketing**: Manual, com IA para responder interações

---

## 📅 Disparo de Devocional

### Configurações (Página de Configuração)

- **Horário de disparo**: 06:00 (America/São_Paulo)
- **Lista**: Dinâmica com filtros:
  - Tag: `devocional`
  - `whatsapp_validated = TRUE`
  - `opt_in = TRUE`
- **Template**: Formatado do banco (já gravado pelo N8N)
- **Personalização**: 
  - Saudação baseada em horário (Bom dia/Tarde/Noite)
  - Primeiro nome do contato
  - Template completo do devocional

### Sistema de Pontuação

**Regras:**
- Contato recebe devocional → `devocional_score` não muda
- Contato não recebe (falha) → `devocional_score - 1`
- Contato lê (webhook de leitura) → `devocional_score + 1`
- Contato interage (responde) → `devocional_score + 2`

**Bloqueio automático:**
- Se `devocional_score <= -3` após 3 devocionais consecutivos → Tag `bloqueado`
- Remove da lista de devocionais automaticamente

**Campos no banco:**
```sql
ALTER TABLE contacts ADD COLUMN devocional_score INTEGER DEFAULT 0;
ALTER TABLE contacts ADD COLUMN last_devocional_sent_at TIMESTAMP;
ALTER TABLE contacts ADD COLUMN last_devocional_read_at TIMESTAMP;
ALTER TABLE contacts ADD COLUMN last_devocional_interaction_at TIMESTAMP;
ALTER TABLE contacts ADD COLUMN consecutive_devocional_failures INTEGER DEFAULT 0;
```

### Agendamento

- **N8N**: Cria devocional às 3:30 (America/São_Paulo)
- **Backend Cron**: Dispara às 6:00 (America/São_Paulo)
- **Fuso horário**: Sempre usar `America/São_Paulo` (UTC-3)

### Formato da Mensagem

```
Bom dia [Primeiro Nome]

[Template completo do devocional do banco]
```

**Saudação baseada em horário:**
- 05:00 - 11:59 → "Bom dia"
- 12:00 - 17:59 → "Boa tarde"
- 18:00 - 04:59 → "Boa noite"

---

## 📢 Disparo de Marketing

### Características

- **Conteúdo**: Texto + Imagem + PDF
- **Blindagem**: Sempre ativa
- **Validação WhatsApp**: Sempre verifica
- **Lista**: Qualquer lista (estática/dinâmica/híbrida)

### Detecção de Resposta Positiva

**Palavras-chave:**
- `["interesse", "quero", "me chama", "gostei", "tenho interesse", "quero saber mais", "me passa", "informação", "detalhes", "contato", "ligar", "ligue"]`

**Análise de sentimento:**
- Usar OpenAI para análise rápida
- Se positivo + palavras-chave → Ativar IA

### Integração com IA Externa

**Quando detectar intenção:**
1. Enviar para IA externa:
   ```json
   {
     "dispatch_id": 123,
     "dispatch_name": "Campanha Imóveis",
     "contact_name": "João Silva",
     "contact_phone": "5516999999999",
     "user_message": "Tenho interesse nesse imóvel",
     "dispatch_content": "[texto do disparo]"
   }
   ```
2. IA externa recebe e inicia conversa
3. Sistema registra interação

**Endpoint da IA Externa:**
- Configurável via painel
- Padrão: Variável de ambiente `EXTERNAL_AI_WEBHOOK_URL`

---

## 🔔 Sistema de Notificações

### Configuração

- **Página de Configuração**: Telefone para notificar
- **Eventos**:
  - Disparo iniciado
  - Disparo concluído
  - Disparo com erros
  - Bloqueio automático de contato

### Formato

- WhatsApp (via Evolution API)
- Mensagem simples: "Disparo [nome] [status]"

---

## 🗄️ Estrutura de Banco

### Tabela: `devocional_config`

```sql
CREATE TABLE devocional_config (
  id SERIAL PRIMARY KEY,
  list_id INTEGER REFERENCES contact_lists(id),
  dispatch_hour INTEGER DEFAULT 6,
  dispatch_minute INTEGER DEFAULT 0,
  timezone VARCHAR(50) DEFAULT 'America/Sao_Paulo',
  notification_phone VARCHAR(20),
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: `marketing_ai_config`

```sql
CREATE TABLE marketing_ai_config (
  id SERIAL PRIMARY KEY,
  ai_webhook_url TEXT,
  positive_keywords TEXT[],
  sentiment_analysis_enabled BOOLEAN DEFAULT TRUE,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Atualizar `contacts`

```sql
ALTER TABLE contacts 
ADD COLUMN IF NOT EXISTS devocional_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_devocional_sent_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS last_devocional_read_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS last_devocional_interaction_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS consecutive_devocional_failures INTEGER DEFAULT 0;
```

---

## 🔄 Fluxos

### Fluxo: Disparo de Devocional

```
1. Cron job às 6:00 (America/São_Paulo)
   ↓
2. Buscar devocional do dia (por data)
   ↓
3. Buscar lista configurada (tag devocional + WhatsApp validado)
   ↓
4. Para cada contato:
   ├─ Verificar pontuação (se <= -3, pular)
   ├─ Personalizar mensagem (saudação + nome + template)
   ├─ Aplicar blindagem
   ├─ Enviar via Evolution API
   ├─ Atualizar pontuação
   └─ Registrar em dispatch_contacts
   ↓
5. Atualizar estatísticas
   ↓
6. Enviar notificação (se configurado)
```

### Fluxo: Detecção de Resposta (Marketing)

```
1. Webhook recebe mensagem
   ↓
2. Verificar se é resposta a disparo de marketing
   ↓
3. Analisar mensagem:
   ├─ Verificar palavras-chave
   ├─ Análise de sentimento (OpenAI)
   └─ Se positivo → Ativar IA
   ↓
4. Enviar para IA externa:
   ├─ dispatch_id
   ├─ contact_name
   ├─ contact_phone
   ├─ user_message
   └─ dispatch_content
   ↓
5. IA externa inicia conversa
   ↓
6. Registrar interação no banco
```

---

## 🛠️ Implementação

### Backend

1. **Rotas de Configuração**
   - `GET /api/devocional/config` - Buscar configuração
   - `PUT /api/devocional/config` - Atualizar configuração
   - `GET /api/marketing/ai-config` - Buscar config IA
   - `PUT /api/marketing/ai-config` - Atualizar config IA

2. **Rotas de Disparo**
   - `POST /api/dispatches/devocional` - Criar disparo manual (teste)
   - `POST /api/dispatches/marketing` - Criar disparo marketing
   - `GET /api/dispatches` - Listar disparos
   - `GET /api/dispatches/:id` - Detalhes do disparo

3. **Cron Job**
   - Usar `node-cron` ou similar
   - Agendar às 6:00 (America/São_Paulo)
   - Executar disparo de devocional

4. **Webhook Handler**
   - Melhorar `webhooks.ts` para processar mensagens recebidas
   - Detectar respostas a disparos
   - Chamar detecção de intenção

5. **Serviços**
   - `devocionalService.ts` - Lógica de disparo devocional
   - `marketingService.ts` - Lógica de disparo marketing
   - `scoringService.ts` - Sistema de pontuação
   - `personalizationService.ts` - Personalização de mensagens
   - `aiDetectionService.ts` - Detecção de intenção

### Frontend

1. **Página de Configuração do Devocional** (`/devocional/config`)
   - Selecionar lista
   - Configurar horário
   - Configurar telefone de notificação
   - Visualizar template atual

2. **Página de Disparos** (`/dispatches`)
   - Listar disparos
   - Criar disparo marketing
   - Visualizar estatísticas

3. **Página de Configuração de IA** (`/marketing/ai-config`)
   - Configurar webhook da IA
   - Configurar palavras-chave
   - Habilitar/desabilitar análise de sentimento

---

## 📝 Próximos Passos

1. ✅ Criar estrutura de banco
2. ✅ Criar rotas de configuração
3. ✅ Implementar sistema de pontuação
4. ✅ Criar cron job para devocional
5. ✅ Implementar personalização
6. ✅ Criar detecção de intenção
7. ✅ Integrar com IA externa
8. ✅ Criar páginas frontend
9. ✅ Sistema de notificações
