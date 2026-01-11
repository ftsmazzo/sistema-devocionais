"""
Servir frontend estático
"""
from fastapi import Request, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import os

# Caminho para o frontend buildado
# Tenta vários caminhos possíveis
POSSIBLE_PATHS = [
    Path("/app/dist"),  # Docker (backend) - PRIMEIRO (produção)
    Path(__file__).parent.parent / "dist",  # Dentro do backend (local)
    Path(__file__).parent.parent.parent / "frontend" / "dist",  # Raiz do projeto (dev)
    Path("/app/frontend/dist"),  # Docker alternativo
]

FRONTEND_BUILD_PATH = None
for path in POSSIBLE_PATHS:
    if path.exists() and (path / "index.html").exists():
        FRONTEND_BUILD_PATH = path
        break


def setup_static_files(app):
    """
    Configura arquivos estáticos do frontend
    """
    if FRONTEND_BUILD_PATH:
        # Servir arquivos estáticos (JS, CSS, imagens, etc)
        assets_path = FRONTEND_BUILD_PATH / "assets"
        if assets_path.exists():
            app.mount("/assets", StaticFiles(directory=str(assets_path)), name="assets")
        
        # Servir outros arquivos estáticos
        app.mount("/static", StaticFiles(directory=str(FRONTEND_BUILD_PATH)), name="static")
        
        # Servir index.html para rotas do frontend (deve ser o último)
        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_frontend(full_path: str, request: Request):
            # Se começar com /api, não servir frontend (deixar passar para rotas da API)
            if full_path.startswith("api") or full_path.startswith("health"):
                raise HTTPException(status_code=404, detail="Not found")
            
            # Servir index.html para todas as outras rotas
            index_path = FRONTEND_BUILD_PATH / "index.html"
            if index_path.exists():
                return FileResponse(
                    str(index_path),
                    media_type="text/html"
                )
            
            raise HTTPException(status_code=404, detail="Frontend index not found")
    else:
        # Se não tiver build, manter endpoint raiz original
        pass

