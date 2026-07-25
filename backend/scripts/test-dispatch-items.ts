/**
 * Teste seco de dispatch_items: criação, idempotência e status.
 * NÃO chama Evolution / sendText.
 *
 * Uso (com DATABASE_URL):
 *   npx tsx scripts/test-dispatch-items.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { pool, initializeDatabase } from '../src/database';
import {
  ensureDispatchItem,
  getDispatchItemsSummary,
  isDispatchItemSent,
  markDispatchItemFailed,
  markDispatchItemProcessing,
  markDispatchItemSent,
  markDispatchItemSkipped,
} from '../src/services/dispatchItems';

const TEST_NUMBER = '5500000000001';

async function main() {
  await initializeDatabase();

  const dispatchResult = await pool.query(
    `INSERT INTO dispatches (name, message_template, dispatch_type, status, total_contacts)
     VALUES ($1, $2, 'marketing', 'pending', 1)
     RETURNING id`,
    ['[test] dispatch_items dry-run', '[test] sem envio real']
  );
  const dispatchId = dispatchResult.rows[0].id as number;

  try {
    const a = await ensureDispatchItem({
      dispatchId,
      contactNumber: TEST_NUMBER,
      contactName: 'Teste Idempotente',
      messageType: 'marketing',
      messageSnapshot: 'snapshot de teste (não enviado)',
      maxAttempts: 1,
    });

    const b = await ensureDispatchItem({
      dispatchId,
      contactNumber: TEST_NUMBER,
      contactName: 'Teste Idempotente',
      messageType: 'marketing',
      messageSnapshot: 'snapshot atualizado',
    });

    if (a.id !== b.id) {
      throw new Error(`FALHA idempotência: ids diferentes ${a.id} vs ${b.id}`);
    }
    console.log('OK: ensureDispatchItem reutiliza o mesmo id');

    if (await isDispatchItemSent(dispatchId, TEST_NUMBER)) {
      throw new Error('FALHA: item não deveria estar sent ainda');
    }

    const processing = await markDispatchItemProcessing(a.id);
    if (!processing || processing.status !== 'processing') {
      throw new Error('FALHA: markDispatchItemProcessing');
    }
    console.log('OK: processing');

    await markDispatchItemSent({
      itemId: a.id,
      providerMessageId: 'dry-run-msg-id',
    });

    if (!(await isDispatchItemSent(dispatchId, TEST_NUMBER))) {
      throw new Error('FALHA: item deveria estar sent');
    }
    console.log('OK: sent + isDispatchItemSent');

    // Re-ensure após sent não deve alterar status
    const afterSent = await ensureDispatchItem({
      dispatchId,
      contactNumber: TEST_NUMBER,
      messageSnapshot: 'não deve sobrescrever sent',
    });
    if (afterSent.status !== 'sent') {
      throw new Error(`FALHA: status após ensure em sent = ${afterSent.status}`);
    }
    console.log('OK: ensure após sent preserva status');

    // markProcessing em sent não deve sobrescrever
    const noOverwrite = await markDispatchItemProcessing(a.id);
    if (noOverwrite !== null) {
      throw new Error('FALHA: processing não deveria sobrescrever sent');
    }
    console.log('OK: processing não sobrescreve sent');

    // Segundo número: failed / skipped
    const other = await ensureDispatchItem({
      dispatchId,
      contactNumber: '5500000000002',
      contactName: 'Outro',
      messageType: 'marketing',
    });
    await markDispatchItemFailed({
      itemId: other.id,
      errorMessage: 'erro simulado',
      errorCategory: 'test',
      asPendingRetry: true,
    });
    const skipped = await ensureDispatchItem({
      dispatchId,
      contactNumber: '5500000000003',
      contactName: 'Skip',
    });
    await markDispatchItemSkipped({ itemId: skipped.id, reason: 'teste skip' });

    const summary = await getDispatchItemsSummary(dispatchId);
    if (summary.total !== 3 || summary.sent !== 1 || summary.pending_retry !== 1 || summary.skipped !== 1) {
      throw new Error(`FALHA summary: ${JSON.stringify(summary)}`);
    }
    console.log('OK: summary', summary);

    // Unique constraint: contagem de linhas = 1 para o número principal
    const cnt = await pool.query(
      `SELECT COUNT(*)::int AS c FROM dispatch_items WHERE dispatch_id = $1 AND contact_number = $2`,
      [dispatchId, TEST_NUMBER]
    );
    if (cnt.rows[0].c !== 1) {
      throw new Error(`FALHA unique: ${cnt.rows[0].c} linhas`);
    }
    console.log('OK: unique(dispatch_id, contact_number)');

    console.log('SUCESSO: dispatch_items dry-run sem Evolution.');
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
