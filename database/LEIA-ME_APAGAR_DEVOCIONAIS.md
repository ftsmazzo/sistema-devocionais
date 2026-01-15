# 🗑️ Como Apagar Todos os Devocionais

## ⚠️ ATENÇÃO

Estes scripts vão **APAGAR PERMANENTEMENTE**:
- ✅ Todos os devocionais
- ✅ Todos os envios
- ✅ Todos os agendamentos

**NÃO vão apagar:**
- ❌ Contatos
- ❌ Consentimentos
- ❌ Engajamento
- ❌ Instâncias
- ❌ Configurações
- ❌ Usuários

---

## 📋 Opções de Scripts

### 1. Script Completo (Recomendado)
**Arquivo:** `apagar_todos_devocionais.sql`

**Características:**
- ✅ Usa transação (pode fazer ROLLBACK se necessário)
- ✅ Mostra estatísticas antes e depois
- ✅ Verificações de segurança
- ✅ Logs detalhados

**Como usar:**
```sql
-- Execute no PostgreSQL
\i database/apagar_todos_devocionais.sql

-- Ou copie e cole o conteúdo no pgAdmin/DBeaver
```

**Para desfazer (antes do COMMIT):**
```sql
ROLLBACK;
```

---

### 2. Script Simples (Rápido)
**Arquivo:** `apagar_devocionais_simples.sql`

**Características:**
- ✅ Execução rápida
- ✅ Sem transação (não pode desfazer)
- ✅ Comandos diretos

**Como usar:**
```sql
-- Execute no PostgreSQL
\i database/apagar_devocionais_simples.sql
```

---

## 🔧 Como Executar

### Opção 1: Via psql (Terminal)
```bash
psql -U seu_usuario -d nome_do_banco -f database/apagar_todos_devocionais.sql
```

### Opção 2: Via pgAdmin
1. Abra o pgAdmin
2. Conecte ao banco de dados
3. Clique com botão direito no banco → **Query Tool**
4. Abra o arquivo `apagar_todos_devocionais.sql`
5. Execute (F5)

### Opção 3: Via DBeaver
1. Conecte ao banco de dados
2. Abra o arquivo `apagar_todos_devocionais.sql`
3. Execute (Ctrl+Enter)

### Opção 4: Via EasyPanel (Terminal do Container)
```bash
# Acesse o terminal do container do banco
psql -U postgres -d devocionais -f /caminho/para/apagar_todos_devocionais.sql
```

---

## ✅ Verificação Após Executar

Execute estas queries para verificar:

```sql
-- Verificar se devocionais foram apagados (deve retornar 0)
SELECT COUNT(*) FROM devocionais;

-- Verificar se envios foram apagados (deve retornar 0)
SELECT COUNT(*) FROM devocional_envios;

-- Verificar se contatos foram mantidos (deve retornar o número de contatos)
SELECT COUNT(*) FROM devocional_contatos;
```

---

## 🆘 Problemas Comuns

### Erro: "relation does not exist"
- Verifique se o nome da tabela está correto
- Verifique se está conectado ao banco correto

### Erro: "permission denied"
- Você precisa de permissões de DELETE no banco
- Execute como superusuário ou dono do banco

### Erro: "foreign key constraint"
- O script já apaga na ordem correta (envios → agendamentos → devocionais)
- Se ainda der erro, verifique se há outras tabelas relacionadas

---

## 📝 Notas

- Os IDs serão resetados (começarão do 1 novamente)
- Os contatos serão mantidos intactos
- O histórico de engajamento será mantido
- As configurações do sistema serão mantidas

---

**Última atualização:** 2026-01-14
