# Frontend - Sistema de Devocionais

## 🚀 Estrutura Base Implementada

### ✅ O que foi criado:

1. **Autenticação**
   - Login/Logout
   - Proteção de rotas
   - Store de autenticação (Zustand)

2. **Layout**
   - Sidebar com navegação
   - Topbar com título
   - Layout responsivo

3. **Dashboard**
   - Estatísticas em tempo real
   - Cards de métricas
   - Status de instâncias
   - Métricas de blindagem

4. **API Service**
   - Integração completa com backend
   - Interceptors para token
   - Tratamento de erros

5. **Tipos TypeScript**
   - Tipos para todas as entidades
   - Interfaces completas

## 📦 Instalação

```bash
cd frontend
npm install
```

## 🏃 Executar

```bash
npm run dev
```

O frontend estará disponível em `http://localhost:3000`

## 🔧 Configuração

Crie um arquivo `.env` na pasta `frontend`:

```env
VITE_API_URL=http://localhost:8000/api
```

## 📁 Estrutura de Pastas

```
frontend/src/
├── components/
│   ├── Layout/
│   │   ├── Layout.tsx
│   │   └── Layout.css
│   └── ProtectedRoute.tsx
├── pages/
│   ├── Login/
│   │   ├── Login.tsx
│   │   └── Login.css
│   └── Dashboard/
│       ├── Dashboard.tsx
│       └── Dashboard.css
├── services/
│   └── api.ts
├── store/
│   └── authStore.ts
├── types/
│   └── index.ts
├── App.tsx
├── App.css
├── main.tsx
└── index.css
```

## 🎯 Próximos Passos

- [ ] Página de Devocionais (Lista/Criar/Editar)
- [ ] Página de Contatos (CRUD completo)
- [ ] Página de Envios (Manual/Histórico)
- [ ] Página de Configurações
- [ ] Componentes reutilizáveis (Button, Input, Card, etc)

