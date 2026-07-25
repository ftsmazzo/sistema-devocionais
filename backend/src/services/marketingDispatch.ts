/**
 * Enfileira disparos de marketing em dispatch_items.
 * O worker PostgreSQL é o único executor de envio.
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

    let contacts: any[] = [];

    if (dispatch.list_id) {
      const listResult = await pool.query(`SELECT * FROM contact_lists WHERE id = $1`, [
        dispatch.list_id,
      ]);
      if (listResult.rows.length === 0) {
        throw new Error(`Lista ${dispatch.list_id} não encontrada`);
      }
      contacts = await getContactsFromList(listResult.rows[0]);
    } else if (dispatch.contact_ids && Array.isArray(dispatch.contact_ids)) {
      const contactsResult = await pool.query(
        `SELECT id, phone_number, name, whatsapp_validated, opt_in, opt_out
         FROM contacts
         WHERE id = ANY($1::int[])
           AND whatsapp_validated = true
           AND opt_in = true
           AND opt_out = false`,
        [dispatch.contact_ids]
      );
      contacts = contactsResult.rows;
    }

    console.log(`   📋 ${contacts.length} contatos encontrados`);

    if (contacts.length === 0) {
      await pool.query(
        `UPDATE dispatches SET status = 'completed', contacts_processed = 0, completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [dispatchId]
      );
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

    const completeLog = `✅ Marketing ${dispatchId} enfileirado: ${enqueued} itens, ${alreadySent} já sent — worker processará`;
    console.log(`   ${completeLog}`);
    addLog('success', `[Marketing ${dispatchId}] ${completeLog}`);

    if (adminNotifyPhone) {
      await sendAdminWhatsAppNotification(
        adminNotifyPhone,
        `✅ Disparo de Marketing "${dispatch.name}" enfileirado:\n📦 ${enqueued} itens no worker`
      );
    }
  } catch (error: any) {
    console.error(`❌ Erro ao processar disparo de marketing:`, error);
    if (error instanceof DispatchOperationalError) {
      addLog('error', `[Marketing ${dispatchId}] ${error.message}`);
    }
    await pool.query(
      `UPDATE dispatches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [dispatchId]
    );
  }
}

async function getContactsFromList(list: any): Promise<any[]> {
  let query = '';
  let params: any[] = [];

  if (list.list_type === 'static') {
    query = `
      SELECT DISTINCT c.id, c.phone_number, c.name
      FROM contacts c
      JOIN contact_list_items cli ON c.id = cli.contact_id
      WHERE cli.list_id = $1
        AND c.whatsapp_validated = true
        AND c.opt_in = true
        AND c.opt_out = false
    `;
    params = [list.id];
  } else {
    const filterConfig = list.filter_config || {};

    let whereConditions = ['c.whatsapp_validated = true', 'c.opt_in = true', 'c.opt_out = false'];
    let joinClauses = '';
    let paramCount = 1;

    if (filterConfig.tags && Array.isArray(filterConfig.tags) && filterConfig.tags.length > 0) {
      joinClauses += ` JOIN contact_tag_relations ctr${paramCount} ON c.id = ctr${paramCount}.contact_id`;
      whereConditions.push(`ctr${paramCount}.tag_id = ANY($${paramCount}::int[])`);
      params.push(filterConfig.tags);
      paramCount++;
    }

    if (filterConfig.exclude_tags && Array.isArray(filterConfig.exclude_tags) && filterConfig.exclude_tags.length > 0) {
      whereConditions.push(`NOT EXISTS (
        SELECT 1 FROM contact_tag_relations ctr_ex
        JOIN contact_tags t_ex ON ctr_ex.tag_id = t_ex.id
        WHERE ctr_ex.contact_id = c.id
          AND t_ex.id = ANY($${paramCount}::int[])
      )`);
      params.push(filterConfig.exclude_tags);
      paramCount++;
    }

    query = `
      SELECT DISTINCT c.id, c.phone_number, c.name
      FROM contacts c
      ${joinClauses}
      WHERE ${whereConditions.join(' AND ')}
    `;

    if (list.list_type === 'hybrid') {
      const hasDynamicFilters =
        (filterConfig.tags && Array.isArray(filterConfig.tags) && filterConfig.tags.length > 0) ||
        (filterConfig.exclude_tags &&
          Array.isArray(filterConfig.exclude_tags) &&
          filterConfig.exclude_tags.length > 0);

      if (!hasDynamicFilters) {
        query = `
          SELECT DISTINCT c.id, c.phone_number, c.name
          FROM contacts c
          JOIN contact_list_items cli ON c.id = cli.contact_id
          WHERE cli.list_id = $1
            AND c.whatsapp_validated = true
            AND c.opt_in = true
            AND c.opt_out = false
        `;
        params = [list.id];
      } else {
        query = `
          SELECT DISTINCT c.id, c.phone_number, c.name
          FROM contacts c
          WHERE (
            c.id IN (
              SELECT contact_id FROM contact_list_items WHERE list_id = $${paramCount}
            )
            OR c.id IN (
              SELECT DISTINCT c2.id
              FROM contacts c2
              ${joinClauses}
              WHERE ${whereConditions.join(' AND ')}
            )
          )
        `;
        params.push(list.id);
      }
    }
  }

  const result = await pool.query(query, params);
  return result.rows;
}
