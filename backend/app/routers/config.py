"""
Endpoints para gerenciar configurações do sistema
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel, Field
from app.database import get_db, User, SystemConfig
from app.config import settings
from app.auth import get_current_user
import logging
import os

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config", tags=["config"])


# Schemas
class ShieldConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    delay_variation: Optional[float] = Field(None, ge=0.0, le=1.0)
    break_interval: Optional[int] = Field(None, ge=1)
    break_duration_min: Optional[float] = Field(None, ge=0.0)
    break_duration_max: Optional[float] = Field(None, ge=0.0)
    min_engagement_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    adaptive_limits_enabled: Optional[bool] = None
    block_detection_enabled: Optional[bool] = None


class RateLimitConfigUpdate(BaseModel):
    delay_between_messages: Optional[float] = Field(None, ge=0.0)
    max_messages_per_hour: Optional[int] = Field(None, ge=1)
    max_messages_per_day: Optional[int] = Field(None, ge=1)
    max_retries: Optional[int] = Field(None, ge=0)
    retry_delay: Optional[float] = Field(None, ge=0.0)


class ScheduleConfigUpdate(BaseModel):
    send_time: Optional[str] = Field(None, pattern=r'^\d{2}:\d{2}$')


class ConfigResponse(BaseModel):
    shield: dict
    rate_limit: dict
    schedule: dict
    message: str


def _get_send_time_from_db(db: Session) -> str:
    """Helper para obter horário de envio do banco"""
    try:
        config = db.query(SystemConfig).filter(SystemConfig.key == "devocional_send_time").first()
        if config and config.value:
            return config.value
    except Exception as e:
        logger.warning(f"Erro ao buscar horário do banco: {e}. Usando padrão do .env")
    return settings.DEVOCIONAL_SEND_TIME


@router.get("/")
async def get_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retorna todas as configurações do sistema"""
    return {
        "shield": {
            "enabled": settings.SHIELD_ENABLED,
            "delay_variation": settings.DELAY_VARIATION,
            "break_interval": settings.BREAK_INTERVAL,
            "break_duration_min": settings.BREAK_DURATION_MIN,
            "break_duration_max": settings.BREAK_DURATION_MAX,
            "min_engagement_score": settings.MIN_ENGAGEMENT_SCORE,
            "adaptive_limits_enabled": settings.ADAPTIVE_LIMITS_ENABLED,
            "block_detection_enabled": settings.BLOCK_DETECTION_ENABLED,
        },
        "rate_limit": {
            "delay_between_messages": settings.DELAY_BETWEEN_MESSAGES,
            "max_messages_per_hour": settings.MAX_MESSAGES_PER_HOUR,
            "max_messages_per_day": settings.MAX_MESSAGES_PER_DAY,
            "max_retries": settings.MAX_RETRIES,
            "retry_delay": settings.RETRY_DELAY,
        },
        "schedule": {
            "send_time": _get_send_time_from_db(db),
        }
    }


@router.put("/shield")
async def update_shield_config(
    config: ShieldConfigUpdate,
    current_user: User = Depends(get_current_user)
):
    """
    Atualiza configurações de blindagem
    ⚠️ Requer reiniciar aplicação para aplicar mudanças
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas administradores podem alterar configurações")
    
    # Atualizar variáveis de ambiente (em memória)
    if config.enabled is not None:
        os.environ["SHIELD_ENABLED"] = str(config.enabled).lower()
    if config.delay_variation is not None:
        os.environ["DELAY_VARIATION"] = str(config.delay_variation)
    if config.break_interval is not None:
        os.environ["BREAK_INTERVAL"] = str(config.break_interval)
    if config.break_duration_min is not None:
        os.environ["BREAK_DURATION_MIN"] = str(config.break_duration_min)
    if config.break_duration_max is not None:
        os.environ["BREAK_DURATION_MAX"] = str(config.break_duration_max)
    if config.min_engagement_score is not None:
        os.environ["MIN_ENGAGEMENT_SCORE"] = str(config.min_engagement_score)
    if config.adaptive_limits_enabled is not None:
        os.environ["ADAPTIVE_LIMITS_ENABLED"] = str(config.adaptive_limits_enabled).lower()
    if config.block_detection_enabled is not None:
        os.environ["BLOCK_DETECTION_ENABLED"] = str(config.block_detection_enabled).lower()
    
    logger.info(f"Configurações de blindagem atualizadas por {current_user.email}")
    
    return {
        "message": "Configurações atualizadas. Reinicie a aplicação para aplicar as mudanças.",
        "updated": config.dict(exclude_unset=True)
    }


@router.put("/rate-limit")
async def update_rate_limit_config(
    config: RateLimitConfigUpdate,
    current_user: User = Depends(get_current_user)
):
    """
    Atualiza configurações de rate limiting
    ⚠️ Requer reiniciar aplicação para aplicar mudanças
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas administradores podem alterar configurações")
    
    # Atualizar variáveis de ambiente (em memória)
    if config.delay_between_messages is not None:
        os.environ["DELAY_BETWEEN_MESSAGES"] = str(config.delay_between_messages)
    if config.max_messages_per_hour is not None:
        os.environ["MAX_MESSAGES_PER_HOUR"] = str(config.max_messages_per_hour)
    if config.max_messages_per_day is not None:
        os.environ["MAX_MESSAGES_PER_DAY"] = str(config.max_messages_per_day)
    if config.max_retries is not None:
        os.environ["MAX_RETRIES"] = str(config.max_retries)
    if config.retry_delay is not None:
        os.environ["RETRY_DELAY"] = str(config.retry_delay)
    
    logger.info(f"Configurações de rate limiting atualizadas por {current_user.email}")
    
    return {
        "message": "Configurações atualizadas. Reinicie a aplicação para aplicar as mudanças.",
        "updated": config.dict(exclude_unset=True)
    }


@router.put("/schedule")
async def update_schedule_config(
    config: ScheduleConfigUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Atualiza horário de envio automático (dinâmico - não precisa reiniciar)
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas administradores podem alterar configurações")
    
    if config.send_time:
        # Validar formato HH:MM
        try:
            hour, minute = map(int, config.send_time.split(':'))
            if not (0 <= hour <= 23 and 0 <= minute <= 59):
                raise ValueError("Hora ou minuto inválido")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Formato de horário inválido: {e}")
        
        # Salvar no banco de dados
        try:
            db_config = db.query(SystemConfig).filter(SystemConfig.key == "devocional_send_time").first()
            if db_config:
                logger.info(f"Atualizando horário existente: {db_config.value} -> {config.send_time}")
                db_config.value = config.send_time
            else:
                logger.info(f"Criando nova configuração de horário: {config.send_time}")
                db_config = SystemConfig(
                    key="devocional_send_time",
                    value=config.send_time,
                    description="Horário de envio automático de devocionais (formato HH:MM, horário de Brasília)"
                )
                db.add(db_config)
            
            db.commit()
            db.refresh(db_config)  # Garantir que está atualizado
            
            # Verificar se foi salvo corretamente
            verify_config = db.query(SystemConfig).filter(SystemConfig.key == "devocional_send_time").first()
            if verify_config and verify_config.value == config.send_time:
                logger.info(f"✅ Horário de envio salvo com sucesso no banco: {verify_config.value}")
            else:
                logger.error(f"❌ Erro: Horário não foi salvo corretamente. Esperado: {config.send_time}, Encontrado: {verify_config.value if verify_config else 'None'}")
                raise HTTPException(status_code=500, detail="Erro ao salvar horário no banco de dados")
            
        except Exception as e:
            logger.error(f"Erro ao salvar horário no banco: {e}", exc_info=True)
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Erro ao salvar horário: {str(e)}")
        
        # Também atualizar variável de ambiente (para compatibilidade)
        os.environ["DEVOCIONAL_SEND_TIME"] = config.send_time
        
        logger.info(f"Horário de envio atualizado para {config.send_time} por {current_user.email} (dinâmico - aplicado imediatamente)")
    
    return {
        "message": "Horário de envio atualizado. Mudança será aplicada automaticamente em até 5 minutos.",
        "send_time": config.send_time
    }

