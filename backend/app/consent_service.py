"""
Serviço para gerenciar consentimento dos contatos para receber devocionais
"""
import logging
import requests
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from app.database import ContactConsent, DevocionalContato
from app.timezone_utils import now_brazil_naive
from app.instance_manager import EvolutionInstance

logger = logging.getLogger(__name__)

CONSENT_MESSAGE = "Você gostaria de continuar recebendo o devocional diário?"


class ConsentService:
    """Serviço para gerenciar consentimento dos contatos"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def get_or_create_consent(self, phone: str) -> ContactConsent:
        """Busca ou cria registro de consentimento"""
        consent = self.db.query(ContactConsent).filter(
            ContactConsent.phone == phone
        ).first()
        
        if not consent:
            consent = ContactConsent(
                phone=phone,
                consented=None,  # None = aguardando resposta
                consent_message_sent=False
            )
            self.db.add(consent)
            self.db.flush()
            logger.info(f"✅ Criado registro de consentimento para {phone}")
        
        return consent
    
    def can_send_devocional(self, phone: str) -> tuple[bool, str]:
        """
        Verifica se pode enviar devocional para o contato
        
        Returns:
            (pode_enviar, motivo)
        """
        consent = self.get_or_create_consent(phone)
        
        # Se já consentiu, pode enviar
        if consent.consented is True:
            return (True, "Consentimento confirmado")
        
        # Se negou, não pode enviar
        if consent.consented is False:
            return (False, "Contato não consentiu em receber devocionais")
        
        # Se está aguardando resposta, não pode enviar
        if consent.consent_message_sent and consent.consented is None:
            return (False, "Aguardando resposta de consentimento")
        
        # Se nunca enviou mensagem de consentimento, pode enviar (primeira vez)
        return (True, "Primeira mensagem - ainda não enviou consentimento")
    
    def should_send_consent_message(self, phone: str) -> bool:
        """
        Verifica se deve enviar mensagem de consentimento
        
        Deve enviar se:
        - É primeiro envio (total_sent == 0 ou 1)
        - Ainda não enviou mensagem de consentimento
        """
        # Verificar total_sent do contato
        contact = self.db.query(DevocionalContato).filter(
            DevocionalContato.phone == phone
        ).first()
        
        if not contact:
            return False
        
        # Se é primeiro envio (total_sent == 0 ou 1)
        is_first_send = (not contact.total_sent or contact.total_sent <= 1)
        
        # Verificar se já enviou mensagem de consentimento
        consent = self.get_or_create_consent(phone)
        already_sent = consent.consent_message_sent
        
        return is_first_send and not already_sent
    
    def send_consent_message(
        self,
        instance: EvolutionInstance,
        phone: str,
        name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Envia mensagem de consentimento para o contato
        
        Args:
            instance: Instância Evolution API
            phone: Telefone do contato
            name: Nome do contato (opcional)
            
        Returns:
            Dict com resultado do envio
        """
        try:
            # Personalizar mensagem
            personalized_message = CONSENT_MESSAGE
            if name:
                personalized_message = f"Olá {name}! 👋\n\n{CONSENT_MESSAGE}"
            
            # Formatar telefone
            phone_clean = ''.join(filter(str.isdigit, phone))
            if not phone_clean.startswith('55') and len(phone_clean) == 11:
                phone_clean = '55' + phone_clean
            
            # Enviar mensagem
            headers = {
                "Content-Type": "application/json",
                "apikey": instance.api_key
            }
            
            api_instance_name = getattr(instance, 'api_instance_name', None) or instance.name
            url = f"{instance.api_url}/message/sendText/{api_instance_name}"
            
            payload = {
                "number": phone_clean,
                "text": personalized_message
            }
            
            response = requests.post(url, json=payload, headers=headers, timeout=30)
            
            if response.status_code in [200, 201]:
                response_data = response.json()
                message_id = response_data.get('key', {}).get('id') if 'key' in response_data else None
                
                # Atualizar registro de consentimento
                consent = self.get_or_create_consent(phone)
                consent.consent_message_sent = True
                consent.consent_message_sent_at = now_brazil_naive()
                self.db.commit()
                
                logger.info(f"✅ Mensagem de consentimento enviada para {phone} (ID: {message_id})")
                
                return {
                    "success": True,
                    "message_id": message_id,
                    "phone": phone
                }
            else:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                logger.error(f"❌ Erro ao enviar mensagem de consentimento: {error_msg}")
                return {
                    "success": False,
                    "error": error_msg,
                    "phone": phone
                }
                
        except Exception as e:
            logger.error(f"❌ Erro ao enviar mensagem de consentimento: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "phone": phone
            }
    
    def process_consent_response(self, phone: str, message_text: str) -> bool:
        """
        Processa resposta de consentimento do contato
        
        Args:
            phone: Telefone do contato
            message_text: Texto da mensagem recebida
            
        Returns:
            True se processou, False caso contrário
        """
        try:
            message_lower = message_text.lower().strip()
            
            # Verificar se é resposta de consentimento
            # Respostas positivas: sim, s, quero, quero sim, continuar, ok, tudo bem
            positive_responses = ['sim', 's', 'quero', 'quero sim', 'continuar', 'ok', 'tudo bem', 'claro', 'pode']
            # Respostas negativas: não, nao, n, não quero, parar, cancelar
            negative_responses = ['não', 'nao', 'n', 'não quero', 'nao quero', 'parar', 'cancelar', 'não obrigado']
            
            is_positive = any(resp in message_lower for resp in positive_responses)
            is_negative = any(resp in message_lower for resp in negative_responses)
            
            if not (is_positive or is_negative):
                # Não é resposta de consentimento
                return False
            
            # Atualizar consentimento
            consent = self.get_or_create_consent(phone)
            consent.consented = is_positive
            consent.response_received = True
            consent.response_received_at = now_brazil_naive()
            consent.response_text = message_text
            
            # Se negou, desativar contato
            if is_negative:
                contact = self.db.query(DevocionalContato).filter(
                    DevocionalContato.phone == phone
                ).first()
                if contact:
                    contact.active = False
                    logger.info(f"⚠️ Contato {phone} desativado (negou consentimento)")
            
            self.db.commit()
            
            logger.info(f"✅ Consentimento processado para {phone}: {'SIM' if is_positive else 'NÃO'}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Erro ao processar resposta de consentimento: {e}", exc_info=True)
            self.db.rollback()
            return False
