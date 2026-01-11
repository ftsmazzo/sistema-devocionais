# 📋 Guia de Configuração .env no EasyPanel

## ✅ Arquivo .env Completo e Otimizado

O arquivo `.env` foi refatorado completamente com todas as configurações de blindagem e organizado por seções.

---

## 📝 Como Usar no EasyPanel

### 1. **Copiar Configuração**

Copie todo o conteúdo do arquivo `backend/.env` e cole no campo de variáveis de ambiente do EasyPanel.

### 2. **Estrutura do .env**

O arquivo está organizado em seções:

```
1. DATABASE - PostgreSQL
2. EVOLUTION API - Configuração Legada
3. EVOLUTION API - Multi-Instância
4. VCARD E PERFIL
5. RATE LIMITING - Proteção Básica
6. RETRY CONFIGURATION
7. BLINDAGEM AVANÇADA (Shield Service) ⭐ NOVO
8. SCHEDULER - Envio Automático
9. INTEGRAÇÃO N8N - Webhook
```

---

## 🔧 Configurações Principais

### **Database**
```env
DATABASE_URL=postgresql://devocional:ce0e9d2271eed9b95a2b@imobmiq_postgres:5432/devocional?sslmode=disable
```

### **Evolution API (1 Instância Atual)**
```env
EVOLUTION_INSTANCES=[{"name":"Devocional-1","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"429683C4C977415CAAFCCE10F7D57E11","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true}]
```

### **Blindagem Avançada (NOVO)**
```env
SHIELD_ENABLED=true
DELAY_VARIATION=0.3
BREAK_INTERVAL=50
BREAK_DURATION_MIN=15.0
BREAK_DURATION_MAX=30.0
MIN_ENGAGEMENT_SCORE=0.3
ADAPTIVE_LIMITS_ENABLED=true
BLOCK_DETECTION_ENABLED=true
```

---

## ➕ Adicionar Mais Instâncias

Quando conectar mais instâncias, edite `EVOLUTION_INSTANCES` mantendo em **UMA LINHA**:

```env
EVOLUTION_INSTANCES=[{"name":"Devocional-1","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"429683C4C977415CAAFCCE10F7D57E11","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-2","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"KEY_2_AQUI","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-3","api_url":"https://imobmiq-evolution-api.90qhxz.easypanel.host","api_key":"KEY_3_AQUI","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true}]
```

**⚠️ IMPORTANTE:** Tudo em uma linha, sem quebras!

---

## 🎯 Configurações Recomendadas

### **Para Produção (Atual)**
- ✅ Todas as blindagens habilitadas
- ✅ Delay: 3.0s (com variação de 30%)
- ✅ Limites: 20/hora, 200/dia
- ✅ Pausas: A cada 50 mensagens

### **Para Teste/Desenvolvimento**
Se quiser testar com limites mais baixos:
```env
MAX_MESSAGES_PER_HOUR=10
MAX_MESSAGES_PER_DAY=50
BREAK_INTERVAL=20
```

---

## 📊 Monitoramento

Após configurar, monitore as métricas:

**Endpoint:** `GET /api/stats`

Retorna:
- Estatísticas de envio
- Status das instâncias
- **Métricas de blindagem** (novo!)

```json
{
  "shield": {
    "status": "active",
    "success_rate": 0.967,
    "current_hourly_limit": 20,
    "current_daily_limit": 200,
    "messages_since_break": 25
  }
}
```

---

## ✅ Checklist de Configuração

- [ ] Database URL configurado
- [ ] Evolution API URL e Key configurados
- [ ] EVOLUTION_INSTANCES em uma linha
- [ ] Blindagem habilitada (SHIELD_ENABLED=true)
- [ ] Webhook secret configurado
- [ ] Horário de envio configurado (06:00)
- [ ] vCard habilitado (SEND_VCARD_TO_NEW_CONTACTS=true)

---

## 🚀 Próximos Passos

1. ✅ Copiar `.env` para EasyPanel
2. ✅ Reiniciar aplicação
3. ✅ Verificar logs para confirmar inicialização
4. ✅ Testar envio manual
5. ✅ Monitorar métricas de blindagem

---

**Tudo pronto para produção!** 🎉

