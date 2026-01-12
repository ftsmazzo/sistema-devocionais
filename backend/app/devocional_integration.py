"""
Integração com automação externa (n8n, APIs, etc) para obter devocionais
"""
import logging
import requests
import json
from typing import Optional, Dict
from datetime import datetime, date
from app.config import settings
from app.database import SessionLocal, Devocional
from app.timezone_utils import now_brazil, today_brazil

logger = logging.getLogger(__name__)


class DevocionalIntegration:
    """
    Classe para integrar com fontes externas de devocionais
    """
    
    def __init__(self):
        self.api_url = settings.DEVOCIONAL_API_URL
        self.api_key = settings.DEVOCIONAL_API_KEY
        self.fetch_mode = settings.DEVOCIONAL_FETCH_MODE
    
    def fetch_from_api(self, date_filter: Optional[date] = None) -> Optional[Dict]:
        """
        Busca devocional de uma API externa
        
        Args:
            date_filter: Data específica para buscar (None = hoje)
        
        Returns:
            Dict com devocional ou None
        """
        if not self.api_url:
            logger.warning("DEVOCIONAL_API_URL não configurada")
            return None
        
        try:
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
                # Ou se usar header customizado:
                # headers["X-API-Key"] = self.api_key
            
            params = {}
            if date_filter:
                params["date"] = date_filter.isoformat()
            
            logger.info(f"Buscando devocional da API: {self.api_url}")
            
            response = requests.get(
                self.api_url,
                headers=headers,
                params=params,
                timeout=30
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Adaptar conforme formato da sua API
                # Exemplo de formatos possíveis:
                if isinstance(data, dict):
                    # Formato 1: { "text": "...", "title": "..." }
                    if "text" in data or "content" in data or "message" in data:
                        return {
                            "content": data.get("text") or data.get("content") or data.get("message"),
                            "title": data.get("title"),
                            "metadata": json.dumps(data.get("metadata", {}))
                        }
                    
                    # Formato 2: { "devocional": { "text": "..." } }
                    if "devocional" in data:
                        dev = data["devocional"]
                        return {
                            "content": dev.get("text") or dev.get("content"),
                            "title": dev.get("title"),
                            "metadata": json.dumps(dev.get("metadata", {}))
                        }
                
                # Se for string direta
                if isinstance(data, str):
                    return {"content": data}
                
                logger.warning(f"Formato de resposta não reconhecido: {data}")
                return None
            
            else:
                logger.error(f"Erro ao buscar devocional: HTTP {response.status_code}")
                return None
        
        except requests.exceptions.RequestException as e:
            logger.error(f"Erro de conexão ao buscar devocional: {e}")
            return None
        
        except Exception as e:
            logger.error(f"Erro inesperado ao buscar devocional: {e}", exc_info=True)
            return None
    
    def save_devocional(self, content: str, title: Optional[str] = None, source: str = "api", metadata: Optional[Dict] = None) -> Optional[Devocional]:
        """
        Salva devocional no banco de dados
        
        Args:
            content: Texto do devocional
            title: Título (opcional)
            source: Fonte (webhook, api, manual)
            metadata: Metadados adicionais
        
        Returns:
            Objeto Devocional salvo
        """
        db = SessionLocal()
        try:
            # Verificar se já existe devocional para hoje
            today = today_brazil().date()
            existing = db.query(Devocional).filter(
                Devocional.date >= datetime.combine(today, datetime.min.time()),
                Devocional.date < datetime.combine(today, datetime.max.time())
            ).first()
            
            if existing:
                # Atualizar existente
                existing.content = content
                if title:
                    existing.title = title
                existing.source = source
                if metadata:
                    existing.metadata_json = json.dumps(metadata)
                db.commit()
                db.refresh(existing)
                logger.info(f"Devocional atualizado (ID: {existing.id})")
                return existing
            else:
                # Criar novo
                devocional = Devocional(
                    content=content,
                    title=title,
                    date=now_brazil(),
                    source=source,
                    metadata_json=json.dumps(metadata) if metadata else None
                )
                db.add(devocional)
                db.commit()
                db.refresh(devocional)
                logger.info(f"Devocional salvo (ID: {devocional.id})")
                return devocional
        
        except Exception as e:
            logger.error(f"Erro ao salvar devocional: {e}", exc_info=True)
            db.rollback()
            return None
        
        finally:
            db.close()
    
    def get_today_devocional(self) -> Optional[str]:
        """
        Obtém o devocional de hoje do banco de dados
        
        Returns:
            Texto do devocional ou None
        """
        devocional = self.get_today_devocional_obj()
        if devocional:
            return devocional.content
        return None
    
    def get_today_devocional_obj(self) -> Optional[Devocional]:
        """
        Obtém o objeto devocional de hoje do banco de dados
        
        Returns:
            Objeto Devocional ou None
        """
        db = SessionLocal()
        try:
            from app.timezone_utils import today_brazil
            today = today_brazil().date()
            devocional = db.query(Devocional).filter(
                Devocional.date >= datetime.combine(today, datetime.min.time()),
                Devocional.date < datetime.combine(today, datetime.max.time())
            ).order_by(Devocional.created_at.desc()).first()
            
            return devocional
        
        except Exception as e:
            logger.error(f"Erro ao buscar devocional do banco: {e}", exc_info=True)
            return None
        
        finally:
            db.close()
    
    def fetch_and_save(self) -> Optional[str]:
        """
        Busca devocional da API externa e salva no banco
        
        Returns:
            Texto do devocional ou None
        """
        if self.fetch_mode == "api":
            data = self.fetch_from_api()
            
            if data:
                devocional = self.save_devocional(
                    content=data["content"],
                    title=data.get("title"),
                    source="api",
                    metadata=json.loads(data.get("metadata", "{}")) if data.get("metadata") else None
                )
                
                if devocional:
                    return devocional.content
        
        # Se não encontrou na API, tenta do banco
        return self.get_today_devocional()


# Instância global
devocional_integration = DevocionalIntegration()
