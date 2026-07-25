/**
 * Subetapa 04 — validação seca do worker como caminho único (sem Evolution).
 *
 * Cenário A (dry-run):
 *   DISPATCH_WORKER_ENABLED=true
 *   DISPATCH_REAL_SEND_ENABLED=false
 *   DISPATCH_DRY_RUN_ENABLED=true
 *
 * Cenário B (config insegura):
 *   DISPATCH_WORKER_ENABLED=false → assertDispatchPipelineAllowed deve falhar
 *
 * Uso:
 *   npx tsx scripts/test-dispatch-worker-pipeline.ts
 */
import dotenv from 'dotenv';
dotenv.config();

process.env.DISPATCH_WORKER_ENABLED = 'true';
process.env.DISPATCH_REAL_SEND_ENABLED = 'false';
process.env.DISPATCH_DRY_RUN_ENABLED = 'true';
process.env.DISPATCH_WORKER_BATCH_SIZE = '5';

import { pool, initializeDatabase } from '../src/database';
import { ensureDispatchItem } from '../src/services/dispatchItems';
import {
  claimDispatchItems,
  processClaimedDispatchItem,
  processDispatchWorkerTick,
} from '../src/services/dispatchWorker';
import {
  assertDispatchPipelineAllowed,
  DispatchOperationalError,
} from '../src/services/dispatchRuntimeConfig';

const NUM_A = '5500000000201';
const NUM_B = '5500000000202';

async function testUnsafeConfigBlock() {
  const prev = process.env.DISPATCH_WORKER_ENABLED;
  process.env.DISPATCH_WORKER_ENABLED = 'false';
  let blocked = false;
  try {
    assertDispatchPipelineAllowed();
  } catch (e: any) {
    if (e instanceof DispatchOperationalError) {
      blocked = true;
      console.log('OK: bloqueio com worker off —', e.message.slice(0, 80));
    } else {
      throw e;
    }
  }
  process.env.DISPATCH_WORKER_ENABLED = prev;
  if (!blocked) throw new Error('FALHA: deveria bloquear com WORKER_ENABLED=false');
}

async function testDryRunPipeline() {
  assertDispatchPipelineAllowed();

  const dispatchResult = await pool.query(
    `INSERT INTO dispatches (name, message_template, dispatch_type, status, total_contacts)
     VALUES ($1, $2, 'marketing', 'running', 2)
     RETURNING id`,
    ['[test] worker pipeline dry-run', '[test] sem envio']
  );
  const dispatchId = dispatchResult.rows[0].id as number;

  try {
    await ensureDispatchItem({
      dispatchId,
      contactNumber: NUM_A,
      contactName: 'A',
      messageType: 'marketing',
      messageSnapshot: 'msg A',
    });
    await ensureDispatchItem({
      dispatchId,
      contactNumber: NUM_B,
      contactName: 'B',
      messageType: 'marketing',
      messageSnapshot: 'msg B',
    });

    const tick = await processDispatchWorkerTick(5);
    if (tick.claimed < 1) throw new Error('FALHA: tick não claimou itens');
    if (tick.results.some((r) => r.realSendAttempted)) {
      throw new Error('FALHA: Evolution foi chamada');
    }
    if (!tick.results.every((r) => r.outcome === 'dry_run')) {
      throw new Error(`FALHA outcomes: ${JSON.stringify(tick.results)}`);
    }

    const rows = await pool.query(
      `SELECT status, error_message, error_category FROM dispatch_items WHERE dispatch_id = $1`,
      [dispatchId]
    );
    for (const row of rows.rows) {
      if (row.status === 'sent') throw new Error('FALHA: dry-run não pode marcar sent');
      if (row.status !== 'pending') throw new Error(`FALHA status reversível: ${row.status}`);
      if (row.error_message !== 'DRY_RUN') throw new Error(`FALHA error_message: ${row.error_message}`);
      if (row.error_category !== 'dry_run') throw new Error(`FALHA category: ${row.error_category}`);
    }
    console.log('OK: dry-run — pending + DRY_RUN (reversível), sem Evolution');

    // claim vazio (backoff)
    const empty = await claimDispatchItems(5);
    if (empty.length !== 0) {
      throw new Error('FALHA: após dry-run com backoff, claim deveria estar vazio');
    }
    console.log('OK: backoff impede reprocessamento imediato');
  } finally {
    await pool.query(`DELETE FROM dispatches WHERE id = $1`, [dispatchId]);
  }
}

async function main() {
  await initializeDatabase();
  await testUnsafeConfigBlock();
  await testDryRunPipeline();
  console.log('SUCESSO: pipeline worker-only dry-run + bloqueio de config.');
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
