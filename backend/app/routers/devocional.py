"""
Endpoints para envio de devocionais
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Header
from sqlalchemy.orm import Session
from typing import List, Dict, Optional
from pydantic import BaseModel, Field
from datetime import datetime
from app.database import get_db, DevocionalEnvio, DevocionalContato, Devocional
from app.devocional_service import DevocionalService
from app.devocional_integration import devocional_integration
from app.config import settings
from datetime import datetime
import logging
import json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/devocional", tags=["devocional"])

# Instância do serviço
devocional_service = DevocionalService()


# Schemas
class ContatoCreate(BaseModel):
    phone: str = Field(..., description="Número do telefone")
    name: Optional[str] = Field(None, description="Nome do contato")


class ContatoResponse(BaseModel):
    id: int
    phone: str
    name: Optional[str]
    active: bool
    created_at: datetime
    last_sent: Optional[datetime]
    total_sent: int

    class Config:
        from_attributes = True


class EnvioRequest(BaseModel):
    message: Optional[str] = Field(None, description="Texto do devocional (opcional se devocional_id for fornecido)")
    devocional_id: Optional[int] = Field(None, description="ID do devocional salvo no banco (opcional se message for fornecido)")
    phone: Optional[str] = Field(None, description="Telefone específico para enviar (opcional)")
    contacts: Optional[List[Dict[str, str]]] = Field(
        None,
        description="Lista de contatos específicos. Se não fornecido, usa lista padrão"
    )
    delay: Optional[float] = Field(
        None,
        description="Delay entre mensagens em segundos (usa padrão se não fornecido)"
    )


class EnvioResponse(BaseModel):
    success: bool
    total: int
    sent: int
    failed: int
    results: List[Dict]


class StatsResponse(BaseModel):
    stats: Dict
    instance_status: Dict


@router.post("/send", response_model=EnvioResponse)
async def send_devocional(
    request: EnvioRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Envia devocional para lista de contatos
    
    - Valida payload
    - Aplica rate limiting
    - Envia com delay entre mensagens
    - Registra no banco de dados
    """
    try:
        # Obter lista de contatos
        if request.contacts:
            contacts = request.contacts
        else:
            # Buscar contatos ativos do banco
            db_contacts = db.query(DevocionalContato).filter(
                DevocionalContato.active == True
            ).all()
            
            if not db_contacts:
                raise HTTPException(
                    status_code=400,
                    detail="Nenhum contato ativo encontrado. Adicione contatos primeiro."
                )
            
            contacts = [
                {"phone": c.phone, "name": c.name}
                for c in db_contacts
            ]
        
        # Obter mensagem do devocional se devocional_id fornecido
        message = request.message
        if request.devocional_id and not message:
            # Buscar devocional do banco
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
        
        # Filtrar contatos se phone específico fornecido
        if request.phone:
            contacts = [c for c in contacts if c.get("phone") == request.phone]
            if not contacts:
                raise HTTPException(
                    status_code=404,
                    detail=f"Contato com telefone {request.phone} não encontrado"
                )
        
        # Enviar mensagens
        results = devocional_service.send_bulk_devocionais(
            contacts=contacts,
            message=message,
            delay=request.delay
        )
        
        # Registrar no banco de dados
        sent_count = 0
        failed_count = 0
        
        for i, result in enumerate(results):
            contact = contacts[i] if i < len(contacts) else {}
            
            envio = DevocionalEnvio(
                recipient_phone=contact.get('phone', ''),
                recipient_name=contact.get('name'),
                message_text=message,
                sent_at=result.timestamp,
                status=result.status.value,
                message_id=result.message_id,
                error_message=result.error,
                retry_count=result.retry_count
            )
            db.add(envio)
            
            # Atualizar contato
            if result.success:
                sent_count += 1
                db_contact = db.query(DevocionalContato).filter(
                    DevocionalContato.phone == contact.get('phone')
                ).first()
                
                if db_contact:
                    db_contact.last_sent = result.timestamp
                    db_contact.total_sent += 1
            else:
                failed_count += 1
        
        db.commit()
        
        # Preparar resposta
        results_data = [
            {
                "phone": contacts[i].get('phone') if i < len(contacts) else '',
                "name": contacts[i].get('name') if i < len(contacts) else None,
                "success": r.success,
                "status": r.status.value,
                "error": r.error,
                "message_id": r.message_id
            }
            for i, r in enumerate(results)
        ]
        
        return EnvioResponse(
            success=sent_count > 0,
            total=len(results),
            sent=sent_count,
            failed=failed_count,
            results=results_data
        )
    
    except Exception as e:
        logger.error(f"Erro ao enviar devocional: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao enviar devocional: {str(e)}")


@router.post("/send-single")
async def send_single_devocional(
    phone: str,
    message: str,
    name: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Envia devocional para um único contato
    """
    try:
        result = devocional_service.send_devocional(
            phone=phone,
            message=message,
            name=name,
            retry=True
        )
        
        # Registrar no banco
        envio = DevocionalEnvio(
            recipient_phone=phone,
            recipient_name=name,
            message_text=message,
            sent_at=result.timestamp,
            status=result.status.value,
            message_id=result.message_id,
            error_message=result.error,
            retry_count=result.retry_count
        )
        db.add(envio)
        db.commit()
        
        return {
            "success": result.success,
            "status": result.status.value,
            "message_id": result.message_id,
            "error": result.error
        }
    
    except Exception as e:
        logger.error(f"Erro ao enviar devocional único: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.get("/stats", response_model=StatsResponse)
async def get_stats():
    """
    Retorna estatísticas do serviço e status da instância
    """
    try:
        stats = devocional_service.get_stats()
        instance_status = devocional_service.check_instance_status()
        
        return StatsResponse(
            stats=stats,
            instance_status=instance_status
        )
    except Exception as e:
        logger.error(f"Erro ao obter estatísticas: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.post("/contatos", response_model=ContatoResponse)
async def create_contato(
    contato: ContatoCreate,
    db: Session = Depends(get_db)
):
    """
    Adiciona um novo contato à lista de devocionais
    """
    try:
        # Verificar se já existe
        existing = db.query(DevocionalContato).filter(
            DevocionalContato.phone == contato.phone
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Contato com telefone {contato.phone} já existe"
            )
        
        db_contato = DevocionalContato(
            phone=contato.phone,
            name=contato.name,
            active=True
        )
        db.add(db_contato)
        db.commit()
        db.refresh(db_contato)
        
        return ContatoResponse.model_validate(db_contato)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao criar contato: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.get("/contatos", response_model=List[ContatoResponse])
async def list_contatos(
    active_only: bool = True,
    db: Session = Depends(get_db)
):
    """
    Lista todos os contatos
    """
    try:
        query = db.query(DevocionalContato)
        
        if active_only:
            query = query.filter(DevocionalContato.active == True)
        
        contatos = query.order_by(DevocionalContato.name, DevocionalContato.phone).all()
        
        return [ContatoResponse.model_validate(c) for c in contatos]
    
    except Exception as e:
        logger.error(f"Erro ao listar contatos: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.put("/contatos/{contato_id}/toggle")
async def toggle_contato(
    contato_id: int,
    db: Session = Depends(get_db)
):
    """
    Ativa/desativa um contato
    """
    try:
        contato = db.query(DevocionalContato).filter(
            DevocionalContato.id == contato_id
        ).first()
        
        if not contato:
            raise HTTPException(status_code=404, detail="Contato não encontrado")
        
        contato.active = not contato.active
        db.commit()
        
        return {
            "id": contato.id,
            "phone": contato.phone,
            "active": contato.active
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao alterar contato: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.delete("/contatos/{contato_id}")
async def delete_contato(
    contato_id: int,
    db: Session = Depends(get_db)
):
    """
    Remove um contato
    """
    try:
        contato = db.query(DevocionalContato).filter(
            DevocionalContato.id == contato_id
        ).first()
        
        if not contato:
            raise HTTPException(status_code=404, detail="Contato não encontrado")
        
        db.delete(contato)
        db.commit()
        
        return {"message": "Contato removido com sucesso"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao remover contato: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.get("/envios")
async def list_envios(
    skip: int = 0,
    limit: int = 50,
    status: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Lista histórico de envios
    """
    try:
        query = db.query(DevocionalEnvio)
        
        if status:
            query = query.filter(DevocionalEnvio.status == status)
        
        envios = query.order_by(
            DevocionalEnvio.sent_at.desc()
        ).offset(skip).limit(limit).all()
        
        return [
            {
                "id": e.id,
                "recipient_phone": e.recipient_phone,
                "recipient_name": e.recipient_name,
                "sent_at": e.sent_at.isoformat() if e.sent_at else None,
                "status": e.status,
                "message_id": e.message_id,
                "error_message": e.error_message,
                "retry_count": e.retry_count
            }
            for e in envios
        ]
    
    except Exception as e:
        logger.error(f"Erro ao listar envios: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


# ========== ENDPOINTS DE INTEGRAÇÃO ==========

class VersiculoSchema(BaseModel):
    """Schema para versículo"""
    texto: Optional[str] = None
    referencia: Optional[str] = None


class WebhookDevocional(BaseModel):
    """Schema para receber devocional via webhook"""
    text: Optional[str] = Field(None, description="Texto do devocional formatado")
    content: Optional[str] = Field(None, description="Conteúdo do devocional (alternativo)")
    message: Optional[str] = Field(None, description="Mensagem (alternativo)")
    title: Optional[str] = Field(None, description="Título do devocional (sem emoji)")
    date: Optional[str] = Field(None, description="Data no formato YYYY-MM-DD")
    versiculo_principal: Optional[VersiculoSchema] = Field(None, description="Versículo principal")
    versiculo_apoio: Optional[VersiculoSchema] = Field(None, description="Versículo de apoio")
    metadata: Optional[Dict] = Field(None, description="Metadados adicionais (autor, tema, palavras_chave)")


@router.post("/webhook")
async def receive_devocional_webhook(
    data: WebhookDevocional,
    db: Session = Depends(get_db),
    x_webhook_secret: Optional[str] = Header(None, alias="X-Webhook-Secret")
):
    """
    Webhook para receber devocionais da automação (n8n, etc)
    
    Use este endpoint no n8n para enviar devocionais gerados pela IA
    
    Headers opcionais:
    - X-Webhook-Secret: Secret para autenticação (se configurado)
    """
    try:
        # Verificar secret se configurado
        if settings.DEVOCIONAL_WEBHOOK_SECRET:
            if not x_webhook_secret or x_webhook_secret != settings.DEVOCIONAL_WEBHOOK_SECRET:
                raise HTTPException(status_code=401, detail="Webhook secret inválido")
        
        # Extrair texto do devocional
        content = data.text or data.content or data.message
        
        if not content:
            raise HTTPException(status_code=400, detail="Texto do devocional não fornecido")
        
        # Processar data
        from datetime import datetime as dt
        devocional_date = None
        if data.date:
            try:
                devocional_date = dt.strptime(data.date, "%Y-%m-%d")
            except:
                devocional_date = dt.now()
        else:
            devocional_date = dt.now()
        
        # Salvar no banco com campos estruturados
        db_devocional = Devocional(
            content=content,
            title=data.title,
            date=devocional_date,
            source="webhook",
            versiculo_principal_texto=data.versiculo_principal.texto if data.versiculo_principal else None,
            versiculo_principal_referencia=data.versiculo_principal.referencia if data.versiculo_principal else None,
            versiculo_apoio_texto=data.versiculo_apoio.texto if data.versiculo_apoio else None,
            versiculo_apoio_referencia=data.versiculo_apoio.referencia if data.versiculo_apoio else None,
            autor=data.metadata.get("autor", "Alex e Daniela Mantovani") if data.metadata else "Alex e Daniela Mantovani",
            tema=data.metadata.get("tema") if data.metadata else None,
            palavras_chave=data.metadata.get("palavras_chave", []) if data.metadata and data.metadata.get("palavras_chave") else None,
            metadata_json=json.dumps(data.metadata) if data.metadata else None
        )
        
        # Sempre criar um novo devocional (permite múltiplos devocionais por dia)
        # Se quiser atualizar um existente, use o endpoint específico de atualização
        db.add(db_devocional)
        db.commit()
        db.refresh(db_devocional)
        devocional = db_devocional
        
        if devocional:
            logger.info(f"Devocional recebido via webhook e salvo (ID: {devocional.id})")
            return {
                "success": True,
                "message": "Devocional recebido e salvo com sucesso",
                "devocional_id": devocional.id,
                "date": devocional.date.isoformat() if devocional.date else None
            }
        else:
            raise HTTPException(status_code=500, detail="Erro ao salvar devocional")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao processar webhook: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.get("/today")
async def get_today_devocional(db: Session = Depends(get_db)):
    """
    Retorna o devocional de hoje
    """
    try:
        devocional = devocional_integration.get_today_devocional()
        
        if devocional:
            # Buscar objeto completo do banco
            today = datetime.now().date()
            db_devocional = db.query(Devocional).filter(
                Devocional.date >= datetime.combine(today, datetime.min.time()),
                Devocional.date < datetime.combine(today, datetime.max.time())
            ).order_by(Devocional.created_at.desc()).first()
            
            if db_devocional:
                return {
                    "id": db_devocional.id,
                    "content": db_devocional.content,
                    "title": db_devocional.title,
                    "date": db_devocional.date.isoformat() if db_devocional.date else None,
                    "source": db_devocional.source,
                    "sent": db_devocional.sent,
                    "metadata": json.loads(db_devocional.metadata_json) if db_devocional.metadata_json else None
                }
        
        return {"message": "Nenhum devocional encontrado para hoje"}
    
    except Exception as e:
        logger.error(f"Erro ao buscar devocional de hoje: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.post("/fetch")
async def fetch_devocional_from_api():
    """
    Força busca de devocional da API externa
    Útil para testar integração ou buscar manualmente
    """
    try:
        if settings.DEVOCIONAL_FETCH_MODE != "api":
            raise HTTPException(
                status_code=400,
                detail=f"Modo de busca não é 'api' (atual: {settings.DEVOCIONAL_FETCH_MODE})"
            )
        
        content = devocional_integration.fetch_and_save()
        
        if content:
            return {
                "success": True,
                "message": "Devocional buscado e salvo com sucesso",
                "content": content[:200] + "..." if len(content) > 200 else content
            }
        else:
            return {
                "success": False,
                "message": "Nenhum devocional encontrado na API"
            }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao buscar devocional da API: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.get("/horario")
async def get_current_time():
    """
    Retorna o horário atual em São Paulo e UTC para verificação
    """
    from zoneinfo import ZoneInfo
    
    sao_paulo_tz = ZoneInfo("America/Sao_Paulo")
    utc_tz = ZoneInfo("UTC")
    
    now_sp = datetime.now(sao_paulo_tz)
    now_utc = datetime.now(utc_tz)
    
    # Determinar saudação
    hour = now_sp.hour
    if 5 <= hour < 12:
        greeting = "Bom dia"
    elif 12 <= hour < 18:
        greeting = "Boa tarde"
    else:
        greeting = "Boa noite"
    
    return {
        "horario_sao_paulo": now_sp.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "horario_utc": now_utc.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "saudacao_atual": greeting,
        "hora_sao_paulo": now_sp.hour,
        "hora_utc": now_utc.hour,
        "diferenca_horas": (now_utc.hour - now_sp.hour) % 24,
        "send_time_configurado": settings.DEVOCIONAL_SEND_TIME
    }


@router.get("/devocionais")
async def list_devocionais(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """
    Lista histórico de devocionais salvos
    """
    try:
        devocionais = db.query(Devocional).order_by(
            Devocional.date.desc()
        ).offset(skip).limit(limit).all()
        
        return [
            {
                "id": d.id,
                "title": d.title,
                "content": d.content[:200] + "..." if len(d.content) > 200 else d.content,
                "date": d.date.isoformat() if d.date else None,
                "source": d.source,
                "sent": d.sent,
                "sent_at": d.sent_at.isoformat() if d.sent_at else None,
                "created_at": d.created_at.isoformat() if d.created_at else None,
                "metadata": json.loads(d.metadata_json) if d.metadata_json else None
            }
            for d in devocionais
        ]
    
    except Exception as e:
        logger.error(f"Erro ao listar devocionais: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")

