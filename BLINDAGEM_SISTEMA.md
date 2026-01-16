# 🛡️ Sistema de Blindagem - Arquitetura Completa

## 🎯 Objetivo

Sistema de blindagem **global e automático** que protege **TODAS** as mensagens enviadas pela plataforma, independente do tipo (devocional, marketing, avulsa, etc.).

---

## 🏗️ Arquitetura Proposta

### 1. **Camada de Blindagem (Middleware)**

Toda mensagem passa por uma camada de blindagem antes de ser enviada:

```
Envio de Mensagem
    ↓
Sistema de Blindagem (aplica regras)
    ↓
Verifica limites, delays, rotação
    ↓
Aplica blindagens necessárias
    ↓
Envia mensagem via Evolution API
    ↓
Registra ação de blindagem
```

### 2. **Tipos de Blindagem**

#### A. **Delay Entre Mensagens**
- Delay mínimo entre mensagens da mesma instância
- Delay configurável por instância
- Delay progressivo (aumenta com volume)

#### B. **Limite de Mensagens**
- Limite por hora/dia por instância
- Limite global por instância
- Limite por tipo de mensagem

#### C. **Rotação de Instâncias**
- Distribui mensagens entre instâncias
- 1 mensagem por instância por vez
- Evita sobrecarga em uma única instância

#### D. **Delay Progressivo**
- Aumenta delay conforme volume aumenta
- Reduz delay quando volume diminui
- Adapta-se automaticamente

#### E. **Horários de Envio**
- Bloqueia envios em horários de risco
- Permite envios apenas em horários seguros
- Configurável por instância

#### F. **Limite de Caracteres**
- Limita tamanho de mensagens
- Evita mensagens muito longas (risco de ban)

#### G. **Validação de Conteúdo**
- Detecta palavras-chave de risco
- Bloqueia conteúdo suspeito
- Lista negra de palavras

#### H. **Health Check Automático**
- Pausa envios se instância está degradada
- Retoma quando instância volta ao normal
- Evita enviar para instâncias com problemas

---

## 📊 Estrutura de Regras

### Tabela: `blindage_rules`

Cada regra tem:
- `rule_type`: Tipo da blindagem
- `config`: JSONB com configurações específicas
- `enabled`: Se está ativa

### Exemplos de Configurações:

#### Delay Entre Mensagens
```json
{
  "min_delay_seconds": 3,
  "max_delay_seconds": 10,
  "progressive": true,
  "base_delay": 3,
  "increment_per_message": 0.5
}
```

#### Limite de Mensagens
```json
{
  "max_per_hour": 50,
  "max_per_day": 500,
  "reset_hour": 0,
  "reset_day": 1
}
```

#### Rotação de Instâncias
```json
{
  "enabled": true,
  "min_delay_between_instances": 1,
  "round_robin": true
}
```

#### Horários de Envio
```json
{
  "allowed_hours": [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  "blocked_hours": [22, 23, 0, 1, 2, 3, 4, 5, 6, 7],
  "timezone": "America/Sao_Paulo"
}
```

#### Health Check
```json
{
  "pause_if_degraded": true,
  "pause_if_down": true,
  "check_interval_seconds": 60
}
```

---

## 🔧 Implementação

### 1. **Serviço de Blindagem**

Criar `backend/src/services/blindage.ts`:

```typescript
- getActiveRules(instanceId) - Busca regras ativas
- applyBlindage(message, instanceId) - Aplica blindagens
- checkLimits(instanceId) - Verifica limites
- calculateDelay(instanceId) - Calcula delay necessário
- selectInstance(message) - Seleciona instância (rotação)
- validateContent(message) - Valida conteúdo
- checkHealth(instanceId) - Verifica saúde da instância
```

### 2. **Middleware de Envio**

Toda mensagem passa por:

```typescript
1. Validar conteúdo (palavras-chave, tamanho)
2. Verificar saúde da instância
3. Verificar limites (hora/dia)
4. Selecionar instância (rotação)
5. Calcular delay necessário
6. Aplicar delay
7. Enviar mensagem
8. Registrar ação de blindagem
9. Atualizar métricas
```

### 3. **Sistema de Rotação**

- Mantém contador de mensagens por instância
- Seleciona instância com menos mensagens recentes
- Distribui uniformemente
- Respeita delays entre instâncias

### 4. **Sistema de Limites**

- Consulta `message_metrics` para verificar limites
- Bloqueia envio se limite atingido
- Retoma automaticamente quando resetar

### 5. **Sistema de Health Check**

- Consulta `instance_health_log` e `instances.health_status`
- Pausa envios se instância degradada/down
- Retoma quando volta ao normal

---

## 📋 Fluxo Completo

### Envio de Mensagem com Blindagem

```
1. Recebe requisição de envio
   ↓
2. Sistema de Blindagem:
   ├─ Valida conteúdo
   ├─ Verifica saúde da instância
   ├─ Verifica limites (hora/dia)
   ├─ Seleciona instância (rotação)
   └─ Calcula delay necessário
   ↓
3. Aplica delay (se necessário)
   ↓
4. Envia mensagem via Evolution API
   ↓
5. Registra:
   ├─ messages (nova mensagem)
   ├─ blindage_actions (ação aplicada)
   └─ message_metrics (atualizado via trigger)
   ↓
6. Retorna resultado
```

---

## 🎛️ Configuração de Blindagem

### Regras Padrão (Criadas Automaticamente)

Ao criar instância, criar regras padrão:

1. **Delay Mínimo**: 3 segundos entre mensagens
2. **Limite Diário**: 500 mensagens/dia
3. **Limite Horário**: 50 mensagens/hora
4. **Rotação**: Habilitada
5. **Horários**: 8h-20h permitidos
6. **Health Check**: Habilitado

### Personalização

Cada instância pode ter regras personalizadas:
- Instância A: Delay 5s, limite 300/dia
- Instância B: Delay 2s, limite 1000/dia
- Instância C: Sem limite, apenas delay

---

## 📊 Monitoramento

### Métricas de Blindagem

- Total de mensagens bloqueadas
- Total de delays aplicados
- Instâncias pausadas por health
- Limites atingidos
- Rotação aplicada

### Alertas

- Instância atingiu limite diário
- Instância degradada/down
- Muitas mensagens bloqueadas
- Delay muito alto

---

## 🔄 Integração com Disparos

### Disparo em Massa

```
1. Criar disparo → dispatches
2. Adicionar contatos → dispatch_contacts
3. Para cada contato:
   ├─ Aplicar blindagem
   ├─ Selecionar instância (rotação)
   ├─ Aplicar delay
   ├─ Enviar mensagem
   └─ Atualizar status
4. Atualizar métricas do disparo
```

### Controle de Pausa

- Pausar disparo → Para no próximo contato
- Retomar disparo → Continua de onde parou
- Parar disparo → Para imediatamente

---

## 🚀 Vantagens

✅ **Automático**: Aplica blindagens sem intervenção  
✅ **Global**: Protege todos os tipos de envio  
✅ **Configurável**: Regras por instância  
✅ **Inteligente**: Adapta-se automaticamente  
✅ **Rastreável**: Log completo de ações  
✅ **Eficiente**: Usa triggers e índices  
✅ **Seguro**: Múltiplas camadas de proteção  

---

## 📝 Próximos Passos

1. Implementar serviço de blindagem
2. Criar middleware de envio
3. Implementar sistema de rotação
4. Criar rotas de API para gerenciar regras
5. Integrar com sistema de disparos
6. Criar dashboard de monitoramento

---

**Status**: Proposta completa - Pronto para implementação
