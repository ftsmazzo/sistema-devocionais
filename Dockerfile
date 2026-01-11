# Stage 1: Build do Frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /app

# Copiar package files do frontend
COPY frontend/package*.json ./frontend/

# Instalar dependências
WORKDIR /app/frontend
RUN npm install

# Copiar código fonte do frontend
WORKDIR /app
COPY frontend/ ./frontend/

# Build do frontend
WORKDIR /app/frontend
RUN npm run build

# Stage 2: Backend Python
FROM python:3.11-slim

WORKDIR /app

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    libpq-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copiar requirements
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código do backend
COPY backend/ .

# Copiar frontend buildado do stage anterior
COPY --from=frontend-builder /app/frontend/dist ./dist

# Variáveis de ambiente
ENV PYTHONUNBUFFERED=1

# Expor porta
EXPOSE 8000

# Comando
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
