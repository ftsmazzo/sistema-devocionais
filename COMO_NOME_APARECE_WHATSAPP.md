# 📱 Como Fazer o Nome Aparecer no WhatsApp

## ⚠️ REALIDADE IMPORTANTE

**A Evolution API NÃO permite alterar o nome do perfil via API.**

O nome que aparece no WhatsApp é o **nome da conta WhatsApp Business** que está conectada à instância. Esse nome só pode ser alterado:

1. **Diretamente no WhatsApp** (no celular/navegador onde a conta está conectada)
2. **Quando você conecta a conta** pela primeira vez

## ✅ SOLUÇÃO: vCard Automático

A **única forma garantida** de fazer o nome aparecer é através do **vCard** (cartão de contato), que já está implementado e ativado por padrão.

### Como Funciona:

1. **Primeiro envio** para um contato novo
2. **Sistema envia vCard automaticamente** (se `SEND_VCARD_TO_NEW_CONTACTS=true`)
3. **Destinatário recebe o cartão de contato**
4. **Destinatário salva o contato** (1 clique)
5. **Próximas mensagens** aparecem com o nome "Devocional Diário" ✅

### Configuração:

No `.env`:
```env
SEND_VCARD_TO_NEW_CONTACTS=true
```

**Já está ativado por padrão!** ✅

## 🎯 Resumo

- ❌ **NÃO** é possível alterar nome via API
- ❌ **NÃO** há opção no Evolution API Manager
- ✅ **SIM**, o vCard resolve o problema automaticamente
- ✅ **SIM**, está ativado por padrão

## 📝 Nota Técnica

O nome que aparece no WhatsApp vem da conta WhatsApp Business conectada. Se você quiser alterar esse nome:

1. Abra o WhatsApp no celular/navegador onde a conta está conectada
2. Vá em **Configurações** → **Perfil**
3. Altere o nome para "Devocional Diário"
4. Salve

Mas mesmo assim, **o vCard é necessário** para que novos contatos vejam o nome (eles precisam salvar seu número primeiro).

---

**Conclusão: Use o vCard automático. É a solução que funciona! 🚀**

