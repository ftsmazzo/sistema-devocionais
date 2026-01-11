# 🔐 Guia de Autenticação - Sistema de Devocionais

## ✅ IMPLEMENTAÇÃO COMPLETA

Sistema de autenticação JWT implementado com sucesso!

---

## 📋 O QUE FOI IMPLEMENTADO

### 1. **Modelo de Usuário**
- Tabela `users` no banco de dados
- Campos: email, name, hashed_password, is_active, is_admin
- Timestamps: created_at, updated_at, last_login

### 2. **Endpoints de Autenticação**
- `POST /api/auth/login` - Login (retorna token JWT)
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Informações do usuário atual
- `POST /api/auth/create-user` - Criar novo usuário (apenas admin)

### 3. **Segurança**
- Hash de senhas com bcrypt
- Tokens JWT com expiração configurável
- Proteção de rotas com dependências
- Validação de token em todas as requisições

---

## 🚀 CONFIGURAÇÃO INICIAL

### 1. **Adicionar JWT Secret no .env**

Adicione ao seu `.env`:

```env
JWT_SECRET_KEY=sua-chave-secreta-super-segura-aqui-mude-em-producao
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=10080  # 7 dias (padrão)
```

**⚠️ IMPORTANTE:** Use uma chave secreta forte em produção!

### 2. **Criar Tabela de Usuários**

Execute o script SQL:

```sql
-- Execute: database/create_users_table.sql
```

Ou via Python (cria automaticamente):

```python
from app.database import init_db
init_db()  # Cria todas as tabelas incluindo users
```

### 3. **Criar Usuário Admin Inicial**

**Opção 1: Automático (Recomendado)**
```bash
cd backend
python database/create_admin_user_auto.py
```

**Opção 2: Interativo**
```bash
cd backend
python database/create_admin_user_auto.py --email admin@devocional.com --password admin123 --name "Administrador"
```

**Opção 3: Manual (com input)**
```bash
cd backend
python database/create_admin_user.py
```

**Credenciais padrão (automático):**
- Email: `admin@devocional.com`
- Senha: `admin123`
- Nome: `Administrador`

**⚠️ IMPORTANTE:** Altere a senha após o primeiro login!

---

## 📝 USO DA API

### **Login**

```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@devocional.com",
  "password": "admin123",
  "remember": true
}
```

**Resposta:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "user": {
    "id": 1,
    "email": "admin@devocional.com",
    "name": "Administrador",
    "is_admin": true
  }
}
```

### **Usar Token**

Inclua o token no header de todas as requisições:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### **Obter Usuário Atual**

```bash
GET /api/auth/me
Authorization: Bearer <token>
```

**Resposta:**
```json
{
  "id": 1,
  "email": "admin@devocional.com",
  "name": "Administrador",
  "is_admin": true,
  "created_at": "2024-01-15T10:00:00",
  "last_login": "2024-01-15T10:30:00"
}
```

### **Criar Novo Usuário (Admin apenas)**

```bash
POST /api/auth/create-user
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "email": "usuario@devocional.com",
  "password": "senha123",
  "name": "Usuário Teste",
  "is_admin": false
}
```

---

## 🔒 PROTEGER ROTAS

Para proteger uma rota, use a dependência `get_current_active_user`:

```python
from app.auth import get_current_active_user
from app.database import User

@router.get("/protected")
async def protected_route(
    current_user: User = Depends(get_current_active_user)
):
    return {"message": f"Olá, {current_user.name}!"}
```

### **Exemplo: Proteger Rota de Estatísticas**

```python
@router.get("/stats")
async def get_stats(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    # Apenas usuários autenticados podem acessar
    stats = devocional_service.get_stats()
    return stats
```

---

## 🎯 INTEGRAÇÃO COM FRONTEND

O frontend já está preparado para usar a autenticação:

1. **Login:** `POST /api/auth/login`
2. **Armazenar token:** `localStorage.setItem('token', token)`
3. **Incluir em requisições:** Header `Authorization: Bearer <token>`
4. **Verificar usuário:** `GET /api/auth/me`
5. **Logout:** Remover token do localStorage

---

## ⚙️ CONFIGURAÇÕES

### **Variáveis de Ambiente**

```env
# Autenticação JWT
JWT_SECRET_KEY=sua-chave-secreta-super-segura
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=10080  # 7 dias
```

### **Valores Padrão**

- `JWT_SECRET_KEY`: `"change-this-secret-key-in-production"` (⚠️ MUDAR!)
- `JWT_ALGORITHM`: `"HS256"`
- `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`: `10080` (7 dias)

---

## 🔧 PRÓXIMOS PASSOS

1. ✅ **Criar tabela users** (execute SQL ou init_db)
2. ✅ **Criar usuário admin** (execute script Python)
3. ✅ **Adicionar JWT_SECRET_KEY no .env**
4. ✅ **Testar login via Postman/API**
5. ✅ **Proteger rotas sensíveis** (opcional)
6. ✅ **Testar integração com frontend**

---

## 📊 ESTRUTURA DO BANCO

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL
);
```

---

## ✅ TUDO PRONTO!

O sistema de autenticação está completo e pronto para uso!

**Próximo passo:** Criar usuário admin e testar login! 🚀

