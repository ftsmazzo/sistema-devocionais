"""
Endpoints refatorados para gerenciar instâncias Evolution API
Usa banco de dados como fonte única de verdade
Busca instâncias diretamente da Evolution API
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel, Field
from app.database import get_db, EvolutionInstanceConfig
from app.auth import get_current_user
from app.database import User
from app.instance_service import InstanceService
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/instances", tags=["instances"])


# Schemas
class InstanceResponse(BaseModel):
    id: int
    name: str
    api_url: str
    display_name: str
    status: str
    phone_number: Optional[str]
    messages_sent_today: int
    messages_sent_this_hour: int
    max_messages_per_hour: int
    max_messages_per_day: int
    priority: int
    enabled: bool
    last_check: Optional[str]
    last_error: Optional[str]
    error_count: int
    
    class Config:
        from_attributes = True


class InstanceCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    display_name: str = Field(..., min_length=1, max_length=100)
    max_messages_per_hour: int = Field(20, ge=1)
    max_messages_per_day: int = Field(200, ge=1)
    priority: int = Field(1, ge=1, le=3)


class InstanceUpdateRequest(BaseModel):
    display_name: Optional[str] = Field(None, min_length=1, max_length=100)
    max_messages_per_hour: Optional[int] = Field(None, ge=1)
    max_messages_per_day: Optional[int] = Field(None, ge=1)
    priority: Optional[int] = Field(None, ge=1, le=3)
    enabled: Optional[bool] = None


class QRCodeResponse(BaseModel):
    qr_code: str
    instance_name: str
    message: str


@router.get("/", response_model=List[InstanceResponse])
async def list_instances(
    sync: bool = True,  # Sempre sincronizar por padrão
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Lista todas as instâncias
    Sempre sincroniza com Evolution API para ter dados atualizados
    """
    try:
        service = InstanceService(db)
        instances = service.get_all_instances(sync=sync)
        
        # Converter instâncias para dict com last_check como string
        result = []
        for inst in instances:
            inst_dict = {
                "id": inst.id,
                "name": inst.name,
                "api_url": inst.api_url,
                "display_name": inst.display_name,
                "status": inst.status,
                "phone_number": inst.phone_number,
                "messages_sent_today": inst.messages_sent_today,
                "messages_sent_this_hour": inst.messages_sent_this_hour,
                "max_messages_per_hour": inst.max_messages_per_hour,
                "max_messages_per_day": inst.max_messages_per_day,
                "priority": inst.priority,
                "enabled": inst.enabled,
                "last_check": inst.last_check.isoformat() if inst.last_check else None,
                "last_error": inst.last_error,
                "error_count": inst.error_count,
            }
            result.append(InstanceResponse(**inst_dict))
        
        return result
    except Exception as e:
        logger.error(f"Erro ao listar instâncias: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao listar instâncias: {str(e)}")


@router.post("/create")
async def create_instance(
    instance_data: InstanceCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Cria uma nova instância na Evolution API e salva configuração no banco
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas administradores podem criar instâncias")
    
    try:
        service = InstanceService(db)
        
        # Verificar se já existe no banco
        existing = service.get_instance_by_name(instance_data.name)
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Instância {instance_data.name} já existe no banco de dados"
            )
        
        # Criar na Evolution API primeiro
        from app.config import settings
        headers = {
            "apikey": settings.EVOLUTION_API_KEY,
            "Content-Type": "application/json"
        }
        
        create_url = f"{settings.EVOLUTION_API_URL}/instance/create"
        create_payload = {
            "instanceName": instance_data.name,
            "qrcode": True,
            "integration": "WHATSAPP-BAILEYS"
        }
        
        logger.info(f"Criando instância {instance_data.name} na Evolution API...")
        import requests
        create_response = requests.post(create_url, json=create_payload, headers=headers, timeout=30)
        
        if create_response.status_code not in [200, 201]:
            error_text = create_response.text[:500]
            logger.error(f"Erro ao criar instância na Evolution API: HTTP {create_response.status_code} - {error_text}")
            raise HTTPException(
                status_code=create_response.status_code,
                detail=f"Erro ao criar instância na Evolution API: {error_text}"
            )
        
        data = create_response.json()
        qr_code = (
            data.get("qrcode", {}).get("base64") or
            data.get("qrcode", {}).get("code") or
            data.get("qrcode") or
            data.get("base64") or
            data.get("code")
        )
        
        if not qr_code:
            logger.error(f"QR code não encontrado na resposta: {data}")
            raise HTTPException(
                status_code=500,
                detail="QR code não recebido da Evolution API"
            )
        
        # Garantir formato correto
        if isinstance(qr_code, str):
            if not qr_code.startswith("data:image") and not qr_code.startswith("http"):
                qr_code = f"data:image/png;base64,{qr_code}"
        
        # Salvar configuração no banco
        instance = service.create_instance_config(
            name=instance_data.name,
            display_name=instance_data.display_name,
            max_messages_per_hour=instance_data.max_messages_per_hour,
            max_messages_per_day=instance_data.max_messages_per_day,
            priority=instance_data.priority
        )
        
        logger.info(f"Instância {instance_data.name} criada com sucesso")
        
        return {
            "qr_code": qr_code,
            "instance_name": instance_data.name,
            "message": "Instância criada com sucesso! Escaneie o QR code com WhatsApp para conectar.",
            "instance": InstanceResponse.model_validate(instance)
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao criar instância: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro inesperado: {str(e)}")


@router.post("/{instance_name}/qr")
async def generate_qr_code(
    instance_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Gera QR code para reconectar instância desconectada
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas administradores podem gerar QR codes")
    
    try:
        service = InstanceService(db)
        
        # Verificar se existe no banco
        instance = service.get_instance_by_name(instance_name)
        if not instance:
            raise HTTPException(
                status_code=404,
                detail=f"Instância {instance_name} não encontrada. Sincronize primeiro."
            )
        
        # Se já está conectada, não precisa de QR code
        if instance.status == "active":
            raise HTTPException(
                status_code=400,
                detail=f"Instância {instance_name} já está conectada. Não é necessário gerar QR code."
            )
        
        # Gerar QR code
        qr_code = service.generate_qr_code(instance_name)
        
        if not qr_code:
            raise HTTPException(
                status_code=500,
                detail="Não foi possível gerar QR code. Verifique se a instância existe na Evolution API."
            )
        
        return {
            "qr_code": qr_code,
            "instance_name": instance_name,
            "message": "QR code gerado com sucesso. Escaneie com WhatsApp para reconectar."
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao gerar QR code: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro inesperado: {str(e)}")


@router.post("/{instance_name}/connect")
async def connect_instance(
    instance_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Verifica status de conexão da instância
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas administradores podem verificar conexão")
    
    try:
        service = InstanceService(db)
        
        # Sincronizar para obter status atualizado
        instance = service.refresh_instance_status(instance_name)
        
        if not instance:
            raise HTTPException(
                status_code=404,
                detail=f"Instância {instance_name} não encontrada"
            )
        
        is_connected = instance.status == "active"
        
        return {
            "instance_name": instance_name,
            "status": instance.status,
            "phone_number": instance.phone_number,
            "connected": is_connected,
            "message": f"Instância {instance_name} está {instance.status}"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao verificar conexão: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.post("/{instance_name}/refresh")
async def refresh_instance_status(
    instance_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Força atualização do status de uma instância
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas administradores podem atualizar status")
    
    try:
        service = InstanceService(db)
        instance = service.refresh_instance_status(instance_name)
        
        if not instance:
            raise HTTPException(
                status_code=404,
                detail=f"Instância {instance_name} não encontrada"
            )
        
        return {
            "instance_name": instance_name,
            "status": instance.status,
            "phone_number": instance.phone_number,
            "last_check": instance.last_check.isoformat() if instance.last_check else None,
            "last_error": instance.last_error,
            "message": f"Status atualizado: {instance.status}"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao atualizar status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.put("/{instance_name}")
async def update_instance(
    instance_name: str,
    instance_data: InstanceUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Atualiza configuração de uma instância
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas administradores podem atualizar instâncias")
    
    try:
        service = InstanceService(db)
        instance = service.update_instance_config(
            name=instance_name,
            display_name=instance_data.display_name,
            max_messages_per_hour=instance_data.max_messages_per_hour,
            max_messages_per_day=instance_data.max_messages_per_day,
            priority=instance_data.priority,
            enabled=instance_data.enabled
        )
        
        if not instance:
            raise HTTPException(
                status_code=404,
                detail=f"Instância {instance_name} não encontrada"
            )
        
        return InstanceResponse.model_validate(instance)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao atualizar instância: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.delete("/{instance_name}")
async def delete_instance(
    instance_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Remove configuração de instância do banco (não deleta da Evolution API)
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas administradores podem deletar instâncias")
    
    try:
        service = InstanceService(db)
        deleted = service.delete_instance_config(instance_name)
        
        if not deleted:
            raise HTTPException(
                status_code=404,
                detail=f"Instância {instance_name} não encontrada"
            )
        
        return {"message": f"Configuração da instância {instance_name} removida do banco de dados"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao deletar instância: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")
