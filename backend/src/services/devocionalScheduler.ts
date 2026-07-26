import { pool } from '../database';
import { personalizeDevocionalMessage, formatDevocionalMessage } from './devocionalPersonalization';
import { canReceiveDevocional } from './devocionalScoring';
import { addLog } from '../routes/logs';
import { pingInstanceHealth } from './retryQueue';
import { reconcileActiveJourneyForDate } from './journeyReconcile';
import { markInstanceOfflineInDb, notifyAdminInstanceOffline } from './dispatchRetry';
import { maskPhone } from './evolutionSafeSender';
import { ensureDispatchItemsBatch, isDispatchItemSent } from './dispatchItems';
import {
  assertDispatchPipelineAllowed,
  DispatchOperationalError,
} from './dispatchRuntimeConfig';
import { sendAdminWhatsAppNotification } from './adminWhatsAppNotify';
import {
  autoValidateWhatsAppBatch,
  isWhatsAppAutoValidateOnPrepare,
  resolveListAudience,
} from './listAudienceResolver';
import { normalizePhoneDigits } from '../utils/phoneNumber';

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

    let audience = await resolveListAudience(list);

    if (isWhatsAppAutoValidateOnPrepare() && audience.needs_whatsapp_validation.length > 0) {
      addLog(
        'info',
        `[Devocional] Auto-validação WhatsApp no prepare: ${audience.needs_whatsapp_validation.length} pendentes`
      );
      const batch = await autoValidateWhatsAppBatch(audience.needs_whatsapp_validation);
      addLog(
        'info',
        `[Devocional] Validação lote: ok=${batch.validated} inválidos=${batch.invalid} provider_err=${batch.provider_errors}`
      );
      audience = await resolveListAudience(list);
    }

    console.log(
      `   📋 Público: potencial=${audience.counts.total_potential} elegíveis=${audience.counts.eligible_now} ` +
        `pendentes_wa=${audience.counts.needs_whatsapp_validation} opt_out=${audience.counts.excluded_opt_out}`
    );
    addLog(
      'info',
      `[Devocional] Público potencial=${audience.counts.total_potential}, elegíveis agora=${audience.counts.eligible_now}, ` +
        `pendentes WhatsApp=${audience.counts.needs_whatsapp_validation}`
    );

    if (audience.counts.needs_whatsapp_validation > 0 && !isWhatsAppAutoValidateOnPrepare()) {
      addLog(
        'warning',
        `[Devocional] ${audience.counts.needs_whatsapp_validation} contatos aguardam validação WhatsApp ` +
          `(WHATSAPP_AUTO_VALIDATE_ON_PREPARE=false)`
      );
    }

    if (audience.counts.total_potential === 0) {
      console.log('   ⚠️ Nenhum contato potencial na lista.');
      addLog('warning', '[Devocional] Nenhum contato potencial na lista. Verifique filtros.');
      return;
    }

    // Filtrar elegíveis com pontuação adicional (já coberta no resolver; reforço)
    const eligibleContacts = [];
    for (const contact of audience.eligible_now) {
      const canReceive = await canReceiveDevocional(contact.id);
      if (canReceive) {
        eligibleContacts.push(contact);
      }
    }

    console.log(`   ✅ ${eligibleContacts.length} contatos elegíveis após verificação de pontuação`);

    if (eligibleContacts.length === 0) {
      console.log('   ⚠️ Nenhum contato elegível agora (podem existir pendentes de validação WhatsApp)');
      addLog(
        'warning',
        `[Devocional] Nenhum elegível agora. Pendentes WA=${audience.counts.needs_whatsapp_validation}, ` +
          `opt_out=${audience.counts.excluded_opt_out}, sem_opt_in=${audience.counts.excluded_no_opt_in}`
      );
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

    const batch = await ensureDispatchItemsBatch({
      dispatchId,
      contacts: eligibleContacts,
      messageType: 'devocional',
      maxAttempts: 1,
      buildSnapshot: (contact) =>
        personalizeDevocionalMessage(
          formatDevocionalMessage(devocional),
          contact.name ?? null,
          config.timezone
        ),
    });

    if (batch.expected !== eligibleContacts.length || batch.total < eligibleContacts.length) {
      const msg =
        `Enfileiramento incompleto: elegíveis=${eligibleContacts.length}, ` +
        `únicos=${batch.expected}, dispatch_items=${batch.total}`;
      addLog('error', `[Devocional] Dispatch ${dispatchId}: ${msg}`);
      throw new Error(msg);
    }

    for (const contact of eligibleContacts) {
      const phone = normalizePhoneDigits(contact.phone_number || '', '55');
      if (await isDispatchItemSent(dispatchId, phone)) {
        alreadySent++;
        continue;
      }

      await pool.query(
        `INSERT INTO dispatch_contacts (dispatch_id, contact_number, contact_name, status)
         SELECT $1::int, $2::varchar(50), $3::varchar(255), 'pending'
         WHERE NOT EXISTS (
           SELECT 1 FROM dispatch_contacts
           WHERE dispatch_id = $4::int AND contact_number = $5::varchar(50)
         )`,
        [dispatchId, phone, contact.name, dispatchId, phone]
      );

      enqueued++;
      addLog(
        'info',
        `[Devocional] Enfileirado ${maskPhone(phone)} (created=${batch.created}, reused=${batch.reused})`
      );
    }

    await pool.query(
      `UPDATE dispatches
       SET total_contacts = $1,
           contacts_processed = $2,
           status = 'running',
           completed_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [eligibleContacts.length, alreadySent, dispatchId]
    );

    console.log(
      `   ✅ Enfileiramento concluído: created=${batch.created} reused=${batch.reused} total_items=${batch.total} ` +
        `(contacts_enqueued=${enqueued}, already_sent=${alreadySent}) — worker processará`
    );
    addLog(
      'success',
      `[Devocional] Dispatch ${dispatchId}: items=${batch.total} created=${batch.created} reused=${batch.reused}`
    );

    await sendAdminWhatsAppNotification(
      config.notification_phone,
      `✅ Devocional ${dispatchId} enfileirado: ${batch.total} itens no worker.`
    );

  } catch (error: any) {
    console.error('❌ Erro ao executar disparo automático de devocional:', error);
  }
}
