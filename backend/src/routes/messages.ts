import express from 'express';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { applyBlindage, recordBlindageSuccessfulSend } from '../services/blindage';
import { withGlobalOutboundGate } from '../services/globalOutboundGate';
import { sendEvolutionTextSafely } from '../services/evolutionSafeSender';

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

    type SendOutcome =
      | { kind: 'blocked'; reason?: string; blockedBy?: string }
      | { kind: 'ok'; payload: Record<string, unknown> };

    const outcome = await withGlobalOutboundGate(async (): Promise<SendOutcome> => {
      const blindageResult = await applyBlindage({
        to,
        message,
        instanceId,
        messageType: messageType || 'avulsa',
      });

      if (!blindageResult.canSend) {
        return {
          kind: 'blocked',
          reason: blindageResult.reason,
          blockedBy: blindageResult.blockedBy,
        };
      }

      if (blindageResult.delay && blindageResult.delay > 0) {
        await new Promise(resolve => setTimeout(resolve, blindageResult.delay));
      }

      if (!blindageResult.selectedInstanceId) {
        throw Object.assign(new Error('Nenhuma instância selecionada pela blindagem'), { statusCode: 400 });
      }

      const sendResult = await sendEvolutionTextSafely({
        instanceId: blindageResult.selectedInstanceId,
        number: to,
        text: message,
        messageType: messageType || 'avulsa',
      });

      const instanceRow = await pool.query(
        `SELECT id, phone_number FROM instances WHERE id = $1`,
        [sendResult.instanceId]
      );
      const instancePhone = instanceRow.rows[0]?.phone_number || 'unknown';

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

      await recordBlindageSuccessfulSend({
        to,
        message,
        messageType: messageType || 'avulsa',
      });

      return {
        kind: 'ok',
        payload: {
          success: true,
          message: {
            id: messageResult.rows[0].id,
            instanceId: sendResult.instanceId,
            to,
            message,
            status: 'sent',
            evolutionResponse: sendResult.evolutionData,
          },
          blindage: {
            delayApplied: blindageResult.delay || 0,
            instanceSelected: blindageResult.selectedInstanceId,
          },
          sendGuard: {
            waitedMs: sendResult.waitedMs,
            delayAppliedMs: sendResult.delayAppliedMs,
            sequenceNumber: sendResult.sequenceNumber,
          },
        },
      };
    });

    if (outcome.kind === 'blocked') {
      return res.status(403).json({
        error: 'Mensagem bloqueada pela blindagem',
        reason: outcome.reason,
        blockedBy: outcome.blockedBy,
      });
    }

    return res.json(outcome.payload);
  } catch (error: any) {
    console.error('Erro ao enviar mensagem:', error);

    if (error.statusCode === 404) {
      return res.status(404).json({ error: error.message || 'Instância não encontrada' });
    }
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message || 'Requisição inválida' });
    }

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
