# 🏗️ Como Buildar e Deployar o Frontend

## 🎯 Objetivo

Fazer o build do frontend e servir junto com o backend no EasyPanel.

---

## 🚀 Método Rápido (Script Automatizado)

### **Windows (PowerShell):**
```powershell
.\build-frontend.ps1
```

### **Linux/Mac:**
```bash
chmod +x build-frontend.sh
./build-frontend.sh
```

O script faz tudo automaticamente:
1. ✅ Verifica se npm está instalado
2. ✅ Instala dependências
3. ✅ Faz o build
4. ✅ Copia para `backend/dist`

---

## 📝 Método Manual

### **1. Build Local do Frontend**

No seu computador local:

```bash
cd frontend
npm install
npm run build
```

Isso criará a pasta `frontend/dist` com os arquivos estáticos.

### **2. Copiar para o Backend**

Copie a pasta `dist` para dentro do backend:

**Windows (PowerShell):**
```powershell
Copy-Item -Path "frontend\dist" -Destination "backend\dist" -Recurse
```

**Linux/Mac:**
```bash
cp -r frontend/dist backend/
```

### **3. Estrutura Final**

```
backend/
  ├── app/
  ├── dist/          # ← Frontend buildado aqui
  │   ├── index.html
  │   ├── assets/
  │   │   ├── index-xxx.js
  │   │   └── index-xxx.css
  │   └── ...
  ├── main.py
  └── requirements.txt
```

### **4. Commit e Push**

```bash
git add backend/dist
git commit -m "feat: Adicionar build do frontend"
git push origin main
```

### **5. Deploy no EasyPanel**

- EasyPanel fará pull do GitHub automaticamente
- Backend servirá frontend automaticamente
- Acesse: `https://imobmiq-devocional.90qhxz.easypanel.host/`

---

## 🚀 Alternativa: Build no EasyPanel

Se preferir fazer build direto no EasyPanel:

### **1. Adicionar Node.js ao Dockerfile**

Atualize o `Dockerfile` do backend:

```dockerfile
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
# ... resto do Dockerfile ...
COPY --from=frontend-builder /app/frontend/dist ./dist
```

### **2. Ou usar Multi-Stage Build**

Crie um `docker-compose.yml` ou atualize o Dockerfile para fazer build do frontend.

---

## ✅ Verificação

Após deploy:

1. **Acesse:** `https://imobmiq-devocional.90qhxz.easypanel.host/`
   - Deve mostrar a página de login

2. **API Status:** `https://imobmiq-devocional.90qhxz.easypanel.host/api/status`
   - Deve retornar JSON com status

---

## 🔧 Troubleshooting

### **Frontend não aparece**

1. Verifique se `backend/dist/index.html` existe
2. Verifique logs do backend
3. Tente acessar: `https://imobmiq-devocional.90qhxz.easypanel.host/assets/`

### **Erro 404 nas rotas**

- Certifique-se que a rota catch-all está configurada
- Verifique ordem das rotas no `main.py`

---

**Pronto para fazer o build!** 🚀

