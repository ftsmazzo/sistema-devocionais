import { pool } from '../database';
import axios from 'axios';
import { applyBlindage, recordBlindageSuccessfulSend } from './blindage';
import { withGlobalOutboundGate } from './globalOutboundGate';
import {
  personalizeDevocionalMessage,
  formatDevocionalMessage,
  applyMessageTemplate,
} from './devocionalPersonalization';
import { addLog } from '../routes/logs';
import {
  MAX_DISPATCH_RETRY_ATTEMPTS,
  RETRY_DISPATCH_MAX_AGE_HOURS,
  alreadySentInDispatch,
  isInstanceConnectivityError,
} from './dispatchRetry';
import { maskPhone, sendEvolutionTextSafely } from './evolutionSafeSender';

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
 * Processa a fila de retry — no máximo 1 reenvio por contato/disparo, só disparos recentes.
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
        dc.retry_instance_id,
        d.dispatch_type,
        d.message_template,
        d.devocional_id,
        d.status as dispatch_status
       FROM dispatch_contacts dc
       JOIN dispatches d ON dc.dispatch_id = d.id
       WHERE dc.status = 'pending_retry'
         AND dc.retry_count < $1
         AND d.created_at > NOW() - ($2::text || ' hours')::interval
         AND d.status IN ('running', 'completed')
       ORDER BY dc.dispatch_id, dc.contact_number, dc.created_at ASC
       LIMIT 50`,
      [MAX_DISPATCH_RETRY_ATTEMPTS, String(RETRY_DISPATCH_MAX_AGE_HOURS)]
    );

    if (pendingResult.rows.length === 0) {
      return;
    }

    addLog('info', `[RetryQueue] Processando ${pendingResult.rows.length} lead(s) na fila de retry`);
    console.log(`🔄 [RetryQueue] ${pendingResult.rows.length} lead(s) para retentar`);

    const instancesResult = await pool.query(
      `SELECT id, instance_name, api_url, api_key, phone_number
       FROM instances
       WHERE status = 'connected'
       ORDER BY last_message_sent_at ASC NULLS FIRST`
    );

    if (instancesResult.rows.length === 0) {
      addLog('warning', '[RetryQueue] Nenhuma instância conectada. Retry adiado.');
      return;
    }

    let instances = instancesResult.rows;

    for (const item of pendingResult.rows) {
      try {
        if (await alreadySentInDispatch(item.dispatch_id, item.contact_number)) {
          await pool.query(
            `UPDATE dispatch_contacts SET status = 'sent', sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP) WHERE id = $1`,
            [item.id]
          );
          addLog(
            'info',
            `[RetryQueue] ${item.contact_number} já tinha envio no disparo ${item.dispatch_id} — fila cancelada.`
          );
          continue;
        }

        console.log(
          `   🔄 Retentando lead: ${item.contact_number} (tentativa ${item.retry_count + 1}/${MAX_DISPATCH_RETRY_ATTEMPTS})`
        );

        const availableInstances = instances.filter((i) => i.id !== item.retry_instance_id);
        const candidates = availableInstances.length > 0 ? availableInstances : instances;

        let selectedInstance: any = null;
        for (const candidate of candidates) {
          const isOnline = await pingInstanceHealth(candidate.id);
          if (isOnline) {
            selectedInstance = candidate;
            break;
          }
          instances = instances.filter((i) => i.id !== candidate.id);
        }

        if (!selectedInstance) {
          addLog('warning', `[RetryQueue] Nenhuma instância online para retry de ${item.contact_number}`);
          await pool.query(
            `UPDATE dispatch_contacts
             SET last_retry_at = CURRENT_TIMESTAMP,
                 failed_reason = COALESCE(failed_reason, '') || ' [sem instância online]'
             WHERE id = $1`,
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
            const devocional = devResult.rows[0];
            const formatted = formatDevocionalMessage(devocional);
            message = personalizeDevocionalMessage(formatted, item.contact_name, 'America/Sao_Paulo');
          }
        }

        let skipLead = false;
        await withGlobalOutboundGate(async () => {
          const blindageResult = await applyBlindage({
            to: item.contact_number,
            message,
            instanceId: selectedInstance.id,
            messageType: item.dispatch_type,
          });

          if (!blindageResult.canSend) {
            await pool.query(
              `UPDATE dispatch_contacts
               SET status = 'failed',
                   failed_reason = $1,
                   retry_count = retry_count + 1,
                   last_retry_at = CURRENT_TIMESTAMP
               WHERE id = $2`,
              [`Blindagem (retry): ${blindageResult.reason}`, item.id]
            );
            skipLead = true;
            return;
          }

          if (blindageResult.delay && blindageResult.delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, blindageResult.delay));
          }

          if (await alreadySentInDispatch(item.dispatch_id, item.contact_number)) {
            await pool.query(
              `UPDATE dispatch_contacts SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = $1`,
              [item.id]
            );
            skipLead = true;
            return;
          }

          await pool.query(
            `UPDATE instances SET last_message_sent_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [selectedInstance.id]
          );

          const sendResult = await sendEvolutionTextSafely({
            instanceId: selectedInstance.id,
            number: item.contact_number,
            text: message,
            messageType: item.dispatch_type || 'avulsa',
            metadata: { dispatchId: item.dispatch_id, retry: true },
          });

          const msgResult = await pool.query(
            `INSERT INTO messages (
              instance_id, message_id, remote_jid, from_me,
              message_type, message_body, timestamp, status,
              dispatch_id, dispatch_type
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id`,
            [
              selectedInstance.id,
              sendResult.messageId,
              `${item.contact_number}@s.whatsapp.net`,
              true,
              'text',
              message,
              new Date(),
              'sent',
              item.dispatch_id,
              item.dispatch_type,
            ]
          );

          await pool.query(
            `UPDATE dispatch_contacts
             SET status = 'sent',
                 sent_at = CURRENT_TIMESTAMP,
                 message_sent_id = $1,
                 retry_instance_id = $2,
                 retry_count = retry_count + 1,
                 last_retry_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [msgResult.rows[0].id, selectedInstance.id, item.id]
          );

          await pool.query(
            `UPDATE instances SET last_message_sent_at = CURRENT_TIMESTAMP, last_activity_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [selectedInstance.id]
          );

          await recordBlindageSuccessfulSend({
            to: item.contact_number,
            message,
            messageType: item.dispatch_type || 'avulsa',
          });

          await pool.query(
            `UPDATE dispatches
             SET contacts_success = contacts_success + 1,
                 contacts_failed = GREATEST(0, contacts_failed - 1)
             WHERE id = $1`,
            [item.dispatch_id]
          );

          addLog(
            'success',
            `[RetryQueue] ✅ Retry único concluído: ${maskPhone(item.contact_number)} via ${selectedInstance.instance_name}`
          );
          console.log(`   ✅ Retry enviado: ${maskPhone(item.contact_number)} via instância ${selectedInstance.instance_name}`);
        });

        if (skipLead) {
          continue;
        }
      } catch (error: any) {
        console.error(`   ❌ Retry falhou para ${item.contact_number}:`, error.message);

        const newRetryCount = item.retry_count + 1;

        if (newRetryCount >= MAX_DISPATCH_RETRY_ATTEMPTS || !isInstanceConnectivityError(error)) {
          await pool.query(
            `UPDATE dispatch_contacts
             SET status = 'failed',
                 failed_reason = $1,
                 retry_count = $2,
                 last_retry_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [
              `Falha definitiva após retry: ${error.message}`.slice(0, 500),
              newRetryCount,
              item.id,
            ]
          );
          addLog('error', `[RetryQueue] ❌ Falha definitiva: ${item.contact_number}`);
        } else {
          await pool.query(
            `UPDATE dispatch_contacts
             SET retry_count = $1, last_retry_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [newRetryCount, item.id]
          );
        }
      }
    }

    addLog('info', `[RetryQueue] Processamento de retry concluído`);
  } catch (error: any) {
    console.error('❌ [RetryQueue] Erro ao processar fila de retry:', error.message);
    addLog('error', `[RetryQueue] Erro geral: ${error.message}`);
  } finally {
    retryQueueRunning = false;
  }
}
