# 🔗 Sistema de Webhooks - Evolution API 2.3.7

## ✅ O que foi implementado

### 1. **Correções**
- ✅ **Desconectar**: Agora usa `/instance/logout/` ao invés de `/instance/delete/` (não deleta, apenas desconecta)
- ✅ **Número de telefone**: Busca melhorada com múltiplos caminhos para encontrar o número na Evolution API 2.3.7
- ✅ **Logs detalhados**: Para debug do número de telefone

### 2. **Sistema de Webhooks Completo**
- ✅ **Tabela `webhook_events`**: Armazena todos os eventos recebidos
- ✅ **Tabela `instance_webhook_config`**: Configurações de webhook por instância
- ✅ **Endpoint público**: `/api/webhooks/evolution/:instanceName` para receber webhooks
- ✅ **Configuração automática**: Webhook configurado automaticamente ao conectar instância
- ✅ **Processamento de eventos**: Eventos importantes são processados automaticamente

### 3. **Eventos Processados**
- ✅ `connection.update` / `connection` - Atualiza status da conexão
- ✅ `qrcode.update` / `qrcode` - Atualiza QR code
- ✅ `messages.upsert` / `message` - Mensagens recebidas
- ✅ `messages.update` - Status de mensagens (enviada, entregue, lida)
- ✅ Todos os outros eventos são salvos no banco para análise

### 4. **Rotas de Gerenciamento**
- ✅ `GET /api/webhooks/events` - Listar eventos (com filtros)
- ✅ `GET /api/webhooks/stats` - Estatísticas de eventos

## 📋 Configuração Necessária

### Variável de Ambiente no EasyPanel

No serviço **`devocional-backend`**, adicione:

```env
WEBHOOK_BASE_URL=https://seu-dominio-backend.com
# OU
BACKEND_URL=https://seu-dominio-backend.com
```

**Importante:** 
- Esta URL deve ser **pública** e acessível pela Evolution API
- Use HTTPS em produção
- Exemplo: `https://imobmiq-devocional-backend.90qhxz.easypanel.host`

## 🔧 Como Funciona

### 1. Ao Conectar Instância

Quando você conecta uma instância:
1. Instância é criada na Evolution API
2. Webhook é configurado automaticamente
3. URL do webhook: `{WEBHOOK_BASE_URL}/api/webhooks/evolution/{instance_name}`
4. Todos os eventos são habilitados

### 2. Recebimento de Webhooks

A Evolution API envia eventos para:
```
POST {WEBHOOK_BASE_URL}/api/webhooks/evolution/{instance_name}
```

O sistema:
1. Recebe o evento
2. Salva no banco (`webhook_events`)
3. Processa eventos importantes automaticamente
4. Atualiza status, QR code, número de telefone, etc.

### 3. Eventos Configurados

Os seguintes eventos são capturados:
- `APPLICATION_STARTUP` - Inicialização
- `QRCODE_UPDATED` - QR Code atualizado
- `MESSAGES_UPSERT` - Mensagens recebidas/criadas
- `MESSAGES_UPDATE` - Status de mensagens
- `MESSAGES_DELETE` - Mensagens deletadas
- `CONNECTION_UPDATE` - Status de conexão
- `CONTACTS_UPDATE` - Contatos atualizados
- `CHATS_UPDATE` - Chats atualizados
- `GROUPS_UPSERT` - Grupos criados
- E muitos outros...

## 📊 Estrutura do Banco de Dados

### Tabela: `webhook_events`
```sql
- id (SERIAL PRIMARY KEY)
- instance_id (INTEGER) - Referência à instância
- event_type (VARCHAR) - Tipo do evento
- event_data (JSONB) - Dados completos do evento
- received_at (TIMESTAMP) - Quando foi recebido
- processed (BOOLEAN) - Se foi processado
```

### Tabela: `instance_webhook_config`
```sql
- id (SERIAL PRIMARY KEY)
- instance_id (INTEGER UNIQUE) - Referência à instância
- webhook_url (VARCHAR) - URL configurada
- events (TEXT[]) - Array de eventos habilitados
- enabled (BOOLEAN) - Se está ativo
- created_at, updated_at (TIMESTAMP)
```

## 🔍 Consultar Eventos

### Listar Eventos
```bash
GET /api/webhooks/events?instance_id=1&event_type=connection.update&limit=50
```

### Estatísticas
```bash
GET /api/webhooks/stats?instance_id=1
```

## 🐛 Troubleshooting

### Webhook não está recebendo eventos

1. **Verifique a URL pública:**
   - A URL deve ser acessível publicamente
   - Teste: `curl https://sua-url.com/api/webhooks/evolution/test`

2. **Verifique variável de ambiente:**
   - `WEBHOOK_BASE_URL` deve estar configurada
   - Deve usar HTTPS em produção

3. **Verifique logs:**
   - Procure por "Configurando webhook" nos logs
   - Verifique se há erros na configuração

4. **Verifique Evolution API:**
   - Acesse a Evolution API e verifique se o webhook está configurado
   - Endpoint: `GET /webhook/find/{instance_name}`

### Número de telefone ainda não aparece

1. **Aguarde o webhook:**
   - O número pode vir via webhook `connection.update`
   - Verifique eventos: `GET /api/webhooks/events?event_type=connection.update`

2. **Verifique logs:**
   - Procure por "Número encontrado" ou "Número atualizado via webhook"

3. **Teste manualmente:**
   - Use o botão "Atualizar status" na interface
   - Isso força a busca do número

## 🚀 Próximos Passos

Após implementar, você pode:
1. Criar dashboards com os eventos
2. Processar mensagens recebidas automaticamente
3. Monitorar status de envios
4. Criar alertas baseados em eventos
5. Analisar padrões de uso

---

**Versão Evolution API:** 2.3.7 (evolution_exchange)  
**Data:** Janeiro 2025
