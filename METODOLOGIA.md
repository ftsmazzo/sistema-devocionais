# 📚 Metodologia de Trabalho - GitHub + EasyPanel

Este documento descreve a metodologia padrão de desenvolvimento e deploy usando **GitHub** como repositório principal e **EasyPanel** para deploy automático.

## 🎯 Visão Geral

**Fluxo de Trabalho:**
```
Desenvolvimento Local → Push para GitHub → Deploy Automático no EasyPanel
```

## ✅ É Possível?

**SIM!** O EasyPanel suporta integração direta com GitHub através de:
- **GitHub Integration**: Conecta o repositório diretamente
- **Auto Deploy**: Deploy automático a cada push (opcional)
- **Build Automático**: EasyPanel faz o build das imagens Docker automaticamente

## 🔄 Fluxo de Trabalho Padrão

### 1. **Desenvolvimento Local**

```bash
# 1. Clone o repositório (se ainda não tiver)
git clone https://github.com/ftsmazzo/sistema-devocionais.git
cd sistema-devocionais

# 2. Crie uma branch para sua feature
git checkout -b feature/nova-funcionalidade

# 3. Faça suas alterações no código
# ... desenvolva ...

# 4. Teste localmente
cd backend && npm run dev
cd frontend && npm run dev

# 5. Commit e push
git add .
git commit -m "feat: adiciona nova funcionalidade"
git push origin feature/nova-funcionalidade
```

### 2. **Push para GitHub**

Quando você faz push para o GitHub:
- ✅ Código fica versionado
- ✅ Histórico de mudanças preservado
- ✅ Fácil rollback se necessário
- ✅ Colaboração facilitada

### 3. **Deploy no EasyPanel**

O EasyPanel pode ser configurado para:
- **Deploy Manual**: Você clica em "Deploy" quando quiser
- **Deploy Automático**: Deploy automático a cada push na branch `main` (recomendado)

## 🚀 Configuração Inicial no EasyPanel

### Passo 1: Conectar GitHub

1. Acesse seu painel EasyPanel
2. Crie um novo projeto
3. Selecione **"GitHub"** como fonte
4. Autorize o EasyPanel a acessar seu GitHub
5. Selecione o repositório: `ftsmazzo/sistema-devocionais`
6. Selecione a branch: `main` (ou `master`)

### Passo 2: Configurar Tipo de Projeto

1. Selecione **"Docker Compose"** como tipo de projeto
2. O EasyPanel detectará automaticamente o arquivo `docker-compose.yml`

### Passo 3: Configurar Variáveis de Ambiente

No EasyPanel, adicione as seguintes variáveis:

```env
# Database
DB_USER=evolution
DB_PASSWORD=sua-senha-super-segura-aqui
DB_NAME=evolution_manager

# JWT
JWT_SECRET=sua-chave-jwt-super-secreta-aleatoria

# Evolution API
EVOLUTION_API_URL=http://seu-evolution-api:8080

# Admin (primeiro login)
ADMIN_EMAIL=admin@seu-dominio.com
ADMIN_PASSWORD=sua-senha-admin-segura

# Frontend
VITE_API_URL=http://seu-backend:3001
```

**⚠️ IMPORTANTE**: 
- Use senhas fortes em produção
- Não commite arquivos `.env` no GitHub
- Use variáveis de ambiente do EasyPanel

### Passo 4: Configurar Auto Deploy (Opcional mas Recomendado)

1. No projeto do EasyPanel, vá em **"Settings"**
2. Ative **"Auto Deploy"**
3. Selecione a branch: `main`
4. Escolha quando fazer deploy:
   - **Sempre**: A cada push
   - **Apenas tags**: Apenas quando criar uma tag
   - **Manual**: Apenas quando você clicar

**Recomendação**: Use **"Sempre"** para desenvolvimento, **"Apenas tags"** para produção.

### Passo 5: Primeiro Deploy

1. Clique em **"Deploy"**
2. Aguarde o build (pode levar alguns minutos na primeira vez)
3. Verifique os logs para garantir que tudo está funcionando

## 📋 Processo de Desenvolvimento Diário

### Cenário 1: Nova Funcionalidade

```bash
# 1. Atualize sua branch local
git checkout main
git pull origin main

# 2. Crie uma nova branch
git checkout -b feature/nome-da-funcionalidade

# 3. Desenvolva e teste localmente
# ... código ...

# 4. Commit
git add .
git commit -m "feat: descrição da funcionalidade"

# 5. Push
git push origin feature/nome-da-funcionalidade

# 6. (Opcional) Crie Pull Request no GitHub para revisão
# 7. Após aprovação, merge na main
# 8. EasyPanel fará deploy automático (se configurado)
```

### Cenário 2: Correção de Bug

```bash
# 1. Crie branch de correção
git checkout -b fix/descricao-do-bug

# 2. Corrija o bug
# ... código ...

# 3. Commit e push
git add .
git commit -m "fix: descrição da correção"
git push origin fix/descricao-do-bug

# 4. Merge na main
# 5. Deploy automático
```

### Cenário 3: Ajuste Rápido (Hotfix)

```bash
# 1. Crie branch hotfix
git checkout -b hotfix/correcao-urgente

# 2. Corrija
# ... código ...

# 3. Commit, push e merge imediato
git add .
git commit -m "hotfix: correção urgente"
git push origin hotfix/correcao-urgente
# Merge imediato na main
```

## 🔧 Estrutura de Branches Recomendada

```
main (produção)
  ├── develop (desenvolvimento)
  ├── feature/* (novas funcionalidades)
  ├── fix/* (correções)
  └── hotfix/* (correções urgentes)
```

## 📝 Convenções de Commit

Use commits descritivos seguindo o padrão:

```
tipo: descrição curta

Descrição mais detalhada (opcional)

Exemplos:
- feat: adiciona sistema de blindagens
- fix: corrige conexão com Evolution API
- refactor: melhora estrutura de rotas
- docs: atualiza documentação
- style: ajusta formatação
```

**Tipos comuns:**
- `feat`: Nova funcionalidade
- `fix`: Correção de bug
- `refactor`: Refatoração de código
- `docs`: Documentação
- `style`: Formatação
- `test`: Testes
- `chore`: Tarefas de manutenção

## 🚨 Checklist Antes de Fazer Push

Antes de fazer push para o GitHub, verifique:

- [ ] Código testado localmente
- [ ] Sem erros de lint/TypeScript
- [ ] Variáveis sensíveis não estão no código (use `.env`)
- [ ] `.env` está no `.gitignore`
- [ ] Commit descritivo e claro
- [ ] Código comentado quando necessário

## 🔍 Monitoramento e Logs

### No EasyPanel:

1. **Logs em Tempo Real**
   - Acesse o projeto no EasyPanel
   - Clique em "Logs"
   - Veja logs do backend, frontend e banco

2. **Status dos Containers**
   - Verifique se todos os containers estão rodando
   - Backend: porta 3001
   - Frontend: porta 3000
   - PostgreSQL: porta 5432 (interno)

3. **Métricas**
   - CPU e memória de cada container
   - Uso de disco
   - Tráfego de rede

## 🐛 Troubleshooting

### Deploy Falhou

1. **Verifique os logs no EasyPanel**
   - Procure por erros de build
   - Verifique se as variáveis de ambiente estão corretas

2. **Verifique o código no GitHub**
   - Certifique-se de que o código está correto
   - Verifique se não há erros de sintaxe

3. **Teste localmente primeiro**
   - Sempre teste localmente antes de fazer push

### Container Não Inicia

1. **Verifique variáveis de ambiente**
   - Todas as variáveis necessárias estão configuradas?
   - Valores estão corretos?

2. **Verifique dependências**
   - `package.json` está atualizado?
   - Dockerfiles estão corretos?

3. **Verifique logs**
   - Logs do EasyPanel mostram o erro específico

## 📊 Fluxo Visual

```
┌─────────────────┐
│  Desenvolvimento│
│     Local       │
└────────┬────────┘
         │
         │ git push
         ▼
┌─────────────────┐
│     GitHub      │
│   (Repositório) │
└────────┬────────┘
         │
         │ Webhook/Integração
         ▼
┌─────────────────┐
│    EasyPanel    │
│  (Build & Deploy)│
└────────┬────────┘
         │
         │ Deploy Automático
         ▼
┌─────────────────┐
│   Produção      │
│  (Aplicação)    │
└─────────────────┘
```

## 🎯 Vantagens Desta Metodologia

✅ **Versionamento**: Todo código versionado no GitHub  
✅ **Histórico**: Fácil ver o que mudou e quando  
✅ **Rollback**: Fácil voltar para versão anterior  
✅ **Colaboração**: Múltiplos desenvolvedores podem trabalhar  
✅ **Deploy Automático**: Menos trabalho manual  
✅ **Backup**: Código seguro no GitHub  
✅ **CI/CD**: Integração contínua facilitada  

## 📞 Suporte

Se tiver dúvidas sobre:
- **Git/GitHub**: Consulte a [documentação do GitHub](https://docs.github.com)
- **EasyPanel**: Consulte a [documentação do EasyPanel](https://easypanel.io/docs)
- **Projeto**: Abra uma issue no repositório

## 🔄 Atualizações Futuras

Esta metodologia pode ser expandida com:
- GitHub Actions para testes automáticos
- Deploy em múltiplos ambientes (dev, staging, prod)
- Notificações de deploy (Slack, Discord, etc.)
- Monitoramento avançado

---

**Última atualização**: Janeiro 2025  
**Versão**: 1.0
