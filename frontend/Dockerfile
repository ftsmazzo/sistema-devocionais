FROM node:18-alpine AS builder

WORKDIR /app

# Copiar arquivos de dependências
COPY frontend/package*.json ./
RUN npm install

# Copiar código fonte
COPY frontend/ ./

# Build
# Não precisa de VITE_API_URL pois usamos proxy relativo /api
RUN npm run build

# Produção
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
