"""
Configuração do banco de dados
"""
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Boolean, ARRAY
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
    
    # Instância que enviou (para multi-instância)
    instance_name = Column(String(100))  # Nome da instância Evolution API que enviou
    
    # Timestamps
    sent_at = Column(DateTime, default=datetime.utcnow, index=True)
    scheduled_for = Column(DateTime, index=True)  # Para envios agendados
    created_at = Column(DateTime, default=datetime.utcnow)  # Data de criação do registro


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
    palavras_chave = Column(ARRAY(Text))  # Array de palavras-chave
    
    # Status e controle
    sent = Column(Boolean, default=False, index=True)  # Se já foi enviado
    sent_at = Column(DateTime)  # Quando foi enviado
    total_sent = Column(Integer, default=0)  # Quantas vezes foi enviado
    
    # Metadados adicionais (JSON)
    metadata_json = Column(Text)  # JSON com metadados adicionais
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AgendamentoEnvio(Base):
    """Modelo para rastrear agendamentos de envio de devocionais"""
    __tablename__ = "agendamento_envios"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Relacionamento
    devocional_id = Column(Integer, nullable=True, index=True)  # FK para devocionais
    contato_id = Column(Integer, nullable=True, index=True)  # FK para contatos (opcional, pode ser envio em massa)
    
    # Informações do agendamento
    scheduled_for = Column(DateTime, nullable=False, index=True)  # Quando deve ser enviado
    sent_at = Column(DateTime, nullable=True, index=True)  # Quando foi realmente enviado
    
    # Status
    status = Column(String(20), default="pending", index=True)  # pending, sent, failed, cancelled
    error_message = Column(Text)  # Mensagem de erro (se houver)
    
    # Informações do envio
    recipient_phone = Column(String(20), nullable=False)  # Telefone do destinatário
    recipient_name = Column(String(100))  # Nome do destinatário
    message_text = Column(Text)  # Texto que será/enviado
    
    # Instância que deve enviar
    instance_name = Column(String(100))  # Nome da instância Evolution API
    
    # Tipo de agendamento
    agendamento_type = Column(String(20), default="automatico")  # automatico, manual, recorrente
    
    # Metadados
    metadata_json = Column(Text)  # JSON com metadados adicionais
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class User(Base):
    """Modelo para usuários do sistema"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(100))
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)


class EvolutionInstanceConfig(Base):
    """Modelo para configuração de instâncias Evolution API (armazenado no banco)"""
    __tablename__ = "evolution_instance_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Identificação
    name = Column(String(100), unique=True, nullable=False, index=True)  # Nome da instância na Evolution API
    
    # Configuração da API
    api_url = Column(String(255), nullable=False)  # URL da Evolution API
    api_key = Column(String(255), nullable=False)  # API Key
    
    # Configurações de exibição
    display_name = Column(String(100), default="Devocional Diário")  # Nome que aparece no WhatsApp
    
    # Limites de envio
    max_messages_per_hour = Column(Integer, default=20)
    max_messages_per_day = Column(Integer, default=200)
    
    # Prioridade e controle
    priority = Column(Integer, default=1)  # 1=alta, 2=média, 3=baixa
    enabled = Column(Boolean, default=True, index=True)
    
    # Status atual (atualizado dinamicamente)
    status = Column(String(20), default="unknown", index=True)  # active, inactive, error, blocked
    phone_number = Column(String(20), nullable=True)  # Número da instância (obtido da API)
    
    # Estatísticas (atualizadas dinamicamente)
    messages_sent_today = Column(Integer, default=0)
    messages_sent_this_hour = Column(Integer, default=0)
    last_message_time = Column(DateTime, nullable=True)
    
    # Informações de erro
    error_count = Column(Integer, default=0)
    last_error = Column(Text, nullable=True)
    last_check = Column(DateTime, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# Função para obter sessão do banco
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Função para inicializar banco de dados (criar tabelas)
def init_db():
    """
    Inicializa o banco de dados criando todas as tabelas
    """
    Base.metadata.create_all(bind=engine)
