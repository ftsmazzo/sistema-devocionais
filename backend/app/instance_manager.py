"""
Gerenciador de Múltiplas Instâncias Evolution API
Sistema de rotação e distribuição de carga entre instâncias
"""
import logging
import requests
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
import random
import time
from app.timezone_utils import now_brazil

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
    name: str  # Nome configurado no .env
    api_url: str
    api_key: str
    display_name: str  # Nome que aparece no WhatsApp
    phone_number: Optional[str] = None  # Número da instância
    api_instance_name: Optional[str] = None  # Nome real da instância na Evolution API (pode ser diferente do name)
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
    profile_configured: bool = False  # Se o perfil já foi configurado
    last_profile_config_attempt: Optional[datetime] = None  # Última tentativa de configurar perfil
    enabled: bool = True


class InstanceManager:
    """
    Gerenciador de múltiplas instâncias Evolution API
    - Rotação automática entre instâncias
    - Distribuição de carga
    - Health check
    - Failover automático
    """
    
    def __init__(self, instances: Optional[List[Dict[str, any]]] = None, db: Optional[Any] = None):
        """
        Inicializa o gerenciador com lista de instâncias
        
        Args:
            instances: Lista de dicionários com configuração das instâncias (legado)
            db: Sessão do banco de dados (novo método - preferido)
        """
        self.instances: List[EvolutionInstance] = []
        
        # Se db fornecido, buscar do banco de dados
        if db is not None:
            from app.instance_service import InstanceService
            service = InstanceService(db)
            db_instances = service.get_all_instances(sync=True)
            
            for db_inst in db_instances:
                # Converter status string para enum
                status_map = {
                    "active": InstanceStatus.ACTIVE,
                    "inactive": InstanceStatus.INACTIVE,
                    "error": InstanceStatus.ERROR,
                    "blocked": InstanceStatus.BLOCKED,
                }
                # Usar getattr para evitar erro se status não existir
                status_str = getattr(db_inst, 'status', 'unknown') or 'unknown'
                status = status_map.get(status_str, InstanceStatus.INACTIVE)
                
                instance = EvolutionInstance(
                    name=db_inst.name,
                    api_url=db_inst.api_url,
                    api_key=db_inst.api_key,
                    display_name=db_inst.display_name or db_inst.name,
                    phone_number=getattr(db_inst, 'phone_number', None),
                    status=status,
                    last_check=getattr(db_inst, 'last_check', None),
                    messages_sent_today=getattr(db_inst, 'messages_sent_today', 0),
                    messages_sent_this_hour=getattr(db_inst, 'messages_sent_this_hour', 0),
                    max_messages_per_hour=db_inst.max_messages_per_hour,
                    max_messages_per_day=db_inst.max_messages_per_day,
                    priority=db_inst.priority,
                    enabled=db_inst.enabled,
                    error_count=getattr(db_inst, 'error_count', 0),
                    last_error=getattr(db_inst, 'last_error', None)
                )
                self.instances.append(instance)
        elif instances:
            # Método legado - usar lista de dicionários
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
    
    def get_available_instance(self, strategy: str = "round_robin", contact_id: Optional[int] = None) -> Optional[EvolutionInstance]:
        """
        Retorna uma instância disponível para envio
        
        Args:
            strategy: Estratégia de seleção
                - "round_robin": Rotação circular
                - "least_used": Menos usada
                - "priority": Por prioridade
                - "random": Aleatória
                - "contact_id": Distribuição baseada no ID do contato (usa contact_id)
            contact_id: ID do contato para distribuição baseada em ID (usado com strategy="contact_id")
        
        Returns:
            EvolutionInstance disponível ou None
        """
        # Primeiro, tentar verificar saúde de instâncias que não foram verificadas recentemente
        # IMPORTANTE: Verificar especialmente instâncias INACTIVE, pois podem estar funcionando
        now = now_brazil()
        for inst in self.instances:
            if inst.enabled:
                # Se nunca foi verificada, foi há mais de 5 minutos, ou está INACTIVE, verificar agora
                should_check = (
                    not inst.last_check 
                    or (now - inst.last_check).total_seconds() > 300
                    or inst.status == InstanceStatus.INACTIVE
                )
                if should_check:
                    logger.info(f"🔍 Verificando saúde da instância {inst.name} (status atual: {inst.status.value})...")
                    was_inactive = inst.status == InstanceStatus.INACTIVE
                    self.check_instance_health(inst)
                    if was_inactive and inst.status == InstanceStatus.ACTIVE:
                        logger.info(f"✅ Instância {inst.name} estava INACTIVE e agora está ACTIVE!")
        
        # Log detalhado de TODAS as instâncias antes de filtrar
        logger.info(f"🔍 Todas as instâncias carregadas ({len(self.instances)}):")
        for inst in self.instances:
            logger.info(f"   - {inst.name}: enabled={inst.enabled}, status={inst.status.value}, today={inst.messages_sent_today}/{inst.max_messages_per_day}, hour={inst.messages_sent_this_hour}/{inst.max_messages_per_hour}")
        
        # Para distribuição por ID, considerar TODAS as instâncias habilitadas (não apenas ACTIVE)
        # Isso garante que a distribuição funcione mesmo se algumas instâncias estiverem INACTIVE
        if strategy == "contact_id" and contact_id is not None:
            # Para distribuição por ID, usar todas as instâncias habilitadas (exceto ERROR/BLOCKED)
            available = [
                inst for inst in self.instances
                if inst.enabled 
                and inst.status != InstanceStatus.ERROR
                and inst.status != InstanceStatus.BLOCKED
                and inst.messages_sent_today < inst.max_messages_per_day
                and inst.messages_sent_this_hour < inst.max_messages_per_hour
            ]
            
            # Log detalhado das instâncias excluídas e motivo
            excluded = [
                inst for inst in self.instances
                if inst not in available
            ]
            if excluded:
                logger.warning(f"⚠️ Instâncias excluídas da distribuição ({len(excluded)}):")
                for inst in excluded:
                    reasons = []
                    if not inst.enabled:
                        reasons.append("disabled")
                    if inst.status == InstanceStatus.ERROR:
                        reasons.append(f"status=ERROR")
                    if inst.status == InstanceStatus.BLOCKED:
                        reasons.append(f"status=BLOCKED")
                    if inst.messages_sent_today >= inst.max_messages_per_day:
                        reasons.append(f"daily_limit ({inst.messages_sent_today}/{inst.max_messages_per_day})")
                    if inst.messages_sent_this_hour >= inst.max_messages_per_hour:
                        reasons.append(f"hourly_limit ({inst.messages_sent_this_hour}/{inst.max_messages_per_hour})")
                    logger.warning(f"   - {inst.name}: {', '.join(reasons) if reasons else 'desconhecido'}")
            
            logger.info(f"📊 Distribuição por ID: {len(available)} instâncias disponíveis de {len(self.instances)} total. Status: {[(i.name, i.status.value) for i in available]}")
        else:
            # Para outras estratégias, priorizar apenas ACTIVE
            # Filtrar instâncias ativas e habilitadas
            available = [
                inst for inst in self.instances
                if inst.enabled 
                and inst.status == InstanceStatus.ACTIVE
                and inst.messages_sent_today < inst.max_messages_per_day
                and inst.messages_sent_this_hour < inst.max_messages_per_hour
            ]
            
            # Se não houver instâncias ACTIVE, tentar usar INACTIVE (pode estar apenas não verificada)
            if not available:
                logger.warning("⚠️ Nenhuma instância ACTIVE disponível, tentando instâncias INACTIVE/UNKNOWN...")
                available = [
                    inst for inst in self.instances
                    if inst.enabled 
                    and inst.status != InstanceStatus.ERROR
                    and inst.status != InstanceStatus.BLOCKED
                    and inst.messages_sent_today < inst.max_messages_per_day
                    and inst.messages_sent_this_hour < inst.max_messages_per_hour
                ]
                if available:
                    logger.info(f"✅ Encontradas {len(available)} instâncias INACTIVE/UNKNOWN que podem ser usadas: {[i.name for i in available]}")
        
        if not available:
            logger.error(f"❌ Nenhuma instância disponível!")
            logger.error(f"📋 Status detalhado de TODAS as instâncias:")
            for inst in self.instances:
                reasons = []
                if not inst.enabled:
                    reasons.append("❌ DISABLED")
                if inst.status == InstanceStatus.ERROR:
                    reasons.append(f"❌ ERROR: {inst.last_error}")
                if inst.status == InstanceStatus.BLOCKED:
                    reasons.append("❌ BLOCKED")
                if inst.messages_sent_today >= inst.max_messages_per_day:
                    reasons.append(f"⚠️ Daily limit: {inst.messages_sent_today}/{inst.max_messages_per_day}")
                if inst.messages_sent_this_hour >= inst.max_messages_per_hour:
                    reasons.append(f"⚠️ Hourly limit: {inst.messages_sent_this_hour}/{inst.max_messages_per_hour}")
                if inst.status == InstanceStatus.INACTIVE:
                    reasons.append("⚠️ INACTIVE (pode precisar de health check)")
                if inst.status == InstanceStatus.ACTIVE:
                    reasons.append("✅ ACTIVE mas excluída por outro motivo")
                
                status_msg = f"   - {inst.name}: status={inst.status.value}"
                if reasons:
                    status_msg += f" | {', '.join(reasons)}"
                logger.error(status_msg)
            
            # Tentar uma última verificação de health check em instâncias INACTIVE antes de desistir
            logger.warning("🔄 Tentando verificar health de instâncias INACTIVE uma última vez...")
            for inst in self.instances:
                if inst.enabled and inst.status == InstanceStatus.INACTIVE:
                    logger.info(f"   Verificando {inst.name}...")
                    self.check_instance_health(inst)
                    if inst.status == InstanceStatus.ACTIVE:
                        logger.info(f"   ✅ {inst.name} agora está ACTIVE!")
                        # Tentar novamente com esta instância
                        if inst.messages_sent_today < inst.max_messages_per_day and inst.messages_sent_this_hour < inst.max_messages_per_hour:
                            logger.info(f"   ✅ {inst.name} pode ser usada agora!")
                            return inst
            
            return None
        
        # Aplicar estratégia
        if strategy == "contact_id" and contact_id is not None:
            # Distribuição baseada no ID do contato (round-robin por ID)
            # ID 1 -> Instância 0, ID 2 -> Instância 1, ID 3 -> Instância 2, etc.
            # Ordenar instâncias por nome para garantir ordem consistente
            available.sort(key=lambda x: x.name)
            instance_index = (contact_id - 1) % len(available)
            selected = available[instance_index]
            logger.debug(f"📊 Distribuição por ID: Contato ID {contact_id} -> Instância {selected.name} (índice {instance_index} de {len(available)})")
            return selected
        elif strategy == "round_robin":
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
            
            # Tentar diferentes formatos de URL da Evolution API
            urls_to_try = [
                f"{instance.api_url}/instance/fetchInstances",
                f"{instance.api_url.rstrip('/')}/instance/fetchInstances",
                f"{instance.api_url}/fetchInstances",
            ]
            
            response = None
            last_error = None
            
            for url in urls_to_try:
                try:
                    logger.debug(f"Verificando instância {instance.name} em {url}")
                    response = requests.get(url, headers=headers, timeout=10)
                    if response.status_code == 200:
                        break
                    else:
                        last_error = f"HTTP {response.status_code}"
                        logger.debug(f"URL {url} retornou {response.status_code}, tentando próxima...")
                except requests.exceptions.RequestException as e:
                    last_error = str(e)
                    logger.debug(f"Erro ao tentar {url}: {e}")
                    continue
            
            if not response or response.status_code != 200:
                error_msg = last_error or f"HTTP {response.status_code if response else 'N/A'}"
                instance.status = InstanceStatus.ERROR
                instance.last_error = f"Erro ao verificar instância: {error_msg}"
                instance.error_count += 1
                instance.last_check = datetime.now()
                logger.error(f"Erro ao verificar {instance.name}: {error_msg}")
                return False
            
            if response.status_code == 200:
                instances_data = response.json()
                
                # Se retornar lista vazia ou não for lista
                if not isinstance(instances_data, list):
                    logger.warning(f"Resposta inesperada da API para {instance.name}: {type(instances_data)}")
                    instance.status = InstanceStatus.ERROR
                    instance.last_error = "Resposta da API não é uma lista"
                    instance.last_check = datetime.now()
                    return False
                
                # Procurar nossa instância (comparação case-insensitive e com/sem espaços)
                found = False
                our_instance_name = instance.name.strip()
                our_instance_name_lower = our_instance_name.lower()
                state = None
                phone = None
                api_instance_name_found = None
                
                logger.debug(f"Procurando instância '{instance.name}' na lista de {len(instances_data)} instâncias")
                logger.debug(f"Nomes disponíveis na API: {[i.get('instanceName') or i.get('name') or 'N/A' for i in instances_data]}")
                
                for inst_data in instances_data:
                    # Tentar diferentes campos de nome
                    api_instance_name = (
                        inst_data.get('instanceName') or 
                        inst_data.get('name') or 
                        inst_data.get('instance') or
                        inst_data.get('instance_name')
                    )
                    
                    if api_instance_name:
                        api_name_normalized = api_instance_name.strip().lower()
                        
                        # Primeiro: comparação exata (case-insensitive)
                        # Segundo: verifica se um contém o outro (para casos como "Devocional" vs "Devocional-1")
                        # Terceiro: remove hífens e compara (para casos como "Devocional-1" vs "Devocional1")
                        exact_match = api_name_normalized == our_instance_name_lower
                        contains_match = (
                            api_name_normalized.startswith(our_instance_name_lower) or
                            our_instance_name_lower.startswith(api_name_normalized)
                        )
                        # Remover hífens e espaços para comparação mais flexível
                        api_name_no_dash = api_name_normalized.replace('-', '').replace('_', '').replace(' ', '')
                        our_name_no_dash = our_instance_name_lower.replace('-', '').replace('_', '').replace(' ', '')
                        no_dash_match = api_name_no_dash == our_name_no_dash
                        
                        if exact_match or (contains_match and len(api_name_normalized) >= len(our_instance_name_lower) - 2) or no_dash_match:
                            found = True
                            state = inst_data.get('state', 'unknown')
                            api_instance_name_found = api_instance_name
                            
                            # Salvar o nome real da instância na API (importante para chamadas)
                            instance.api_instance_name = api_instance_name
                            
                            # Tentar obter número da instância de múltiplos campos
                            phone = (
                                inst_data.get('phoneNumber') or 
                                inst_data.get('phone') or 
                                inst_data.get('number') or
                                inst_data.get('phone_number') or
                                inst_data.get('jid')  # JID pode conter o número
                            )
                            
                            # Se phone é um JID, extrair o número
                            if phone and '@' in str(phone):
                                phone = str(phone).split('@')[0]
                            
                            if phone:
                                phone_str = str(phone).strip()
                                if phone_str and not instance.phone_number:
                                    instance.phone_number = phone_str
                                    logger.info(f"Número da instância {instance.name} obtido: {phone_str}")
                                elif phone_str and instance.phone_number != phone_str:
                                    # Atualizar se mudou
                                    instance.phone_number = phone_str
                                    logger.debug(f"Número da instância {instance.name} atualizado: {phone_str}")
                            
                            match_type = "exata" if exact_match else ("sem hífen" if no_dash_match else "parcial")
                            logger.info(f"✅ Instância '{instance.name}' encontrada na API como '{api_instance_name}' (match: {match_type}, estado: {state}, telefone: {phone or 'não informado'})")
                            break  # Encontrou, pode sair do loop
                
                # Se encontrou a instância, processar o estado
                if found and state is not None:
                    # Normalizar estado para lowercase para comparação
                    state_lower = str(state).lower().strip()
                    
                    # Aceitar vários estados como válidos
                    # "open" é o estado padrão quando conectado na Evolution API
                    if state_lower in ['open', 'connected', 'ready', 'close']:
                        instance.status = InstanceStatus.ACTIVE
                        instance.error_count = 0
                        instance.last_check = now_brazil()
                        logger.info(f"✅ Instância {instance.name} marcada como ACTIVE (estado: {state})")
                        return True
                    elif state.lower() == 'unknown' or state == 'UNKNOWN':
                        # Estado "unknown" - tentar verificar status real de várias formas
                        logger.info(f"Instância {instance.name} retornou estado 'unknown', verificando status real...")
                        
                        # Método 1: Tentar buscar status mais detalhado via connectionState
                        logger.debug(f"[{instance.name}] Método 1: Tentando connectionState...")
                        try:
                            api_name = getattr(instance, 'api_instance_name', None) or instance.name
                            status_urls = [
                                f"{instance.api_url}/instance/connectionState/{api_name}",
                                f"{instance.api_url}/instance/{api_name}/connectionState",
                                f"{instance.api_url}/instance/connectionState",
                            ]
                            
                            for status_url in status_urls:
                                try:
                                    status_response = requests.get(status_url, headers=headers, timeout=5)
                                    if status_response.status_code == 200:
                                        status_data = status_response.json()
                                        connection_state = status_data.get('state', 'unknown')
                                        logger.debug(f"[{instance.name}] connectionState retornou: {connection_state}")
                                        
                                        if connection_state.lower() in ['open', 'connected', 'ready']:
                                            instance.status = InstanceStatus.ACTIVE
                                            instance.error_count = 0
                                            instance.last_check = now_brazil()
                                            logger.info(f"✅ Instância {instance.name} verificada via connectionState: {connection_state} - marcada como ACTIVE")
                                            return True
                                        elif connection_state.lower() != 'unknown':
                                            logger.debug(f"[{instance.name}] connectionState retornou: {connection_state}")
                                except Exception as e:
                                    logger.debug(f"[{instance.name}] Erro ao verificar {status_url}: {e}")
                                    continue
                        except Exception as e:
                            logger.debug(f"[{instance.name}] Erro ao verificar connectionState: {e}")
                        
                        # Método 2: Tentar verificar via fetchInstance específica
                        logger.debug(f"[{instance.name}] Método 2: Tentando fetchInstance...")
                        try:
                            api_name = getattr(instance, 'api_instance_name', None) or instance.name
                            fetch_url = f"{instance.api_url}/instance/fetchInstance/{api_name}"
                            logger.debug(f"[{instance.name}] Buscando {fetch_url}...")
                            fetch_response = requests.get(fetch_url, headers=headers, timeout=10)
                            
                            if fetch_response.status_code == 200:
                                fetch_data = fetch_response.json()
                                logger.debug(f"[{instance.name}] fetchInstance retornou: {fetch_data}")
                                # Pode retornar objeto único ou lista
                                if isinstance(fetch_data, list) and len(fetch_data) > 0:
                                    fetch_data = fetch_data[0]
                                
                                fetch_state = fetch_data.get('state', 'unknown')
                                logger.debug(f"[{instance.name}] Estado via fetchInstance: {fetch_state}")
                                
                                if fetch_state.lower() in ['open', 'connected', 'ready']:
                                    instance.status = InstanceStatus.ACTIVE
                                    instance.error_count = 0
                                    instance.last_check = now_brazil()
                                    logger.info(f"✅ Instância {instance.name} verificada via fetchInstance: {fetch_state} - marcada como ACTIVE")
                                    return True
                                
                                # Verificar se tem QR code (se não tem, provavelmente está conectada)
                                has_qrcode = bool(fetch_data.get('qrcode'))
                                logger.debug(f"[{instance.name}] Tem QR code: {has_qrcode}")
                                
                                if not has_qrcode and fetch_state.lower() == 'unknown':
                                    # Sem QR code e estado unknown = provavelmente conectada
                                    instance.status = InstanceStatus.ACTIVE
                                    instance.error_count = 0
                                    instance.last_check = now_brazil()
                                    logger.info(f"✅ Instância {instance.name} marcada como ACTIVE (sem QR code via fetchInstance = conectada)")
                                    return True
                        except Exception as e:
                            logger.warning(f"[{instance.name}] Erro ao verificar fetchInstance: {e}")
                        
                        # Método 3: Verificar se houve envios recentes (últimas 24h)
                        if instance.messages_sent_today > 0 or (instance.last_message_time and 
                            (datetime.now() - instance.last_message_time).total_seconds() < 86400):
                            instance.status = InstanceStatus.ACTIVE
                            instance.error_count = 0
                            instance.last_check = now_brazil()
                            logger.info(f"✅ Instância {instance.name} com estado unknown mas funcionou recentemente (envios hoje: {instance.messages_sent_today}) - marcada como ACTIVE")
                            return True
                        
                        # Método 4: Se a instância tem número de telefone, provavelmente está conectada
                        if instance.phone_number:
                            logger.info(f"Instância {instance.name} tem número de telefone ({instance.phone_number}), provavelmente está conectada")
                            instance.status = InstanceStatus.ACTIVE
                            instance.error_count = 0
                            instance.last_check = now_brazil()
                            logger.info(f"✅ Instância {instance.name} marcada como ACTIVE (tem número de telefone, provavelmente conectada)")
                            return True
                        
                        # Método 5: Verificação final - se existe na API e não tem QR code, está conectada
                        logger.debug(f"[{instance.name}] Método 5: Verificação final (sem QR code = conectada)...")
                        try:
                            # Se chegou até aqui, a instância existe na Evolution API
                            # Instâncias desconectadas sempre têm QR code
                            # Se não tem QR code e existe na API, provavelmente está conectada
                            api_name = getattr(instance, 'api_instance_name', None) or instance.name
                            fetch_url = f"{instance.api_url}/instance/fetchInstance/{api_name}"
                            logger.debug(f"[{instance.name}] Verificando QR code em {fetch_url}...")
                            
                            fetch_response = requests.get(fetch_url, headers=headers, timeout=10)
                            
                            if fetch_response.status_code == 200:
                                fetch_data = fetch_response.json()
                                if isinstance(fetch_data, list) and len(fetch_data) > 0:
                                    fetch_data = fetch_data[0]
                                
                                has_qrcode = bool(fetch_data.get('qrcode'))
                                logger.info(f"[{instance.name}] Instância existe na API. Tem QR code: {has_qrcode}")
                                
                                if not has_qrcode:
                                    # Sem QR code = conectada (instâncias desconectadas sempre têm QR code)
                                    instance.status = InstanceStatus.ACTIVE
                                    instance.error_count = 0
                                    instance.last_check = now_brazil()
                                    logger.info(f"✅ Instância {instance.name} marcada como ACTIVE (existe na API e não tem QR code = conectada)")
                                    return True
                                else:
                                    logger.debug(f"[{instance.name}] Tem QR code, provavelmente desconectada")
                        except Exception as e:
                            logger.warning(f"[{instance.name}] Erro na verificação final: {e}")
                        
                        # Se nenhum método funcionou, marcar como INACTIVE mas permitir uso
                        instance.status = InstanceStatus.INACTIVE
                        instance.last_check = now_brazil()
                        logger.warning(f"⚠️ Instância {instance.name} está {state} e não foi possível verificar status real. Marcada como INACTIVE (mas tentará usar se necessário)")
                        return False
                    else:
                        instance.status = InstanceStatus.INACTIVE
                        instance.last_check = now_brazil()
                        logger.warning(f"Instância {instance.name} está {state}, marcada como INACTIVE")
                        return False
                
                # Instância não encontrada
                if not found:
                    logger.warning(f"Instância {instance.name} não encontrada na lista. Instâncias disponíveis: {[i.get('instanceName') or i.get('name') for i in instances_data]}")
                    instance.status = InstanceStatus.ERROR
                    instance.last_error = f"Instância não encontrada. Disponíveis: {[i.get('instanceName') or i.get('name') for i in instances_data]}"
                    instance.last_check = datetime.now()
                    return False
            
            else:
                instance.status = InstanceStatus.ERROR
                instance.last_error = f"HTTP {response.status_code}: {response.text[:200]}"
                instance.error_count += 1
                instance.last_check = datetime.now()
                logger.error(f"Erro HTTP ao verificar {instance.name}: {response.status_code} - {response.text[:200]}")
                return False
        
        except requests.exceptions.RequestException as e:
            instance.status = InstanceStatus.ERROR
            instance.last_error = f"Erro de conexão: {str(e)}"
            instance.error_count += 1
            instance.last_check = datetime.now()
            logger.error(f"Erro de conexão ao verificar saúde da instância {instance.name}: {e}")
            return False
        except Exception as e:
            instance.status = InstanceStatus.ERROR
            instance.last_error = str(e)
            instance.error_count += 1
            instance.last_check = datetime.now()
            logger.error(f"Erro inesperado ao verificar saúde da instância {instance.name}: {e}", exc_info=True)
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
            instance.last_message_time = now_brazil()
            instance.error_count = 0
        else:
            instance.error_count += 1
            if instance.error_count >= 5:
                instance.status = InstanceStatus.ERROR
                logger.warning(f"Instância {instance.name} com muitos erros, marcando como ERROR")
    
    def reset_daily_counters(self):
        """Reseta contadores diários de todas as instâncias"""
        now = now_brazil()
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
        now = now_brazil()
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
            
            payload = {
                "name": name
            }
            
            if status:
                payload["status"] = status
            
            # Tentar diferentes endpoints da Evolution API
            endpoints_to_try = [
                f"{instance.api_url}/profile/updateProfileName/{instance.name}",
                f"{instance.api_url}/instance/{instance.name}/profile/updateProfileName",
                f"{instance.api_url}/profile/updateProfileName",
            ]
            
            for url in endpoints_to_try:
                try:
                    # Para o último endpoint, adicionar instance no payload
                    if url.endswith("/profile/updateProfileName") and not url.endswith(f"/{instance.name}"):
                        payload_with_instance = {**payload, "instance": instance.name}
                    else:
                        payload_with_instance = payload
                    
                    response = requests.put(url, json=payload_with_instance, headers=headers, timeout=10)
                    
                    if response.status_code in [200, 201]:
                        instance.display_name = name
                        instance.profile_configured = True
                        instance.last_profile_config_attempt = datetime.now()
                        logger.info(f"Perfil da instância {instance.name} atualizado para: {name} (endpoint: {url})")
                        return True
                    elif response.status_code == 404:
                        # Tentar próximo endpoint
                        logger.debug(f"Endpoint {url} retornou 404, tentando próximo...")
                        continue
                    else:
                        # Outro erro, logar mas continuar tentando
                        logger.debug(f"Endpoint {url} retornou {response.status_code}: {response.text}")
                        continue
                except requests.exceptions.RequestException as e:
                    logger.debug(f"Erro ao tentar endpoint {url}: {e}")
                    continue
            
            # Se nenhum endpoint funcionou, tentar POST como alternativa
            logger.info(f"Tentando método POST como alternativa...")
            url = f"{instance.api_url}/profile/updateProfileName/{instance.name}"
            response = requests.post(url, json=payload, headers=headers, timeout=10)
            
            if response.status_code in [200, 201]:
                instance.display_name = name
                instance.profile_configured = True
                instance.last_profile_config_attempt = datetime.now()
                logger.info(f"Perfil da instância {instance.name} atualizado para: {name} (método POST)")
                return True
            
            # Se ainda não funcionou, logar erro
            logger.warning(f"Nenhum endpoint funcionou para atualizar perfil. Última resposta: {response.status_code} - {response.text}")
            logger.warning(f"NOTA: O nome do perfil precisa ser configurado manualmente no Evolution API Manager ou via WhatsApp")
            instance.profile_configured = False
            return False
        
        except Exception as e:
            logger.error(f"Erro ao atualizar perfil da instância {instance.name}: {e}")
            logger.warning(f"NOTA: O nome do perfil pode precisar ser configurado manualmente no Evolution API Manager")
            instance.profile_configured = False
            return False

