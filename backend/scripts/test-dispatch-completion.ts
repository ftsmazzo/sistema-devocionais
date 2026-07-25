/**
 * Teste seco: conclusão de dispatch e contadores de itens (sem Evolution / sem envio).
 *
 *   npx tsx scripts/test-dispatch-completion.ts
 */
import { evaluateDispatchCompletion } from '../src/services/dispatchItems';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Caso do bug: 3 elegíveis (total_contacts=3), só 1 item terminal → NÃO conclui
{
  const r = evaluateDispatchCompletion({
    totalContacts: 3,
    itemsTotal: 1,
    openCount: 0,
    terminalCount: 1,
  });
  assert(!r.canComplete, 'deveria bloquear conclusão com items < total_contacts');
  assert(!!r.reason && r.reason.includes('insuficientes'), `reason inesperada: ${r.reason}`);
}

// 1 item processado, 2 ainda pendentes → NÃO conclui
{
  const r = evaluateDispatchCompletion({
    totalContacts: 3,
    itemsTotal: 3,
    openCount: 2,
    terminalCount: 1,
  });
  assert(!r.canComplete, 'deveria bloquear com itens abertos');
}

// 3 terminais de 3 → conclui
{
  const r = evaluateDispatchCompletion({
    totalContacts: 3,
    itemsTotal: 3,
    openCount: 0,
    terminalCount: 3,
  });
  assert(r.canComplete, 'deveria concluir com 3/3 terminais');
}

// completed cedo: 0 abertos mas terminais < esperado
{
  const r = evaluateDispatchCompletion({
    totalContacts: 3,
    itemsTotal: 3,
    openCount: 0,
    terminalCount: 2,
  });
  assert(!r.canComplete, 'deveria bloquear terminais < total_contacts');
}

console.log('SUCESSO: regras de conclusão de dispatch (3 elegíveis / 1 item) OK — sem Evolution.');
