/**
 * Teste seco da política operacional do worker (sem Evolution).
 *   npm run test:worker-policy
 */
import { evaluateOperationalPolicy } from '../src/services/workerConfigSnapshot';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// 1) real + dry → invalid
{
  const r = evaluateOperationalPolicy({
    workerEnabled: true,
    realSendEnabled: true,
    dryRunEnabled: true,
    waValidateOnPrepare: true,
    waValidateOnWorker: false,
    pendingWhatsAppCount: 0,
    allCurrentContactsValidated: true,
  });
  assert(r.operational_mode === 'invalid_config', 'cenário 1: esperava invalid_config');
  assert(r.blocking_reasons.some((x) => x.code === 'REAL_SEND_AND_DRY_RUN_ENABLED'), 'cenário 1: motivo');
  assert(!r.can_send_real, 'cenário 1: não pode enviar real');
}

// 2) real + WA off + pendentes → blocked
{
  const r = evaluateOperationalPolicy({
    workerEnabled: true,
    realSendEnabled: true,
    dryRunEnabled: false,
    waValidateOnPrepare: false,
    waValidateOnWorker: false,
    pendingWhatsAppCount: 2,
    allCurrentContactsValidated: false,
  });
  assert(r.operational_mode === 'blocked', 'cenário 2: esperava blocked');
  assert(r.blocking_reasons.some((x) => x.code === 'WHATSAPP_VALIDATION_REQUIRED'), 'cenário 2: WA required');
  assert(!r.can_send_real, 'cenário 2');
}

// 3) dry-run → simulation
{
  const r = evaluateOperationalPolicy({
    workerEnabled: true,
    realSendEnabled: false,
    dryRunEnabled: true,
    waValidateOnPrepare: false,
    waValidateOnWorker: false,
    pendingWhatsAppCount: 1,
    allCurrentContactsValidated: false,
  });
  assert(r.operational_mode === 'dry_run', 'cenário 3: dry_run');
  assert(!r.can_send_real, 'cenário 3');
}

// 4) real + WA on → ready
{
  const r = evaluateOperationalPolicy({
    workerEnabled: true,
    realSendEnabled: true,
    dryRunEnabled: false,
    waValidateOnPrepare: true,
    waValidateOnWorker: false,
    pendingWhatsAppCount: 0,
    allCurrentContactsValidated: true,
    hasConnectedInstance: true,
  });
  assert(r.operational_mode === 'real_send', 'cenário 4: real_send');
  assert(r.can_send_real, 'cenário 4');
}

// 5) real + WA off → blocked (mesmo com todos validados)
{
  const r = evaluateOperationalPolicy({
    workerEnabled: true,
    realSendEnabled: true,
    dryRunEnabled: false,
    waValidateOnPrepare: false,
    waValidateOnWorker: false,
    pendingWhatsAppCount: 0,
    allCurrentContactsValidated: true,
    hasConnectedInstance: true,
  });
  assert(r.operational_mode === 'blocked', 'cenário 5: esperava blocked sem validação WA');
  assert(r.blocking_reasons.some((x) => x.code === 'WHATSAPP_VALIDATION_REQUIRED'), 'cenário 5: WA required');
  assert(!r.can_send_real, 'cenário 5');
}

console.log('SUCESSO: política operacional do worker (5 cenários) OK — sem Evolution.');
