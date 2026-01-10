# 🔑 Qual API Key Usar no Evolution API?

## 📋 Entendendo as Chaves do Evolution API

No Evolution API existem **dois tipos de chave**:

### **1. API Key Principal (Manager)**
- ✅ **O que é**: Chave para autenticar no **manager/painel** do Evolution API
- ✅ **Onde usar**: Para acessar o painel web, listar instâncias, criar instâncias
- ✅ **Exemplo**: `429683C4C977415CAAFCCE10F7D57E11` (a que você já tem)
- ✅ **Uso**: Geralmente é a **mesma para todas as instâncias**

### **2. Instance Token/Key (Específica da Instância)**
- ✅ **O que é**: Token/chave **específica de cada instância**
- ✅ **Onde usar**: Para enviar mensagens via aquela instância específica
- ✅ **Onde encontrar**: Dentro da configuração de cada instância
- ✅ **Uso**: Cada instância pode ter sua própria (ou usar a principal)

## 🎯 Qual Usar no Nosso Sistema?

### **Cenário 1: Evolution API com API Key Única (Mais Comum)**

Se o Evolution API usa a **mesma API Key para todas as instâncias**:

```env
# Use a MESMA API Key para todas as instâncias
EVOLUTION_INSTANCES=[
  {"name":"Devocional-1","api_url":"...","api_key":"429683C4C977415CAAFCCE10F7D57E11",...},
  {"name":"Devocional-2","api_url":"...","api_key":"429683C4C977415CAAFCCE10F7D57E11",...},
  {"name":"Devocional-3","api_url":"...","api_key":"429683C4C977415CAAFCCE10F7D57E11",...},
  {"name":"Devocional-4","api_url":"...","api_key":"429683C4C977415CAAFCCE10F7D57E11",...}
]
```

**Neste caso**: Use a API Key que você usa para logar no manager (a que você já tem: `429683C4C977415CAAFCCE10F7D57E11`)

### **Cenário 2: Evolution API com Token por Instância**

Se cada instância tem seu **próprio token/chave**:

```env
# Use o token ESPECÍFICO de cada instância
EVOLUTION_INSTANCES=[
  {"name":"Devocional-1","api_url":"...","api_key":"TOKEN_DA_INSTANCIA_1",...},
  {"name":"Devocional-2","api_url":"...","api_key":"TOKEN_DA_INSTANCIA_2",...},
  {"name":"Devocional-3","api_url":"...","api_key":"TOKEN_DA_INSTANCIA_3",...},
  {"name":"Devocional-4","api_url":"...","api_key":"TOKEN_DA_INSTANCIA_4",...}
]
```

**Neste caso**: Use o token que aparece dentro de cada instância

## 🔍 Como Descobrir Qual É o Seu Caso

### **Teste 1: Verificar se API Key Principal Funciona**

Teste se a API Key principal funciona para enviar mensagem:

```bash
curl -X POST https://imobmiq-evolution-api.90qhxz.easypanel.host/message/sendText/Devocional \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "5516999999999",
    "text": "Teste"
  }'
```

**Se funcionar**: Use a API Key principal para todas as instâncias ✅

**Se não funcionar**: Cada instância precisa de seu próprio token ❌

### **Teste 2: Verificar Configuração do Evolution API**

No painel do Evolution API (`https://imobmiq-evolution-api.90qhxz.easypanel.host`):

1. **Vá em Settings/Configurações**
2. **Veja se há uma API Key global** ou **tokens por instância**
3. **Verifique a documentação** do seu Evolution API

### **Teste 3: Verificar Dentro de Cada Instância**

Para cada instância:

1. **Clique na instância** (ex: `Devocional-1`)
2. **Vá em Settings/Configurações da instância**
3. **Procure por**:
   - "API Key"
   - "Token"
   - "Instance Token"
   - "Access Token"
4. **Se encontrar um token específico**: Use esse token
5. **Se não encontrar**: Use a API Key principal

## 📝 Onde Encontrar o Token da Instância

### **No Painel Web do Evolution API**

1. Acesse: `https://imobmiq-evolution-api.90qhxz.easypanel.host`
2. Faça login (se necessário)
3. Clique na instância (ex: `Devocional-1`)
4. Vá em **Settings** ou **Configurações**
5. Procure por:
   - **API Key**
   - **Token**
   - **Instance Token**
   - **Access Token**
   - **Secret Key**

### **Via API do Evolution**

```bash
# Listar instâncias e ver tokens
curl https://imobmiq-evolution-api.90qhxz.easypanel.host/instance/fetchInstances \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11"
```

Isso pode retornar informações sobre cada instância, incluindo tokens.

## ✅ Recomendação

### **Para a Maioria dos Casos:**

Use a **API Key principal** (a que você usa para logar) para todas as instâncias:

```env
EVOLUTION_INSTANCES=[
  {"name":"Devocional-1","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"429683C4C977415CAAFCCE10F7D57E11",...},
  {"name":"Devocional-2","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"429683C4C977415CAAFCCE10F7D57E11",...},
  {"name":"Devocional-3","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"429683C4C977415CAAFCCE10F7D57E11",...},
  {"name":"Devocional-4","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"429683C4C977415CAAFCCE10F7D57E11",...}
]
```

### **Se Não Funcionar:**

Se a API Key principal não funcionar, procure o token específico de cada instância e use esse.

## 🧪 Teste Final

Depois de configurar, teste:

```bash
# Testar instância 1
curl https://sua-api.com/api/notifications/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: Fs142779" \
  -d '{
    "event": "check_status"
  }'
```

Se retornar status das instâncias, está correto! ✅

---

**Resumo**: 
- **Geralmente**: Use a API Key principal (do manager) para todas
- **Se não funcionar**: Use o token específico de cada instância (o que aparece dentro da instância)

