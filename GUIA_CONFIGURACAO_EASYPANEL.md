# 🔧 Guia: Configuração no EasyPanel

## 📋 Entendendo a Arquitetura

### **1. Evolution API (EasyPanel)**
- ✅ **Onde**: EasyPanel - Containers/Serviços
- ✅ **O que**: Instâncias do WhatsApp (os números)
- ✅ **Quantas**: 4 instâncias (Devocional-1, Devocional-2, Devocional-3, Devocional-4)
- ✅ **Configuração**: Cada instância é um container no EasyPanel

### **2. Backend da Aplicação (EasyPanel)**
- ✅ **Onde**: EasyPanel - Container do seu backend
- ✅ **O que**: Sistema de devocionais (FastAPI)
- ✅ **Configuração**: Arquivo `.env` dentro do container do backend

## 🎯 Passo a Passo

### **PASSO 1: Configurar Instâncias Evolution API no EasyPanel**

No EasyPanel, você precisa ter **4 containers/serviços** rodando Evolution API:

#### **Container 1: Devocional-1**
```
Nome do Container: evolution-devocional-1
Porta: 8080 (ou outra)
API Key: key_instancia_1 (gerada pelo Evolution)
```

#### **Container 2: Devocional-2**
```
Nome do Container: evolution-devocional-2
Porta: 8081 (ou outra)
API Key: key_instancia_2
```

#### **Container 3: Devocional-3**
```
Nome do Container: evolution-devocional-3
Porta: 8082 (ou outra)
API Key: key_instancia_3
```

#### **Container 4: Devocional-4**
```
Nome do Container: evolution-devocional-4
Porta: 8083 (ou outra)
API Key: key_instancia_4
```

**Importante**: Cada instância precisa:
1. Estar conectada a um número WhatsApp diferente
2. Ter seu QR Code escaneado
3. Ter sua API Key gerada

### **PASSO 2: Obter URLs e API Keys**

Para cada instância Evolution API no EasyPanel, você precisa:

1. **URL da API**: 
   - Se estiver no mesmo servidor: `http://evolution-devocional-1:8080`
   - Se estiver em servidor diferente: `https://evolution1.seudominio.com`
   - Se usar IP: `http://192.168.1.100:8080`

2. **API Key**: 
   - Gerada no painel do Evolution API
   - Cada instância tem sua própria API Key

3. **Nome da Instância**:
   - Definido ao criar a instância no Evolution
   - Exemplo: `Devocional-1`, `Devocional-2`, etc.

### **PASSO 3: Configurar Backend no EasyPanel**

No container do **backend da aplicação** (sistema de devocionais), edite o arquivo `.env`:

#### **Opção A: Mesmo Servidor (Recomendado)**

Se Evolution API e Backend estão no mesmo servidor EasyPanel:

```env
# Multi-Instância Evolution API
EVOLUTION_INSTANCES=[{"name":"Devocional-1","api_url":"http://evolution-devocional-1:8080","api_key":"key_instancia_1","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-2","api_url":"http://evolution-devocional-2:8081","api_key":"key_instancia_2","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-3","api_url":"http://evolution-devocional-3:8082","api_key":"key_instancia_3","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-4","api_url":"http://evolution-devocional-4:8083","api_key":"key_instancia_4","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true}]

EVOLUTION_DISPLAY_NAME=Devocional Diário
EVOLUTION_INSTANCE_STRATEGY=round_robin
```

#### **Opção B: Servidores Diferentes**

Se Evolution API está em servidor diferente:

```env
EVOLUTION_INSTANCES=[{"name":"Devocional-1","api_url":"https://evolution1.seudominio.com","api_key":"key_instancia_1","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},...]
```

#### **Opção C: IP Externo**

```env
EVOLUTION_INSTANCES=[{"name":"Devocional-1","api_url":"http://192.168.1.100:8080","api_key":"key_instancia_1","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},...]
```

## 🔍 Como Descobrir as URLs no EasyPanel

### **1. Verificar Nome do Container**

No EasyPanel:
1. Vá em **Services** ou **Containers**
2. Encontre o container do Evolution API
3. Veja o nome do container (ex: `evolution-devocional-1`)

### **2. Verificar Porta**

No EasyPanel:
1. Abra o container do Evolution API
2. Veja a porta exposta (ex: `8080`)
3. Ou veja nas variáveis de ambiente do container

### **3. Verificar API Key**

No Evolution API:
1. Acesse o painel do Evolution (geralmente na porta configurada)
2. Vá em **Instances** ou **API Keys**
3. Copie a API Key da instância

### **4. Testar Conexão**

Depois de configurar, teste:

```bash
# No container do backend
curl http://evolution-devocional-1:8080/instance/fetchInstances \
  -H "apikey: sua_key_aqui"
```

## 📝 Exemplo Completo

### **Cenário: 4 Instâncias no EasyPanel**

**No EasyPanel você tem:**
- Container 1: `evolution-devocional-1` na porta `8080`
- Container 2: `evolution-devocional-2` na porta `8081`
- Container 3: `evolution-devocional-3` na porta `8082`
- Container 4: `evolution-devocional-4` na porta `8083`

**No `.env` do backend (container da aplicação):**

```env
# Database
DATABASE_URL=postgresql://postgres:senha@db.easypanel.app:5432/devocional_db

# Multi-Instância Evolution API
EVOLUTION_INSTANCES=[{"name":"Devocional-1","api_url":"http://evolution-devocional-1:8080","api_key":"abc123key1","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-2","api_url":"http://evolution-devocional-2:8081","api_key":"abc123key2","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-3","api_url":"http://evolution-devocional-3:8082","api_key":"abc123key3","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true},{"name":"Devocional-4","api_url":"http://evolution-devocional-4:8083","api_key":"abc123key4","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true}]

EVOLUTION_DISPLAY_NAME=Devocional Diário
EVOLUTION_INSTANCE_STRATEGY=round_robin
SEND_VCARD_TO_NEW_CONTACTS=false
SEND_CONTACT_REQUEST=false

# Outras configurações...
DEVOCIONAL_SEND_TIME=06:00
DEVOCIONAL_WEBHOOK_SECRET=seu_secret_aqui
```

## ⚠️ Importante

1. **Nomes dos Containers**: Use os nomes exatos dos containers no EasyPanel
2. **Portas**: Use as portas internas (se mesmo servidor) ou externas (se servidor diferente)
3. **API Keys**: Cada instância tem sua própria API Key
4. **Rede**: Containers no mesmo servidor podem se comunicar pelo nome do container

## 🔧 Verificar Configuração

Após configurar, teste:

```bash
# No container do backend
curl http://localhost:8000/api/notifications/instances
```

Deve retornar status das 4 instâncias.

---

**Resumo**: 
- **Evolution API**: Configure no EasyPanel (4 containers)
- **Backend**: Configure `.env` no container do backend com URLs e API Keys das instâncias

