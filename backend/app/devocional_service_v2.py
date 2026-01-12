"""
Serviço V2 para envio de devocionais via Evolution API
Com suporte a Multi-Instância, vCard e perfil personalizado
"""
import logging
import time
import requests
import json
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timedelta
from dataclasses import dataclass
from enum import Enum
from zoneinfo import ZoneInfo
from app.config import settings
from app.instance_manager import InstanceManager, EvolutionInstance, InstanceStatus
from app.vcard_service import VCardService
from app.shield_service import ShieldService

logger = logging.getLogger(__name__)


class MessageStatus(Enum):
    """Status da mensagem"""
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    RETRYING = "retrying"
    BLOCKED = "blocked"


@dataclass
class MessageResult:
    """Resultado do envio de mensagem"""
    success: bool
    status: MessageStatus
    message_id: Optional[str] = None
    error: Optional[str] = None
    retry_count: int = 0
    timestamp: datetime = None
    instance_name: Optional[str] = None  # Nome da instância que enviou
    
    def __post_init__(self):
        if self.timestamp is None:
            from app.timezone_utils import now_brazil_naive
            self.timestamp = now_brazil_naive()


class DevocionalServiceV2:
    """
    Serviço V2 para envio de devocionais via Evolution API
    com suporte a multi-instância, vCard e perfil personalizado
    """
    
    def __init__(self, db: Optional[Any] = None):
        """
        Inicializa o serviço de devocionais
        
        Args:
            db: Sessão do banco de dados (opcional, para usar instâncias do banco)
        """
        # Inicializar InstanceManager
        # Se db fornecido, usar banco de dados (preferido)
        if db is not None:
            logger.info("Inicializando InstanceManager com banco de dados")
            self.instance_manager = InstanceManager(db=db)
        else:
            # Método legado - usar .env
            instances_config = []
            
            # Tentar carregar instâncias do JSON
            try:
                if settings.EVOLUTION_INSTANCES and settings.EVOLUTION_INSTANCES != "[]":
                    instances_config = json.loads(settings.EVOLUTION_INSTANCES)
            except Exception as e:
                logger.warning(f"Erro ao carregar configuração de instâncias: {e}")
            
            # Se não houver instâncias configuradas, usar configuração legada
            if not instances_config:
                logger.info("Usando configuração legada (instância única)")
                instances_config = [{
                    "name": settings.EVOLUTION_INSTANCE_NAME,
                    "api_url": settings.EVOLUTION_API_URL,
                    "api_key": settings.EVOLUTION_API_KEY,
                    "display_name": settings.EVOLUTION_DISPLAY_NAME,
                    "max_messages_per_hour": settings.MAX_MESSAGES_PER_HOUR,
                    "max_messages_per_day": settings.MAX_MESSAGES_PER_DAY,
                    "priority": 1
                }]
            
            self.instance_manager = InstanceManager(instances=instances_config)
        
        # Verificar saúde das instâncias na inicialização (não falha se não conseguir)
        try:
            self.instance_manager.check_all_instances()
            logger.info(f"Health check inicial concluído para {len(self.instance_manager.instances)} instâncias")
        except Exception as e:
            logger.warning(f"Erro no health check inicial (não crítico): {e}. Instâncias serão verificadas no primeiro uso.")
        
        # NOTA: Configuração de perfil via API não é suportada pela Evolution API
        # O nome que aparece é o nome da conta WhatsApp conectada à instância
        # A solução é usar vCard para que destinatários salvem o contato
        
        # Configurações de rate limiting (agora por instância)
        self.delay_between_messages = settings.DELAY_BETWEEN_MESSAGES
        
        # Retry configuration
        self.max_retries = settings.MAX_RETRIES
        self.retry_delay = settings.RETRY_DELAY
        
        # Configurações de vCard
        self.send_vcard_to_new = settings.SEND_VCARD_TO_NEW_CONTACTS
        self.send_contact_request = settings.SEND_CONTACT_REQUEST
        
        # Estatísticas globais
        self.stats = {
            'total_sent': 0,
            'total_failed': 0,
            'total_blocked': 0,
            'total_retries': 0
        }
        
        # Estratégia de distribuição
        self.distribution_strategy = settings.EVOLUTION_INSTANCE_STRATEGY
        
        # Serviço de blindagem
        if settings.SHIELD_ENABLED:
            self.shield = ShieldService(
                delay_variation=settings.DELAY_VARIATION,
                break_interval=settings.BREAK_INTERVAL,
                break_duration_min=settings.BREAK_DURATION_MIN,
                break_duration_max=settings.BREAK_DURATION_MAX,
                min_engagement_score=settings.MIN_ENGAGEMENT_SCORE,
                adaptive_limits_enabled=settings.ADAPTIVE_LIMITS_ENABLED,
                block_detection_enabled=settings.BLOCK_DETECTION_ENABLED
            )
            # Sincronizar limites base
            self.shield.base_hourly_limit = settings.MAX_MESSAGES_PER_HOUR
            self.shield.base_daily_limit = settings.MAX_MESSAGES_PER_DAY
            self.shield.current_hourly_limit = settings.MAX_MESSAGES_PER_HOUR
            self.shield.current_daily_limit = settings.MAX_MESSAGES_PER_DAY
            logger.info("ShieldService habilitado")
        else:
            self.shield = None
            logger.info("ShieldService desabilitado")
        
        logger.info(f"DevocionalServiceV2 inicializado com {len(self.instance_manager.instances)} instâncias")
    
    def _validate_payload(self, phone: str, message: str) -> Tuple[bool, Optional[str]]:
        """Valida o payload antes de enviar"""
        if not phone or not isinstance(phone, str):
            return False, "Telefone inválido ou vazio"
        
        phone_clean = ''.join(filter(str.isdigit, phone))
        if len(phone_clean) < 10:
            return False, "Telefone muito curto"
        
        if not message or not isinstance(message, str):
            return False, "Mensagem inválida ou vazia"
        
        if len(message.strip()) == 0:
            return False, "Mensagem não pode estar vazia"
        
        if len(message) > 4096:
            return False, f"Mensagem muito longa ({len(message)} caracteres, máximo 4096)"
        
        return True, None
    
    def _format_phone(self, phone: str) -> str:
        """Formata o telefone para o padrão da Evolution API"""
        phone_clean = ''.join(filter(str.isdigit, phone))
        
        if not phone_clean.startswith('55') and len(phone_clean) == 11:
            phone_clean = '55' + phone_clean
        
        return phone_clean
    
    def _get_greeting_by_time(self) -> str:
        """Retorna saudação baseada no horário do dia em São Paulo"""
        sao_paulo_tz = ZoneInfo("America/Sao_Paulo")
        now = datetime.now(sao_paulo_tz)
        hour = now.hour
        
        if 5 <= hour < 12:
            return "Bom dia"
        elif 12 <= hour < 18:
            return "Boa tarde"
        else:
            return "Boa noite"
    
    def _personalize_message(self, message: str, name: Optional[str] = None) -> str:
        """Personaliza mensagem adicionando saudação com nome"""
        greeting = self._get_greeting_by_time()
        
        if name:
            personalized = f"{greeting}, *{name}*\n\n{message}"
        else:
            personalized = f"{greeting}!\n\n{message}"
        
        return personalized
    
    def _build_payload(self, phone: str, message: str, name: Optional[str] = None) -> Dict:
        """Constrói o payload para a Evolution API"""
        personalized_message = self._personalize_message(message, name)
        
        payload = {
            "number": self._format_phone(phone),
            "text": personalized_message
        }
        
        return payload
    
    def _send_message_via_instance(
        self,
        instance: EvolutionInstance,
        phone: str,
        message: str,
        name: Optional[str] = None,
        retry_count: int = 0
    ) -> MessageResult:
        """
        Envia uma mensagem via uma instância específica
        
        Args:
            instance: Instância Evolution API
            phone: Número do telefone
            message: Texto da mensagem
            name: Nome do destinatário
            retry_count: Número de tentativas
        
        Returns:
            MessageResult com o resultado do envio
        """
        # Validar payload
        is_valid, error = self._validate_payload(phone, message)
        if not is_valid:
            logger.error(f"Validação falhou: {error}")
            return MessageResult(
                success=False,
                status=MessageStatus.FAILED,
                error=error,
                retry_count=retry_count,
                instance_name=instance.name
            )
        
        # Verificar limites da instância
        if instance.messages_sent_today >= instance.max_messages_per_day:
            return MessageResult(
                success=False,
                status=MessageStatus.BLOCKED,
                error=f"Limite diário da instância {instance.name} atingido",
                retry_count=retry_count,
                instance_name=instance.name
            )
        
        if instance.messages_sent_this_hour >= instance.max_messages_per_hour:
            return MessageResult(
                success=False,
                status=MessageStatus.BLOCKED,
                error=f"Limite horário da instância {instance.name} atingido",
                retry_count=retry_count,
                instance_name=instance.name
            )
        
        # NOTA: O nome do perfil não pode ser alterado via API da Evolution
        # O nome que aparece é o nome da conta WhatsApp conectada à instância
        # A única forma de fazer o nome aparecer é através do vCard (já implementado)
        
        # Construir payload
        payload = self._build_payload(phone, message, name)
        
        # Headers
        headers = {
            "Content-Type": "application/json",
            "apikey": instance.api_key
        }
        
        # URL da API - usar o nome real da instância na API (pode ser diferente do configurado)
        # Se api_instance_name foi descoberto, usar ele; senão usar o name configurado
        api_instance_name = getattr(instance, 'api_instance_name', None) or instance.name
        url = f"{instance.api_url}/message/sendText/{api_instance_name}"
        
        try:
            logger.info(f"Enviando mensagem para {phone} via instância {instance.name} (tentativa {retry_count + 1})")
            
            response = requests.post(url, json=payload, headers=headers, timeout=30)
            
            # Detecção de bloqueio via ShieldService
            if self.shield:
                response_dict = {
                    "status_code": response.status_code,
                    "error": response.text if response.status_code != 200 else None,
                    "status": "success" if response.status_code in [200, 201] else "failed"
                }
                if self.shield.analyze_response_for_block(response_dict):
                    logger.error(f"BLOQUEIO DETECTADO para instância {instance.name}!")
                    instance.status = InstanceStatus.BLOCKED
                    self.stats['total_blocked'] += 1
                    return MessageResult(
                        success=False,
                        status=MessageStatus.BLOCKED,
                        error="Bloqueio detectado pelo sistema de blindagem",
                        retry_count=retry_count,
                        instance_name=instance.name
                    )
            
            if response.status_code in [200, 201]:
                response_data = response.json()
                
                if isinstance(response_data, dict):
                    if response_data.get('error'):
                        error_msg = response_data.get('message', 'Erro desconhecido')
                        logger.error(f"Erro na API {instance.name}: {error_msg}")
                        self.instance_manager.update_instance_stats(instance, success=False)
                        
                        # Atualizar taxa de sucesso no shield
                        if self.shield:
                            self.shield.update_success_rate(
                                self.stats['total_sent'],
                                self.stats['total_sent'] + self.stats['total_failed'] + 1
                            )
                        
                        return MessageResult(
                            success=False,
                            status=MessageStatus.FAILED,
                            error=error_msg,
                            retry_count=retry_count,
                            instance_name=instance.name
                        )
                    
                    message_id = response_data.get('key', {}).get('id') if 'key' in response_data else None
                    
                    # Se enviou com sucesso, marcar instância como ACTIVE (mesmo que health check tenha falhado)
                    if instance.status != InstanceStatus.ACTIVE:
                        logger.info(f"Instância {instance.name} funcionou! Marcando como ACTIVE")
                        instance.status = InstanceStatus.ACTIVE
                    
                    # Atualizar estatísticas da instância
                    self.instance_manager.update_instance_stats(instance, success=True)
                    self.stats['total_sent'] += 1
                    
                    # Atualizar taxa de sucesso no shield
                    if self.shield:
                        total_attempts = self.stats['total_sent'] + self.stats['total_failed']
                        self.shield.update_success_rate(self.stats['total_sent'], total_attempts)
                        self.shield.metrics.total_messages_sent += 1
                    
                    logger.info(f"Mensagem enviada com sucesso para {phone} via {instance.name} (ID: {message_id})")
                    
                    return MessageResult(
                        success=True,
                        status=MessageStatus.SENT,
                        message_id=message_id,
                        retry_count=retry_count,
                        instance_name=instance.name
                    )
                else:
                    logger.warning(f"Resposta inesperada da API {instance.name}: {response_data}")
                    self.instance_manager.update_instance_stats(instance, success=False)
                    return MessageResult(
                        success=False,
                        status=MessageStatus.FAILED,
                        error="Resposta inesperada da API",
                        retry_count=retry_count,
                        instance_name=instance.name
                    )
            else:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                logger.error(f"Erro HTTP na instância {instance.name}: {error_msg}")
                
                if response.status_code in [403, 429]:
                    instance.status = InstanceStatus.BLOCKED
                    self.stats['total_blocked'] += 1
                    self.instance_manager.update_instance_stats(instance, success=False)
                    return MessageResult(
                        success=False,
                        status=MessageStatus.BLOCKED,
                        error=error_msg,
                        retry_count=retry_count,
                        instance_name=instance.name
                    )
                
                self.instance_manager.update_instance_stats(instance, success=False)
                return MessageResult(
                    success=False,
                    status=MessageStatus.FAILED,
                    error=error_msg,
                    retry_count=retry_count,
                    instance_name=instance.name
                )
        
        except requests.exceptions.Timeout:
            error_msg = "Timeout na requisição"
            logger.error(f"{error_msg} para {phone} via {instance.name}")
            self.instance_manager.update_instance_stats(instance, success=False)
            return MessageResult(
                success=False,
                status=MessageStatus.FAILED,
                error=error_msg,
                retry_count=retry_count,
                instance_name=instance.name
            )
        
        except Exception as e:
            error_msg = f"Erro inesperado: {str(e)}"
            logger.error(f"{error_msg} para {phone} via {instance.name}")
            self.instance_manager.update_instance_stats(instance, success=False)
            return MessageResult(
                success=False,
                status=MessageStatus.FAILED,
                error=error_msg,
                retry_count=retry_count,
                instance_name=instance.name
            )
    
    def send_devocional(
        self,
        phone: str,
        message: str,
        name: Optional[str] = None,
        retry: bool = True,
        instance_name: Optional[str] = None
    ) -> MessageResult:
        """
        Envia um devocional com retry automático
        
        Args:
            phone: Número do telefone
            message: Texto do devocional
            name: Nome do destinatário
            retry: Se deve tentar novamente em caso de falha
            instance_name: Nome específico da instância (opcional, usa distribuição se None)
        
        Returns:
            MessageResult final
        """
        retry_count = 0
        
        while retry_count <= self.max_retries:
            # Obter instância
            if instance_name:
                instance = self.instance_manager.get_instance_by_name(instance_name)
                if not instance or not instance.enabled:
                    return MessageResult(
                        success=False,
                        status=MessageStatus.FAILED,
                        error=f"Instância {instance_name} não encontrada ou desabilitada",
                        instance_name=instance_name
                    )
            else:
                # Usar distribuição automática
                instance = self.instance_manager.get_available_instance(self.distribution_strategy)
                if not instance:
                    return MessageResult(
                        success=False,
                        status=MessageStatus.BLOCKED,
                        error="Nenhuma instância disponível no momento"
                    )
            
            result = self._send_message_via_instance(instance, phone, message, name, retry_count)
            
            if result.success:
                return result
            
            if result.status == MessageStatus.BLOCKED:
                logger.warning(f"Mensagem bloqueada para {phone}, não tentando novamente")
                return result
            
            if retry and retry_count < self.max_retries:
                retry_count += 1
                self.stats['total_retries'] += 1
                wait_time = self.retry_delay * retry_count
                
                logger.warning(
                    f"Falha ao enviar para {phone}, tentando novamente em {wait_time}s "
                    f"(tentativa {retry_count + 1}/{self.max_retries + 1})"
                )
                
                time.sleep(wait_time)
                result.status = MessageStatus.RETRYING
            else:
                self.stats['total_failed'] += 1
                return result
        
        self.stats['total_failed'] += 1
        return result
    
    def send_bulk_devocionais(
        self,
        contacts: List[Dict[str, str]],
        message: str,
        delay: Optional[float] = None
    ) -> List[MessageResult]:
        """
        Envia devocionais para uma lista de contatos com delay entre envios
        Distribui automaticamente entre instâncias disponíveis
        """
        results = []
        delay_time = delay if delay is not None else self.delay_between_messages
        
        logger.info(f"Iniciando envio em massa para {len(contacts)} contatos")
        
        # Verificar se deve pausar (bloqueio detectado)
        if self.shield and self.shield.should_pause_sending():
            logger.error("ENVIOS PAUSADOS: Bloqueio detectado pelo sistema de blindagem")
            return [MessageResult(
                success=False,
                status=MessageStatus.BLOCKED,
                error="Envio pausado devido a bloqueio detectado"
            )]
        
        # Verificar horário seguro
        if self.shield and not self.shield.is_safe_send_time():
            logger.warning("Horário não seguro para envio. Aguardando horário seguro...")
            # Opcional: retornar erro ou aguardar
            # Por enquanto, apenas loga o aviso
        
        # Resetar contadores das instâncias
        self.instance_manager.reset_daily_counters()
        self.instance_manager.reset_hourly_counters()
        
        # Ajustar limites adaptativos se habilitado
        if self.shield:
            self.shield.adjust_limits()
            # Atualizar limites das instâncias com limites adaptativos
            hourly_limit, daily_limit = self.shield.get_current_limits()
            for inst in self.instance_manager.instances:
                inst.max_messages_per_hour = hourly_limit
                inst.max_messages_per_day = daily_limit
        
        for i, contact in enumerate(contacts, 1):
            phone = contact.get('phone', '')
            name = contact.get('name')
            
            logger.info(f"Processando contato {i}/{len(contacts)}: {name or phone}")
            
            # Verificar consentimento ANTES de enviar
            try:
                from app.consent_service import ConsentService
                from app.database import SessionLocal
                db_consent = SessionLocal()
                try:
                    consent_service = ConsentService(db_consent)
                    can_send, reason = consent_service.can_send_devocional(phone)
                    
                    if not can_send:
                        logger.info(f"⏸️ Pulando contato {phone}: {reason}")
                        results.append(MessageResult(
                            success=False,
                            status=MessageStatus.FAILED,
                            error=reason,
                            instance_name=None
                        ))
                        db_consent.close()
                        continue
                finally:
                    db_consent.close()
            except Exception as e:
                logger.warning(f"Erro ao verificar consentimento: {e}")
                # Continuar mesmo com erro (não bloquear envio)
            
            # Verificar engajamento (se shield habilitado)
            # Para devocionais, sempre permitir envio (is_devocional=True)
            if self.shield and not self.shield.should_send_to_contact(phone, is_devocional=True):
                logger.info(f"Pulando contato {phone}: score de engajamento muito baixo")
                results.append(MessageResult(
                    success=False,
                    status=MessageStatus.FAILED,
                    error="Score de engajamento muito baixo",
                    instance_name=None
                ))
                continue
            
            # Obter instância disponível
            instance = self.instance_manager.get_available_instance(self.distribution_strategy)
            if not instance:
                logger.warning("Nenhuma instância disponível. Parando envio.")
                result = MessageResult(
                    success=False,
                    status=MessageStatus.BLOCKED,
                    error="Nenhuma instância disponível"
                )
                results.append(result)
                break
            
            # Verificar se é contato novo ANTES de enviar (para enviar vCard se necessário)
            is_new_contact = False
            if self.send_vcard_to_new:
                try:
                    from app.database import SessionLocal, DevocionalContato
                    db = SessionLocal()
                    try:
                        db_contact = db.query(DevocionalContato).filter(
                            DevocionalContato.phone == phone
                        ).first()
                        
                        # Se é primeiro envio (total_sent == 0 ou None), marcar como novo
                        if db_contact and (not db_contact.total_sent or db_contact.total_sent == 0):
                            is_new_contact = True
                            logger.info(f"Contato identificado como novo: {name or phone} (total_sent: {db_contact.total_sent})")
                    finally:
                        db.close()
                except Exception as e:
                    logger.warning(f"Erro ao verificar se é novo contato: {e}")
            
            # Verificar pausa estratégica
            if self.shield and self.shield.should_take_break():
                self.shield.take_break()
            
            # Enviar mensagem
            result = self.send_devocional(phone, message, name, retry=True)
            results.append(result)
            
            # Atualizar engajamento (assumindo que não houve resposta por enquanto)
            # Para devocionais, não reduzir score (são mensagens unidirecionais)
            # Em produção, isso seria atualizado quando houver resposta real
            if self.shield:
                self.shield.update_engagement(phone, responded=False, is_devocional=True)
                self.shield.metrics.messages_since_break += 1
            
            # IMPORTANTE: Verificar e enviar mensagem de consentimento APÓS primeiro envio
            # A verificação deve ser feita ANTES do total_sent ser incrementado no router/scheduler
            # Por isso verificamos se total_sent == 0 (ainda não enviou) ou se acabou de enviar
            if result.success and self.send_contact_request:
                try:
                    from app.consent_service import ConsentService
                    from app.database import SessionLocal, DevocionalContato
                    db_consent = SessionLocal()
                    try:
                        # Buscar total_sent ATUAL (antes de ser incrementado no router/scheduler)
                        db_contact = db_consent.query(DevocionalContato).filter(
                            DevocionalContato.phone == phone
                        ).first()
                        
                        if db_contact:
                            # Se total_sent == 0, acabou de enviar o primeiro (momento certo para consentimento)
                            current_total_sent = db_contact.total_sent or 0
                            
                            # Só processar consentimento se SEND_CONTACT_REQUEST estiver habilitado
                            if current_total_sent == 0:
                                try:
                                    consent_service = ConsentService(db_consent)
                                    consent = consent_service.get_or_create_consent(phone)
                                    
                                    # Verificar se já enviou mensagem de consentimento
                                    if not getattr(consent, 'consent_message_sent', False):
                                        logger.info(f"📨 Enviando mensagem de consentimento para {name or phone} (primeiro envio)")
                                        instance = self.instance_manager.get_instance_by_name(result.instance_name)
                                        if instance:
                                            # Adicionar pequeno delay antes de enviar consentimento (2-3 segundos)
                                            time.sleep(2)
                                            
                                            consent_result = consent_service.send_consent_message(instance, phone, name)
                                            if consent_result.get("success"):
                                                logger.info(f"✅ Mensagem de consentimento enviada para {phone}")
                                            else:
                                                logger.error(f"❌ Erro ao enviar mensagem de consentimento: {consent_result.get('error')}")
                                    else:
                                        logger.debug(f"ℹ️ Mensagem de consentimento já enviada para {phone}")
                                except AttributeError as attr_err:
                                    # Se o campo não existir na tabela, apenas logar e continuar
                                    logger.warning(f"⚠️ Campo de consentimento não encontrado (tabela pode precisar de migração): {attr_err}")
                                except Exception as consent_err:
                                    logger.error(f"Erro ao processar consentimento para {phone}: {consent_err}", exc_info=True)
                            else:
                                logger.debug(f"ℹ️ Não enviando consentimento para {phone}: total_sent={current_total_sent} (não é primeiro envio)")
                    finally:
                        db_consent.close()
                except Exception as e:
                    # Não deixar erro de consentimento quebrar o envio principal
                    logger.error(f"Erro ao processar consentimento (não crítico): {e}", exc_info=True)
            
            # Se enviou com sucesso e é novo contato, enviar vCard
            if result.success and is_new_contact and self.send_vcard_to_new:
                try:
                    logger.info(f"Enviando vCard para novo contato: {name or phone}")
                    instance = self.instance_manager.get_instance_by_name(result.instance_name)
                    if instance:
                        # Tentar obter número da instância
                        contact_phone = instance.phone_number
                        if not contact_phone:
                            # Tentar obter via health check
                            logger.info(f"Obtendo número da instância {instance.name}...")
                            self.instance_manager.check_instance_health(instance)
                            contact_phone = instance.phone_number
                        
                        # Se ainda não tiver, usar o número formatado do destinatário como fallback
                        if not contact_phone:
                            logger.warning(f"Número da instância {instance.name} não disponível. Usando número formatado como fallback.")
                            contact_phone = self._format_phone(phone)
                        
                        # Enviar vCard
                        vcard_result = VCardService.send_vcard(
                            instance=instance,
                            recipient_phone=phone,
                            contact_name=instance.display_name,
                            contact_phone=contact_phone,
                            organization="Devocional Diário"
                        )
                        if vcard_result.get("success"):
                            logger.info(f"✅ vCard enviado com sucesso para {phone} (ID: {vcard_result.get('message_id')})")
                        else:
                            logger.error(f"❌ Falha ao enviar vCard para {phone}: {vcard_result.get('error')}")
                except Exception as e:
                    logger.error(f"Erro ao enviar vCard para {phone}: {e}", exc_info=True)
            
            # Aguardar antes da próxima mensagem (com delay randomizado se shield habilitado)
            if i < len(contacts) and delay_time > 0:
                if self.shield:
                    randomized_delay = self.shield.get_randomized_delay(delay_time)
                    logger.debug(f"Aguardando {randomized_delay:.2f}s (randomizado de {delay_time}s) antes da próxima mensagem...")
                    time.sleep(randomized_delay)
                else:
                    logger.debug(f"Aguardando {delay_time}s antes da próxima mensagem...")
                    time.sleep(delay_time)
        
        # Log resumo
        sent = sum(1 for r in results if r.success)
        failed = sum(1 for r in results if not r.success)
        logger.info(f"Envio em massa concluído: {sent} enviadas, {failed} falharam")
        
        return results
    
    def get_stats(self) -> Dict:
        """Retorna estatísticas do serviço e instâncias"""
        instance_stats = self.instance_manager.get_stats()
        
        # instance_stats é um dict com 'instances' dentro, precisamos extrair a lista
        instances_list = instance_stats.get('instances', [])
        
        stats = {
            **self.stats,
            'instances': instances_list,  # Lista de instâncias, não o dict completo
            'distribution_strategy': self.distribution_strategy
        }
        
        # Adicionar métricas de blindagem se habilitado
        if self.shield:
            stats['shield'] = self.shield.get_metrics()
        
        return stats
    
    def check_all_instances_health(self):
        """Verifica saúde de todas as instâncias"""
        self.instance_manager.check_all_instances()
    
    # NOTA: Métodos de configuração de perfil removidos
    # A Evolution API não suporta atualização de perfil via API
    # O nome que aparece é o nome da conta WhatsApp conectada à instância
    # A solução é usar vCard (já implementado) para que destinatários salvem o contato

