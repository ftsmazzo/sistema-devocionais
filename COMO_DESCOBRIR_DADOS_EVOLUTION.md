# 🔍 Como Descobrir os Dados das Instâncias Evolution API

## 📋 O que você precisa descobrir:

Para cada uma das 4 instâncias, você precisa:

1. **Nome da Instância** (`name`)
2. **API Key** (`api_key`)
3. **URL da API** (`api_url`) - geralmente é a mesma para todas

## 🎯 Passo a Passo

### **1. Acessar o Painel do Evolution API**

Acesse a URL do seu Evolution API:
```
https://imobmiq-evolution-api.90qhxz.easypanel.host
```

### **2. Ver Lista de Instâncias**

No painel do Evolution API, você verá uma lista de instâncias. Cada instância tem:
- **Nome** (ex: `Devocional-1`, `Devocional-2`, etc)
- **Status** (conectada, desconectada)
- **QR Code** (para conectar WhatsApp)

### **3. Obter API Key de Cada Instância**

Para cada instância:

1. Clique na instância
2. Vá em **Settings** ou **Configurações**
3. Procure por **API Key** ou **Token**
4. Copie a API Key

**OU**

1. Vá em **API Keys** no menu
2. Veja a lista de API Keys
3. Cada instância pode ter sua própria API Key

### **4. Verificar Nome Exato da Instância**

O nome da instância é o que você vê na lista. Exemplos:
- `Devocional-1`
- `Devocional-2`
- `devocional-1` (minúsculas)
- `devocional_1` (com underscore)

**Importante**: Use o nome **exato** como aparece no Evolution API!

### **5. URL da API**

Se todas as instâncias estão no mesmo servidor Evolution API, a URL é a mesma:
```
https://imobmiq-evolution-api.90qhxz.easypanel.host
```

## 📝 Exemplo Prático

### **Cenário: Você tem 4 instâncias no Evolution API**

**No painel do Evolution você vê:**
- Instância 1: Nome = `Devocional-1`, API Key = `ABC123KEY1`
- Instância 2: Nome = `Devocional-2`, API Key = `ABC123KEY2`
- Instância 3: Nome = `Devocional-3`, API Key = `ABC123KEY3`
- Instância 4: Nome = `Devocional-4`, API Key = `ABC123KEY4`

**No `.env` você coloca:**

```env
EVOLUTION_INSTANCES=[{"name":"Devocional-1","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"ABC123KEY1","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-2","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"ABC123KEY2","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-3","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"ABC123KEY3","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-4","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"ABC123KEY4","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true}]
```

## ⚠️ Importante

### **1. JSON em Uma Linha**

O `EVOLUTION_INSTANCES` **DEVE** estar em uma única linha. Não pode ter quebras de linha!

❌ **ERRADO:**
```env
EVOLUTION_INSTANCES=[
    {"name":"Devocional-1",...},
    {"name":"Devocional-2",...}
]
```

✅ **CORRETO:**
```env
EVOLUTION_INSTANCES=[{"name":"Devocional-1",...},{"name":"Devocional-2",...}]
```

### **2. Nome Exato da Instância**

Use o nome **exatamente** como aparece no Evolution API. É case-sensitive!

### **3. API Key Única**

Cada instância tem sua própria API Key. Não use a mesma para todas!

### **4. URL da API**

Se todas as instâncias estão no mesmo servidor, use a mesma URL para todas.

## 🔧 Testar Configuração

Depois de configurar, teste:

```bash
# No container do backend
curl https://sua-api.com/api/notifications/instances
```

Deve retornar status das 4 instâncias.

## 🆘 Se Não Encontrar os Dados

### **Opção 1: Usar API do Evolution**

```bash
# Listar instâncias
curl https://imobmiq-evolution-api.90qhxz.easypanel.host/instance/fetchInstances \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11"
```

Isso retorna lista de instâncias com seus nomes.

### **Opção 2: Começar com Uma Instância**

Se ainda não tem 4 instâncias, configure apenas uma:

```env
EVOLUTION_INSTANCES=[{"name":"Devocional","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"429683C4C977415CAAFCCE10F7D57E11","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true}]
```

Depois adicione as outras conforme criar.

---

**Dica**: Se você já tem uma instância funcionando (`EVOLUTION_INSTANCE_NAME=Devocional`), use esse nome e API Key como base para descobrir as outras!

