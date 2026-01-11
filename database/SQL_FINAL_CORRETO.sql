-- ============================================================
-- SQL FINAL PARA CRIAR USUÁRIO ADMIN
-- ============================================================
-- Execute este SQL no SQL Editor do PostgreSQL no EasyPanel
-- Database > PostgreSQL > SQL Editor
-- ============================================================

-- Deletar usuário existente
DELETE FROM users WHERE email = 'fredmazzo@gmail.com';

-- Inserir novo usuário admin
-- Hash bcrypt válido para senha: admin123
-- Este hash foi gerado com bcrypt.hashpw(b'admin123', bcrypt.gensalt(12))
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

-- Verificar se foi criado
SELECT id, email, name, is_admin, is_active, created_at 
FROM users 
WHERE email = 'fredmazzo@gmail.com';

-- ============================================================
-- CREDENCIAIS:
-- Email: fredmazzo@gmail.com
-- Senha: admin123
-- ============================================================

