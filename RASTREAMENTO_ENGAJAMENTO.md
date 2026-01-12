# 📊 Sistema de Rastreamento de Engajamento

## 🎯 Visão Geral

O sistema agora rastreia **visualizações** (não apenas respostas) para calcular o engajamento real dos contatos. Isso é fundamental para evitar banimentos, pois o WhatsApp monitora se as mensagens estão sendo lidas.

## 🔍 Como Funciona

### Status de Mensagens

O sistema rastreia 3 status principais:

1. **Sent** (Enviado) - Mensagem foi enviada com sucesso
2. **Delivered** (Entregue) - Mensagem chegou ao dispositivo do destinatário
3. **Read** (Lida/Visualizada) - Destinatário abriu e leu a mensagem ⭐ **Mais importante**

### Cálculo de Engajamento

O **score de engajamento** é calculado baseado em:

- **Taxa de Visualização**: % de mensagens que foram lidas
- **Histórico Recente**: Mensagens dos últimos 30 dias (configurável)
- **Tendência**: Mensagens consecutivas não lidas reduzem o score

**Fórmula**:
```
Score = Taxa de Leitura (0.0 a 1.0)
Score = Total de Lidas / Total de Enviadas
```

## ⚙️ Configuração

### 1. Executar Migração SQL

Primeiro, execute a migração para adicionar os campos de status:

```bash
psql -U seu_usuario -d seu_banco -f database/migrate_add_message_status.sql
```

Ou via EasyPanel:
1. Acesse o terminal do banco de dados
2. Execute o conteúdo de `database/migrate_add_message_status.sql`

### 2. Configurar Webhook na Evolution API

A Evolution API precisa enviar eventos de status para o sistema.

**Endpoint do Webhook**:
```
POST https://sua-api.com/api/webhook/evolution/message-status
```

**Headers** (opcional, se configurado):
```
X-Webhook-Secret: seu-secret-aqui
```

**Configuração na Evolution API**:

1. Acesse o painel da Evolution API
2. Vá em **Webhooks** ou **Settings**
3. Configure o webhook para eventos `message.ack`:
   ```
   URL: https://sua-api.com/api/webhook/evolution/message-status
   Events: message.ack
   ```

**Formato do Evento** (enviado pela Evolution API):

**Formato 1 - MessageUpdate (mais comum):**
```json
{
  "MessageUpdate": [
    {"status": "SERVER_ACK"},    // sent
    {"status": "DELIVERY_ACK"},  // delivered
    {"status": "READ"}           // read ⭐
  ],
  "id": "cmkb3zxuo1b57je5pm1707e8u",
  "messageTimestamp": 1768219669,
  "instanceId": "5f31e754-309b-4795-98f3-1c7df55eb765"
}
```

**Formato 2 - message.ack (formato antigo):**
```json
{
  "event": "message.ack",
  "instance": "nome-instancia",
  "data": {
    "key": {
      "id": "message_id_123",
      "remoteJid": "5516999999999@s.whatsapp.net"
    },
    "ack": 3,  // 1=sent, 2=delivered, 3=read
    "timestamp": 1234567890
  }
}
```

**⚠️ IMPORTANTE**: O sistema agora suporta **ambos os formatos** automaticamente!

### 3. Verificar se Está Funcionando

Teste o endpoint:
```bash
curl https://sua-api.com/api/webhook/evolution/test
```

Deve retornar:
```json
{
  "success": true,
  "message": "Webhook da Evolution API está funcionando",
  "endpoint": "/webhook/evolution/message-status"
}
```

## 📊 Visualizar Estatísticas

### Listar Todos os Contatos

```bash
GET /api/engagement/stats?days=30&min_score=0.3
```

**Parâmetros**:
- `days`: Período em dias (padrão: 30)
- `min_score`: Filtrar apenas contatos com score >= X (opcional)

**Resposta**:
```json
[
  {
    "phone": "5516999999999",
    "name": "João",
    "total_sent": 30,
    "total_delivered": 28,
    "total_read": 25,
    "delivery_rate": 93.33,
    "read_rate": 83.33,
    "engagement_score": 0.833,
    "last_sent": "2024-01-15T06:00:00",
    "last_read": "2024-01-15T06:05:00",
    "consecutive_not_read": 0
  }
]
```

### Estatísticas de um Contato Específico

```bash
GET /api/engagement/stats/5516999999999?days=30
```

## 🛡️ Como o ShieldService Usa o Engajamento

### Antes (Problema)

- Score baseado apenas em **respostas**
- Devocionais não esperam resposta
- Score diminuía mesmo quando mensagens eram visualizadas

### Agora (Solução)

- Score baseado em **visualizações** (read)
- Para devocionais, visualização = engajamento positivo
- Score aumenta quando mensagem é lida
- Score não diminui se mensagem não for lida imediatamente

### Lógica de Bloqueio

O ShieldService usa o score para decidir se deve enviar:

- **Score >= 0.3**: Envia normalmente
- **Score < 0.3**: Pode pular envio (configurável)

**Para devocionais**: Sempre envia, mas monitora engajamento para ajustar estratégia.

## 📈 Interpretando os Dados

### Score de Engajamento

- **0.8 - 1.0**: Excelente engajamento (lê quase todas as mensagens)
- **0.5 - 0.8**: Bom engajamento (lê a maioria)
- **0.3 - 0.5**: Engajamento médio (lê algumas)
- **0.0 - 0.3**: Baixo engajamento (raramente lê) ⚠️

### Taxa de Leitura (Read Rate)

- **> 80%**: Excelente
- **50-80%**: Bom
- **30-50%**: Médio
- **< 30%**: Baixo ⚠️

### Mensagens Consecutivas Não Lidas

- **0**: Todas as mensagens recentes foram lidas ✅
- **1-3**: Normal (pode estar ocupado)
- **4-7**: Atenção (engajamento diminuindo)
- **> 7**: Problema (não está lendo) ⚠️

## 🔧 Ajustes Recomendados

### Para Contatos com Baixo Engajamento

1. **Reduzir frequência**: Enviar menos mensagens
2. **Melhorar conteúdo**: Tornar mensagens mais relevantes
3. **Horários**: Testar diferentes horários
4. **Personalização**: Usar nome do destinatário

### Configurações do ShieldService

No `.env`:
```env
# Score mínimo para enviar (0.0 = sempre envia)
MIN_ENGAGEMENT_SCORE=0.3

# Para devocionais, sempre enviar (ignora score)
# Isso já está implementado no código
```

## 🚨 Monitoramento

### Alertas Importantes

1. **Taxa de leitura < 30%**: Risco de banimento**
2. **Muitos contatos com score < 0.3**: Revisar estratégia
3. **Mensagens não entregues**: Verificar números válidos

### Dashboard Recomendado

Monitore regularmente:
- Taxa média de leitura geral
- Contatos com baixo engajamento
- Tendência de engajamento ao longo do tempo

## 📝 Próximos Passos

1. ✅ Executar migração SQL
2. ✅ Configurar webhook na Evolution API
3. ✅ Testar recebimento de eventos
4. ✅ Monitorar estatísticas por alguns dias
5. ✅ Ajustar estratégia baseado nos dados

## 🔗 Endpoints Disponíveis

- `GET /api/engagement/stats` - Lista todos os contatos
- `GET /api/engagement/stats/{phone}` - Estatísticas de um contato
- `POST /api/webhook/evolution/message-status` - Webhook da Evolution API
- `GET /api/webhook/evolution/test` - Testar webhook

---

**Importante**: O rastreamento de visualizações é essencial para evitar banimentos. Configure o webhook o quanto antes!
