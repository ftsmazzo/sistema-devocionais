"""
API principal do sistema de devocionais
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import uvicorn

from app.database import init_db
from app.routers import notifications, devocional, auth
from app.routers import devocional_context, devocional_test
from app.routers.notifications import router as notifications_router
from app.devocional_scheduler import start_scheduler as start_devocional_scheduler, stop_scheduler as stop_devocional_scheduler
from app.logging_config import setup_logging

# Configurar logging
setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Gerencia o ciclo de vida da aplicação"""
    # Inicialização
    init_db()
    start_devocional_scheduler()  # Iniciar scheduler de devocionais
    yield
    # Encerramento
    stop_devocional_scheduler()  # Parar scheduler de devocionais


app = FastAPI(
    title="Sistema de Envio de Devocionais",
    description="API para envio automático de devocionais via WhatsApp",
    version="1.0.0",
    lifespan=lifespan
)

# Configurar CORS
# Adicione o domínio do seu frontend em produção
cors_origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "https://imobmiq-devocional.90qhxz.easypanel.host",  # Backend (se servir frontend)
    # Adicione aqui o domínio do frontend quando deployar
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Incluir routers
app.include_router(auth.router, prefix="/api", tags=["Autenticação"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notificações"])
app.include_router(notifications_router, prefix="/api", tags=["Notificações n8n"])
app.include_router(devocional.router, prefix="/api", tags=["Devocional"])
app.include_router(devocional_context.router, prefix="/api", tags=["Devocional Context"])
app.include_router(devocional_test.router, prefix="/api", tags=["Devocional Test"])


@app.get("/")
async def root():
    """Endpoint raiz"""
    return {
        "message": "Sistema de Envio de Devocionais",
        "status": "online"
    }


@app.get("/health")
async def health_check():
    """Verificação de saúde da API"""
    return {"status": "healthy"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

