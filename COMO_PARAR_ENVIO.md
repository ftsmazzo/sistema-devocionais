# 🛑 Como Parar Envio em Massa

## ⚠️ SITUAÇÃO DE EMERGÊNCIA

Se você está com envio em massa rodando e precisa parar **AGORA**:

### Opção 1: Via API (Rápido)

Faça uma requisição POST para:

```bash
POST https://sua-api.com/api/devocional/stop-sending
```

Ou use curl:
```bash
curl -X POST https://sua-api.com/api/devocional/stop-sending
```

### Opção 2: Via Frontend

Se você tiver acesso ao frontend, adicione um botão que chame este endpoint.

### Opção 3: Via Terminal do Container (EasyPanel)

1. Acesse o terminal do container do backend
2. Execute:
```bash
curl -X POST http://localhost:8000/api/devocional/stop-sending
```

---

## ✅ Verificar Status

Para verificar se o envio está parado:

```bash
GET https://sua-api.com/api/devocional/sending-status
```

Resposta:
```json
{
  "success": true,
  "stopped": true,
  "message": "Envio parado"
}
```

---

## 🔄 Resetar Flag (Para Iniciar Novo Envio)

Depois de parar, quando quiser iniciar um novo envio:

```bash
POST https://sua-api.com/api/devocional/reset-stop-sending
```

---

## 📊 O Que Acontece Quando Para

1. O envio será interrompido no **próximo contato** a ser processado
2. Os envios já processados **continuarão sendo salvos** no banco
3. Você verá nos logs: `🛑 ENVIO EM MASSA PARADO PELO USUÁRIO`
4. O sistema mostrará quantos foram processados e quantos faltam

---

## 🔍 Verificar se Está Enviando

Nos logs, procure por:
- `Processando contato X/148` - indica que está enviando
- `🛑 ENVIO EM MASSA PARADO` - indica que foi parado
- `Envio em massa concluído` - indica que terminou

---

## ⚡ Solução Rápida (Agora)

**Execute este comando no terminal do EasyPanel:**

```bash
curl -X POST http://localhost:8000/api/devocional/stop-sending
```

Ou acesse no navegador (se tiver autenticação configurada):
```
https://sua-api.com/api/devocional/stop-sending
```

---

**Última atualização:** 2026-01-15
