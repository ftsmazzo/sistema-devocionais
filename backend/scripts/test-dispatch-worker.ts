/**
 * Teste seco do DispatchWorker (PostgreSQL queue) sem Evolution.
 *
 * Uso (com DATABASE_URL):
 *   npx tsx scripts/test-dispatch-worker.ts
 *
 * Força REAL_SEND desligado e NÃO chama sendEvolutionTextSafely.
 */
import dotenv from 'dotenv';
dotenv.config();

// Flags ANTES de importar o worker (defaults já são false; reforçamos)
process.env.DISPATCH_WORKER_ENABLED = 'false';
process.env.DISPATCH_REAL_SEND_ENABLED = 'false';
process.env.DISPATCH_WORKER_BATCH_SIZE = '2';

import { pool, initializeDatabase } from '../src/database';
import { ensureDispatchItem } from '../src/services/dispatchItems';
import {
  claimDispatchItems,
  isDispatchRealSendEnabled,
  processClaimedDispatchItem,
  processDispatchWorkerTick,
} from '../src/services/dispatchWorker';

const NUM_A = '5500000000101';
const NUM_B = '5500000000102';

async function main() {
  if (isDispatchRealSendEnabled()) {
    throw new Error('ABORT: DISPATCH_REAL_SEND_ENABLED deve ser false neste teste');
  }

  await initializeDatabase();

  const dispatchResult = await pool.query(
    `INSERT INTO dispatches (name, message_template, dispatch_type, status, total_contacts)
     VALUES ($1, $2, 'marketing', 'running', 2)
     RETURNING id`,
    ['[test] dispatch_worker dry-run', '[test] sem envio real']
  );
  const dispatchId = dispatchResult.rows[0].id as number;

  try {
    const itemA = await ensureDispatchItem({
      dispatchId,
      contactNumber: NUM_A,
      contactName: 'Worker Test A',
      messageType: 'marketing',
      messageSnapshot: 'snapshot A — não enviar',
    });
    const itemB = await ensureDispatchItem({
      dispatchId,
      contactNumber: NUM_B,
      contactName: 'Worker Test B',
      messageType: 'marketing',
      messageSnapshot: 'snapshot B — não enviar',
    });

    console.log('Itens criados:', itemA.id, itemB.id);

    // Claim + process manual (1 item) — sem Evolution
    const claimed1 = await claimDispatchItems(1);
    if (claimed1.length !== 1) {
      throw new Error(`FALHA claim batch=1: got ${claimed1.length}`);
    }
    if (claimed1[0].status !== 'processing') {
      throw new Error(`FALHA: claim deveria deixar processing, got ${claimed1[0].status}`);
    }
    console.log('OK: claim FOR UPDATE SKIP LOCKED → processing');

    const r1 = await processClaimedDispatchItem(claimed1[0]);
    if (r1.realSendAttempted) {
      throw new Error('FALHA: realSendAttempted=true com REAL_SEND_DISABLED');
    }
    if (r1.outcome !== 'skipped') {
      throw new Error(`FALHA outcome esperado skipped, got ${r1.outcome}`);
    }

    const row1 = await pool.query(`SELECT status, error_message, lock_token FROM dispatch_items WHERE id = $1`, [
      claimed1[0].id,
    ]);
    if (row1.rows[0].status !== 'skipped' || row1.rows[0].error_message !== 'REAL_SEND_DISABLED') {
      throw new Error(`FALHA status/error: ${JSON.stringify(row1.rows[0])}`);
    }
    if (row1.rows[0].lock_token != null) {
      throw new Error('FALHA: lock deveria estar limpo');
    }
    console.log('OK: REAL_SEND_DISABLED → skipped + lock limpo');

    // Tick processa o restante (batch 2, 1 pending)
    const tick = await processDispatchWorkerTick(2);
    if (tick.claimed < 1) {
      throw new Error('FALHA: tick deveria claimar o segundo item');
    }
    if (tick.results.some((x) => x.realSendAttempted)) {
      throw new Error('FALHA: tick tentou envio real');
    }
    if (!tick.results.every((x) => x.outcome === 'skipped')) {
      throw new Error(`FALHA tick outcomes: ${JSON.stringify(tick.results)}`);
    }
    console.log('OK: processDispatchWorkerTick sem Evolution');

    const left = await pool.query(
      `SELECT COUNT(*)::int AS c FROM dispatch_items
       WHERE dispatch_id = $1 AND status IN ('pending', 'pending_retry', 'processing')`,
      [dispatchId]
    );
    if (left.rows[0].c !== 0) {
      throw new Error(`FALHA: ainda há itens abertos: ${left.rows[0].c}`);
    }

    // SKIP LOCKED: claim vazio após processar
    const empty = await claimDispatchItems(5);
    if (empty.length !== 0) {
      throw new Error('FALHA: claim deveria retornar vazio');
    }
    console.log('OK: fila vazia após processamento seco');

    console.log('SUCESSO: dispatch worker dry-run sem Evolution.');
  } finally {
    await pool.query(`DELETE FROM dispatches WHERE id = $1`, [dispatchId]);
    await pool.end();
  }
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
