import { pool } from '../database';
import { personalizeDevocionalMessage, formatDevocionalMessage } from './devocionalPersonalization';
import { canReceiveDevocional } from './devocionalScoring';
import { addLog } from '../routes/logs';
import { pingInstanceHealth } from './retryQueue';
import { reconcileActiveJourneyForDate } from './journeyReconcile';
import { markInstanceOfflineInDb, notifyAdminInstanceOffline } from './dispatchRetry';
import { maskPhone } from './evolutionSafeSender';
import { ensureDispatchItem, isDispatchItemSent } from './dispatchItems';
import {
  assertDispatchPipelineAllowed,
  DispatchOperationalError,
} from './dispatchRuntimeConfig';
import { sendAdminWhatsAppNotification } from './adminWhatsAppNotify';

/**
 * Serviço de agendamento para disparo automático de devocionais
 * Executa diariamente no horário configurado
 */

interface DevocionalConfig {
  id: number;
  list_id: number | null;
  dispatch_hour: number;
  dispatch_minute: number;
  timezone: string;
  enabled: boolean;
  notification_phone: string | null;
}

/**
 * Executar disparo automático do devocional
 */
export async function executeDevocionalDispatch(): Promise<void> {
  try {
    addLog('info', '🚀 Iniciando disparo automático de devocional');
    console.log('📅 Iniciando verificação de disparo automático de devocional...');

    // Buscar configuração
    const configResult = await pool.query(
      `SELECT * FROM devocional_config WHERE enabled = true ORDER BY id DESC LIMIT 1`
    );

    if (configResult.rows.length === 0) {
      console.log('   ⚠️ Nenhuma configuração de devocional habilitada');
      return;
    }

    const config: DevocionalConfig = configResult.rows[0];

    // Verificar se é o horário correto (considerando timezone)
    const now = new Date();
    const timezone = config.timezone || 'America/Sao_Paulo';
    
    // Obter hora atual no timezone configurado
    const currentHour = parseInt(
      new Intl.DateTimeFormat('pt-BR', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      }).formatToParts(now).find(part => part.type === 'hour')?.value || '0',
      10
    );

    const currentMinute = parseInt(
      new Intl.DateTimeFormat('pt-BR', {
        timeZone: timezone,
        minute: 'numeric',
      }).formatToParts(now).find(part => part.type === 'minute')?.value || '0',
      10
    );

    // Verificar se é o horário configurado (com tolerância de 2 minutos para o cron que roda a cada minuto)
    if (currentHour !== config.dispatch_hour || Math.abs(currentMinute - config.dispatch_minute) > 2) {
      console.log(`   ⏰ Não é o horário de disparo (atual: ${currentHour}:${currentMinute}, configurado: ${config.dispatch_hour}:${config.dispatch_minute})`);
      return;
    }

    console.log(`   ✅ Horário de disparo detectado: ${config.dispatch_hour}:${config.dispatch_minute}`);

    try {
      assertDispatchPipelineAllowed();
    } catch (err: any) {
      if (err instanceof DispatchOperationalError) {
        console.log(`   ⛔ ${err.message}`);
        addLog('error', `[Devocional] ${err.message}`);
        return;
      }
      throw err;
    }

    // Buscar devocional do dia usando o timezone configurado (não UTC)
    // IMPORTANTE: Usar Intl.DateTimeFormat com locale 'en-CA' que retorna formato YYYY-MM-DD
    const dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const finalDate = dateFormatter.format(now);
    
    const utcDate = new Date().toISOString().split('T')[0];
    console.log(`   📅 Data no timezone ${timezone}: ${finalDate} (UTC seria: ${utcDate})`);
    addLog('info', `[Devocional] Buscando devocional para data: ${finalDate} (timezone: ${timezone}, UTC: ${utcDate})`);

    await reconcileActiveJourneyForDate(pool, finalDate);
    
    let devocionalResult = await pool.query(
      `SELECT id, title, text, versiculo_principal, versiculo_apoio, metadata
       FROM devocionais
       WHERE date = $1`,
      [finalDate]
    );

    if (devocionalResult.rows.length === 0) {
      console.log(`   ✨ Nenhum devocional encontrado para hoje (${finalDate}). Tentando gerar via IA...`);
      addLog('info', `[Devocional] Gerando devocional via IA para data: ${finalDate}`);
      
      try {
        const { DevocionalGenerator } = await import('./DevocionalGenerator');
        const generator = new DevocionalGenerator();
        await generator.generate(finalDate);
        
        // Buscar novamente após gerar
        devocionalResult = await pool.query(
          `SELECT id, title, text, versiculo_principal, versiculo_apoio, metadata
           FROM devocionais
           WHERE date = $1`,
          [finalDate]
        );
      } catch (genError: any) {
        console.error(`   ❌ Falha ao gerar devocional via IA:`, genError.message);
        addLog('error', `[Devocional] Falha na geração automática: ${genError.message}`);
      }
    }

    if (devocionalResult.rows.length === 0) {
      console.log(`   ⚠️ Disparo abortado: devocional não disponível para ${finalDate}`);
      addLog('warning', `[Devocional] Disparo cancelado: devocional não disponível para data: ${finalDate}`);
      await sendAdminWhatsAppNotification(config.notification_phone, `⚠️ Disparo de devocional cancelado: não foi possível encontrar ou gerar o devocional para hoje (${finalDate}).`);
      return;
    }

    const devocional = devocionalResult.rows[0];
    const devocionalId = devocional.id;
    console.log(`   ✅ Devocional encontrado: ID ${devocionalId} - ${devocional.title}`);
    addLog('info', `[Devocional] Devocional encontrado: ID ${devocionalId}`);

    // Verificar se já existe um disparo para este devocional hoje (evitar duplicação)
    const existingDispatch = await pool.query(
      `SELECT id, status FROM dispatches 
       WHERE dispatch_type = 'devocional' 
         AND devocional_id = $1
         AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE $2) = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [devocionalId, timezone, finalDate]
    );

    if (existingDispatch.rows.length > 0) {
      const existing = existingDispatch.rows[0];
      console.log(`   ⚠️ Já existe um disparo de devocional para hoje (ID: ${existing.id}, status: ${existing.status})`);
      addLog('info', `[Devocional] Disparo já existente para hoje - ID ${existing.id}, status: ${existing.status}`);
      return;
    }

    console.log(`   ✅ Nenhum disparo anterior para hoje; prosseguindo.`);
    addLog('info', '[Devocional] Nenhum disparo anterior; prosseguindo.');

    // Buscar lista de contatos
    if (!config.list_id) {
      console.log('   ⚠️ Nenhuma lista configurada');
      addLog('warning', '[Devocional] Disparo cancelado: nenhuma lista configurada em Configuração Devocional.');
      return;
    }
    console.log(`   📋 Lista configurada: ID ${config.list_id}`);

    const listResult = await pool.query(
      `SELECT * FROM contact_lists WHERE id = $1`,
      [config.list_id]
    );

    if (listResult.rows.length === 0) {
      console.log(`   ⚠️ Lista ${config.list_id} não encontrada`);
      addLog('warning', `[Devocional] Lista ${config.list_id} não encontrada.`);
      return;
    }

    const list = listResult.rows[0];

    // Buscar contatos da lista (apenas os que podem receber devocional)
    let contactsQuery = '';
    let contactsParams: any[] = [];

    if (list.list_type === 'static') {
      // Lista estática
      contactsQuery = `
        SELECT DISTINCT c.id, c.phone_number, c.name
        FROM contacts c
        JOIN contact_list_items cli ON c.id = cli.contact_id
        WHERE cli.list_id = $1
          AND c.whatsapp_validated = true
          AND c.opt_in = true
          AND c.opt_out = false
      `;
      contactsParams = [list.id];
    } else {
      // Lista dinâmica ou híbrida - usar filter_config
      const filterConfig = typeof list.filter_config === 'string' 
        ? JSON.parse(list.filter_config) 
        : (list.filter_config || {});
      
      let whereConditions = ['c.whatsapp_validated = true', 'c.opt_in = true', 'c.opt_out = false'];
      let joinClauses = '';
      let paramCount = 1;

      // Tags incluídas
      if (filterConfig.tags && Array.isArray(filterConfig.tags) && filterConfig.tags.length > 0) {
        joinClauses += ` JOIN contact_tag_relations ctr${paramCount} ON c.id = ctr${paramCount}.contact_id`;
        whereConditions.push(`ctr${paramCount}.tag_id = ANY($${paramCount}::int[])`);
        contactsParams.push(filterConfig.tags);
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
        contactsParams.push(filterConfig.exclude_tags);
        paramCount++;
      }

      // Se for híbrida, também incluir contatos da lista estática
      if (list.list_type === 'hybrid') {
        // Se não há filtros dinâmicos (apenas básicos), buscar apenas da lista estática
        const hasDynamicFilters = (filterConfig.tags && Array.isArray(filterConfig.tags) && filterConfig.tags.length > 0) ||
                                  (filterConfig.exclude_tags && Array.isArray(filterConfig.exclude_tags) && filterConfig.exclude_tags.length > 0);
        
        if (!hasDynamicFilters) {
          // Apenas lista estática
          contactsQuery = `
            SELECT DISTINCT c.id, c.phone_number, c.name
            FROM contacts c
            JOIN contact_list_items cli ON c.id = cli.contact_id
            WHERE cli.list_id = $1
              AND c.whatsapp_validated = true
              AND c.opt_in = true
              AND c.opt_out = false
          `;
          contactsParams = [list.id];
        } else {
          // Tem filtros dinâmicos, combinar estática + dinâmica
          contactsQuery = `
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
          contactsParams.push(list.id);
        }
      } else {
        // Lista dinâmica pura
        contactsQuery = `
          SELECT DISTINCT c.id, c.phone_number, c.name
          FROM contacts c
          ${joinClauses}
          WHERE ${whereConditions.join(' AND ')}
        `;
      }
    }

    const contactsResult = await pool.query(contactsQuery, contactsParams);
    const contacts = contactsResult.rows;

    console.log(`   📋 ${contacts.length} contatos encontrados na lista`);
    addLog('info', `[Devocional] ${contacts.length} contatos na lista.`);

    if (contacts.length === 0) {
      console.log('   ⚠️ Nenhum contato na lista (ou lista vazia).');
      addLog('warning', '[Devocional] Nenhum contato na lista. Adicione contatos à lista ou verifique filtros.');
      return;
    }

    // Filtrar contatos que podem receber devocional (verificação de pontuação)
    const eligibleContacts = [];
    for (const contact of contacts) {
      const canReceive = await canReceiveDevocional(contact.id);
      if (canReceive) {
        eligibleContacts.push(contact);
      }
    }

    console.log(`   ✅ ${eligibleContacts.length} contatos elegíveis após verificação de pontuação`);

    if (eligibleContacts.length === 0) {
      console.log('   ⚠️ Nenhum contato elegível após verificação de pontuação');
      addLog('warning', '[Devocional] Nenhum contato elegível (pontuação/bloqueio).');
      return;
    }

    // Verificar instâncias (pré-checagem; o worker envia de fato)
    const instancesResult = await pool.query(
      `SELECT id, instance_name, api_url, api_key, phone_number
       FROM instances
       WHERE status = 'connected'
       ORDER BY last_message_sent_at ASC NULLS FIRST`
    );

    if (instancesResult.rows.length === 0) {
      console.log('   ⚠️ Nenhuma instância conectada');
      addLog('warning', '[Devocional] Disparo cancelado: nenhuma instância WhatsApp conectada.');
      await sendAdminWhatsAppNotification(
        config.notification_phone,
        `⚠️ Disparo de devocional cancelado: nenhuma instância conectada.`
      );
      return;
    }

    const instances: any[] = [];
    for (const inst of instancesResult.rows) {
      const isOnline = await pingInstanceHealth(inst.id);
      if (isOnline) {
        instances.push(inst);
      } else {
        console.log(`   ⚠️ Instância ${inst.instance_name} offline no ping - ignorada`);
        addLog('warning', `[Devocional] Instância ${inst.instance_name} não respondeu ao ping - removida do disparo`);
        await markInstanceOfflineInDb(inst.id);
        await notifyAdminInstanceOffline(
          config.notification_phone,
          inst.instance_name,
          'Falha no ping antes do disparo',
          sendAdminWhatsAppNotification
        );
      }
    }

    if (instances.length === 0) {
      console.log('   ⚠️ Nenhuma instância passou no ping de saúde');
      addLog('warning', '[Devocional] Disparo cancelado: nenhuma instância respondeu ao ping.');
      await sendAdminWhatsAppNotification(
        config.notification_phone,
        `⚠️ Disparo cancelado: todas as instâncias estão offline.`
      );
      return;
    }

    const dispatchResult = await pool.query(
      `INSERT INTO dispatches (
        name, message_template, dispatch_type, list_id,
        devocional_id, total_contacts, status, started_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8::jsonb)
      RETURNING id`,
      [
        `Devocional ${new Date().toLocaleDateString('pt-BR', { timeZone: timezone })}`,
        formatDevocionalMessage(devocional),
        'devocional',
        config.list_id,
        devocionalId,
        eligibleContacts.length,
        'running',
        JSON.stringify({
          devocional_trigger: 'scheduled',
          devocional_title: devocional.title,
          devocional_date: devocional.date,
        }),
      ]
    );

    const dispatchId = dispatchResult.rows[0].id;
    console.log(`   🚀 Disparo criado: ID ${dispatchId} (enqueue → worker)`);

    await sendAdminWhatsAppNotification(
      config.notification_phone,
      `🚀 Disparo de devocional enfileirado: ${eligibleContacts.length} contatos (worker).`
    );

    let enqueued = 0;
    let alreadySent = 0;

    for (const contact of eligibleContacts) {
      const formattedDevocional = formatDevocionalMessage(devocional);
      const personalizedMessage = personalizeDevocionalMessage(
        formattedDevocional,
        contact.name,
        config.timezone
      );

      const dispatchItem = await ensureDispatchItem({
        dispatchId,
        contactId: contact.id,
        contactNumber: contact.phone_number,
        contactName: contact.name,
        messageType: 'devocional',
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
        `[Devocional] Enfileirado item ${dispatchItem.id} ${maskPhone(contact.phone_number)}`
      );
    }

    await pool.query(
      `UPDATE dispatches
       SET total_contacts = $1,
           contacts_processed = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [eligibleContacts.length, alreadySent, dispatchId]
    );

    console.log(
      `   ✅ Enfileiramento concluído: ${enqueued} itens, ${alreadySent} já sent — worker processará`
    );
    addLog(
      'success',
      `[Devocional] Dispatch ${dispatchId}: ${enqueued} enfileirados, ${alreadySent} já enviados`
    );

    await sendAdminWhatsAppNotification(
      config.notification_phone,
      `✅ Devocional ${dispatchId} enfileirado: ${enqueued} itens no worker.`
    );

  } catch (error: any) {
    console.error('❌ Erro ao executar disparo automático de devocional:', error);
  }
}
