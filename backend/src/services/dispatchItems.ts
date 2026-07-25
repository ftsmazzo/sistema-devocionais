/**
 * Itens persistentes de disparo (um por contato/disparo).
 * Idempotência e rastreio sem worker — o envio continua síncrono nesta etapa.
 */
import { pool } from '../database';
import { maskPhone } from './evolutionSafeSender';

export type DispatchItemStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'skipped'
  | 'pending_retry';

export interface DispatchItemRow {
  id: number;
  dispatch_id: number;
  contact_id: number | null;
  contact_number: string;
  contact_name: string | null;
  instance_id: number | null;
  message_type: string | null;
  message_snapshot: string | null;
  status: DispatchItemStatus;
  attempt_count: number;
  max_attempts: number;
  provider_message_id: string | null;
  error_category: string | null;
  error_message: string | null;
}

function truncateSnapshot(text: string | null | undefined, max = 8000): string | null {
  if (text == null) return null;
  const s = String(text);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function summarizeError(err: unknown, max = 500): string {
  const msg = err instanceof Error ? err.message : String(err ?? 'erro');
  return msg.slice(0, max);
}

/**
 * Cria item se não existir (unique dispatch_id + contact_number).
 * Se já existir, devolve o atual sem sobrescrever status sent.
 */
export async function ensureDispatchItem(params: {
  dispatchId: number;
  contactId?: number | null;
  contactNumber: string;
  contactName?: string | null;
  messageType?: string | null;
  messageSnapshot?: string | null;
  instanceId?: number | null;
  maxAttempts?: number;
}): Promise<DispatchItemRow> {
  const {
    dispatchId,
    contactId = null,
    contactNumber,
    contactName = null,
    messageType = null,
    messageSnapshot = null,
    instanceId = null,
    maxAttempts = 1,
  } = params;

  const snap = truncateSnapshot(messageSnapshot);

  const inserted = await pool.query(
    `INSERT INTO dispatch_items (
       dispatch_id, contact_id, contact_number, contact_name,
       instance_id, message_type, message_snapshot, status,
       attempt_count, max_attempts, scheduled_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 0, $8, CURRENT_TIMESTAMP)
     ON CONFLICT (dispatch_id, contact_number) DO NOTHING
     RETURNING *`,
    [
      dispatchId,
      contactId,
      contactNumber,
      contactName,
      instanceId,
      messageType,
      snap,
      maxAttempts,
    ]
  );

  if (inserted.rows.length > 0) {
    return inserted.rows[0] as DispatchItemRow;
  }

  const existing = await pool.query(
    `SELECT * FROM dispatch_items
     WHERE dispatch_id = $1 AND contact_number = $2
     LIMIT 1`,
    [dispatchId, contactNumber]
  );

  if (existing.rows.length === 0) {
    throw new Error(
      `dispatch_item não encontrado após conflito: dispatch=${dispatchId} contact=${maskPhone(contactNumber)}`
    );
  }

  const row = existing.rows[0] as DispatchItemRow;

  // Atualiza snapshot/nome se ainda pendente (não mexe em sent)
  if (row.status === 'pending' || row.status === 'pending_retry' || row.status === 'failed') {
    const upd = await pool.query(
      `UPDATE dispatch_items
       SET contact_name = COALESCE($3, contact_name),
           contact_id = COALESCE($4, contact_id),
           message_type = COALESCE($5, message_type),
           message_snapshot = COALESCE($6, message_snapshot),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status <> 'sent'
       RETURNING *`,
      [row.id, dispatchId, contactName, contactId, messageType, snap]
    );
    if (upd.rows[0]) return upd.rows[0] as DispatchItemRow;
  }

  return row;
}

export async function isDispatchItemSent(
  dispatchId: number,
  contactNumber: string
): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM dispatch_items
     WHERE dispatch_id = $1 AND contact_number = $2 AND status = 'sent'
     LIMIT 1`,
    [dispatchId, contactNumber]
  );
  return r.rows.length > 0;
}

export async function markDispatchItemProcessing(
  itemId: number,
  instanceId?: number | null
): Promise<DispatchItemRow | null> {
  const r = await pool.query(
    `UPDATE dispatch_items
     SET status = 'processing',
         started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
         instance_id = COALESCE($2, instance_id),
         attempt_count = COALESCE(attempt_count, 0) + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status <> 'sent'
     RETURNING *`,
    [itemId, instanceId ?? null]
  );
  return (r.rows[0] as DispatchItemRow) || null;
}

export async function markDispatchItemSent(params: {
  itemId: number;
  providerMessageId?: string | null;
  instanceId?: number | null;
}): Promise<void> {
  await pool.query(
    `UPDATE dispatch_items
     SET status = 'sent',
         sent_at = CURRENT_TIMESTAMP,
         failed_at = NULL,
         provider_message_id = COALESCE($2, provider_message_id),
         instance_id = COALESCE($3, instance_id),
         error_category = NULL,
         error_message = NULL,
         next_retry_at = NULL,
         lock_token = NULL,
         locked_at = NULL,
         lock_expires_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [params.itemId, params.providerMessageId ?? null, params.instanceId ?? null]
  );
}

export async function markDispatchItemFailed(params: {
  itemId: number;
  errorMessage: string;
  errorCategory?: string | null;
  instanceId?: number | null;
  asPendingRetry?: boolean;
}): Promise<void> {
  const status = params.asPendingRetry ? 'pending_retry' : 'failed';
  await pool.query(
    `UPDATE dispatch_items
     SET status = $2,
         failed_at = CURRENT_TIMESTAMP,
         error_message = $3,
         error_category = $4,
         instance_id = COALESCE($5, instance_id),
         next_retry_at = CASE WHEN $2 = 'pending_retry' THEN CURRENT_TIMESTAMP + INTERVAL '5 minutes' ELSE NULL END,
         lock_token = NULL,
         locked_at = NULL,
         lock_expires_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status <> 'sent'`,
    [
      params.itemId,
      status,
      summarizeError(params.errorMessage),
      params.errorCategory ?? null,
      params.instanceId ?? null,
    ]
  );
}

export async function markDispatchItemSkipped(params: {
  itemId: number;
  reason: string;
  instanceId?: number | null;
}): Promise<void> {
  await pool.query(
    `UPDATE dispatch_items
     SET status = 'skipped',
         failed_at = CURRENT_TIMESTAMP,
         error_category = 'skipped',
         error_message = $2,
         instance_id = COALESCE($3, instance_id),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status <> 'sent'`,
    [params.itemId, summarizeError(params.reason), params.instanceId ?? null]
  );
}

export async function getDispatchItemsSummary(dispatchId: number): Promise<{
  total: number;
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  skipped: number;
  pending_retry: number;
}> {
  const r = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
       COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
       COUNT(*) FILTER (WHERE status = 'pending_retry')::int AS pending_retry
     FROM dispatch_items
     WHERE dispatch_id = $1`,
    [dispatchId]
  );
  return r.rows[0];
}

/**
 * Sincroniza status básico em dispatch_contacts (legado) a partir do item.
 * Não remove nem substitui a tabela legada.
 */
export async function syncDispatchContactStatus(params: {
  dispatchId: number;
  contactNumber: string;
  contactName?: string | null;
  instanceId?: number | null;
  status: 'sent' | 'failed' | 'pending_retry';
  failedReason?: string | null;
  messageSentId?: number | null;
}): Promise<void> {
  const {
    dispatchId,
    contactNumber,
    contactName = null,
    instanceId = null,
    status,
    failedReason = null,
    messageSentId = null,
  } = params;

  const existing = await pool.query(
    `SELECT id, status FROM dispatch_contacts
     WHERE dispatch_id = $1 AND contact_number = $2
     ORDER BY id DESC LIMIT 1`,
    [dispatchId, contactNumber]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.status === 'sent' && status !== 'sent') {
      return;
    }
    if (status === 'sent') {
      await pool.query(
        `UPDATE dispatch_contacts
         SET status = 'sent',
             sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP),
             message_sent_id = COALESCE($2, message_sent_id),
             instance_id = COALESCE($3, instance_id),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [row.id, messageSentId, instanceId]
      );
    } else if (status === 'pending_retry') {
      await pool.query(
        `UPDATE dispatch_contacts
         SET status = 'pending_retry',
             failed_reason = COALESCE($2, failed_reason),
             retry_instance_id = COALESCE($3, retry_instance_id),
             last_retry_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status <> 'sent'`,
        [row.id, failedReason?.slice(0, 500) ?? null, instanceId]
      );
    } else {
      await pool.query(
        `UPDATE dispatch_contacts
         SET status = 'failed',
             failed_reason = COALESCE($2, failed_reason),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status <> 'sent'`,
        [row.id, failedReason?.slice(0, 500) ?? null]
      );
    }
    return;
  }

  if (status === 'sent') {
    await pool.query(
      `INSERT INTO dispatch_contacts (
         dispatch_id, instance_id, contact_number, contact_name,
         message_sent_id, status, sent_at
       ) VALUES ($1, $2, $3, $4, $5, 'sent', CURRENT_TIMESTAMP)`,
      [dispatchId, instanceId, contactNumber, contactName, messageSentId]
    );
  } else if (status === 'pending_retry') {
    await pool.query(
      `INSERT INTO dispatch_contacts (
         dispatch_id, instance_id, contact_number, contact_name,
         status, failed_reason, retry_count, last_retry_at, retry_instance_id
       ) VALUES ($1, $2, $3, $4, 'pending_retry', $5, 0, CURRENT_TIMESTAMP, $2)`,
      [dispatchId, instanceId, contactNumber, contactName, failedReason?.slice(0, 500) ?? null]
    );
  } else {
    await pool.query(
      `INSERT INTO dispatch_contacts (
         dispatch_id, instance_id, contact_number, contact_name,
         status, failed_reason
       ) VALUES ($1, $2, $3, $4, 'failed', $5)`,
      [dispatchId, instanceId, contactNumber, contactName, failedReason?.slice(0, 500) ?? null]
    );
  }
}
