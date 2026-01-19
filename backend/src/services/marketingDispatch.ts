import { pool } from '../database';
import axios from 'axios';
import { applyBlindage } from './blindage';

/**
 * Serviço para processar disparos de marketing
 * Suporta texto, imagem e PDF
 */

interface MarketingDispatchParams {
  dispatchId: number;
  instanceIds?: number[];
}

/**
 * Processar e enviar disparo de marketing
 */
export async function processMarketingDispatch(params: MarketingDispatchParams): Promise<void> {
  const { dispatchId, instanceIds } = params;

  try {
    console.log(`📢 Iniciando processamento de disparo de marketing ID ${dispatchId}`);

    // Buscar dados do disparo
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

    // Verificar se já está processando ou concluído
    if (dispatch.status === 'completed' || dispatch.status === 'stopped') {
      console.log(`   ⚠️ Disparo já está em status: ${dispatch.status}`);
      return;
    }

    // Se já está running, verificar se realmente está processando ou se precisa continuar
    if (dispatch.status === 'running') {
      // Verificar se há mensagens já enviadas (indica que está processando)
      const messagesCheck = await pool.query(
        `SELECT COUNT(*) as count FROM dispatch_contacts WHERE dispatch_id = $1`,
        [dispatchId]
      );
      const messagesSent = parseInt(messagesCheck.rows[0]?.count || '0');
      
      if (messagesSent > 0) {
        console.log(`   ⚠️ Disparo já está sendo processado (${messagesSent} mensagens enviadas)`);
        return;
      }
      // Se não há mensagens, pode ser que o processamento anterior falhou, então continuar
      console.log(`   ℹ️ Disparo em status 'running' mas sem mensagens, continuando processamento...`);
    }

    // Atualizar status para running
    await pool.query(
      `UPDATE dispatches SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [dispatchId]
    );

    // Buscar contatos
    let contacts: any[] = [];

    if (dispatch.list_id) {
      // Buscar contatos da lista
      const listResult = await pool.query(
        `SELECT * FROM contact_lists WHERE id = $1`,
        [dispatch.list_id]
      );

      if (listResult.rows.length === 0) {
        throw new Error(`Lista ${dispatch.list_id} não encontrada`);
      }

      const list = listResult.rows[0];
      contacts = await getContactsFromList(list);
    } else if (dispatch.contact_ids && Array.isArray(dispatch.contact_ids)) {
      // Buscar contatos específicos
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

    // Buscar instâncias
    let instances: any[] = [];

    if (instanceIds && instanceIds.length > 0) {
      const instancesResult = await pool.query(
        `SELECT id, instance_name, api_url, api_key, phone_number
         FROM instances
         WHERE id = ANY($1::int[]) AND status = 'connected'`,
        [instanceIds]
      );
      instances = instancesResult.rows;
    } else {
      const instancesResult = await pool.query(
        `SELECT id, instance_name, api_url, api_key, phone_number
         FROM instances
         WHERE status = 'connected'
         ORDER BY last_message_sent_at ASC NULLS FIRST`
      );
      instances = instancesResult.rows;
    }

    if (instances.length === 0) {
      throw new Error('Nenhuma instância conectada disponível');
    }

    console.log(`   📱 ${instances.length} instância(s) disponível(is)`);

    // Parse metadata
    const metadata = typeof dispatch.metadata === 'string' 
      ? JSON.parse(dispatch.metadata) 
      : dispatch.metadata || {};

    const mediaUrl = metadata.media_url;
    const mediaType = metadata.media_type; // 'image', 'pdf', 'document'

    // Processar envio para cada contato
    let successCount = 0;
    let failedCount = 0;
    let instanceIndex = 0;

    const startTime = Date.now();
    let contactIndex = 0;

    for (const contact of contacts) {
      contactIndex++;
      const contactStartTime = Date.now();
      
      try {
        console.log(`\n   📤 [${contactIndex}/${contacts.length}] Processando contato: ${contact.phone_number} (${contact.name || 'Sem nome'})`);
        
        // Selecionar instância (rotação)
        const instance = instances[instanceIndex % instances.length];
        instanceIndex++;
        console.log(`      🔄 Usando instância: ${instance.instance_name} (ID: ${instance.id})`);

        // Aplicar blindagem
        const blindageStartTime = Date.now();
        const blindageResult = await applyBlindage({
          to: contact.phone_number,
          message: dispatch.message_template,
          instanceId: instance.id,
          messageType: 'marketing',
        });
        const blindageTime = Date.now() - blindageStartTime;
        console.log(`      🛡️ Blindagem aplicada em ${blindageTime}ms`);

        if (!blindageResult.canSend) {
          console.log(`      ⛔ BLOQUEADO pela blindagem: ${blindageResult.reason}`);
          failedCount++;
          continue;
        }

        // Aplicar delay
        if (blindageResult.delay && blindageResult.delay > 0) {
          const delaySeconds = Math.ceil(blindageResult.delay / 1000);
          console.log(`      ⏳ Aguardando delay de ${delaySeconds}s (${blindageResult.delay}ms)...`);
          const delayStartTime = Date.now();
          await new Promise(resolve => setTimeout(resolve, blindageResult.delay));
          const actualDelay = Date.now() - delayStartTime;
          console.log(`      ✅ Delay concluído (esperado: ${blindageResult.delay}ms, real: ${actualDelay}ms)`);
        } else {
          console.log(`      ⚠️ Nenhum delay configurado`);
        }

        // Enviar mensagem
        const sendStartTime = Date.now();
        if (mediaUrl && mediaType) {
          // Enviar com mídia
          console.log(`      📎 Enviando mensagem com mídia (${mediaType}): ${mediaUrl.substring(0, 50)}...`);
          await sendMessageWithMedia(
            instance,
            contact.phone_number,
            dispatch.message_template,
            mediaUrl,
            mediaType
          );
        } else {
          // Enviar apenas texto
          console.log(`      💬 Enviando mensagem de texto (${dispatch.message_template.length} caracteres)`);
          await sendTextMessage(
            instance,
            contact.phone_number,
            dispatch.message_template
          );
        }
        const sendTime = Date.now() - sendStartTime;
        console.log(`      ✅ Mensagem enviada em ${sendTime}ms`);

        // Registrar mensagem
        const messageResult = await pool.query(
          `INSERT INTO messages (
            instance_id, message_id, remote_jid, from_me,
            message_type, message_body, timestamp, status,
            dispatch_id, dispatch_type, contact_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id`,
          [
            instance.id,
            `temp-${Date.now()}-${contact.id}`,
            `${contact.phone_number}@s.whatsapp.net`,
            true,
            mediaType || 'text',
            dispatch.message_template,
            new Date(),
            'sent',
            dispatchId,
            'marketing',
            contact.id,
          ]
        );

        // Registrar no dispatch_contacts
        await pool.query(
          `INSERT INTO dispatch_contacts (
            dispatch_id, instance_id, contact_number, contact_name,
            message_sent_id, status, sent_at
          ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
          [
            dispatchId,
            instance.id,
            contact.phone_number,
            contact.name,
            messageResult.rows[0].id,
            'sent',
          ]
        );

        successCount++;
        const contactTotalTime = Date.now() - contactStartTime;
        const totalElapsed = Date.now() - startTime;
        const avgTimePerContact = totalElapsed / contactIndex;
        const estimatedRemaining = Math.ceil((avgTimePerContact * (contacts.length - contactIndex)) / 1000);
        
        console.log(`      ✅ SUCESSO! Tempo total: ${contactTotalTime}ms`);
        console.log(`      📊 Progresso: ${successCount}/${contacts.length} enviados | Tempo médio: ${Math.ceil(avgTimePerContact)}ms | Estimativa restante: ~${estimatedRemaining}s`);

        // Atualizar última mensagem enviada da instância
        await pool.query(
          `UPDATE instances
           SET last_message_sent_at = CURRENT_TIMESTAMP,
               last_activity_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [instance.id]
        );

      } catch (error: any) {
        console.error(`   ❌ Erro ao enviar para ${contact.phone_number}:`, error.message);
        failedCount++;
      }
    }

    // Atualizar status do disparo
    await pool.query(
      `UPDATE dispatches
       SET status = 'completed',
           contacts_processed = $1,
           contacts_success = $2,
           contacts_failed = $3,
           completed_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [contacts.length, successCount, failedCount, dispatchId]
    );

    const totalTime = Date.now() - startTime;
    const totalTimeSeconds = Math.ceil(totalTime / 1000);
    console.log(`\n   ✅ Disparo concluído: ${successCount} sucesso, ${failedCount} falhas`);
    console.log(`   ⏱️ Tempo total: ${totalTimeSeconds}s (${totalTime}ms)`);
    console.log(`   📊 Média: ${Math.ceil(totalTime / contacts.length)}ms por contato`);

    // Enviar notificação de conclusão (se configurado)
    const marketingConfigResult = await pool.query(
      `SELECT notification_phone FROM marketing_ai_config WHERE enabled = true ORDER BY id DESC LIMIT 1`
    );
    const notificationPhone = marketingConfigResult.rows[0]?.notification_phone;
    
    if (notificationPhone) {
      try {
        // Buscar uma instância para enviar notificação
        const instanceResult = await pool.query(
          `SELECT instance_name, api_url, api_key FROM instances WHERE status = 'connected' LIMIT 1`
        );
        
        if (instanceResult.rows.length > 0) {
          const instance = instanceResult.rows[0];
          await axios.post(
            `${instance.api_url}/message/sendText/${instance.instance_name}`,
            {
              number: notificationPhone,
              text: `✅ Disparo de Marketing "${dispatch.name}" concluído:\n\n📊 ${successCount} enviados\n❌ ${failedCount} falhas\n⏱️ Tempo total: ${totalTimeSeconds}s\n📈 Média: ${Math.ceil(totalTime / contacts.length)}ms por contato`,
            },
            {
              headers: {
                'apikey': instance.api_key,
                'Content-Type': 'application/json',
              },
            }
          );
          console.log(`   📲 Notificação de conclusão enviada para ${notificationPhone}`);
        }
      } catch (error: any) {
        console.error(`   ⚠️ Erro ao enviar notificação:`, error.message);
      }
    }

  } catch (error: any) {
    console.error(`❌ Erro ao processar disparo de marketing:`, error);
    
    // Atualizar status para failed
    await pool.query(
      `UPDATE dispatches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [dispatchId]
    );
  }
}

/**
 * Enviar mensagem de texto
 */
async function sendTextMessage(
  instance: any,
  phoneNumber: string,
  message: string
): Promise<any> {
  const sendMessageUrl = `${instance.api_url}/message/sendText/${instance.instance_name}`;

  const response = await axios.post(
    sendMessageUrl,
    {
      number: phoneNumber,
      text: message,
    },
    {
      headers: {
        'apikey': instance.api_key,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

/**
 * Enviar mensagem com mídia (imagem ou PDF)
 */
async function sendMessageWithMedia(
  instance: any,
  phoneNumber: string,
  caption: string,
  mediaUrl: string,
  mediaType: string
): Promise<any> {
  let endpoint = '';
  let payload: any = {
    number: phoneNumber,
  };

  if (mediaType === 'image') {
    endpoint = `/message/sendMedia/${instance.instance_name}`;
    payload.mediatype = 'image';
    payload.media = mediaUrl;
    payload.caption = caption;
  } else if (mediaType === 'pdf' || mediaType === 'document') {
    endpoint = `/message/sendMedia/${instance.instance_name}`;
    payload.mediatype = 'document';
    payload.media = mediaUrl;
    payload.caption = caption;
    payload.fileName = mediaUrl.split('/').pop() || 'documento.pdf';
  } else {
    throw new Error(`Tipo de mídia não suportado: ${mediaType}`);
  }

  const sendMessageUrl = `${instance.api_url}${endpoint}`;

  const response = await axios.post(
    sendMessageUrl,
    payload,
    {
      headers: {
        'apikey': instance.api_key,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

/**
 * Buscar contatos de uma lista (static, dynamic ou hybrid)
 */
async function getContactsFromList(list: any): Promise<any[]> {
  let query = '';
  let params: any[] = [];

  if (list.list_type === 'static') {
    // Lista estática
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
    // Lista dinâmica ou híbrida
    const filterConfig = list.filter_config || {};
    
    let whereConditions = ['c.whatsapp_validated = true', 'c.opt_in = true', 'c.opt_out = false'];
    let joinClauses = '';
    let paramCount = 1;

    // Tags incluídas
    if (filterConfig.tags && Array.isArray(filterConfig.tags) && filterConfig.tags.length > 0) {
      joinClauses += ` JOIN contact_tag_relations ctr${paramCount} ON c.id = ctr${paramCount}.contact_id`;
      whereConditions.push(`ctr${paramCount}.tag_id = ANY($${paramCount}::int[])`);
      params.push(filterConfig.tags);
      paramCount++;
    }

    // Tags excluídas
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

    // Se for híbrida, também incluir contatos da lista estática
    if (list.list_type === 'hybrid') {
      const hasDynamicFilters = (filterConfig.tags && Array.isArray(filterConfig.tags) && filterConfig.tags.length > 0) ||
                                (filterConfig.exclude_tags && Array.isArray(filterConfig.exclude_tags) && filterConfig.exclude_tags.length > 0);
      
      if (!hasDynamicFilters) {
        // Apenas lista estática
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
        // Tem filtros dinâmicos, combinar estática + dinâmica
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
