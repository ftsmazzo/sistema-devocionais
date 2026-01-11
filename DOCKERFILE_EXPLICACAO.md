# 🐳 Dockerfile Multi-Stage Build

## 📋 O Que Mudou?

O Dockerfile agora faz **build automático do frontend durante o deploy**, igual aos seus outros projetos!

---

## 🔄 Como Funciona

### **Stage 1: Build do Frontend**
```dockerfile
FROM node:18-alpine AS frontend-builder
```
- Usa Node.js para fazer build do frontend
- Instala dependências npm
- Executa `npm run build`
- Gera a pasta `dist` com arquivos estáticos

### **Stage 2: Backend Python**
```dockerfile
FROM python:3.11-slim
```
- Usa Python para o backend
- Copia o frontend buildado do Stage 1
- Serve tudo junto

---

## ✅ Vantagens

1. **Não precisa Node.js local** - Build acontece no servidor
2. **Automático** - EasyPanel faz tudo sozinho
3. **Consistente** - Mesmo processo dos outros projetos
4. **Produção-ready** - Frontend sempre atualizado

---

## 🚀 Como Funciona no EasyPanel

1. **EasyPanel detecta o Dockerfile**
2. **Faz build do Stage 1** (Node.js + Frontend)
3. **Faz build do Stage 2** (Python + Backend)
4. **Copia frontend buildado** para dentro do container
5. **Deploy automático** ✅

---

## 📝 Estrutura Final no Container

```
/app/
  ├── app/              # Código Python
  ├── dist/             # Frontend buildado (copiado do Stage 1)
  │   ├── index.html
  │   └── assets/
  ├── main.py
  └── requirements.txt
```

---

## 🎯 Resultado

Quando você fizer **deploy no EasyPanel**:
- ✅ Frontend será buildado automaticamente
- ✅ Não precisa fazer build local
- ✅ Não precisa commitar `backend/dist`
- ✅ Tudo funciona igual aos outros projetos!

---

**Agora está igual aos seus outros projetos!** 🎉

