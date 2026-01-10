# 🚀 Guia: Sistema Multi-Instância Evolution API

## 📋 Visão Geral

O sistema agora suporta **múltiplas instâncias Evolution API** para distribuir carga e evitar bloqueios. Você pode conectar até 4 (ou mais) números e o sistema distribui automaticamente os envios entre eles.

## ✨ Funcionalidades Implementadas

### 1. **Multi-Instância com Distribuição Automática**
- ✅ Rotação entre múltiplas instâncias
- ✅ Distribuição de carga equilibrada
- ✅ Health check automático
- ✅ Failover automático

### 2. **Nome de Exibição Personalizado**
- ✅ Configuração do nome que aparece no WhatsApp
- ✅ Atualização automática do perfil
- ✅ Cada instância pode ter seu próprio nome

### 3. **vCard (Salvar Contato)**
- ✅ Envio automático de vCard para novos contatos
- ✅ Mensagem pedindo para salvar o contato
- ✅ Facilita que o destinatário veja o nome ao invés do número

### 4. **Notificações para n8n**
- ✅ Webhook para receber comandos do n8n
- ✅ Envio de devocionais via n8n
- ✅ Verificação de status

## 🔧 Configuração

### 1. Configurar Múltiplas Instâncias

Edite o arquivo `.env` no diretório `backend/`:

```env
# Configuração Multi-Instância (JSON)
EVOLUTION_INSTANCES=[{"name":"Devocional-1","api_url":"http://localhost:8080","api_key":"sua_key_1","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-2","api_url":"http://localhost:8080","api_key":"sua_key_2","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-3","api_url":"http://localhost:8080","api_key":"sua_key_3","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-4","api_url":"http://localhost:8080","api_key":"sua_key_4","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true}]

# Nome padrão para exibição
EVOLUTION_DISPLAY_NAME=Devocional Diário

# Estratégia de distribuição
# Opções: "round_robin", "least_used", "priority", "random"
EVOLUTION_INSTANCE_STRATEGY=round_robin

# Enviar vCard para novos contatos
SEND_VCARD_TO_NEW_CONTACTS=false

# Enviar mensagem pedindo para salvar contato
SEND_CONTACT_REQUEST=false
```

### 2. Formato do JSON de Instâncias

Cada instância deve ter:

```json
{
  "name": "Devocional-1",              // Nome único da instância
  "api_url": "http://localhost:8080",  // URL da Evolution API
  "api_key": "sua_chave_api",          // API Key da instância
  "display_name": "Devocional Diário", // Nome que aparece no WhatsApp
  "max_messages_per_hour": 20,         // Limite por hora
  "max_messages_per_day": 200,         // Limite por dia
  "priority": 1,                        // Prioridade (1=alta, 2=média, 3=baixa)
  "enabled": true                       // Se está habilitada
}
```

### 3. Exemplo com 4 Instâncias

```json
[
  {
    "name": "Devocional-1",
    "api_url": "http://localhost:8080",
    "api_key": "key_instancia_1",
    "display_name": "Devocional Diário",
    "max_messages_per_hour": 20,
    "max_messages_per_day": 200,
    "priority": 1,
    "enabled": true
  },
  {
    "name": "Devocional-2",
    "api_url": "http://localhost:8080",
    "api_key": "key_instancia_2",
    "display_name": "Devocional Diário",
    "max_messages_per_hour": 20,
    "max_messages_per_day": 200,
    "priority": 1,
    "enabled": true
  },
  {
    "name": "Devocional-3",
    "api_url": "http://localhost:8080",
    "api_key": "key_instancia_3",
    "display_name": "Devocional Diário",
    "max_messages_per_hour": 20,
    "max_messages_per_day": 200,
    "priority": 1,
    "enabled": true
  },
  {
    "name": "Devocional-4",
    "api_url": "http://localhost:8080",
    "api_key": "key_instancia_4",
    "display_name": "Devocional Diário",
    "max_messages_per_hour": 20,
    "max_messages_per_day": 200,
    "priority": 1,
    "enabled": true
  }
]
```

## 🎯 Estratégias de Distribuição

### **round_robin** (Padrão)
- Rotação circular entre instâncias
- Distribuição equilibrada
- Recomendado para uso geral

### **least_used**
- Usa a instância com menos mensagens enviadas hoje
- Melhor para distribuição uniforme

### **priority**
- Usa instâncias por prioridade
- Útil se tiver instâncias principais e secundárias

### **random**
- Seleção aleatória
- Útil para testes

## 📱 Nome de Exibição no WhatsApp

### Como Funciona

1. **Nome no Perfil**: O sistema configura automaticamente o nome do perfil de cada instância
2. **Nome Salvo**: Se o destinatário salvar seu número, verá o nome que você configurou
3. **Número Não Salvo**: Se não salvar, verá apenas o número

### Soluções

#### **Opção 1: Enviar vCard Automaticamente**

Configure no `.env`:
```env
SEND_VCARD_TO_NEW_CONTACTS=true
```

O sistema enviará automaticamente um vCard (cartão de contato) para novos contatos, facilitando que salvem seu número.

#### **Opção 2: Mensagem Pedindo para Salvar**

Configure no `.env`:
```env
SEND_CONTACT_REQUEST=true
```

O sistema enviará uma mensagem pedindo para salvar o contato, seguida de um vCard.

#### **Opção 3: Manual via API**

Você pode enviar vCard manualmente via API:

```python
from app.vcard_service import VCardService
from app.instance_manager import EvolutionInstance

# Obter instância
instance = instance_manager.get_instance_by_name("Devocional-1")

# Enviar vCard
VCardService.send_vcard(
    instance=instance,
    recipient_phone="5516999999999",
    contact_name="Devocional Diário",
    contact_phone="5516999999999",
    organization="Devocional Diário"
)
```

## 🔔 Integração com n8n

### Endpoint de Notificações

**URL**: `POST /api/notifications/webhook`

**Headers**:
```
X-Webhook-Secret: seu_secret_aqui (se configurado)
Content-Type: application/json
```

### Eventos Disponíveis

#### 1. **Enviar Devocional**

```json
{
  "event": "send_devocional",
  "devocional_id": 123,
  "delay": 3.0
}
```

Ou com mensagem personalizada:

```json
{
  "event": "send_devocional",
  "message": "Texto do devocional aqui...",
  "delay": 3.0
}
```

#### 2. **Enviar Teste**

```json
{
  "event": "send_test",
  "phone": "5516999999999",
  "message": "Mensagem de teste"
}
```

#### 3. **Verificar Status**

```json
{
  "event": "check_status"
}
```

### Exemplo de Workflow n8n

1. **Trigger**: Cron (diário às 05:00)
2. **HTTP Request**: Buscar devocional
   ```
   GET https://sua-api.com/api/devocional/today
   ```
3. **OpenAI**: Gerar devocional (se necessário)
4. **HTTP Request**: Enviar via webhook
   ```
   POST https://sua-api.com/api/notifications/webhook
   Body: {
     "event": "send_devocional",
     "devocional_id": {{ $json.id }}
   }
   ```

## 📊 Monitoramento

### Verificar Status das Instâncias

**Endpoint**: `GET /api/notifications/instances`

**Resposta**:
```json
{
  "total_instances": 4,
  "active_instances": 4,
  "inactive_instances": 0,
  "error_instances": 0,
  "instances": [
    {
      "name": "Devocional-1",
      "display_name": "Devocional Diário",
      "status": "active",
      "messages_sent_today": 45,
      "messages_sent_this_hour": 8,
      "max_per_hour": 20,
      "max_per_day": 200,
      "error_count": 0,
      "enabled": true
    },
    ...
  ]
}
```

## 🔄 Como Funciona a Distribuição

### Exemplo: 4 Instâncias, 100 Contatos

1. **Contato 1-25**: Instância 1
2. **Contato 26-50**: Instância 2
3. **Contato 51-75**: Instância 3
4. **Contato 76-100**: Instância 4

Se uma instância atingir seu limite, o sistema automaticamente usa outra disponível.

## ⚠️ Importante

1. **Limites por Instância**: Cada instância tem seus próprios limites
2. **Health Check**: O sistema verifica automaticamente a saúde das instâncias
3. **Failover**: Se uma instância falhar, outra é usada automaticamente
4. **Rate Limiting**: Cada instância controla seus próprios limites

## 🚀 Próximos Passos

1. Configure as 4 instâncias no `.env`
2. Teste com `POST /api/notifications/webhook` (event: "send_test")
3. Verifique status com `GET /api/notifications/instances`
4. Configure n8n para usar o webhook
5. Ative vCard se quiser facilitar salvamento de contato

---

**Sistema Multi-Instância configurado e pronto para uso! 🎉**

