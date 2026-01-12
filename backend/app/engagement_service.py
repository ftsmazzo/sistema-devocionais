"""
Serviço para gerenciar engajamento com sistema de pontos (0-100)
Sistema de pontos com descontos e bônus
"""
import logging
from typing import Optional
from sqlalchemy.orm import Session
from app.database import ContactEngagement, EngagementHistory
from app.timezone_utils import now_brazil_naive

logger = logging.getLogger(__name__)

# Configurações de pontos
INITIAL_SCORE = 100.0  # Pontos iniciais
MAX_SCORE = 100.0
MIN_SCORE = 0.0

# Bônus
BONUS_MESSAGE_READ = +5.0  # +5 pontos por mensagem lida
BONUS_MESSAGE_DELIVERED = +1.0  # +1 ponto por mensagem entregue
BONUS_RESPONSE = +10.0  # +10 pontos por resposta

# Descontos (penalidades)
PENALTY_NOT_DELIVERED = -3.0  # -3 pontos se não entregue
PENALTY_NOT_READ = -2.0  # -2 pontos se não lida
PENALTY_CONSECUTIVE_NOT_READ = -1.0  # -1 ponto adicional por cada mensagem consecutiva não lida
PENALTY_CONSECUTIVE_NOT_DELIVERED = -2.0  # -2 pontos adicionais por cada mensagem consecutiva não entregue


def get_or_create_engagement(db: Session, phone: str) -> ContactEngagement:
    """Busca ou cria registro de engajamento"""
    engagement = db.query(ContactEngagement).filter(
        ContactEngagement.phone == phone
    ).first()
    
    if not engagement:
        engagement = ContactEngagement(
            phone=phone,
            engagement_score=INITIAL_SCORE,  # Começa com 100 pontos
            total_sent=0,
            total_responded=0,
            total_read=0,
            total_delivered=0,
            consecutive_no_response=0,
            consecutive_not_read=0,
            consecutive_not_delivered=0
        )
        db.add(engagement)
        db.flush()
        logger.info(f"✅ Criado registro de engajamento para {phone} com {INITIAL_SCORE} pontos iniciais")
    
    # Garantir que valores não sejam None
    if engagement.engagement_score is None:
        engagement.engagement_score = INITIAL_SCORE
    if engagement.total_sent is None:
        engagement.total_sent = 0
    if engagement.total_responded is None:
        engagement.total_responded = 0
    if engagement.total_read is None:
        engagement.total_read = 0
    if engagement.total_delivered is None:
        engagement.total_delivered = 0
    if engagement.consecutive_no_response is None:
        engagement.consecutive_no_response = 0
    if engagement.consecutive_not_read is None:
        engagement.consecutive_not_read = 0
    if engagement.consecutive_not_delivered is None:
        engagement.consecutive_not_delivered = 0
    
    return engagement


def update_engagement_points(
    db: Session,
    phone: str,
    action_type: str,
    points_change: float,
    reason: Optional[str] = None,
    message_id: Optional[str] = None
) -> float:
    """
    Atualiza pontos de engajamento e registra no histórico
    
    Args:
        db: Sessão do banco
        phone: Telefone do contato
        action_type: Tipo de ação (message_sent, message_delivered, message_read, penalty, bonus)
        points_change: Mudança de pontos (+ ou -)
        reason: Motivo da mudança
        message_id: ID da mensagem relacionada
        
    Returns:
        Novo score após atualização
    """
    try:
        engagement = get_or_create_engagement(db, phone)
        
        points_before = float(engagement.engagement_score)
        points_after = max(MIN_SCORE, min(MAX_SCORE, points_before + points_change))
        
        engagement.engagement_score = points_after
        engagement.updated_at = now_brazil_naive()
        
        # Registrar no histórico
        history = EngagementHistory(
            phone=phone,
            action_type=action_type,
            points_change=points_change,
            points_before=points_before,
            points_after=points_after,
            message_id=message_id,
            reason=reason
        )
        db.add(history)
        
        db.commit()
        
        logger.info(f"📊 Engajamento {phone}: {points_before:.1f} → {points_after:.1f} ({points_change:+.1f}) - {action_type}")
        
        return points_after
        
    except Exception as e:
        logger.error(f"❌ Erro ao atualizar pontos de engajamento: {e}", exc_info=True)
        db.rollback()
        return engagement.engagement_score if 'engagement' in locals() else INITIAL_SCORE


def handle_message_delivered(db: Session, phone: str, message_id: Optional[str] = None):
    """Mensagem entregue: +1 ponto"""
    engagement = get_or_create_engagement(db, phone)
    
    engagement.total_delivered += 1
    engagement.last_delivered_date = now_brazil_naive()
    engagement.consecutive_not_delivered = 0
    
    # Bônus por entrega
    update_engagement_points(
        db, phone, "message_delivered", BONUS_MESSAGE_DELIVERED,
        reason="Mensagem entregue com sucesso", message_id=message_id
    )


def handle_message_not_delivered(db: Session, phone: str, message_id: Optional[str] = None):
    """Mensagem não entregue: -3 pontos + penalidade consecutiva"""
    engagement = get_or_create_engagement(db, phone)
    
    engagement.consecutive_not_delivered += 1
    
    # Penalidade base
    penalty = PENALTY_NOT_DELIVERED
    
    # Penalidade adicional por mensagens consecutivas não entregues
    if engagement.consecutive_not_delivered > 1:
        penalty += PENALTY_CONSECUTIVE_NOT_DELIVERED * (engagement.consecutive_not_delivered - 1)
    
    update_engagement_points(
        db, phone, "penalty", penalty,
        reason=f"Mensagem não entregue (consecutivas: {engagement.consecutive_not_delivered})",
        message_id=message_id
    )


def handle_message_read(db: Session, phone: str, message_id: Optional[str] = None):
    """Mensagem lida: +5 pontos"""
    engagement = get_or_create_engagement(db, phone)
    
    engagement.total_read += 1
    engagement.last_read_date = now_brazil_naive()
    engagement.consecutive_not_read = 0
    
    # Bônus por leitura
    update_engagement_points(
        db, phone, "message_read", BONUS_MESSAGE_READ,
        reason="Mensagem lida pelo contato", message_id=message_id
    )


def handle_message_not_read(db: Session, phone: str, message_id: Optional[str] = None):
    """Mensagem não lida: -2 pontos + penalidade consecutiva"""
    engagement = get_or_create_engagement(db, phone)
    
    engagement.consecutive_not_read += 1
    
    # Penalidade base
    penalty = PENALTY_NOT_READ
    
    # Penalidade adicional por mensagens consecutivas não lidas
    if engagement.consecutive_not_read > 1:
        penalty += PENALTY_CONSECUTIVE_NOT_READ * (engagement.consecutive_not_read - 1)
    
    update_engagement_points(
        db, phone, "penalty", penalty,
        reason=f"Mensagem não lida (consecutivas: {engagement.consecutive_not_read})",
        message_id=message_id
    )


def handle_message_sent(db: Session, phone: str, message_id: Optional[str] = None):
    """Mensagem enviada: apenas incrementa contador"""
    engagement = get_or_create_engagement(db, phone)
    engagement.total_sent += 1
    engagement.last_sent_date = now_brazil_naive()
    db.commit()
