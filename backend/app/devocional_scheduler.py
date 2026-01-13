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
from app.database import SessionLocal, DevocionalContato, Devocional, DevocionalEnvio, AgendamentoEnvio, SystemConfig
from app.timezone_utils import now_brazil, today_brazil_naive
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
    from app.timezone_utils import now_brazil_naive
    
    logger.info("Iniciando envio automático de devocional diário...")
    
    try:
        # Obter mensagem e objeto do devocional
        message = get_devocional_message()
        
        if not message:
            logger.warning("Nenhuma mensagem de devocional disponível. Pulando envio.")
            return
        
        # Obter objeto devocional para pegar o ID
        db = SessionLocal()
        try:
            devocional_obj = devocional_integration.get_today_devocional_obj()
            devocional_id = devocional_obj.id if devocional_obj else None
            
            contacts = db.query(DevocionalContato).filter(
                DevocionalContato.active == True
            ).all()
            
            if not contacts:
                logger.warning("Nenhum contato ativo encontrado.")
                return
            
            # Converter para formato esperado (incluindo ID para distribuição)
            contacts_list = [
                {"id": c.id, "phone": c.phone, "name": c.name}
                for c in contacts
            ]
            
            logger.info(f"Enviando devocional para {len(contacts_list)} contatos...")
            
            # Criar registro de agendamento antes de enviar
            # O modelo AgendamentoEnvio só armazena informações básicas do agendamento
            scheduled_time = now_brazil_naive()
            
            # Tentar criar agendamento - se falhar por falta de coluna, tentar criar a coluna
            try:
                agendamento = AgendamentoEnvio(
                    devocional_id=devocional_id,
                    scheduled_for=scheduled_time,
                    sent=False  # Será marcado como True após envio bem-sucedido
                )
                db.add(agendamento)
                db.commit()
                logger.info(f"✅ Agendamento criado no banco de dados (devocional_id={devocional_id}, scheduled_for={scheduled_time})")
            except Exception as e:
                error_str = str(e)
                # Se o erro for por coluna 'sent' não existir, tentar criar
                if "column \"sent\" of relation \"agendamento_envios\" does not exist" in error_str:
                    logger.warning(f"⚠️ Coluna 'sent' não existe na tabela agendamento_envios. Tentando criar...")
                    try:
                        # Tentar criar a coluna via SQL direto
                        db.execute("ALTER TABLE agendamento_envios ADD COLUMN IF NOT EXISTS sent BOOLEAN DEFAULT FALSE")
                        db.execute("CREATE INDEX IF NOT EXISTS idx_agendamento_envios_sent ON agendamento_envios(sent)")
                        db.commit()
                        logger.info(f"✅ Coluna 'sent' criada com sucesso. Tentando criar agendamento novamente...")
                        
                        # Tentar novamente
                        agendamento = AgendamentoEnvio(
                            devocional_id=devocional_id,
                            scheduled_for=scheduled_time,
                            sent=False
                        )
                        db.add(agendamento)
                        db.commit()
                        logger.info(f"✅ Agendamento criado no banco de dados (devocional_id={devocional_id}, scheduled_for={scheduled_time})")
                    except Exception as create_error:
                        logger.error(f"❌ Erro ao criar coluna 'sent': {create_error}", exc_info=True)
                        db.rollback()
                        # Continuar mesmo sem agendamento (não bloquear envio)
                        agendamento = None
                        logger.warning(f"⚠️ Continuando envio sem registro de agendamento")
                else:
                    logger.error(f"Erro ao salvar agendamento: {e}", exc_info=True)
                    db.rollback()
                    # Continuar mesmo sem agendamento (não bloquear envio)
                    agendamento = None
                    logger.warning(f"⚠️ Continuando envio sem registro de agendamento")
            
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
            
            # Atualizar agendamento após envio
            # O modelo AgendamentoEnvio só tem campos básicos: devocional_id, scheduled_for, sent, sent_at
            if agendamento and sent > 0:  # Se pelo menos uma mensagem foi enviada com sucesso e agendamento existe
                try:
                    agendamento.sent = True
                    agendamento.sent_at = now_brazil_naive()
                    db.commit()
                    logger.info(f"✅ Agendamento marcado como enviado (sent={sent}, failed={failed})")
                except Exception as e:
                    logger.warning(f"⚠️ Erro ao atualizar agendamento: {e}. Continuando...")
                    db.rollback()
            
            # Registrar envios no banco e atualizar contatos
            for i, result in enumerate(results):
                if i < len(contacts):
                    contact = contacts[i]
                    
                    # Registrar envio no banco
                    envio = DevocionalEnvio(
                        devocional_id=devocional_id,
                        recipient_phone=contact.phone,
                        recipient_name=contact.name,
                        message_text=message,
                        sent_at=result.timestamp.replace(tzinfo=None) if result.timestamp else now_brazil_naive(),
                        status=result.status.value,
                        message_id=result.message_id,
                        error_message=result.error,
                        retry_count=result.retry_count,
                        instance_name=result.instance_name
                        # message_type="devocional_agendado"  # Descomentar após executar migrate_add_message_type.sql
                    )
                    db.add(envio)
                    
                    # Atualizar contato
                    if result.success:
                        contact.last_sent = result.timestamp.replace(tzinfo=None) if result.timestamp else now_brazil_naive()
                        contact.total_sent += 1
            
            db.commit()
            logger.info(f"✅ Agendamentos e envios registrados no banco de dados")
        
        finally:
            db.close()
    
    except Exception as e:
        logger.error(f"Erro no envio automático de devocional: {e}", exc_info=True)


def get_send_time_from_db() -> tuple[int, int]:
    """
    Obtém horário de envio do banco de dados (dinâmico)
    Se não encontrar, usa o padrão do .env
    """
    db = SessionLocal()
    try:
        config = db.query(SystemConfig).filter(SystemConfig.key == "devocional_send_time").first()
        if config and config.value:
            try:
                hour, minute = map(int, config.value.split(':'))
                if 0 <= hour <= 23 and 0 <= minute <= 59:
                    return hour, minute
            except ValueError:
                pass
        
        # Se não encontrou no banco, usa padrão do .env
        try:
            send_time_str = settings.DEVOCIONAL_SEND_TIME
            hour, minute = map(int, send_time_str.split(':'))
            return hour, minute
        except:
            return 6, 0  # Padrão: 06:00
    finally:
        db.close()


def run_scheduler():
    """
    Executa o scheduler em thread separada
    Usa horário de São Paulo (Brasil) para agendamento
    Lê horário do banco de dados dinamicamente
    """
    global scheduler_running
    
    scheduler_running = True
    
    # Obter horário inicial
    hour, minute = get_send_time_from_db()
    last_config_check = now_brazil()
    
    logger.info(f"Scheduler de devocionais iniciado. Envio agendado para {hour:02d}:{minute:02d} (horário de São Paulo)")
    
    # Loop do scheduler - verifica a cada minuto
    while scheduler_running:
        try:
            # Verificar se é hora de enviar (usando horário de São Paulo)
            now_sp = now_brazil()
            current_hour = now_sp.hour
            current_minute = now_sp.minute
            
            # Verificar se a configuração mudou (a cada minuto para resposta mais rápida)
            if (now_sp - last_config_check).total_seconds() >= 60:
                new_hour, new_minute = get_send_time_from_db()
                if new_hour != hour or new_minute != minute:
                    old_time = f"{hour:02d}:{minute:02d}"
                    hour, minute = new_hour, new_minute
                    logger.info(f"⏰ Horário de envio atualizado dinamicamente: {old_time} -> {hour:02d}:{minute:02d}")
                    # Resetar last_sent_date se mudou o horário para permitir envio no novo horário
                    if hasattr(run_scheduler, 'last_sent_date'):
                        logger.info(f"🔄 Resetando controle de envio para permitir envio no novo horário")
                        run_scheduler.last_sent_date = None
                last_config_check = now_sp
            
            # Log de debug a cada hora para verificar funcionamento
            if current_minute == 0:
                logger.info(f"⏰ Scheduler rodando. Horário atual SP: {current_hour:02d}:{current_minute:02d}, Horário agendado: {hour:02d}:{minute:02d}")
            
            # Se chegou no horário agendado (verifica a cada minuto)
            if current_hour == hour and current_minute == minute:
                # Verificar se já enviou hoje (evitar múltiplos envios)
                last_sent = getattr(run_scheduler, 'last_sent_date', None)
                today = now_sp.date()
                
                logger.info(f"🔔 Verificando envio: Horário atual {current_hour:02d}:{current_minute:02d} == Agendado {hour:02d}:{minute:02d}, Último envio: {last_sent}, Hoje: {today}")
                
                if last_sent != today:
                    logger.info(f"⏰ Horário de envio atingido ({hour:02d}:{minute:02d} SP - {now_sp.strftime('%Y-%m-%d %H:%M:%S %Z')}). Iniciando envio...")
                    try:
                        send_daily_devocional()
                        run_scheduler.last_sent_date = today
                        logger.info(f"✅ Envio automático concluído. Próximo envio: amanhã às {hour:02d}:{minute:02d}")
                    except Exception as e:
                        logger.error(f"❌ Erro ao executar envio automático: {e}", exc_info=True)
                else:
                    logger.warning(f"⚠️ Horário de envio atingido mas já foi enviado hoje ({last_sent}). Pulando...")
        except Exception as e:
            logger.error(f"Erro no loop do scheduler: {e}", exc_info=True)
        
        # Sincronizar status de mensagens pendentes/entregues a cada 2 minutos (mais frequente)
        try:
            if not hasattr(run_scheduler, 'last_sync') or (now_brazil() - run_scheduler.last_sync).total_seconds() >= 120:
                from app.message_status_sync import MessageStatusSync
                db_sync = SessionLocal()
                try:
                    sync_service = MessageStatusSync(db_sync)
                    result = sync_service.sync_pending_messages(hours_back=24)
                    if result.get('messages_updated', 0) > 0:
                        logger.info(f"🔄 Sincronização automática: {result.get('messages_updated', 0)} mensagens atualizadas")
                    run_scheduler.last_sync = now_brazil()
                except Exception as sync_error:
                    logger.error(f"❌ Erro na sincronização automática: {sync_error}", exc_info=True)
                finally:
                    db_sync.close()
        except Exception as e:
            logger.debug(f"Erro ao sincronizar status (não crítico): {e}")
        
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

