/**
 * Teste seco (sem DB / sem Evolution): classificação pendente vs inválido confirmado.
 *   npx tsx scripts/test-list-audience-classify.ts
 *
 * Integração completa com Postgres:
 *   npx tsx scripts/test-list-audience-resolver.ts
 */
import {
  isConfirmedWhatsAppInvalid,
  isPendingWhatsAppValidation,
  type AudienceContact,
} from '../src/services/listAudienceResolver';

function contact(partial: Partial<AudienceContact> & Pick<AudienceContact, 'id'>): AudienceContact {
  return {
    phone_number: '5511999999999',
    name: 't',
    opt_in: true,
    opt_out: false,
    whatsapp_validated: null,
    whatsapp_validated_at: null,
    ...partial,
  };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const pending = contact({ id: 1, whatsapp_validated: false, whatsapp_validated_at: null });
const pendingNull = contact({ id: 2, whatsapp_validated: null, whatsapp_validated_at: null });
const eligible = contact({
  id: 3,
  whatsapp_validated: true,
  whatsapp_validated_at: new Date().toISOString(),
});
const confirmedInvalid = contact({
  id: 4,
  whatsapp_validated: false,
  whatsapp_validated_at: new Date().toISOString(),
});

assert(isPendingWhatsAppValidation(pending), 'false sem at = pendente');
assert(isPendingWhatsAppValidation(pendingNull), 'null = pendente');
assert(!isConfirmedWhatsAppInvalid(pending), 'pendente não é inválido confirmado');
assert(isConfirmedWhatsAppInvalid(confirmedInvalid), 'false+at = inválido confirmado');
assert(!isPendingWhatsAppValidation(confirmedInvalid), 'inválido confirmado não é pendente');
assert(!isPendingWhatsAppValidation(eligible), 'true não é pendente');
assert(!isConfirmedWhatsAppInvalid(eligible), 'true não é inválido');

console.log('SUCESSO: classificação pendente vs inválido confirmado OK (sem envio / sem DB).');
