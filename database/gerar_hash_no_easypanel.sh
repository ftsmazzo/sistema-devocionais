#!/bin/bash
# Script para executar no terminal do EasyPanel
# Gera hash bcrypt e SQL para criar usuário admin

echo "Gerando hash bcrypt para senha: admin123"
echo ""

# Instalar bcrypt se não estiver instalado (pode dar erro, mas tenta)
pip install bcrypt 2>/dev/null || python -m pip install bcrypt 2>/dev/null || echo "bcrypt já instalado ou erro na instalação"

# Gerar hash
python3 << 'PYTHON_SCRIPT'
import bcrypt

password = "admin123"
hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt(12))
hashed_str = hashed.decode('utf-8')

print("=" * 80)
print("SQL PARA CRIAR USUÁRIO ADMIN")
print("=" * 80)
print()
print("-- Execute este SQL no PostgreSQL:")
print()
print("DELETE FROM users WHERE email = 'fredmazzo@gmail.com';")
print()
print("INSERT INTO users (email, name, hashed_password, is_active, is_admin, created_at, updated_at)")
print("VALUES (")
print("    'fredmazzo@gmail.com',")
print("    'Administrador',")
print(f"    '{hashed_str}',")
print("    true,")
print("    true,")
print("    NOW(),")
print("    NOW()")
print(");")
print()
print("SELECT id, email, name, is_admin, is_active FROM users WHERE email = 'fredmazzo@gmail.com';")
print()
print("=" * 80)
print("CREDENCIAIS:")
print("Email: fredmazzo@gmail.com")
print("Senha: admin123")
print("=" * 80)
PYTHON_SCRIPT

