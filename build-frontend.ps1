# Script para buildar o frontend e copiar para o backend
# Execute: .\build-frontend.ps1

Write-Host "🏗️  Iniciando build do frontend..." -ForegroundColor Cyan

# Verificar se npm está instalado
try {
    $npmVersion = npm --version
    Write-Host "✅ npm encontrado: $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ npm não encontrado. Instale Node.js primeiro!" -ForegroundColor Red
    Write-Host "   Download: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Ir para pasta frontend
Set-Location frontend

# Instalar dependências
Write-Host "`n📦 Instalando dependências..." -ForegroundColor Cyan
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Erro ao instalar dependências!" -ForegroundColor Red
    Set-Location ..
    exit 1
}

# Build
Write-Host "`n🔨 Fazendo build..." -ForegroundColor Cyan
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Erro ao fazer build!" -ForegroundColor Red
    Set-Location ..
    exit 1
}

# Voltar para raiz
Set-Location ..

# Verificar se dist existe
if (Test-Path "frontend\dist") {
    Write-Host "`n✅ Build concluído!" -ForegroundColor Green
    
    # Copiar para backend
    Write-Host "📋 Copiando para backend..." -ForegroundColor Cyan
    
    # Remover dist antigo se existir
    if (Test-Path "backend\dist") {
        Remove-Item -Path "backend\dist" -Recurse -Force
    }
    
    # Copiar novo dist
    Copy-Item -Path "frontend\dist" -Destination "backend\dist" -Recurse
    
    Write-Host "✅ Frontend copiado para backend/dist" -ForegroundColor Green
    Write-Host "`n🚀 Próximos passos:" -ForegroundColor Yellow
    Write-Host "   1. git add backend/dist" -ForegroundColor White
    Write-Host "   2. git commit -m 'feat: Adicionar build do frontend'" -ForegroundColor White
    Write-Host "   3. git push origin main" -ForegroundColor White
} else {
    Write-Host "❌ Pasta dist não foi criada!" -ForegroundColor Red
    exit 1
}

Write-Host "`n✨ Concluído!" -ForegroundColor Green

