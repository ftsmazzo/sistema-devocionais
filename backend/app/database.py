"""
Configuração do banco de dados
"""
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Boolean, ARRAY, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
from app.config import settings
from app.timezone_utils import now_brazil_naive as now_brazil

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
    message_id = Column(String(100), index=True)  # ID da mensagem na Evolution API (usado para rastrear status)
    error_message = Column(Text)  # Mensagem de erro (se houver)
    retry_count = Column(Integer, default=0)  # Número de tentativas
    
    # Status detalhado da mensagem (rastreado via webhook da Evolution API)
    message_status = Column(String(20), default="pending", index=True)  # pending, sent, delivered, read, failed
    delivered_at = Column(DateTime, nullable=True, index=True)  # Quando foi entregue
    read_at = Column(DateTime, nullable=True, index=True)  # Quando foi lida/visualizada
    
    # Instância que enviou (para multi-instância)
    instance_name = Column(String(100))  # Nome da instância Evolution API que enviou
    
    # Timestamps (sempre em horário de Brasília)
    sent_at = Column(DateTime, default=now_brazil, index=True)
    scheduled_for = Column(DateTime, index=True)  # Para envios agendados
    created_at = Column(DateTime, default=now_brazil)  # Data de criação do registro


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
    
    # Timestamps (sempre em horário de Brasília)
    created_at = Column(DateTime, default=now_brazil)
    updated_at = Column(DateTime, default=now_brazil, onupdate=now_brazil)


class ContactEngagement(Base):
    """Modelo para armazenar dados de engajamento dos contatos no banco"""
    __tablename__ = "contact_engagement"
    
    id = Column(Integer, primary_key=True, index=True)
    phone = Column(String(20), unique=True, nullable=False, index=True)  # Telefone do contato
    
    # Score de engajamento (0.0 a 1.0)
    engagement_score = Column(Float, default=0.5, index=True)
    
    # Estatísticas
    total_sent = Column(Integer, default=0)  # Total de mensagens enviadas
    total_responded = Column(Integer, default=0)  # Total de respostas
    total_read = Column(Integer, default=0)  # Total de mensagens lidas
    total_delivered = Column(Integer, default=0)  # Total de mensagens entregues
    
    # Datas importantes
    last_response_date = Column(DateTime, nullable=True)  # Última resposta
    last_sent_date = Column(DateTime, nullable=True)  # Último envio
    last_read_date = Column(DateTime, nullable=True)  # Última leitura
    last_delivered_date = Column(DateTime, nullable=True)  # Última entrega
    
    # Contadores consecutivos
    consecutive_no_response = Column(Integer, default=0)  # Mensagens consecutivas sem resposta
    consecutive_not_read = Column(Integer, default=0)  # Mensagens consecutivas não lidas
    consecutive_not_delivered = Column(Integer, default=0)  # Mensagens consecutivas não entregues
    
    # Timestamps
    created_at = Column(DateTime, default=now_brazil)
    updated_at = Column(DateTime, default=now_brazil, onupdate=now_brazil)


class Devocional(Base):
    """Modelo para armazenar devocionais gerados"""
    __tablename__ = "devocionais"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Conteúdo principal
    title = Column(String(255))  # Título do devocional (sem emoji)
    content = Column(Text, nullable=False)  # Texto completo formatado para WhatsApp
    date = Column(DateTime, default=now_brazil, index=True)  # Data do devocional (horário de Brasília)
    
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
    
    # Timestamps (sempre em horário de Brasília)
    created_at = Column(DateTime, default=now_brazil, index=True)
    updated_at = Column(DateTime, default=now_brazil, onupdate=now_brazil)


class AgendamentoEnvio(Base):
    """Modelo para rastrear agendamentos de envio de devocionais"""
    __tablename__ = "agendamento_envios"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Relacionamento
    devocional_id = Column(Integer, nullable=True, index=True)  # FK para devocionais
    
    # Agendamento
    scheduled_for = Column(DateTime, nullable=False, index=True)  # Quando deve ser enviado
    sent = Column(Boolean, default=False, index=True)  # Se já foi enviado
    sent_at = Column(DateTime, nullable=True)  # Quando foi enviado
    
    # Timestamps
    created_at = Column(DateTime, default=now_brazil)
    updated_at = Column(DateTime, default=now_brazil, onupdate=now_brazil)


class User(Base):
    """Modelo para usuários do sistema"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(100))
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    
    # Timestamps (sempre em horário de Brasília)
    created_at = Column(DateTime, default=now_brazil)
    updated_at = Column(DateTime, default=now_brazil, onupdate=now_brazil)
    last_login = Column(DateTime, nullable=True)


class SystemConfig(Base):
    """Modelo para configurações do sistema (armazenado no banco)"""
    __tablename__ = "system_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False, index=True)  # Chave da configuração
    value = Column(Text, nullable=False)  # Valor da configuração (pode ser JSON)
    description = Column(String(255), nullable=True)  # Descrição da configuração
    
    # Timestamps
    created_at = Column(DateTime, default=now_brazil)
    updated_at = Column(DateTime, default=now_brazil, onupdate=now_brazil)


class EvolutionInstanceConfig(Base):
    """
    Modelo para configurações de instâncias da Evolution API
    Armazenado no banco para persistência
    """
    __tablename__ = "evolution_instance_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)  # Nome da instância
    api_url = Column(String(255), nullable=False)  # URL da API
    api_key = Column(String(255), nullable=False)  # API Key
    display_name = Column(String(100))  # Nome de exibição
    max_messages_per_hour = Column(Integer, default=20)  # Limite por hora
    max_messages_per_day = Column(Integer, default=200)  # Limite por dia
    priority = Column(Integer, default=1)  # Prioridade (menor = maior prioridade)
    enabled = Column(Boolean, default=True, index=True)  # Se está habilitada
    
    # Timestamps
    created_at = Column(DateTime, default=now_brazil)
    updated_at = Column(DateTime, default=now_brazil, onupdate=now_brazil)


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
