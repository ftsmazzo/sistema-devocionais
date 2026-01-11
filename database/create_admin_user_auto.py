"""
Script para criar usuário admin automaticamente
Use este script para criar admin sem interação
Execute: python database/create_admin_user_auto.py
"""
import sys
import os

# Adicionar diretório raiz ao path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.database import SessionLocal, User
from app.auth import get_password_hash
from dotenv import load_dotenv

load_dotenv()


def create_admin_user_auto(
    email: str = "admin@devocional.com",
    password: str = "admin123",
    name: str = "Administrador"
):
    """Cria usuário admin automaticamente"""
    db = SessionLocal()
    
    try:
        # Verificar se já existe admin
        existing_admin = db.query(User).filter(User.is_admin == True).first()
        if existing_admin:
            print(f"ℹ️  Já existe um usuário admin: {existing_admin.email}")
            return existing_admin
        
        # Verificar se email já existe
        existing_user = db.query(User).filter(User.email == email).first()
        if existing_user:
            print(f"ℹ️  Email {email} já está cadastrado")
            # Tornar admin se não for
            if not existing_user.is_admin:
                existing_user.is_admin = True
                db.commit()
                print(f"✅ Usuário {email} promovido a administrador")
            return existing_user
        
        # Criar usuário admin
        hashed_password = get_password_hash(password)
        admin_user = User(
            email=email,
            name=name,
            hashed_password=hashed_password,
            is_admin=True,
            is_active=True
        )
        
        db.add(admin_user)
        db.commit()
        db.refresh(admin_user)
        
        print(f"✅ Usuário admin criado com sucesso!")
        print(f"   Email: {admin_user.email}")
        print(f"   Senha: {password}")
        print(f"   Nome: {admin_user.name}")
        print(f"   ID: {admin_user.id}")
        print(f"\n⚠️  IMPORTANTE: Altere a senha após o primeiro login!")
        
        return admin_user
        
    except Exception as e:
        db.rollback()
        print(f"❌ Erro ao criar usuário admin: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Criar usuário admin')
    parser.add_argument('--email', default='admin@devocional.com', help='Email do admin')
    parser.add_argument('--password', default='admin123', help='Senha do admin')
    parser.add_argument('--name', default='Administrador', help='Nome do admin')
    
    args = parser.parse_args()
    
    print("=" * 50)
    print("Criação Automática de Usuário Administrador")
    print("=" * 50)
    create_admin_user_auto(args.email, args.password, args.name)

