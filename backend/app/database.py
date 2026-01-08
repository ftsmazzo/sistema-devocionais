"""
Configuração do banco de dados
"""
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
from app.config import settings

# Criar engine
engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
)

# Criar session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base para modelos
Base = declarative_base()


class NewsArticle(Base):
    """Modelo para artigos de notícias"""
    __tablename__ = "news_articles"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False, index=True)
    content = Column(Text)
    url = Column(String, unique=True, nullable=False, index=True)
    source = Column(String, nullable=False)
    published_date = Column(DateTime)
    scraped_date = Column(DateTime, default=datetime.utcnow)
    is_relevant = Column(Boolean, default=False, index=True)
    relevance_score = Column(Integer, default=0)
    processed = Column(Boolean, default=False)
    notified = Column(Boolean, default=False)
    scope = Column(String)  # Escopo de atuação identificado
    responsible_area = Column(String)  # Área responsável


class Notification(Base):
    """Modelo para notificações enviadas"""
    __tablename__ = "notifications"
    
    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, nullable=False, index=True)
    recipient_phone = Column(String, nullable=False)
    recipient_name = Column(String)
    sent_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String, default="pending")  # pending, sent, failed
    message = Column(Text)


class DevocionalEnvio(Base):
    """Modelo para registro de envios de devocionais"""
    __tablename__ = "devocional_envios"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Relacionamento
    devocional_id = Column(Integer, nullable=True, index=True)  # FK para devocionais
    recipient_phone = Column(String(20), nullable=False, index=True)
    recipient_name = Column(String(100))
    
    # Mensagem enviada
    message_text = Column(Text, nullable=False)  # Texto que foi enviado (pode ter personalização)
    
    # Status do envio
    status = Column(String(20), default="pending", index=True)  # pending, sent, failed, retrying, blocked
    message_id = Column(String(100))  # ID da mensagem na Evolution API
    error_message = Column(Text)  # Mensagem de erro (se houver)
    retry_count = Column(Integer, default=0)  # Número de tentativas
    
    # Timestamps
    sent_at = Column(DateTime, default=datetime.utcnow, index=True)
    scheduled_for = Column(DateTime, index=True)  # Para envios agendados


class DevocionalContato(Base):
    """Modelo para lista de contatos que recebem devocionais"""
    __tablename__ = "devocional_contatos"
    
    id = Column(Integer, primary_key=True, index=True)
    phone = Column(String(20), unique=True, nullable=False, index=True)  # Telefone (formato: 5516996480805)
    name = Column(String(100))  # Nome do contato
    
    # Status
    active = Column(Boolean, default=True, index=True)  # Se está ativo para receber
    
    # Estatísticas
    last_sent = Column(DateTime)  # Último envio
    total_sent = Column(Integer, default=0)  # Total de devocionais recebidos
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Devocional(Base):
    """Modelo para armazenar devocionais gerados"""
    __tablename__ = "devocionais"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Conteúdo principal
    title = Column(String(255))  # Título do devocional (sem emoji)
    content = Column(Text, nullable=False)  # Texto completo formatado para WhatsApp
    date = Column(DateTime, default=datetime.utcnow, index=True)  # Data do devocional
    
    # Versículos estruturados
    versiculo_principal_texto = Column(Text)  # Texto do versículo principal
    versiculo_principal_referencia = Column(String(100))  # Referência bíblica
    versiculo_apoio_texto = Column(Text)  # Texto do versículo de apoio
    versiculo_apoio_referencia = Column(String(100))  # Referência bíblica
    
    # Metadados
    source = Column(String(50), default="n8n")  # Fonte: 'n8n', 'api', 'manual', 'webhook'
    autor = Column(String(100), default="Alex e Daniela Mantovani")
    tema = Column(String(100))  # Tema principal
    palavras_chave = Column(Text)  # Array de palavras-chave (JSON ou texto separado)
    
    # Status e controle
    sent = Column(Boolean, default=False, index=True)  # Se já foi enviado
    sent_at = Column(DateTime)  # Quando foi enviado
    total_sent = Column(Integer, default=0)  # Quantas vezes foi enviado
    
    # Metadados adicionais (JSON)
    metadata_json = Column(Text)  # JSON com metadados extras (renomeado de 'metadata' pois é palavra reservada)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def init_db():
    """Inicializa o banco de dados criando as tabelas"""
    Base.metadata.create_all(bind=engine)


def get_db():
    """Dependency para obter sessão do banco de dados"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

