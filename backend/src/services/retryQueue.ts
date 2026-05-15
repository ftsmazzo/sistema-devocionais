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

/**
 * Serviço de Fila de Retry
 * Reprocessa leads que falharam por instância indisponível
 * Executa a cada 5 minutos via cron
 * Máximo de 3 tentativas por lead, usando instâncias diferentes
 */

const MAX_RETRY_COUNT = 3;

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

    // Atualizar status no banco
    await pool.query(
      `UPDATE instances SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [isOnline ? 'connected' : 'disconnected', instanceId]
    );

    return isOnline;
  } catch (error: any) {
    addLog('warning', `[RetryQueue] Erro ao pingar instância ${instanceId}: ${error.message}`);
    // Em caso de erro de conexão, marcar como desconectada
    await pool.query(
      `UPDATE instances SET status = 'disconnected', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [instanceId]
    );
    return false;
  }
}

/**
 * Processa a fila de retry
 */
export async function processRetryQueue(): Promise<void> {
  try {
    // Buscar todos os dispatch_contacts com status 'pending_retry' e retry_count < MAX
    const pendingResult = await pool.query(
      `SELECT 
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
       ORDER BY dc.created_at ASC
       LIMIT 50`,
      [MAX_RETRY_COUNT]
    );

    if (pendingResult.rows.length === 0) {
      return;
    }

    addLog('info', `[RetryQueue] Processando ${pendingResult.rows.length} lead(s) na fila de retry`);
    console.log(`🔄 [RetryQueue] ${pendingResult.rows.length} lead(s) para retentar`);

    // Buscar instâncias conectadas
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

    const instances = instancesResult.rows;

    for (const item of pendingResult.rows) {
      try {
        console.log(`   🔄 Retentando lead: ${item.contact_number} (tentativa ${item.retry_count + 1}/${MAX_RETRY_COUNT})`);

        // Selecionar instância diferente da última usada
        const availableInstances = instances.filter((i) => i.id !== item.retry_instance_id);
        const candidates = availableInstances.length > 0 ? availableInstances : instances;

        // Verificar qual instância está realmente online
        let selectedInstance: any = null;
        for (const candidate of candidates) {
          const isOnline = await pingInstanceHealth(candidate.id);
          if (isOnline) {
            selectedInstance = candidate;
            break;
          }
        }

        if (!selectedInstance) {
          addLog('warning', `[RetryQueue] Nenhuma instância online para retry de ${item.contact_number}`);
          // Incrementar retry_count mas manter pending_retry
          await pool.query(
            `UPDATE dispatch_contacts 
             SET retry_count = retry_count + 1, last_retry_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [item.id]
          );
          continue;
        }

        // Preparar mensagem
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

          await pool.query(
            `UPDATE instances SET last_message_sent_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [selectedInstance.id]
          );

          const sendUrl = `${selectedInstance.api_url}/message/sendText/${selectedInstance.instance_name}`;
          const sendResponse = await axios.post(
            sendUrl,
            { number: item.contact_number, text: message },
            {
              headers: { apikey: selectedInstance.api_key, 'Content-Type': 'application/json' },
              timeout: 15000,
            }
          );

          const msgResult = await pool.query(
            `INSERT INTO messages (
              instance_id, message_id, remote_jid, from_me,
              message_type, message_body, timestamp, status,
              dispatch_id, dispatch_type
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id`,
            [
              selectedInstance.id,
              sendResponse.data?.key?.id || `retry-${Date.now()}`,
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

          addLog('success', `[RetryQueue] ✅ Retry bem-sucedido: ${item.contact_number} via instância ${selectedInstance.id}`);
          console.log(`   ✅ Retry enviado: ${item.contact_number} via instância ${selectedInstance.instance_name}`);
        });

        if (skipLead) {
          continue;
        }

      } catch (error: any) {
        console.error(`   ❌ Retry falhou para ${item.contact_number}:`, error.message);

        const newRetryCount = item.retry_count + 1;
        const isInstanceError =
          error.code === 'ECONNREFUSED' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ENOTFOUND' ||
          (error.response?.status >= 500);

        if (newRetryCount >= MAX_RETRY_COUNT || !isInstanceError) {
          // Falha definitiva
          await pool.query(
            `UPDATE dispatch_contacts 
             SET status = 'failed',
                 failed_reason = $1,
                 retry_count = $2,
                 last_retry_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [
              `Falha definitiva após ${newRetryCount} tentativas: ${error.message}`.slice(0, 500),
              newRetryCount,
              item.id,
            ]
          );
          addLog('error', `[RetryQueue] ❌ Falha definitiva após ${newRetryCount} tentativas: ${item.contact_number}`);
        } else {
          // Manter na fila
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
  }
}
