"""
Scheduler para envio automático de devocionais
"""
import logging
import schedule
import time
import threading
from datetime import datetime, time as dt_time, timedelta
from zoneinfo import ZoneInfo
from typing import Optional
from app.config import settings
from app.devocional_service_v2 import DevocionalServiceV2
from app.database import SessionLocal, DevocionalContato, Devocional
from app.devocional_service_v2 import MessageResult
from app.devocional_integration import devocional_integration

logger = logging.getLogger(__name__)

devocional_service = DevocionalServiceV2()
scheduler_thread = None
scheduler_running = False


def get_devocional_message() -> Optional[str]:
    """
    Obtém a mensagem do devocional do dia
    Tenta buscar da API externa ou do banco de dados
    """
    # Se configurado para buscar da API
    if settings.DEVOCIONAL_FETCH_MODE == "api":
        message = devocional_integration.fetch_and_save()
        if message:
            return message
    
    # Caso contrário, busca do banco de dados
    # (devocional pode ter sido recebido via webhook)
    return devocional_integration.get_today_devocional()


def send_daily_devocional():
    """
    Função que envia o devocional diário para todos os contatos ativos
    """
    logger.info("Iniciando envio automático de devocional diário...")
    
    try:
        # Obter mensagem do devocional
        message = get_devocional_message()
        
        if not message:
            logger.warning("Nenhuma mensagem de devocional disponível. Pulando envio.")
            return
        
        # Obter contatos ativos do banco
        db = SessionLocal()
        try:
            contacts = db.query(DevocionalContato).filter(
                DevocionalContato.active == True
            ).all()
            
            if not contacts:
                logger.warning("Nenhum contato ativo encontrado.")
                return
            
            # Converter para formato esperado
            contacts_list = [
                {"phone": c.phone, "name": c.name}
                for c in contacts
            ]
            
            logger.info(f"Enviando devocional para {len(contacts_list)} contatos...")
            
            # Enviar mensagens
            results = devocional_service.send_bulk_devocionais(
                contacts=contacts_list,
                message=message,
                delay=None  # Usa delay padrão
            )
            
            # Registrar resultados
            sent = sum(1 for r in results if r.success)
            failed = sum(1 for r in results if not r.success)
            
            logger.info(f"Envio automático concluído: {sent} enviadas, {failed} falharam")
            
            # Atualizar contatos no banco
            for i, result in enumerate(results):
                if i < len(contacts):
                    contact = contacts[i]
                    if result.success:
                        contact.last_sent = result.timestamp
                        contact.total_sent += 1
            
            db.commit()
        
        finally:
            db.close()
    
    except Exception as e:
        logger.error(f"Erro no envio automático de devocional: {e}", exc_info=True)


def run_scheduler():
    """
    Executa o scheduler em thread separada
    Usa horário de São Paulo (Brasil) para agendamento
    """
    global scheduler_running
    
    scheduler_running = True
    
    # Parse do horário de envio (horário de São Paulo)
    try:
        send_time_str = settings.DEVOCIONAL_SEND_TIME
        hour, minute = map(int, send_time_str.split(':'))
    except Exception as e:
        logger.error(f"Erro ao parsear horário de envio: {e}. Usando 06:00 como padrão.")
        hour, minute = 6, 0
    
    sao_paulo_tz = ZoneInfo("America/Sao_Paulo")
    utc_tz = ZoneInfo("UTC")
    
    logger.info(f"Scheduler de devocionais iniciado. Envio agendado para {hour:02d}:{minute:02d} (horário de São Paulo)")
    
    # Loop do scheduler - verifica a cada minuto
    while scheduler_running:
        # Verificar se é hora de enviar (usando horário de São Paulo)
        now_sp = datetime.now(sao_paulo_tz)
        current_hour = now_sp.hour
        current_minute = now_sp.minute
        
        # Se chegou no horário agendado (verifica a cada minuto)
        if current_hour == hour and current_minute == minute:
            # Verificar se já enviou hoje (evitar múltiplos envios)
            last_sent = getattr(run_scheduler, 'last_sent_date', None)
            today = now_sp.date()
            
            if last_sent != today:
                logger.info(f"Horário de envio atingido ({hour:02d}:{minute:02d} SP). Iniciando envio...")
                send_daily_devocional()
                run_scheduler.last_sent_date = today
        
        schedule.run_pending()
        time.sleep(60)  # Verifica a cada minuto
    
    logger.info("Scheduler de devocionais parado")


def start_scheduler():
    """
    Inicia o scheduler em thread separada
    """
    global scheduler_thread, scheduler_running
    
    if scheduler_running:
        logger.warning("Scheduler já está rodando")
        return
    
    scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()
    logger.info("Scheduler de devocionais iniciado")


def stop_scheduler():
    """
    Para o scheduler
    """
    global scheduler_running
    
    scheduler_running = False
    schedule.clear()
    logger.info("Scheduler de devocionais parado")

