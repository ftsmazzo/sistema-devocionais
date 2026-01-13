"""
Endpoints para envio de devocionais
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Header, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
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
import csv
import io
import re
import base64
import requests
import asyncio
from app.instance_manager import EvolutionInstance, InstanceStatus

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
    engagement_score: Optional[float] = None  # Score de engajamento (0.0 a 1.0)
    instance_name: Optional[str] = None

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
                {"id": c.id, "phone": c.phone, "name": c.name}
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
        from app.timezone_utils import now_brazil_naive
        sent_count = 0
        failed_count = 0
        
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
                    db_contact.last_sent = timestamp_naive
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
        from app.timezone_utils import now_brazil_naive
        timestamp_naive = result.timestamp.replace(tzinfo=None) if result.timestamp and result.timestamp.tzinfo else (now_brazil_naive() if result.timestamp is None else result.timestamp)
        
        envio = DevocionalEnvio(
            recipient_phone=phone,
            recipient_name=name,
            message_text=message,
            sent_at=timestamp_naive,
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


@router.post("/send-custom")
async def send_custom_message(
    message: str = Form(...),
    media_file: Optional[UploadFile] = File(None),
    media_type: Optional[str] = Form(None),  # 'image', 'video' ou 'audio'
    contacts: Optional[str] = Form(None),  # JSON string de contatos
    delay: Optional[float] = Form(None),
    db: Session = Depends(get_db)
):
    """
    Envia mensagem personalizada (texto + opcionalmente imagem/vídeo/áudio) para contatos
    """
    try:
        # Obter lista de contatos
        if contacts:
            try:
                contacts_list = json.loads(contacts)
            except:
                raise HTTPException(status_code=400, detail="Formato inválido de contatos")
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
            
            contacts_list = [
                {"id": c.id, "phone": c.phone, "name": c.name}
                for c in db_contacts
            ]
        
        # Processar mídia se fornecida
        media_base64 = None
        media_mimetype = None
        
        logger.info(f"📎 Processando mídia: media_file={media_file is not None}, media_type={media_type}")
        
        if media_file:
            # Validar tipo de arquivo
            file_content = await media_file.read()
            file_size = len(file_content)
            
            logger.info(f"📎 Arquivo recebido: nome={media_file.filename}, tamanho={file_size} bytes, content_type={media_file.content_type}, media_type={media_type}")
            
            # Limite de tamanho: 16MB para imagens, 64MB para vídeos, 16MB para áudios
            if media_type == 'image' and file_size > 16 * 1024 * 1024:
                raise HTTPException(status_code=400, detail="Imagem muito grande. Máximo: 16MB")
            if media_type == 'video' and file_size > 64 * 1024 * 1024:
                raise HTTPException(status_code=400, detail="Vídeo muito grande. Máximo: 64MB")
            if media_type == 'audio' and file_size > 16 * 1024 * 1024:
                raise HTTPException(status_code=400, detail="Áudio muito grande. Máximo: 16MB")
            
            # Converter para base64
            media_base64 = base64.b64encode(file_content).decode('utf-8')
            logger.info(f"✅ Mídia convertida para base64: tamanho={len(media_base64)} caracteres")
            
            # Determinar mimetype baseado no tipo de mídia
            if media_type == 'audio':
                # WhatsApp/Evolution API aceita: audio/ogg;codecs=opus, audio/mpeg, audio/mp4, audio/amr, audio/aac
                # Formato preferido: audio/ogg;codecs=opus
                content_type = (media_file.content_type or '').lower()
                filename = (media_file.filename or '').lower()
                
                # Detectar formato pelo content_type ou filename
                # WhatsApp aceita melhor: audio/mpeg (MP3), audio/ogg, audio/mp4, audio/amr, audio/aac
                # IMPORTANTE: Usar mimetype simples sem codecs para melhor compatibilidade
                if 'mp3' in content_type or 'mpeg' in content_type or 'mp3' in filename:
                    media_mimetype = 'audio/mpeg'  # MP3 - mais compatível
                elif 'ogg' in content_type or 'opus' in content_type or 'ogg' in filename or 'opus' in filename:
                    # OGG/Opus: usar mimetype simples sem codecs
                    media_mimetype = 'audio/ogg'  # Sem codecs para melhor compatibilidade
                elif 'mp4' in content_type or 'mp4' in filename or 'm4a' in filename:
                    media_mimetype = 'audio/mp4'
                elif 'amr' in content_type or 'amr' in filename:
                    media_mimetype = 'audio/amr'  # AMR - formato nativo do WhatsApp
                elif 'aac' in content_type or 'aac' in filename:
                    media_mimetype = 'audio/aac'
                elif 'webm' in content_type or 'webm' in filename:
                    # WebM: tentar como OGG (mesmo codec opus)
                    media_mimetype = 'audio/ogg'
                else:
                    # Padrão: MP3 (mais compatível com WhatsApp)
                    media_mimetype = 'audio/mpeg'
            elif media_type == 'image':
                media_mimetype = media_file.content_type or 'image/jpeg'
            else:  # video
                media_mimetype = media_file.content_type or 'video/mp4'
        
        # Obter instância para envio usando InstanceManager com banco de dados
        from app.instance_manager import InstanceManager
        instance_manager = InstanceManager(db=db)
        
        if not instance_manager.instances:
            raise HTTPException(
                status_code=400,
                detail="Nenhuma instância disponível. Configure instâncias primeiro."
            )
        
        # Selecionar instância (usar a primeira ativa)
        instance = None
        for inst in instance_manager.instances:
            if inst.enabled and inst.status == InstanceStatus.ACTIVE:
                instance = inst
                break
        
        if not instance:
            raise HTTPException(
                status_code=400,
                detail="Nenhuma instância ativa e conectada disponível"
            )
        
        # Enviar mensagens
        from app.timezone_utils import now_brazil_naive
        sent_count = 0
        failed_count = 0
        results_data = []
        
        for contact in contacts_list:
            try:
                phone = contact.get('phone', '')
                name = contact.get('name')
                
                # Formatar telefone
                phone_clean = ''.join(filter(str.isdigit, phone))
                if not phone_clean.startswith('55') and len(phone_clean) == 11:
                    phone_clean = '55' + phone_clean
                
                # Personalizar mensagem
                personalized_message = message
                if name:
                    personalized_message = f"Olá {name}! 👋\n\n{message}"
                
                # Headers
                headers = {
                    "Content-Type": "application/json",
                    "apikey": instance.api_key
                }
                
                api_instance_name = getattr(instance, 'api_instance_name', None) or instance.name
                
                # Enviar com ou sem mídia
                audio_sent = False
                text_sent = False
                error_msg = None
                
                logger.info(f"📤 Preparando envio para {phone}: media_base64={'sim' if media_base64 else 'não'}, media_type={media_type}, message={bool(personalized_message)}")
                
                if media_base64:
                    logger.info(f"📎 Enviando mídia: tipo={media_type}, mimetype={media_mimetype}, tamanho_base64={len(media_base64)} chars")
                    
                    # Para áudio, enviar mensagem de texto primeiro (se houver)
                    if personalized_message and media_type == "audio":
                        logger.info(f"📝 Enviando texto antes do áudio para {phone}")
                        text_url = f"{instance.api_url}/message/sendText/{api_instance_name}"
                        text_payload = {
                            "number": phone_clean,
                            "text": personalized_message
                        }
                        text_response = requests.post(text_url, json=text_payload, headers=headers, timeout=30)
                        text_sent = text_response.status_code in [200, 201]
                        if not text_sent:
                            logger.warning(f"⚠️ Falha ao enviar texto antes do áudio para {phone}: {text_response.text[:200]}")
                        else:
                            logger.info(f"✅ Texto enviado com sucesso para {phone}")
                    
                    # Enviar mídia
                    url = f"{instance.api_url}/message/sendMedia/{api_instance_name}"
                    
                    # Evolution API aceita apenas: image, document, video, audio
                    # Usar "audio" para áudio (não "ptt")
                    payload_mediatype = media_type  # Já está correto: "audio", "image" ou "video"
                    
                    # Evolution API espera base64 direto OU URL pública
                    # Garantir que o base64 está limpo (sem espaços, quebras de linha, etc)
                    media_base64_clean = media_base64.strip().replace('\n', '').replace('\r', '').replace(' ', '')
                    
                    payload = {
                        "number": phone_clean,
                        "mediatype": payload_mediatype,
                        "media": media_base64_clean,
                        "mimetype": media_mimetype,
                    }
                    
                    # Para áudio, adicionar fileName se disponível
                    if media_type == "audio" and media_file and media_file.filename:
                        payload["fileName"] = media_file.filename
                    
                    # Adicionar caption apenas se houver mensagem e não for áudio
                    if personalized_message and media_type != "audio":
                        payload["caption"] = personalized_message
                    
                    logger.info(f"📤 Enviando mídia ({media_type}) para {phone}: mediatype={payload_mediatype}, mimetype={media_mimetype}")
                    response = requests.post(url, json=payload, headers=headers, timeout=60)
                    audio_sent = response.status_code in [200, 201]
                    
                    if not audio_sent:
                        error_msg = response.text[:200] if response.text else f"HTTP {response.status_code}"
                        logger.error(f"❌ Falha ao enviar mídia ({media_type}) para {phone}: {error_msg}")
                        logger.error(f"   Response status: {response.status_code}, Response text: {response.text[:500]}")
                    else:
                        logger.info(f"✅ Mídia ({media_type}) enviada com sucesso para {phone}")
                        try:
                            response_data = response.json()
                            logger.info(f"   Response data: {str(response_data)[:200]}")
                        except:
                            pass
                    
                    # Se for áudio, considerar sucesso apenas se o áudio foi enviado
                    # Se o texto também foi enviado, ambos devem ter sucesso
                    if media_type == "audio":
                        if personalized_message:
                            success = text_sent and audio_sent
                            if not success:
                                error_msg = f"Texto: {'OK' if text_sent else 'Falhou'}, Áudio: {'OK' if audio_sent else 'Falhou'}"
                                logger.error(f"❌ Envio parcial para {phone}: {error_msg}")
                        else:
                            success = audio_sent
                    else:
                        success = audio_sent
                else:
                    logger.info(f"📝 Enviando apenas texto para {phone} (sem mídia)")
                    # Enviar apenas texto
                    url = f"{instance.api_url}/message/sendText/{api_instance_name}"
                    payload = {
                        "number": phone_clean,
                        "text": personalized_message
                    }
                    
                    response = requests.post(url, json=payload, headers=headers, timeout=60)
                    success = response.status_code in [200, 201]
                    text_sent = success
                    if not success:
                        error_msg = response.text[:200] if response.text else f"HTTP {response.status_code}"
                        logger.error(f"❌ Falha ao enviar texto para {phone}: {error_msg}")
                
                result_data = {
                    "phone": phone,
                    "name": name,
                    "success": success,
                    "status": "sent" if success else "failed",
                    "error": error_msg,
                    "message_id": None
                }
                
                if success:
                    try:
                        response_json = response.json()
                        result_data["message_id"] = response_json.get("key", {}).get("id") if isinstance(response_json, dict) else None
                    except:
                        pass
                    sent_count += 1
                else:
                    failed_count += 1
                
                results_data.append(result_data)
                
                # Registrar no banco
                timestamp_naive = now_brazil_naive()
                envio = DevocionalEnvio(
                    recipient_phone=phone,
                    recipient_name=name,
                    message_text=personalized_message,
                    sent_at=timestamp_naive,
                    status=result_data["status"],
                    message_id=result_data.get("message_id"),
                    error_message=result_data.get("error"),
                    retry_count=0
                )
                db.add(envio)
                
                # Atualizar contato
                if success:
                    db_contact = db.query(DevocionalContato).filter(
                        DevocionalContato.phone == phone
                    ).first()
                    
                    if db_contact:
                        db_contact.last_sent = timestamp_naive
                        db_contact.total_sent = (db_contact.total_sent or 0) + 1
                
                # Delay entre mensagens
                if delay and delay > 0:
                    await asyncio.sleep(delay)
                elif not delay:
                    # Usar delay padrão
                    await asyncio.sleep(settings.DELAY_BETWEEN_MESSAGES or 3.0)
                
            except Exception as e:
                logger.error(f"Erro ao enviar mensagem para {contact.get('phone')}: {e}", exc_info=True)
                failed_count += 1
                results_data.append({
                    "phone": contact.get('phone', ''),
                    "name": contact.get('name'),
                    "success": False,
                    "status": "failed",
                    "error": str(e)[:200],
                    "message_id": None
                })
        
        db.commit()
        
        return {
            "success": sent_count > 0,
            "total": len(contacts_list),
            "sent": sent_count,
            "failed": failed_count,
            "results": results_data
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao enviar mensagem personalizada: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao enviar mensagem: {str(e)}")


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
    active_only: Optional[bool] = None,
    skip: int = 0,
    limit: int = 1000,
    db: Session = Depends(get_db)
):
    """
    Lista todos os contatos com score de engajamento
    SIMPLIFICADO: Retorna todos os contatos primeiro, depois calcula score
    """
    try:
        # DEBUG: Verificar conexão e tabela
        logger.info(f"🔍 Buscando contatos: active_only={active_only}, skip={skip}, limit={limit}")
        
        # Query simples - CORREÇÃO: active_only=False significa TODOS (não filtrar)
        query = db.query(DevocionalContato)
        
        # CORREÇÃO: Se active_only é False ou None, retornar TODOS
        # Se active_only é True, retornar apenas ativos
        if active_only is True:
            query = query.filter(DevocionalContato.active == True)
        # Se active_only é False ou None, não filtrar (retornar todos)
        
        # DEBUG: Contar total antes de filtrar
        try:
            total_count = db.query(DevocionalContato).count()
            logger.info(f"📊 Total de contatos na tabela 'devocional_contatos': {total_count}")
        except Exception as count_error:
            logger.error(f"❌ Erro ao contar contatos: {count_error}", exc_info=True)
            total_count = 0
        
        # Tentar query direta também
        try:
            from sqlalchemy import text
            direct_count = db.execute(text("SELECT COUNT(*) FROM devocional_contatos")).scalar()
            logger.info(f"📊 Contagem direta via SQL: {direct_count}")
        except Exception as sql_error:
            logger.error(f"❌ Erro na query SQL direta: {sql_error}", exc_info=True)
        
        contatos = query.order_by(DevocionalContato.name, DevocionalContato.phone).offset(skip).limit(limit).all()
        
        logger.info(f"📋 Encontrados {len(contatos)} contatos após filtros")
        
        if not contatos:
            # Se não encontrou, tentar sem filtros para debug
            try:
                all_contatos = db.query(DevocionalContato).all()
                logger.warning(f"⚠️ Nenhum contato encontrado com filtros! Total sem filtros: {len(all_contatos)}")
                if all_contatos:
                    logger.info(f"📋 Primeiros 3 contatos encontrados: {[(c.id, c.phone, c.name, c.active) for c in all_contatos[:3]]}")
                else:
                    logger.error(f"❌ NENHUM contato encontrado mesmo sem filtros! Verifique a tabela 'devocional_contatos'")
            except Exception as debug_error:
                logger.error(f"❌ Erro ao buscar contatos para debug: {debug_error}", exc_info=True)
            return []
        
        from app.database import ContactEngagement
        
        result = []
        for contato in contatos:
            try:
                # Buscar score do ContactEngagement (se existir)
                engagement_db = db.query(ContactEngagement).filter(
                    ContactEngagement.phone == contato.phone
                ).first()
                
                # Sistema de pontos (0-100)
                engagement_score = None
                if engagement_db and engagement_db.engagement_score is not None:
                    engagement_score = float(engagement_db.engagement_score)
                else:
                    # Se não tem registro, criar com 100 pontos iniciais
                    from app.engagement_service import get_or_create_engagement
                    engagement = get_or_create_engagement(db, contato.phone)
                    engagement_score = float(engagement.engagement_score)
                
                # Buscar última instância usada
                last_envio = db.query(DevocionalEnvio).filter(
                    DevocionalEnvio.recipient_phone == contato.phone
                ).order_by(DevocionalEnvio.sent_at.desc()).first()
                
                instance_name = last_envio.instance_name if last_envio else None
                
                # Criar resposta simples
                result.append(ContatoResponse(
                    id=contato.id,
                    phone=contato.phone,
                    name=contato.name,
                    active=contato.active,
                    created_at=contato.created_at,
                    last_sent=contato.last_sent,
                    total_sent=contato.total_sent or 0,
                    engagement_score=round(engagement_score, 1) if engagement_score is not None else None,
                    instance_name=instance_name
                ))
            except Exception as e:
                logger.error(f"❌ Erro ao processar contato {contato.phone}: {e}", exc_info=True)
                # Retornar contato mesmo com erro
                result.append(ContatoResponse(
                    id=contato.id,
                    phone=contato.phone,
                    name=contato.name,
                    active=contato.active,
                    created_at=contato.created_at,
                    last_sent=contato.last_sent,
                    total_sent=contato.total_sent or 0,
                    engagement_score=0.5,
                    instance_name=None
                ))
        
        logger.info(f"✅ Retornando {len(result)} contatos")
        return result
    
    except Exception as e:
        logger.error(f"❌ Erro ao listar contatos: {e}", exc_info=True)
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


def sanitize_phone(phone: str) -> Optional[str]:
    """
    Sanitiza e valida um número de telefone.
    Remove caracteres não numéricos e valida formato básico.
    """
    if not phone:
        return None
    
    # Remover todos os caracteres não numéricos
    phone_clean = re.sub(r'[^\d]', '', str(phone).strip())
    
    # Validar: deve ter pelo menos 10 dígitos (formato mínimo)
    if len(phone_clean) < 10:
        return None
    
    # Se não começar com código do país, assumir Brasil (55)
    if len(phone_clean) == 10 or len(phone_clean) == 11:
        # Formato brasileiro sem código do país: adicionar 55
        phone_clean = '55' + phone_clean
    
    return phone_clean


def sanitize_name(name: str) -> Optional[str]:
    """
    Sanitiza um nome, removendo espaços extras e caracteres inválidos.
    """
    if not name:
        return None
    
    # Remover espaços extras e caracteres de controle
    name_clean = ' '.join(str(name).strip().split())
    
    # Limitar tamanho
    if len(name_clean) > 200:
        name_clean = name_clean[:200]
    
    return name_clean if name_clean else None


@router.post("/contatos/import-csv")
async def import_contatos_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Importa contatos de um arquivo CSV.
    
    O CSV pode ter campos extras que serão ignorados.
    Apenas os campos 'phone' (ou 'telefone') e 'name' (ou 'nome') são processados.
    
    Formato esperado:
    - Primeira linha pode ser header (será ignorada se contiver 'phone', 'telefone', 'name', 'nome')
    - Colunas: telefone (obrigatório), nome (opcional)
    - Campos extras são ignorados automaticamente
    """
    try:
        # Verificar se é CSV
        if not file.filename.endswith('.csv'):
            raise HTTPException(status_code=400, detail="Arquivo deve ser CSV (.csv)")
        
        # Ler conteúdo do arquivo
        contents = await file.read()
        text = contents.decode('utf-8-sig')  # utf-8-sig remove BOM se existir
        
        # Processar CSV
        csv_reader = csv.reader(io.StringIO(text))
        rows = list(csv_reader)
        
        if not rows:
            raise HTTPException(status_code=400, detail="Arquivo CSV vazio")
        
        # Detectar header (primeira linha pode ser header)
        header_row = rows[0]
        has_header = any(
            col.lower() in ['phone', 'telefone', 'name', 'nome', 'nome_completo', 'nome completo']
            for col in header_row
        )
        
        # Determinar índices das colunas
        phone_idx = None
        name_idx = None
        
        if has_header:
            # Procurar colunas no header
            for idx, col in enumerate(header_row):
                col_lower = col.lower().strip()
                if col_lower in ['phone', 'telefone', 'celular', 'whatsapp']:
                    phone_idx = idx
                elif col_lower in ['name', 'nome', 'nome_completo', 'nome completo']:
                    name_idx = idx
            
            # Se não encontrou no header, assumir primeira coluna = phone, segunda = name
            if phone_idx is None:
                phone_idx = 0
            if name_idx is None:
                name_idx = 1 if len(header_row) > 1 else None
            
            # Pular header
            data_rows = rows[1:]
        else:
            # Sem header: primeira coluna = phone, segunda = name
            phone_idx = 0
            name_idx = 1 if len(rows[0]) > 1 else None
            data_rows = rows
        
        if phone_idx is None:
            raise HTTPException(status_code=400, detail="Não foi possível identificar a coluna de telefone no CSV")
        
        # Processar linhas
        imported = 0
        skipped = 0
        errors = []
        processed_phones = set()  # Rastrear telefones já processados neste CSV
        
        for row_idx, row in enumerate(data_rows, start=2 if has_header else 1):
            try:
                # Extrair phone e name (ignorar outros campos)
                phone_raw = row[phone_idx] if phone_idx < len(row) else None
                name_raw = row[name_idx] if name_idx is not None and name_idx < len(row) else None
                
                # Sanitizar
                phone = sanitize_phone(phone_raw) if phone_raw else None
                name = sanitize_name(name_raw) if name_raw else None
                
                # Validar phone obrigatório
                if not phone:
                    skipped += 1
                    errors.append(f"Linha {row_idx}: Telefone inválido ou ausente")
                    continue
                
                # Verificar duplicata no próprio CSV
                if phone in processed_phones:
                    skipped += 1
                    errors.append(f"Linha {row_idx}: Telefone {phone} duplicado no CSV")
                    continue
                
                processed_phones.add(phone)
                
                # Verificar se já existe no banco
                existing = db.query(DevocionalContato).filter(
                    DevocionalContato.phone == phone
                ).first()
                
                if existing:
                    # Atualizar nome se fornecido e diferente
                    if name and name != existing.name:
                        existing.name = name
                        try:
                            db.commit()
                        except Exception as e:
                            db.rollback()
                            logger.warning(f"Erro ao atualizar nome do contato {phone}: {e}")
                    skipped += 1
                    continue
                
                # Criar novo contato
                db_contato = DevocionalContato(
                    phone=phone,
                    name=name,
                    active=True
                )
                db.add(db_contato)
                
                # Tentar commit individual para detectar duplicatas imediatamente
                try:
                    db.commit()
                    imported += 1
                except IntegrityError as commit_err:
                    db.rollback()
                    # Verificar se é erro de constraint única (duplicata)
                    error_str = str(commit_err.orig) if hasattr(commit_err, 'orig') else str(commit_err)
                    if 'UniqueViolation' in error_str or 'duplicate key' in error_str.lower() or 'devocional_contatos_phone_idx' in error_str:
                        # Contato já existe, pular
                        db.expunge(db_contato)
                        skipped += 1
                        errors.append(f"Linha {row_idx}: Telefone {phone} já existe no banco")
                        logger.debug(f"Telefone {phone} já existe (detectado no commit): {commit_err}")
                    else:
                        # Erro inesperado, re-raise
                        logger.error(f"Erro de integridade inesperado ao salvar contato {phone}: {commit_err}")
                        raise
                except Exception as commit_err:
                    db.rollback()
                    logger.error(f"Erro inesperado ao salvar contato {phone}: {commit_err}")
                    raise
                
            except Exception as e:
                # Verificar se é erro de constraint única
                error_str = str(e)
                if 'UniqueViolation' in error_str or 'duplicate key' in error_str.lower():
                    skipped += 1
                    errors.append(f"Linha {row_idx}: Telefone já existe no banco")
                    logger.warning(f"Telefone duplicado na linha {row_idx}: {e}")
                    # Rollback apenas desta transação
                    try:
                        db.rollback()
                    except:
                        pass
                else:
                    skipped += 1
                    errors.append(f"Linha {row_idx}: {str(e)}")
                    logger.warning(f"Erro ao processar linha {row_idx} do CSV: {e}")
                continue
        
        # Não precisa de commit final pois já fazemos commit individual
        
        logger.info(f"✅ Importação CSV concluída: {imported} importados, {skipped} ignorados")
        
        return {
            "imported": imported,
            "skipped": skipped,
            "errors": errors[:50]  # Limitar a 50 erros para não sobrecarregar resposta
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao importar CSV: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao processar CSV: {str(e)}")


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
        
        result = []
        for e in envios:
            envio_dict = {
                "id": e.id,
                "devocional_id": e.devocional_id,
                "recipient_phone": e.recipient_phone,
                "recipient_name": e.recipient_name,
                "message": e.message_text,  # Campo correto do modelo
                "sent_at": e.sent_at.isoformat() if e.sent_at else None,
                "created_at": e.sent_at.isoformat() if e.sent_at else None,  # Usar sent_at como created_at se não houver created_at
                "status": e.status,
                "instance_name": e.instance_name,
                "message_id": e.message_id,
                "error_message": e.error_message,
                "error": e.error_message,  # Alias para compatibilidade
                "retry_count": e.retry_count,
                # Campos de status detalhado
                "message_status": e.message_status if hasattr(e, 'message_status') else None,  # sent, delivered, read
                "delivered_at": e.delivered_at.isoformat() if hasattr(e, 'delivered_at') and e.delivered_at else None,
                "read_at": e.read_at.isoformat() if hasattr(e, 'read_at') and e.read_at else None,
            }
            result.append(envio_dict)
        
        return result
    
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
            from app.timezone_utils import today_brazil
            today = today_brazil().date()
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
                "content": d.content,  # Retornar conteúdo completo
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


@router.get("/devocionais/{devocional_id}")
async def get_devocional_by_id(
    devocional_id: int,
    db: Session = Depends(get_db)
):
    """
    Busca um devocional específico por ID com conteúdo completo
    """
    try:
        devocional = db.query(Devocional).filter(
            Devocional.id == devocional_id
        ).first()
        
        if not devocional:
            raise HTTPException(
                status_code=404,
                detail=f"Devocional com ID {devocional_id} não encontrado"
            )
        
        return {
            "id": devocional.id,
            "title": devocional.title,
            "content": devocional.content,  # Conteúdo completo
            "date": devocional.date.isoformat() if devocional.date else None,
            "source": devocional.source,
            "sent": devocional.sent,
            "sent_at": devocional.sent_at.isoformat() if devocional.sent_at else None,
            "created_at": devocional.created_at.isoformat() if devocional.created_at else None,
            "versiculo_principal_texto": devocional.versiculo_principal_texto,
            "versiculo_principal_referencia": devocional.versiculo_principal_referencia,
            "versiculo_apoio_texto": devocional.versiculo_apoio_texto,
            "versiculo_apoio_referencia": devocional.versiculo_apoio_referencia,
            "autor": devocional.autor,
            "tema": devocional.tema,
            "palavras_chave": devocional.palavras_chave,
            "metadata": json.loads(devocional.metadata_json) if devocional.metadata_json else None
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao buscar devocional por ID: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")

