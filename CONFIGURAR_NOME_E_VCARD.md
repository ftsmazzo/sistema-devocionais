# Como Configurar Nome e vCard Automático

## ✅ TUDO AUTOMÁTICO AGORA!

O sistema agora configura **automaticamente** tudo que você precisa:

1. **Perfil (Nome)**: Configurado automaticamente na inicialização E antes de cada envio
2. **vCard**: Enviado automaticamente para novos contatos (se ativado)

## ⚙️ Configuração no `.env`

### Ativar vCard Automático (Recomendado)

No arquivo `.env` do EasyPanel, adicione ou altere:

```env
# Enviar vCard automaticamente para novos contatos (ATIVADO POR PADRÃO)
SEND_VCARD_TO_NEW_CONTACTS=true
```

**Isso é tudo!** O sistema faz o resto automaticamente.

---

## 🔧 Como Funciona (Automático)

### 1. Configuração do Perfil (Nome)

O sistema configura automaticamente:
- **Na inicialização**: Tenta configurar o perfil de todas as instâncias
- **Antes de cada envio**: Verifica e configura o perfil se necessário
- **Cache inteligente**: Não tenta configurar toda hora (apenas se necessário)

Você **NÃO precisa fazer nada manualmente**!

### 2. Envio Automático de vCard

Para que os contatos sejam salvos automaticamente quando receberem a primeira mensagem:

#### No arquivo `.env` (EasyPanel):
```env
# Enviar vCard automaticamente para novos contatos
SEND_VCARD_TO_NEW_CONTACTS=true

# Enviar mensagem pedindo para salvar contato (opcional)
SEND_CONTACT_REQUEST=false
```

#### O que cada opção faz:

- **`SEND_VCARD_TO_NEW_CONTACTS=true`**: 
  - Envia automaticamente um vCard (cartão de contato) para novos contatos
  - O vCard permite que o destinatário salve seu contato facilmente
  - Só envia no primeiro envio para cada contato

- **`SEND_CONTACT_REQUEST=false`**: 
  - Se `true`, envia uma mensagem de texto pedindo para salvar o contato
  - Geralmente não é necessário se o vCard estiver ativado

### 3. Como Funciona (Detalhes Técnicos)

1. **Na inicialização**: O sistema tenta configurar o perfil de todas as instâncias automaticamente
2. **Antes de cada envio**: O sistema verifica e configura o perfil se necessário (cache de 1 hora)
3. **Ao enviar mensagem**: Se `SEND_VCARD_TO_NEW_CONTACTS=true` e é o primeiro envio para aquele contato, o vCard é enviado automaticamente
4. **Obtenção do número**: O sistema tenta obter o número da instância automaticamente via health check

### 4. Verificar se Está Funcionando (Opcional)

#### Verificar status das instâncias:
```bash
GET https://seu-dominio.com/api/notifications/instances
```

#### Verificar debug completo:
```bash
GET https://seu-dominio.com/api/notifications/instances/debug
```

### 5. Troubleshooting

#### Nome não aparece mesmo após configurar:
- Verifique se a instância está conectada no Evolution API Manager
- Tente configurar manualmente via API: `POST /api/notifications/instances/{nome}/setup-profile`
- Verifique os logs para erros

#### vCard não está sendo enviado:
- Verifique se `SEND_VCARD_TO_NEW_CONTACTS=true` no `.env`
- Reinicie o aplicativo após alterar o `.env`
- Verifique se é realmente o primeiro envio para aquele contato
- Verifique os logs para mensagens de erro

#### Estado "unknown" na instância:
- Isso é normal! O sistema funciona mesmo com estado "unknown"
- Se a mensagem foi enviada com sucesso, a instância será marcada como ACTIVE automaticamente
- O health check pode não conseguir determinar o estado, mas isso não impede o envio

### 6. Exemplo de Configuração Completa no `.env`

```env
# Multi-Instância Evolution API
EVOLUTION_INSTANCES=[{"name":"Devocional-1","api_url":"https://seu-evolution-api.com","api_key":"sua-key","display_name":"Devocional Diário","max_messages_per_hour":20,"max_messages_per_day":200,"priority":1,"enabled":true}]

EVOLUTION_DISPLAY_NAME=Devocional Diário
EVOLUTION_INSTANCE_STRATEGY=round_robin

# Ativar vCard automático (JÁ ESTÁ ATIVADO POR PADRÃO)
SEND_VCARD_TO_NEW_CONTACTS=true
SEND_CONTACT_REQUEST=false
```

### 7. Teste Rápido

1. Configure o `.env` com `SEND_VCARD_TO_NEW_CONTACTS=true` (ou deixe padrão)
2. Reinicie o aplicativo
3. Envie uma mensagem de teste para um número novo
4. O sistema configurará o perfil automaticamente antes de enviar
5. O vCard será enviado automaticamente se for o primeiro envio

## Notas Importantes

- ✅ **Tudo é automático**: Você não precisa fazer nada manualmente
- ✅ **Perfil configurado automaticamente**: Na inicialização e antes de cada envio
- ✅ **vCard automático**: Enviado para novos contatos (primeiro envio)
- ⚠️ O nome do perfil só pode ser configurado se a instância estiver conectada no WhatsApp
- ⚠️ O vCard só é enviado para contatos que ainda não receberam nenhuma mensagem (total_sent == 0)
- ⚠️ O número da instância é obtido automaticamente, mas pode levar alguns segundos na primeira vez
- ⚠️ Se o número não estiver disponível, o vCard será enviado na próxima vez que o health check conseguir obtê-lo

## 🎯 Resumo

**Você só precisa:**
1. Configurar `SEND_VCARD_TO_NEW_CONTACTS=true` no `.env` (já está ativado por padrão)
2. Reiniciar o aplicativo
3. Enviar mensagens normalmente

**O sistema faz o resto automaticamente!** 🚀

