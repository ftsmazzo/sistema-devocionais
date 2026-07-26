/**
 * Envio avulso — NÃO é caminho de campanha.
 * Por padrão bloqueado. Campanha usa: Disparos / personalizada / Operação Devocional → worker.
 * Não usa applyBlindage.
 */
import express from 'express';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { sendEvolutionTextSafely } from '../services/evolutionSafeSender';

const router = express.Router();

router.use(authenticateToken);

function isDirectOperationalMessagesAllowed(): boolean {
  const v = String(process.env.ALLOW_DIRECT_OPERATIONAL_MESSAGES || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(v);
}

/**
 * POST /api/messages/send
 * Bloqueado por padrão (ALLOW_DIRECT_OPERATIONAL_MESSAGES=false).
 * Se liberado via ENV, exige instanceId e envia só via evolutionSafeSender.
 */
router.post('/send', async (req: AuthRequest, res) => {
  try {
    if (!isDirectOperationalMessagesAllowed()) {
      return res.status(403).json({
        error: 'Envio avulso desativado',
        message:
          'Use Disparos, Mensagens Personalizadas ou Operação Devocional. O worker é o caminho oficial de campanha.',
        code: 'DIRECT_SEND_DISABLED',
        allow_direct_operational_messages: false,
      });
    }

    const { to, message, instanceId, messageType } = req.body;
    if (!to || !message) {
      return res.status(400).json({ error: 'Campos obrigatórios: to, message' });
    }
    if (!instanceId) {
      return res.status(400).json({
        error: 'instanceId obrigatório para envio avulso (quando liberado)',
      });
    }

    const sendResult = await sendEvolutionTextSafely({
      instanceId: Number(instanceId),
      number: to,
      text: message,
      messageType: messageType || 'avulsa',
    });

    const instanceRow = await pool.query(`SELECT id, phone_number FROM instances WHERE id = $1`, [
      sendResult.instanceId,
    ]);
    const instancePhone = instanceRow.rows[0]?.phone_number || 'unknown';

    const messageResult = await pool.query(
      `INSERT INTO messages (
        instance_id, message_id, from_number, to_number, message_text,
        message_type, from_me, status, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        sendResult.instanceId,
        sendResult.messageId,
        instancePhone,
        to,
        message,
        messageType || 'avulsa',
        true,
        'sent',
        new Date(),
      ]
    );

    return res.json({
      success: true,
      message: {
        id: messageResult.rows[0].id,
        instanceId: sendResult.instanceId,
        to,
        status: 'sent',
      },
      sendGuard: {
        waitedMs: sendResult.waitedMs,
        delayAppliedMs: sendResult.delayAppliedMs,
        sequenceNumber: sendResult.sequenceNumber,
      },
    });
  } catch (error: any) {
    console.error('Erro ao enviar mensagem avulsa:', error);
    if (error.statusCode === 404) {
      return res.status(404).json({ error: error.message || 'Instância não encontrada' });
    }
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message || 'Requisição inválida' });
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
