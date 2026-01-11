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
from app.static import FRONTEND_BUILD_PATH

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

# Configurar mounts de arquivos estáticos (sem catch-all ainda)
if FRONTEND_BUILD_PATH:
    from fastapi.staticfiles import StaticFiles
    assets_path = FRONTEND_BUILD_PATH / "assets"
    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_path)), name="assets")
    app.mount("/static", StaticFiles(directory=str(FRONTEND_BUILD_PATH)), name="static")

# Incluir routers PRIMEIRO (antes da rota catch-all do frontend)
app.include_router(auth.router, prefix="/api", tags=["Autenticação"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notificações"])
app.include_router(notifications_router, prefix="/api", tags=["Notificações n8n"])
app.include_router(devocional.router, prefix="/api", tags=["Devocional"])
app.include_router(devocional_context.router, prefix="/api", tags=["Devocional Context"])
app.include_router(devocional_test.router, prefix="/api", tags=["Devocional Test"])

# Registrar rota catch-all do frontend DEPOIS de todas as rotas da API
if FRONTEND_BUILD_PATH:
    from fastapi.responses import FileResponse
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        # Se começar com api/ ou health, não servir frontend
        if full_path.startswith("api/") or full_path == "api" or full_path.startswith("health"):
            raise HTTPException(status_code=404, detail="Not found")
        
        # Servir index.html para todas as outras rotas
        index_path = FRONTEND_BUILD_PATH / "index.html"
        if index_path.exists():
            return FileResponse(str(index_path), media_type="text/html")
        
        raise HTTPException(status_code=404, detail="Frontend index not found")


@app.get("/api/status")
async def api_status():
    """Endpoint de status da API"""
    return {
        "message": "Sistema de Envio de Devocionais",
        "status": "online",
        "version": "1.0.0"
    }


# Endpoint raiz - só será usado se frontend não estiver buildado
@app.get("/", include_in_schema=False)
async def root():
    """Endpoint raiz - retorna frontend se buildado, senão retorna status"""
    from app.static import FRONTEND_BUILD_PATH
    if FRONTEND_BUILD_PATH:
        # Frontend está buildado, será servido pela rota catch-all
        return {"message": "Frontend disponível", "status": "online"}
    return {
        "message": "Sistema de Envio de Devocionais",
        "status": "online",
        "note": "Frontend não está buildado. Execute 'npm run build' na pasta frontend"
    }


@app.get("/health")
async def health_check():
    """Verificação de saúde da API"""
    return {"status": "healthy"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

