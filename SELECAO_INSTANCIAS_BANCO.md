# Como a Seleção de Instâncias é Controlada no Banco de Dados

## Estrutura da Tabela `blindage_rules`

A tabela `blindage_rules` armazena todas as regras de blindagem, incluindo a regra de seleção de instâncias:

```sql
CREATE TABLE blindage_rules (
  id SERIAL PRIMARY KEY,
  instance_id INTEGER REFERENCES instances(id),
  rule_name VARCHAR(255) NOT NULL,
  rule_type VARCHAR(100) NOT NULL,  -- 'instance_selection' para esta regra
  enabled BOOLEAN DEFAULT TRUE,
  config JSONB NOT NULL,  -- Armazena a configuração em JSON
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Estrutura do Campo `config` para `instance_selection`

Quando a regra de tipo `instance_selection` é criada ou atualizada, o campo `config` armazena um JSON com a seguinte estrutura:

```json
{
  "selected_instance_ids": [1, 3, 5, 7],  // IDs das instâncias selecionadas
  "max_simultaneous": 2,                   // Máximo de instâncias simultâneas
  "auto_switch_on_failure": true,          // Trocar automaticamente quando uma cair
  "retry_after_pause": true                // Reiniciar com outra instância após pausa
}
```

## Fluxo de Dados

### 1. Criação da Regra Padrão

Quando uma nova instância é criada, a função `createDefaultRules()` no backend cria automaticamente a regra `instance_selection`:

```typescript
{
  instance_id: instanceId,
  rule_name: 'Seleção de Instâncias',
  rule_type: 'instance_selection',
  enabled: true,
  config: {
    selected_instance_ids: [],  // Vazio = todas as instâncias
    max_simultaneous: 1,
    auto_switch_on_failure: true,
    retry_after_pause: true,
  },
}
```

### 2. Salvamento no Frontend

Quando o usuário seleciona instâncias e clica em "Salvar", o frontend envia:

```typescript
PUT /api/blindage/rules/:id
{
  enabled: true,
  config: {
    selected_instance_ids: [1, 3, 5],  // IDs selecionados pelo usuário
    max_simultaneous: 2,
    auto_switch_on_failure: true,
    retry_after_pause: true,
  }
}
```

### 3. Armazenamento no Banco

O backend recebe a requisição e atualiza o registro:

```sql
UPDATE blindage_rules 
SET 
  enabled = true,
  config = '{"selected_instance_ids":[1,3,5],"max_simultaneous":2,"auto_switch_on_failure":true,"retry_after_pause":true}'::jsonb,
  updated_at = CURRENT_TIMESTAMP
WHERE id = :rule_id;
```

### 4. Uso Durante os Disparos

Quando uma mensagem precisa ser enviada, a função `selectInstance()` no backend:

1. **Busca a regra de seleção:**
   ```typescript
   const selectionRule = rules.find(r => r.rule_type === 'instance_selection');
   ```

2. **Lê o campo `config`:**
   ```typescript
   const selectedIds = selectionRule.config.selected_instance_ids; // [1, 3, 5]
   ```

3. **Filtra instâncias conectadas e selecionadas:**
   ```sql
   SELECT id FROM instances 
   WHERE id = ANY($1::int[])  -- Filtra pelos IDs selecionados
     AND status = 'connected'  -- Apenas conectadas
   ORDER BY id
   ```
   Com `$1 = [1, 3, 5]`

4. **Seleciona a instância:**
   - Se `selectedIds` está vazio → usa todas as instâncias conectadas
   - Se `selectedIds` tem valores → usa apenas essas instâncias
   - Aplica rotação round-robin entre as instâncias selecionadas

## Exemplo Prático

### Cenário 1: Seleção Específica
- **Config no banco:**
  ```json
  {
    "selected_instance_ids": [1, 3, 5],
    "max_simultaneous": 2
  }
  ```
- **Comportamento:** Apenas as instâncias 1, 3 e 5 participarão dos disparos (se estiverem conectadas)

### Cenário 2: Todas as Instâncias
- **Config no banco:**
  ```json
  {
    "selected_instance_ids": [],
    "max_simultaneous": 3
  }
  ```
- **Comportamento:** Todas as instâncias conectadas participarão (até 3 simultâneas)

### Cenário 3: Instância Cai
- **Situação:** Instância 1 está selecionada e cai (status = 'disconnected')
- **Comportamento:** 
  - A função `selectInstance()` automaticamente ignora a instância 1
  - Seleciona a próxima instância disponível (ex: instância 3)
  - Continua os disparos sem interrupção

## Vantagens do JSONB

O uso de `JSONB` no PostgreSQL permite:

1. **Flexibilidade:** Adicionar novos campos sem alterar o schema
2. **Consultas eficientes:** Índices GIN podem ser criados no JSONB
3. **Validação:** PostgreSQL valida que é JSON válido
4. **Performance:** JSONB é binário, mais rápido que JSON texto

## Índices Recomendados

Para melhor performance, considere criar índices:

```sql
-- Índice para buscar regras por tipo
CREATE INDEX idx_blindage_rules_type ON blindage_rules(rule_type);

-- Índice GIN para consultas no JSONB config
CREATE INDEX idx_blindage_rules_config ON blindage_rules USING GIN (config);

-- Índice para buscar regras ativas de uma instância
CREATE INDEX idx_blindage_rules_instance_enabled 
ON blindage_rules(instance_id, enabled) 
WHERE enabled = true;
```

## Consultas Úteis

### Ver todas as regras de seleção:
```sql
SELECT id, instance_id, rule_name, enabled, config
FROM blindage_rules
WHERE rule_type = 'instance_selection';
```

### Ver quais instâncias estão selecionadas:
```sql
SELECT 
  br.id,
  br.instance_id,
  br.config->>'selected_instance_ids' as selected_ids,
  br.config->>'max_simultaneous' as max_simultaneous
FROM blindage_rules br
WHERE br.rule_type = 'instance_selection'
  AND br.enabled = true;
```

### Contar quantas instâncias estão selecionadas:
```sql
SELECT 
  id,
  jsonb_array_length(config->'selected_instance_ids') as total_selected
FROM blindage_rules
WHERE rule_type = 'instance_selection';
```

## Resumo

✅ **A seleção de instâncias é gravada no banco** através do campo `config` (JSONB) da tabela `blindage_rules`

✅ **O campo `selected_instance_ids`** armazena um array com os IDs das instâncias selecionadas

✅ **Quando uma instância cai**, o sistema automaticamente ignora ela e usa outra das selecionadas

✅ **Se `selected_instance_ids` estiver vazio**, o sistema usa todas as instâncias conectadas

✅ **A configuração é persistente** e sobrevive a reinicializações do sistema
