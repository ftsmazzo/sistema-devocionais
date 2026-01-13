"""
Serviço para sincronizar status de mensagens com Evolution API
Consulta periodicamente a Evolution API para atualizar status de mensagens pendentes/entregues
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
        Sincroniza status de mensagens pendentes/entregues com Evolution API
        Busca mensagens recentes da Evolution API e compara com o banco
        
        Args:
            hours_back: Quantas horas atrás buscar mensagens
            
        Returns:
            Dict com estatísticas da sincronização
        """
        try:
            # Buscar mensagens que ainda não foram lidas das últimas X horas
            cutoff_time = now_brazil_naive() - timedelta(hours=hours_back)
            
            # Query que não depende de message_type (campo pode não existir ainda)
            try:
                messages_to_check = self.db.query(DevocionalEnvio).filter(
                    DevocionalEnvio.message_status.in_(["pending", "sent", "delivered"]),
                    DevocionalEnvio.sent_at >= cutoff_time,
                    DevocionalEnvio.message_id.isnot(None)
                ).all()
            except Exception as db_error:
                # Se a coluna message_type não existir, fazer query sem ela
                if "message_type" in str(db_error):
                    logger.warning("⚠️ Coluna message_type não existe ainda. Executando query alternativa...")
                    # Usar query SQL direta para evitar problema com coluna inexistente
                    from sqlalchemy import text
                    result = self.db.execute(text("""
                        SELECT id, devocional_id, recipient_phone, recipient_name, message_text, 
                               status, message_id, error_message, retry_count, message_status, 
                               delivered_at, read_at, instance_name, sent_at, scheduled_for, created_at
                        FROM devocional_envios
                        WHERE message_status IN ('pending', 'sent', 'delivered')
                          AND sent_at >= :cutoff_time
                          AND message_id IS NOT NULL
                    """), {"cutoff_time": cutoff_time})
                    messages_to_check = []
                    for row in result:
                        # Criar objeto DevocionalEnvio manualmente
                        envio = DevocionalEnvio()
                        envio.id = row[0]
                        envio.devocional_id = row[1]
                        envio.recipient_phone = row[2]
                        envio.recipient_name = row[3]
                        envio.message_text = row[4]
                        envio.status = row[5]
                        envio.message_id = row[6]
                        envio.error_message = row[7]
                        envio.retry_count = row[8]
                        envio.message_status = row[9]
                        envio.delivered_at = row[10]
                        envio.read_at = row[11]
                        envio.instance_name = row[12]
                        envio.sent_at = row[13]
                        envio.scheduled_for = row[14]
                        envio.created_at = row[15]
                        messages_to_check.append(envio)
                else:
                    raise
            
            logger.info(f"🔄 Sincronizando {len(messages_to_check)} mensagens com Evolution API")
            
            if not messages_to_check:
                return {
                    "success": True,
                    "messages_checked": 0,
                    "messages_updated": 0,
                    "errors": 0
                }
            
            # Agrupar por instância
            messages_by_instance = {}
            for msg in messages_to_check:
                instance_name = msg.instance_name
                if not instance_name:
                    continue
                if instance_name not in messages_by_instance:
                    messages_by_instance[instance_name] = []
                messages_by_instance[instance_name].append(msg)
            
            updated_count = 0
            error_count = 0
            
            # Para cada instância, buscar mensagens recentes da Evolution API
            for instance_name, messages in messages_by_instance.items():
                try:
                    instance_config = self.instance_service.get_instance_by_name(instance_name)
                    if not instance_config:
                        logger.warning(f"⚠️ Instância {instance_name} não encontrada no banco")
                        continue
                    
                    # Buscar mensagens recentes da Evolution API
                    recent_messages = self._fetch_recent_messages_from_evolution(
                        instance_config.api_url,
                        instance_config.api_key,
                        instance_name,
                        limit=100  # Buscar últimas 100 mensagens
                    )
                    
                    if not recent_messages:
                        logger.debug(f"ℹ️ Nenhuma mensagem recente encontrada na Evolution API para {instance_name}")
                        continue
                    
                    # Criar mapa de message_id -> status da Evolution API
                    evolution_status_map = {}
                    for evo_msg in recent_messages:
                        msg_id = evo_msg.get("key", {}).get("id") or evo_msg.get("keyId") or evo_msg.get("id")
                        if msg_id:
                            # Verificar status mais recente da mensagem
                            status_updates = evo_msg.get("status", [])
                            if status_updates:
                                # Pegar último status (mais recente)
                                last_status = status_updates[-1] if isinstance(status_updates, list) else status_updates
                                evolution_status_map[msg_id] = last_status
                            else:
                                # Se não tem status explícito, verificar se tem ack
                                ack = evo_msg.get("ack")
                                if ack == 1:
                                    evolution_status_map[msg_id] = "SERVER_ACK"
                                elif ack == 2:
                                    evolution_status_map[msg_id] = "DELIVERY_ACK"
                                elif ack == 3:
                                    evolution_status_map[msg_id] = "READ"
                    
                    # Comparar e atualizar mensagens do banco
                    for msg in messages:
                        try:
                            evo_status = evolution_status_map.get(msg.message_id)
                            if evo_status:
                                # Atualizar status se necessário
                                updated = self._update_status_from_evolution(msg, evo_status)
                                if updated:
                                    updated_count += 1
                        except Exception as e:
                            logger.error(f"❌ Erro ao processar mensagem {msg.message_id}: {e}")
                            error_count += 1
                            
                except Exception as e:
                    logger.error(f"❌ Erro ao processar instância {instance_name}: {e}", exc_info=True)
                    error_count += len(messages)
            
            self.db.commit()
            
            if updated_count > 0:
                logger.info(f"✅ Sincronização concluída: {updated_count} atualizadas, {error_count} erros")
            
            return {
                "success": True,
                "messages_checked": len(messages_to_check),
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
    
    def _fetch_recent_messages_from_evolution(
        self,
        api_url: str,
        api_key: str,
        instance_name: str,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Busca mensagens recentes da Evolution API
        
        Args:
            api_url: URL da Evolution API
            api_key: API Key
            instance_name: Nome da instância
            limit: Quantidade de mensagens a buscar
            
        Returns:
            Lista de mensagens da Evolution API
        """
        try:
            headers = {"apikey": api_key}
            
            # Tentar diferentes endpoints da Evolution API
            endpoints_to_try = [
                f"{api_url}/chat/fetchMessages/{instance_name}",
                f"{api_url}/message/fetchMessages/{instance_name}",
                f"{api_url}/chat/getMessages/{instance_name}",
            ]
            
            for endpoint in endpoints_to_try:
                try:
                    response = requests.get(
                        endpoint,
                        headers=headers,
                        params={"limit": limit},
                        timeout=10
                    )
                    
                    if response.status_code == 200:
                        messages = response.json()
                        if isinstance(messages, list):
                            logger.debug(f"✅ Buscadas {len(messages)} mensagens de {endpoint}")
                            return messages
                        elif isinstance(messages, dict) and "messages" in messages:
                            msgs = messages.get("messages", [])
                            logger.debug(f"✅ Buscadas {len(msgs)} mensagens de {endpoint}")
                            return msgs
                except Exception as e:
                    logger.debug(f"Endpoint {endpoint} não funcionou: {e}")
                    continue
            
            # Não é erro crítico - os webhooks continuam funcionando
            # Apenas logar em nível debug para não poluir os logs
            logger.debug(f"ℹ️ Nenhum endpoint de busca funcionou para {instance_name} (webhooks continuam funcionando)")
            return []
            
        except Exception as e:
            logger.error(f"❌ Erro ao buscar mensagens da Evolution API: {e}", exc_info=True)
            return []
    
    def _update_status_from_evolution(
        self,
        envio: DevocionalEnvio,
        evo_status: str
    ) -> bool:
        """
        Atualiza status de uma mensagem baseado no status da Evolution API
        
        Args:
            envio: Registro de envio no banco
            evo_status: Status da Evolution API (SERVER_ACK, DELIVERY_ACK, READ)
            
        Returns:
            True se atualizou, False caso contrário
        """
        try:
            updated = False
            phone = envio.recipient_phone
            
            if evo_status == "SERVER_ACK" and envio.message_status != "sent":
                envio.message_status = "sent"
                envio.status = "sent"
                updated = True
                logger.debug(f"✅ Sync: Mensagem {envio.message_id} atualizada para SENT")
                
            elif evo_status == "DELIVERY_ACK" and envio.message_status not in ["delivered", "read"]:
                envio.message_status = "delivered"
                envio.delivered_at = now_brazil_naive()
                updated = True
                logger.info(f"✅ Sync: Mensagem {envio.message_id} atualizada para DELIVERED")
                
                # Atualizar engajamento
                update_engagement_from_delivered(self.db, phone, True, envio.message_id)
                
            elif evo_status == "READ" and envio.message_status != "read":
                envio.message_status = "read"
                envio.read_at = now_brazil_naive()
                # IMPORTANTE: Se passou direto de pending para READ, marcar como delivered também
                if not envio.delivered_at:
                    envio.delivered_at = envio.read_at
                    logger.info(f"✅ Sync: Mensagem {envio.message_id} marcada como DELIVERED (passou direto para READ)")
                    # Atualizar engajamento de delivered também
                    update_engagement_from_delivered(self.db, phone, True, envio.message_id)
                updated = True
                logger.info(f"✅✅ Sync: Mensagem {envio.message_id} atualizada para READ")
                
                # Atualizar engajamento no banco
                update_engagement_from_read(self.db, phone, True, envio.message_id)
            
            return updated
            
        except Exception as e:
            logger.error(f"❌ Erro ao atualizar status: {e}", exc_info=True)
            return False
