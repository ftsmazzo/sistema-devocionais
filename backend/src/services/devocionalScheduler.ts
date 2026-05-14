import { pool } from '../database';
import axios from 'axios';
import { applyBlindage, recordBlindageSuccessfulSend } from './blindage';
import { withGlobalOutboundGate } from './globalOutboundGate';
import {
  loadDispatchPacingRuntime,
  maybeDispatchPacingPause,
  preferredInstanceIndexForDispatch,
} from './dispatchPacing';
import { personalizeDevocionalMessage, formatDevocionalMessage } from './devocionalPersonalization';
import { canReceiveDevocional, updateDevocionalScore } from './devocionalScoring';
import { addLog } from '../routes/logs';
import { pingInstanceHealth } from './retryQueue';
import { reconcileActiveJourneyForDate } from './journeyReconcile';

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
      await sendNotification(config.notification_phone, `⚠️ Disparo de devocional cancelado: não foi possível encontrar ou gerar o devocional para hoje (${finalDate}).`);
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

    // Buscar instâncias conectadas e verificar saúde REAL via ping
    const instancesResult = await pool.query(
      `SELECT id, instance_name, api_url, api_key, phone_number
       FROM instances
       WHERE status = 'connected'
       ORDER BY last_message_sent_at ASC NULLS FIRST`
    );

    if (instancesResult.rows.length === 0) {
      console.log('   ⚠️ Nenhuma instância conectada');
      addLog('warning', '[Devocional] Disparo cancelado: nenhuma instância WhatsApp conectada.');
      await sendNotification(config.notification_phone, `⚠️ Disparo de devocional cancelado: nenhuma instância conectada.`);
      return;
    }

    // Verificar saúde REAL de cada instância via ping
    const instances: any[] = [];
    for (const inst of instancesResult.rows) {
      const isOnline = await pingInstanceHealth(inst.id);
      if (isOnline) {
        instances.push(inst);
      } else {
        console.log(`   ⚠️ Instância ${inst.instance_name} offline no ping - ignorada`);
        addLog('warning', `[Devocional] Instância ${inst.instance_name} não respondeu ao ping - removida do disparo`);
      }
    }

    if (instances.length === 0) {
      console.log('   ⚠️ Nenhuma instância passóu no ping de saúde');
      addLog('warning', '[Devocional] Disparo cancelado: nenhuma instância respondeu ao ping.');
      await sendNotification(config.notification_phone, `⚠️ Disparo cancelado: todas as instâncias estão offline.`);
      return;
    }

    // Criar registro de disparo
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
    console.log(`   🚀 Disparo criado: ID ${dispatchId}`);

    // Enviar notificação de início
    await sendNotification(config.notification_phone, `🚀 Disparo de devocional iniciado: ${eligibleContacts.length} contatos.`);

    // Processar envio para cada contato
    let successCount = 0;
    let failedCount = 0;
    let instanceIndex = 0;

    const pacing = await loadDispatchPacingRuntime();

    for (const contact of eligibleContacts) {
      const preferredIdx = preferredInstanceIndexForDispatch(
        pacing,
        successCount,
        instanceIndex,
        instances.length
      );
      const instance = instances[preferredIdx];
      if (pacing.rotateEveryN <= 0) {
        instanceIndex++;
      }
      try {

        // Formatar mensagem personalizada
        const formattedDevocional = formatDevocionalMessage(devocional);
        const personalizedMessage = personalizeDevocionalMessage(
          formattedDevocional,
          contact.name,
          config.timezone
        );

        let aborted = false;
        await withGlobalOutboundGate(async () => {
          // Aplicar blindagem
          const blindageResult = await applyBlindage({
            to: contact.phone_number,
            message: personalizedMessage,
            instanceId: instance.id,
            messageType: 'devocional',
          });

          if (!blindageResult.canSend) {
            console.log(`   ⛔ Contato ${contact.phone_number} bloqueado pela blindagem: ${blindageResult.reason}`);
            failedCount++;
            try {
              await pool.query(
                `INSERT INTO dispatch_contacts (
                  dispatch_id, instance_id, contact_number, contact_name,
                  status, failed_reason
                ) VALUES ($1, $2, $3, $4, 'failed', $5)`,
                [
                  dispatchId,
                  instance.id,
                  contact.phone_number,
                  contact.name,
                  `Blindagem: ${blindageResult.reason || 'bloqueado'}`.slice(0, 500)
                ]
              );
              console.log(`   📝 Falha (blindagem) registrada em dispatch_contacts: ${contact.phone_number}`);
            } catch (insertErr: any) {
              console.error(`   ⚠️ Erro ao registrar bloqueio em dispatch_contacts:`, insertErr.message);
            }
            aborted = true;
            return;
          }

          // Aplicar delay
          if (blindageResult.delay && blindageResult.delay > 0) {
            const delaySeconds = Math.ceil(blindageResult.delay / 1000);
            const delayStartTime = Date.now();
            const delayLog = `⏳ [DELAY] Aguardando ${delaySeconds}s (${blindageResult.delay}ms) antes de enviar para ${contact.phone_number}`;
            console.log(`   ${delayLog}`);
            addLog('info', `[Devocional] ${delayLog}`);
            await new Promise(resolve => setTimeout(resolve, blindageResult.delay));
            const actualDelay = Date.now() - delayStartTime;
            const delayDiff = actualDelay - blindageResult.delay;
            if (Math.abs(delayDiff) > 100) {
              const delayWarn = `⚠️ [DELAY] ATENÇÃO: Esperado ${blindageResult.delay}ms, mas levou ${actualDelay}ms (diferença: ${delayDiff > 0 ? '+' : ''}${delayDiff}ms)`;
              console.log(`   ${delayWarn}`);
              addLog('warning', `[Devocional] ${delayWarn}`);
            } else {
              const delayOk = `✅ [DELAY] Concluído corretamente: ${actualDelay}ms`;
              console.log(`   ${delayOk}`);
              addLog('success', `[Devocional] ${delayOk}`);
            }
          } else {
            const noDelayWarn = `⚠️ [DELAY] NENHUM DELAY CONFIGURADO - Enviando imediatamente para ${contact.phone_number}!`;
            console.log(`   ${noDelayWarn}`);
            addLog('warning', `[Devocional] ${noDelayWarn}`);
          }

          // CRÍTICO: Atualizar last_message_sent_at ANTES de enviar para que o próximo cálculo de delay seja correto
          // Isso garante que o delay global seja respeitado mesmo com rotação de instâncias
          await pool.query(
            `UPDATE instances 
             SET last_message_sent_at = CURRENT_TIMESTAMP 
             WHERE id = $1`,
            [instance.id]
          );

          // Enviar mensagem
          const sendMessageUrl = `${instance.api_url}/message/sendText/${instance.instance_name}`;
          const response = await axios.post(
            sendMessageUrl,
            {
              number: contact.phone_number,
              text: personalizedMessage,
            },
            {
              headers: {
                'apikey': instance.api_key,
                'Content-Type': 'application/json',
              },
            }
          );

          // Registrar mensagem
          const messageResult = await pool.query(
            `INSERT INTO messages (
              instance_id, message_id, remote_jid, from_me,
              message_type, message_body, timestamp, status,
              dispatch_id, dispatch_type, contact_id, devocional_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id`,
            [
              instance.id,
              response.data?.key?.id || `temp-${Date.now()}`,
              `${contact.phone_number}@s.whatsapp.net`,
              true,
              'text',
              personalizedMessage,
              new Date(),
              'sent',
              dispatchId,
              'devocional',
              contact.id,
              devocionalId,
            ]
          );

          // Atualizar pontuação (enviado)
          await updateDevocionalScore(contact.id, 'sent');

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
          console.log(`   ✅ Enviado para ${contact.phone_number} (${successCount}/${eligibleContacts.length})`);

          // Atualizar última mensagem enviada da instância
          await pool.query(
            `UPDATE instances
             SET last_message_sent_at = CURRENT_TIMESTAMP,
                 last_activity_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [instance.id]
          );
          await recordBlindageSuccessfulSend({
            to: contact.phone_number,
            message: personalizedMessage,
            messageType: 'devocional',
          });
        });

        if (aborted) {
          continue;
        }

        await maybeDispatchPacingPause(pacing, successCount, `Devocional ${dispatchId}`);

      } catch (error: any) {
        const isInstanceError =
          error.code === 'ECONNREFUSED' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ENOTFOUND' ||
          (error.response?.status >= 500);

        console.error(`   ❌ Erro ao enviar para ${contact.phone_number}:`, error.message);
        failedCount++;
        try {
          if (isInstanceError) {
            // Marcar instância como offline
            await pool.query(
              `UPDATE instances SET status = 'disconnected', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
              [instance.id]
            );
            addLog('warning', `[Devocional] Instância ${instance.id} marcada como offline após falha de envio`);

            // Colocar na fila de retry
            await pool.query(
              `INSERT INTO dispatch_contacts (
                dispatch_id, instance_id, contact_number, contact_name,
                status, failed_reason, retry_count, last_retry_at, retry_instance_id
              ) VALUES ($1, $2, $3, $4, 'pending_retry', $5, 1, CURRENT_TIMESTAMP, $2)`,
              [
                dispatchId,
                instance.id,
                contact.phone_number,
                contact.name,
                `Instância offline: ${error.message}`.slice(0, 500)
              ]
            );
            console.log(`   🔄 Lead ${contact.phone_number} adicionado à fila de retry`);
            addLog('info', `[Devocional] Lead ${contact.phone_number} adicionado à fila de retry (instância offline)`);
          } else {
            // Erro real (número inválido, bloqueado, etc): falha definitiva
            await pool.query(
              `INSERT INTO dispatch_contacts (
                dispatch_id, instance_id, contact_number, contact_name,
                status, failed_reason
              ) VALUES ($1, $2, $3, $4, 'failed', $5)`,
              [
                dispatchId,
                instance.id,
                contact.phone_number,
                contact.name,
                (error.message || String(error)).slice(0, 500)
              ]
            );
          }
          console.log(`   📝 Falha registrada em dispatch_contacts: ${contact.phone_number}`);
        } catch (insertErr: any) {
          console.error(`   ⚠️ Erro ao registrar falha em dispatch_contacts:`, insertErr.message);
        }
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
      [eligibleContacts.length, successCount, failedCount, dispatchId]
    );

    console.log(`   ✅ Disparo concluído: ${successCount} sucesso, ${failedCount} falhas`);

    // Enviar notificação de conclusão
    await sendNotification(
      config.notification_phone,
      `✅ Disparo de devocional concluído: ${successCount} enviados, ${failedCount} falhas.`
    );

  } catch (error: any) {
    console.error('❌ Erro ao executar disparo automático de devocional:', error);
  }
}

/**
 * Enviar notificação via WhatsApp (se configurado)
 */
async function sendNotification(phone: string | null, message: string): Promise<void> {
  if (!phone) {
    return;
  }

  try {
    // Buscar primeira instância conectada
    const instanceResult = await pool.query(
      `SELECT instance_name, api_url, api_key
       FROM instances
       WHERE status = 'connected'
       LIMIT 1`
    );

    if (instanceResult.rows.length === 0) {
      return;
    }

    const instance = instanceResult.rows[0];
    const sendMessageUrl = `${instance.api_url}/message/sendText/${instance.instance_name}`;

    await axios.post(
      sendMessageUrl,
      {
        number: phone,
        text: message,
      },
      {
        headers: {
          'apikey': instance.api_key,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`   📲 Notificação enviada para ${phone}`);
  } catch (error: any) {
    console.error(`   ⚠️ Erro ao enviar notificação:`, error.message);
  }
}
