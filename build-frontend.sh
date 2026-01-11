#!/bin/bash
# Script para buildar o frontend e copiar para o backend
# Execute: chmod +x build-frontend.sh && ./build-frontend.sh

echo "🏗️  Iniciando build do frontend..."

# Verificar se npm está instalado
if ! command -v npm &> /dev/null; then
    echo "❌ npm não encontrado. Instale Node.js primeiro!"
    echo "   Download: https://nodejs.org/"
    exit 1
fi

echo "✅ npm encontrado: $(npm --version)"

# Ir para pasta frontend
cd frontend

# Instalar dependências
echo ""
echo "📦 Instalando dependências..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Erro ao instalar dependências!"
    cd ..
    exit 1
fi

# Build
echo ""
echo "🔨 Fazendo build..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Erro ao fazer build!"
    cd ..
    exit 1
fi

# Voltar para raiz
cd ..

# Verificar se dist existe
if [ -d "frontend/dist" ]; then
    echo ""
    echo "✅ Build concluído!"
    
    # Copiar para backend
    echo "📋 Copiando para backend..."
    
    # Remover dist antigo se existir
    if [ -d "backend/dist" ]; then
        rm -rf backend/dist
    fi
    
    # Copiar novo dist
    cp -r frontend/dist backend/
    
    echo "✅ Frontend copiado para backend/dist"
    echo ""
    echo "🚀 Próximos passos:"
    echo "   1. git add backend/dist"
    echo "   2. git commit -m 'feat: Adicionar build do frontend'"
    echo "   3. git push origin main"
else
    echo "❌ Pasta dist não foi criada!"
    exit 1
fi

echo ""
echo "✨ Concluído!"

