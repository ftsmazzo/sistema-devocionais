"""
Serviço robusto para envio de devocionais via Evolution API
Com proteções contra bloqueio do WhatsApp
"""
import logging
import time
import requests
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass
from enum import Enum
from zoneinfo import ZoneInfo
from app.config import settings

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
    
    def __post_init__(self):
        if self.timestamp is None:
            from app.timezone_utils import now_brazil
            self.timestamp = now_brazil()


class DevocionalService:
    """
    Serviço robusto para envio de devocionais via Evolution API
    com proteções contra bloqueio do WhatsApp
    """
    
    def __init__(self):
        self.api_url = settings.EVOLUTION_API_URL
        self.api_key = settings.EVOLUTION_API_KEY
        self.instance_name = settings.EVOLUTION_INSTANCE_NAME
        
        # Configurações de rate limiting
        self.delay_between_messages = settings.DELAY_BETWEEN_MESSAGES  # segundos
        self.max_messages_per_hour = settings.MAX_MESSAGES_PER_HOUR
        self.max_messages_per_day = settings.MAX_MESSAGES_PER_DAY
        
        # Controle de envios (usa horário de São Paulo)
        sao_paulo_tz = ZoneInfo("America/Sao_Paulo")
        now_sp = datetime.now(sao_paulo_tz)
        self.messages_sent_today = 0
        self.messages_sent_this_hour = 0
        self.last_message_time = None
        self.last_reset_hour = now_sp.hour
        self.last_reset_day = now_sp.date()
        
        # Retry configuration
        self.max_retries = settings.MAX_RETRIES
        self.retry_delay = settings.RETRY_DELAY  # segundos
        
        # Estatísticas
        self.stats = {
            'total_sent': 0,
            'total_failed': 0,
            'total_blocked': 0,
            'total_retries': 0
        }
    
    def _reset_counters_if_needed(self):
        """Reseta contadores de rate limiting se necessário"""
        from app.timezone_utils import now_brazil
        now = now_brazil()
        
        # Reset contador horário
        if now.hour != self.last_reset_hour:
            self.messages_sent_this_hour = 0
            self.last_reset_hour = now.hour
            logger.info("Contador horário resetado")
        
        # Reset contador diário
        if now.date() != self.last_reset_day:
            self.messages_sent_today = 0
            self.last_reset_day = now.date()
            logger.info("Contador diário resetado")
    
    def _check_rate_limits(self) -> Tuple[bool, Optional[str]]:
        """
        Verifica se pode enviar mais mensagens
        
        Returns:
            (pode_enviar, motivo_bloqueio)
        """
        self._reset_counters_if_needed()
        
        # Verificar limite diário
        if self.messages_sent_today >= self.max_messages_per_day:
            return False, f"Limite diário atingido ({self.max_messages_per_day} mensagens)"
        
        # Verificar limite horário
        if self.messages_sent_this_hour >= self.max_messages_per_hour:
            return False, f"Limite horário atingido ({self.max_messages_per_hour} mensagens/hora)"
        
        return True, None
    
    def _validate_payload(self, phone: str, message: str) -> Tuple[bool, Optional[str]]:
        """
        Valida o payload antes de enviar
        
        Returns:
            (valido, erro)
        """
        # Validar telefone
        if not phone or not isinstance(phone, str):
            return False, "Telefone inválido ou vazio"
        
        # Remover caracteres não numéricos para validação
        phone_clean = ''.join(filter(str.isdigit, phone))
        if len(phone_clean) < 10:
            return False, "Telefone muito curto"
        
        # Validar mensagem
        if not message or not isinstance(message, str):
            return False, "Mensagem inválida ou vazia"
        
        if len(message.strip()) == 0:
            return False, "Mensagem não pode estar vazia"
        
        # Limite de caracteres do WhatsApp
        if len(message) > 4096:
            return False, f"Mensagem muito longa ({len(message)} caracteres, máximo 4096)"
        
        return True, None
    
    def _format_phone(self, phone: str) -> str:
        """Formata o telefone para o padrão da Evolution API"""
        # Remove caracteres não numéricos
        phone_clean = ''.join(filter(str.isdigit, phone))
        
        # Se não começar com código do país, adiciona 55 (Brasil)
        if not phone_clean.startswith('55') and len(phone_clean) == 11:
            phone_clean = '55' + phone_clean
        
        return phone_clean
    
    def _get_greeting_by_time(self) -> str:
        """
        Retorna saudação baseada no horário do dia em São Paulo (Brasil)
        
        Returns:
            Saudação apropriada (Bom dia, Boa tarde, Boa noite)
        """
        # Usar timezone de São Paulo
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
        """
        Personaliza mensagem adicionando saudação com nome e período do dia
        
        Args:
            message: Texto do devocional (sem saudação)
            name: Nome do destinatário
        
        Returns:
            Mensagem personalizada
        """
        greeting = self._get_greeting_by_time()
        
        if name:
            # Adiciona saudação personalizada no início
            personalized = f"{greeting}, *{name}*\n\n{message}"
        else:
            # Se não tiver nome, adiciona apenas saudação
            personalized = f"{greeting}!\n\n{message}"
        
        return personalized
    
    def _build_payload(self, phone: str, message: str, name: Optional[str] = None) -> Dict:
        """
        Constrói o payload para a Evolution API
        
        Args:
            phone: Número do telefone
            message: Texto da mensagem (sem saudação personalizada)
            name: Nome do destinatário (opcional, para personalização)
        
        Returns:
            Payload formatado
        """
        # Personalizar mensagem (adiciona saudação + nome)
        personalized_message = self._personalize_message(message, name)
        
        payload = {
            "number": self._format_phone(phone),
            "text": personalized_message
        }
        
        return payload
    
    def _send_message(self, phone: str, message: str, name: Optional[str] = None, retry_count: int = 0) -> MessageResult:
        """
        Envia uma mensagem via Evolution API
        
        Args:
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
                retry_count=retry_count
            )
        
        # Verificar rate limits
        can_send, limit_error = self._check_rate_limits()
        if not can_send:
            logger.warning(f"Rate limit atingido: {limit_error}")
            return MessageResult(
                success=False,
                status=MessageStatus.BLOCKED,
                error=limit_error,
                retry_count=retry_count
            )
        
        # Construir payload
        payload = self._build_payload(phone, message, name)
        
        # Headers
        headers = {
            "Content-Type": "application/json",
            "apikey": self.api_key
        }
        
        # URL da API
        url = f"{self.api_url}/message/sendText/{self.instance_name}"
        
        try:
            logger.info(f"Enviando mensagem para {phone} (tentativa {retry_count + 1})")
            
            # Fazer requisição
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=30
            )
            
            # Verificar resposta
            if response.status_code == 200 or response.status_code == 201:
                response_data = response.json()
                
                # Verificar se houve erro na resposta
                if isinstance(response_data, dict):
                    if response_data.get('error'):
                        error_msg = response_data.get('message', 'Erro desconhecido')
                        logger.error(f"Erro na API: {error_msg}")
                        return MessageResult(
                            success=False,
                            status=MessageStatus.FAILED,
                            error=error_msg,
                            retry_count=retry_count
                        )
                    
                    # Sucesso
                    message_id = response_data.get('key', {}).get('id') if 'key' in response_data else None
                    
                    # Atualizar contadores (usa horário de São Paulo)
                    sao_paulo_tz = ZoneInfo("America/Sao_Paulo")
                    self.messages_sent_today += 1
                    self.messages_sent_this_hour += 1
                    self.last_message_time = datetime.now(sao_paulo_tz)
                    self.stats['total_sent'] += 1
                    
                    logger.info(f"Mensagem enviada com sucesso para {phone} (ID: {message_id})")
                    
                    return MessageResult(
                        success=True,
                        status=MessageStatus.SENT,
                        message_id=message_id,
                        retry_count=retry_count
                    )
                else:
                    # Resposta inesperada
                    logger.warning(f"Resposta inesperada da API: {response_data}")
                    return MessageResult(
                        success=False,
                        status=MessageStatus.FAILED,
                        error="Resposta inesperada da API",
                        retry_count=retry_count
                    )
            else:
                # Erro HTTP
                error_msg = f"HTTP {response.status_code}: {response.text}"
                logger.error(f"Erro HTTP: {error_msg}")
                
                # Verificar se é erro de bloqueio
                if response.status_code == 403 or response.status_code == 429:
                    self.stats['total_blocked'] += 1
                    return MessageResult(
                        success=False,
                        status=MessageStatus.BLOCKED,
                        error=error_msg,
                        retry_count=retry_count
                    )
                
                return MessageResult(
                    success=False,
                    status=MessageStatus.FAILED,
                    error=error_msg,
                    retry_count=retry_count
                )
        
        except requests.exceptions.Timeout:
            error_msg = "Timeout na requisição"
            logger.error(f"{error_msg} para {phone}")
            return MessageResult(
                success=False,
                status=MessageStatus.FAILED,
                error=error_msg,
                retry_count=retry_count
            )
        
        except requests.exceptions.RequestException as e:
            error_msg = f"Erro de conexão: {str(e)}"
            logger.error(f"{error_msg} para {phone}")
            return MessageResult(
                success=False,
                status=MessageStatus.FAILED,
                error=error_msg,
                retry_count=retry_count
            )
        
        except Exception as e:
            error_msg = f"Erro inesperado: {str(e)}"
            logger.error(f"{error_msg} para {phone}")
            return MessageResult(
                success=False,
                status=MessageStatus.FAILED,
                error=error_msg,
                retry_count=retry_count
            )
    
    def send_devocional(
        self,
        phone: str,
        message: str,
        name: Optional[str] = None,
        retry: bool = True
    ) -> MessageResult:
        """
        Envia um devocional com retry automático
        
        Args:
            phone: Número do telefone
            message: Texto do devocional
            name: Nome do destinatário
            retry: Se deve tentar novamente em caso de falha
        
        Returns:
            MessageResult final
        """
        retry_count = 0
        
        while retry_count <= self.max_retries:
            result = self._send_message(phone, message, name, retry_count)
            
            # Se sucesso, retornar
            if result.success:
                return result
            
            # Se bloqueado, não tentar novamente
            if result.status == MessageStatus.BLOCKED:
                logger.warning(f"Mensagem bloqueada para {phone}, não tentando novamente")
                return result
            
            # Se falhou e ainda há tentativas
            if retry and retry_count < self.max_retries:
                retry_count += 1
                self.stats['total_retries'] += 1
                wait_time = self.retry_delay * retry_count  # Backoff exponencial
                
                logger.warning(
                    f"Falha ao enviar para {phone}, tentando novamente em {wait_time}s "
                    f"(tentativa {retry_count + 1}/{self.max_retries + 1})"
                )
                
                time.sleep(wait_time)
                result.status = MessageStatus.RETRYING
            else:
                # Sem mais tentativas
                self.stats['total_failed'] += 1
                return result
        
        # Se chegou aqui, todas as tentativas falharam
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
        
        Args:
            contacts: Lista de contatos [{"phone": "...", "name": "..."}]
            message: Texto do devocional
            delay: Delay entre mensagens (usa padrão se None)
        
        Returns:
            Lista de MessageResult
        """
        results = []
        delay_time = delay if delay is not None else self.delay_between_messages
        
        logger.info(f"Iniciando envio em massa para {len(contacts)} contatos")
        
        for i, contact in enumerate(contacts, 1):
            phone = contact.get('phone', '')
            name = contact.get('name')
            
            logger.info(f"Processando contato {i}/{len(contacts)}: {name or phone}")
            
            # Verificar rate limits antes de cada envio
            can_send, limit_error = self._check_rate_limits()
            if not can_send:
                logger.warning(f"Rate limit atingido: {limit_error}. Parando envio.")
                result = MessageResult(
                    success=False,
                    status=MessageStatus.BLOCKED,
                    error=limit_error
                )
                results.append(result)
                break
            
            # Enviar mensagem
            result = self.send_devocional(phone, message, name, retry=True)
            results.append(result)
            
            # Aguardar antes da próxima mensagem (exceto na última)
            if i < len(contacts) and delay_time > 0:
                logger.debug(f"Aguardando {delay_time}s antes da próxima mensagem...")
                time.sleep(delay_time)
        
        # Log resumo
        sent = sum(1 for r in results if r.success)
        failed = sum(1 for r in results if not r.success)
        logger.info(f"Envio em massa concluído: {sent} enviadas, {failed} falharam")
        
        return results
    
    def get_stats(self) -> Dict:
        """Retorna estatísticas do serviço"""
        return {
            **self.stats,
            'messages_sent_today': self.messages_sent_today,
            'messages_sent_this_hour': self.messages_sent_this_hour,
            'max_per_hour': self.max_messages_per_hour,
            'max_per_day': self.max_messages_per_day,
            'last_message_time': self.last_message_time.isoformat() if self.last_message_time else None
        }
    
    def check_instance_status(self) -> Dict:
        """
        Verifica o status da instância na Evolution API
        
        Returns:
            Dict com status da instância
        """
        try:
            headers = {
                "apikey": self.api_key
            }
            
            url = f"{self.api_url}/instance/fetchInstances"
            
            response = requests.get(url, headers=headers, timeout=10)
            
            if response.status_code == 200:
                instances = response.json()
                # Procurar nossa instância
                for instance in instances:
                    if instance.get('instanceName') == self.instance_name:
                        return {
                            'status': 'connected',
                            'instance': instance,
                            'state': instance.get('state', 'unknown')
                        }
                
                return {
                    'status': 'not_found',
                    'error': f'Instância {self.instance_name} não encontrada'
                }
            else:
                return {
                    'status': 'error',
                    'error': f'HTTP {response.status_code}: {response.text}'
                }
        
        except Exception as e:
            return {
                'status': 'error',
                'error': str(e)
            }

