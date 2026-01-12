"""
Endpoints para gerenciar instâncias Evolution API
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel, Field
from app.database import get_db
from app.auth import get_current_user
from app.database import User
from app.instance_manager import InstanceManager
from app.config import settings
import logging
import requests
import json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/instances", tags=["instances"])


# Schemas
class InstanceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    api_url: str = Field(..., min_length=1)
    api_key: str = Field(..., min_length=1)
    display_name: str = Field(..., min_length=1, max_length=100)
    max_messages_per_hour: int = Field(20, ge=1)
    max_messages_per_day: int = Field(200, ge=1)
    priority: int = Field(1, ge=1, le=3)
    enabled: bool = True


class InstanceUpdate(BaseModel):
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    display_name: Optional[str] = None
    max_messages_per_hour: Optional[int] = Field(None, ge=1)
    max_messages_per_day: Optional[int] = Field(None, ge=1)
    priority: Optional[int] = Field(None, ge=1, le=3)
    enabled: Optional[bool] = None


class QRCodeResponse(BaseModel):
    qr_code: str
    base64: Optional[str] = None
    instance_name: str


@router.get("/")
async def list_instances(
    current_user: User = Depends(get_current_user)
):
    """Lista todas as instâncias configuradas"""
    try:
        # Carregar instâncias do config com tratamento de erros
        instances_config = []
        if settings.EVOLUTION_INSTANCES and settings.EVOLUTION_INSTANCES.strip() and settings.EVOLUTION_INSTANCES != "[]":
            try:
                instances_config = json.loads(settings.EVOLUTION_INSTANCES)
                if not isinstance(instances_config, list):
                    logger.error(f"EVOLUTION_INSTANCES não é uma lista: {type(instances_config)}")
                    instances_config = []
            except json.JSONDecodeError as e:
                logger.error(f"Erro ao fazer parse de EVOLUTION_INSTANCES: {e}")
                logger.error(f"Conteúdo: {settings.EVOLUTION_INSTANCES[:200]}")
                instances_config = []
        
        # Criar InstanceManager temporário para obter status
        manager = InstanceManager(instances_config)
        manager.check_all_instances()
        
        instances = []
        for inst in manager.instances:
            instances.append({
                "name": inst.name,
                "api_url": inst.api_url,
                "display_name": inst.display_name,
                "status": inst.status.value,
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
            })
        
        return {"instances": instances}
    except Exception as e:
        logger.error(f"Erro ao listar instâncias: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao listar instâncias: {str(e)}")


@router.post("/{instance_name}/qr")
async def generate_qr_code(
    instance_name: str,
    current_user: User = Depends(get_current_user)
):
    """
    Gera QR code para conectar instância
    Primeiro verifica se a instância já existe, se não existir, cria
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas administradores podem gerar QR codes")
    
    try:
        # Carregar instâncias com tratamento de erros
        instances_config = []
        if settings.EVOLUTION_INSTANCES and settings.EVOLUTION_INSTANCES.strip() and settings.EVOLUTION_INSTANCES != "[]":
            try:
                instances_config = json.loads(settings.EVOLUTION_INSTANCES)
                if not isinstance(instances_config, list):
                    logger.error(f"EVOLUTION_INSTANCES não é uma lista: {type(instances_config)}")
                    instances_config = []
            except json.JSONDecodeError as e:
                logger.error(f"Erro ao fazer parse de EVOLUTION_INSTANCES: {e}")
                raise HTTPException(status_code=500, detail=f"Erro na configuração EVOLUTION_INSTANCES: JSON inválido. Verifique o formato no .env")
        
        # Encontrar instância
        instance_config = None
        for inst in instances_config:
            if inst.get("name") == instance_name:
                instance_config = inst
                break
        
        if not instance_config:
            raise HTTPException(status_code=404, detail=f"Instância {instance_name} não encontrada na configuração")
        
        api_url = instance_config["api_url"]
        api_key = instance_config["api_key"]
        headers = {"apikey": api_key}
        
        # Primeiro, verificar se a instância já existe
        check_url = f"{api_url}/instance/fetchInstances"
        check_response = requests.get(check_url, headers=headers, timeout=10)
        
        instance_exists = False
        if check_response.status_code == 200:
            instances_data = check_response.json()
            if isinstance(instances_data, list):
                for inst_data in instances_data:
                    if (inst_data.get('instanceName') or inst_data.get('name')) == instance_name:
                        instance_exists = True
                        state = inst_data.get('state', 'unknown')
                        # Se já está conectada, retornar erro informativo
                        if state in ['open', 'connected', 'ready']:
                            raise HTTPException(
                                status_code=400,
                                detail=f"Instância {instance_name} já está conectada (estado: {state}). Não é necessário gerar QR code."
                            )
                        break
        
        # Se a instância não existe ou está desconectada, tentar obter QR code
        # Tentar diferentes endpoints da Evolution API
        qr_endpoints = [
            f"{api_url}/instance/connect/{instance_name}",
            f"{api_url}/instance/{instance_name}/connect",
            f"{api_url}/instance/create",
        ]
        
        qr_code = None
        last_error = None
        
        for endpoint in qr_endpoints:
            try:
                if endpoint.endswith("/create"):
                    # Endpoint de criação
                    payload = {
                        "instanceName": instance_name,
                        "qrcode": True,
                        "integration": "WHATSAPP-BAILEYS"
                    }
                    response = requests.post(endpoint, json=payload, headers=headers, timeout=30)
                else:
                    # Endpoint de conexão
                    response = requests.get(endpoint, headers=headers, timeout=30)
                
                if response.status_code == 200:
                    data = response.json()
                    # Tentar diferentes formatos de resposta
                    qr_code = (
                        data.get("qrcode", {}).get("base64") or
                        data.get("qrcode", {}).get("code") or
                        data.get("qrcode") or
                        data.get("base64") or
                        data.get("code")
                    )
                    
                    if qr_code:
                        # Garantir que está no formato base64 correto
                        if isinstance(qr_code, str):
                            if not qr_code.startswith("data:image"):
                                if not qr_code.startswith("http"):
                                    qr_code = f"data:image/png;base64,{qr_code}"
                        break
                elif response.status_code == 404 and instance_exists:
                    # Instância existe mas endpoint diferente, tentar próximo
                    continue
                else:
                    last_error = f"HTTP {response.status_code}: {response.text[:200]}"
                    logger.debug(f"Endpoint {endpoint} retornou {response.status_code}")
                    
            except requests.exceptions.RequestException as e:
                last_error = str(e)
                logger.debug(f"Erro ao tentar endpoint {endpoint}: {e}")
                continue
        
        if not qr_code:
            # Se nenhum endpoint funcionou, tentar criar a instância
            try:
                create_url = f"{api_url}/instance/create"
                create_payload = {
                    "instanceName": instance_name,
                    "qrcode": True,
                    "integration": "WHATSAPP-BAILEYS"
                }
                create_response = requests.post(create_url, json=create_payload, headers=headers, timeout=30)
                
                if create_response.status_code in [200, 201]:
                    data = create_response.json()
                    qr_code = (
                        data.get("qrcode", {}).get("base64") or
                        data.get("qrcode", {}).get("code") or
                        data.get("qrcode") or
                        data.get("base64")
                    )
                    
                    if qr_code and not qr_code.startswith("data:image") and not qr_code.startswith("http"):
                        qr_code = f"data:image/png;base64,{qr_code}"
            except Exception as e:
                logger.error(f"Erro ao criar instância: {e}")
        
        if qr_code:
            return {
                "qr_code": qr_code,
                "base64": qr_code,
                "instance_name": instance_name,
                "message": "QR code gerado com sucesso. Escaneie com WhatsApp para conectar."
            }
        else:
            error_detail = last_error or "Não foi possível gerar QR code. Verifique se a instância existe e se a API Key está correta."
            logger.error(f"Erro ao gerar QR code para {instance_name}: {error_detail}")
            raise HTTPException(
                status_code=500,
                detail=error_detail
            )
    
    except HTTPException:
        raise
    except requests.exceptions.RequestException as e:
        logger.error(f"Erro de conexão ao gerar QR code: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro de conexão com Evolution API: {str(e)}")
    except Exception as e:
        logger.error(f"Erro ao gerar QR code: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro inesperado: {str(e)}")


@router.post("/{instance_name}/connect")
async def connect_instance(
    instance_name: str,
    current_user: User = Depends(get_current_user)
):
    """
    Verifica status de conexão da instância
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas administradores podem verificar conexão")
    
    try:
        # Carregar instâncias com tratamento de erros
        instances_config = []
        if settings.EVOLUTION_INSTANCES and settings.EVOLUTION_INSTANCES.strip() and settings.EVOLUTION_INSTANCES != "[]":
            try:
                instances_config = json.loads(settings.EVOLUTION_INSTANCES)
                if not isinstance(instances_config, list):
                    logger.error(f"EVOLUTION_INSTANCES não é uma lista: {type(instances_config)}")
                    instances_config = []
            except json.JSONDecodeError as e:
                logger.error(f"Erro ao fazer parse de EVOLUTION_INSTANCES: {e}")
                raise HTTPException(status_code=500, detail=f"Erro na configuração EVOLUTION_INSTANCES: JSON inválido. Verifique o formato no .env")
        
        # Encontrar instância
        instance_config = None
        for inst in instances_config:
            if inst.get("name") == instance_name:
                instance_config = inst
                break
        
        if not instance_config:
            raise HTTPException(status_code=404, detail=f"Instância {instance_name} não encontrada")
        
        api_url = instance_config["api_url"]
        api_key = instance_config["api_key"]
        
        # Verificar status da instância
        url = f"{api_url}/instance/fetchInstances"
        headers = {"apikey": api_key}
        
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            instances_data = response.json()
            
            # Procurar nossa instância
            for inst_data in instances_data:
                if (inst_data.get('instanceName') or inst_data.get('name')) == instance_name:
                    state = inst_data.get('state', 'unknown')
                    phone = inst_data.get('phoneNumber') or inst_data.get('phone') or inst_data.get('number')
                    
                    return {
                        "instance_name": instance_name,
                        "state": state,
                        "phone_number": phone,
                        "connected": state in ['open', 'connected', 'ready'],
                        "message": f"Instância {instance_name} está {state}"
                    }
            
            return {
                "instance_name": instance_name,
                "state": "not_found",
                "connected": False,
                "message": f"Instância {instance_name} não encontrada na Evolution API"
            }
        else:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Erro ao verificar conexão: {response.text}"
            )
    
    except requests.exceptions.RequestException as e:
        logger.error(f"Erro de conexão: {e}")
        raise HTTPException(status_code=500, detail=f"Erro de conexão: {str(e)}")
    except Exception as e:
        logger.error(f"Erro ao verificar conexão: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.post("/{instance_name}/refresh")
async def refresh_instance_status(
    instance_name: str,
    current_user: User = Depends(get_current_user)
):
    """
    Força atualização do status de uma instância
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas administradores podem atualizar status")
    
    try:
        # Carregar instâncias com tratamento de erros
        instances_config = []
        if settings.EVOLUTION_INSTANCES and settings.EVOLUTION_INSTANCES.strip() and settings.EVOLUTION_INSTANCES != "[]":
            try:
                instances_config = json.loads(settings.EVOLUTION_INSTANCES)
                if not isinstance(instances_config, list):
                    logger.error(f"EVOLUTION_INSTANCES não é uma lista: {type(instances_config)}")
                    instances_config = []
            except json.JSONDecodeError as e:
                logger.error(f"Erro ao fazer parse de EVOLUTION_INSTANCES: {e}")
                raise HTTPException(status_code=500, detail=f"Erro na configuração EVOLUTION_INSTANCES: JSON inválido. Verifique o formato no .env")
        
        # Criar InstanceManager e verificar instância específica
        manager = InstanceManager(instances_config)
        instance = manager.get_instance_by_name(instance_name)
        
        if not instance:
            raise HTTPException(status_code=404, detail=f"Instância {instance_name} não encontrada")
        
        # Forçar health check
        is_healthy = manager.check_instance_health(instance)
        
        return {
            "instance_name": instance_name,
            "status": instance.status.value,
            "phone_number": instance.phone_number,
            "last_check": instance.last_check.isoformat() if instance.last_check else None,
            "last_error": instance.last_error,
            "is_healthy": is_healthy,
            "message": f"Status atualizado: {instance.status.value}"
        }
    
    except Exception as e:
        logger.error(f"Erro ao atualizar status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")

