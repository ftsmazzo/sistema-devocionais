# 🚀 Guia de Deploy no EasyPanel via GitHub

Este guia explica como fazer o deploy do Evolution Manager no EasyPanel usando integração com GitHub.

> 📚 **Para entender a metodologia completa de trabalho**, consulte o arquivo [METODOLOGIA.md](./METODOLOGIA.md)

## 📋 Pré-requisitos

- Conta no EasyPanel
- Repositório no GitHub: `https://github.com/ftsmazzo/sistema-devocionais`
- Evolution API configurada e acessível
- PostgreSQL (pode usar o serviço do EasyPanel)

## 🔧 Configuração Inicial no EasyPanel

### 1. Conectar GitHub ao EasyPanel

1. Acesse seu painel EasyPanel
2. Clique em **"New Project"** ou **"Criar Projeto"**
3. Selecione **"GitHub"** como fonte do projeto
4. Autorize o EasyPanel a acessar sua conta GitHub
   - Você será redirecionado para GitHub
   - Autorize o acesso ao repositório
5. Selecione o repositório: `ftsmazzo/sistema-devocionais`
6. Selecione a branch: `main` (ou `master`)

### 2. Configurar Tipo de Projeto

1. O EasyPanel detectará automaticamente o arquivo `docker-compose.yml`
2. Selecione **"Docker Compose"** como tipo de projeto
3. O EasyPanel carregará automaticamente o `docker-compose.yml` do repositório

### 3. Configurar Variáveis de Ambiente

No painel do EasyPanel, vá em **"Environment Variables"** e adicione:

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
- Use senhas fortes e únicas
- Não compartilhe essas variáveis
- O EasyPanel mantém essas variáveis seguras

### 4. Configurar Auto Deploy (Recomendado)

1. No projeto, vá em **"Settings"** ou **"Configurações"**
2. Ative **"Auto Deploy"** ou **"Deploy Automático"**
3. Configure:
   - **Branch**: `main`
   - **Trigger**: `On Push` (a cada push)
   - **Build**: `Always` (sempre fazer build)

**Alternativas:**
- **Manual**: Deploy apenas quando você clicar
- **On Tag**: Deploy apenas quando criar uma tag (recomendado para produção)

### 5. Configurar Portas

No EasyPanel, configure as portas expostas:

- **Frontend**: `3000` → `80` (interno do container)
- **Backend**: `3001` → `3001`
- **PostgreSQL**: `5432` (apenas interno, não expor)

### 6. Primeiro Deploy

1. Clique em **"Deploy"** ou **"Deploy Now"**
2. O EasyPanel irá:
   - Clonar o repositório do GitHub
   - Fazer build das imagens Docker
   - Iniciar os containers
3. Aguarde alguns minutos (primeira vez pode levar mais tempo)
4. Verifique os logs para garantir que tudo está funcionando

## 🔄 Fluxo de Trabalho Contínuo

Após a configuração inicial, o fluxo é simples:

### Desenvolvimento → Deploy Automático

```bash
# 1. Desenvolva localmente
git checkout -b feature/nova-funcionalidade
# ... faça suas alterações ...

# 2. Commit e push
git add .
git commit -m "feat: nova funcionalidade"
git push origin feature/nova-funcionalidade

# 3. Merge na main (via Pull Request ou direto)
git checkout main
git merge feature/nova-funcionalidade
git push origin main

# 4. EasyPanel detecta o push e faz deploy automático! 🚀
```

### Deploy Manual (se Auto Deploy estiver desativado)

1. No EasyPanel, vá no projeto
2. Clique em **"Deploy"** ou **"Redeploy"**
3. Aguarde o build e deploy

## 🔍 Verificação

Após o deploy:

1. Acesse a URL do seu projeto no EasyPanel (ex: `http://seu-dominio:3000`)
2. Faça login com as credenciais do admin configuradas
3. Adicione sua primeira instância do Evolution API
4. Teste conectar/desconectar uma instância

## 🐛 Troubleshooting

### Erro de conexão com banco de dados

- Verifique se o PostgreSQL está rodando
- Confirme as credenciais no `.env`
- Verifique se a rede Docker está configurada corretamente

### Erro ao conectar instância

- Verifique se a URL do Evolution API está correta
- Confirme se a API Key está válida
- Verifique os logs do backend para mais detalhes

### Frontend não carrega

- Verifique se o build foi concluído com sucesso
- Confirme se a variável `VITE_API_URL` está correta
- Verifique os logs do container do frontend

## 📝 Notas Importantes

- ✅ O primeiro usuário admin é criado automaticamente na primeira inicialização
- ✅ Altere as senhas padrão em produção
- ✅ Use HTTPS em produção (configure no EasyPanel)
- ✅ Configure backups regulares do banco de dados
- ✅ O código no GitHub é a fonte da verdade - sempre atualize lá primeiro
- ✅ Use branches para features e merge na main para deploy
- ✅ Verifique os logs no EasyPanel se algo der errado

## 🔗 Links Úteis

- [Metodologia Completa](./METODOLOGIA.md) - Fluxo de trabalho detalhado
- [README Principal](./README.md) - Documentação do projeto
- [Repositório GitHub](https://github.com/ftsmazzo/sistema-devocionais)

## 🆘 Suporte

Se tiver problemas:

1. **Verifique os logs no EasyPanel** - Geralmente mostram o erro específico
2. **Teste localmente primeiro** - Sempre teste antes de fazer push
3. **Verifique variáveis de ambiente** - Certifique-se de que estão todas configuradas
4. **Consulte a metodologia** - [METODOLOGIA.md](./METODOLOGIA.md) tem mais detalhes
