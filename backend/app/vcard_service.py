"""
Serviço para envio de vCard (cartão de contato)
Permite que o destinatário salve o contato facilmente
"""
import logging
import requests
from typing import Optional, Dict
from app.instance_manager import EvolutionInstance

logger = logging.getLogger(__name__)


class VCardService:
    """Serviço para envio de vCard via Evolution API"""
    
    @staticmethod
    def create_vcard(
        name: str,
        phone: str,
        organization: Optional[str] = None,
        email: Optional[str] = None
    ) -> str:
        """
        Cria string vCard formatada
        
        Args:
            name: Nome do contato
            phone: Número do telefone (formato internacional)
            organization: Organização (opcional)
            email: Email (opcional)
        
        Returns:
            String vCard formatada
        """
        vcard = f"BEGIN:VCARD\n"
        vcard += f"VERSION:3.0\n"
        vcard += f"FN:{name}\n"
        vcard += f"N:{name};;;;\n"
        
        # Formatar telefone (remover caracteres não numéricos)
        phone_clean = ''.join(filter(str.isdigit, phone))
        vcard += f"TEL;TYPE=CELL:{phone_clean}\n"
        
        if organization:
            vcard += f"ORG:{organization}\n"
        
        if email:
            vcard += f"EMAIL:{email}\n"
        
        vcard += f"END:VCARD"
        
        return vcard
    
    @staticmethod
    def send_vcard(
        instance: EvolutionInstance,
        recipient_phone: str,
        contact_name: str,
        contact_phone: str,
        organization: Optional[str] = None,
        email: Optional[str] = None
    ) -> Dict:
        """
        Envia vCard via Evolution API
        
        Args:
            instance: Instância Evolution API
            recipient_phone: Telefone do destinatário
            contact_name: Nome do contato a salvar
            contact_phone: Telefone do contato a salvar
            organization: Organização (opcional)
            email: Email (opcional)
        
        Returns:
            Dict com resultado do envio
        """
        try:
            # Criar vCard
            vcard_content = VCardService.create_vcard(
                name=contact_name,
                phone=contact_phone,
                organization=organization,
                email=email
            )
            
            # Formatar telefone do destinatário
            recipient_clean = ''.join(filter(str.isdigit, recipient_phone))
            if not recipient_clean.startswith('55') and len(recipient_clean) == 11:
                recipient_clean = '55' + recipient_clean
            
            # Headers
            headers = {
                "Content-Type": "application/json",
                "apikey": instance.api_key
            }
            
            # URL da API
            url = f"{instance.api_url}/message/sendMedia/{instance.name}"
            
            # Payload para vCard
            payload = {
                "number": recipient_clean,
                "mediatype": "vcard",
                "media": vcard_content
            }
            
            response = requests.post(url, json=payload, headers=headers, timeout=30)
            
            if response.status_code in [200, 201]:
                response_data = response.json()
                logger.info(f"vCard enviado com sucesso para {recipient_phone}")
                return {
                    "success": True,
                    "message_id": response_data.get('key', {}).get('id') if 'key' in response_data else None,
                    "vcard_content": vcard_content
                }
            else:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                logger.error(f"Erro ao enviar vCard: {error_msg}")
                return {
                    "success": False,
                    "error": error_msg
                }
        
        except Exception as e:
            error_msg = f"Erro ao enviar vCard: {str(e)}"
            logger.error(error_msg)
            return {
                "success": False,
                "error": error_msg
            }
    
    @staticmethod
    def send_contact_request_message(
        instance: EvolutionInstance,
        recipient_phone: str,
        sender_name: str,
        include_vcard: bool = True
    ) -> Dict:
        """
        Envia mensagem pedindo para salvar o contato + vCard opcional
        
        Args:
            instance: Instância Evolution API
            recipient_phone: Telefone do destinatário
            sender_name: Nome do remetente
            include_vcard: Se deve incluir vCard
        
        Returns:
            Dict com resultado
        """
        try:
            # Mensagem pedindo para salvar
            message = f"""Olá! 👋

Este é o *{sender_name}* 📖

Para receber nossos devocionais diários, por favor, salve este número em seus contatos.

Assim você verá nosso nome ao invés do número! 😊

Que Deus abençoe seu dia! 🙏"""
            
            # Formatar telefone
            recipient_clean = ''.join(filter(str.isdigit, recipient_phone))
            if not recipient_clean.startswith('55') and len(recipient_clean) == 11:
                recipient_clean = '55' + recipient_clean
            
            # Enviar mensagem de texto primeiro
            headers = {
                "Content-Type": "application/json",
                "apikey": instance.api_key
            }
            
            url = f"{instance.api_url}/message/sendText/{instance.name}"
            
            payload = {
                "number": recipient_clean,
                "text": message
            }
            
            response = requests.post(url, json=payload, headers=headers, timeout=30)
            
            result = {
                "message_sent": response.status_code in [200, 201],
                "vcard_sent": False
            }
            
            # Se incluir vCard, enviar também
            if include_vcard and result["message_sent"]:
                # Obter número da instância (se disponível)
                contact_phone = instance.phone_number or recipient_clean
                
                vcard_result = VCardService.send_vcard(
                    instance=instance,
                    recipient_phone=recipient_phone,
                    contact_name=sender_name,
                    contact_phone=contact_phone,
                    organization="Devocional Diário"
                )
                
                result["vcard_sent"] = vcard_result.get("success", False)
                result["vcard_result"] = vcard_result
            
            return result
        
        except Exception as e:
            logger.error(f"Erro ao enviar mensagem de solicitação de contato: {e}")
            return {
                "message_sent": False,
                "vcard_sent": False,
                "error": str(e)
            }

