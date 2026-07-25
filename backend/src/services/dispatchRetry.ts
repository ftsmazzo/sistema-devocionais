import { pool } from '../database';
import { addLog } from '../routes/logs';
import axios from 'axios';

/** Uma única tentativa na fila de retry (além do envio imediato com failover no disparo). */
export const MAX_DISPATCH_RETRY_ATTEMPTS = 1;

/** Só reprocessar disparos recentes (evita reenviar devocionais de dias atrás). */
export const RETRY_DISPATCH_MAX_AGE_HOURS = 48;

export function isInstanceConnectivityError(error: any): boolean {
  if (
    error?.name === 'EvolutionSafeSendError' &&
    ['provider_unavailable', 'timeout', 'network', 'instance_offline'].includes(error?.kind)
  ) {
    return true;
  }
  return (
    error?.code === 'ECONNREFUSED' ||
    error?.code === 'ETIMEDOUT' ||
    error?.code === 'ENOTFOUND' ||
    (typeof error?.response?.status === 'number' && error.response.status >= 500) ||
    (typeof error?.httpStatus === 'number' && error.httpStatus >= 500)
  );
}

export function removeInstanceFromPool<T extends { id: number }>(instances: T[], instanceId: number): T[] {
  return instances.filter((i) => i.id !== instanceId);
}

export async function alreadySentInDispatch(
  dispatchId: number,
  contactNumber: string
): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM dispatch_contacts
     WHERE dispatch_id = $1 AND contact_number = $2 AND status = 'sent'
     LIMIT 1`,
    [dispatchId, contactNumber]
  );
  return r.rows.length > 0;
}

/**
 * Garante no máximo um pending_retry por disparo+telefone; não cria se já enviou.
 */
export async function enqueueDispatchRetry(params: {
  dispatchId: number;
  instanceId: number;
  contactNumber: string;
  contactName?: string | null;
  failedReason: string;
}): Promise<boolean> {
  const { dispatchId, instanceId, contactNumber, contactName, failedReason } = params;

  if (await alreadySentInDispatch(dispatchId, contactNumber)) {
    addLog(
      'info',
      `[Retry] Ignorado enqueue — já enviado: dispatch=${dispatchId} ${contactNumber}`
    );
    return false;
  }

  const existing = await pool.query(
    `SELECT id, status FROM dispatch_contacts
     WHERE dispatch_id = $1 AND contact_number = $2
     ORDER BY id DESC LIMIT 1`,
    [dispatchId, contactNumber]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.status === 'sent') return false;
    if (row.status === 'pending_retry') {
      await pool.query(
        `UPDATE dispatch_contacts
         SET failed_reason = $1,
             retry_instance_id = $2,
             last_retry_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [failedReason.slice(0, 500), instanceId, row.id]
      );
      return true;
    }
    return false;
  }

  await pool.query(
    `INSERT INTO dispatch_contacts (
      dispatch_id, instance_id, contact_number, contact_name,
      status, failed_reason, retry_count, last_retry_at, retry_instance_id
    ) VALUES ($1, $2, $3, $4, 'pending_retry', $5, 0, CURRENT_TIMESTAMP, $2)`,
    [dispatchId, instanceId, contactNumber, contactName ?? null, failedReason.slice(0, 500)]
  );
  return true;
}

const notifiedOfflineInstances = new Set<string>();

export async function notifyAdminInstanceOffline(
  notificationPhone: string | null | undefined,
  instanceName: string,
  reason: string,
  sendNotification: (phone: string, message: string) => Promise<void>
): Promise<void> {
  const key = `${instanceName}:${new Date().toISOString().slice(0, 13)}`;
  if (notifiedOfflineInstances.has(key)) return;
  notifiedOfflineInstances.add(key);
  if (notifiedOfflineInstances.size > 500) notifiedOfflineInstances.clear();

  const msg = `⚠️ Instância WhatsApp *${instanceName}* ficou offline durante disparo.\nMotivo: ${reason}\nEla foi removida do pool até reconectar.`;
  addLog('warning', `[Instância] ${instanceName} offline: ${reason}`);

  if (notificationPhone) {
    try {
      await sendNotification(notificationPhone, msg);
    } catch (e: any) {
      addLog('warning', `[Instância] Falha ao notificar admin: ${e?.message || e}`);
    }
  }
}

export async function markInstanceOfflineInDb(instanceId: number): Promise<void> {
  await pool.query(
    `UPDATE instances
     SET status = 'disconnected',
         health_status = 'down',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [instanceId]
  );
}

export function assertEvolutionSendOk(response: { status?: number; data?: unknown }): void {
  if (response?.status != null && response.status >= 400) {
    const detail =
      typeof response.data === 'object' && response.data !== null
        ? JSON.stringify(response.data).slice(0, 200)
        : String(response.data ?? '');
    throw new Error(`Evolution HTTP ${response.status}: ${detail}`);
  }
}
