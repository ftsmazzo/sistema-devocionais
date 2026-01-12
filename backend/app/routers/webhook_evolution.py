"""
Webhook para receber eventos da Evolution API
Status de mensagens: sent, delivered, read, etc.
"""
from fastapi import APIRouter, Request, HTTPException, Header, Depends
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any, List
from datetime import datetime
from pydantic import BaseModel
from app.database import get_db, DevocionalEnvio
from app.shield_service import ShieldService
from app.config import settings
import logging
import json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook/evolution", tags=["webhook-evolution"])

# Armazenar últimos eventos recebidos para debug (em memória, máximo 50)
_recent_events: List[Dict] = []
MAX_DEBUG_EVENTS = 50


class EvolutionWebhookEvent(BaseModel):
    """Modelo para eventos do webhook da Evolution API"""
    event: str  # message.ack, qrcode.updated, etc.
    instance: str  # Nome da instância
    data: Dict[str, Any]  # Dados do evento


@router.post("/message-status")
async def receive_message_status(
    request: Request,
    db: Session = Depends(get_db),
    x_webhook_secret: Optional[str] = Header(None, alias="X-Webhook-Secret")
):
    """
    Webhook para receber status de mensagens da Evolution API
    
    Eventos suportados:
    - message.ack: Confirmação de envio (sent, delivered, read)
    
    A Evolution API envia eventos quando:
    - Mensagem é enviada (ack: sent)
    - Mensagem é entregue (ack: delivered)
    - Mensagem é lida (ack: read)
    
    Formato esperado da Evolution API:
    {
        "event": "message.ack",
        "instance": "nome-instancia",
        "data": {
            "key": {
                "id": "message_id",
                "remoteJid": "5516999999999@s.whatsapp.net"
            },
            "ack": 1,  # 1=sent, 2=delivered, 3=read
            "timestamp": 1234567890
        }
    }
    """
    try:
        # Verificar secret se configurado
        if settings.DEVOCIONAL_WEBHOOK_SECRET:
            if not x_webhook_secret or x_webhook_secret != settings.DEVOCIONAL_WEBHOOK_SECRET:
                raise HTTPException(status_code=401, detail="Webhook secret inválido")
        
        # Obter dados do request
        try:
            body = await request.json()
        except Exception as e:
            logger.error(f"Erro ao parsear JSON do webhook: {e}")
            raise HTTPException(status_code=400, detail="JSON inválido")
        
        # Armazenar evento para debug
        event_debug = {
            "timestamp": datetime.now().isoformat(),
            "body": body,
            "headers": dict(request.headers)
        }
        _recent_events.insert(0, event_debug)
        if len(_recent_events) > MAX_DEBUG_EVENTS:
            _recent_events.pop()
        
        event = body.get("event", "")
        instance_name = body.get("instance", "")
        data = body.get("data", {})
        
        # Log detalhado do que está chegando
        logger.info(f"🔔 Webhook recebido: event={event}, instance={instance_name}")
        logger.info(f"📦 Body completo recebido: {json.dumps(body, indent=2, default=str)}")
        
        # Processar apenas eventos de status de mensagem
        if event == "message.ack":
            result = await process_message_ack(db, instance_name, data)
            return {
                "success": True, 
                "message": "Webhook processado",
                "event": event,
                "processed": result
            }
        else:
            logger.debug(f"Evento ignorado: {event}")
            return {
                "success": True, 
                "message": "Webhook recebido mas evento ignorado",
                "event": event
            }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao processar webhook da Evolution API: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


async def process_message_ack(
    db: Session,
    instance_name: str,
    data: Dict[str, Any]
):
    """
    Processa evento de confirmação de mensagem (ACK)
    
    Args:
        db: Sessão do banco de dados
        instance_name: Nome da instância
        data: Dados do evento
    
    Returns:
        Dict com informações do processamento
    """
    try:
        # Log detalhado dos dados recebidos
        logger.info(f"📨 Processando message.ack: data={json.dumps(data, indent=2, default=str)}")
        
        # Extrair informações - tentar diferentes formatos
        # Formato 1: data.key.id
        key = data.get("key", {})
        message_id = key.get("id") if isinstance(key, dict) else None
        
        # Formato 2: data.id (alternativo)
        if not message_id:
            message_id = data.get("id")
        
        # Formato 3: data.messageId (alternativo)
        if not message_id:
            message_id = data.get("messageId")
        
        remote_jid = key.get("remoteJid", "") if isinstance(key, dict) else data.get("remoteJid", "")
        ack = data.get("ack", 0)  # 1=sent, 2=delivered, 3=read
        timestamp = data.get("timestamp")
        
        logger.info(f"🔍 Extraído: message_id={message_id}, ack={ack}, remote_jid={remote_jid}")
        
        if not message_id:
            logger.warning(f"⚠️ Webhook sem message_id, ignorando. Data recebida: {data}")
            return {"error": "message_id não encontrado", "data_received": data}
        
        # Extrair telefone do remoteJid (formato: 5516999999999@s.whatsapp.net)
        phone = remote_jid.split("@")[0] if "@" in remote_jid else remote_jid
        
        # Buscar envio pelo message_id
        envio = db.query(DevocionalEnvio).filter(
            DevocionalEnvio.message_id == message_id
        ).first()
        
        if not envio:
            # Tentar buscar pelos últimos envios para debug
            recent_envios = db.query(DevocionalEnvio).order_by(
                DevocionalEnvio.sent_at.desc()
            ).limit(5).all()
            
            logger.warning(f"⚠️ Envio não encontrado para message_id: {message_id}")
            logger.info(f"📋 Últimos 5 message_ids no banco:")
            for e in recent_envios:
                logger.info(f"   - message_id: {e.message_id}, phone: {e.recipient_phone}, status: {e.message_status}")
            
            return {
                "error": f"Envio não encontrado para message_id: {message_id}",
                "message_id_received": message_id,
                "recent_message_ids": [e.message_id for e in recent_envios if e.message_id]
            }
        
        # Converter timestamp para datetime
        from app.timezone_utils import now_brazil_naive
        if timestamp:
            try:
                # Timestamp pode estar em segundos ou milissegundos
                if timestamp > 10**10:
                    timestamp = timestamp / 1000  # Converter de milissegundos
                event_time = datetime.fromtimestamp(timestamp)
            except:
                event_time = now_brazil_naive()
        else:
            event_time = now_brazil_naive()
        
        # Atualizar status baseado no ACK
        # ACK 1 = sent (enviado)
        # ACK 2 = delivered (entregue)
        # ACK 3 = read (lido/visualizado)
        
        updated = False
        ack_description = {1: "sent", 2: "delivered", 3: "read"}.get(ack, f"unknown({ack})")
        logger.info(f"📊 Processando ACK {ack} ({ack_description}) para message_id {message_id}")
        
        if ack == 1:  # Sent
            if envio.message_status != "sent":
                envio.message_status = "sent"
                envio.status = "sent"
                updated = True
                logger.info(f"✅ Mensagem {message_id} enviada para {phone}")
        
        elif ack == 2:  # Delivered
            if envio.message_status != "delivered":
                envio.message_status = "delivered"
                envio.delivered_at = event_time
                updated = True
                logger.info(f"✅ Mensagem {message_id} entregue para {phone}")
        
        elif ack == 3:  # Read
            if envio.message_status != "read":
                envio.message_status = "read"
                envio.read_at = event_time
                # Se ainda não tinha delivered_at, marcar também
                if not envio.delivered_at:
                    envio.delivered_at = event_time
                updated = True
                logger.info(f"✅✅ Mensagem {message_id} LIDA por {phone}")
                
                # Atualizar engajamento no ShieldService
                update_engagement_from_read(db, phone, True)
        else:
            logger.warning(f"⚠️ ACK desconhecido: {ack} para message_id {message_id}")
        
        if updated:
            db.commit()
            logger.info(f"✅ Status atualizado para message_id {message_id}: ack={ack} -> status={envio.message_status}")
            return {
                "success": True,
                "message_id": message_id,
                "ack": ack,
                "ack_description": ack_description,
                "status_updated": envio.message_status,
                "phone": phone
            }
        else:
            logger.debug(f"ℹ️ Status não atualizado (já estava em {envio.message_status}) para ack={ack}")
            return {
                "success": True,
                "message_id": message_id,
                "ack": ack,
                "ack_description": ack_description,
                "status": envio.message_status,
                "already_updated": True
            }
    
    except Exception as e:
        logger.error(f"❌ Erro ao processar message.ack: {e}", exc_info=True)
        db.rollback()
        return {"error": str(e), "data": data}


def update_engagement_from_read(db: Session, phone: str, was_read: bool):
    """
    Atualiza score de engajamento baseado em visualização
    
    Args:
        db: Sessão do banco de dados
        phone: Número do telefone
        was_read: Se a mensagem foi lida
    """
    try:
        # Buscar serviço de devocionais para acessar o ShieldService
        # Criar instância do DevocionalServiceV2 que contém o ShieldService
        from app.devocional_service_v2 import DevocionalServiceV2
        
        devocional_service = DevocionalServiceV2(db=db)
        
        # Atualizar engajamento via ShieldService
        if devocional_service.shield:
            # Atualizar engajamento baseado em visualização
            devocional_service.shield.update_engagement(
                phone=phone,
                responded=False,  # Não é resposta, é visualização
                is_devocional=True,
                was_read=was_read
            )
            
            if was_read and phone in devocional_service.shield.engagement_data:
                data = devocional_service.shield.engagement_data[phone]
                logger.info(f"📈 Engajamento atualizado para {phone}: score={data.engagement_score:.2f} (visualizou)")
        else:
            logger.warning("ShieldService não está habilitado, não é possível atualizar engajamento")
    
    except Exception as e:
        logger.error(f"Erro ao atualizar engajamento: {e}", exc_info=True)


@router.get("/test")
async def test_webhook():
    """Endpoint de teste para verificar se o webhook está acessível"""
    return {
        "success": True,
        "message": "Webhook da Evolution API está funcionando",
        "endpoint": "/webhook/evolution/message-status",
        "instructions": "Configure este endpoint na Evolution API como webhook para receber eventos de status de mensagens"
    }


@router.get("/debug/events")
async def debug_recent_events(limit: int = 10):
    """
    Endpoint de debug para ver os últimos eventos recebidos
    
    Útil para verificar se os eventos estão chegando e em que formato
    """
    return {
        "total_events": len(_recent_events),
        "events": _recent_events[:limit]
    }


@router.get("/debug/message-ids")
async def debug_message_ids(db: Session = Depends(get_db), limit: int = 10):
    """
    Endpoint de debug para ver os últimos message_ids salvos no banco
    
    Útil para comparar com os message_ids que estão chegando no webhook
    """
    envios = db.query(DevocionalEnvio).order_by(
        DevocionalEnvio.sent_at.desc()
    ).limit(limit).all()
    
    return {
        "total": len(envios),
        "message_ids": [
            {
                "message_id": e.message_id,
                "phone": e.recipient_phone,
                "status": e.message_status,
                "sent_at": e.sent_at.isoformat() if e.sent_at else None,
                "delivered_at": e.delivered_at.isoformat() if e.delivered_at else None,
                "read_at": e.read_at.isoformat() if e.read_at else None
            }
            for e in envios
        ]
    }
