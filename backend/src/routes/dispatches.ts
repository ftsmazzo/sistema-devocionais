import express from 'express';
import axios from 'axios';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { applyBlindage } from '../services/blindage';
import { processMarketingDispatch } from '../services/marketingDispatch';
import { executeDevocionalDispatch } from '../services/devocionalScheduler';
import { personalizeDevocionalMessage, formatDevocionalMessage } from '../services/devocionalPersonalization';
import { canReceiveDevocional, updateDevocionalScore } from '../services/devocionalScoring';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

/**
 * Listar disparos
 * GET /api/dispatches
 */
router.get('/', async (req: AuthRequest, res) => {
  try {
    const { type, status, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        d.*,
        l.name as list_name,
        l.list_type as list_type,
        COUNT(DISTINCT dc.id) as contacts_processed_count
      FROM dispatches d
      LEFT JOIN contact_lists l ON d.list_id = l.id
      LEFT JOIN dispatch_contacts dc ON d.id = dc.dispatch_id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (type) {
      query += ` AND d.dispatch_type = $${paramCount}`;
      params.push(type);
      paramCount++;
    }

    if (status) {
      query += ` AND d.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    query += ` GROUP BY d.id, l.name, l.list_type ORDER BY d.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await pool.query(query, params);

    res.json({ 
      dispatches: result.rows,
      total: result.rows.length
    });
  } catch (error: any) {
    console.error('❌ Erro ao listar disparos:', error);
    res.status(500).json({ 
      error: 'Erro ao listar disparos',
      message: error.message 
    });
  }
});

/**
 * Buscar disparo por ID
 * GET /api/dispatches/:id
 */
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        d.*,
        l.name as list_name,
        l.list_type as list_type,
        dev.title as devocional_title,
        dev.date as devocional_date
       FROM dispatches d
       LEFT JOIN contact_lists l ON d.list_id = l.id
       LEFT JOIN devocionais dev ON d.devocional_id = dev.id
       WHERE d.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Disparo não encontrado' });
    }

    // Buscar estatísticas de contatos
    const statsResult = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
        COUNT(*) FILTER (WHERE status = 'read') as read,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'pending') as pending
       FROM dispatch_contacts
       WHERE dispatch_id = $1`,
      [id]
    );

    res.json({ 
      dispatch: result.rows[0],
      stats: statsResult.rows[0]
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar disparo:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar disparo',
      message: error.message 
    });
  }
});

/**
 * Criar disparo de Devocional
 * POST /api/dispatches/devocional
 */
router.post('/devocional', async (req: AuthRequest, res) => {
  try {
    const { name, list_id, devocional_id, instance_ids } = req.body;
    const userId = req.user?.id;

    if (!name || !list_id) {
      return res.status(400).json({ 
        error: 'Campos obrigatórios: name, list_id' 
      });
    }

    // Buscar devocional (se não fornecido, buscar do dia)
    let devocionalId = devocional_id;
    if (!devocionalId) {
      const today = new Date().toISOString().split('T')[0];
      const devocionalResult = await pool.query(
        `SELECT id FROM devocionais WHERE date = $1`,
        [today]
      );
      if (devocionalResult.rows.length === 0) {
        return res.status(404).json({ 
          error: 'Nenhum devocional encontrado para hoje' 
        });
      }
      devocionalId = devocionalResult.rows[0].id;
    }

    // Buscar devocional para pegar o texto
    const devocionalResult = await pool.query(
      `SELECT text, title, date FROM devocionais WHERE id = $1`,
      [devocionalId]
    );

    if (devocionalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Devocional não encontrado' });
    }

    const devocional = devocionalResult.rows[0];

    // Buscar lista e contar contatos
    const listResult = await pool.query(
      `SELECT * FROM contact_lists WHERE id = $1`,
      [list_id]
    );

    if (listResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    const list = listResult.rows[0];

    // Criar disparo
    const dispatchResult = await pool.query(
      `INSERT INTO dispatches (
        name, message_template, dispatch_type, list_id, devocional_id,
        instance_ids, total_contacts, status, created_by, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        name,
        devocional.text, // Template será personalizado na hora do envio
        'devocional',
        list_id,
        devocionalId,
        instance_ids || [],
        list.total_contacts || 0,
        'pending',
        userId,
        JSON.stringify({
          devocional_title: devocional.title,
          devocional_date: devocional.date
        })
      ]
    );

    res.json({ 
      success: true,
      dispatch: dispatchResult.rows[0],
      message: 'Disparo de devocional criado com sucesso'
    });
  } catch (error: any) {
    console.error('❌ Erro ao criar disparo de devocional:', error);
    res.status(500).json({ 
      error: 'Erro ao criar disparo',
      message: error.message 
    });
  }
});

/**
 * Criar disparo de Marketing
 * POST /api/dispatches/marketing
 */
router.post('/marketing', async (req: AuthRequest, res) => {
  try {
    const { 
      name, 
      message_template, 
      list_id, 
      contact_ids,
      instance_ids,
      blindage_config,
      metadata,
      media_url,
      media_type
    } = req.body;
    const userId = req.user?.id;

    if (!name || !message_template) {
      return res.status(400).json({ 
        error: 'Campos obrigatórios: name, message_template' 
      });
    }

    if (!list_id && (!contact_ids || contact_ids.length === 0)) {
      return res.status(400).json({ 
        error: 'É necessário fornecer list_id ou contact_ids' 
      });
    }

    let totalContacts = 0;

    // Se tem lista, buscar total
    if (list_id) {
      const listResult = await pool.query(
        `SELECT total_contacts FROM contact_lists WHERE id = $1`,
        [list_id]
      );
      if (listResult.rows.length > 0) {
        totalContacts = listResult.rows[0].total_contacts || 0;
      }
    } else if (contact_ids) {
      totalContacts = contact_ids.length;
    }

    // Criar disparo
    const dispatchResult = await pool.query(
      `INSERT INTO dispatches (
        name, message_template, dispatch_type, list_id, contact_ids,
        instance_ids, total_contacts, status, created_by, 
        blindage_config, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        name,
        message_template,
        'marketing',
        list_id || null,
        contact_ids || null,
        instance_ids || [],
        totalContacts,
        'pending',
        userId,
        JSON.stringify(blindage_config || {}),
        JSON.stringify({
          ...metadata,
          media_url,
          media_type
        })
      ]
    );

    res.json({ 
      success: true,
      dispatch: dispatchResult.rows[0],
      message: 'Disparo de marketing criado com sucesso'
    });
  } catch (error: any) {
    console.error('❌ Erro ao criar disparo de marketing:', error);
    res.status(500).json({ 
      error: 'Erro ao criar disparo',
      message: error.message 
    });
  }
});

/**
 * Iniciar disparo
 * POST /api/dispatches/:id/start
 */
router.post('/:id/start', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const dispatchResult = await pool.query(
      `SELECT * FROM dispatches WHERE id = $1`,
      [id]
    );

    if (dispatchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Disparo não encontrado' });
    }

    const dispatch = dispatchResult.rows[0];

    if (dispatch.status === 'running') {
      return res.status(400).json({ error: 'Disparo já está em execução' });
    }

    if (dispatch.status === 'completed') {
      return res.status(400).json({ error: 'Disparo já foi concluído' });
    }

    // Atualizar status com verificação de concorrência (evitar processamento duplicado)
    const updateResult = await pool.query(
      `UPDATE dispatches 
       SET status = 'running', started_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [id]
    );

    // Se não atualizou nenhuma linha, significa que já foi iniciado por outra requisição
    if (updateResult.rows.length === 0) {
      return res.status(400).json({ 
        error: 'Disparo já foi iniciado ou não está mais pendente',
        message: 'Este disparo já está sendo processado'
      });
    }

    // Iniciar processamento em background baseado no tipo
    if (dispatch.dispatch_type === 'marketing') {
      // Processar marketing em background (não bloqueia a resposta)
      processMarketingDispatch({
        dispatchId: parseInt(id),
        instanceIds: dispatch.instance_ids || undefined,
      }).catch((error) => {
        console.error(`❌ Erro ao processar disparo de marketing ${id}:`, error);
      });
    } else if (dispatch.dispatch_type === 'devocional') {
      // Disparo manual de devocional - processar imediatamente em background
      processDevocionalDispatchManually(parseInt(id)).catch((error) => {
        console.error(`❌ Erro ao processar disparo manual de devocional ${id}:`, error);
      });
    }

    res.json({ 
      success: true,
      message: 'Disparo iniciado',
      dispatch_id: id
    });
  } catch (error: any) {
    console.error('❌ Erro ao iniciar disparo:', error);
    res.status(500).json({ 
      error: 'Erro ao iniciar disparo',
      message: error.message 
    });
  }
});

/**
 * Parar disparo
 * POST /api/dispatches/:id/stop
 */
router.post('/:id/stop', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const dispatchResult = await pool.query(
      `SELECT * FROM dispatches WHERE id = $1`,
      [id]
    );

    if (dispatchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Disparo não encontrado' });
    }

    // Atualizar status
    await pool.query(
      `UPDATE dispatches 
       SET status = 'stopped', stopped_at = CURRENT_TIMESTAMP, stopped_by = $1
       WHERE id = $2`,
      [userId, id]
    );

    res.json({ 
      success: true,
      message: 'Disparo parado',
      dispatch_id: id
    });
  } catch (error: any) {
    console.error('❌ Erro ao parar disparo:', error);
    res.status(500).json({ 
      error: 'Erro ao parar disparo',
      message: error.message 
    });
  }
});

/**
 * Deletar disparo
 * DELETE /api/dispatches/:id
 */
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const dispatchResult = await pool.query(
      `SELECT status FROM dispatches WHERE id = $1`,
      [id]
    );

    if (dispatchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Disparo não encontrado' });
    }

    if (dispatchResult.rows[0].status === 'running') {
      return res.status(400).json({ 
        error: 'Não é possível deletar um disparo em execução. Pare o disparo primeiro.' 
      });
    }

    await pool.query(`DELETE FROM dispatches WHERE id = $1`, [id]);

    res.json({ 
      success: true,
      message: 'Disparo deletado com sucesso'
    });
  } catch (error: any) {
    console.error('❌ Erro ao deletar disparo:', error);
    res.status(500).json({ 
      error: 'Erro ao deletar disparo',
      message: error.message 
    });
  }
});

/**
 * Processar disparo manual de devocional
 */
async function processDevocionalDispatchManually(dispatchId: number): Promise<void> {
  try {
    console.log(`📖 Processando disparo manual de devocional ID ${dispatchId}`);

    // Buscar dados do disparo
    const dispatchResult = await pool.query(
      `SELECT d.*, l.total_contacts
       FROM dispatches d
       LEFT JOIN contact_lists l ON d.list_id = l.id
       WHERE d.id = $1`,
      [dispatchId]
    );

    if (dispatchResult.rows.length === 0) {
      throw new Error(`Disparo ${dispatchId} não encontrado`);
    }

    const dispatch = dispatchResult.rows[0];

    // Buscar devocional
    if (!dispatch.devocional_id) {
      // Se não tem devocional_id, buscar do dia
      const today = new Date().toISOString().split('T')[0];
      const devocionalResult = await pool.query(
        `SELECT id, title, text, versiculo_principal, versiculo_apoio, metadata
         FROM devocionais
         WHERE date = $1`,
        [today]
      );

      if (devocionalResult.rows.length === 0) {
        await pool.query(
          `UPDATE dispatches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [dispatchId]
        );
        console.log(`   ⚠️ Nenhum devocional encontrado para hoje`);
        return;
      }

      // Atualizar dispatch com devocional_id
      await pool.query(
        `UPDATE dispatches SET devocional_id = $1 WHERE id = $2`,
        [devocionalResult.rows[0].id, dispatchId]
      );
      dispatch.devocional_id = devocionalResult.rows[0].id;
    }

    const devocionalResult = await pool.query(
      `SELECT id, title, text, versiculo_principal, versiculo_apoio, metadata
       FROM devocionais
       WHERE id = $1`,
      [dispatch.devocional_id]
    );

    if (devocionalResult.rows.length === 0) {
      await pool.query(
        `UPDATE dispatches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [dispatchId]
      );
      console.log(`   ⚠️ Devocional ${dispatch.devocional_id} não encontrado`);
      return;
    }

    const devocional = devocionalResult.rows[0];
    const devocionalId = devocional.id;

    // Buscar lista de contatos
    if (!dispatch.list_id) {
      await pool.query(
        `UPDATE dispatches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [dispatchId]
      );
      console.log(`   ⚠️ Nenhuma lista configurada`);
      return;
    }

    const listResult = await pool.query(
      `SELECT * FROM contact_lists WHERE id = $1`,
      [dispatch.list_id]
    );

    if (listResult.rows.length === 0) {
      await pool.query(
        `UPDATE dispatches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [dispatchId]
      );
      console.log(`   ⚠️ Lista ${dispatch.list_id} não encontrada`);
      return;
    }

    const list = listResult.rows[0];

    // Buscar contatos da lista (usar mesma lógica do scheduler automático)
    let contactsQuery = '';
    let contactsParams: any[] = [];

    if (list.list_type === 'static') {
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
      const filterConfig = typeof list.filter_config === 'string' 
        ? JSON.parse(list.filter_config) 
        : (list.filter_config || {});
      
      let whereConditions = ['c.whatsapp_validated = true', 'c.opt_in = true', 'c.opt_out = false'];
      let joinClauses = '';
      let paramCount = 1;

      if (filterConfig.tags && Array.isArray(filterConfig.tags) && filterConfig.tags.length > 0) {
        joinClauses += ` JOIN contact_tag_relations ctr${paramCount} ON c.id = ctr${paramCount}.contact_id`;
        whereConditions.push(`ctr${paramCount}.tag_id = ANY($${paramCount}::int[])`);
        contactsParams.push(filterConfig.tags);
        paramCount++;
      }

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

      if (list.list_type === 'hybrid') {
        const hasDynamicFilters = (filterConfig.tags && Array.isArray(filterConfig.tags) && filterConfig.tags.length > 0) ||
                                  (filterConfig.exclude_tags && Array.isArray(filterConfig.exclude_tags) && filterConfig.exclude_tags.length > 0);
        
        if (!hasDynamicFilters) {
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

    if (contacts.length === 0) {
      await pool.query(
        `UPDATE dispatches SET status = 'completed', contacts_processed = 0, completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [dispatchId]
      );
      return;
    }

    // Filtrar contatos que podem receber devocional
    const eligibleContacts = [];
    for (const contact of contacts) {
      const canReceive = await canReceiveDevocional(contact.id);
      if (canReceive) {
        eligibleContacts.push(contact);
      }
    }

    console.log(`   ✅ ${eligibleContacts.length} contatos elegíveis após verificação de pontuação`);

    if (eligibleContacts.length === 0) {
      await pool.query(
        `UPDATE dispatches SET status = 'completed', contacts_processed = 0, completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [dispatchId]
      );
      return;
    }

    // Buscar instâncias
    let instances: any[] = [];

    if (dispatch.instance_ids && Array.isArray(dispatch.instance_ids) && dispatch.instance_ids.length > 0) {
      const instancesResult = await pool.query(
        `SELECT id, instance_name, api_url, api_key, phone_number
         FROM instances
         WHERE id = ANY($1::int[]) AND status = 'connected'`,
        [dispatch.instance_ids]
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
      await pool.query(
        `UPDATE dispatches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [dispatchId]
      );
      console.log('   ⚠️ Nenhuma instância conectada');
      return;
    }

    console.log(`   📱 ${instances.length} instância(s) disponível(is)`);

    // Buscar configuração para timezone
    const configResult = await pool.query(
      `SELECT timezone FROM devocional_config ORDER BY id DESC LIMIT 1`
    );
    const timezone = configResult.rows[0]?.timezone || 'America/Sao_Paulo';

    // Processar envio para cada contato
    let successCount = 0;
    let failedCount = 0;
    let instanceIndex = 0;

    for (const contact of eligibleContacts) {
      try {
        const instance = instances[instanceIndex % instances.length];
        instanceIndex++;

        const formattedDevocional = formatDevocionalMessage(devocional);
        const personalizedMessage = personalizeDevocionalMessage(
          formattedDevocional,
          contact.name,
          timezone
        );

        const blindageResult = await applyBlindage({
          to: contact.phone_number,
          message: personalizedMessage,
          instanceId: instance.id,
          messageType: 'devocional',
        });

        if (!blindageResult.canSend) {
          console.log(`   ⛔ Contato ${contact.phone_number} bloqueado pela blindagem: ${blindageResult.reason}`);
          failedCount++;
          // NÃO contar como falha de devocional se foi bloqueado pela blindagem antes de enviar
          // Só conta como falha se a mensagem foi enviada mas não foi entregue/lida
          continue;
        }

        if (blindageResult.delay && blindageResult.delay > 0) {
          await new Promise(resolve => setTimeout(resolve, blindageResult.delay));
        }

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

        await updateDevocionalScore(contact.id, 'sent');

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
        // Só contar como falha se a mensagem foi realmente enviada mas falhou
        // Se deu erro antes de enviar, não contar como falha de devocional
        // (updateDevocionalScore só deve ser chamado quando a mensagem foi enviada mas não entregue/lida)
      }
    }

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

    console.log(`   ✅ Disparo manual concluído: ${successCount} sucesso, ${failedCount} falhas`);

  } catch (error: any) {
    console.error(`❌ Erro ao processar disparo manual de devocional:`, error);
    
    await pool.query(
      `UPDATE dispatches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [dispatchId]
    );
  }
}

export default router;
