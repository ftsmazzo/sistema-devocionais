"""
Endpoints para gerar contexto histórico para criação de devocionais
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from app.database import get_db, Devocional
import json
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/devocional", tags=["devocional-context"])


@router.get("/context/historico")
async def get_historico_context(
    days: int = 30,  # Últimos N dias
    db: Session = Depends(get_db)
):
    """
    Retorna contexto histórico formatado para análise por IA
    
    Usado para gerar direcionamento para o próximo devocional
    """
    try:
        # Calcular data limite
        date_limit = datetime.now() - timedelta(days=days)
        
        # Buscar devocionais recentes (incluindo os não enviados para contexto)
        devocionais = db.query(Devocional).filter(
            Devocional.date >= date_limit.date()
        ).order_by(Devocional.date.desc()).all()
        
        if not devocionais:
            return {
                "historico_vazio": True,
                "mensagem": "Nenhum devocional encontrado no período",
                "sugestao": "Pode criar o primeiro devocional da série"
            }
        
        # Extrair informações estruturadas
        temas = []
        versiculos = []
        palavras_chave = []
        titulos = []
        
        for d in devocionais:
            if d.tema:
                temas.append(d.tema)
            if d.versiculo_principal_referencia:
                versiculos.append(d.versiculo_principal_referencia)
            if d.versiculo_apoio_referencia:
                versiculos.append(d.versiculo_apoio_referencia)
            if d.palavras_chave:
                try:
                    # Se for array PostgreSQL, já vem como lista
                    if isinstance(d.palavras_chave, list):
                        palavras_chave.extend(d.palavras_chave)
                    # Se for string JSON, fazer parse
                    elif isinstance(d.palavras_chave, str):
                        palavras = json.loads(d.palavras_chave)
                        if isinstance(palavras, list):
                            palavras_chave.extend(palavras)
                except Exception as e:
                    logger.debug(f"Erro ao processar palavras_chave: {e}")
                    pass
            if d.title:
                titulos.append(d.title)
        
        # Remover duplicatas
        temas = list(set(temas))
        versiculos = list(set(versiculos))
        palavras_chave = list(set(palavras_chave))
        
        # Criar resumo textual
        resumo_tematico = _criar_resumo_tematico(devocionais)
        
        return {
            "periodo": {
                "dias": days,
                "data_inicio": date_limit.date().isoformat(),
                "total_devocionais": len(devocionais)
            },
            "temas_abordados": temas,
            "versiculos_usados": sorted(versiculos),
            "palavras_chave": palavras_chave[:20],  # Top 20
            "titulos_recentes": titulos[:10],  # Últimos 10 títulos
            "resumo_tematico": resumo_tematico,
            "ultimo_devocional": {
                "data": devocionais[0].date.isoformat() if devocionais else None,
                "titulo": devocionais[0].title if devocionais else None,
                "tema": devocionais[0].tema if devocionais else None
            }
        }
    
    except Exception as e:
        logger.error(f"Erro ao gerar contexto histórico: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@router.get("/context/para-ia")
async def get_context_for_ai(
    days: int = 30,
    db: Session = Depends(get_db)
):
    """
    Retorna contexto formatado especificamente para análise por IA
    
    Formato otimizado para o prompt de análise
    """
    try:
        historico = await get_historico_context(days=days, db=db)
        
        if historico.get("historico_vazio"):
            return {
                "contexto_historico": "Esta é a primeira mensagem da série. O tema central é 'Expressar Jesus Cristo' em nossa vida diária.",
                "versiculos_usados": [],
                "temas_abordados": [],
                "palavras_chave": [],
                "titulos_recentes": [],
                "direcionamento_sugerido": "Inicie a jornada apresentando o conceito de 'Expressar' e como isso se relaciona com nossa caminhada diária com Cristo.",
                "conceito_central": "Expressar Jesus em nosso dia a dia"
            }
        
        # Formatar para o prompt de análise
        contexto_texto = f"""
Nos últimos {historico['periodo']['dias']} dias, foram criados {historico['periodo']['total_devocionais']} devocionais.

Temas principais abordados: {', '.join(historico['temas_abordados'][:10])}

Versículos já utilizados: {len(historico['versiculos_usados'])} referências bíblicas.

{historico['resumo_tematico']}

Último devocional: {historico['ultimo_devocional']['titulo']} ({historico['ultimo_devocional']['data']})
"""
        
        return {
            "contexto_historico": contexto_texto.strip(),
            "versiculos_usados": historico["versiculos_usados"],
            "temas_abordados": historico["temas_abordados"],
            "palavras_chave": historico["palavras_chave"],
            "titulos_recentes": historico["titulos_recentes"],
            "direcionamento_sugerido": _sugerir_direcionamento(historico),
            "conceito_central": _sugerir_conceito(historico)
        }
    
    except Exception as e:
        logger.error(f"Erro ao gerar contexto para IA: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


def _criar_resumo_tematico(devocionais: List[Devocional]) -> str:
    """Cria um resumo textual da progressão temática"""
    if not devocionais:
        return ""
    
    # Agrupar por tema
    temas_contagem = {}
    for d in devocionais:
        if d.tema:
            temas_contagem[d.tema] = temas_contagem.get(d.tema, 0) + 1
    
    # Criar resumo
    resumo = "A jornada espiritual tem trabalhado principalmente os seguintes conceitos relacionados a 'Expressar': "
    
    temas_principais = sorted(temas_contagem.items(), key=lambda x: x[1], reverse=True)[:5]
    resumo += ", ".join([f"{tema} ({count}x)" for tema, count in temas_principais])
    
    resumo += ". A progressão tem focado em como nossos passos, corações e caminhos se alinham com Cristo, permitindo-nos expressar Sua natureza em nosso cotidiano."
    
    return resumo


def _sugerir_direcionamento(historico: Dict) -> str:
    """Sugere direcionamento baseado no histórico"""
    temas = historico.get("temas_abordados", [])
    ultimo_tema = historico.get("ultimo_devocional", {}).get("tema")
    
    # Conceitos relacionados a "Expressar" que podem ser trabalhados
    conceitos_expressar = [
        "Expressar através de ações",
        "Expressar através de palavras",
        "Expressar através do serviço",
        "Expressar através da adoração",
        "Expressar através do amor",
        "Expressar através da sabedoria",
        "Expressar através da unidade",
        "Expressar através da verdade",
        "Expressar através da graça",
        "Expressar através da paz"
    ]
    
    # Se não há histórico suficiente, sugerir início
    if len(temas) < 3:
        return "Inicie ou continue a jornada apresentando como podemos expressar Jesus em nosso dia a dia, focando em aspectos práticos e transformadores."
    
    # Sugerir progressão
    return f"Avance na jornada trabalhando um novo aspecto de 'Expressar', considerando que já foram abordados: {', '.join(temas[:3])}. Explore uma dimensão prática e aplicável do conceito."


def _sugerir_conceito(historico: Dict) -> str:
    """Sugere conceito central baseado no histórico"""
    ultimo_tema = historico.get("ultimo_devocional", {}).get("tema")
    
    # Conceitos que podem ser trabalhados
    conceitos = [
        "Expressar através da obediência",
        "Expressar através da fé",
        "Expressar através do testemunho",
        "Expressar através da comunhão",
        "Expressar através da transformação",
        "Expressar através do propósito",
        "Expressar através da sabedoria",
        "Expressar através da unidade"
    ]
    
    # Se não há histórico, sugerir conceito inicial
    if not ultimo_tema:
        return "Expressar Jesus em nosso dia a dia"
    
    # Rotacionar conceitos
    # (em produção, você pode usar lógica mais sofisticada)
    return "Expressar através da caminhada com Cristo"
