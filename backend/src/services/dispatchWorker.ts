/**
 * Worker interno de dispatch_items via PostgreSQL (FOR UPDATE SKIP LOCKED).
 * Único caminho operacional de envio de campanha — chama sendEvolutionTextSafely.
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
  evaluateDispatchCompletion,
  getDispatchItemsSummary,
  isDispatchItemSent,
  markDispatchItemFailed,
  markDispatchItemSent,
  markDispatchItemSkipped,
  releaseDispatchItemToQueue,
  syncDispatchContactStatus,
} from './dispatchItems';
import { isInstanceConnectivityError } from './dispatchRetry';
import {
  getDispatchWorkerBatchSize,
  getDispatchWorkerIntervalMs,
  isDispatchDryRunEnabled,
  isDispatchRealSendEnabled,
  isDispatchWorkerEnabled,
} from './dispatchRuntimeConfig';
import { updateDevocionalScore } from './devocionalScoring';
import { recordBlindageSuccessfulSend } from './blindage';
import {
  applyWhatsAppValidationToContact,
  checkWhatsAppNumberDetailed,
} from './whatsappValidation';
import { isWhatsAppAutoValidateOnWorker } from './listAudienceResolver';

export {
  isDispatchWorkerEnabled,
  isDispatchRealSendEnabled,
  isDispatchDryRunEnabled,
  getDispatchWorkerBatchSize,
  getDispatchWorkerIntervalMs,
  getDispatchRuntimeSnapshot,
} from './dispatchRuntimeConfig';

const LOCK_TTL_MS = 5 * 60_000;

let workerTimer: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;

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

async function getDispatchRow(dispatchId: number): Promise<{
  status: string;
  metadata: any;
  dispatch_type: string | null;
  devocional_id: number | null;
  total_contacts: number | null;
} | null> {
  const r = await pool.query(
    `SELECT status, metadata, dispatch_type, devocional_id, total_contacts FROM dispatches WHERE id = $1`,
    [dispatchId]
  );
  return r.rows[0] ?? null;
}

async function maybeCompleteDispatch(dispatchId: number): Promise<void> {
  const dispatch = await getDispatchRow(dispatchId);
  if (!dispatch || !['running', 'pending', 'queued'].includes(dispatch.status)) {
    return;
  }

  const summary = await getDispatchItemsSummary(dispatchId);
  const expected = Number(dispatch.total_contacts) || 0;
  const decision = evaluateDispatchCompletion({
    totalContacts: expected,
    itemsTotal: summary.total,
    openCount: summary.open,
    terminalCount: summary.terminal,
  });

  if (!decision.canComplete) {
    if (summary.total < expected || (expected > 0 && summary.terminal < expected && summary.open === 0)) {
      addLog(
        'error',
        `[DispatchWorker] Dispatch ${dispatchId} NÃO concluído: ${decision.reason}. ` +
          `Mantendo status=${dispatch.status} (itens=${summary.total}, terminais=${summary.terminal}, abertos=${summary.open}, esperado=${expected})`
      );
      // Reabre se estava inconsistente como completed (defesa — normalmente já está running)
      await pool.query(
        `UPDATE dispatches
         SET status = CASE WHEN status IN ('completed', 'failed') THEN 'running' ELSE status END,
             completed_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status IN ('completed', 'failed')`,
        [dispatchId]
      );
    }
    return;
  }

  await pool.query(
    `UPDATE dispatches
     SET status = 'completed',
         completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status IN ('running', 'pending', 'queued')`,
    [dispatchId]
  );
}

async function validateDestination(item: DispatchItemRow): Promise<
  | { ok: true }
  | { ok: false; reason: string; retry?: boolean; category?: string }
> {
  const number = String(item.contact_number || '').trim();
  if (!number) {
    return { ok: false, reason: 'Número/destino vazio', category: 'invalid_phone' };
  }

  if (item.contact_id) {
    const c = await pool.query(
      `SELECT opt_out, opt_in, whatsapp_validated, whatsapp_validated_at, phone_number
       FROM contacts WHERE id = $1`,
      [item.contact_id]
    );
    if (c.rows.length === 0) {
      return { ok: false, reason: 'Contato não encontrado' };
    }
    const row = c.rows[0];
    if (row.opt_out === true) {
      return { ok: false, reason: 'Contato com opt-out', category: 'opt_out' };
    }
    if (row.opt_in === false) {
      return { ok: false, reason: 'Contato sem opt-in', category: 'no_opt_in' };
    }

    if (row.whatsapp_validated === true) {
      // ok — pode seguir
    } else if (row.whatsapp_validated === false && row.whatsapp_validated_at != null) {
      // Inválido confirmado (validação já ocorreu)
      return { ok: false, reason: 'WHATSAPP_INVALID', category: 'WHATSAPP_INVALID' };
    } else if (isWhatsAppAutoValidateOnWorker()) {
      // Pendente: validar antes do envio (sem sendText)
      const detailed = await checkWhatsAppNumberDetailed(row.phone_number || number);
      if (!detailed.ok) {
        return {
          ok: false,
          reason: detailed.message || 'Validação WhatsApp indisponível',
          retry: true,
          category: 'whatsapp_provider_unavailable',
        };
      }
      await applyWhatsAppValidationToContact(item.contact_id, detailed.isValid);
      if (!detailed.isValid) {
        return { ok: false, reason: 'WHATSAPP_INVALID', category: 'WHATSAPP_INVALID' };
      }
    } else {
      // Pendente sem auto-validate — não tratar como inexistente
      return {
        ok: false,
        reason: 'WhatsApp pendente de validação (WHATSAPP_AUTO_VALIDATE_ON_WORKER=false)',
        category: 'whatsapp_not_validated',
      };
    }
  }

  return { ok: true };
}

/**
 * Processa item claimado. Dry-run não marca sent; REAL_SEND off sem dry-run devolve à fila.
 */
export async function processClaimedDispatchItem(item: DispatchItemRow): Promise<{
  outcome: 'sent' | 'skipped' | 'failed' | 'pending_retry' | 'noop' | 'dry_run' | 'deferred';
  realSendAttempted: boolean;
}> {
  const dispatch = await getDispatchRow(item.dispatch_id);
  if (!dispatch || !['running', 'pending'].includes(dispatch.status)) {
    await markDispatchItemSkipped({
      itemId: item.id,
      reason: `Dispatch inativo (status=${dispatch?.status || 'missing'})`,
    });
    await clearItemLock(item.id);
    return { outcome: 'skipped', realSendAttempted: false };
  }

  if (await isDispatchItemSent(item.dispatch_id, item.contact_number)) {
    await markDispatchItemSent({ itemId: item.id });
    await clearItemLock(item.id);
    await maybeCompleteDispatch(item.dispatch_id);
    return { outcome: 'noop', realSendAttempted: false };
  }

  const fresh = await pool.query(`SELECT status FROM dispatch_items WHERE id = $1`, [item.id]);
  if (fresh.rows[0]?.status === 'sent') {
    await clearItemLock(item.id);
    return { outcome: 'noop', realSendAttempted: false };
  }

  const dest = await validateDestination(item);
  if (!dest.ok) {
    if (dest.retry) {
      await releaseDispatchItemToQueue({
        itemId: item.id,
        status: 'pending_retry',
        errorMessage: dest.reason,
        errorCategory: dest.category || 'whatsapp_provider_unavailable',
        backoffMinutes: 15,
      });
      addLog(
        'warning',
        `[DispatchWorker] Item ${item.id} retry (validação WA): ${maskPhone(item.contact_number)}`
      );
      return { outcome: 'pending_retry', realSendAttempted: false };
    }

    await markDispatchItemSkipped({ itemId: item.id, reason: dest.reason });
    if (dest.category === 'WHATSAPP_INVALID') {
      await pool.query(
        `UPDATE dispatch_items
         SET error_category = 'WHATSAPP_INVALID', error_message = 'WHATSAPP_INVALID', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [item.id]
      );
    }
    await syncDispatchContactStatus({
      dispatchId: item.dispatch_id,
      contactNumber: item.contact_number,
      contactName: item.contact_name,
      status: 'failed',
      failedReason: dest.reason,
    });
    await bumpDispatchCounters(item.dispatch_id, 'failed');
    await clearItemLock(item.id);
    await maybeCompleteDispatch(item.dispatch_id);
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
    await maybeCompleteDispatch(item.dispatch_id);
    return { outcome: 'failed', realSendAttempted: false };
  }

  // --- Dry-run / real-send gates (sem Evolution) ---
  if (!isDispatchRealSendEnabled()) {
    if (isDispatchDryRunEnabled()) {
      await releaseDispatchItemToQueue({
        itemId: item.id,
        status: 'pending',
        errorMessage: 'DRY_RUN',
        errorCategory: 'dry_run',
        backoffMinutes: 24 * 60,
      });
      addLog(
        'info',
        `[DispatchWorker] DRY_RUN item ${item.id} ${maskPhone(item.contact_number)} — sem Evolution, status reversível`
      );
      await maybeCompleteDispatch(item.dispatch_id);
      return { outcome: 'dry_run', realSendAttempted: false };
    }

    await releaseDispatchItemToQueue({
      itemId: item.id,
      status: 'pending',
      errorMessage: 'REAL_SEND_DISABLED',
      errorCategory: 'real_send_disabled',
      backoffMinutes: 60,
    });
    addLog(
      'warning',
      `[DispatchWorker] Item ${item.id} devolvido à fila (REAL_SEND_DISABLED) ${maskPhone(item.contact_number)}`
    );
    return { outcome: 'deferred', realSendAttempted: false };
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

  // Last-mile: revalidar dispatch imediatamente antes da chamada externa
  const lastMile = await getDispatchRow(item.dispatch_id);
  if (!lastMile || !['running', 'pending'].includes(lastMile.status)) {
    await markDispatchItemSkipped({
      itemId: item.id,
      reason: `Dispatch pausado/cancelado antes do envio (status=${lastMile?.status || 'missing'})`,
    });
    await clearItemLock(item.id);
    return { outcome: 'skipped', realSendAttempted: false };
  }

  if (await isDispatchItemSent(item.dispatch_id, item.contact_number)) {
    await markDispatchItemSent({ itemId: item.id });
    await clearItemLock(item.id);
    return { outcome: 'noop', realSendAttempted: false };
  }

  const metadata =
    typeof lastMile.metadata === 'string'
      ? JSON.parse(lastMile.metadata || '{}')
      : lastMile.metadata || {};
  const mediaUrl = metadata.media_url;
  const mediaType = metadata.media_type;

  try {
    const sendResult = await sendEvolutionTextSafely({
      instanceId,
      number: item.contact_number,
      text: String(text),
      messageType: item.message_type || lastMile.dispatch_type || 'avulsa',
      metadata: { dispatchId: item.dispatch_id, dispatchItemId: item.id, worker: true },
      media:
        mediaUrl && mediaType
          ? { url: String(mediaUrl), type: String(mediaType) }
          : undefined,
    });

    const msgResult = await pool.query(
      `INSERT INTO messages (
         instance_id, message_id, remote_jid, from_me,
         message_type, message_body, timestamp, status,
         dispatch_id, dispatch_type, contact_id, devocional_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        instanceId,
        sendResult.messageId,
        `${item.contact_number}@s.whatsapp.net`,
        true,
        mediaType || 'text',
        String(text),
        new Date(),
        'sent',
        item.dispatch_id,
        item.message_type || lastMile.dispatch_type || 'avulsa',
        item.contact_id,
        lastMile.devocional_id,
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

    if (
      (item.message_type === 'devocional' || lastMile.dispatch_type === 'devocional') &&
      item.contact_id
    ) {
      try {
        await updateDevocionalScore(item.contact_id, 'sent');
      } catch {
        /* não bloquear envio */
      }
    }

    try {
      await recordBlindageSuccessfulSend({
        to: item.contact_number,
        message: String(text),
        messageType: item.message_type || lastMile.dispatch_type || 'avulsa',
      });
    } catch {
      /* ignore */
    }

    await clearItemLock(item.id);
    await maybeCompleteDispatch(item.dispatch_id);

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
      connectivity && (item.attempt_count ?? 0) < Math.max(item.max_attempts ?? 1, 1) + 1;

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
    await maybeCompleteDispatch(item.dispatch_id);

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
  if (workerTimer) return;

  const intervalMs = getDispatchWorkerIntervalMs();
  const batch = getDispatchWorkerBatchSize();
  const snap = {
    realSend: isDispatchRealSendEnabled(),
    dryRun: isDispatchDryRunEnabled(),
  };

  console.log(
    `⚙️ DispatchWorker LIGADO — interval=${intervalMs}ms batch=${batch} realSend=${snap.realSend} dryRun=${snap.dryRun}`
  );
  addLog(
    'info',
    `[DispatchWorker] Iniciado interval=${intervalMs}ms batch=${batch} realSend=${snap.realSend} dryRun=${snap.dryRun}`
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
