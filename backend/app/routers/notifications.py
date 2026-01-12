"""
Endpoints de notificações para integração com n8n
"""
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from typing import Optional, Dict, List
from pydantic import BaseModel, Field
from datetime import datetime
from app.database import get_db, DevocionalEnvio, DevocionalContato, Devocional
from app.devocional_service_v2 import DevocionalServiceV2
from app.config import settings
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])

# Função helper para obter serviço com db
def get_devocional_service(db: Session) -> DevocionalServiceV2:
    """Retorna instância do serviço com banco de dados"""
    return DevocionalServiceV2(db=db)


class NotificationRequest(BaseModel):
    """Request para notificação"""
    event: str = Field(..., description="Tipo de evento: 'send_devocional', 'send_test', 'check_status'")
    devocional_id: Optional[int] = Field(None, description="ID do devocional a enviar")
    message: Optional[str] = Field(None, description="Mensagem personalizada (opcional)")
    contacts: Optional[List[Dict[str, str]]] = Field(None, description="Lista de contatos específicos")
    phone: Optional[str] = Field(None, description="Telefone específico para teste")
    delay: Optional[float] = Field(None, description="Delay entre mensagens")


class NotificationResponse(BaseModel):
    """Response de notificação"""
    success: bool
    message: str
    data: Optional[Dict] = None


@router.post("/webhook", response_model=NotificationResponse)
async def n8n_webhook(
    request: NotificationRequest,
    db: Session = Depends(get_db),
    x_webhook_secret: Optional[str] = Header(None, alias="X-Webhook-Secret")
):
    """
    Webhook para receber notificações do n8n
    
    Eventos suportados:
    - send_devocional: Envia devocional para todos os contatos ativos
    - send_test: Envia mensagem de teste para número específico
    - check_status: Retorna status das instâncias
    
    Headers:
    - X-Webhook-Secret: Secret para autenticação (se configurado)
    """
    try:
        # Verificar secret se configurado
        if settings.DEVOCIONAL_WEBHOOK_SECRET:
            if not x_webhook_secret or x_webhook_secret != settings.DEVOCIONAL_WEBHOOK_SECRET:
                raise HTTPException(status_code=401, detail="Webhook secret inválido")
        
        # Processar evento
        if request.event == "send_devocional":
            # Obter mensagem
            message = request.message
            if request.devocional_id and not message:
                devocional = db.query(Devocional).filter(
                    Devocional.id == request.devocional_id
                ).first()
                
                if not devocional:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Devocional com ID {request.devocional_id} não encontrado"
                    )
                
                message = devocional.content
            
            if not message:
                raise HTTPException(
                    status_code=400,
                    detail="É necessário fornecer 'message' ou 'devocional_id'"
                )
            
            # Obter contatos
            if request.contacts:
                contacts = request.contacts
            else:
                db_contacts = db.query(DevocionalContato).filter(
                    DevocionalContato.active == True
                ).all()
                
                if not db_contacts:
                    raise HTTPException(
                        status_code=400,
                        detail="Nenhum contato ativo encontrado"
                    )
                
                contacts = [
                    {"phone": c.phone, "name": c.name}
                    for c in db_contacts
                ]
            
            # Enviar
            devocional_service = get_devocional_service(db)
            results = devocional_service.send_bulk_devocionais(
                contacts=contacts,
                message=message,
                delay=request.delay
            )
            
            # Registrar no banco
            sent_count = 0
            failed_count = 0
            from app.timezone_utils import now_brazil_naive
            
            for i, result in enumerate(results):
                contact = contacts[i] if i < len(contacts) else {}
                
                # Converter timestamp para naive (sem timezone) para PostgreSQL
                timestamp_naive = result.timestamp.replace(tzinfo=None) if result.timestamp and result.timestamp.tzinfo else (now_brazil_naive() if result.timestamp is None else result.timestamp)
                
                envio = DevocionalEnvio(
                    recipient_phone=contact.get('phone', ''),
                    recipient_name=contact.get('name'),
                    message_text=message,
                    sent_at=timestamp_naive,
                    status=result.status.value,
                    message_id=result.message_id,
                    error_message=result.error,
                    retry_count=result.retry_count,
                    instance_name=result.instance_name
                )
                db.add(envio)
                
                if result.success:
                    sent_count += 1
                    db_contact = db.query(DevocionalContato).filter(
                        DevocionalContato.phone == contact.get('phone')
                    ).first()
                    
                    if db_contact:
                        db_contact.last_sent = timestamp_naive
                        db_contact.total_sent += 1
                else:
                    failed_count += 1
            
            db.commit()
            
            return NotificationResponse(
                success=sent_count > 0,
                message=f"Envio concluído: {sent_count} enviadas, {failed_count} falharam",
                data={
                    "total": len(results),
                    "sent": sent_count,
                    "failed": failed_count,
                    "results": [
                        {
                            "phone": contacts[i].get('phone') if i < len(contacts) else '',
                            "success": r.success,
                            "status": r.status.value,
                            "instance": r.instance_name
                        }
                        for i, r in enumerate(results)
                    ]
                }
            )
        
        elif request.event == "send_test":
            if not request.phone:
                raise HTTPException(
                    status_code=400,
                    detail="É necessário fornecer 'phone' para teste"
                )
            
            test_message = request.message or "Mensagem de teste do sistema de devocionais"
            
            devocional_service = get_devocional_service(db)
            result = devocional_service.send_devocional(
                phone=request.phone,
                message=test_message,
                name="Teste",
                retry=False
            )
            
            return NotificationResponse(
                success=result.success,
                message="Mensagem de teste enviada" if result.success else f"Erro: {result.error}",
                data={
                    "phone": request.phone,
                    "status": result.status.value,
                    "instance": result.instance_name,
                    "message_id": result.message_id,
                    "error": result.error
                }
            )
        
        elif request.event == "check_status":
            # Verificar saúde das instâncias
            devocional_service = get_devocional_service(db)
            devocional_service.check_all_instances_health()
            stats = devocional_service.get_stats()
            
            return NotificationResponse(
                success=True,
                message="Status das instâncias verificado",
                data=stats
            )
        
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Evento '{request.event}' não suportado. Use: 'send_devocional', 'send_test', 'check_status'"
            )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao processar webhook de notificação: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.get("/instances")
async def get_instances_status(db: Session = Depends(get_db)):
    """Retorna status de todas as instâncias"""
    try:
        devocional_service = get_devocional_service(db)
        devocional_service.check_all_instances_health()
        stats = devocional_service.get_stats()
        return stats
    except Exception as e:
        logger.error(f"Erro ao obter status das instâncias: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.post("/instances/{instance_name}/setup-profile")
async def setup_instance_profile(instance_name: str, db: Session = Depends(get_db)):
    """Configura o perfil (nome) de uma instância específica"""
    try:
        devocional_service = get_devocional_service(db)
        instance = devocional_service.instance_manager.get_instance_by_name(instance_name)
        if not instance:
            raise HTTPException(status_code=404, detail=f"Instância {instance_name} não encontrada")
        
        success = devocional_service.instance_manager.set_instance_profile(
            instance,
            instance.display_name,
            "Devocional Diário - Mensagens de fé e esperança"
        )
        
        if success:
            return {
                "success": True,
                "message": f"Perfil da instância {instance_name} configurado com sucesso",
                "display_name": instance.display_name
            }
        else:
            return {
                "success": False,
                "message": f"Erro ao configurar perfil da instância {instance_name}",
                "error": instance.last_error
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao configurar perfil: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.post("/instances/setup-all-profiles")
async def setup_all_profiles(db: Session = Depends(get_db)):
    """Configura o perfil (nome) de todas as instâncias"""
    try:
        devocional_service = get_devocional_service(db)
        results = []
        for instance in devocional_service.instance_manager.instances:
            if instance.enabled:
                success = devocional_service.instance_manager.set_instance_profile(
                    instance,
                    instance.display_name,
                    "Devocional Diário - Mensagens de fé e esperança"
                )
                results.append({
                    "instance": instance.name,
                    "success": success,
                    "display_name": instance.display_name
                })
        
        return {
            "success": True,
            "message": "Perfis configurados",
            "results": results
        }
    except Exception as e:
        logger.error(f"Erro ao configurar perfis: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.get("/instances/debug")
async def debug_instances(db: Session = Depends(get_db)):
    """Endpoint de debug para verificar configuração das instâncias"""
    try:
        devocional_service = get_devocional_service(db)
        import json
        from app.config import settings
        
        # Informações de configuração
        config_info = {
            "evolution_api_url": settings.EVOLUTION_API_URL,
            "evolution_api_key": settings.EVOLUTION_API_KEY[:10] + "..." if settings.EVOLUTION_API_KEY else None,
            "note": "Instâncias agora são gerenciadas via banco de dados"
        }
        
        # Status das instâncias no manager
        manager_stats = devocional_service.get_stats()
        
        # Verificar cada instância manualmente
        instance_details = []
        for inst in devocional_service.instance_manager.instances:
            detail = {
                "name": inst.name,
                "api_url": inst.api_url,
                "api_key_preview": inst.api_key[:10] + "..." if inst.api_key else None,
                "status": inst.status.value,
                "enabled": inst.enabled,
                "last_check": inst.last_check.isoformat() if inst.last_check else None,
                "last_error": inst.last_error,
                "error_count": inst.error_count
            }
            
            # Tentar verificar agora
            try:
                health_result = devocional_service.instance_manager.check_instance_health(inst)
                detail["health_check_now"] = health_result
                detail["status_after_check"] = inst.status.value
            except Exception as e:
                detail["health_check_error"] = str(e)
            
            instance_details.append(detail)
        
        return {
            "config": config_info,
            "manager_stats": manager_stats,
            "instance_details": instance_details
        }
    except Exception as e:
        logger.error(f"Erro no debug: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")
