import express from 'express';
import axios from 'axios';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Listar todas as instâncias
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, instance_name, status, phone_number, qr_code, last_connection, created_at, updated_at
       FROM instances 
       ORDER BY created_at DESC`
    );
    res.json({ instances: result.rows });
  } catch (error) {
    console.error('Erro ao listar instâncias:', error);
    res.status(500).json({ error: 'Erro ao listar instâncias' });
  }
});

// Buscar instância por ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, name, instance_name, status, phone_number, qr_code, last_connection, created_at, updated_at
       FROM instances WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    res.json({ instance: result.rows[0] });
  } catch (error) {
    console.error('Erro ao buscar instância:', error);
    res.status(500).json({ error: 'Erro ao buscar instância' });
  }
});

// Criar nova instância
router.post('/', async (req, res) => {
  try {
    const { name, instance_name } = req.body;

    if (!name || !instance_name) {
      return res.status(400).json({
        error: 'Campos obrigatórios: name, instance_name',
      });
    }

    // Usar variáveis de ambiente para API_KEY e API_URL
    const api_key = process.env.EVOLUTION_API_KEY;
    const api_url = process.env.EVOLUTION_API_URL;

    if (!api_key || !api_url) {
      return res.status(500).json({
        error: 'EVOLUTION_API_KEY e EVOLUTION_API_URL devem estar configuradas nas variáveis de ambiente',
      });
    }

    const result = await pool.query(
      `INSERT INTO instances (name, api_key, api_url, instance_name, status)
       VALUES ($1, $2, $3, $4, 'disconnected')
       RETURNING id, name, instance_name, status, phone_number, qr_code, last_connection, created_at, updated_at`,
      [name, api_key, api_url, instance_name]
    );

    // Não retornar api_key e api_url por segurança
    res.status(201).json({ instance: result.rows[0] });
  } catch (error: any) {
    console.error('Erro ao criar instância:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Instância já existe' });
    }
    res.status(500).json({ error: 'Erro ao criar instância' });
  }
});

// Atualizar instância
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, instance_name } = req.body;

    const result = await pool.query(
      `UPDATE instances 
       SET name = COALESCE($1, name),
           instance_name = COALESCE($2, instance_name),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, name, instance_name, status, phone_number, qr_code, last_connection, created_at, updated_at`,
      [name, instance_name, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    res.json({ instance: result.rows[0] });
  } catch (error) {
    console.error('Erro ao atualizar instância:', error);
    res.status(500).json({ error: 'Erro ao atualizar instância' });
  }
});

// Deletar instância
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const instanceResult = await pool.query('SELECT * FROM instances WHERE id = $1', [id]);

    if (instanceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const instance = instanceResult.rows[0];

    // Tentar deletar da Evolution API primeiro
    try {
      const evolutionUrl = `${instance.api_url}/instance/delete/${instance.instance_name}`;
      console.log(`🗑️ Deletando instância ${instance.instance_name} da Evolution API: ${evolutionUrl}`);
      
      await axios.delete(evolutionUrl, {
        headers: {
          'apikey': instance.api_key,
        },
        validateStatus: () => true, // Não lançar erro automaticamente
      });
      
      console.log(`✅ Instância deletada da Evolution API`);
    } catch (error: any) {
      console.error(`⚠️ Erro ao deletar da Evolution API (continuando...):`, error.message);
      // Continuar mesmo se falhar na Evolution API
    }

    // Deletar do banco de dados
    await pool.query('DELETE FROM instances WHERE id = $1', [id]);

    res.json({ message: 'Instância deletada com sucesso' });
  } catch (error: any) {
    console.error('❌ Erro ao deletar instância:', error);
    res.status(500).json({ error: 'Erro ao deletar instância', details: error.message });
  }
});

// Conectar instância (criar no Evolution API)
router.post('/:id/connect', async (req, res) => {
  try {
    const { id } = req.params;
    const instanceResult = await pool.query('SELECT * FROM instances WHERE id = $1', [id]);

    if (instanceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const instance = instanceResult.rows[0];
    const evolutionUrl = `${instance.api_url}/instance/create`;

    console.log(`🔗 Conectando instância ${instance.instance_name} em ${evolutionUrl}`);
    console.log(`   API Key: ${instance.api_key.substring(0, 10)}...`);

    // Verificar se a instância já existe na Evolution API
    try {
      const checkUrl = `${instance.api_url}/instance/fetchInstances`;
      const checkResponse = await axios.get(checkUrl, {
        headers: {
          'apikey': instance.api_key,
        },
        validateStatus: () => true,
      });

      if (checkResponse.status === 200 && Array.isArray(checkResponse.data)) {
        const existingInstance = checkResponse.data.find(
          (inst: any) => inst.instance?.instanceName === instance.instance_name ||
                        inst.instanceName === instance.instance_name ||
                        inst.name === instance.instance_name
        );

        if (existingInstance) {
          const existingState = existingInstance.instance?.state || 
                               existingInstance.state || 
                               existingInstance.instance?.status ||
                               existingInstance.status;

          console.log(`   ⚠️ Instância já existe na Evolution API com estado: ${existingState}`);

          // Se está "open" (conectada), apenas atualizar status
          if (existingState === 'open') {
            let phoneNumber = null;
            const rawPhone = existingInstance.instance?.owner ||
                           existingInstance.instance?.ownerJid ||
                           existingInstance.owner ||
                           existingInstance.ownerJid;
            
            if (rawPhone && rawPhone.includes('@')) {
              phoneNumber = rawPhone.split('@')[0];
            } else if (rawPhone) {
              phoneNumber = rawPhone;
            }

            await pool.query(
              `UPDATE instances 
               SET status = 'connected',
                   qr_code = NULL,
                   phone_number = COALESCE($1, phone_number),
                   last_connection = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $2`,
              [phoneNumber, id]
            );

            return res.json({
              message: 'Instância já está conectada na Evolution API',
              status: 'connected',
            });
          }

          // Se está "close" (desconectada), deletar primeiro para poder recriar
          if (existingState === 'close') {
            console.log(`   🗑️ Instância existe mas está fechada, deletando para recriar...`);
            try {
              const deleteUrl = `${instance.api_url}/instance/delete/${instance.instance_name}`;
              const deleteResponse = await axios.delete(deleteUrl, {
                headers: {
                  'apikey': instance.api_key,
                },
                validateStatus: () => true,
              });
              
              if (deleteResponse.status === 200 || deleteResponse.status === 204) {
                console.log(`   ✅ Instância deletada, pode criar nova`);
                // Aguardar um pouco para a Evolution API processar
                await new Promise(resolve => setTimeout(resolve, 1500));
              } else {
                console.log(`   ⚠️ Resposta inesperada ao deletar: ${deleteResponse.status}`);
              }
            } catch (deleteError: any) {
              console.log(`   ⚠️ Erro ao deletar instância existente: ${deleteError.message}`);
              // Continuar tentando criar mesmo assim
            }
          }
        }
      }
    } catch (checkError: any) {
      console.log(`   ⚠️ Não foi possível verificar instâncias existentes: ${checkError.message}`);
      // Continuar tentando criar mesmo se a verificação falhar
    }

    // Criar instância no Evolution API
    // Segundo a documentação: https://www.postman.com/agenciadgcode/evolution-api/collection/nm0wqgt/evolution-api-v2-3
    // O campo 'integration' é obrigatório: WHATSAPP-BAILEYS | WHATSAPP-BUSINESS | EVOLUTION
    const requestBody = {
      instanceName: instance.instance_name,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS', // Padrão da Evolution API
    };

    console.log(`   Body:`, JSON.stringify(requestBody));

    // Evolution API requer o campo 'integration' no body
    const evolutionResponse = await axios.post(
      evolutionUrl,
      requestBody,
      {
        headers: {
          'apikey': instance.api_key,
          'Content-Type': 'application/json',
        },
        validateStatus: () => true, // Não lançar erro automaticamente
      }
    );

    // Verificar se a resposta foi bem-sucedida
    if (evolutionResponse.status >= 400) {
      // Se erro 403 e mensagem diz que nome já está em uso, tentar deletar e recriar
      if (evolutionResponse.status === 403 && 
          evolutionResponse.data?.response?.message?.some((msg: string) => 
            msg.includes('already in use') || msg.includes('já está em uso')
          )) {
        console.log(`   ⚠️ Nome já em uso, tentando deletar instância existente...`);
        
        try {
          const deleteUrl = `${instance.api_url}/instance/delete/${instance.instance_name}`;
          await axios.delete(deleteUrl, {
            headers: {
              'apikey': instance.api_key,
            },
            validateStatus: () => true,
          });
          
          console.log(`   ✅ Instância deletada, tentando criar novamente...`);
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Tentar criar novamente
          const retryResponse = await axios.post(
            evolutionUrl,
            requestBody,
            {
              headers: {
                'apikey': instance.api_key,
                'Content-Type': 'application/json',
              },
              validateStatus: () => true,
            }
          );

          if (retryResponse.status >= 400) {
            throw new Error(`Evolution API retornou erro após deletar: ${JSON.stringify(retryResponse.data)}`);
          }

          // Usar a resposta do retry
          Object.assign(evolutionResponse, retryResponse);
        } catch (deleteError: any) {
          console.error(`   ❌ Erro ao deletar e recriar:`, deleteError.message);
          throw new Error(`Evolution API retornou erro: ${JSON.stringify(evolutionResponse.data)}`);
        }
      } else {
        console.error(`   ❌ Erro da Evolution API (${evolutionResponse.status}):`, evolutionResponse.data);
        throw new Error(`Evolution API retornou erro: ${JSON.stringify(evolutionResponse.data)}`);
      }
    }

    console.log(`✅ Resposta da Evolution API:`, JSON.stringify(evolutionResponse.data, null, 2));

    // Configurar webhook automaticamente após criar instância
    await configureWebhook(instance, parseInt(id, 10));

    // Buscar número de telefone se a instância já estiver conectada
    let phoneNumber = null;
    if (evolutionResponse.data.instance?.state === 'open') {
      try {
        const phoneUrl = `${instance.api_url}/instance/fetchInstances`;
        const phoneResponse = await axios.get(phoneUrl, {
          headers: { 'apikey': instance.api_key },
          validateStatus: () => true,
        });
        
        // Evolution API 2.3.7 pode retornar em diferentes estruturas
        const foundInstance = phoneResponse.data?.find(
          (inst: any) => inst.instance?.instanceName === instance.instance_name || 
                        inst.instanceName === instance.instance_name ||
                        inst.name === instance.instance_name
        );
        
        // Tentar diferentes caminhos para o número de telefone
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
        if (rawPhone && rawPhone.includes('@')) {
          phoneNumber = rawPhone.split('@')[0];
          console.log(`   📱 Número extraído de JID ao conectar: ${rawPhone} → ${phoneNumber}`);
        } else if (rawPhone) {
          phoneNumber = rawPhone;
          console.log(`   📱 Número encontrado ao conectar: ${phoneNumber}`);
        }
      } catch (phoneError) {
        console.log('   ⚠️ Não foi possível buscar número de telefone:', phoneError);
      }
    }

    // Atualizar status, QR code e número de telefone
    await pool.query(
      `UPDATE instances 
       SET status = 'connecting',
           qr_code = $1,
           phone_number = COALESCE($2, phone_number),
           last_connection = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [evolutionResponse.data.qrcode?.base64 || null, phoneNumber, id]
    );

    res.json({
      message: 'Instância conectando',
      qr_code: evolutionResponse.data.qrcode?.base64,
    });
  } catch (error: any) {
    console.error('❌ Erro ao conectar instância:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
    
    // Retornar erro mais detalhado
    const statusCode = error.response?.status || 500;
    const errorMessage = error.response?.data?.message || 
                        error.response?.data?.error || 
                        error.message || 
                        'Erro ao conectar instância';
    
    res.status(statusCode).json({
      error: 'Erro ao conectar instância',
      message: errorMessage,
      details: error.response?.data || error.message,
    });
  }
});

// Desconectar instância
router.post('/:id/disconnect', async (req, res) => {
  try {
    const { id } = req.params;
    const instanceResult = await pool.query('SELECT * FROM instances WHERE id = $1', [id]);

    if (instanceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const instance = instanceResult.rows[0];
    // Evolution API 2.3.7 usa DELETE para logout (não PUT)
    // Mas vamos usar a rota de logout que apenas desconecta
    const evolutionUrl = `${instance.api_url}/instance/logout/${instance.instance_name}`;

    console.log(`🔌 Desconectando instância ${instance.instance_name} da Evolution API: ${evolutionUrl}`);

    // Fazer logout da instância (não deleta, apenas desconecta)
    // Evolution API 2.3.7 pode usar DELETE ou PUT, vamos tentar DELETE primeiro
    try {
      const logoutResponse = await axios.delete(evolutionUrl, {
        headers: {
          'apikey': instance.api_key,
        },
        validateStatus: () => true,
      });

      if (logoutResponse.status >= 400) {
        // Se DELETE falhar, tentar PUT
        console.log(`   ⚠️ DELETE falhou, tentando PUT...`);
        await axios.put(evolutionUrl, {}, {
          headers: {
            'apikey': instance.api_key,
            'Content-Type': 'application/json',
          },
          validateStatus: () => true,
        });
      }
      
      console.log(`   ✅ Logout realizado com sucesso`);
    } catch (error: any) {
      console.log(`   ⚠️ Erro no logout (continuando...):`, error.message);
      // Continuar mesmo se falhar, pois pode ser que a instância já esteja desconectada
    }

    // Atualizar status e limpar número de telefone
    await pool.query(
      `UPDATE instances 
       SET status = 'disconnected',
       qr_code = NULL,
       phone_number = NULL,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    res.json({ message: 'Instância desconectada com sucesso' });
  } catch (error: any) {
    console.error('Erro ao desconectar instância:', error);
    res.status(500).json({
      error: 'Erro ao desconectar instância',
      details: error.response?.data || error.message,
    });
  }
});

// Verificar status da instância
router.get('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const instanceResult = await pool.query('SELECT * FROM instances WHERE id = $1', [id]);

    if (instanceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const instance = instanceResult.rows[0];
    // Usar a rota correta: /instance/connectionState/{instanceName}
    const evolutionUrl = `${instance.api_url}/instance/connectionState/${instance.instance_name}`;

    console.log(`🔍 Verificando status da instância ${instance.instance_name} em ${evolutionUrl}`);

    // Buscar status no Evolution API
    const evolutionResponse = await axios.get(evolutionUrl, {
      headers: {
        'apikey': instance.api_key,
      },
      validateStatus: () => true, // Não lançar erro automaticamente
    });

    console.log(`   Resposta da Evolution API:`, JSON.stringify(evolutionResponse.data, null, 2));

    let status = 'disconnected';
    let qrCode = instance.qr_code;
    let phoneNumber: string | null = instance.phone_number || null;

    // Verificar se a resposta foi bem-sucedida
    if (evolutionResponse.status === 200 && evolutionResponse.data) {
      // A resposta tem 'state' dentro de 'instance': { instance: { state: 'open' } }
      const connectionState = evolutionResponse.data.instance?.state || 
                             evolutionResponse.data.state || 
                             evolutionResponse.data.status;
      
      console.log(`   Estado da conexão: ${connectionState}`);
      console.log(`   Dados completos:`, JSON.stringify(evolutionResponse.data, null, 2));
      
      if (connectionState === 'open') {
        status = 'connected';
        qrCode = null; // Limpar QR code quando conectado
        console.log(`   ✅ Instância conectada`);
        
        // Buscar número de telefone
        try {
          const phoneUrl = `${instance.api_url}/instance/fetchInstances`;
          const phoneResponse = await axios.get(phoneUrl, {
            headers: { 'apikey': instance.api_key },
            validateStatus: () => true,
          });
          
          // Evolution API 2.3.7 pode retornar em diferentes estruturas
          const foundInstance = phoneResponse.data?.find(
            (inst: any) => inst.instance?.instanceName === instance.instance_name || 
                          inst.instanceName === instance.instance_name ||
                          inst.name === instance.instance_name
          );
          
          // Tentar diferentes caminhos para o número de telefone
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
          if (rawPhone && rawPhone.includes('@')) {
            phoneNumber = rawPhone.split('@')[0];
            console.log(`   📱 Número extraído de JID: ${rawPhone} → ${phoneNumber}`);
          } else if (rawPhone) {
            phoneNumber = rawPhone;
            console.log(`   📱 Número encontrado: ${phoneNumber}`);
          } else {
            console.log(`   ⚠️ Número não encontrado na resposta:`, JSON.stringify(foundInstance, null, 2));
          }
        } catch (phoneError) {
          console.log('   ⚠️ Não foi possível buscar número de telefone:', phoneError);
        }
      } else if (connectionState === 'close' || connectionState === 'connecting') {
        status = 'connecting';
        console.log(`   ⏳ Instância conectando`);
        // Se ainda está conectando, verificar se tem QR code atualizado
        if (evolutionResponse.data.qrcode?.base64) {
          qrCode = evolutionResponse.data.qrcode.base64;
        }
      } else {
        status = 'disconnected';
        phoneNumber = null; // Limpar número quando desconectado
        console.log(`   ❌ Instância desconectada`);
      }
    } else if (evolutionResponse.status === 404) {
      // Instância não existe na Evolution API
      status = 'disconnected';
      qrCode = null;
      console.log(`   ❌ Instância não encontrada na Evolution API`);
    }

    // Atualizar status, QR code e número de telefone no banco
    await pool.query(
      `UPDATE instances 
       SET status = $1,
           qr_code = $2,
           phone_number = COALESCE($3, phone_number),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [status, qrCode, phoneNumber, id]
    );

    res.json({
      status,
      instance: evolutionResponse.data || null,
    });
  } catch (error: any) {
    console.error('❌ Erro ao verificar status:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(500).json({
      error: 'Erro ao verificar status',
      details: error.response?.data || error.message,
    });
  }
});

// Configurar webhook automaticamente
async function configureWebhook(instance: any, instanceId: number) {
  try {
    // URL do webhook (ajustar conforme sua URL pública)
    const webhookBaseUrl = process.env.WEBHOOK_BASE_URL || process.env.BACKEND_URL || 'http://localhost:3001';
    const webhookUrl = `${webhookBaseUrl}/api/webhooks/evolution/${instance.instance_name}`;

    console.log(`🔗 Configurando webhook para instância ${instance.instance_name}: ${webhookUrl}`);

    // Configurar webhook na Evolution API 2.3.7
    // Estrutura correta baseada na documentação do Postman
    const webhookConfigUrl = `${instance.api_url}/webhook/set/${instance.instance_name}`;
    
    const webhookPayload = {
      webhook: {
        enabled: true,
        url: webhookUrl,
        headers: {
          'Content-Type': 'application/json',
        },
        byEvents: false, // false = envia todos os eventos listados
        base64: true, // Habilitar envio de mídia em base64
        events: [
          'APPLICATION_STARTUP',
          'QRCODE_UPDATED',
          'MESSAGES_SET',
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'MESSAGES_DELETE',
          'SEND_MESSAGE',
          'CONTACTS_SET',
          'CONTACTS_UPSERT',
          'CONTACTS_UPDATE',
          'PRESENCE_UPDATE',
          'CHATS_SET',
          'CHATS_UPSERT',
          'CHATS_UPDATE',
          'CHATS_DELETE',
          'GROUPS_UPSERT',
          'GROUP_UPDATE',
          'GROUP_PARTICIPANTS_UPDATE',
          'CONNECTION_UPDATE',
          'LABELS_EDIT',
          'LABELS_ASSOCIATION',
          'CALL',
          'TYPEBOT_START',
          'TYPEBOT_CHANGE_STATUS',
          'REMOVE_INSTANCE', // Evento quando instância é removida
          'LOGOUT_INSTANCE', // Evento quando instância faz logout
        ],
      },
    };

    console.log(`   Payload:`, JSON.stringify(webhookPayload, null, 2));

    const webhookResponse = await axios.post(
      webhookConfigUrl,
      webhookPayload,
      {
        headers: {
          'apikey': instance.api_key,
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
      }
    );

    console.log(`   Resposta da Evolution API:`, JSON.stringify(webhookResponse.data, null, 2));

    if (webhookResponse.status === 200 || webhookResponse.status === 201) {
      console.log(`   ✅ Webhook configurado com sucesso`);
      
      // Salvar configuração no banco
      await pool.query(
        `INSERT INTO instance_webhook_config (instance_id, webhook_url, events, enabled)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (instance_id) 
         DO UPDATE SET 
           webhook_url = EXCLUDED.webhook_url,
           events = EXCLUDED.events,
           updated_at = CURRENT_TIMESTAMP`,
        [
          instanceId,
          webhookUrl,
          webhookPayload.webhook.events,
        ]
      );
    } else {
      console.error(`   ❌ Erro ao configurar webhook (${webhookResponse.status}):`, webhookResponse.data);
      // Não falhar a conexão se o webhook falhar, mas logar o erro
    }
  } catch (error: any) {
    console.error(`   ❌ Erro ao configurar webhook:`, error.message);
    // Não falhar a conexão se o webhook falhar
  }
}

export default router;
