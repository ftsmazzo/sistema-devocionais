# 🔄 Como Funciona a Distribuição Automática entre Instâncias

## ✅ SIM! É Automático!

**Quando você conectar mais instâncias, elas serão usadas automaticamente nos disparos!**

O sistema já está configurado para distribuir as mensagens entre todas as instâncias disponíveis.

## 🔄 Como Funciona a Alternância

### **Estratégia Padrão: Round Robin (Rotação Circular)**

Por padrão, o sistema usa **Round Robin**, que funciona assim:

**Exemplo com 4 instâncias:**

1. **Mensagem 1** → Instância 1
2. **Mensagem 2** → Instância 2
3. **Mensagem 3** → Instância 3
4. **Mensagem 4** → Instância 4
5. **Mensagem 5** → Instância 1 (volta ao início)
6. **Mensagem 6** → Instância 2
7. E assim por diante...

### **Outras Estratégias Disponíveis**

Você pode configurar no `.env`:

```env
# Rotação circular (padrão) - alterna entre todas
EVOLUTION_INSTANCE_STRATEGY=round_robin

# Menos usada - sempre usa a que enviou menos mensagens hoje
EVOLUTION_INSTANCE_STRATEGY=least_used

# Por prioridade - usa primeiro as de maior prioridade (priority: 1)
EVOLUTION_INSTANCE_STRATEGY=priority

# Aleatória - escolhe uma instância aleatória
EVOLUTION_INSTANCE_STRATEGY=random
```

## 📋 Exemplo Prático

### **Cenário: 4 Instâncias, 100 Contatos**

Com `round_robin` (padrão):

- **Contatos 1-25** → Instância 1
- **Contatos 26-50** → Instância 2
- **Contatos 51-75** → Instância 3
- **Contatos 76-100** → Instância 4

**Distribuição automática e equilibrada!** ✅

## ⚙️ Configuração

### **1. Configurar Múltiplas Instâncias no `.env`**

```env
EVOLUTION_INSTANCES=[{"name":"Devocional-1","api_url":"https://seu-evolution-api.com","api_key":"sua-key","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-2","api_url":"https://seu-evolution-api.com","api_key":"sua-key","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-3","api_url":"https://seu-evolution-api.com","api_key":"sua-key","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-4","api_url":"https://seu-evolution-api.com","api_key":"sua-key","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true}]

# Estratégia de distribuição (padrão: round_robin)
EVOLUTION_INSTANCE_STRATEGY=round_robin
```

### **2. Estratégia de Distribuição**

**Round Robin (Recomendado):**
- ✅ Distribui igualmente entre todas
- ✅ Alterna automaticamente
- ✅ Melhor para evitar bloqueios

**Least Used:**
- ✅ Sempre usa a que enviou menos
- ✅ Útil se instâncias têm limites diferentes

**Priority:**
- ✅ Usa primeiro as de maior prioridade
- ✅ Útil se algumas instâncias são "backup"

**Random:**
- ✅ Escolhe aleatoriamente
- ✅ Útil para distribuição imprevisível

## 🎯 Vantagens da Distribuição Automática

### **1. Proteção Contra Bloqueios**

- ✅ Mensagens distribuídas entre várias instâncias
- ✅ Menos risco de bloqueio
- ✅ Cada instância envia menos mensagens

### **2. Maior Capacidade**

- ✅ 4 instâncias = 4x mais mensagens por dia
- ✅ Se cada uma envia 200/dia, total = 800/dia
- ✅ Escalável facilmente

### **3. Failover Automático**

- ✅ Se uma instância falhar, usa as outras
- ✅ Sistema continua funcionando
- ✅ Sem interrupção

### **4. Balanceamento de Carga**

- ✅ Distribui igualmente
- ✅ Nenhuma instância sobrecarrega
- ✅ Melhor performance

## 📊 Monitoramento

### **Ver Status das Instâncias**

```bash
GET https://sua-api.com/api/notifications/instances
```

Retorna:
- Status de cada instância (ACTIVE, INACTIVE, ERROR)
- Mensagens enviadas hoje por instância
- Mensagens enviadas nesta hora
- Limites configurados

### **Exemplo de Resposta**

```json
{
  "instances": {
    "total_instances": 4,
    "active_instances": 4,
    "instances": [
      {
        "name": "Devocional-1",
        "status": "active",
        "messages_sent_today": 50,
        "messages_sent_this_hour": 5,
        "max_per_hour": 20,
        "max_per_day": 200
      },
      {
        "name": "Devocional-2",
        "status": "active",
        "messages_sent_today": 50,
        "messages_sent_this_hour": 5,
        "max_per_hour": 20,
        "max_per_day": 200
      },
      // ... mais instâncias
    ]
  }
}
```

## ✅ Resumo

### **Perguntas Frequentes:**

**Q: Preciso fazer algo para usar múltiplas instâncias?**
A: **NÃO!** Basta configurar no `.env` e o sistema distribui automaticamente.

**Q: As instâncias são alternadas?**
A: **SIM!** Por padrão usa Round Robin (rotação circular).

**Q: Posso escolher qual instância usar?**
A: **SIM!** Configure a estratégia no `.env` (`EVOLUTION_INSTANCE_STRATEGY`).

**Q: E se uma instância falhar?**
A: **O sistema usa as outras automaticamente!** Failover automático.

**Q: O vCard funciona com múltiplas instâncias?**
A: **SIM!** O vCard é enviado pela mesma instância que enviou a mensagem.

---

## 🚀 Próximos Passos

1. **Configure múltiplas instâncias** no `.env`
2. **Escolha a estratégia** (recomendado: `round_robin`)
3. **Teste enviando mensagens**
4. **Monitore o status** via API

**Tudo funciona automaticamente!** 🎉

