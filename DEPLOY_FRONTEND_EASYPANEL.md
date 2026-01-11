# 🚀 Deploy do Frontend no EasyPanel

## 📋 Opções de Deploy

### **Opção 1: Frontend Separado (Recomendado)**

Criar um aplicativo separado no EasyPanel para o frontend:

1. **Criar novo aplicativo no EasyPanel:**
   - Tipo: Node.js
   - Framework: Vite
   - Build Command: `npm run build`
   - Start Command: `npm run preview` (ou servir estático)

2. **Configurar variáveis de ambiente:**
   ```env
   VITE_API_URL=https://imobmiq-devocional.90qhxz.easypanel.host
   ```

3. **Build e Deploy:**
   - EasyPanel fará build automaticamente
   - Frontend será servido em domínio separado

---

### **Opção 2: Frontend Integrado com Backend (Atual)**

Servir frontend buildado junto com o backend FastAPI:

#### **Passo 1: Build do Frontend Localmente**

```bash
cd frontend
npm install
npm run build
```

Isso criará a pasta `frontend/dist` com os arquivos estáticos.

#### **Passo 2: Copiar para o Backend**

Copie a pasta `dist` para dentro do backend:

```bash
# Estrutura final:
backend/
  ├── app/
  ├── dist/          # ← Frontend buildado aqui
  │   ├── index.html
  │   ├── assets/
  │   └── ...
  └── main.py
```

#### **Passo 3: Atualizar Dockerfile (se usar)**

Adicione ao Dockerfile:

```dockerfile
# Copiar frontend buildado
COPY frontend/dist /app/dist
```

#### **Passo 4: Deploy**

O backend já está configurado para servir o frontend automaticamente!

---

### **Opção 3: Usar Nginx (Avançado)**

Configurar Nginx para servir frontend e proxy para backend:

```nginx
server {
    listen 80;
    server_name seu-dominio.com;

    # Frontend
    location / {
        root /app/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 🎯 Recomendação

**Para desenvolvimento/teste:** Opção 2 (integrado)

**Para produção:** Opção 1 (separado) ou Opção 3 (Nginx)

---

## 📝 Passo a Passo Rápido (Opção 2)

1. **Build local:**
   ```bash
   cd frontend
   npm install
   npm run build
   ```

2. **Copiar dist para backend:**
   ```bash
   cp -r frontend/dist backend/
   ```

3. **Commit e push:**
   ```bash
   git add backend/dist
   git commit -m "feat: Adicionar build do frontend"
   git push
   ```

4. **Deploy no EasyPanel:**
   - EasyPanel fará pull do GitHub
   - Backend servirá frontend automaticamente

---

## ✅ Verificação

Após deploy, acesse:
- `https://imobmiq-devocional.90qhxz.easypanel.host/` → Deve mostrar login
- `https://imobmiq-devocional.90qhxz.easypanel.host/api/status` → Status da API

---

**Pronto para fazer o build e deploy!** 🚀

