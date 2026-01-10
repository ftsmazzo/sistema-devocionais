# 🔧 Configuração com 1 Instância (Para Começar)

## 📋 O que você tem agora:

Baseado no seu print:
- ✅ **Nome da Instância**: `Devocional`
- ✅ **ID da Instância**: `820DAFBA68AE-4C72-B7B1-7FB50B205511`
- ✅ **Número WhatsApp**: `5516996282630`
- ✅ **Status**: Connected
- ✅ **API Key do Manager**: (a secreta que você tem)

## 🎯 Configuração Inicial (1 Instância)

Como você tem apenas **1 instância** por enquanto, configure assim no `.env`:

```env
DATABASE_URL=postgresql://devocional:ce0e9d2271eed9b95a2b@imobmiq_postgres:5432/devocional?sslmode=disable

# Configurações Evolution API (LEGADO - funciona com 1 instância)
EVOLUTION_API_URL=https://imobmiq-evolution-api.90qhxz.easypanel.host
EVOLUTION_API_KEY=SUA_API_KEY_SECRETA_DO_MANAGER_AQUI
EVOLUTION_INSTANCE_NAME=Devocional

# Multi-Instância (começando com 1)
EVOLUTION_INSTANCES=[{"name":"Devocional","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"SUA_API_KEY_SECRETA_DO_MANAGER_AQUI","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true}]

EVOLUTION_DISPLAY_NAME=Devocional Diário
EVOLUTION_INSTANCE_STRATEGY=round_robin

# Rate Limiting
DELAY_BETWEEN_MESSAGES=3.0
MAX_MESSAGES_PER_HOUR=20
MAX_MESSAGES_PER_DAY=200

# Retry
MAX_RETRIES=3
RETRY_DELAY=5.0

# Horário
DEVOCIONAL_SEND_TIME=06:00

# n8n
DEVOCIONAL_WEBHOOK_SECRET=Fs142779
DEVOCIONAL_FETCH_MODE=webhook

# Opcionais
SEND_VCARD_TO_NEW_CONTACTS=false
SEND_CONTACT_REQUEST=false
```

## 🔑 Sobre a API Key

**Use a API Key do Manager (a secreta)** para a instância:

- ✅ **Nome da instância**: `Devocional` (exatamente como aparece)
- ✅ **API Key**: A API Key secreta do Manager
- ✅ **URL**: `https://imobmiq-evolution-api.90qhxz.easypanel.host`

## 📝 Onde Encontrar a API Key do Manager

A API Key do Manager geralmente está em:

1. **Settings/Configurações** do Evolution API (menu lateral)
2. **API Keys** ou **Security** no menu
3. **Variáveis de Ambiente** do container no EasyPanel
4. **Arquivo .env** do container Evolution API no EasyPanel

## 🚀 Quando Criar Mais Instâncias

Para ter 4 instâncias (e distribuir carga):

1. **No Evolution API Manager**:
   - Vá em **Instances** ou **Criar Instância**
   - Crie mais 3 instâncias (Devocional-2, Devocional-3, Devocional-4)
   - Cada uma conectará a um número WhatsApp diferente

2. **Depois de criar**, atualize o `.env`:

```env
EVOLUTION_INSTANCES=[
  {"name":"Devocional","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"SUA_API_KEY_SECRETA","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},
  {"name":"Devocional-2","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"SUA_API_KEY_SECRETA","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},
  {"name":"Devocional-3","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"SUA_API_KEY_SECRETA","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},
  {"name":"Devocional-4","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"SUA_API_KEY_SECRETA","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true}
]
```

**Nota**: Geralmente a mesma API Key do Manager funciona para todas as instâncias.

## ✅ Resumo

1. **Agora**: Use 1 instância com a API Key do Manager
2. **Nome**: `Devocional` (exatamente como aparece)
3. **API Key**: A secreta do Manager
4. **Depois**: Crie mais instâncias e adicione ao JSON

## 🧪 Testar

Depois de configurar, teste:

```bash
# Verificar status
curl https://sua-api.com/api/notifications/instances
```

Deve retornar status da instância "Devocional".

---

**Importante**: Se a API Key do Manager não funcionar, pode ser que cada instância precise de um token específico. Nesse caso, procure nas configurações avançadas da instância ou na documentação do seu Evolution API.

