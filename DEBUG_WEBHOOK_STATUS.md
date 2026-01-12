# 🔍 Debug: Webhook não está atualizando status para "read"

## 🎯 Problema

O webhook está funcionando (retorna sucesso), mas quando você abre a mensagem no celular, o status não muda para "read".

## 🔧 Passos para Debug

### **1. Verificar se os Eventos Estão Chegando**

Acesse o endpoint de debug:

```bash
GET https://sua-api.com/api/webhook/evolution/debug/events?limit=20
```

Isso mostra os últimos eventos recebidos. Você deve ver:
- Eventos com `ack=1` (sent)
- Eventos com `ack=2` (delivered) 
- Eventos com `ack=3` (read) ⭐ **Este é o que falta!**

### **2. Verificar Message IDs no Banco**

```bash
GET https://sua-api.com/api/webhook/evolution/debug/message-ids?limit=10
```

Isso mostra os últimos `message_id` salvos no banco quando você enviou mensagens.

### **3. Comparar Message IDs**

O problema pode ser:
- O `message_id` que a Evolution API envia no webhook é **diferente** do `message_id` que foi salvo quando enviou
- O formato do evento pode estar diferente do esperado

### **4. Verificar Logs do Backend**

No EasyPanel, acesse os logs do container do backend e procure por:

```
🔔 Webhook recebido: event=message.ack
📦 Body completo recebido: {...}
📨 Processando message.ack: data={...}
🔍 Extraído: message_id=..., ack=...
```

**O que procurar:**
- Se `ack=3` está chegando quando você abre a mensagem
- Se o `message_id` do webhook corresponde ao `message_id` salvo no banco

## 🐛 Problemas Comuns

### **Problema 1: Evento "read" não está sendo enviado**

**Causa**: A Evolution API pode não estar configurada para enviar eventos de leitura, ou o WhatsApp não está reportando leituras.

**Solução**:
1. Verifique se o webhook está configurado para receber `message.ack`
2. Verifique se a instância está conectada corretamente
3. Alguns números podem não reportar leituras (especialmente números não salvos)

### **Problema 2: Message ID não corresponde**

**Causa**: O formato do `message_id` pode ser diferente.

**Solução**:
- Verifique os logs para ver o formato exato do `message_id` que está chegando
- Compare com o `message_id` salvo no banco
- O código agora tenta diferentes formatos automaticamente

### **Problema 3: Formato do evento diferente**

**Causa**: A Evolution API pode enviar eventos em formato diferente.

**Solução**:
- Veja o body completo nos logs: `📦 Body completo recebido`
- O código agora suporta múltiplos formatos

## 📊 Como Testar

### **Teste 1: Enviar Mensagem e Verificar**

1. Envie uma mensagem de teste
2. Verifique o `message_id` salvo:
   ```bash
   GET /api/webhook/evolution/debug/message-ids
   ```
3. Abra a mensagem no celular
4. Verifique se chegou evento `ack=3`:
   ```bash
   GET /api/webhook/evolution/debug/events
   ```
5. Verifique se o status mudou no banco:
   ```sql
   SELECT message_id, message_status, read_at 
   FROM devocional_envios 
   ORDER BY sent_at DESC 
   LIMIT 1;
   ```

### **Teste 2: Verificar Logs em Tempo Real**

No EasyPanel, monitore os logs enquanto:
1. Envia uma mensagem
2. Abre a mensagem no celular

Você deve ver:
```
✅ Mensagem message_id_123 enviada para 5516999999999
✅ Mensagem message_id_123 entregue para 5516999999999
✅✅ Mensagem message_id_123 LIDA por 5516999999999  ← Este é o importante!
```

## 🔍 Verificações Importantes

### **1. Verificar se o Webhook está Recebendo Eventos de Leitura**

No endpoint de debug, você deve ver eventos com `ack: 3` quando abre mensagens.

**Se não aparecer `ack: 3`:**
- O problema está na Evolution API não enviando eventos de leitura
- Pode ser configuração do webhook
- Pode ser que o número não reporta leituras (números não salvos)

### **2. Verificar se o Message ID Corresponde**

Compare:
- `message_id` salvo quando enviou (do banco)
- `message_id` recebido no webhook (dos eventos)

**Se forem diferentes:**
- Pode ser formato diferente
- Pode ser que a Evolution API use IDs diferentes

### **3. Verificar Configuração do Webhook na Evolution API**

Certifique-se de que:
- O webhook está configurado para `message.ack`
- O webhook está **ativado**
- A URL está correta e acessível

## 💡 Soluções

### **Solução 1: Verificar Configuração do Webhook**

Na Evolution API, verifique:
- Eventos selecionados: `message.ack` deve estar marcado
- Webhook está ativo (não desabilitado)
- URL está correta

### **Solução 2: Testar Manualmente**

Envie um evento de teste manualmente:

```bash
POST https://sua-api.com/api/webhook/evolution/message-status
Content-Type: application/json

{
  "event": "message.ack",
  "instance": "Devocional",
  "data": {
    "key": {
      "id": "MESSAGE_ID_DO_BANCO",
      "remoteJid": "5516999999999@s.whatsapp.net"
    },
    "ack": 3,
    "timestamp": 1234567890
  }
}
```

Substitua `MESSAGE_ID_DO_BANCO` por um `message_id` real do banco.

Se funcionar manualmente, o problema é que a Evolution API não está enviando o evento.

### **Solução 3: Verificar se o Número Reporta Leituras**

Alguns números não reportam leituras:
- Números não salvos no WhatsApp
- Números bloqueados
- Configurações de privacidade

**Teste**: Salve o número no WhatsApp e tente novamente.

## 📝 Próximos Passos

1. ✅ Acesse `/api/webhook/evolution/debug/events` para ver eventos recebidos
2. ✅ Acesse `/api/webhook/evolution/debug/message-ids` para ver message_ids salvos
3. ✅ Compare os message_ids
4. ✅ Verifique os logs do backend
5. ✅ Teste enviar evento manualmente

---

**Dica**: Os logs agora são muito mais detalhados. Procure por emojis nos logs:
- 🔔 = Webhook recebido
- 📦 = Body completo
- 📨 = Processando evento
- 🔍 = Dados extraídos
- ✅ = Status atualizado
- ⚠️ = Aviso/Problema
