/**
 * Fila de retry legada → promove itens para o worker (sem envio direto).
 */
import { pool } from '../database';
import axios from 'axios';
import { addLog } from '../routes/logs';
import {
  MAX_DISPATCH_RETRY_ATTEMPTS,
  RETRY_DISPATCH_MAX_AGE_HOURS,
  alreadySentInDispatch,
} from './dispatchRetry';
import { maskPhone } from './evolutionSafeSender';
import {
  ensureDispatchItem,
  releaseDispatchItemToQueue,
} from './dispatchItems';
import { applyMessageTemplate, formatDevocionalMessage, personalizeDevocionalMessage } from './devocionalPersonalization';

let retryQueueRunning = false;

/**
 * Verifica se uma instância está realmente online via ping na Evolution API
 */
export async function pingInstanceHealth(instanceId: number): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT instance_name, api_url, api_key FROM instances WHERE id = $1`,
      [instanceId]
    );
    if (result.rows.length === 0) return false;

    const instance = result.rows[0];
    const url = `${instance.api_url}/instance/connectionState/${instance.instance_name}`;

    const response = await axios.get(url, {
      headers: { apikey: instance.api_key },
      timeout: 5000,
      validateStatus: () => true,
    });

    const state =
      response.data?.instance?.state ||
      response.data?.state ||
      response.data?.status;

    const isOnline = state === 'open';

    await pool.query(
      `UPDATE instances SET status = $1, health_status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [isOnline ? 'connected' : 'disconnected', isOnline ? 'healthy' : 'down', instanceId]
    );

    return isOnline;
  } catch (error: any) {
    addLog('warning', `[RetryQueue] Erro ao pingar instância ${instanceId}: ${error.message}`);
    await pool.query(
      `UPDATE instances SET status = 'disconnected', health_status = 'down', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [instanceId]
    );
    return false;
  }
}

/**
 * Promove pending_retry da tabela legada para dispatch_items (worker envia).
 */
export async function processRetryQueue(): Promise<void> {
  if (retryQueueRunning) {
    addLog('info', '[RetryQueue] Processamento já em andamento — ignorando tick duplicado.');
    return;
  }

  retryQueueRunning = true;
  try {
    await pool.query(
      `UPDATE dispatch_contacts dc
       SET status = 'failed',
           failed_reason = COALESCE(dc.failed_reason, '') || ' [retry expirado — disparo antigo]'
       FROM dispatches d
       WHERE dc.dispatch_id = d.id
         AND dc.status = 'pending_retry'
         AND d.created_at < NOW() - ($1::int * INTERVAL '1 hour')`,
      [RETRY_DISPATCH_MAX_AGE_HOURS]
    );

    const pendingResult = await pool.query(
      `SELECT DISTINCT ON (dc.dispatch_id, dc.contact_number)
        dc.id,
        dc.dispatch_id,
        dc.contact_number,
        dc.contact_name,
        dc.retry_count,
        d.dispatch_type,
        d.message_template,
        d.devocional_id,
        d.status as dispatch_status
       FROM dispatch_contacts dc
       JOIN dispatches d ON dc.dispatch_id = d.id
       WHERE dc.status = 'pending_retry'
         AND dc.retry_count < $1
         AND d.created_at > NOW() - ($2::text || ' hours')::interval
         AND d.status IN ('running', 'completed', 'pending')
       ORDER BY dc.dispatch_id, dc.contact_number, dc.created_at ASC
       LIMIT 50`,
      [MAX_DISPATCH_RETRY_ATTEMPTS, String(RETRY_DISPATCH_MAX_AGE_HOURS)]
    );

    if (pendingResult.rows.length === 0) {
      return;
    }

    addLog('info', `[RetryQueue] Reenfileirando ${pendingResult.rows.length} lead(s) para o worker`);

    for (const item of pendingResult.rows) {
      try {
        if (await alreadySentInDispatch(item.dispatch_id, item.contact_number)) {
          await pool.query(
            `UPDATE dispatch_contacts SET status = 'sent', sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP) WHERE id = $1`,
            [item.id]
          );
          continue;
        }

        let message = item.message_template;
        if (item.dispatch_type === 'marketing') {
          message = applyMessageTemplate(item.message_template, item.contact_name);
        }
        if (item.dispatch_type === 'devocional' && item.devocional_id) {
          const devResult = await pool.query(
            `SELECT id, title, text, versiculo_principal, versiculo_apoio, metadata FROM devocionais WHERE id = $1`,
            [item.devocional_id]
          );
          if (devResult.rows.length > 0) {
            const formatted = formatDevocionalMessage(devResult.rows[0]);
            message = personalizeDevocionalMessage(formatted, item.contact_name, 'America/Sao_Paulo');
          }
        }

        const di = await ensureDispatchItem({
          dispatchId: item.dispatch_id,
          contactNumber: item.contact_number,
          contactName: item.contact_name,
          messageType: item.dispatch_type || 'avulsa',
          messageSnapshot: message,
          maxAttempts: MAX_DISPATCH_RETRY_ATTEMPTS + 1,
        });

        if (di.status === 'sent') {
          await pool.query(
            `UPDATE dispatch_contacts SET status = 'sent', sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP) WHERE id = $1`,
            [item.id]
          );
          continue;
        }

        await releaseDispatchItemToQueue({
          itemId: di.id,
          status: 'pending_retry',
          errorMessage: 'Reenfileirado pela retryQueue para o worker',
          errorCategory: 'retry_requeue',
          backoffMinutes: 1,
        });

        // Manter dispatch running se estava completed com retries
        await pool.query(
          `UPDATE dispatches SET status = 'running', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND status = 'completed'`,
          [item.dispatch_id]
        );

        await pool.query(
          `UPDATE dispatch_contacts
           SET last_retry_at = CURRENT_TIMESTAMP,
               failed_reason = COALESCE(failed_reason, '') || ' [promovido ao worker]'
           WHERE id = $1`,
          [item.id]
        );

        addLog(
          'info',
          `[RetryQueue] ${maskPhone(item.contact_number)} → worker (item ${di.id})`
        );
      } catch (error: any) {
        addLog(
          'error',
          `[RetryQueue] Falha ao reenfileirar ${maskPhone(item.contact_number)}: ${(error?.message || '').slice(0, 200)}`
        );
      }
    }

    addLog('info', `[RetryQueue] Reenfileiramento concluído (sem envio direto)`);
  } catch (error: any) {
    console.error('❌ [RetryQueue] Erro ao processar fila de retry:', error.message);
    addLog('error', `[RetryQueue] Erro geral: ${error.message}`);
  } finally {
    retryQueueRunning = false;
  }
}
