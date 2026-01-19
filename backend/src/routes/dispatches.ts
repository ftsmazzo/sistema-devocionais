import express from 'express';
import axios from 'axios';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { applyBlindage } from '../services/blindage';

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

    // Atualizar status
    await pool.query(
      `UPDATE dispatches 
       SET status = 'running', started_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    // TODO: Iniciar processamento em background
    // Por enquanto, apenas atualiza o status

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

export default router;
