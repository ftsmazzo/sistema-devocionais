# 🛡️ Sistema de Blindagem - Implementação Completa

## ✅ Status: Implementado

Sistema de blindagem **global e automático** que protege **TODAS** as mensagens enviadas pela plataforma.

---

## 🎯 Funcionalidades Implementadas

### 1. **Camada de Blindagem Automática**

Toda mensagem passa automaticamente por:
- ✅ Validação de conteúdo (tamanho, palavras bloqueadas)
- ✅ Verificação de saúde da instância
- ✅ Verificação de limites (hora/dia)
- ✅ Seleção de instância (rotação)
- ✅ Cálculo e aplicação de delay
- ✅ Registro de ações

### 2. **Tipos de Blindagem**

#### ✅ **Delay Entre Mensagens**
- Delay mínimo configurável (padrão: 3s)
- Delay progressivo (aumenta com volume)
- Delay máximo configurável (padrão: 10s)

#### ✅ **Limite de Mensagens**
- Limite por hora (padrão: 50/hora)
- Limite por dia (padrão: 500/dia)
- Reset automático

#### ✅ **Rotação de Instâncias**
- Distribui mensagens entre instâncias
- Seleciona instância com menos mensagens recentes
- Delay mínimo entre instâncias

#### ✅ **Horários de Envio**
- Horários permitidos (padrão: 8h-20h)
- Horários bloqueados (padrão: 22h-7h)
- Timezone configurável

#### ✅ **Health Check**
- Pausa envios se instância está down
- Pausa envios se instância está degradada
- Retoma automaticamente quando volta ao normal

#### ✅ **Validação de Conteúdo**
- Limite de caracteres (padrão: 4096)
- Lista de palavras bloqueadas
- Bloqueio automático de conteúdo suspeito

---

## 📁 Arquivos Criados

### Backend

1. **`backend/src/services/blindage.ts`**
   - Serviço principal de blindagem
   - Funções: `applyBlindage()`, `getActiveRules()`, `createDefaultRules()`
   - Validações: conteúdo, limites, horários, saúde, rotação

2. **`backend/src/routes/messages.ts`**
   - Rota: `POST /api/messages/send` - Envia mensagem com blindagem
   - Rota: `GET /api/messages` - Lista mensagens
   - Rota: `GET /api/messages/:id` - Busca mensagem

3. **`backend/src/routes/blindage.ts`**
   - Rota: `GET /api/blindage/rules` - Lista regras
   - Rota: `POST /api/blindage/rules` - Cria regra
   - Rota: `PUT /api/blindage/rules/:id` - Atualiza regra
   - Rota: `DELETE /api/blindage/rules/:id` - Deleta regra
   - Rota: `POST /api/blindage/rules/default/:instanceId` - Cria regras padrão
   - Rota: `GET /api/blindage/actions` - Lista ações
   - Rota: `GET /api/blindage/stats` - Estatísticas

### Documentação

4. **`BLINDAGEM_SISTEMA.md`**
   - Arquitetura completa do sistema
   - Tipos de blindagem
   - Fluxos e exemplos

5. **`BLINDAGEM_IMPLEMENTACAO.md`** (este arquivo)
   - Resumo da implementação
   - Guia de uso

---

## 🔧 Integrações

### ✅ Criação Automática de Regras

Ao criar uma instância, as regras padrão são criadas automaticamente:
- Delay Mínimo: 3s
- Limite Diário: 500 mensagens
- Limite Horário: 50 mensagens
- Rotação: Habilitada
- Horários: 8h-20h permitidos
- Health Check: Habilitado
- Validação de Conteúdo: 4096 caracteres

### ✅ Integração com Banco de Dados

- Usa tabelas: `blindage_rules`, `blindage_actions`
- Usa métricas: `message_metrics`, `instances`
- Usa triggers: Atualização automática de estatísticas

---

## 📊 Fluxo de Envio com Blindagem

```
1. Cliente faz POST /api/messages/send
   ↓
2. Sistema aplica blindagem:
   ├─ Valida conteúdo
   ├─ Verifica saúde da instância
   ├─ Verifica limites (hora/dia)
   ├─ Seleciona instância (rotação)
   └─ Calcula delay necessário
   ↓
3. Se bloqueado → Retorna erro 403
   ↓
4. Se permitido → Aplica delay (se necessário)
   ↓
5. Envia mensagem via Evolution API
   ↓
6. Registra no banco:
   ├─ messages (nova mensagem)
   ├─ blindage_actions (ação aplicada)
   └─ message_metrics (atualizado via trigger)
   ↓
7. Retorna sucesso
```

---

## 🚀 Como Usar

### Enviar Mensagem com Blindagem

```bash
POST /api/messages/send
Authorization: Bearer <token>
Content-Type: application/json

{
  "to": "5516996282630",
  "message": "Olá! Esta é uma mensagem de teste.",
  "instanceId": 1,  // opcional
  "messageType": "avulsa"  // opcional: 'devocional', 'marketing', 'avulsa'
}
```

**Resposta de Sucesso:**
```json
{
  "success": true,
  "message": {
    "id": 123,
    "instanceId": 1,
    "to": "5516996282630",
    "message": "Olá! Esta é uma mensagem de teste.",
    "status": "sent"
  },
  "blindage": {
    "delayApplied": 3000,
    "instanceSelected": 1
  }
}
```

**Resposta de Bloqueio:**
```json
{
  "error": "Mensagem bloqueada pela blindagem",
  "reason": "Limite horário atingido: 50/50 mensagens",
  "blockedBy": "message_limit"
}
```

### Gerenciar Regras de Blindagem

**Listar regras:**
```bash
GET /api/blindage/rules?instanceId=1
```

**Criar regra:**
```bash
POST /api/blindage/rules
{
  "instance_id": 1,
  "rule_name": "Delay Personalizado",
  "rule_type": "message_delay",
  "enabled": true,
  "config": {
    "min_delay_seconds": 5,
    "max_delay_seconds": 15,
    "progressive": true
  }
}
```

**Atualizar regra:**
```bash
PUT /api/blindage/rules/:id
{
  "enabled": false
}
```

**Criar regras padrão:**
```bash
POST /api/blindage/rules/default/:instanceId
```

---

## 📈 Monitoramento

### Estatísticas de Blindagem

```bash
GET /api/blindage/stats?instanceId=1
```

Retorna:
- Total de ações por tipo
- Ações nas últimas 24h
- Ações na última hora

### Ações de Blindagem

```bash
GET /api/blindage/actions?instanceId=1&limit=50
```

Lista todas as ações aplicadas:
- `blindage_applied` - Blindagem aplicada com sucesso
- `content_blocked` - Conteúdo bloqueado
- `limit_reached` - Limite atingido
- `health_blocked` - Instância com problemas
- `time_blocked` - Horário bloqueado

---

## ⚙️ Configuração de Regras

### Tipos de Regras Disponíveis

1. **`message_delay`** - Delay entre mensagens
2. **`message_limit`** - Limites de envio
3. **`instance_rotation`** - Rotação de instâncias
4. **`allowed_hours`** - Horários permitidos
5. **`health_check`** - Verificação de saúde
6. **`content_validation`** - Validação de conteúdo

### Exemplo de Configuração Completa

```json
{
  "message_delay": {
    "min_delay_seconds": 3,
    "max_delay_seconds": 10,
    "progressive": true,
    "base_delay": 3,
    "increment_per_message": 0.5
  },
  "message_limit": {
    "max_per_hour": 50,
    "max_per_day": 500
  },
  "instance_rotation": {
    "enabled": true,
    "min_delay_between_instances": 1,
    "round_robin": true
  },
  "allowed_hours": {
    "allowed_hours": [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    "blocked_hours": [22, 23, 0, 1, 2, 3, 4, 5, 6, 7]
  },
  "health_check": {
    "pause_if_degraded": true,
    "pause_if_down": true
  },
  "content_validation": {
    "max_length": 4096,
    "blocked_words": []
  }
}
```

---

## 🎯 Próximos Passos

1. ✅ Sistema de blindagem implementado
2. ✅ Rotas de API criadas
3. ✅ Integração com banco de dados
4. ⏳ Dashboard de monitoramento (frontend)
5. ⏳ Interface de gerenciamento de regras (frontend)
6. ⏳ Sistema de disparos em massa (próxima fase)

---

## 📝 Notas Importantes

- **Automático**: Todas as mensagens passam pela blindagem automaticamente
- **Global**: Funciona para todos os tipos de envio (devocional, marketing, avulsa)
- **Configurável**: Cada instância pode ter regras personalizadas
- **Rastreável**: Todas as ações são registradas no banco
- **Eficiente**: Usa triggers e índices para performance

---

**Status**: ✅ Sistema completo e funcional - Pronto para uso!
