"""
Script para criar usuário admin inicial
Execute: python database/create_admin_user.py
"""
import sys
import os

# Adicionar diretório raiz ao path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.database import SessionLocal, User
from app.auth import get_password_hash
from dotenv import load_dotenv

load_dotenv()


def create_admin_user():
    """Cria usuário admin inicial"""
    db = SessionLocal()
    
    try:
        # Verificar se já existe admin
        existing_admin = db.query(User).filter(User.is_admin == True).first()
        if existing_admin:
            print(f"❌ Já existe um usuário admin: {existing_admin.email}")
            return
        
        # Dados do admin
        email = input("Email do administrador: ").strip()
        if not email:
            print("❌ Email não pode estar vazio")
            return
        
        name = input("Nome do administrador: ").strip()
        if not name:
            print("❌ Nome não pode estar vazio")
            return
        
        password = input("Senha: ").strip()
        if not password or len(password) < 6:
            print("❌ Senha deve ter pelo menos 6 caracteres")
            return
        
        # Verificar se email já existe
        existing_user = db.query(User).filter(User.email == email).first()
        if existing_user:
            print(f"❌ Email {email} já está cadastrado")
            return
        
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
        print(f"   Nome: {admin_user.name}")
        print(f"   ID: {admin_user.id}")
        
    except Exception as e:
        db.rollback()
        print(f"❌ Erro ao criar usuário admin: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    print("=" * 50)
    print("Criação de Usuário Administrador")
    print("=" * 50)
    create_admin_user()

