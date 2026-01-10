"""
Configurações do sistema
"""
from pydantic_settings import BaseSettings
from typing import List, Dict, Any
import os
from dotenv import load_dotenv

load_dotenv()


class Settings(BaseSettings):
    """Configurações da aplicação"""
    
    # Database
    DATABASE_URL: str = "sqlite:///./noticias.db"
    
    # Portais de notícias a serem monitorados
    NEWS_PORTALS: List[Dict[str, Any]] = [
        {
            "name": "Portal Exemplo 1",
            "url": "https://exemplo1.com.br/noticias",
            "selectors": {
                "article": ".noticia",
                "title": "h2",
                "link": "a",
                "date": ".data",
                "content": ".conteudo"
            }
        },
        # Adicione mais portais aqui
    ]
    
    # Palavras-chave para identificar notícias relevantes
    KEYWORDS: List[str] = [
        "assistência social",
        "assistencia social",
        "secretaria de assistência social",
        "secretaria de assistencia social",
        "SAS",
        "CRAS",
        "CREAS",
        "benefícios sociais",
        "cadastro único",
        "bolsa família",
        "auxílio",
        "vulnerabilidade social"
    ]
    
    # Configurações WhatsApp
    WHATSAPP_ENABLED: bool = False
    WHATSAPP_API_URL: str = os.getenv("WHATSAPP_API_URL", "")
    WHATSAPP_API_KEY: str = os.getenv("WHATSAPP_API_KEY", "")
    WHATSAPP_PHONE_ID: str = os.getenv("WHATSAPP_PHONE_ID", "")
    
    # Responsáveis para notificação
    RESPONSIBLES: List[Dict[str, str]] = [
        {
            "name": "Responsável 1",
            "phone": "+5511999999999",
            "area": "CRAS"
        },
        # Adicione mais responsáveis aqui
    ]
    
    # Configurações de monitoramento
    MONITORING_INTERVAL_MINUTES: int = 30  # Intervalo entre verificações
    MAX_ARTICLES_PER_CHECK: int = 50
    
    # Configurações Evolution API para Devocionais (LEGADO - usar EVOLUTION_INSTANCES)
    EVOLUTION_API_URL: str = os.getenv("EVOLUTION_API_URL", "http://localhost:8080")
    EVOLUTION_API_KEY: str = os.getenv("EVOLUTION_API_KEY", "")
    EVOLUTION_INSTANCE_NAME: str = os.getenv("EVOLUTION_INSTANCE_NAME", "Devocional")
    
    # Configurações Multi-Instância Evolution API
    # Formato: JSON string com lista de instâncias
    # Exemplo: [{"name": "Devocional-1", "api_url": "http://localhost:8080", "api_key": "key1", "display_name": "Devocional Diário", "max_messages_per_hour": 20, "max_messages_per_day": 200, "priority": 1}]
    EVOLUTION_INSTANCES: str = os.getenv("EVOLUTION_INSTANCES", "[]")
    
    # Nome padrão para exibição no WhatsApp
    EVOLUTION_DISPLAY_NAME: str = os.getenv("EVOLUTION_DISPLAY_NAME", "Devocional Diário")
    
    # Estratégia de distribuição entre instâncias
    # Opções: "round_robin", "least_used", "priority", "random"
    EVOLUTION_INSTANCE_STRATEGY: str = os.getenv("EVOLUTION_INSTANCE_STRATEGY", "round_robin")
    
    # Enviar vCard automaticamente para novos contatos (ATIVAR PARA SALVAR CONTATO AUTOMATICAMENTE)
    SEND_VCARD_TO_NEW_CONTACTS: bool = os.getenv("SEND_VCARD_TO_NEW_CONTACTS", "true").lower() == "true"
    
    # Enviar mensagem pedindo para salvar contato
    SEND_CONTACT_REQUEST: bool = os.getenv("SEND_CONTACT_REQUEST", "false").lower() == "true"
    
    # Rate Limiting para Devocionais (proteção contra bloqueio)
    DELAY_BETWEEN_MESSAGES: float = float(os.getenv("DELAY_BETWEEN_MESSAGES", "3.0"))  # segundos
    MAX_MESSAGES_PER_HOUR: int = int(os.getenv("MAX_MESSAGES_PER_HOUR", "20"))  # mensagens por hora
    MAX_MESSAGES_PER_DAY: int = int(os.getenv("MAX_MESSAGES_PER_DAY", "200"))  # mensagens por dia
    
    # Retry Configuration
    MAX_RETRIES: int = int(os.getenv("MAX_RETRIES", "3"))  # tentativas em caso de falha
    RETRY_DELAY: float = float(os.getenv("RETRY_DELAY", "5.0"))  # segundos entre tentativas
    
    # Lista de contatos para devocionais
    DEVOCIONAL_CONTACTS: List[Dict[str, str]] = [
        # Exemplo:
        # {"phone": "5516996480805", "name": "Tadeu"},
        # {"phone": "5511999999999", "name": "Maria"},
    ]
    
    # Horário de envio automático (formato HH:MM)
    DEVOCIONAL_SEND_TIME: str = os.getenv("DEVOCIONAL_SEND_TIME", "06:00")
    
    # Integração com automação externa (n8n, etc)
    DEVOCIONAL_WEBHOOK_SECRET: str = os.getenv("DEVOCIONAL_WEBHOOK_SECRET", "")
    DEVOCIONAL_API_URL: str = os.getenv("DEVOCIONAL_API_URL", "")  # URL da API externa para buscar devocionais
    DEVOCIONAL_API_KEY: str = os.getenv("DEVOCIONAL_API_KEY", "")  # API Key para autenticação
    DEVOCIONAL_FETCH_MODE: str = os.getenv("DEVOCIONAL_FETCH_MODE", "webhook")  # "webhook" ou "api"
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()

