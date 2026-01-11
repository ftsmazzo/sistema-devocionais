# 👤 Como Criar Usuário Admin - Passo a Passo

## 🚀 Método Rápido (Recomendado)

### 1. **Via EasyPanel (Terminal)**

1. Acesse o terminal do aplicativo no EasyPanel
2. Execute:

```bash
cd /app
python database/create_admin_user_auto.py
```

**Credenciais padrão criadas:**
- Email: `admin@devocional.com`
- Senha: `admin123`
- Nome: `Administrador`

### 2. **Com Credenciais Personalizadas**

```bash
cd /app
python database/create_admin_user_auto.py --email seu@email.com --password SuaSenha123 --name "Seu Nome"
```

---

## 📝 Método Interativo

Execute e preencha os dados:

```bash
cd /app
python database/create_admin_user.py
```

Siga as instruções na tela.

---

## 🗄️ Via SQL (Alternativo)

Se preferir criar diretamente no banco:

```sql
-- Hash da senha "admin123" (bcrypt)
-- Você pode gerar um novo hash executando em Python:
-- from app.auth import get_password_hash
-- print(get_password_hash("sua-senha"))

INSERT INTO users (email, name, hashed_password, is_admin, is_active)
VALUES (
  'admin@devocional.com',
  'Administrador',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYqJ5q5q5q5q',  -- admin123
  true,
  true
);
```

---

## ✅ Verificar se Funcionou

Teste o login via API:

```bash
curl -X POST https://imobmiq-devocional.90qhxz.easypanel.host/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@devocional.com",
    "password": "admin123"
  }'
```

Se retornar um token, está funcionando! ✅

---

## 🔒 IMPORTANTE

**⚠️ Altere a senha padrão após o primeiro login!**

Para criar mais usuários, use o endpoint (após fazer login como admin):

```bash
POST /api/auth/create-user
Authorization: Bearer <seu-token-admin>
{
  "email": "novo@usuario.com",
  "password": "senha123",
  "name": "Novo Usuário",
  "is_admin": false
}
```

