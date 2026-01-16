# 🚀 Deploy das Melhorias - Passo a Passo

## 📋 Serviços no EasyPanel

Você tem **2 serviços separados**:
1. **`devocional-backend`** - API Node.js
2. **`devocional-frontend`** - Interface React

---

## 🔧 1. Serviço: `devocional-backend`

### Configurar Variáveis de Ambiente

No serviço `devocional-backend`, adicione/atualize estas variáveis:

```env
EVOLUTION_API_KEY=sua-api-key-aqui
EVOLUTION_API_URL=http://seu-evolution-api:8080
```

**Onde configurar:**
- EasyPanel → Projeto → Serviço `devocional-backend` → **Environment Variables**

### Fazer Deploy

1. Acesse o serviço `devocional-backend` no EasyPanel
2. Clique em **"Deploy"** ou **"Redeploy"**
3. Aguarde o build e deploy completar
4. Verifique os logs para garantir que iniciou corretamente

**Importante:** 
- O banco de dados será atualizado automaticamente na primeira inicialização
- A coluna `phone_number` será adicionada automaticamente

---

## 🎨 2. Serviço: `devocional-frontend`

### Fazer Deploy

1. Acesse o serviço `devocional-frontend` no EasyPanel
2. Clique em **"Deploy"** ou **"Redeploy"**
3. Aguarde o build e deploy completar

**Nota:** 
- O frontend não precisa de novas variáveis de ambiente
- Apenas precisa do rebuild para pegar as mudanças visuais

---

## ✅ Ordem Recomendada

1. **Primeiro:** Deploy do `devocional-backend` (com as variáveis configuradas)
2. **Depois:** Deploy do `devocional-frontend`

---

## 🧪 Teste Após Deploy

1. Acesse o frontend
2. Faça login
3. Tente criar uma nova instância:
   - Deve pedir apenas **Nome** e **Instance Name**
   - Não deve pedir API Key e API URL
4. Conecte a instância
5. Verifique se o número de telefone aparece no card

---

## ⚠️ Troubleshooting

### Backend não inicia
- Verifique se as variáveis `EVOLUTION_API_KEY` e `EVOLUTION_API_URL` estão configuradas
- Verifique os logs do serviço `devocional-backend`

### Frontend não carrega
- Verifique se o backend está rodando
- Verifique os logs do serviço `devocional-frontend`

### Número de telefone não aparece
- Certifique-se de que a instância está **conectada** (status = connected)
- Clique no botão de atualizar status
- O número só aparece quando a instância está conectada na Evolution API

---

**Última atualização:** Janeiro 2025
