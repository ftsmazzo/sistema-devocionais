"""
Serviço para sincronizar status de mensagens com Evolution API
Consulta periodicamente a Evolution API para atualizar status de mensagens pendentes
"""
import logging
import requests
from typing import List, Dict, Optional, Any
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.database import DevocionalEnvio, EvolutionInstanceConfig
from app.instance_service import InstanceService
from app.timezone_utils import now_brazil_naive
from app.routers.webhook_evolution import update_engagement_from_delivered, update_engagement_from_read

logger = logging.getLogger(__name__)


class MessageStatusSync:
    """Serviço para sincronizar status de mensagens com Evolution API"""
    
    def __init__(self, db: Session):
        self.db = db
        self.instance_service = InstanceService(db)
    
    def sync_pending_messages(self, hours_back: int = 24) -> Dict[str, Any]:
        """
        Sincroniza status de mensagens pendentes com Evolution API
        
        Args:
            hours_back: Quantas horas atrás buscar mensagens pendentes
            
        Returns:
            Dict com estatísticas da sincronização
        """
        try:
            # Buscar mensagens pendentes das últimas X horas
            cutoff_time = now_brazil_naive() - timedelta(hours=hours_back)
            
            pending_messages = self.db.query(DevocionalEnvio).filter(
                DevocionalEnvio.message_status.in_(["pending", "sent"]),
                DevocionalEnvio.sent_at >= cutoff_time,
                DevocionalEnvio.message_id.isnot(None)
            ).all()
            
            logger.info(f"🔄 Sincronizando {len(pending_messages)} mensagens pendentes")
            
            if not pending_messages:
                return {
                    "success": True,
                    "messages_checked": 0,
                    "messages_updated": 0,
                    "errors": 0
                }
            
            # Agrupar por instância
            messages_by_instance = {}
            for msg in pending_messages:
                instance_name = msg.instance_name
                if not instance_name:
                    continue
                if instance_name not in messages_by_instance:
                    messages_by_instance[instance_name] = []
                messages_by_instance[instance_name].append(msg)
            
            updated_count = 0
            error_count = 0
            
            # Para cada instância, buscar status das mensagens
            for instance_name, messages in messages_by_instance.items():
                try:
                    instance_config = self.instance_service.get_instance_by_name(instance_name)
                    if not instance_config:
                        logger.warning(f"⚠️ Instância {instance_name} não encontrada no banco")
                        continue
                    
                    # NOTA: A Evolution API não tem endpoint para buscar status por message_id
                    # O status só vem via webhook. Por isso, este sync apenas verifica se há
                    # mensagens muito antigas que ainda estão pendentes e marca como possivelmente falhadas
                    for msg in messages:
                        try:
                            # Se mensagem está pendente há mais de 1 hora, pode ter falhado
                            time_since_sent = now_brazil_naive() - msg.sent_at
                            if time_since_sent.total_seconds() > 3600:  # 1 hora
                                # Marcar como possivelmente falhada se ainda está pending
                                if msg.message_status == "pending":
                                    msg.message_status = "failed"
                                    msg.status = "failed"
                                    updated_count += 1
                                    logger.info(f"⚠️ Mensagem {msg.message_id} marcada como falhada (pendente há mais de 1h)")
                        except Exception as e:
                            logger.error(f"❌ Erro ao processar mensagem {msg.message_id}: {e}")
                            error_count += 1
                            
                except Exception as e:
                    logger.error(f"❌ Erro ao processar instância {instance_name}: {e}")
                    error_count += len(messages)
            
            self.db.commit()
            
            logger.info(f"✅ Sincronização concluída: {updated_count} atualizadas, {error_count} erros")
            
            return {
                "success": True,
                "messages_checked": len(pending_messages),
                "messages_updated": updated_count,
                "errors": error_count
            }
            
        except Exception as e:
            logger.error(f"❌ Erro na sincronização de status: {e}", exc_info=True)
            self.db.rollback()
            return {
                "success": False,
                "error": str(e),
                "messages_checked": 0,
                "messages_updated": 0,
                "errors": 1
            }
    
    def _fetch_message_status(
        self,
        api_url: str,
        api_key: str,
        instance_name: str,
        message_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        NOTA: A Evolution API não tem endpoint direto para buscar status por message_id.
        O status só vem via webhook. Este método é um placeholder para futuras implementações.
        Por enquanto, retornamos None e confiamos apenas no webhook.
        
        TODO: Se a Evolution API adicionar endpoint para buscar status, implementar aqui.
        """
        # A Evolution API não expõe endpoint para buscar status de mensagem específica
        # O status só é disponibilizado via webhook em tempo real
        # Por isso, este método retorna None e confiamos apenas no webhook
        logger.debug(f"ℹ️ Evolution API não tem endpoint para buscar status por ID. Confiando apenas no webhook.")
        return None
    
    def _update_message_status(
        self,
        envio: DevocionalEnvio,
        status_data: Dict[str, Any],
        instance_name: str
    ) -> bool:
        """
        Atualiza status de uma mensagem no banco
        
        Args:
            envio: Registro de envio no banco
            status_data: Dados de status da Evolution API
            instance_name: Nome da instância
            
        Returns:
            True se atualizou, False caso contrário
        """
        try:
            status = status_data.get("status", "").upper()
            phone = status_data.get("phone") or envio.recipient_phone
            
            updated = False
            
            # Mapear status da Evolution API
            if status == "SERVER_ACK" and envio.message_status != "sent":
                envio.message_status = "sent"
                envio.status = "sent"
                updated = True
                logger.debug(f"✅ Mensagem {envio.message_id} atualizada para SENT")
                
            elif status == "DELIVERY_ACK" and envio.message_status not in ["delivered", "read"]:
                envio.message_status = "delivered"
                envio.delivered_at = now_brazil_naive()
                updated = True
                logger.debug(f"✅ Mensagem {envio.message_id} atualizada para DELIVERED")
                
                # Atualizar engajamento
                update_engagement_from_delivered(self.db, phone, True)
                
            elif status == "READ" and envio.message_status != "read":
                envio.message_status = "read"
                envio.read_at = now_brazil_naive()
                if not envio.delivered_at:
                    envio.delivered_at = envio.read_at
                updated = True
                logger.debug(f"✅✅ Mensagem {envio.message_id} atualizada para READ")
                
                # Atualizar engajamento
                update_engagement_from_read(self.db, phone, True)
            
            return updated
            
        except Exception as e:
            logger.error(f"❌ Erro ao atualizar status: {e}", exc_info=True)
            return False
