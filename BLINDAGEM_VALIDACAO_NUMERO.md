# 📱 Validação de Número e WhatsApp - Implementação

## ✅ Status: Implementado

Sistema de validação de número de telefone e verificação se está cadastrado no WhatsApp.

---

## 🎯 Funcionalidades

### 1. **Validação de Formato**
- ✅ Valida formato E.164 (ex: +5516996282630)
- ✅ Normaliza números automaticamente
- ✅ Adiciona código do país se não especificado (padrão: Brasil +55)
- ✅ Remove espaços e caracteres especiais

### 2. **Verificação WhatsApp**
- ✅ Verifica se número está registrado no WhatsApp
- ✅ Usa Evolution API para verificação
- ✅ Cache de 24 horas (configurável)
- ✅ Fallback inteligente se verificação falhar

### 3. **Cache Inteligente**
- ✅ Evita verificações repetidas
- ✅ Cache por número de telefone
- ✅ TTL configurável (padrão: 24 horas)
- ✅ Atualização automática

---

## 🔧 Configuração

### Regra Padrão

Ao criar uma instância, a regra de validação de número é criada automaticamente:

```json
{
  "rule_name": "Validação de Número",
  "rule_type": "number_validation",
  "enabled": true,
  "config": {
    "validate_format": true,
    "check_whatsapp": true,
    "require_whatsapp_check": false,
    "default_country_code": "55",
    "cache_hours": 24,
    "timeout_ms": 10000
  }
}
```

### Parâmetros de Configuração

- **`validate_format`**: Valida formato E.164 (padrão: `true`)
- **`check_whatsapp`**: Verifica se número está no WhatsApp (padrão: `true`)
- **`require_whatsapp_check`**: Se `true`, bloqueia se não conseguir verificar (padrão: `false`)
- **`default_country_code`**: Código do país padrão (padrão: `"55"` - Brasil)
- **`cache_hours`**: Horas de cache (padrão: `24`)
- **`timeout_ms`**: Timeout em milissegundos (padrão: `10000`)

---

## 📊 Fluxo de Validação

```
1. Recebe número de telefone
   ↓
2. Normaliza número (remove espaços, adiciona + se necessário)
   ↓
3. Valida formato E.164
   ├─ Se inválido → Bloqueia e registra ação
   └─ Se válido → Continua
   ↓
4. Verifica cache
   ├─ Se encontrado e válido → Permite envio
   └─ Se não encontrado → Verifica via API
   ↓
5. Verifica via Evolution API
   ├─ Se válido → Salva no cache e permite envio
   ├─ Se inválido → Bloqueia e registra ação
   └─ Se erro → Fallback (permite ou bloqueia conforme config)
   ↓
6. Retorna resultado
```

---

## 🗄️ Estrutura do Banco

### Tabela: `number_validation_cache`

```sql
CREATE TABLE number_validation_cache (
  phone_number VARCHAR(20) PRIMARY KEY,
  is_valid BOOLEAN NOT NULL,
  checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Índices:**
- `idx_number_validation_cache_checked_at` - Para limpeza de cache antigo

---

## 🔍 Exemplos de Uso

### Número Válido

```bash
POST /api/messages/send
{
  "to": "5516996282630",
  "message": "Olá!"
}
```

**Resultado:**
- ✅ Número normalizado: `+5516996282630`
- ✅ Formato válido
- ✅ Verificado no WhatsApp (ou cache)
- ✅ Mensagem enviada

### Número Inválido (Formato)

```bash
POST /api/messages/send
{
  "to": "abc123",
  "message": "Olá!"
}
```

**Resultado:**
- ❌ Formato inválido
- ❌ Mensagem bloqueada
- 📝 Ação registrada: `number_blocked` (reason: `invalid_format`)

### Número Não no WhatsApp

```bash
POST /api/messages/send
{
  "to": "5511999999999",
  "message": "Olá!"
}
```

**Resultado:**
- ✅ Formato válido
- ❌ Número não está no WhatsApp
- ❌ Mensagem bloqueada
- 📝 Ação registrada: `number_blocked` (reason: `not_on_whatsapp`)

---

## 📝 Ações Registradas

### Tipos de Ação

1. **`number_blocked`**
   - `reason: 'invalid_format'` - Formato inválido
   - `reason: 'not_on_whatsapp'` - Número não está no WhatsApp

2. **`number_check_failed`**
   - `reason: 'api_error'` - Erro ao verificar via API

### Exemplo de Log

```json
{
  "action_type": "number_blocked",
  "reason": "not_on_whatsapp",
  "phone_number": "5511999999999"
}
```

---

## ⚙️ Personalização

### Desabilitar Validação de Formato

```json
{
  "validate_format": false
}
```

### Desabilitar Verificação WhatsApp

```json
{
  "check_whatsapp": false
}
```

### Tornar Verificação Obrigatória

```json
{
  "require_whatsapp_check": true
}
```

Se `require_whatsapp_check: true` e a verificação falhar, a mensagem será bloqueada.

### Alterar Código do País Padrão

```json
{
  "default_country_code": "1"  // EUA
}
```

### Alterar Tempo de Cache

```json
{
  "cache_hours": 48  // Cache por 48 horas
}
```

---

## 🚀 Integração com Blindagem

A validação de número é a **primeira camada** de blindagem aplicada:

```
1. Validação de Número ← PRIMEIRO
2. Validação de Conteúdo
3. Seleção de Instância
4. Health Check
5. Verificação de Limites
6. Verificação de Horários
7. Cálculo de Delay
8. Envio
```

---

## 📈 Monitoramento

### Estatísticas

```bash
GET /api/blindage/stats?instanceId=1
```

Retorna estatísticas de bloqueios por tipo:
- `number_blocked` - Total de números bloqueados
- `number_check_failed` - Total de falhas na verificação

### Ações de Blindagem

```bash
GET /api/blindage/actions?instanceId=1&limit=50
```

Lista todas as ações de validação de número.

---

## ⚠️ Notas Importantes

1. **Cache**: Números verificados são cacheados por 24 horas (padrão)
2. **Fallback**: Se verificação falhar e `require_whatsapp_check: false`, permite envio
3. **Performance**: Cache reduz chamadas à API e melhora performance
4. **Normalização**: Números são sempre normalizados para formato E.164
5. **Brasil**: Código do país padrão é 55 (Brasil)

---

## 🔄 Limpeza de Cache

O cache pode ser limpo manualmente:

```sql
DELETE FROM number_validation_cache 
WHERE checked_at < NOW() - INTERVAL '7 days';
```

Ou automaticamente via job agendado (implementar se necessário).

---

**Status**: ✅ Implementado e funcional - Pronto para uso!
