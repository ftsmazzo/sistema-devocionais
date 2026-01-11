# 🚀 Como Criar Usuário Admin via SQL Direto

## ⚠️ Problema Resolvido

O endpoint `/api/auth/setup-initial-admin` estava dando erro porque o bcrypt tem limite de 72 bytes para senhas. Agora há validação, mas você pode criar o usuário diretamente via SQL.

---

## 📋 **Método 1: SQL Direto (RECOMENDADO)**

### **Passo 1: Acessar o Banco no EasyPanel**

1. No EasyPanel, vá em **Database** > **PostgreSQL**
2. Clique em **SQL Editor** ou **Terminal**
3. Selecione o banco `devocional`

### **Passo 2: Executar o SQL**

Copie e cole este SQL:

```sql
-- Deletar usuário existente (se houver)
DELETE FROM users WHERE email = 'fredmazzo@gmail.com';

-- Inserir novo usuário admin
INSERT INTO users (email, name, hashed_password, is_active, is_admin, created_at, updated_at)
VALUES (
    'fredmazzo@gmail.com',
    'Administrador',
    '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW',
    true,
    true,
    NOW(),
    NOW()
);

-- Verificar se foi criado
SELECT id, email, name, is_admin, is_active, created_at 
FROM users 
WHERE email = 'fredmazzo@gmail.com';
```

### **Passo 3: Testar Login**

- **Email:** `fredmazzo@gmail.com`
- **Senha:** `admin123`

---

## 📄 **Arquivo SQL Completo**

O arquivo `database/CRIAR_ADMIN_SQL_DIRETO.sql` contém o SQL completo e está pronto para uso.

---

## 🔧 **Método 2: Via Endpoint (Agora com Validação)**

O endpoint agora valida o comprimento da senha:

**URL:** `https://imobmiq-devocional.90qhxz.easypanel.host/api/auth/setup-initial-admin`

**Método:** `POST`

**Body:**
```json
{
  "email": "fredmazzo@gmail.com",
  "password": "admin123"
}
```

**⚠️ IMPORTANTE:** A senha deve ter no máximo 72 bytes (caracteres UTF-8).

---

## ✅ **Verificação**

Após executar o SQL, você deve ver:

```
 id |         email          |     name      | is_admin | is_active |         created_at
----+------------------------+---------------+----------+-----------+----------------------------
  1 | fredmazzo@gmail.com    | Administrador | t        | t         | 2026-01-10 22:15:00
```

---

## 🎯 **Pronto!**

Agora você pode fazer login no frontend com:
- **Email:** `fredmazzo@gmail.com`
- **Senha:** `admin123`

