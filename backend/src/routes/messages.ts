import express from 'express';
import axios from 'axios';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { applyBlindage } from '../services/blindage';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

/**
 * Enviar mensagem com blindagem automática
 * POST /api/messages/send
 * 
 * Body:
 * {
 *   to: string (número do WhatsApp)
 *   message: string (texto da mensagem)
 *   instanceId?: number (opcional - instância preferida)
 *   messageType?: string (opcional - tipo: 'devocional', 'marketing', 'avulsa', etc.)
 * }
 */
router.post('/send', async (req: AuthRequest, res) => {
  try {
    const { to, message, instanceId, messageType } = req.body;

    if (!to || !message) {
      return res.status(400).json({ 
        error: 'Campos obrigatórios: to, message' 
      });
    }

    // Aplicar blindagem
    const blindageResult = await applyBlindage({
      to,
      message,
      instanceId,
      messageType: messageType || 'avulsa',
    });

    if (!blindageResult.canSend) {
      return res.status(403).json({
        error: 'Mensagem bloqueada pela blindagem',
        reason: blindageResult.reason,
        blockedBy: blindageResult.blockedBy,
      });
    }

    // Aplicar delay se necessário
    if (blindageResult.delay && blindageResult.delay > 0) {
      await new Promise(resolve => setTimeout(resolve, blindageResult.delay));
    }

    // Buscar dados da instância selecionada
    const instanceResult = await pool.query(
      `SELECT id, instance_name, api_url, api_key, status 
       FROM instances 
       WHERE id = $1`,
      [blindageResult.selectedInstanceId]
    );

    if (instanceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const instance = instanceResult.rows[0];

    if (instance.status !== 'connected') {
      return res.status(400).json({ 
        error: 'Instância não está conectada' 
      });
    }

    // Enviar mensagem via Evolution API
    const evolutionApiUrl = process.env.EVOLUTION_API_URL || instance.api_url;
    const evolutionApiKey = process.env.EVOLUTION_API_KEY || instance.api_key;

    const sendMessageUrl = `${evolutionApiUrl}/message/sendText/${instance.instance_name}`;

    const response = await axios.post(
      sendMessageUrl,
      {
        number: to,
        text: message,
      },
      {
        headers: {
          'apikey': evolutionApiKey,
          'Content-Type': 'application/json',
        },
      }
    );

    // Registrar mensagem no banco
    const messageResult = await pool.query(
      `INSERT INTO messages (
        instance_id, 
        message_id, 
        from_number, 
        to_number, 
        message_text, 
        message_type,
        from_me, 
        status, 
        timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        instance.id,
        response.data?.key?.id || `temp-${Date.now()}`,
        instance.phone_number || 'unknown',
        to,
        message,
        messageType || 'avulsa',
        true, // from_me
        'sent', // status inicial
        new Date(),
      ]
    );

    // Atualizar última mensagem enviada da instância
    await pool.query(
      `UPDATE instances 
       SET last_message_sent_at = CURRENT_TIMESTAMP,
           last_activity_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [instance.id]
    );

    res.json({
      success: true,
      message: {
        id: messageResult.rows[0].id,
        instanceId: instance.id,
        to,
        message,
        status: 'sent',
        evolutionResponse: response.data,
      },
      blindage: {
        delayApplied: blindageResult.delay || 0,
        instanceSelected: blindageResult.selectedInstanceId,
      },
    });
  } catch (error: any) {
    console.error('Erro ao enviar mensagem:', error);

    // Se a mensagem foi bloqueada pela blindagem, não é erro do sistema
    if (error.response?.status === 403 && error.response?.data?.error?.includes('bloqueada')) {
      return res.status(403).json({
        error: 'Mensagem bloqueada pela blindagem',
        reason: error.response.data.reason,
      });
    }

    res.status(500).json({
      error: 'Erro ao enviar mensagem',
      message: error.message,
    });
  }
});

/**
 * Listar mensagens
 * GET /api/messages
 */
router.get('/', async (req: AuthRequest, res) => {
  try {
    const { instanceId, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        m.*,
        i.name as instance_name,
        i.instance_name as instance_identifier
      FROM messages m
      LEFT JOIN instances i ON m.instance_id = i.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (instanceId) {
      query += ` AND m.instance_id = $${paramCount}`;
      params.push(instanceId);
      paramCount++;
    }

    query += ` ORDER BY m.timestamp DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await pool.query(query, params);

    res.json({
      messages: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    console.error('Erro ao listar mensagens:', error);
    res.status(500).json({ error: 'Erro ao listar mensagens' });
  }
});

/**
 * Buscar mensagem por ID
 * GET /api/messages/:id
 */
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        m.*,
        i.name as instance_name,
        i.instance_name as instance_identifier
      FROM messages m
      LEFT JOIN instances i ON m.instance_id = i.id
      WHERE m.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Mensagem não encontrada' });
    }

    res.json({ message: result.rows[0] });
  } catch (error) {
    console.error('Erro ao buscar mensagem:', error);
    res.status(500).json({ error: 'Erro ao buscar mensagem' });
  }
});

export default router;
