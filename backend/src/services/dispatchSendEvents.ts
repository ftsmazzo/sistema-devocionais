/**
 * Auditoria persistente de disparos (fonte de verdade por dispatch/item).
 * Espelha em addLog para o stream genérico /api/logs.
 */
import { pool } from '../database';
import { addLog } from '../routes/logs';

export type DispatchEventLevel = 'info' | 'success' | 'warning' | 'error';

export type DispatchEventCode =
  | 'CLAIM'
  | 'INSTANCE_PICK'
  | 'INSTANCE_UNAVAILABLE'
  | 'SEND_OK'
  | 'SEND_FAIL'
  | 'SKIP'
  | 'DRY_RUN'
  | 'DEFERRED'
  | 'RETRY'
  | 'VALIDATION'
  | 'ENQUEUE'
  | 'COMPLETE';

export async function recordDispatchEvent(params: {
  dispatchId: number;
  itemId?: number | null;
  contactId?: number | null;
  instanceId?: number | null;
  level?: DispatchEventLevel;
  code: DispatchEventCode | string;
  message: string;
  meta?: Record<string, unknown> | null;
  mirrorAddLog?: boolean;
}): Promise<void> {
  const level = params.level || 'info';
  const message = String(params.message || '').slice(0, 2000);
  const meta = params.meta && typeof params.meta === 'object' ? params.meta : {};

  try {
    await pool.query(
      `INSERT INTO dispatch_send_events (
         dispatch_id, item_id, contact_id, instance_id, level, code, message, meta
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        params.dispatchId,
        params.itemId ?? null,
        params.contactId ?? null,
        params.instanceId ?? null,
        level,
        String(params.code).slice(0, 60),
        message,
        JSON.stringify(meta),
      ]
    );
  } catch (err: any) {
    console.error(
      `[dispatch_send_events] falha ao gravar: ${err?.message || err} | ${params.code} dispatch=${params.dispatchId}`
    );
  }

  if (params.mirrorAddLog !== false) {
    addLog(level, `[Dispatch#${params.dispatchId}] [${params.code}] ${message}`);
  }
}

export async function listDispatchEvents(params: {
  dispatchId: number;
  itemId?: number | null;
  since?: string | null;
  limit?: number;
}): Promise<
  Array<{
    id: number;
    dispatch_id: number;
    item_id: number | null;
    contact_id: number | null;
    instance_id: number | null;
    level: string;
    code: string;
    message: string;
    meta: any;
    created_at: string;
  }>
> {
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 1000);
  const clauses = ['dispatch_id = $1'];
  const values: any[] = [params.dispatchId];
  let idx = 2;

  if (params.itemId != null && Number.isFinite(Number(params.itemId))) {
    clauses.push(`item_id = $${idx++}`);
    values.push(Number(params.itemId));
  }
  if (params.since) {
    clauses.push(`created_at > $${idx++}::timestamptz`);
    values.push(params.since);
  }

  values.push(limit);
  const result = await pool.query(
    `SELECT id, dispatch_id, item_id, contact_id, instance_id,
            level, code, message, meta, created_at
     FROM dispatch_send_events
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at ASC, id ASC
     LIMIT $${idx}`,
    values
  );
  return result.rows;
}
