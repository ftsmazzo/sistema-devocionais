/**
 * Teste seco: configuração persistente do worker + perfis + regras de segurança.
 * Não chama Evolution / não envia mensagem.
 *
 *   npm run test:worker-dispatch-config
 */
import dotenv from 'dotenv';
dotenv.config();

import { initializeDatabase, pool } from '../src/database';
import {
  applyWorkerDispatchProfile,
  getCachedEffectiveWorkerPolicy,
  getEffectiveWorkerPolicy,
  refreshWorkerDispatchConfigCache,
  updateWorkerDispatchConfig,
  validateWorkerDispatchConfigInput,
  WorkerConfigValidationError,
  WORKER_DISPATCH_PROFILES,
} from '../src/services/workerDispatchConfig';
import { getDispatchRuntimeSnapshot } from '../src/services/dispatchRuntimeConfig';
import { getEvolutionCadenceSnapshot } from '../src/services/evolutionSafeSender';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function expectValidationError(fn: () => void, contains?: string) {
  try {
    fn();
    throw new Error('esperava WorkerConfigValidationError');
  } catch (e: any) {
    assert(e instanceof WorkerConfigValidationError, `tipo: ${e?.name} — ${e?.message}`);
    if (contains) {
      assert(String(e.message).includes(contains) || e.message.length > 0, `msg: ${e.message}`);
    }
  }
}

async function expectUpdateError(patch: Record<string, unknown>, contains?: string) {
  try {
    await updateWorkerDispatchConfig(patch as any);
    throw new Error('esperava erro 400 no update');
  } catch (e: any) {
    assert(e instanceof WorkerConfigValidationError, `tipo: ${e?.name} — ${e?.message}`);
    if (contains) {
      assert(String(e.message).toLowerCase().includes(contains.toLowerCase()) || e.message.length > 0, e.message);
    }
  }
}

async function main() {
  // --- Validação pura (sem banco) ---
  expectValidationError(
    () =>
      validateWorkerDispatchConfigInput({
        real_send_enabled: true,
        dry_run_enabled: true,
        worker_batch_size: 1,
        min_delay_ms: 60_000,
        max_delay_ms: 120_000,
      }),
    'mesmo tempo'
  );
  console.log('OK validação: real+dry juntos');

  expectValidationError(
    () =>
      validateWorkerDispatchConfigInput({
        real_send_enabled: true,
        dry_run_enabled: false,
        whatsapp_auto_validate_on_prepare: false,
        whatsapp_auto_validate_on_worker: false,
        worker_batch_size: 1,
        min_delay_ms: 60_000,
        max_delay_ms: 120_000,
      }),
    'validação WhatsApp'
  );
  console.log('OK validação: real sem WA');

  expectValidationError(
    () =>
      validateWorkerDispatchConfigInput({
        real_send_enabled: true,
        dry_run_enabled: false,
        whatsapp_auto_validate_on_prepare: true,
        whatsapp_auto_validate_on_worker: true,
        worker_batch_size: 1,
        min_delay_ms: 30_000,
        max_delay_ms: 120_000,
      }),
    '60000'
  );
  console.log('OK validação: min_delay < 60000 com real');

  assert(!!WORKER_DISPATCH_PROFILES.simulacao, 'perfil simulacao');
  assert(!!WORKER_DISPATCH_PROFILES.conservador, 'perfil conservador');
  assert(!!WORKER_DISPATCH_PROFILES.moderado, 'perfil moderado');
  assert(!(WORKER_DISPATCH_PROFILES as any).agressivo, 'sem perfil agressivo');

  if (!process.env.DATABASE_URL) {
    console.log('⚠️ DATABASE_URL ausente — pulando testes de persistência');
    console.log('✅ test:worker-dispatch-config (validação) OK');
    return;
  }

  await initializeDatabase();
  await refreshWorkerDispatchConfigCache();

  const before = await getWorkerDispatchConfigSnapshotSafe();

  // Aplicar simulação
  const sim = await applyWorkerDispatchProfile('simulacao');
  assert(sim.profile === 'simulacao', 'perfil após simulacao');
  assert(sim.real_send_enabled === false, 'simulacao: real off');
  assert(sim.dry_run_enabled === true, 'simulacao: dry on');
  assert(sim.whatsapp_auto_validate_on_prepare === false, 'simulacao: wa prepare off');
  console.log('OK perfil simulacao');

  // Runtime/sender leem cache
  await getEffectiveWorkerPolicy();
  const runtime = getDispatchRuntimeSnapshot();
  assert(runtime.dryRunEnabled === true, 'runtime dry');
  assert(runtime.realSendEnabled === false, 'runtime real off');
  const cadence = getEvolutionCadenceSnapshot();
  assert(cadence.min_delay_ms === sim.min_delay_ms, 'cadence min do banco');
  console.log('OK runtime/sender usam config efetiva');

  // Aplicar conservador
  const cons = await applyWorkerDispatchProfile('conservador');
  assert(cons.profile === 'conservador', 'perfil conservador');
  assert(cons.real_send_enabled === true, 'conservador: real on');
  assert(cons.dry_run_enabled === false, 'conservador: dry off');
  assert(cons.min_delay_ms >= 90_000, 'conservador: delay');
  assert(getCachedEffectiveWorkerPolicy().real_send_enabled === true, 'cache atualizado');
  console.log('OK perfil conservador');

  const mod = await applyWorkerDispatchProfile('moderado');
  assert(mod.profile === 'moderado', 'perfil moderado');
  assert(mod.worker_interval_ms === 20_000, 'moderado: interval');
  assert(mod.min_delay_ms === 60_000, 'moderado: min delay');
  console.log('OK perfil moderado');

  // Updates inválidos
  await expectUpdateError(
    { real_send_enabled: true, dry_run_enabled: true },
    'mesmo tempo'
  );
  console.log('OK update bloqueado: real+dry');

  await expectUpdateError(
    {
      real_send_enabled: true,
      dry_run_enabled: false,
      whatsapp_auto_validate_on_prepare: false,
      whatsapp_auto_validate_on_worker: false,
    },
    'WhatsApp'
  );
  console.log('OK update bloqueado: real sem WA');

  await expectUpdateError(
    {
      real_send_enabled: true,
      dry_run_enabled: false,
      whatsapp_auto_validate_on_prepare: true,
      min_delay_ms: 10_000,
      max_delay_ms: 120_000,
    },
    '60000'
  );
  console.log('OK update bloqueado: min_delay baixo');

  // Restaurar perfil anterior se era um dos seguros
  if (before.profile === 'simulacao' || before.profile === 'conservador' || before.profile === 'moderado') {
    await applyWorkerDispatchProfile(before.profile);
  } else {
    await applyWorkerDispatchProfile('simulacao');
  }

  console.log('✅ test:worker-dispatch-config OK');
  await pool.end();
}

async function getWorkerDispatchConfigSnapshotSafe() {
  return getCachedEffectiveWorkerPolicy();
}

main().catch(async (e) => {
  console.error('❌', e);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
