# 🔗 Como Configurar Webhook na Evolution API - Guia Passo a Passo

## 🎯 O que é um Webhook?

Um **webhook** é como um "telefone" que a Evolution API usa para **avisar seu sistema** quando algo acontece com as mensagens:
- ✅ Mensagem foi **enviada** (sent)
- ✅ Mensagem foi **entregue** (delivered) 
- ✅ Mensagem foi **lida/visualizada** (read) ⭐ **Mais importante!**

## 📍 Onde Configurar?

Você precisa acessar o **painel da Evolution API** onde suas instâncias estão rodando.

**URL do seu Evolution API** (baseado na sua configuração):
```
https://imobmiq-evolution-api.90qhxz.easypanel.host
```

## 🚀 Passo a Passo Detalhado

### **Passo 1: Acessar o Painel da Evolution API**

1. Abra seu navegador
2. Acesse: `https://imobmiq-evolution-api.90qhxz.easypanel.host`
3. Faça login (se necessário)

### **Passo 2: Encontrar a Seção de Webhooks**

No painel da Evolution API, procure por uma das seguintes opções:

**Opção A - Menu Lateral:**
- Procure por **"Webhooks"** ou **"Webhook"** no menu
- Ou **"Settings"** → **"Webhooks"**
- Ou **"Configurações"** → **"Webhooks"**

**Opção B - Menu Superior:**
- Clique em **"Settings"** ou **"Configurações"**
- Depois em **"Webhooks"** ou **"Integrations"**

**Opção C - Página de Instância:**
- Clique em uma instância (ex: `Devocional`)
- Procure por **"Webhooks"** ou **"Events"**

### **Passo 3: Adicionar Novo Webhook**

1. Clique em **"Add Webhook"** ou **"Novo Webhook"** ou **"+"**
2. Você verá um formulário com campos para preencher

### **Passo 4: Preencher os Campos**

#### **Campo 1: URL do Webhook**

Cole a URL do seu sistema:

```
https://imobmiq-devocional.90qhxz.easypanel.host/api/webhook/evolution/message-status
```

**⚠️ IMPORTANTE**: 
- Substitua `imobmiq-devocional.90qhxz.easypanel.host` pela URL real do seu backend
- A URL deve ser **acessível publicamente** (HTTPS)
- Não use `localhost` ou `127.0.0.1`

#### **Campo 2: Eventos (Events)**

Selecione ou digite os eventos que você quer receber:

**Evento principal:**
```
MESSAGES_UPDATE
```

**⚠️ IMPORTANTE**: 
- O evento `MESSAGES_UPDATE` é o que envia o formato `MessageUpdate` com status `READ`, `DELIVERY_ACK`, `SERVER_ACK`
- Este é o evento que você precisa habilitar para rastrear visualizações!

**Outros eventos úteis (opcional):**
```
message.ack (formato antigo, ainda suportado)
qrcode.updated
connection.update
```

#### **Campo 3: Método HTTP**

Selecione: **POST**

#### **Campo 4: Headers (Opcional)**

Se você configurou `DEVOCIONAL_WEBHOOK_SECRET` no `.env`, adicione:

**Nome do Header:**
```
X-Webhook-Secret
```

**Valor do Header:**
```
Fs142779
```
(ou o valor que você configurou no `.env`)

### **Passo 5: Salvar**

1. Clique em **"Save"** ou **"Salvar"** ou **"Create"**
2. O webhook será criado e ativado automaticamente

### **Passo 6: Testar**

#### **Teste 1: Verificar se o Endpoint Está Funcionando**

No terminal ou Postman, teste:

```bash
curl https://imobmiq-devocional.90qhxz.easypanel.host/api/webhook/evolution/test
```

**Deve retornar:**
```json
{
  "success": true,
  "message": "Webhook da Evolution API está funcionando",
  "endpoint": "/webhook/evolution/message-status"
}
```

#### **Teste 2: Enviar uma Mensagem de Teste**

1. Envie uma mensagem de teste via seu sistema
2. Verifique os logs do backend
3. Você deve ver logs como:
   ```
   Webhook recebido: event=message.ack, instance=Devocional
   Mensagem message_id_123 lida por 5516999999999
   ```

## 🔍 Como Verificar se Está Funcionando

### **Método 1: Verificar Logs do Backend**

No EasyPanel, acesse os logs do container do backend e procure por:
```
Webhook recebido: event=message.ack
```

### **Método 2: Verificar no Banco de Dados**

Execute no banco:

```sql
SELECT 
    recipient_phone,
    message_status,
    delivered_at,
    read_at,
    sent_at
FROM devocional_envios
ORDER BY sent_at DESC
LIMIT 10;
```

Se o webhook estiver funcionando, você verá:
- `message_status` mudando de `pending` → `sent` → `delivered` → `read`
- `delivered_at` e `read_at` sendo preenchidos

### **Método 3: Verificar Estatísticas de Engajamento**

```bash
curl https://sua-api.com/api/engagement/stats
```

Se estiver funcionando, você verá `read_rate` e `engagement_score` sendo calculados.

## ⚠️ Problemas Comuns

### **Problema 1: Webhook não está recebendo eventos**

**Soluções:**
1. Verifique se a URL está correta e acessível
2. Verifique se o evento `message.ack` está selecionado
3. Verifique se o webhook está **ativado** (não desabilitado)
4. Teste a URL manualmente com Postman/curl

### **Problema 2: Erro 401 (Unauthorized)**

**Causa**: Header `X-Webhook-Secret` incorreto ou não configurado

**Solução**: 
- Verifique o valor no `.env`: `DEVOCIONAL_WEBHOOK_SECRET`
- Adicione o header no webhook da Evolution API
- Ou remova o header se não configurou o secret

### **Problema 3: Erro 404 (Not Found)**

**Causa**: URL do webhook incorreta

**Solução**:
- Verifique se a URL está completa: `/api/webhook/evolution/message-status`
- Verifique se o backend está rodando
- Teste a URL manualmente primeiro

### **Problema 4: Webhook recebe eventos mas não atualiza o banco**

**Causa**: `message_id` não está sendo encontrado

**Solução**:
- Verifique se o `message_id` está sendo salvo quando envia mensagens
- Verifique os logs para ver se há erros ao processar o webhook

## 📝 Exemplo de Configuração Visual

```
┌─────────────────────────────────────────┐
│  Evolution API - Webhook Settings       │
├─────────────────────────────────────────┤
│                                           │
│  URL:                                    │
│  ┌───────────────────────────────────┐  │
│  │ https://sua-api.com/api/webhook/  │  │
│  │ evolution/message-status          │  │
│  └───────────────────────────────────┘  │
│                                           │
│  Events:                                  │
│  ☑ message.ack                           │
│  ☐ qrcode.updated                         │
│  ☐ connection.update                     │
│                                           │
│  Method: POST                             │
│                                           │
│  Headers (Opcional):                      │
│  ┌─────────────┬─────────────────────┐  │
│  │ Name        │ Value                │  │
│  ├─────────────┼─────────────────────┤  │
│  │ X-Webhook-  │ Fs142779            │  │
│  │ Secret      │                      │  │
│  └─────────────┴─────────────────────┘  │
│                                           │
│  Status: ☑ Active                         │
│                                           │
│  [Save] [Cancel]                         │
└─────────────────────────────────────────┘
```

## 🎯 Resumo Rápido

1. ✅ Acesse o painel da Evolution API
2. ✅ Vá em **Webhooks** ou **Settings → Webhooks**
3. ✅ Clique em **Add Webhook** ou **+**
4. ✅ Cole a URL: `https://sua-api.com/api/webhook/evolution/message-status`
5. ✅ Selecione evento: `message.ack`
6. ✅ Método: **POST**
7. ✅ (Opcional) Adicione header: `X-Webhook-Secret: seu-secret`
8. ✅ Salve e teste!

## 🔗 URLs Importantes

**Seu Backend (substitua pelo seu domínio):**
```
https://imobmiq-devocional.90qhxz.easypanel.host
```

**Endpoint do Webhook:**
```
https://imobmiq-devocional.90qhxz.easypanel.host/api/webhook/evolution/message-status
```

**Teste do Webhook:**
```
https://imobmiq-devocional.90qhxz.easypanel.host/api/webhook/evolution/test
```

---

**💡 Dica**: Se não encontrar a opção de Webhooks no painel, pode ser que sua versão da Evolution API use uma interface diferente. Nesse caso, você pode configurar via API diretamente (veja seção abaixo).

## 🔧 Configuração via API (Alternativa)

Se não encontrar a interface de webhooks no painel, você pode configurar via API:

```bash
curl -X POST https://imobmiq-evolution-api.90qhxz.easypanel.host/webhook/create \
  -H "apikey: SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://imobmiq-devocional.90qhxz.easypanel.host/api/webhook/evolution/message-status",
    "events": ["message.ack"],
    "webhook_by_events": true
  }'
```

Substitua:
- `SUA_API_KEY`: Sua API Key do Manager da Evolution API
- A URL do webhook pela sua URL real

---

**Pronto!** Agora a Evolution API vai avisar seu sistema sempre que uma mensagem for enviada, entregue ou lida! 🎉
