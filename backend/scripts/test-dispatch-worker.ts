/**
 * Legacy script — prefer test-dispatch-worker-pipeline.ts (subetapa 04).
 * Mantido: dry-run reversível sem Evolution.
 */
import dotenv from 'dotenv';
dotenv.config();

process.env.DISPATCH_WORKER_ENABLED = 'true';
process.env.DISPATCH_REAL_SEND_ENABLED = 'false';
process.env.DISPATCH_DRY_RUN_ENABLED = 'true';

import { pool, initializeDatabase } from '../src/database';
import { ensureDispatchItem } from '../src/services/dispatchItems';
import { processDispatchWorkerTick } from '../src/services/dispatchWorker';

async function main() {
  await initializeDatabase();
  const r = await pool.query(
    `INSERT INTO dispatches (name, message_template, dispatch_type, status, total_contacts)
     VALUES ('[test] legacy dry', 'x', 'marketing', 'running', 1) RETURNING id`
  );
  const id = r.rows[0].id;
  try {
    await ensureDispatchItem({
      dispatchId: id,
      contactNumber: '5500000000999',
      messageSnapshot: 'test',
      messageType: 'marketing',
    });
    const tick = await processDispatchWorkerTick(1);
    if (tick.results.some((x) => x.realSendAttempted || x.outcome === 'sent')) {
      throw new Error('envio real detectado');
    }
    console.log('OK', tick);
  } finally {
    await pool.query(`DELETE FROM dispatches WHERE id = $1`, [id]);
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
