"""
Serviço unificado para gerenciar instâncias Evolution API
Busca diretamente da Evolution API e salva configurações no banco de dados
"""
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from datetime import datetime
import requests
import logging
from app.database import EvolutionInstanceConfig
from app.config import settings

logger = logging.getLogger(__name__)


class InstanceService:
    """
    Serviço unificado para gerenciar instâncias Evolution API
    - Busca instâncias diretamente da Evolution API
    - Salva configurações no banco de dados
    - Uma única fonte de verdade
    """
    
    def __init__(self, db: Session):
        self.db = db
    
    def get_evolution_api_config(self) -> Dict[str, str]:
        """
        Obtém configuração da Evolution API do .env (apenas URL e API Key)
        Essas são as únicas coisas que precisam estar no .env
        """
        return {
            "api_url": settings.EVOLUTION_API_URL,
            "api_key": settings.EVOLUTION_API_KEY
        }
    
    def fetch_instances_from_evolution_api(self) -> List[Dict[str, Any]]:
        """
        Busca todas as instâncias diretamente da Evolution API
        """
        try:
            config = self.get_evolution_api_config()
            if not config.get("api_url") or not config.get("api_key"):
                logger.warning("Evolution API URL ou API Key não configurados no .env")
                return []
            
            headers = {"apikey": config["api_key"]}
            url = f"{config['api_url']}/instance/fetchInstances"
            
            logger.debug(f"Buscando instâncias da Evolution API: {url}")
            response = requests.get(url, headers=headers, timeout=10)
            
            if response.status_code == 200:
                instances = response.json()
                if isinstance(instances, list):
                    logger.info(f"Encontradas {len(instances)} instâncias na Evolution API")
                    return instances
                else:
                    logger.warning(f"Resposta da Evolution API não é uma lista: {type(instances)}")
                    return []
            else:
                logger.error(f"Erro ao buscar instâncias: HTTP {response.status_code} - {response.text[:200]}")
                return []
        except Exception as e:
            logger.error(f"Erro ao buscar instâncias da Evolution API: {e}", exc_info=True)
            return []
    
    def sync_instances_from_evolution_api(self) -> List[EvolutionInstanceConfig]:
        """
        Sincroniza instâncias da Evolution API com o banco de dados
        - Busca todas as instâncias da Evolution API
        - Cria/atualiza no banco de dados
        - Retorna lista de instâncias sincronizadas
        """
        api_instances = self.fetch_instances_from_evolution_api()
        config = self.get_evolution_api_config()
        
        synced_instances = []
        
        for api_inst in api_instances:
            instance_name = api_inst.get('instanceName') or api_inst.get('name')
            if not instance_name:
                continue
            
            # Buscar ou criar no banco
            db_instance = self.db.query(EvolutionInstanceConfig).filter(
                EvolutionInstanceConfig.name == instance_name
            ).first()
            
            if not db_instance:
                # Criar nova instância no banco
                db_instance = EvolutionInstanceConfig(
                    name=instance_name,
                    api_url=config["api_url"],
                    api_key=config["api_key"],
                    display_name=instance_name,
                    status="unknown"
                )
                self.db.add(db_instance)
                logger.info(f"Nova instância criada no banco: {instance_name}")
            else:
                # Atualizar URL e API Key se necessário
                db_instance.api_url = config["api_url"]
                db_instance.api_key = config["api_key"]
            
            # Atualizar status e informações da Evolution API
            state = api_inst.get('state', 'unknown')
            phone = (
                api_inst.get('phoneNumber') or 
                api_inst.get('phone') or 
                api_inst.get('number') or
                api_inst.get('jid', '').split('@')[0] if api_inst.get('jid') else None
            )
            
            # Determinar status baseado no estado e número
            if state.lower() in ['open', 'connected', 'ready']:
                db_instance.status = "active"
            elif phone:
                # Tem número = provavelmente conectada
                db_instance.status = "active"
                db_instance.phone_number = str(phone).strip()
            elif state.lower() == 'unknown':
                # Verificar se tem QR code (se não tem, está conectada)
                has_qrcode = bool(api_inst.get('qrcode'))
                if not has_qrcode:
                    db_instance.status = "active"
                else:
                    db_instance.status = "inactive"
            else:
                db_instance.status = "inactive"
            
            if phone:
                db_instance.phone_number = str(phone).strip()
            
            db_instance.last_check = datetime.now()
            synced_instances.append(db_instance)
        
        self.db.commit()
        logger.info(f"Sincronizadas {len(synced_instances)} instâncias")
        return synced_instances
    
    def get_all_instances(self, sync: bool = True) -> List[EvolutionInstanceConfig]:
        """
        Obtém todas as instâncias do banco de dados
        Se sync=True, sincroniza com Evolution API antes
        """
        if sync:
            self.sync_instances_from_evolution_api()
        
        instances = self.db.query(EvolutionInstanceConfig).filter(
            EvolutionInstanceConfig.enabled == True
        ).all()
        
        return instances
    
    def get_instance_by_name(self, name: str) -> Optional[EvolutionInstanceConfig]:
        """Obtém uma instância pelo nome"""
        return self.db.query(EvolutionInstanceConfig).filter(
            EvolutionInstanceConfig.name == name
        ).first()
    
    def create_instance_config(
        self,
        name: str,
        display_name: str,
        max_messages_per_hour: int = 20,
        max_messages_per_day: int = 200,
        priority: int = 1
    ) -> EvolutionInstanceConfig:
        """
        Cria configuração de instância no banco
        A instância deve já existir na Evolution API
        """
        config = self.get_evolution_api_config()
        
        instance = EvolutionInstanceConfig(
            name=name,
            api_url=config["api_url"],
            api_key=config["api_key"],
            display_name=display_name,
            max_messages_per_hour=max_messages_per_hour,
            max_messages_per_day=max_messages_per_day,
            priority=priority,
            enabled=True,
            status="unknown"
        )
        
        self.db.add(instance)
        self.db.commit()
        self.db.refresh(instance)
        
        # Sincronizar para obter status real
        self.sync_instances_from_evolution_api()
        
        return instance
    
    def update_instance_config(
        self,
        name: str,
        display_name: Optional[str] = None,
        max_messages_per_hour: Optional[int] = None,
        max_messages_per_day: Optional[int] = None,
        priority: Optional[int] = None,
        enabled: Optional[bool] = None
    ) -> Optional[EvolutionInstanceConfig]:
        """Atualiza configuração de instância"""
        instance = self.get_instance_by_name(name)
        if not instance:
            return None
        
        if display_name is not None:
            instance.display_name = display_name
        if max_messages_per_hour is not None:
            instance.max_messages_per_hour = max_messages_per_hour
        if max_messages_per_day is not None:
            instance.max_messages_per_day = max_messages_per_day
        if priority is not None:
            instance.priority = priority
        if enabled is not None:
            instance.enabled = enabled
        
        instance.updated_at = datetime.now()
        self.db.commit()
        self.db.refresh(instance)
        
        return instance
    
    def delete_instance_config(self, name: str) -> bool:
        """Remove configuração de instância do banco (não deleta da Evolution API)"""
        instance = self.get_instance_by_name(name)
        if not instance:
            return False
        
        self.db.delete(instance)
        self.db.commit()
        return True
    
    def refresh_instance_status(self, name: str) -> Optional[EvolutionInstanceConfig]:
        """Força atualização do status de uma instância"""
        # Sincronizar todas para garantir dados atualizados
        self.sync_instances_from_evolution_api()
        return self.get_instance_by_name(name)
    
    def generate_qr_code(self, name: str) -> Optional[str]:
        """
        Gera QR code para conectar instância
        Primeiro verifica se está conectada, se não, gera QR
        """
        config = self.get_evolution_api_config()
        headers = {"apikey": config["api_key"]}
        
        # Verificar se já está conectada
        instance = self.get_instance_by_name(name)
        if instance and instance.status == "active":
            logger.info(f"Instância {name} já está conectada")
            return None
        
        # Tentar obter QR code
        qr_endpoints = [
            f"{config['api_url']}/instance/connect/{name}",
            f"{config['api_url']}/instance/{name}/connect",
            f"{config['api_url']}/instance/create",
        ]
        
        for endpoint in qr_endpoints:
            try:
                if endpoint.endswith("/create"):
                    payload = {
                        "instanceName": name,
                        "qrcode": True,
                        "integration": "WHATSAPP-BAILEYS"
                    }
                    response = requests.post(endpoint, json=payload, headers=headers, timeout=30)
                else:
                    response = requests.get(endpoint, headers=headers, timeout=30)
                
                if response.status_code == 200:
                    data = response.json()
                    qr_code = (
                        data.get("qrcode", {}).get("base64") or
                        data.get("qrcode", {}).get("code") or
                        data.get("qrcode") or
                        data.get("base64") or
                        data.get("code")
                    )
                    
                    if qr_code:
                        if isinstance(qr_code, str) and not qr_code.startswith("data:image") and not qr_code.startswith("http"):
                            qr_code = f"data:image/png;base64,{qr_code}"
                        return qr_code
            except Exception as e:
                logger.debug(f"Erro ao tentar {endpoint}: {e}")
                continue
        
        return None
