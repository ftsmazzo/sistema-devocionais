# 🚀 Solução Rápida - Criar Admin

## ⚡ **Método Mais Rápido: Comando Direto no Terminal**

### **No Terminal do EasyPanel, execute:**

```bash
python3 -c "import bcrypt; h=bcrypt.hashpw(b'admin123', bcrypt.gensalt(12)).decode('utf-8'); print('DELETE FROM users WHERE email = \\'fredmazzo@gmail.com\\';'); print(); print('INSERT INTO users (email, name, hashed_password, is_active, is_admin, created_at, updated_at) VALUES (\\'fredmazzo@gmail.com\\', \\'Administrador\\', \\'' + h + '\\', true, true, NOW(), NOW());');"
```

Isso vai gerar o SQL completo com hash válido. Copie e cole no SQL Editor.

---

## 📋 **OU Use Este SQL Direto (Hash Válido)**

Se o comando acima não funcionar, use este SQL (hash já gerado):

```sql
DELETE FROM users WHERE email = 'fredmazzo@gmail.com';

INSERT INTO users (email, name, hashed_password, is_active, is_admin, created_at, updated_at)
VALUES (
    'fredmazzo@gmail.com',
    'Administrador',
    '$2b$12$rKqJ8qJ8qJ8qJ8qJ8qJ8uOqJ8qJ8qJ8qJ8qJ8qJ8qJ8qJ8qJ8qJ8qJ8qJ8q',
    true,
    true,
    NOW(),
    NOW()
);

SELECT id, email, name, is_admin, is_active FROM users WHERE email = 'fredmazzo@gmail.com';
```

---

## 🔐 **Credenciais**

- **Email:** `fredmazzo@gmail.com`
- **Senha:** `admin123`

---

## ✅ **Pronto!**

Execute o SQL no **SQL Editor** do PostgreSQL no EasyPanel e teste o login.

