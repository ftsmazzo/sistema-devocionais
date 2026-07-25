/**
 * Enfileira disparos de marketing em dispatch_items.
 * O worker PostgreSQL é o único executor de envio.
 * Público resolvido via listAudienceResolver (sem forçar whatsapp_validated na query).
 */
import { pool } from '../database';
import { applyMessageTemplate } from './devocionalPersonalization';
import { addLog } from '../routes/logs';
import { pingInstanceHealth } from './retryQueue';
import { markInstanceOfflineInDb, notifyAdminInstanceOffline } from './dispatchRetry';
import { maskPhone } from './evolutionSafeSender';
import { ensureDispatchItem, isDispatchItemSent } from './dispatchItems';
import {
  assertDispatchPipelineAllowed,
  DispatchOperationalError,
} from './dispatchRuntimeConfig';
import { sendAdminWhatsAppNotification } from './adminWhatsAppNotify';
import {
  formatAudienceCountsLog,
  PENDING_WHATSAPP_VALIDATION_MESSAGE,
  resolveContactsByIds,
  resolveListAudience,
  type CategorizedAudience,
} from './listAudienceResolver';

interface MarketingDispatchParams {
  dispatchId: number;
  instanceIds?: number[];
}

/**
 * Processar disparo de marketing = apenas enfileirar itens para o worker.
 */
export async function processMarketingDispatch(params: MarketingDispatchParams): Promise<void> {
  const { dispatchId, instanceIds } = params;

  try {
    assertDispatchPipelineAllowed();

    const logMsg = `📢 Enfileirando disparo de marketing ID ${dispatchId} (worker)`;
    console.log(logMsg);
    addLog('info', logMsg);

    const dispatchResult = await pool.query(
      `SELECT 
        d.*,
        l.total_contacts
       FROM dispatches d
       LEFT JOIN contact_lists l ON d.list_id = l.id
       WHERE d.id = $1`,
      [dispatchId]
    );

    if (dispatchResult.rows.length === 0) {
      throw new Error(`Disparo ${dispatchId} não encontrado`);
    }

    const dispatch = dispatchResult.rows[0];

    if (dispatch.status === 'completed' || dispatch.status === 'stopped') {
      console.log(`   ⚠️ Disparo já está em status: ${dispatch.status}`);
      return;
    }

    if (dispatch.status === 'running') {
      const itemsCheck = await pool.query(
        `SELECT COUNT(*)::int AS count FROM dispatch_items WHERE dispatch_id = $1`,
        [dispatchId]
      );
      if ((itemsCheck.rows[0]?.count || 0) > 0) {
        console.log(`   ⚠️ Disparo já possui itens enfileirados`);
        return;
      }
    }

    await pool.query(
      `UPDATE dispatches SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id = $1`,
      [dispatchId]
    );

    let audience: CategorizedAudience;

    if (dispatch.list_id) {
      const listResult = await pool.query(`SELECT * FROM contact_lists WHERE id = $1`, [
        dispatch.list_id,
      ]);
      if (listResult.rows.length === 0) {
        throw new Error(`Lista ${dispatch.list_id} não encontrada`);
      }
      audience = await resolveListAudience(listResult.rows[0]);
    } else if (dispatch.contact_ids && Array.isArray(dispatch.contact_ids)) {
      audience = await resolveContactsByIds(dispatch.contact_ids);
    } else {
      audience = await resolveContactsByIds([]);
    }

    const countsLog = formatAudienceCountsLog(audience.counts);
    console.log(`   📋 Público marketing: ${countsLog}`);
    addLog('info', `[Marketing ${dispatchId}] Público: ${countsLog}`);

    if (audience.counts.needs_whatsapp_validation > 0) {
      addLog(
        'warning',
        `[Marketing ${dispatchId}] ${audience.counts.needs_whatsapp_validation} pendentes WA — ` +
          PENDING_WHATSAPP_VALIDATION_MESSAGE
      );
    }

    const contacts = audience.eligible_now;

    if (contacts.length === 0) {
      const pendingMsg =
        audience.counts.needs_whatsapp_validation > 0
          ? PENDING_WHATSAPP_VALIDATION_MESSAGE
          : 'Nenhum contato elegível para enfileirar.';

      console.log(`   ⚠️ ${pendingMsg}`);
      addLog('warning', `[Marketing ${dispatchId}] ${pendingMsg}`);

      await pool.query(
        `UPDATE dispatches
         SET status = 'completed',
             contacts_processed = 0,
             total_contacts = 0,
             completed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [dispatchId]
      );

      if (audience.counts.needs_whatsapp_validation > 0) {
        throw new Error(PENDING_WHATSAPP_VALIDATION_MESSAGE);
      }
      return;
    }

    let instances: any[] = [];
    if (instanceIds && instanceIds.length > 0) {
      const instancesResult = await pool.query(
        `SELECT id, instance_name FROM instances WHERE id = ANY($1::int[]) AND status = 'connected'`,
        [instanceIds]
      );
      instances = instancesResult.rows;
    } else {
      const instancesResult = await pool.query(
        `SELECT id, instance_name FROM instances WHERE status = 'connected' ORDER BY last_message_sent_at ASC NULLS FIRST`
      );
      instances = instancesResult.rows;
    }

    if (instances.length === 0) {
      throw new Error('Nenhuma instância conectada disponível');
    }

    const notifyPhoneResult = await pool.query(
      `SELECT notification_phone FROM devocional_config ORDER BY id DESC LIMIT 1`
    );
    const adminNotifyPhone: string | null = notifyPhoneResult.rows[0]?.notification_phone ?? null;

    const verifiedInstances: any[] = [];
    for (const inst of instances) {
      const isOnline = await pingInstanceHealth(inst.id);
      if (isOnline) {
        verifiedInstances.push(inst);
      } else {
        await markInstanceOfflineInDb(inst.id);
        await notifyAdminInstanceOffline(
          adminNotifyPhone,
          inst.instance_name,
          'Falha no ping antes do disparo',
          sendAdminWhatsAppNotification
        );
      }
    }

    if (verifiedInstances.length === 0) {
      throw new Error('Todas as instâncias estão offline. Verifique a conexão WhatsApp.');
    }

    let enqueued = 0;
    let alreadySent = 0;

    for (const contact of contacts) {
      const personalizedMessage = applyMessageTemplate(dispatch.message_template, contact.name);

      const dispatchItem = await ensureDispatchItem({
        dispatchId,
        contactId: contact.id,
        contactNumber: contact.phone_number,
        contactName: contact.name,
        messageType: 'marketing',
        messageSnapshot: personalizedMessage,
        maxAttempts: 1,
      });

      if (dispatchItem.status === 'sent' || (await isDispatchItemSent(dispatchId, contact.phone_number))) {
        alreadySent++;
        continue;
      }

      await pool.query(
        `INSERT INTO dispatch_contacts (dispatch_id, contact_number, contact_name, status)
         SELECT $1, $2, $3, 'pending'
         WHERE NOT EXISTS (
           SELECT 1 FROM dispatch_contacts
           WHERE dispatch_id = $1 AND contact_number = $2
         )`,
        [dispatchId, contact.phone_number, contact.name]
      );

      enqueued++;
      addLog(
        'info',
        `[Marketing ${dispatchId}] Enfileirado item ${dispatchItem.id} ${maskPhone(contact.phone_number)}`
      );
    }

    await pool.query(
      `UPDATE dispatches
       SET total_contacts = $1,
           contacts_processed = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [contacts.length, alreadySent, dispatchId]
    );

    const completeLog =
      `✅ Marketing ${dispatchId} enfileirado: ${enqueued} itens, ${alreadySent} já sent — worker processará ` +
      `(${countsLog})`;
    console.log(`   ${completeLog}`);
    addLog('success', `[Marketing ${dispatchId}] ${completeLog}`);

    if (adminNotifyPhone) {
      await sendAdminWhatsAppNotification(
        adminNotifyPhone,
        `✅ Disparo de Marketing "${dispatch.name}" enfileirado:\n📦 ${enqueued} itens no worker` +
          (audience.counts.needs_whatsapp_validation > 0
            ? `\n⚠️ ${audience.counts.needs_whatsapp_validation} pendentes de validação WhatsApp`
            : '')
      );
    }
  } catch (error: any) {
    console.error(`❌ Erro ao processar disparo de marketing:`, error);
    if (error instanceof DispatchOperationalError) {
      addLog('error', `[Marketing ${dispatchId}] ${error.message}`);
    } else if (error?.message === PENDING_WHATSAPP_VALIDATION_MESSAGE) {
      addLog('warning', `[Marketing ${dispatchId}] ${error.message}`);
      return;
    }
    await pool.query(
      `UPDATE dispatches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [dispatchId]
    );
  }
}
