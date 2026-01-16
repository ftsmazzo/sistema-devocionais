FROM node:18-alpine AS builder

WORKDIR /app

# Argumentos de build
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Copiar arquivos de dependências
COPY frontend/package*.json ./
RUN npm install

# Copiar código fonte
COPY frontend/ ./

# Build
RUN npm run build

# Produção
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
