# Sistema Devocional Diário + Evolution API

Sistema web para **Evolution API** (WhatsApp), disparos, blindagens, contatos e **devocionais diários** com geração interna (Gemini) e disparo agendado no backend.

## Documentação de devocional / IA

- **[docs/DEVOCIONAL-IA.md](./docs/DEVOCIONAL-IA.md)** — Jornada Bíblica, jornadas, variáveis de ambiente, webhook opcional e segurança da ingestão.

## Funcionalidades principais

- Interface React (Vite + TypeScript) e API Express + PostgreSQL
- Instâncias Evolution, listas, tags, disparos (marketing e devocional)
- **Jornada Bíblica**: motor Gemini global, múltiplas jornadas, geração por data e devocional gravado em `devocionais`
- Configuração de horário de envio do devocional e lista alvo (**Config. Devocional**)
- Autenticação JWT; chave Gemini no banco ou `GEMINI_API_KEY`

### Segurança (devocional)

- Defina **`DEVOCIONAL_WEBHOOK_SECRET`** em produção para a rota `POST /api/devocional/webhook`.
- Texto e título ingeridos passam por **sanitização e limites de tamanho** antes de persistir.

## 🛠️ Stack Tecnológica

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express + TypeScript
- **Banco de Dados**: PostgreSQL
- **Autenticação**: JWT (JSON Web Tokens)
- **API**: Evolution API REST
- **Deploy**: Docker + EasyPanel

## 📦 Instalação Local

### Pré-requisitos
- Node.js 18+
- PostgreSQL 14+ (ou Docker)
- Evolution API configurada

### Passo a Passo

1. **Clone o repositório**
```bash
git clone <seu-repositorio>
cd Devocionais
```

2. **Configure o Backend**
```bash
cd backend
npm install
cp .env.example .env
# Edite o .env com suas configurações
npm run dev
```

3. **Configure o Frontend**
```bash
cd frontend
npm install
# Crie um arquivo .env com VITE_API_URL=http://localhost:3001
npm run dev
```

4. **Acesse a aplicação**
- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- Login padrão: Verifique o `.env` do backend

## 🐳 Deploy no EasyPanel via GitHub

Este projeto usa **GitHub como repositório principal** e **EasyPanel para deploy automático**.

### 📚 Documentação Completa:
- **[docs/DEVOCIONAL-IA.md](./docs/DEVOCIONAL-IA.md)** — Devocional, Gemini, jornadas e webhook
- **[METODOLOGIA.md](./METODOLOGIA.md)** - Metodologia completa de trabalho (GitHub + EasyPanel)
- **[DEPLOY.md](./DEPLOY.md)** - Guia passo a passo de configuração inicial

### Resumo Rápido:
1. **Conecte o GitHub ao EasyPanel** - Autorize acesso ao repositório
2. **Configure variáveis de ambiente** - No painel do EasyPanel
3. **Ative Auto Deploy** - Deploy automático a cada push na `main`
4. **Faça push para GitHub** - O EasyPanel fará o deploy automaticamente! 🚀

### Fluxo de Trabalho:
```
Desenvolvimento Local → Push GitHub → Deploy Automático EasyPanel
```

## 📝 Estrutura do Projeto

```
.
├── frontend/              # Aplicação React
│   ├── src/
│   │   ├── components/    # Componentes UI
│   │   ├── pages/         # Páginas da aplicação
│   │   ├── lib/           # Utilitários e API
│   │   └── store/         # Estado global (Zustand)
│   ├── Dockerfile
│   └── package.json
├── backend/               # API Express
│   ├── src/
│   │   ├── routes/        # Rotas da API
│   │   ├── middleware/    # Middlewares
│   │   ├── database/      # Configuração do banco
│   │   └── index.ts       # Entry point
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
├── docs/                  # Documentação (ex.: DEVOCIONAL-IA.md)
├── README.md
└── DEPLOY.md              # Guia de deploy
```

## 🔐 Variáveis de Ambiente

### Backend (.env)
```env
PORT=3001
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
JWT_SECRET=sua-chave-secreta
JWT_EXPIRES_IN=7d
GEMINI_API_KEY=
DEVOCIONAL_WEBHOOK_SECRET=altere-em-producao
ADMIN_NOME=
EXTERNAL_WEBHOOK_PROFILE_PICTURE_URL=
EVOLUTION_API_URL=http://localhost:8080
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123
```

### Frontend (.env)
```env
VITE_API_URL=http://localhost:3001
```

## 🔌 Integração com Evolution API

O sistema se integra com o Evolution API através de:

- **Criar Instância**: `POST /instance/create`
- **Deletar Instância**: `DELETE /instance/delete/:name`
- **Verificar Status**: `GET /instance/fetchInstances`
- **Enviar Mensagem**: `POST /message/sendText/:instance`

## 🎨 Interface

A interface foi desenvolvida com foco em:
- Design moderno e limpo
- Responsividade (mobile-first)
- Experiência do usuário fluida
- Feedback visual claro
- Animações suaves

## 🔒 Segurança

- Autenticação JWT
- Senhas hasheadas com bcrypt
- Validação de dados no backend
- Proteção de rotas no frontend
- CORS configurado

## 📄 Licença

MIT

## 🤝 Contribuindo

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📞 Suporte

Para dúvidas ou problemas, abra uma issue no repositório.
