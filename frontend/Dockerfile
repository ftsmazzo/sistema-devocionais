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

# URL do backend usada pelo proxy /api do nginx.
# Pode ser sobrescrita no EasyPanel sem precisar rebuildar a imagem.
ENV BACKEND_URL=http://backend:3001

# O nginx oficial processa templates em /etc/nginx/templates via envsubst.
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
