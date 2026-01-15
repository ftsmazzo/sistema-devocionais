# ⚡ Quick Start - Configuração Rápida

Guia rápido para começar a trabalhar com o projeto.

## 🎯 Para Desenvolvedores

### 1. Clone o Repositório

```bash
git clone https://github.com/ftsmazzo/sistema-devocionais.git
cd sistema-devocionais
```

### 2. Configure o Backend

```bash
cd backend
npm install

# Copie e configure o .env
# (Crie um arquivo .env baseado nas variáveis necessárias)
```

### 3. Configure o Frontend

```bash
cd frontend
npm install

# Crie um arquivo .env com:
# VITE_API_URL=http://localhost:3001
```

### 4. Inicie o Desenvolvimento

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

### 5. Acesse a Aplicação

- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- Login padrão: Verifique o `.env` do backend

## 🚀 Para Deploy no EasyPanel

### Configuração Inicial (Uma vez)

1. **Conecte GitHub ao EasyPanel**
   - Acesse EasyPanel → New Project → GitHub
   - Autorize e selecione: `ftsmazzo/sistema-devocionais`
   - Branch: `main`

2. **Configure Variáveis de Ambiente**
   - No EasyPanel, adicione todas as variáveis necessárias
   - Veja lista completa em [DEPLOY.md](./DEPLOY.md)

3. **Ative Auto Deploy**
   - Settings → Auto Deploy → On Push

4. **Primeiro Deploy**
   - Clique em "Deploy"
   - Aguarde alguns minutos

### Trabalho Diário

```bash
# 1. Desenvolva
git checkout -b feature/nova-funcionalidade
# ... código ...

# 2. Commit e push
git add .
git commit -m "feat: nova funcionalidade"
git push origin feature/nova-funcionalidade

# 3. Merge na main
git checkout main
git merge feature/nova-funcionalidade
git push origin main

# 4. EasyPanel faz deploy automático! 🎉
```

## 📚 Documentação Completa

- **[METODOLOGIA.md](./METODOLOGIA.md)** - Metodologia detalhada
- **[DEPLOY.md](./DEPLOY.md)** - Guia completo de deploy
- **[README.md](./README.md)** - Documentação principal

## 🆘 Problemas?

1. Verifique os logs no EasyPanel
2. Teste localmente primeiro
3. Consulte a documentação completa
4. Abra uma issue no GitHub
