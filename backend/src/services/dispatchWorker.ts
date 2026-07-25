/**
 * Worker interno de dispatch_items via PostgreSQL (FOR UPDATE SKIP LOCKED).
 * Sem BullMQ/Redis. Desligado por default; envio real desligado por default.
 */
import { randomBytes } from 'crypto';
import { pool } from '../database';
import { addLog } from '../routes/logs';
import {
  EvolutionSafeSendError,
  maskPhone,
  sendEvolutionTextSafely,
} from './evolutionSafeSender';
import {
  DispatchItemRow,
  isDispatchItemSent,
  markDispatchItemFailed,
  markDispatchItemSent,
  markDispatchItemSkipped,
  syncDispatchContactStatus,
} from './dispatchItems';
import { isInstanceConnectivityError } from './dispatchRetry';

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultValue;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function isDispatchWorkerEnabled(): boolean {
  return envFlag('DISPATCH_WORKER_ENABLED', false);
}

export function isDispatchRealSendEnabled(): boolean {
  return envFlag('DISPATCH_REAL_SEND_ENABLED', false);
}

export function getDispatchWorkerBatchSize(): number {
  return envInt('DISPATCH_WORKER_BATCH_SIZE', 1);
}

export function getDispatchWorkerIntervalMs(): number {
  return envInt('DISPATCH_WORKER_INTERVAL_MS', 30_000);
}

const LOCK_TTL_MS = 5 * 60_000;

let workerTimer: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;

/**
 * Reserva até `limit` itens elegíveis com lock transacional.
 * Exportado para testes secos.
 */
export async function claimDispatchItems(
  limit: number = getDispatchWorkerBatchSize(),
  lockTtlMs: number = LOCK_TTL_MS
): Promise<DispatchItemRow[]> {
  const client = await pool.connect();
  const lockToken = randomBytes(16).toString('hex');
  try {
    await client.query('BEGIN');

    const selected = await client.query(
      `SELECT di.id
       FROM dispatch_items di
       INNER JOIN dispatches d ON d.id = di.dispatch_id
       WHERE di.status IN ('pending', 'pending_retry')
         AND (di.next_retry_at IS NULL OR di.next_retry_at <= CURRENT_TIMESTAMP)
         AND (di.lock_expires_at IS NULL OR di.lock_expires_at < CURRENT_TIMESTAMP)
         AND d.status IN ('running', 'pending')
       ORDER BY
         CASE WHEN di.status = 'pending_retry' THEN 0 ELSE 1 END,
         di.id ASC
       FOR UPDATE OF di SKIP LOCKED
       LIMIT $1`,
      [limit]
    );

    if (selected.rows.length === 0) {
      await client.query('COMMIT');
      return [];
    }

    const ids = selected.rows.map((r: { id: number }) => r.id);
    const updated = await client.query(
      `UPDATE dispatch_items
       SET status = 'processing',
           lock_token = $2,
           locked_at = CURRENT_TIMESTAMP,
           lock_expires_at = CURRENT_TIMESTAMP + ($3::text || ' milliseconds')::interval,
           started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
           attempt_count = COALESCE(attempt_count, 0) + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1::int[])
       RETURNING *`,
      [ids, lockToken, String(lockTtlMs)]
    );

    await client.query('COMMIT');
    return updated.rows as DispatchItemRow[];
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function clearItemLock(itemId: number): Promise<void> {
  await pool.query(
    `UPDATE dispatch_items
     SET lock_token = NULL,
         locked_at = NULL,
         lock_expires_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [itemId]
  );
}

async function resolveSendInstanceId(preferred?: number | null): Promise<number | null> {
  if (preferred) {
    const pref = await pool.query(
      `SELECT id FROM instances WHERE id = $1 AND status = 'connected' LIMIT 1`,
      [preferred]
    );
    if (pref.rows[0]) return pref.rows[0].id;
  }
  const any = await pool.query(
    `SELECT id FROM instances
     WHERE status = 'connected'
     ORDER BY last_message_sent_at ASC NULLS FIRST
     LIMIT 1`
  );
  return any.rows[0]?.id ?? null;
}

async function bumpDispatchCounters(
  dispatchId: number,
  kind: 'success' | 'failed'
): Promise<void> {
  if (kind === 'success') {
    await pool.query(
      `UPDATE dispatches
       SET contacts_success = COALESCE(contacts_success, 0) + 1,
           contacts_processed = COALESCE(contacts_processed, 0) + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [dispatchId]
    );
  } else {
    await pool.query(
      `UPDATE dispatches
       SET contacts_failed = COALESCE(contacts_failed, 0) + 1,
           contacts_processed = COALESCE(contacts_processed, 0) + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [dispatchId]
    );
  }
}

async function getDispatchStatus(dispatchId: number): Promise<string | null> {
  const r = await pool.query(`SELECT status FROM dispatches WHERE id = $1`, [dispatchId]);
  return r.rows[0]?.status ?? null;
}

/**
 * Processa um item já claimado (status processing + lock).
 * Se DISPATCH_REAL_SEND_ENABLED=false: marca skipped com REAL_SEND_DISABLED (sem Evolution).
 * Escolha: skipped (não pending) para evitar reprocessamento infinito a cada tick.
 */
export async function processClaimedDispatchItem(item: DispatchItemRow): Promise<{
  outcome: 'sent' | 'skipped' | 'failed' | 'pending_retry' | 'noop';
  realSendAttempted: boolean;
}> {
  const dispatchStatus = await getDispatchStatus(item.dispatch_id);
  if (!dispatchStatus || !['running', 'pending'].includes(dispatchStatus)) {
    await markDispatchItemSkipped({
      itemId: item.id,
      reason: `Dispatch inativo (status=${dispatchStatus || 'missing'})`,
    });
    await clearItemLock(item.id);
    return { outcome: 'skipped', realSendAttempted: false };
  }

  if (await isDispatchItemSent(item.dispatch_id, item.contact_number)) {
    await markDispatchItemSent({ itemId: item.id });
    await clearItemLock(item.id);
    return { outcome: 'noop', realSendAttempted: false };
  }

  // Re-check row status in case another path already sent
  const fresh = await pool.query(`SELECT status FROM dispatch_items WHERE id = $1`, [item.id]);
  if (fresh.rows[0]?.status === 'sent') {
    await clearItemLock(item.id);
    return { outcome: 'noop', realSendAttempted: false };
  }

  if (!isDispatchRealSendEnabled()) {
    await markDispatchItemSkipped({
      itemId: item.id,
      reason: 'REAL_SEND_DISABLED',
    });
    // Garantir mensagem canônica pedida na subetapa
    await pool.query(
      `UPDATE dispatch_items
       SET error_message = 'REAL_SEND_DISABLED',
           error_category = 'real_send_disabled',
           lock_token = NULL,
           locked_at = NULL,
           lock_expires_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [item.id]
    );
    addLog(
      'info',
      `[DispatchWorker] Item ${item.id} skipped (REAL_SEND_DISABLED) ${maskPhone(item.contact_number)}`
    );
    return { outcome: 'skipped', realSendAttempted: false };
  }

  const text = item.message_snapshot;
  if (!text || !String(text).trim()) {
    await markDispatchItemFailed({
      itemId: item.id,
      errorMessage: 'message_snapshot vazio',
      errorCategory: 'invalid_payload',
    });
    await clearItemLock(item.id);
    await bumpDispatchCounters(item.dispatch_id, 'failed');
    return { outcome: 'failed', realSendAttempted: false };
  }

  const instanceId = await resolveSendInstanceId(item.instance_id);
  if (!instanceId) {
    await markDispatchItemFailed({
      itemId: item.id,
      errorMessage: 'Nenhuma instância conectada',
      errorCategory: 'instance_offline',
      asPendingRetry: true,
    });
    await syncDispatchContactStatus({
      dispatchId: item.dispatch_id,
      contactNumber: item.contact_number,
      contactName: item.contact_name,
      status: 'pending_retry',
      failedReason: 'Nenhuma instância conectada',
    });
    await clearItemLock(item.id);
    return { outcome: 'pending_retry', realSendAttempted: false };
  }

  try {
    const sendResult = await sendEvolutionTextSafely({
      instanceId,
      number: item.contact_number,
      text: String(text),
      messageType: item.message_type || 'avulsa',
      metadata: { dispatchId: item.dispatch_id, dispatchItemId: item.id, worker: true },
    });

    const msgResult = await pool.query(
      `INSERT INTO messages (
         instance_id, message_id, remote_jid, from_me,
         message_type, message_body, timestamp, status,
         dispatch_id, dispatch_type, contact_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        instanceId,
        sendResult.messageId,
        `${item.contact_number}@s.whatsapp.net`,
        true,
        'text',
        String(text),
        new Date(),
        'sent',
        item.dispatch_id,
        item.message_type || 'avulsa',
        item.contact_id,
      ]
    );

    await markDispatchItemSent({
      itemId: item.id,
      providerMessageId: sendResult.messageId,
      instanceId,
    });
    await syncDispatchContactStatus({
      dispatchId: item.dispatch_id,
      contactNumber: item.contact_number,
      contactName: item.contact_name,
      instanceId,
      status: 'sent',
      messageSentId: msgResult.rows[0].id,
    });
    await bumpDispatchCounters(item.dispatch_id, 'success');
    await clearItemLock(item.id);

    addLog(
      'success',
      `[DispatchWorker] Enviado item ${item.id} ${maskPhone(item.contact_number)} via instância ${instanceId}`
    );
    return { outcome: 'sent', realSendAttempted: true };
  } catch (error: any) {
    const connectivity =
      isInstanceConnectivityError(error) ||
      (error instanceof EvolutionSafeSendError &&
        ['provider_unavailable', 'timeout', 'network', 'instance_offline'].includes(error.kind));

    const asPendingRetry =
      connectivity && (item.attempt_count ?? 0) < (item.max_attempts ?? 1);

    await markDispatchItemFailed({
      itemId: item.id,
      errorMessage: error?.message || String(error),
      errorCategory: connectivity ? 'instance_offline' : 'send_error',
      instanceId,
      asPendingRetry,
    });
    await syncDispatchContactStatus({
      dispatchId: item.dispatch_id,
      contactNumber: item.contact_number,
      contactName: item.contact_name,
      instanceId,
      status: asPendingRetry ? 'pending_retry' : 'failed',
      failedReason: error?.message || String(error),
    });
    if (!asPendingRetry) {
      await bumpDispatchCounters(item.dispatch_id, 'failed');
    }
    await clearItemLock(item.id);

    addLog(
      'error',
      `[DispatchWorker] Falha item ${item.id} ${maskPhone(item.contact_number)}: ${(error?.message || '').slice(0, 200)}`
    );
    return {
      outcome: asPendingRetry ? 'pending_retry' : 'failed',
      realSendAttempted: true,
    };
  }
}

export interface WorkerTickResult {
  claimed: number;
  results: Array<{ itemId: number; outcome: string; realSendAttempted: boolean }>;
}

/**
 * Um tick do worker: claim + processa lote.
 * Seguro chamar em testes com DISPATCH_REAL_SEND_ENABLED=false.
 */
export async function processDispatchWorkerTick(
  batchSize: number = getDispatchWorkerBatchSize()
): Promise<WorkerTickResult> {
  const claimed = await claimDispatchItems(batchSize);
  const results: WorkerTickResult['results'] = [];

  for (const item of claimed) {
    try {
      const r = await processClaimedDispatchItem(item);
      results.push({
        itemId: item.id,
        outcome: r.outcome,
        realSendAttempted: r.realSendAttempted,
      });
    } catch (error: any) {
      addLog('error', `[DispatchWorker] Erro no item ${item.id}: ${(error?.message || '').slice(0, 200)}`);
      try {
        await markDispatchItemFailed({
          itemId: item.id,
          errorMessage: error?.message || String(error),
          errorCategory: 'worker_error',
        });
        await clearItemLock(item.id);
      } catch {
        /* ignore */
      }
      results.push({ itemId: item.id, outcome: 'failed', realSendAttempted: false });
    }
  }

  return { claimed: claimed.length, results };
}

export function startDispatchWorker(): void {
  if (workerTimer) {
    return;
  }
  const intervalMs = getDispatchWorkerIntervalMs();
  const batch = getDispatchWorkerBatchSize();
  const realSend = isDispatchRealSendEnabled();

  console.log(
    `⚙️ DispatchWorker LIGADO — interval=${intervalMs}ms batch=${batch} realSend=${realSend}`
  );
  addLog(
    'info',
    `[DispatchWorker] Iniciado interval=${intervalMs}ms batch=${batch} realSend=${realSend}`
  );

  const run = async () => {
    if (tickRunning) return;
    tickRunning = true;
    try {
      const tick = await processDispatchWorkerTick();
      if (tick.claimed > 0) {
        console.log(
          `[DispatchWorker] tick claimed=${tick.claimed} outcomes=${tick.results.map((r) => r.outcome).join(',')}`
        );
      }
    } catch (error: any) {
      console.error('[DispatchWorker] Erro no tick:', error?.message || error);
      addLog('error', `[DispatchWorker] Erro no tick: ${(error?.message || '').slice(0, 200)}`);
    } finally {
      tickRunning = false;
    }
  };

  // Primeiro tick após intervalo (não no boot imediato)
  workerTimer = setInterval(run, intervalMs);
  if (typeof workerTimer.unref === 'function') {
    workerTimer.unref();
  }
}

export function stopDispatchWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log('⚙️ DispatchWorker DESLIGADO');
  }
}
