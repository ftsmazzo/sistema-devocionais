import express from 'express';
import axios from 'axios';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Endpoint público para receber webhooks da Evolution API
router.post('/evolution/:instanceName', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const eventData = req.body;

    console.log(`📥 Webhook recebido para instância: ${instanceName}`);
    console.log(`   Tipo: ${eventData.event || eventData.type || 'unknown'}`);
    console.log(`   Dados:`, JSON.stringify(eventData, null, 2));

    // Buscar instância pelo instance_name
    const instanceResult = await pool.query(
      'SELECT id FROM instances WHERE instance_name = $1',
      [instanceName]
    );

    if (instanceResult.rows.length === 0) {
      console.log(`   ⚠️ Instância ${instanceName} não encontrada no banco`);
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const instanceId = instanceResult.rows[0].id;
    const eventType = eventData.event || eventData.type || 'unknown';

    // Salvar evento no banco
    await pool.query(
      `INSERT INTO webhook_events (instance_id, event_type, event_data)
       VALUES ($1, $2, $3)`,
      [instanceId, eventType, JSON.stringify(eventData)]
    );

    // Processar eventos específicos
    await processWebhookEvent(instanceId, eventType, eventData);

    res.status(200).json({ success: true, message: 'Webhook recebido' });
  } catch (error: any) {
    console.error('❌ Erro ao processar webhook:', error);
    // Sempre retornar 200 para a Evolution API não tentar reenviar
    res.status(200).json({ success: false, error: error.message });
  }
});

// Processar eventos específicos
async function processWebhookEvent(instanceId: number, eventType: string, eventData: any) {
  try {
    switch (eventType) {
      case 'connection.update':
      case 'connection':
        // Atualizar status da conexão
        if (eventData.state === 'open' || eventData.status === 'open') {
          await pool.query(
            `UPDATE instances 
             SET status = 'connected',
                 qr_code = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [instanceId]
          );

          // Buscar número de telefone quando conecta
          await updatePhoneNumber(instanceId);
        } else if (eventData.state === 'close' || eventData.status === 'close') {
          await pool.query(
            `UPDATE instances 
             SET status = 'disconnected',
                 phone_number = NULL,
                 qr_code = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [instanceId]
          );
        }
        break;

      case 'qrcode.update':
      case 'qrcode':
        // Atualizar QR code
        if (eventData.qrcode?.base64) {
          await pool.query(
            `UPDATE instances 
             SET qr_code = $1,
                 status = 'connecting',
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [eventData.qrcode.base64, instanceId]
          );
        }
        break;

      case 'messages.upsert':
      case 'message':
        // Mensagem recebida ou atualizada
        // Aqui você pode processar mensagens recebidas
        console.log(`   💬 Mensagem processada para instância ${instanceId}`);
        break;

      case 'messages.update':
        // Status de mensagem atualizado (enviada, entregue, lida, etc.)
        console.log(`   📨 Status de mensagem atualizado para instância ${instanceId}`);
        break;

      case 'logout.instance':
      case 'LOGOUT_INSTANCE':
        // Instância fez logout
        console.log(`   🔌 Logout detectado para instância ${instanceId}`);
        await pool.query(
          `UPDATE instances 
           SET status = 'disconnected',
               phone_number = NULL,
               qr_code = NULL,
               health_status = 'down',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [instanceId]
        );
        break;

      case 'remove.instance':
      case 'REMOVE_INSTANCE':
        // Instância foi removida
        console.log(`   🗑️ Remoção detectada para instância ${instanceId}`);
        await pool.query(
          `UPDATE instances 
           SET status = 'disconnected',
               phone_number = NULL,
               qr_code = NULL,
               health_status = 'down',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [instanceId]
        );
        break;

      default:
        console.log(`   ℹ️ Evento ${eventType} registrado mas não processado`);
    }
  } catch (error: any) {
    console.error(`   ❌ Erro ao processar evento ${eventType}:`, error);
  }
}

// Buscar e atualizar número de telefone
async function updatePhoneNumber(instanceId: number) {
  try {
    const instanceResult = await pool.query(
      'SELECT api_url, api_key, instance_name FROM instances WHERE id = $1',
      [instanceId]
    );

    if (instanceResult.rows.length === 0) return;

    const instance = instanceResult.rows[0];
    const phoneUrl = `${instance.api_url}/instance/fetchInstances`;

    const phoneResponse = await axios.get(phoneUrl, {
      headers: { 'apikey': instance.api_key },
      validateStatus: () => true,
    });

    const foundInstance = phoneResponse.data?.find(
      (inst: any) => inst.instance?.instanceName === instance.instance_name ||
                    inst.instanceName === instance.instance_name ||
                    inst.name === instance.instance_name
    );

    if (foundInstance) {
      // Evolution API 2.3.7 retorna ownerJid como "5516996282630@s.whatsapp.net"
      let rawPhone = foundInstance?.instance?.owner ||
                    foundInstance?.instance?.phoneNumber ||
                    foundInstance?.owner ||
                    foundInstance?.ownerJid ||
                    foundInstance?.phoneNumber ||
                    foundInstance?.phone ||
                    foundInstance?.instance?.phone ||
                    foundInstance?.instance?.ownerJid;

      // Extrair número de ownerJid se for formato JID
      let phoneNumber = null;
      if (rawPhone && rawPhone.includes('@')) {
        phoneNumber = rawPhone.split('@')[0];
      } else if (rawPhone) {
        phoneNumber = rawPhone;
      }

      if (phoneNumber) {
        await pool.query(
          `UPDATE instances 
           SET phone_number = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [phoneNumber, instanceId]
        );
        console.log(`   📱 Número atualizado via webhook: ${phoneNumber}`);
      }
    }
  } catch (error: any) {
    console.error(`   ⚠️ Erro ao atualizar número via webhook:`, error.message);
  }
}

// Rotas protegidas (requerem autenticação)
router.use(authenticateToken);

// Listar eventos de webhook
router.get('/events', async (req: AuthRequest, res) => {
  try {
    const { instance_id, event_type, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT we.*, i.name as instance_name
      FROM webhook_events we
      JOIN instances i ON we.instance_id = i.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (instance_id) {
      query += ` AND we.instance_id = $${paramCount}`;
      params.push(instance_id);
      paramCount++;
    }

    if (event_type) {
      query += ` AND we.event_type = $${paramCount}`;
      params.push(event_type);
      paramCount++;
    }

    query += ` ORDER BY we.received_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await pool.query(query, params);
    res.json({ events: result.rows });
  } catch (error) {
    console.error('Erro ao listar eventos:', error);
    res.status(500).json({ error: 'Erro ao listar eventos' });
  }
});

// Obter estatísticas de webhooks
router.get('/stats', async (req: AuthRequest, res) => {
  try {
    const { instance_id } = req.query;

    let query = `
      SELECT 
        event_type,
        COUNT(*) as count,
        MAX(received_at) as last_event
      FROM webhook_events
      WHERE 1=1
    `;
    const params: any[] = [];

    if (instance_id) {
      query += ` AND instance_id = $1`;
      params.push(instance_id);
    }

    query += ` GROUP BY event_type ORDER BY count DESC`;

    const result = await pool.query(query, params);
    res.json({ stats: result.rows });
  } catch (error) {
    console.error('Erro ao obter estatísticas:', error);
    res.status(500).json({ error: 'Erro ao obter estatísticas' });
  }
});

export default router;
