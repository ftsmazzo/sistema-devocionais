# Instruções para Ativar Campo message_type

## Passo 1: Executar Migração SQL

Execute o arquivo `database/migrate_add_message_type.sql` no seu banco PostgreSQL:

```sql
-- Execute o arquivo database/migrate_add_message_type.sql
```

## Passo 2: Descomentar Campo no Modelo

Após executar a migração, descomente o campo `message_type` no arquivo `backend/app/database.py`:

```python
# Trocar de:
# message_type = Column(String(20), default="devocional_agendado", nullable=True)

# Para:
message_type = Column(String(20), default="devocional_agendado", nullable=True)
```

## Passo 3: Descomentar Referências

Descomente as referências a `message_type` nos seguintes arquivos:

### `backend/app/routers/devocional.py`
- Linha ~174: `message_type="devocional_manual"`
- Linha ~654: `message_type="mensagem_personalizada"`

### `backend/app/devocional_scheduler.py`
- Linha ~169: `message_type="devocional_agendado"`

## Verificação

Após fazer as alterações, reinicie o backend e verifique se não há erros relacionados a `message_type`.
