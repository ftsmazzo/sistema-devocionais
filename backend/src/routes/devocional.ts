import express from 'express';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Secret para validar webhook do N8N
const WEBHOOK_SECRET = process.env.DEVOCIONAL_WEBHOOK_SECRET || 'Fs142779';

/**
 * Receber devocional do N8N
 * POST /api/devocional/webhook
 * 
 * Body (do N8N):
 * {
 *   text: string (texto completo do devocional)
 *   title: string (título)
 *   date: string (YYYY-MM-DD)
 *   versiculo_principal: { texto: string, referencia: string }
 *   versiculo_apoio: { texto: string, referencia: string }
 *   metadata: {
 *     autor: string,
 *     tema: string,
 *     conceito_central: string,
 *     palavras_chave: string[],
 *     relacionado_expressar: string
 *   }
 * }
 */
router.post('/webhook', async (req, res) => {
  try {
    // Validar secret
    const secret = req.headers['x-webhook-secret'];
    if (secret !== WEBHOOK_SECRET) {
      console.log('❌ Webhook secret inválido');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      text,
      title,
      date,
      versiculo_principal,
      versiculo_apoio,
      metadata
    } = req.body;

    if (!text || !title || !date) {
      return res.status(400).json({ 
        error: 'Campos obrigatórios: text, title, date' 
      });
    }

    console.log(`📖 Recebendo devocional: ${title} - ${date}`);

    // Verificar se já existe devocional para esta data
    const existingCheck = await pool.query(
      'SELECT id FROM devocionais WHERE date = $1',
      [date]
    );

    if (existingCheck.rows.length > 0) {
      // Atualizar devocional existente
      await pool.query(
        `UPDATE devocionais 
         SET text = $1,
             title = $2,
             versiculo_principal = $3,
             versiculo_apoio = $4,
             metadata = $5,
             updated_at = CURRENT_TIMESTAMP
         WHERE date = $6`,
        [
          text,
          title,
          JSON.stringify(versiculo_principal || {}),
          JSON.stringify(versiculo_apoio || {}),
          JSON.stringify(metadata || {}),
          date
        ]
      );
      console.log(`✅ Devocional atualizado para ${date}`);
    } else {
      // Criar novo devocional
      await pool.query(
        `INSERT INTO devocionais (
          text, title, date, versiculo_principal, versiculo_apoio, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          text,
          title,
          date,
          JSON.stringify(versiculo_principal || {}),
          JSON.stringify(versiculo_apoio || {}),
          JSON.stringify(metadata || {})
        ]
      );
      console.log(`✅ Devocional criado para ${date}`);
    }

    res.json({ 
      success: true, 
      message: 'Devocional salvo com sucesso',
      date 
    });
  } catch (error: any) {
    console.error('❌ Erro ao processar webhook de devocional:', error);
    res.status(500).json({ 
      error: 'Erro ao processar devocional',
      message: error.message 
    });
  }
});

/**
 * Buscar contexto histórico para IA
 * GET /api/devocional/context/para-ia?days=30
 * 
 * Retorna:
 * - Últimos N devocionais
 * - Versículos usados
 * - Temas abordados
 * - Palavras-chave
 * - Contexto histórico formatado
 */
router.get('/context/para-ia', async (req: express.Request, res: express.Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    
    // Buscar devocionais dos últimos N dias
    const result = await pool.query(
      `SELECT 
        text,
        title,
        date,
        versiculo_principal,
        versiculo_apoio,
        metadata
       FROM devocionais
       WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
       ORDER BY date DESC
       LIMIT 50`
    );

    const devocionais = result.rows.map(row => ({
      text: row.text,
      title: row.title,
      date: row.date,
      versiculo_principal: typeof row.versiculo_principal === 'string' 
        ? JSON.parse(row.versiculo_principal) 
        : row.versiculo_principal,
      versiculo_apoio: typeof row.versiculo_apoio === 'string'
        ? JSON.parse(row.versiculo_apoio)
        : row.versiculo_apoio,
      metadata: typeof row.metadata === 'string'
        ? JSON.parse(row.metadata)
        : row.metadata
    }));

    // Extrair versículos usados
    const versiculosUsados = new Set<string>();
    devocionais.forEach(dev => {
      if (dev.versiculo_principal?.referencia) {
        versiculosUsados.add(dev.versiculo_principal.referencia);
      }
      if (dev.versiculo_apoio?.referencia) {
        versiculosUsados.add(dev.versiculo_apoio.referencia);
      }
    });

    // Extrair temas e palavras-chave
    const temasAbordados = new Set<string>();
    const palavrasChave = new Set<string>();
    
    devocionais.forEach(dev => {
      if (dev.metadata?.tema) {
        temasAbordados.add(dev.metadata.tema);
      }
      if (dev.metadata?.conceito_central) {
        temasAbordados.add(dev.metadata.conceito_central);
      }
      if (dev.metadata?.palavras_chave && Array.isArray(dev.metadata.palavras_chave)) {
        dev.metadata.palavras_chave.forEach((palavra: string) => {
          palavrasChave.add(palavra);
        });
      }
    });

    // Construir contexto histórico formatado
    const contextoHistorico = devocionais
      .map(dev => {
        return `[${dev.date}] ${dev.title}\n${dev.text.substring(0, 500)}...`;
      })
      .join('\n\n---\n\n');

    // Último devocional para referência
    const ultimoDevocional = devocionais.length > 0 ? devocionais[0] : null;

    res.json({
      contexto_historico: contextoHistorico,
      versiculos_usados: Array.from(versiculosUsados),
      temas_abordados: Array.from(temasAbordados),
      palavras_chave: Array.from(palavrasChave),
      total_devocionais: devocionais.length,
      periodo_dias: days,
      ultimo_devocional: ultimoDevocional ? {
        date: ultimoDevocional.date,
        title: ultimoDevocional.title,
        tema: ultimoDevocional.metadata?.tema,
        conceito_central: ultimoDevocional.metadata?.conceito_central
      } : null,
      direcionamento_sugerido: ultimoDevocional?.metadata?.relacionado_expressar || 
        'Continuar a jornada de expressar Jesus Cristo em nossa vida diária'
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar contexto:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar contexto',
      message: error.message 
    });
  }
});

/**
 * Configuração do Devocional
 * GET /api/devocional/config
 * IMPORTANTE: Esta rota deve vir ANTES de /:id para não ser capturada
 */
router.get('/config', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM devocional_config ORDER BY id DESC LIMIT 1`
    );

    let config;
    if (result.rows.length === 0) {
      // Criar configuração padrão
      const defaultConfig = await pool.query(
        `INSERT INTO devocional_config (
          dispatch_hour, dispatch_minute, timezone, enabled
        ) VALUES ($1, $2, $3, $4)
        RETURNING *`,
        [6, 0, 'America/Sao_Paulo', true]
      );
      config = defaultConfig.rows[0];
    } else {
      config = result.rows[0];
    }

    // Buscar devocional do dia
    const today = new Date().toISOString().split('T')[0];
    const devocionalResult = await pool.query(
      `SELECT id, title, date, text, versiculo_principal, versiculo_apoio, metadata
       FROM devocionais 
       WHERE date = $1`,
      [today]
    );

    let todayDevocional = null;
    if (devocionalResult.rows.length > 0) {
      const row = devocionalResult.rows[0];
      todayDevocional = {
        id: row.id,
        title: row.title,
        date: row.date,
        text: row.text,
        versiculo_principal: typeof row.versiculo_principal === 'string'
          ? JSON.parse(row.versiculo_principal)
          : row.versiculo_principal,
        versiculo_apoio: typeof row.versiculo_apoio === 'string'
          ? JSON.parse(row.versiculo_apoio)
          : row.versiculo_apoio,
        metadata: typeof row.metadata === 'string'
          ? JSON.parse(row.metadata)
          : row.metadata,
      };
    }

    res.json({ 
      config,
      today_devocional: todayDevocional
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar configuração do devocional:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar configuração',
      message: error.message 
    });
  }
});

/**
 * Buscar devocional por data
 * GET /api/devocional/date/:date (YYYY-MM-DD)
 * IMPORTANTE: Esta rota deve vir ANTES de /:id para não ser capturada
 */
router.get('/date/:date', async (req: express.Request, res: express.Response) => {
  try {
    const { date } = req.params;

    const result = await pool.query(
      `SELECT 
        id,
        text,
        title,
        date,
        versiculo_principal,
        versiculo_apoio,
        metadata,
        created_at,
        updated_at
       FROM devocionais
       WHERE date = $1`,
      [date]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Devocional não encontrado para esta data' });
    }

    const row = result.rows[0];
    const devocional = {
      id: row.id,
      text: row.text,
      title: row.title,
      date: row.date,
      versiculo_principal: typeof row.versiculo_principal === 'string'
        ? JSON.parse(row.versiculo_principal)
        : row.versiculo_principal,
      versiculo_apoio: typeof row.versiculo_apoio === 'string'
        ? JSON.parse(row.versiculo_apoio)
        : row.versiculo_apoio,
      metadata: typeof row.metadata === 'string'
        ? JSON.parse(row.metadata)
        : row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at
    };

    res.json({ devocional });
  } catch (error: any) {
    console.error('❌ Erro ao buscar devocional por data:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar devocional',
      message: error.message 
    });
  }
});

/**
 * Listar devocionais
 * GET /api/devocional?limit=10&offset=0&startDate=&endDate=
 */
router.get('/', async (req: express.Request, res: express.Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    let query = `
      SELECT 
        id,
        text,
        title,
        date,
        versiculo_principal,
        versiculo_apoio,
        metadata,
        created_at,
        updated_at
      FROM devocionais
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (startDate) {
      query += ` AND date >= $${paramCount}`;
      params.push(startDate);
      paramCount++;
    }

    if (endDate) {
      query += ` AND date <= $${paramCount}`;
      params.push(endDate);
      paramCount++;
    }

    query += ` ORDER BY date DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Contar total
    let countQuery = 'SELECT COUNT(*) as total FROM devocionais WHERE 1=1';
    const countParams: any[] = [];
    let countParamCount = 1;

    if (startDate) {
      countQuery += ` AND date >= $${countParamCount}`;
      countParams.push(startDate);
      countParamCount++;
    }

    if (endDate) {
      countQuery += ` AND date <= $${countParamCount}`;
      countParams.push(endDate);
      countParamCount++;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    const devocionais = result.rows.map(row => ({
      id: row.id,
      text: row.text,
      title: row.title,
      date: row.date,
      versiculo_principal: typeof row.versiculo_principal === 'string'
        ? JSON.parse(row.versiculo_principal)
        : row.versiculo_principal,
      versiculo_apoio: typeof row.versiculo_apoio === 'string'
        ? JSON.parse(row.versiculo_apoio)
        : row.versiculo_apoio,
      metadata: typeof row.metadata === 'string'
        ? JSON.parse(row.metadata)
        : row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    res.json({
      devocionais,
      total,
      limit,
      offset
    });
  } catch (error: any) {
    console.error('❌ Erro ao listar devocionais:', error);
    res.status(500).json({ 
      error: 'Erro ao listar devocionais',
      message: error.message 
    });
  }
});

/**
 * Buscar devocional por ID
 * GET /api/devocional/:id
 * IMPORTANTE: Esta rota deve vir DEPOIS das rotas específicas (/config, /date/:date)
 */
router.get('/:id', async (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        id,
        text,
        title,
        date,
        versiculo_principal,
        versiculo_apoio,
        metadata,
        created_at,
        updated_at
       FROM devocionais
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Devocional não encontrado' });
    }

    const row = result.rows[0];
    const devocional = {
      id: row.id,
      text: row.text,
      title: row.title,
      date: row.date,
      versiculo_principal: typeof row.versiculo_principal === 'string'
        ? JSON.parse(row.versiculo_principal)
        : row.versiculo_principal,
      versiculo_apoio: typeof row.versiculo_apoio === 'string'
        ? JSON.parse(row.versiculo_apoio)
        : row.versiculo_apoio,
      metadata: typeof row.metadata === 'string'
        ? JSON.parse(row.metadata)
        : row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at
    };

    res.json({ devocional });
  } catch (error: any) {
    console.error('❌ Erro ao buscar devocional:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar devocional',
      message: error.message 
    });
  }
});

/**
 * Buscar devocional por data
 * GET /api/devocional/date/:date (YYYY-MM-DD)
 */
router.get('/date/:date', async (req: express.Request, res: express.Response) => {
  try {
    const { date } = req.params;

    const result = await pool.query(
      `SELECT 
        id,
        text,
        title,
        date,
        versiculo_principal,
        versiculo_apoio,
        metadata,
        created_at,
        updated_at
       FROM devocionais
       WHERE date = $1`,
      [date]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Devocional não encontrado para esta data' });
    }

    const row = result.rows[0];
    const devocional = {
      id: row.id,
      text: row.text,
      title: row.title,
      date: row.date,
      versiculo_principal: typeof row.versiculo_principal === 'string'
        ? JSON.parse(row.versiculo_principal)
        : row.versiculo_principal,
      versiculo_apoio: typeof row.versiculo_apoio === 'string'
        ? JSON.parse(row.versiculo_apoio)
        : row.versiculo_apoio,
      metadata: typeof row.metadata === 'string'
        ? JSON.parse(row.metadata)
        : row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at
    };

    res.json({ devocional });
  } catch (error: any) {
    console.error('❌ Erro ao buscar devocional por data:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar devocional',
      message: error.message 
    });
  }
});


/**
 * Atualizar configuração do Devocional
 * PUT /api/devocional/config
 */
router.put('/config', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { list_id, dispatch_hour, dispatch_minute, timezone, notification_phone, enabled } = req.body;

    // Buscar configuração existente
    const existing = await pool.query(
      `SELECT id FROM devocional_config ORDER BY id DESC LIMIT 1`
    );

    let result;
    if (existing.rows.length === 0) {
      // Criar nova configuração
      result = await pool.query(
        `INSERT INTO devocional_config (
          list_id, dispatch_hour, dispatch_minute, timezone, 
          notification_phone, enabled
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
        [list_id || null, dispatch_hour || 6, dispatch_minute || 0, 
         timezone || 'America/Sao_Paulo', notification_phone || null, enabled !== false]
      );
    } else {
      // Atualizar configuração existente
      result = await pool.query(
        `UPDATE devocional_config 
         SET list_id = COALESCE($1, list_id),
             dispatch_hour = COALESCE($2, dispatch_hour),
             dispatch_minute = COALESCE($3, dispatch_minute),
             timezone = COALESCE($4, timezone),
             notification_phone = COALESCE($5, notification_phone),
             enabled = COALESCE($6, enabled),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $7
         RETURNING *`,
        [list_id, dispatch_hour, dispatch_minute, timezone, 
         notification_phone, enabled, existing.rows[0].id]
      );
    }

    res.json({ 
      success: true,
      config: result.rows[0],
      message: 'Configuração salva com sucesso'
    });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar configuração do devocional:', error);
    res.status(500).json({ 
      error: 'Erro ao atualizar configuração',
      message: error.message 
    });
  }
});

export default router;
