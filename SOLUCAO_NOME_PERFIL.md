# 🔧 Solução: Nome "Devocional Diário" não Aparece

## ⚠️ REALIDADE

**A Evolution API NÃO suporta atualização de perfil via API.**

Não existe essa opção no Manager e não há endpoint funcional para isso.

## ✅ ÚNICA SOLUÇÃO: vCard Automático

A **única forma** de fazer o nome aparecer é através do **vCard**, que já está implementado e **ativado por padrão**.

### Como Funciona:

1. **Primeiro envio** para um contato novo
2. **Sistema envia vCard automaticamente** ✅
3. **Destinatário recebe cartão de contato**
4. **Destinatário salva o contato** (1 clique)
5. **Próximas mensagens** aparecem com o nome ✅

### Configuração:

No `.env` (já está ativado por padrão):
```env
SEND_VCARD_TO_NEW_CONTACTS=true
```

---

## 📝 Sobre o Nome do Perfil

O nome que aparece no WhatsApp é o **nome da conta WhatsApp Business** conectada à instância. Esse nome:

- ❌ **NÃO** pode ser alterado via API
- ❌ **NÃO** há opção no Evolution API Manager
- ✅ **PODE** ser alterado no WhatsApp (Configurações → Perfil)
- ✅ **MAS** mesmo assim, destinatários precisam salvar seu número para ver o nome

**Por isso o vCard é essencial!**

---

## 🎯 Resumo

1. **vCard está ativado por padrão** ✅
2. **Funciona automaticamente** para novos contatos ✅
3. **Não precisa fazer nada** além de garantir que está no `.env` ✅

**O sistema já está configurado corretamente!** 🚀

