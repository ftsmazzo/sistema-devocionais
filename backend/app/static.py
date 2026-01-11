"""
Servir frontend estático
"""
from fastapi import Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import os

# Caminho para o frontend buildado
FRONTEND_BUILD_PATH = Path(__file__).parent.parent.parent / "frontend" / "dist"

def setup_static_files(app):
    """
    Configura arquivos estáticos do frontend
    """
    # Se o build do frontend existir, servir arquivos estáticos
    if FRONTEND_BUILD_PATH.exists():
        # Servir arquivos estáticos (JS, CSS, imagens, etc)
        app.mount("/static", StaticFiles(directory=str(FRONTEND_BUILD_PATH / "assets")), name="static")
        
        # Servir index.html para todas as rotas não-API
        @app.get("/{full_path:path}")
        async def serve_frontend(full_path: str, request: Request):
            # Se começar com /api, não servir frontend
            if full_path.startswith("api"):
                return {"error": "Not found"}
            
            # Servir index.html para rotas do frontend
            index_path = FRONTEND_BUILD_PATH / "index.html"
            if index_path.exists():
                return FileResponse(str(index_path))
            
            return {"error": "Frontend not built"}
    else:
        # Se não tiver build, retornar mensagem
        @app.get("/{full_path:path}")
        async def serve_frontend(full_path: str, request: Request):
            if full_path.startswith("api"):
                return {"error": "Not found"}
            
            return {
                "message": "Frontend não está buildado",
                "instructions": "Execute 'npm run build' na pasta frontend e copie a pasta 'dist' para o backend"
            }

