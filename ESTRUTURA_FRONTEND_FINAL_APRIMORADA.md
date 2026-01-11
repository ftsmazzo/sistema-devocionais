# 🎨 Estrutura Final Aprimorada - Frontend Sistema de Devocionais

## 📋 REVISÃO DO FLUXO ATUAL

### 🔄 Fluxo Completo Atual

```
1. n8n (03:30) → Busca Contexto Histórico
   ↓
2. n8n → Primeira IA (Analisa Histórico)
   ↓
3. n8n → Segunda IA (Gera Devocional)
   ↓
4. n8n → Webhook API (/api/devocional/webhook)
   ↓
5. API → Salva no Banco (tabela: devocionais)
   ↓
6. Scheduler (06:00 SP) → Busca Devocional do Dia
   ↓
7. Scheduler → Busca Contatos Ativos
   ↓
8. Scheduler → Distribui entre Instâncias Evolution API
   ↓
9. Evolution API → Envia WhatsApp
   ↓
10. API → Registra Envios (tabela: devocional_envios)
```

### ✅ Confirmação do Fluxo

**SIM, está correto!** O sistema:
- ✅ Recebe devocional do n8n via webhook
- ✅ Salva no banco automaticamente
- ✅ Envia às 06:00 da manhã (horário de São Paulo)
- ✅ Distribui entre múltiplas instâncias
- ✅ Registra todos os envios

---

## 🎯 PROPOSTA FINAL APRIMORADA

### 🏗️ Arquitetura do Frontend

```
┌─────────────────────────────────────────────────────────────┐
│                    SISTEMA DE DEVCIONAIS                    │
│                    (Frontend Completo)                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   AUTENTICAÇÃO   │  │    DASHBOARD    │  │   CONFIGURAÇÃO  │
│  Login/Logout    │  │  Visão Geral    │  │  Sistema/API    │
│  Recuperação     │  │  Estatísticas   │  │  Instâncias     │
└─────────────────┘  └─────────────────┘  └─────────────────┘

┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│    DEVCIONAIS    │  │    CONTATOS     │  │     ENVIOS      │
│  Criar/Editar   │  │  Gerenciar      │  │  Manual/Agendado│
│  Listar/Visualizar│ │  Tags/CRM       │  │  Histórico      │
└─────────────────┘  └─────────────────┘  └─────────────────┘

┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   INSTÂNCIAS    │  │   INTEGRAÇÃO    │  │    RELATÓRIOS   │
│  Evolution API  │  │  n8n/Webhooks   │  │  Analytics      │
│  Status/Health  │  │  Configuração    │  │  Exportação     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 📱 MÓDULOS DETALHADOS

### 🔐 1. MÓDULO DE AUTENTICAÇÃO

#### **1.1 Login**
- Email/Senha
- "Lembrar-me" (token persistente)
- Validação em tempo real
- Recuperação de senha
- 2FA (opcional futuro)

#### **1.2 Perfil do Usuário**
- Editar dados pessoais
- Alterar senha
- Configurações de notificação
- Preferências de interface

---

### 📊 2. DASHBOARD PRINCIPAL

#### **2.1 Visão Geral**
- **Cards de Estatísticas:**
  - Total de contatos (ativos/inativos)
  - Devocionais enviados hoje/semana/mês
  - Taxa de sucesso de envios
  - Instâncias ativas/erro
  - Mensagens pendentes

- **Gráficos:**
  - Envios por dia (últimos 30 dias)
  - Taxa de sucesso por instância
  - Contatos ativos vs inativos
  - Horários de maior envio

- **Atividades Recentes:**
  - Últimos devocionais criados
  - Últimos envios (sucesso/falha)
  - Alertas e notificações
  - Logs de sistema

#### **2.2 Widgets Configuráveis**
- Arrastar e soltar widgets
- Personalizar layout
- Salvar preferências

---

### 📖 3. MÓDULO DE DEVCIONAIS

#### **3.1 Lista de Devocionais**
- **Filtros:**
  - Por data (range)
  - Por status (enviado/não enviado)
  - Por autor
  - Por tema/palavras-chave
  - Busca por texto

- **Visualização:**
  - Cards com preview
  - Lista compacta
  - Tabela detalhada
  - Calendário mensal

- **Ações:**
  - Visualizar completo
  - Editar
  - Duplicar
  - Agendar envio
  - Enviar agora
  - Excluir

#### **3.2 Criar/Editar Devocional**

**Formulário Completo:**
- **Título** (obrigatório, validação)
- **Data** (seletor de data, padrão: hoje)
- **Conteúdo** (editor rico):
  - Formatação (negrito, itálico)
  - Emojis
  - Versículos destacados
  - Preview em tempo real
  - Contador de caracteres (WhatsApp: 4096)

- **Versículos:**
  - Versículo Principal (texto + referência)
  - Versículo de Apoio (texto + referência)
  - Validação de formato

- **Metadados:**
  - Autor (dropdown ou texto)
  - Tema (tags múltiplas)
  - Palavras-chave (tags)
  - Relacionado a "Expressar" (checkbox)

- **Preview:**
  - Visualização como será enviado
  - Teste de formatação WhatsApp
  - Validação de tamanho

- **Validações:**
  - ✅ Título obrigatório
  - ✅ Conteúdo obrigatório (mínimo 100 caracteres)
  - ✅ Versículos válidos
  - ✅ Data válida
  - ✅ Tamanho máximo (4096 caracteres)
  - ✅ Formato de versículos correto

#### **3.3 Visualizar Devocional**
- Visualização completa formatada
- Histórico de envios
- Estatísticas (quantos receberam)
- Ações rápidas (editar, enviar, agendar)

#### **3.4 Agendar Envio**
- Selecionar devocional
- Escolher data/hora
- Selecionar contatos (todos ou específicos)
- Selecionar instância (ou automático)
- Preview do agendamento
- Confirmação

---

### 👥 4. MÓDULO DE CONTATOS (CRM)

#### **4.1 Lista de Contatos**
- **Filtros Avançados:**
  - Por status (ativo/inativo)
  - Por tags
  - Por última mensagem enviada
  - Por instância associada
  - Busca por nome/telefone

- **Visualização:**
  - Cards com foto (futuro)
  - Lista compacta
  - Tabela detalhada
  - Grid com tags

- **Colunas:**
  - Nome
  - Telefone (formatado)
  - Status (ativo/inativo)
  - Tags
  - Total enviado
  - Último envio
  - Instância associada
  - Ações

#### **4.2 Criar/Editar Contato**

**Formulário:**
- **Nome** (obrigatório, validação)
- **Telefone** (obrigatório, validação):
  - Formato: +5516999999999
  - Validação de DDD
  - Máscara automática
  - Verificação de duplicidade

- **Status** (ativo/inativo)
- **Tags** (múltiplas):
  - Criar novas tags
  - Sugestões baseadas em histórico
  - Cores personalizadas

- **Instância Preferencial** (opcional):
  - Dropdown com instâncias disponíveis
  - "Automático" (padrão)

- **Observações** (textarea)
- **Data de cadastro** (automático)

**Validações:**
- ✅ Nome obrigatório (mínimo 2 caracteres)
- ✅ Telefone obrigatório e válido
- ✅ Formato de telefone correto
- ✅ Telefone único (não duplicado)
- ✅ Tags válidas

#### **4.3 Gerenciamento de Tags**
- **Criar Tag:**
  - Nome
  - Cor (seletor)
  - Descrição

- **Lista de Tags:**
  - Visualização com cores
  - Contagem de contatos por tag
  - Editar/Excluir
  - Filtrar contatos por tag

#### **4.4 Importação em Massa**
- Upload CSV/Excel
- Template para download
- Validação de dados
- Preview antes de importar
- Relatório de importação
- Tratamento de erros

#### **4.5 Exportação**
- Exportar para CSV/Excel
- Filtrar antes de exportar
- Selecionar colunas

---

### 📤 5. MÓDULO DE ENVIOS

#### **5.1 Envio Manual**

**Formulário Completo:**
- **Tipo de Envio:**
  - Devocional existente (dropdown)
  - Mensagem personalizada (textarea)
  - Template (futuro)

- **Seleção de Contatos:**
  - Todos ativos
  - Por tags
  - Seleção manual (checkboxes)
  - Upload de lista
  - Busca e filtro

- **Seleção de Instância:**
  - Automático (distribuição)
  - Instância específica (dropdown)
  - Múltiplas instâncias (checkboxes)

- **Configurações:**
  - Delay entre mensagens (segundos)
  - Horário de envio (agora ou agendar)
  - Enviar vCard para novos contatos (checkbox)
  - Personalizar com nome (checkbox)

- **Preview:**
  - Quantidade de mensagens
  - Tempo estimado
  - Instâncias que serão usadas
  - Preview da mensagem

- **Validações:**
  - ✅ Pelo menos 1 contato selecionado
  - ✅ Mensagem não vazia
  - ✅ Instância disponível
  - ✅ Delay válido (mínimo 2 segundos)
  - ✅ Limites de rate não excedidos

#### **5.2 Agendamento de Envios**
- Lista de agendamentos
- Criar novo agendamento
- Editar/Cancelar agendamento
- Histórico de agendamentos executados

#### **5.3 Histórico de Envios**
- **Filtros:**
  - Por data
  - Por status (sucesso/falha/pendente)
  - Por instância
  - Por contato
  - Por devocional

- **Visualização:**
  - Lista detalhada
  - Cards com status
  - Timeline

- **Informações:**
  - Data/hora do envio
  - Contato (nome + telefone)
  - Devocional enviado
  - Instância usada
  - Status (sucesso/falha)
  - Erro (se falhou)
  - Tentativas de retry

- **Ações:**
  - Reenviar (se falhou)
  - Ver detalhes
  - Exportar relatório

---

### 🔌 6. MÓDULO DE INSTÂNCIAS

#### **6.1 Lista de Instâncias**
- **Cards de Status:**
  - Nome da instância
  - Status (ACTIVE/INACTIVE/ERROR)
  - Última verificação
  - Mensagens enviadas hoje
  - Mensagens enviadas esta hora
  - Limites configurados
  - Taxa de sucesso

- **Ações:**
  - Ver detalhes
  - Testar conexão
  - Editar configuração
  - Desabilitar/Habilitar

#### **6.2 Configurar Instância**

**Formulário:**
- **Nome** (obrigatório)
- **API URL** (obrigatório, validação de URL)
- **API Key** (obrigatório, campo senha)
- **Display Name** (nome que aparece no WhatsApp)
- **Limites:**
  - Máximo por hora
  - Máximo por dia
- **Prioridade** (1-10)
- **Habilitado** (checkbox)

**Validações:**
- ✅ URL válida
- ✅ API Key válida
- ✅ Conexão testada antes de salvar
- ✅ Nome único
- ✅ Limites válidos

#### **6.3 Teste de Instância**
- Botão "Testar Conexão"
- Verificação de status
- Teste de envio (número de teste)
- Logs de teste

#### **6.4 Estratégia de Distribuição**
- Round Robin (padrão)
- Por prioridade
- Por carga (menos mensagens)
- Manual (escolher sempre)

---

### 🔗 7. MÓDULO DE INTEGRAÇÃO n8n

#### **7.1 Configuração de Webhook**
- **URL do Webhook:**
  - Exibir URL atual
  - Copiar para clipboard
  - Regenerar secret

- **Secret:**
  - Exibir (mascarado)
  - Regenerar
  - Copiar

- **Configurações:**
  - Permitir apenas devocionais
  - Validar secret (checkbox)
  - Logs de webhook (ativar/desativar)

#### **7.2 Histórico de Webhooks**
- Lista de webhooks recebidos
- Status (sucesso/falha)
- Data/hora
- Dados recebidos (JSON)
- Resposta enviada

#### **7.3 Teste de Webhook**
- Simular webhook do n8n
- Enviar devocional de teste
- Verificar resposta

#### **7.4 Integração Automática com n8n**
- **Opção 1: Webhook Bidirecional**
  - n8n envia devocional → API salva
  - API pode disparar n8n para postar no WhatsApp
  - Configurar URL do n8n no sistema

- **Opção 2: Envio Direto (Recomendado)**
  - Sistema envia diretamente via Evolution API
  - Não precisa de n8n para envio
  - n8n apenas gera o devocional

#### **7.5 Configuração de Automação**
- **Quando receber devocional do n8n:**
  - Salvar automaticamente (sempre)
  - Agendar envio automático (às 06:00)
  - Enviar imediatamente (opção)
  - Aguardar confirmação manual (opção)

- **Notificações:**
  - Email quando devocional recebido
  - Notificação no sistema
  - Alertas de erro

---

### 📈 8. MÓDULO DE RELATÓRIOS

#### **8.1 Relatórios de Envio**
- Envios por período
- Taxa de sucesso/falha
- Envios por instância
- Envios por contato
- Gráficos e estatísticas

#### **8.2 Relatórios de Contatos**
- Crescimento de contatos
- Contatos por tag
- Contatos ativos vs inativos
- Última mensagem recebida

#### **8.3 Relatórios de Devocionais**
- Devocionais criados
- Devocionais enviados
- Temas mais usados
- Versículos mais usados

#### **8.4 Exportação**
- PDF
- Excel/CSV
- JSON
- Agendar relatório (email)

---

### ⚙️ 9. MÓDULO DE CONFIGURAÇÕES

#### **9.1 Configurações Gerais**
- **Horário de Envio Automático:**
  - Hora (HH:MM)
  - Timezone (São Paulo)
  - Ativar/Desativar

- **Rate Limiting:**
  - Delay entre mensagens (segundos)
  - Máximo por hora
  - Máximo por dia

- **Retry:**
  - Máximo de tentativas
  - Delay entre tentativas

- **Personalização:**
  - Enviar vCard para novos contatos
  - Enviar solicitação de contato
  - Personalizar com nome do contato

#### **9.2 Configurações de Validação**
- Ativar/Desativar validações
- Mensagens de erro personalizadas
- Regras de negócio

#### **9.3 Logs do Sistema**
- Visualizar logs
- Filtrar por nível (INFO/ERROR/WARNING)
- Exportar logs
- Limpar logs antigos

#### **9.4 Backup e Restauração**
- Backup automático (agendar)
- Backup manual
- Restaurar backup
- Download de backup

---

## 🎨 DESIGN SYSTEM

### **Cores:**
- Primária: Azul espiritual (#4A90E2)
- Secundária: Verde (#52C41A)
- Erro: Vermelho (#FF4D4F)
- Aviso: Laranja (#FAAD14)
- Sucesso: Verde (#52C41A)
- Neutro: Cinza (#8C8C8C)

### **Tipografia:**
- Títulos: Inter, 24px-32px
- Subtítulos: Inter, 18px-20px
- Corpo: Inter, 14px-16px
- Pequeno: Inter, 12px

### **Componentes:**
- Botões (primário, secundário, perigo)
- Inputs (text, select, textarea, date)
- Cards
- Modais
- Tabelas
- Formulários
- Alertas/Notificações
- Loading states
- Empty states

---

## 🔒 VALIDAÇÕES E SEGURANÇA

### **Validações Frontend:**
- ✅ Todos os campos obrigatórios
- ✅ Formato de telefone
- ✅ Formato de email
- ✅ URLs válidas
- ✅ Datas válidas
- ✅ Tamanho máximo de mensagens
- ✅ Limites numéricos
- ✅ Duplicidade de contatos
- ✅ Validação em tempo real

### **Validações Backend:**
- ✅ Autenticação (JWT)
- ✅ Autorização (roles)
- ✅ Rate limiting
- ✅ Sanitização de inputs
- ✅ Validação de dados
- ✅ Logs de auditoria

---

## 🚀 FUNCIONALIDADES ESPECIAIS

### **1. Envio Inteligente**
- Distribuição automática entre instâncias
- Balanceamento de carga
- Failover automático
- Retry inteligente

### **2. Preview em Tempo Real**
- Preview de mensagens
- Preview de devocionais
- Preview de agendamentos

### **3. Busca Avançada**
- Busca global
- Filtros combinados
- Salvar filtros favoritos

### **4. Notificações**
- Notificações em tempo real (WebSocket)
- Notificações de sucesso/falha
- Alertas de sistema
- Email notifications

### **5. Responsividade**
- Mobile-first
- Tablet
- Desktop
- PWA (Progressive Web App)

---

## 📱 TECNOLOGIAS SUGERIDAS

### **Frontend:**
- **Framework:** React 18+ com TypeScript
- **Roteamento:** React Router v6
- **Estado:** Zustand ou Redux Toolkit
- **Formulários:** React Hook Form + Zod
- **UI:** Ant Design ou Material-UI
- **Gráficos:** Recharts ou Chart.js
- **Editor:** React Quill ou Draft.js
- **Validação:** Zod
- **HTTP:** Axios
- **WebSocket:** Socket.io-client

### **Backend (já existe):**
- FastAPI
- SQLAlchemy
- PostgreSQL
- Pydantic

---

## 🎯 PRIORIZAÇÃO DE IMPLEMENTAÇÃO

### **Fase 1: Core (Essencial)**
1. Autenticação (Login/Logout)
2. Dashboard básico
3. Lista de devocionais
4. Criar/Editar devocional
5. Lista de contatos
6. Criar/Editar contato
7. Envio manual básico

### **Fase 2: Funcionalidades Avançadas**
8. Tags e CRM
9. Agendamento de envios
10. Histórico detalhado
11. Gerenciamento de instâncias
12. Configurações avançadas

### **Fase 3: Integração e Relatórios**
13. Integração n8n completa
14. Relatórios e analytics
15. Exportação de dados
16. Notificações em tempo real

### **Fase 4: Melhorias**
17. PWA
18. Mobile app (opcional)
19. 2FA
20. Backup automático

---

## ✅ CHECKLIST DE VALIDAÇÕES

### **Devocional:**
- [ ] Título obrigatório
- [ ] Conteúdo obrigatório (mínimo 100 caracteres)
- [ ] Versículos válidos
- [ ] Data válida
- [ ] Tamanho máximo (4096 caracteres)
- [ ] Formato de versículos correto

### **Contato:**
- [ ] Nome obrigatório (mínimo 2 caracteres)
- [ ] Telefone obrigatório e válido
- [ ] Formato de telefone correto (+5516999999999)
- [ ] Telefone único (não duplicado)
- [ ] Tags válidas

### **Envio:**
- [ ] Pelo menos 1 contato selecionado
- [ ] Mensagem não vazia
- [ ] Instância disponível
- [ ] Delay válido (mínimo 2 segundos)
- [ ] Limites de rate não excedidos
- [ ] Horário válido (se agendado)

### **Instância:**
- [ ] Nome obrigatório e único
- [ ] URL válida
- [ ] API Key válida
- [ ] Conexão testada
- [ ] Limites válidos

---

## 🎉 RESULTADO FINAL

Um **sistema completo e autônomo** que permite:

1. ✅ **Gerenciar tudo** via interface web
2. ✅ **Configurar cada detalhe** do sistema
3. ✅ **Validar tudo** antes de enviar
4. ✅ **Enviar mensagens** escolhendo número e conteúdo
5. ✅ **Integrar com n8n** ou enviar diretamente
6. ✅ **Monitorar tudo** em tempo real
7. ✅ **Relatórios completos** de todas as operações

**Pronto para transformar em SaaS!** 🚀

