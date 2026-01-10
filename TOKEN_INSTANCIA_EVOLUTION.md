# 🔑 Token da Instância Evolution API

## 📋 Sobre o Token que Aparece ao Criar Instância

Quando você cria uma instância no Evolution API, aparece um token como:
```
1172EA578429-4963-A360-DBF9EC3B5EB7
```

### O que é esse Token?

Esse token é um **identificador único da instância** gerado pelo Evolution API. Ele pode ser usado para:

1. **Autenticação específica da instância** (em alguns casos)
2. **Identificação da instância** na API
3. **Acesso direto à instância** (alternativa à API Key principal)

## ✅ Precisa Usar esse Token?

### **Geralmente NÃO precisa!**

Na maioria dos casos, você pode usar a **API Key principal** (a que você usa para logar no manager) para todas as instâncias:

```env
EVOLUTION_INSTANCES=[{"name":"Devocional-1","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"429683C4C977415CAAFCCE10F7D57E11",...}]
```

### **Quando Pode Precisar:**

1. **Se a API Key principal não funcionar** para enviar mensagens
2. **Se o Evolution API exigir token específico** por instância
3. **Se você quiser maior segurança** (cada instância com seu próprio token)

## 🧪 Como Testar

### Teste 1: Usar API Key Principal

Tente enviar uma mensagem usando a API Key principal:

```bash
curl -X POST https://imobmiq-evolution-api.90qhxz.easypanel.host/message/sendText/Devocional-1 \
  -H "apikey: 429683C4C977415CAAFCCE10F7D57E11" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "5516999999999",
    "text": "Teste"
  }'
```

**Se funcionar**: Use a API Key principal ✅

**Se não funcionar**: Tente usar o token da instância

### Teste 2: Usar Token da Instância

Se a API Key principal não funcionar, tente usar o token:

```env
EVOLUTION_INSTANCES=[{"name":"Devocional-1","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"1172EA578429-4963-A360-DBF9EC3B5EB7",...}]
```

## 📝 Recomendação

### **Para Começar:**

1. **Use a API Key principal** para todas as instâncias
2. **Teste se funciona** enviando uma mensagem
3. **Se não funcionar**, então use o token específico de cada instância

### **Exemplo de Configuração com API Key Principal:**

```env
EVOLUTION_INSTANCES=[{"name":"Devocional-1","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"429683C4C977415CAAFCCE10F7D57E11","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true}]
```

### **Exemplo de Configuração com Token da Instância:**

```env
EVOLUTION_INSTANCES=[{"name":"Devocional-1","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"1172EA578429-4963-A360-DBF9EC3B5EB7","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true}]
```

## 🎯 Resumo

- ✅ **Geralmente**: Use a API Key principal (do manager)
- ⚠️ **Se não funcionar**: Use o token específico da instância
- 🔍 **Teste primeiro**: Sempre teste antes de configurar tudo

---

**Dica**: Comece usando a API Key principal. Se funcionar, não precisa do token! 🚀

