"""
Gerenciador de Múltiplas Instâncias Evolution API
Sistema de rotação e distribuição de carga entre instâncias
"""
import logging
import requests
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
import random
import time

logger = logging.getLogger(__name__)


class InstanceStatus(Enum):
    """Status da instância"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    ERROR = "error"
    BLOCKED = "blocked"
    WARMING_UP = "warming_up"


@dataclass
class EvolutionInstance:
    """Representa uma instância Evolution API"""
    name: str
    api_url: str
    api_key: str
    display_name: str  # Nome que aparece no WhatsApp
    phone_number: Optional[str] = None  # Número da instância
    status: InstanceStatus = InstanceStatus.INACTIVE
    last_check: Optional[datetime] = None
    messages_sent_today: int = 0
    messages_sent_this_hour: int = 0
    last_message_time: Optional[datetime] = None
    error_count: int = 0
    last_error: Optional[str] = None
    max_messages_per_hour: int = 20
    max_messages_per_day: int = 200
    priority: int = 1  # 1 = alta, 2 = média, 3 = baixa
    enabled: bool = True


class InstanceManager:
    """
    Gerenciador de múltiplas instâncias Evolution API
    - Rotação automática entre instâncias
    - Distribuição de carga
    - Health check
    - Failover automático
    """
    
    def __init__(self, instances: List[Dict[str, any]]):
        """
        Inicializa o gerenciador com lista de instâncias
        
        Args:
            instances: Lista de dicionários com configuração das instâncias
                [
                    {
                        "name": "Devocional-1",
                        "api_url": "http://localhost:8080",
                        "api_key": "key1",
                        "display_name": "Devocional Diário",
                        "max_messages_per_hour": 20,
                        "max_messages_per_day": 200,
                        "priority": 1
                    },
                    ...
                ]
        """
        self.instances: List[EvolutionInstance] = []
        
        for instance_config in instances:
            instance = EvolutionInstance(
                name=instance_config.get("name"),
                api_url=instance_config.get("api_url"),
                api_key=instance_config.get("api_key"),
                display_name=instance_config.get("display_name", "Devocional"),
                max_messages_per_hour=instance_config.get("max_messages_per_hour", 20),
                max_messages_per_day=instance_config.get("max_messages_per_day", 200),
                priority=instance_config.get("priority", 1),
                enabled=instance_config.get("enabled", True)
            )
            self.instances.append(instance)
        
        logger.info(f"InstanceManager inicializado com {len(self.instances)} instâncias")
    
    def get_available_instance(self, strategy: str = "round_robin") -> Optional[EvolutionInstance]:
        """
        Retorna uma instância disponível para envio
        
        Args:
            strategy: Estratégia de seleção
                - "round_robin": Rotação circular
                - "least_used": Menos usada
                - "priority": Por prioridade
                - "random": Aleatória
        
        Returns:
            EvolutionInstance disponível ou None
        """
        # Filtrar instâncias ativas e habilitadas
        available = [
            inst for inst in self.instances
            if inst.enabled 
            and inst.status == InstanceStatus.ACTIVE
            and inst.messages_sent_today < inst.max_messages_per_day
            and inst.messages_sent_this_hour < inst.max_messages_per_hour
        ]
        
        if not available:
            logger.warning("Nenhuma instância disponível")
            return None
        
        # Aplicar estratégia
        if strategy == "round_robin":
            # Rotação circular baseada em última mensagem
            available.sort(key=lambda x: x.last_message_time or datetime.min)
            return available[0]
        
        elif strategy == "least_used":
            # Menos mensagens enviadas hoje
            available.sort(key=lambda x: x.messages_sent_today)
            return available[0]
        
        elif strategy == "priority":
            # Por prioridade (menor número = maior prioridade)
            available.sort(key=lambda x: (x.priority, x.messages_sent_today))
            return available[0]
        
        elif strategy == "random":
            return random.choice(available)
        
        else:
            # Default: round_robin
            available.sort(key=lambda x: x.last_message_time or datetime.min)
            return available[0]
    
    def check_instance_health(self, instance: EvolutionInstance) -> bool:
        """
        Verifica saúde de uma instância
        
        Returns:
            True se saudável, False caso contrário
        """
        try:
            headers = {
                "apikey": instance.api_key
            }
            
            url = f"{instance.api_url}/instance/fetchInstances"
            
            response = requests.get(url, headers=headers, timeout=10)
            
            if response.status_code == 200:
                instances_data = response.json()
                
                # Procurar nossa instância
                for inst_data in instances_data:
                    if inst_data.get('instanceName') == instance.name:
                        state = inst_data.get('state', 'unknown')
                        
                        if state in ['open', 'connected']:
                            instance.status = InstanceStatus.ACTIVE
                            instance.error_count = 0
                            instance.last_check = datetime.now()
                            return True
                        else:
                            instance.status = InstanceStatus.INACTIVE
                            instance.last_check = datetime.now()
                            return False
                
                # Instância não encontrada
                instance.status = InstanceStatus.ERROR
                instance.last_error = "Instância não encontrada"
                return False
            
            else:
                instance.status = InstanceStatus.ERROR
                instance.last_error = f"HTTP {response.status_code}"
                instance.error_count += 1
                return False
        
        except Exception as e:
            instance.status = InstanceStatus.ERROR
            instance.last_error = str(e)
            instance.error_count += 1
            logger.error(f"Erro ao verificar saúde da instância {instance.name}: {e}")
            return False
    
    def check_all_instances(self):
        """Verifica saúde de todas as instâncias"""
        for instance in self.instances:
            if instance.enabled:
                self.check_instance_health(instance)
    
    def update_instance_stats(self, instance: EvolutionInstance, success: bool = True):
        """
        Atualiza estatísticas de uma instância após envio
        
        Args:
            instance: Instância que enviou
            success: Se o envio foi bem-sucedido
        """
        if success:
            instance.messages_sent_today += 1
            instance.messages_sent_this_hour += 1
            instance.last_message_time = datetime.now()
            instance.error_count = 0
        else:
            instance.error_count += 1
            if instance.error_count >= 5:
                instance.status = InstanceStatus.ERROR
                logger.warning(f"Instância {instance.name} com muitos erros, marcando como ERROR")
    
    def reset_daily_counters(self):
        """Reseta contadores diários de todas as instâncias"""
        now = datetime.now()
        for instance in self.instances:
            if instance.last_message_time:
                # Reset diário
                if (now - instance.last_message_time).days >= 1:
                    instance.messages_sent_today = 0
                
                # Reset horário
                if instance.last_message_time.hour != now.hour:
                    instance.messages_sent_this_hour = 0
    
    def reset_hourly_counters(self):
        """Reseta contadores horários de todas as instâncias"""
        now = datetime.now()
        for instance in self.instances:
            if instance.last_message_time and instance.last_message_time.hour != now.hour:
                instance.messages_sent_this_hour = 0
    
    def get_instance_by_name(self, name: str) -> Optional[EvolutionInstance]:
        """Retorna instância por nome"""
        for instance in self.instances:
            if instance.name == name:
                return instance
        return None
    
    def get_stats(self) -> Dict:
        """Retorna estatísticas de todas as instâncias"""
        return {
            "total_instances": len(self.instances),
            "active_instances": sum(1 for i in self.instances if i.status == InstanceStatus.ACTIVE),
            "inactive_instances": sum(1 for i in self.instances if i.status == InstanceStatus.INACTIVE),
            "error_instances": sum(1 for i in self.instances if i.status == InstanceStatus.ERROR),
            "instances": [
                {
                    "name": inst.name,
                    "display_name": inst.display_name,
                    "status": inst.status.value,
                    "messages_sent_today": inst.messages_sent_today,
                    "messages_sent_this_hour": inst.messages_sent_this_hour,
                    "max_per_hour": inst.max_messages_per_hour,
                    "max_per_day": inst.max_messages_per_day,
                    "error_count": inst.error_count,
                    "last_error": inst.last_error,
                    "last_check": inst.last_check.isoformat() if inst.last_check else None,
                    "enabled": inst.enabled
                }
                for inst in self.instances
            ]
        }
    
    def set_instance_profile(self, instance: EvolutionInstance, name: str, status: Optional[str] = None) -> bool:
        """
        Define o perfil (nome) da instância no WhatsApp
        
        Args:
            instance: Instância a configurar
            name: Nome que aparecerá no WhatsApp
            status: Status/descrição (opcional)
        
        Returns:
            True se sucesso
        """
        try:
            headers = {
                "apikey": instance.api_key,
                "Content-Type": "application/json"
            }
            
            # Endpoint para atualizar perfil
            url = f"{instance.api_url}/profile/updateProfileName/{instance.name}"
            
            payload = {
                "name": name
            }
            
            if status:
                payload["status"] = status
            
            response = requests.put(url, json=payload, headers=headers, timeout=10)
            
            if response.status_code in [200, 201]:
                instance.display_name = name
                logger.info(f"Perfil da instância {instance.name} atualizado para: {name}")
                return True
            else:
                logger.error(f"Erro ao atualizar perfil: {response.status_code} - {response.text}")
                return False
        
        except Exception as e:
            logger.error(f"Erro ao atualizar perfil da instância {instance.name}: {e}")
            return False

