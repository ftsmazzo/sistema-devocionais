FROM node:18-alpine

WORKDIR /app

# Copiar arquivos de dependências
COPY backend/package*.json ./
COPY backend/tsconfig.json ./

# Instalar dependências
RUN npm install

# Copiar código fonte
COPY backend/src ./src

# Build
RUN npm run build

# Expor porta
EXPOSE 3001

# Comando de inicialização
CMD ["npm", "start"]
