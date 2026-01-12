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
        # NOTA IMPORTANTE: Webhooks da Evolution API não permitem configurar headers customizados
        # Por isso, tornamos o secret OPCIONAL para webhooks da Evolution API
        # O secret é usado apenas para webhooks do n8n (outro endpoint: /api/devocional/webhook)
        # 
        # Lógica:
        # - Se secret configurado E fornecido no header → validar
        # - Se secret configurado mas NÃO fornecido → PERMITIR (Evolution API não envia headers)
        # - Se secret não configurado → permitir normalmente
        
        if settings.DEVOCIONAL_WEBHOOK_SECRET:
            if x_webhook_secret:
                # Secret fornecido - validar
                if x_webhook_secret != settings.DEVOCIONAL_WEBHOOK_SECRET:
                    logger.warning(f"⚠️ Webhook secret inválido recebido")
                    raise HTTPException(status_code=401, detail="Webhook secret inválido")
                logger.debug("✅ Webhook secret validado")
            else:
                # Secret configurado mas não fornecido - PERMITIR (Evolution API não envia headers)
                logger.debug("ℹ️ Webhook secret configurado mas não fornecido - permitindo (Evolution API não envia headers customizados)")
        
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
        
        # Verificar se é formato messages.update (formato mais comum da Evolution API)
        if event == "messages.update":
            logger.info(f"📨 Detectado evento messages.update")
            result = await process_messages_update(db, instance_name, data)
            return {
                "success": True, 
                "message": "Webhook processado (formato messages.update)",
                "format": "messages.update",
                "processed": result
            }
        
        # Verificar se é formato MessageUpdate (array - formato alternativo)
        message_updates = body.get("MessageUpdate", [])
        if message_updates:
            # Formato alternativo: MessageUpdate array
            logger.info(f"📨 Detectado formato MessageUpdate com {len(message_updates)} atualizações")
            result = await process_message_update(db, body)
            return {
                "success": True, 
                "message": "Webhook processado (formato MessageUpdate)",
                "format": "MessageUpdate",
                "processed": result
            }
        
        # Processar formato antigo message.ack
        if event == "message.ack":
            result = await process_message_ack(db, instance_name, data)
            return {
                "success": True, 
                "message": "Webhook processado",
                "event": event,
                "format": "message.ack",
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


async def process_message_update(
    db: Session,
    body: Dict[str, Any]
):
    """
    Processa evento MessageUpdate (novo formato da Evolution API)
    
    Formato:
    {
        "MessageUpdate": [
            {"status": "SERVER_ACK"},    // sent
            {"status": "DELIVERY_ACK"}, // delivered
            {"status": "READ"}          // read
        ],
        "id": "message_id",
        "messageTimestamp": 1234567890,
        "instanceId": "uuid"
    }
    
    Args:
        db: Sessão do banco de dados
        body: Body completo do webhook
    
    Returns:
        Dict com informações do processamento
    """
    try:
        message_updates = body.get("MessageUpdate", [])
        message_id = body.get("id")
        instance_id = body.get("instanceId", "")
        timestamp = body.get("messageTimestamp")
        
        logger.info(f"📨 Processando MessageUpdate: message_id={message_id}, updates={len(message_updates)}")
        
        if not message_id:
            logger.warning(f"⚠️ MessageUpdate sem id, ignorando. Body: {body}")
            return {"error": "id não encontrado", "body": body}
        
        if not message_updates:
            logger.warning(f"⚠️ MessageUpdate vazio para message_id {message_id}")
            return {"error": "MessageUpdate vazio", "message_id": message_id}
        
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
        
        # Processar cada atualização no array
        # Pegar o status mais recente (último do array) ou processar todos
        updated = False
        phone = envio.recipient_phone
        
        # Mapear status da Evolution API para nosso formato
        status_map = {
            "SERVER_ACK": ("sent", "sent"),
            "DELIVERY_ACK": ("delivered", "delivered"),
            "READ": ("read", "read")
        }
        
        # Processar todas as atualizações, mas priorizar READ > DELIVERY_ACK > SERVER_ACK
        final_status = None
        for update in message_updates:
            status = update.get("status", "")
            mapped_status, db_status = status_map.get(status, (None, None))
            
            if mapped_status:
                logger.info(f"📊 Processando status: {status} -> {mapped_status}")
                
                # Atualizar baseado no status
                if status == "SERVER_ACK" and envio.message_status != "sent":
                    envio.message_status = "sent"
                    envio.status = "sent"
                    final_status = "sent"
                    updated = True
                    logger.info(f"✅ Mensagem {message_id} enviada para {phone}")
                
                elif status == "DELIVERY_ACK" and envio.message_status not in ["delivered", "read"]:
                    envio.message_status = "delivered"
                    envio.delivered_at = event_time
                    final_status = "delivered"
                    updated = True
                    logger.info(f"✅ Mensagem {message_id} entregue para {phone}")
                
                elif status == "READ":
                    # READ é o mais importante - sempre atualizar
                    envio.message_status = "read"
                    envio.read_at = event_time
                    if not envio.delivered_at:
                        envio.delivered_at = event_time
                    final_status = "read"
                    updated = True
                    logger.info(f"✅✅ Mensagem {message_id} LIDA por {phone}")
                    
                    # Atualizar engajamento
                    update_engagement_from_read(db, phone, True)
        
        if updated:
            db.commit()
            logger.info(f"✅ Status atualizado para message_id {message_id}: status={final_status}")
            return {
                "success": True,
                "message_id": message_id,
                "status_updated": final_status,
                "updates_processed": len(message_updates),
                "phone": phone
            }
        else:
            logger.debug(f"ℹ️ Status não atualizado (já estava em {envio.message_status})")
            return {
                "success": True,
                "message_id": message_id,
                "status": envio.message_status,
                "already_updated": True
            }
    
    except Exception as e:
        logger.error(f"❌ Erro ao processar MessageUpdate: {e}", exc_info=True)
        db.rollback()
        return {"error": str(e), "body": body}


async def process_message_update(
    db: Session,
    body: Dict[str, Any]
):
    """
    Processa evento MessageUpdate (novo formato da Evolution API)
    
    Formato:
    {
        "MessageUpdate": [
            {"status": "SERVER_ACK"},    // sent
            {"status": "DELIVERY_ACK"}, // delivered
            {"status": "READ"}          // read
        ],
        "id": "message_id",
        "messageTimestamp": 1234567890,
        "instanceId": "uuid"
    }
    
    Args:
        db: Sessão do banco de dados
        body: Body completo do webhook
    
    Returns:
        Dict com informações do processamento
    """
    try:
        message_updates = body.get("MessageUpdate", [])
        message_id = body.get("id")
        instance_id = body.get("instanceId", "")
        timestamp = body.get("messageTimestamp")
        
        logger.info(f"📨 Processando MessageUpdate: message_id={message_id}, updates={len(message_updates)}")
        
        if not message_id:
            logger.warning(f"⚠️ MessageUpdate sem id, ignorando. Body: {body}")
            return {"error": "id não encontrado", "body": body}
        
        if not message_updates:
            logger.warning(f"⚠️ MessageUpdate vazio para message_id {message_id}")
            return {"error": "MessageUpdate vazio", "message_id": message_id}
        
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
        
        # Processar cada atualização no array
        # Pegar o status mais recente (último do array) ou processar todos
        updated = False
        phone = envio.recipient_phone
        
        # Mapear status da Evolution API para nosso formato
        # Processar todas as atualizações, priorizando READ > DELIVERY_ACK > SERVER_ACK
        final_status = None
        has_read = False
        has_delivered = False
        has_sent = False
        
        for update in message_updates:
            status = update.get("status", "")
            
            logger.info(f"📊 Processando status: {status}")
            
            if status == "SERVER_ACK" and not has_sent:
                if envio.message_status != "sent":
                    envio.message_status = "sent"
                    envio.status = "sent"
                    final_status = "sent"
                    updated = True
                    has_sent = True
                    logger.info(f"✅ Mensagem {message_id} enviada para {phone}")
            
            elif status == "DELIVERY_ACK" and not has_delivered:
                if envio.message_status not in ["delivered", "read"]:
                    envio.message_status = "delivered"
                    envio.delivered_at = event_time
                    final_status = "delivered"
                    updated = True
                    has_delivered = True
                    logger.info(f"✅ Mensagem {message_id} entregue para {phone}")
            
            elif status == "READ":
                # READ é o mais importante - sempre atualizar
                envio.message_status = "read"
                envio.read_at = event_time
                if not envio.delivered_at:
                    envio.delivered_at = event_time
                final_status = "read"
                updated = True
                has_read = True
                logger.info(f"✅✅ Mensagem {message_id} LIDA por {phone}")
                
                # Atualizar engajamento
                update_engagement_from_read(db, phone, True)
        
        if updated:
            db.commit()
            logger.info(f"✅ Status atualizado para message_id {message_id}: status={final_status}")
            return {
                "success": True,
                "message_id": message_id,
                "status_updated": final_status,
                "updates_processed": len(message_updates),
                "has_read": has_read,
                "has_delivered": has_delivered,
                "has_sent": has_sent,
                "phone": phone
            }
        else:
            logger.debug(f"ℹ️ Status não atualizado (já estava em {envio.message_status})")
            return {
                "success": True,
                "message_id": message_id,
                "status": envio.message_status,
                "already_updated": True
            }
    
    except Exception as e:
        logger.error(f"❌ Erro ao processar MessageUpdate: {e}", exc_info=True)
        db.rollback()
        return {"error": str(e), "body": body}


async def process_messages_update(
    db: Session,
    instance_name: str,
    data: Dict[str, Any]
):
    """
    Processa evento messages.update (formato mais comum da Evolution API)
    
    Formato:
    {
        "event": "messages.update",
        "instance": "Devocional01",
        "data": {
            "keyId": "3EB0E62EC94C6C01256AE4",
            "remoteJid": "5516996480805:90@s.whatsapp.net",
            "fromMe": true,
            "status": "READ",  // ou "DELIVERY_ACK", "SERVER_ACK"
            "instanceId": "uuid",
            "messageId": "cmkb4tcto1b7bje5p1842gaw9"
        }
    }
    
    Args:
        db: Sessão do banco de dados
        instance_name: Nome da instância
        data: Dados do evento
    
    Returns:
        Dict com informações do processamento
    """
    try:
        # Extrair informações
        message_id_webhook = data.get("messageId")  # ID interno da Evolution (ex: cmkb4tcto1b7bje5p1842gaw9)
        key_id = data.get("keyId")  # ID da mensagem WhatsApp (ex: 3EB0E62EC94C6C01256AE4) - este é o que salvamos!
        remote_jid = data.get("remoteJid", "")
        status = data.get("status", "")
        
        logger.info(f"📨 Processando messages.update: messageId={message_id_webhook}, keyId={key_id}, status={status}, remote_jid={remote_jid}")
        
        if not key_id and not message_id_webhook:
            logger.warning(f"⚠️ messages.update sem messageId/keyId, ignorando. Data: {data}")
            return {"error": "messageId/keyId não encontrado", "data": data}
        
        if not status:
            logger.warning(f"⚠️ messages.update sem status, ignorando. Data: {data}")
            return {"error": "status não encontrado", "data": data}
        
        # Extrair telefone do remoteJid (formato: 5516996480805:90@s.whatsapp.net ou 5516996480805@s.whatsapp.net)
        phone = remote_jid.split("@")[0].split(":")[0] if "@" in remote_jid else remote_jid.split(":")[0]
        
        # IMPORTANTE: O message_id que salvamos no banco é o keyId (response_data.get('key', {}).get('id'))
        # Então devemos buscar pelo keyId primeiro!
        envio = None
        
        # Buscar pelo keyId primeiro (este é o que salvamos quando enviamos)
        if key_id:
            envio = db.query(DevocionalEnvio).filter(
                DevocionalEnvio.message_id == key_id
            ).first()
            if envio:
                logger.info(f"✅ Encontrado envio pelo keyId: {key_id}")
        
        # Se não encontrou pelo keyId, tentar pelo messageId (pode ser que em alguns casos seja o mesmo)
        if not envio and message_id_webhook:
            envio = db.query(DevocionalEnvio).filter(
                DevocionalEnvio.message_id == message_id_webhook
            ).first()
            if envio:
                logger.info(f"✅ Encontrado envio pelo messageId: {message_id_webhook}")
        
        # Usar keyId como identificador principal para logs
        message_id = key_id or message_id_webhook
        
        if not envio:
            # Tentar buscar pelos últimos envios para debug
            recent_envios = db.query(DevocionalEnvio).order_by(
                DevocionalEnvio.sent_at.desc()
            ).limit(5).all()
            
            logger.warning(f"⚠️ Envio não encontrado para message_id: {message_id} (keyId: {data.get('keyId')})")
            logger.info(f"📋 Últimos 5 message_ids no banco:")
            for e in recent_envios:
                logger.info(f"   - message_id: {e.message_id}, phone: {e.recipient_phone}, status: {e.message_status}")
            
            return {
                "error": f"Envio não encontrado para message_id: {message_id}",
                "message_id_received": message_id,
                "key_id": data.get("keyId"),
                "recent_message_ids": [e.message_id for e in recent_envios if e.message_id]
            }
        
        # Converter timestamp para datetime
        from app.timezone_utils import now_brazil_naive
        event_time = now_brazil_naive()
        
        # Mapear status da Evolution API para nosso formato
        status_map = {
            "SERVER_ACK": ("sent", "sent"),
            "DELIVERY_ACK": ("delivered", "delivered"),
            "READ": ("read", "read")
        }
        
        mapped_status, db_status = status_map.get(status, (None, None))
        
        if not mapped_status:
            logger.warning(f"⚠️ Status desconhecido: {status} para message_id {message_id}")
            return {
                "error": f"Status desconhecido: {status}",
                "message_id": message_id,
                "status_received": status
            }
        
        logger.info(f"📊 Processando status: {status} -> {mapped_status}")
        
        # Atualizar status baseado no status recebido
        updated = False
        
        if status == "SERVER_ACK" and envio.message_status != "sent":
            envio.message_status = "sent"
            envio.status = "sent"
            updated = True
            logger.info(f"✅ Mensagem {message_id} enviada para {phone}")
        
        elif status == "DELIVERY_ACK" and envio.message_status not in ["delivered", "read"]:
            envio.message_status = "delivered"
            envio.delivered_at = event_time
            updated = True
            logger.info(f"✅ Mensagem {message_id} entregue para {phone}")
            
            # Atualizar engajamento: entregue mas não lido ainda
            # Não penalizar ainda, mas marcar como entregue
            update_engagement_from_delivered(db, phone, True)
        
        elif status == "READ":
            # READ é o mais importante - sempre atualizar
            if envio.message_status != "read":
                envio.message_status = "read"
                envio.read_at = event_time
                if not envio.delivered_at:
                    envio.delivered_at = event_time
                updated = True
                logger.info(f"✅✅ Mensagem {message_id} LIDA por {phone}")
                
                # Atualizar engajamento no banco
                update_engagement_from_read(db, phone, True)
            else:
                logger.debug(f"ℹ️ Mensagem {message_id} já estava marcada como lida")
        
        if updated:
            db.commit()
            logger.info(f"✅ Status atualizado para message_id {message_id}: status={mapped_status}")
            return {
                "success": True,
                "message_id": message_id,
                "status_updated": mapped_status,
                "status_received": status,
                "phone": phone
            }
        else:
            logger.debug(f"ℹ️ Status não atualizado (já estava em {envio.message_status}) para status={status}")
            return {
                "success": True,
                "message_id": message_id,
                "status": envio.message_status,
                "status_received": status,
                "already_updated": True
            }
    
    except Exception as e:
        logger.error(f"❌ Erro ao processar messages.update: {e}", exc_info=True)
        db.rollback()
        return {"error": str(e), "data": data}


def update_engagement_from_delivered(db: Session, phone: str, was_delivered: bool):
    """
    Atualiza score de engajamento baseado em entrega
    Se não aparecer "delivered", é arriscado (pode estar bloqueado)
    Salva no banco de dados
    """
    try:
        from app.database import ContactEngagement
        from app.timezone_utils import now_brazil_naive
        
        # Buscar ou criar registro de engajamento
        engagement = db.query(ContactEngagement).filter(
            ContactEngagement.phone == phone
        ).first()
        
        if not engagement:
            engagement = ContactEngagement(phone=phone, engagement_score=0.5)
            db.add(engagement)
        
        if was_delivered:
            engagement.total_delivered += 1
            engagement.last_delivered_date = now_brazil_naive()
            engagement.consecutive_not_delivered = 0
            logger.debug(f"✅ Engajamento: mensagem entregue para {phone}")
        else:
            engagement.consecutive_not_delivered += 1
            # Penalizar se não foi entregue
            engagement.engagement_score = max(0.0, engagement.engagement_score - 0.03)
        
        engagement.updated_at = now_brazil_naive()
        db.commit()
    except Exception as e:
        logger.error(f"❌ Erro ao atualizar engajamento (delivered): {e}", exc_info=True)
        db.rollback()


def update_engagement_from_read(db: Session, phone: str, was_read: bool):
    """
    Atualiza score de engajamento baseado em visualização
    Salva no banco de dados para persistência
    
    Args:
        db: Sessão do banco de dados
        phone: Número do telefone
        was_read: Se a mensagem foi lida
    """
    try:
        from app.database import ContactEngagement
        from app.timezone_utils import now_brazil_naive
        
        # Buscar ou criar registro de engajamento
        engagement = db.query(ContactEngagement).filter(
            ContactEngagement.phone == phone
        ).first()
        
        if not engagement:
            engagement = ContactEngagement(phone=phone, engagement_score=0.5)
            db.add(engagement)
        
        # Atualizar dados
        if was_read:
            engagement.total_read += 1
            engagement.last_read_date = now_brazil_naive()
            engagement.consecutive_not_read = 0
            
            # Aumentar score por visualização
            engagement.engagement_score = min(1.0, engagement.engagement_score + 0.05)
            
            logger.info(f"✅ Engajamento atualizado no banco para {phone}: score={engagement.engagement_score:.2f} (visualizou)")
        else:
            engagement.consecutive_not_read += 1
            # Diminuir score se não foi lida
            engagement.engagement_score = max(0.0, engagement.engagement_score - 0.02)
        
        engagement.updated_at = now_brazil_naive()
        db.commit()
        
        # Também atualizar no ShieldService (memória) para consistência
        from app.devocional_service_v2 import DevocionalServiceV2
        devocional_service = DevocionalServiceV2(db=db)
        if devocional_service.shield:
            devocional_service.shield.update_engagement(
                phone=phone,
                responded=False,
                is_devocional=True,
                was_read=was_read
            )
    except Exception as e:
        logger.error(f"❌ Erro ao atualizar engajamento no banco: {e}", exc_info=True)
        db.rollback()


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
