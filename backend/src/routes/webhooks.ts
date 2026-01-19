import express from 'express';
import axios from 'axios';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { updateDevocionalScore } from '../services/devocionalScoring';
import { detectPositiveIntent, triggerAIInteraction } from '../services/aiDetection';

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
        await processMessageReceived(instanceId, eventData);
        break;

      case 'messages.update':
        // Status de mensagem atualizado (enviada, entregue, lida, etc.)
        await processMessageUpdate(instanceId, eventData);
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

// Processar mensagem recebida
async function processMessageReceived(instanceId: number, eventData: any) {
  try {
    console.log(`   🔍 Processando mensagem recebida...`);
    
    // Tentar diferentes formatos de mensagem (Evolution API pode enviar em diferentes estruturas)
    let message = null;
    let messageKey = null;
    let messageBody = null;
    
    // Formato 1: data.messages[0]
    if (eventData.data?.messages?.[0]) {
      message = eventData.data.messages[0];
      messageKey = message.key;
      messageBody = message.message;
    }
    // Formato 2: messages[0]
    else if (eventData.messages?.[0]) {
      message = eventData.messages[0];
      messageKey = message.key;
      messageBody = message.message;
    }
    // Formato 3: data.message (formato direto)
    else if (eventData.data?.message) {
      message = eventData.data;
      messageKey = eventData.data.key;
      messageBody = eventData.data.message;
    }
    // Formato 4: message (formato direto)
    else if (eventData.message) {
      message = eventData;
      messageKey = eventData.message.key;
      messageBody = eventData.message;
    }
    
    if (!message) {
      console.log(`   ⚠️ Mensagem não encontrada no formato esperado`);
      console.log(`   📋 Estrutura recebida:`, JSON.stringify(Object.keys(eventData), null, 2));
      return;
    }
    
    console.log(`   📝 Mensagem encontrada`);
    console.log(`   🔑 Key:`, JSON.stringify(messageKey, null, 2));
    console.log(`   💬 Body:`, JSON.stringify(messageBody, null, 2));
    
    // Verificar se é mensagem enviada por nós
    const fromMe = messageKey?.fromMe || 
                   message.fromMe || 
                   message.data?.key?.fromMe ||
                   false;
    
    if (fromMe) {
      console.log(`   ℹ️ Mensagem enviada por nós, ignorando`);
      return;
    }

    // Extrair número do remetente
    const fromNumber = messageKey?.remoteJid?.replace('@s.whatsapp.net', '') || 
                       message.from?.replace('@s.whatsapp.net', '') ||
                       message.remoteJid?.replace('@s.whatsapp.net', '') ||
                       eventData.sender?.replace('@s.whatsapp.net', '') ||
                       eventData.data?.key?.remoteJid?.replace('@s.whatsapp.net', '');

    if (!fromNumber) {
      console.log(`   ⚠️ Número do remetente não encontrado`);
      return;
    }
    
    console.log(`   📱 Número do remetente: ${fromNumber}`);

    // Buscar contato pelo número
    const contactResult = await pool.query(
      `SELECT id FROM contacts WHERE phone_number = $1`,
      [fromNumber]
    );

    if (contactResult.rows.length === 0) {
      console.log(`   ⚠️ Contato ${fromNumber} não encontrado no banco`);
      return; // Contato não encontrado
    }

    const contactId = contactResult.rows[0].id;
    console.log(`   ✅ Contato encontrado: ID ${contactId}`);

    // Buscar último devocional enviado para este contato
    const lastDevocionalResult = await pool.query(
      `SELECT id, dispatch_id, created_at
       FROM messages
       WHERE contact_id = $1 
         AND dispatch_type = 'devocional'
         AND from_me = true
       ORDER BY created_at DESC
       LIMIT 1`,
      [contactId]
    );

    if (lastDevocionalResult.rows.length > 0) {
      const lastDevocional = lastDevocionalResult.rows[0];
      const lastSentTime = new Date(lastDevocional.created_at);
      const now = new Date();
      const hoursSinceSent = (now.getTime() - lastSentTime.getTime()) / (1000 * 60 * 60);

      // Se a mensagem foi recebida dentro de 24 horas após o envio do devocional, considerar interação
      if (hoursSinceSent <= 24) {
        await updateDevocionalScore(contactId, 'interaction');
        console.log(`   💬 Interação detectada com devocional para contato ${contactId}`);
      }
    }

    // Verificar se é resposta a um disparo de marketing
    const lastMarketingResult = await pool.query(
      `SELECT m.id, m.dispatch_id, m.created_at, d.dispatch_type
       FROM messages m
       JOIN dispatches d ON m.dispatch_id = d.id
       WHERE m.contact_id = $1 
         AND m.dispatch_type = 'marketing'
         AND m.from_me = true
       ORDER BY m.created_at DESC
       LIMIT 1`,
      [contactId]
    );

    if (lastMarketingResult.rows.length > 0) {
      const lastMarketing = lastMarketingResult.rows[0];
      const lastSentTime = new Date(lastMarketing.created_at);
      const now = new Date();
      const hoursSinceSent = (now.getTime() - lastSentTime.getTime()) / (1000 * 60 * 60);

      // Se a mensagem foi recebida dentro de 48 horas após o envio do marketing, verificar intenção
      if (hoursSinceSent <= 48 && lastMarketing.dispatch_id) {
        console.log(`   📢 Resposta a disparo de marketing detectada (${hoursSinceSent.toFixed(2)}h desde o envio)`);
        
        // Extrair texto da mensagem em diferentes formatos
        const messageText = messageBody?.conversation || 
                           messageBody?.extendedTextMessage?.text ||
                           message.body || 
                           message.message?.conversation || 
                           message.message?.extendedTextMessage?.text ||
                           message.data?.message?.conversation ||
                           eventData.data?.message?.conversation ||
                           '';
        
        console.log(`   💬 Texto da mensagem: "${messageText}"`);
        
        if (messageText.trim().length > 0) {
          // Detectar intenção positiva
          console.log(`   🔍 Verificando intenção positiva...`);
          const detection = await detectPositiveIntent(
            messageText,
            contactId,
            lastMarketing.dispatch_id
          );

          console.log(`   📊 Resultado da detecção:`, {
            isPositive: detection.isPositive,
            confidence: detection.confidence,
            method: detection.method,
            detectedKeywords: detection.detectedKeywords,
          });

          if (detection.isPositive && detection.confidence > 0.5) {
            console.log(`   ✅ Intenção positiva detectada para contato ${contactId} (confiança: ${detection.confidence})`);
            
            // Ativar IA externa
            await triggerAIInteraction(
              lastMarketing.dispatch_id,
              contactId,
              messageText
            );
          } else {
            console.log(`   ⚠️ Intenção não detectada ou confiança baixa (${detection.confidence})`);
          }
        } else {
          console.log(`   ⚠️ Mensagem vazia, não processando`);
        }
      } else {
        console.log(`   ⚠️ Mensagem recebida após 48h do disparo (${hoursSinceSent.toFixed(2)}h)`);
      }
    }

    // Atualizar última mensagem recebida do contato
    await pool.query(
      `UPDATE contacts
       SET last_message_received_at = CURRENT_TIMESTAMP,
           total_messages_received = COALESCE(total_messages_received, 0) + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [contactId]
    );
  } catch (error: any) {
    console.error(`   ❌ Erro ao processar mensagem recebida:`, error);
  }
}

// Processar atualização de status de mensagem
async function processMessageUpdate(instanceId: number, eventData: any) {
  try {
    const messageId = eventData.key?.id || eventData.messageId || eventData.id;
    const status = eventData.update?.status || eventData.status;

    if (!messageId || !status) {
      return;
    }

    // Buscar mensagem no banco
    const messageResult = await pool.query(
      `SELECT id, contact_id, dispatch_id, dispatch_type, devocional_id
       FROM messages
       WHERE message_id = $1 AND instance_id = $2`,
      [messageId, instanceId]
    );

    if (messageResult.rows.length === 0) {
      return; // Mensagem não encontrada ou não é do nosso sistema
    }

    const message = messageResult.rows[0];

    // Atualizar status da mensagem
    const statusUpdates: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    switch (status) {
      case 'DELIVERY_ACK':
      case 'delivered':
        statusUpdates.push(`status = 'delivered'`);
        statusUpdates.push(`delivered_at = CURRENT_TIMESTAMP`);
        if (message.contact_id && message.dispatch_type === 'devocional') {
          await updateDevocionalScore(message.contact_id, 'delivered');
        }
        break;

      case 'READ':
      case 'read':
        statusUpdates.push(`status = 'read'`);
        statusUpdates.push(`read_at = CURRENT_TIMESTAMP`);
        if (message.contact_id && message.dispatch_type === 'devocional') {
          await updateDevocionalScore(message.contact_id, 'read');
        }
        break;

      case 'ERROR':
      case 'FAILED':
      case 'failed':
        statusUpdates.push(`status = 'failed'`);
        statusUpdates.push(`failed_at = CURRENT_TIMESTAMP`);
        if (message.contact_id && message.dispatch_type === 'devocional') {
          await updateDevocionalScore(message.contact_id, 'failed');
        }
        break;
    }

    if (statusUpdates.length > 0) {
      statusUpdates.push(`status_updated_at = CURRENT_TIMESTAMP`);
      statusUpdates.push(`updated_at = CURRENT_TIMESTAMP`);
      params.push(message.id);

      await pool.query(
        `UPDATE messages
         SET ${statusUpdates.join(', ')}
         WHERE id = $${paramCount}`,
        params
      );
    }

    // Se for mensagem recebida (resposta), verificar se é interação com devocional
    if (eventData.message && !eventData.message.fromMe && message.contact_id && message.dispatch_type === 'devocional') {
      // Verificar se a mensagem recebida é uma resposta ao devocional
      const receivedMessage = eventData.message.body || eventData.message.message?.conversation || '';
      
      // Se houver texto na mensagem recebida, considerar como interação
      if (receivedMessage.trim().length > 0) {
        await updateDevocionalScore(message.contact_id, 'interaction');
      }
    }

    console.log(`   ✅ Status de mensagem ${messageId} atualizado: ${status}`);
  } catch (error: any) {
    console.error(`   ❌ Erro ao processar atualização de mensagem:`, error);
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
