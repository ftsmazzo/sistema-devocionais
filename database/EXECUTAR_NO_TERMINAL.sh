#!/bin/bash
# Execute este comando NO TERMINAL do EasyPanel (não precisa criar arquivo)

python3 << 'PYEOF'
import bcrypt
import sys

password = "admin123"
email = "fredmazzo@gmail.com"
name = "Administrador"

try:
    # Gerar hash bcrypt
    hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt(12))
    hashed_str = hashed.decode('utf-8')
    
    print("=" * 80)
    print("SQL PARA CRIAR USUÁRIO ADMIN")
    print("=" * 80)
    print()
    print("-- Execute este SQL no SQL Editor do PostgreSQL:")
    print()
    print(f"DELETE FROM users WHERE email = '{email}';")
    print()
    print("INSERT INTO users (email, name, hashed_password, is_active, is_admin, created_at, updated_at)")
    print("VALUES (")
    print(f"    '{email}',")
    print(f"    '{name}',")
    print(f"    '{hashed_str}',")
    print("    true,")
    print("    true,")
    print("    NOW(),")
    print("    NOW()")
    print(");")
    print()
    print(f"SELECT id, email, name, is_admin, is_active FROM users WHERE email = '{email}';")
    print()
    print("=" * 80)
    print("CREDENCIAIS:")
    print(f"Email: {email}")
    print(f"Senha: {password}")
    print("=" * 80)
    
except ImportError:
    print("ERRO: bcrypt não está instalado")
    print("Execute: pip install bcrypt")
    sys.exit(1)
except Exception as e:
    print(f"ERRO: {e}")
    sys.exit(1)
PYEOF

