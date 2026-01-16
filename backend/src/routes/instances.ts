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
      'SELECT * FROM instances ORDER BY created_at DESC'
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
    const result = await pool.query('SELECT * FROM instances WHERE id = $1', [id]);

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
    const { name, api_key, api_url, instance_name } = req.body;

    if (!name || !api_key || !api_url || !instance_name) {
      return res.status(400).json({
        error: 'Campos obrigatórios: name, api_key, api_url, instance_name',
      });
    }

    const result = await pool.query(
      `INSERT INTO instances (name, api_key, api_url, instance_name, status)
       VALUES ($1, $2, $3, $4, 'disconnected')
       RETURNING *`,
      [name, api_key, api_url, instance_name]
    );

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
    const { name, api_key, api_url, instance_name } = req.body;

    const result = await pool.query(
      `UPDATE instances 
       SET name = COALESCE($1, name),
           api_key = COALESCE($2, api_key),
           api_url = COALESCE($3, api_url),
           instance_name = COALESCE($4, instance_name),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [name, api_key, api_url, instance_name, id]
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
    const result = await pool.query('DELETE FROM instances WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    res.json({ message: 'Instância deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar instância:', error);
    res.status(500).json({ error: 'Erro ao deletar instância' });
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
          (inst: any) => inst.instance?.instanceName === instance.instance_name
        );

        if (existingInstance) {
          console.log(`   ⚠️ Instância já existe na Evolution API`);
          // Atualizar status e QR code se já existe
          await pool.query(
            `UPDATE instances 
             SET status = $1,
                 qr_code = $2,
                 last_connection = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [
              existingInstance.instance?.status === 'open' ? 'connected' : 'connecting',
              existingInstance.qrcode?.base64 || null,
              id,
            ]
          );

          return res.json({
            message: 'Instância já existe na Evolution API',
            qr_code: existingInstance.qrcode?.base64,
            status: existingInstance.instance?.status,
          });
        }
      }
    } catch (checkError: any) {
      console.log(`   ⚠️ Não foi possível verificar instâncias existentes: ${checkError.message}`);
      // Continuar tentando criar mesmo se a verificação falhar
    }

    // Criar instância no Evolution API
    // Tentar diferentes formatos de body
    const requestBodies = [
      // Formato 1: padrão
      {
        instanceName: instance.instance_name,
        qrcode: true,
      },
      // Formato 2: com token no body
      {
        instanceName: instance.instance_name,
        token: instance.api_key,
        qrcode: true,
      },
      // Formato 3: apenas instanceName
      {
        instanceName: instance.instance_name,
      },
    ];

    let evolutionResponse;
    let lastError;

    for (const requestBody of requestBodies) {
      try {
        console.log(`   Tentando formato:`, JSON.stringify(requestBody));
        evolutionResponse = await axios.post(
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

        if (evolutionResponse.status < 400) {
          console.log(`   ✅ Sucesso com formato:`, JSON.stringify(requestBody));
          break;
        } else {
          console.log(`   ❌ Erro ${evolutionResponse.status}:`, evolutionResponse.data);
          lastError = evolutionResponse.data;
        }
      } catch (error: any) {
        console.log(`   ❌ Erro ao tentar formato:`, error.message);
        lastError = error.response?.data || error.message;
      }
    }

    // Verificar se alguma tentativa foi bem-sucedida
    if (!evolutionResponse || evolutionResponse.status >= 400) {
      console.error(`   ❌ Todas as tentativas falharam. Último erro:`, lastError);
      throw new Error(`Evolution API retornou erro: ${JSON.stringify(lastError)}`);
    }

    console.log(`✅ Resposta da Evolution API:`, JSON.stringify(evolutionResponse.data, null, 2));

    // Atualizar status e QR code
    await pool.query(
      `UPDATE instances 
       SET status = 'connecting',
           qr_code = $1,
           last_connection = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [evolutionResponse.data.qrcode?.base64 || null, id]
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
    const evolutionUrl = `${instance.api_url}/instance/delete/${instance.instance_name}`;

    // Deletar instância no Evolution API
    await axios.delete(evolutionUrl, {
      headers: {
        'apikey': instance.api_key,
      },
    });

    // Atualizar status
    await pool.query(
      `UPDATE instances 
       SET status = 'disconnected',
       qr_code = NULL,
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
    const evolutionUrl = `${instance.api_url}/instance/fetchInstances`;

    // Buscar status no Evolution API
    const evolutionResponse = await axios.get(evolutionUrl, {
      headers: {
        'apikey': instance.api_key,
      },
    });

    const evolutionInstance = evolutionResponse.data.find(
      (inst: any) => inst.instance.instanceName === instance.instance_name
    );

    let status = 'disconnected';
    if (evolutionInstance) {
      status = evolutionInstance.instance.status === 'open' ? 'connected' : 'connecting';
    }

    // Atualizar status no banco
    await pool.query(
      `UPDATE instances 
       SET status = $1,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [status, id]
    );

    res.json({
      status,
      instance: evolutionInstance || null,
    });
  } catch (error: any) {
    console.error('Erro ao verificar status:', error);
    res.status(500).json({
      error: 'Erro ao verificar status',
      details: error.response?.data || error.message,
    });
  }
});

export default router;
