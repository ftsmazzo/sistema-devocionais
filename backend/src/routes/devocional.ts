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

    // Buscar devocional do dia usando o timezone da configuração (não UTC)
    const timezone = config.timezone || 'America/Sao_Paulo';
    const dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const today = dateFormatter.format(new Date());

    const devocionalResult = await pool.query(
      `SELECT id, title, date, text, versiculo_principal, versiculo_apoio, metadata
       FROM devocionais 
       WHERE date = $1`,
      [today]
    );

    let todayDevocional = null;
    if (devocionalResult.rows.length > 0) {
      const row = devocionalResult.rows[0];
      const dateVal = row.date;
      const dateStr = dateVal == null ? null : typeof dateVal === 'string'
        ? dateVal.slice(0, 10)
        : (dateVal as Date).toISOString().slice(0, 10);
      todayDevocional = {
        id: row.id,
        title: row.title,
        date: dateStr,
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
 * Buscar configuração de IA do Devocional
 * GET /api/devocional/ai-config
 * IMPORTANTE: Registrar ANTES de GET /:id — senão "ai-config" vira parâmetro :id.
 */
router.get('/ai-config', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM devocional_ai_config ORDER BY id DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.json({
        config: {
          central_theme: 'Expressar',
          journey_description: 'Uma jornada de fé focada em expressar Cristo no dia a dia.',
          preaching_tone: 'Afetuoso, inspirador, levemente bem humorado e acolhedor.',
          bible_version: 'ACF',
          signature: 'Alex e Daniela Mantovani',
          model_name: 'gemini-1.5-flash',
          character_limit: 4000
        }
      });
    }

    // Não retornar a API Key por segurança
    const config = result.rows[0];
    const hasDbKey = !!config.gemini_api_key;
    const hasEnvKey = !!process.env.GEMINI_API_KEY;

    res.json({
      config: {
        ...config,
        gemini_api_key: hasDbKey ? '********' : null,
        has_server_key: hasEnvKey
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar configuração de IA:', error);
    res.status(500).json({ error: 'Erro ao buscar configuração de IA' });
  }
});

/**
 * Atualizar configuração de IA do Devocional
 * PUT /api/devocional/ai-config
 */
router.put('/ai-config', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const {
      central_theme, journey_description, preaching_tone,
      bible_version, signature, gemini_api_key,
      model_name, character_limit, enabled
    } = req.body;

    const existing = await pool.query(
      `SELECT id FROM devocional_ai_config ORDER BY id DESC LIMIT 1`
    );

    const updateKey = typeof gemini_api_key === 'string'
      && gemini_api_key.trim().length > 0
      && gemini_api_key !== '********';

    let result;
    if (existing.rows.length === 0) {
      result = await pool.query(
        `INSERT INTO devocional_ai_config (
          central_theme, journey_description, preaching_tone,
          bible_version, signature, gemini_api_key,
          model_name, character_limit, enabled
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          central_theme, journey_description, preaching_tone,
          bible_version, signature,
          updateKey ? gemini_api_key.trim() : null,
          model_name, character_limit, enabled !== false
        ]
      );
    } else {
      const id = existing.rows[0].id;
      const sets = [
        'central_theme = COALESCE(NULLIF(TRIM($1::text), \'\'), central_theme)',
        'journey_description = COALESCE(NULLIF(TRIM($2::text), \'\'), journey_description)',
        'preaching_tone = COALESCE(NULLIF(TRIM($3::text), \'\'), preaching_tone)',
        'bible_version = COALESCE(NULLIF(TRIM($4::text), \'\'), bible_version)',
        'signature = COALESCE(NULLIF(TRIM($5::text), \'\'), signature)',
        'model_name = COALESCE(NULLIF(TRIM($6::text), \'\'), model_name)',
        'character_limit = COALESCE($7, character_limit)',
        'enabled = COALESCE($8, enabled)',
        'updated_at = CURRENT_TIMESTAMP'
      ];
      const params: any[] = [
        central_theme ?? null,
        journey_description ?? null,
        preaching_tone ?? null,
        bible_version ?? null,
        signature ?? null,
        model_name ?? null,
        character_limit ?? null,
        enabled ?? null
      ];

      let nextParam = 9;
      if (updateKey) {
        sets.splice(sets.length - 1, 0, `gemini_api_key = $${nextParam}`);
        params.push(gemini_api_key.trim());
        nextParam++;
      }

      params.push(id);

      const query = `
        UPDATE devocional_ai_config
        SET ${sets.join(', ')}
        WHERE id = $${nextParam}
        RETURNING *
      `;

      result = await pool.query(query, params);
    }

    res.json({
      success: true,
      config: { ...result.rows[0], gemini_api_key: '********' },
      message: 'Configuração de IA salva com sucesso'
    });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar configuração de IA:', error);
    res.status(500).json({ error: 'Erro ao salvar configuração de IA' });
  }
});

function normJourneyDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Listar jornadas (cada uma com período e texto próprios — a ativa é usada na geração)
 * GET /api/devocional/journeys
 */
router.get('/journeys', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, central_theme, journey_description, preaching_tone,
              bible_version, signature, start_date, end_date, is_active,
              created_at, updated_at
       FROM devocional_journeys
       ORDER BY start_date DESC, id DESC`
    );
    res.json({ journeys: result.rows });
  } catch (error: any) {
    console.error('❌ Erro ao listar jornadas:', error);
    res.status(500).json({ error: 'Erro ao listar jornadas' });
  }
});

/**
 * Criar jornada
 * POST /api/devocional/journeys
 */
router.post('/journeys', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const {
      title, central_theme, journey_description, preaching_tone,
      bible_version, signature, start_date, end_date, activate
    } = req.body;

    const titleNorm = title != null && String(title).trim() ? String(title).trim() : 'Nova jornada';
    const start = normJourneyDate(start_date);
    if (!start) {
      return res.status(400).json({ error: 'Data de início da jornada é obrigatória (AAAA-MM-DD).' });
    }
    const end = normJourneyDate(end_date);
    if (end && end < start) {
      return res.status(400).json({ error: 'Data fim deve ser >= data início.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (activate === true) {
        await client.query(`UPDATE devocional_journeys SET is_active = false`);
      }
      const ins = await client.query(
        `INSERT INTO devocional_journeys (
          title, central_theme, journey_description, preaching_tone,
          bible_version, signature, start_date, end_date, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          titleNorm,
          central_theme ?? '',
          journey_description ?? '',
          preaching_tone ?? '',
          bible_version ?? 'ACF',
          signature ?? '',
          start,
          end,
          activate === true
        ]
      );
      if (activate !== true) {
        const cnt = await client.query(
          `SELECT COUNT(*)::int AS c FROM devocional_journeys WHERE is_active = true`
        );
        if (cnt.rows[0].c === 0) {
          await client.query(
            `UPDATE devocional_journeys SET is_active = true WHERE id = $1`,
            [ins.rows[0].id]
          );
        }
      }
      await client.query('COMMIT');
      const fin = await pool.query(`SELECT * FROM devocional_journeys WHERE id = $1`, [ins.rows[0].id]);
      res.status(201).json({ success: true, journey: fin.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('❌ Erro ao criar jornada:', error);
    res.status(500).json({ error: 'Erro ao criar jornada', message: error.message });
  }
});

/**
 * Atualizar jornada
 * PUT /api/devocional/journeys/:journeyId
 */
router.put('/journeys/:journeyId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const journeyId = parseInt(req.params.journeyId, 10);
    if (Number.isNaN(journeyId)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const {
      title, central_theme, journey_description, preaching_tone,
      bible_version, signature, start_date, end_date
    } = req.body;

    const start = normJourneyDate(start_date);
    if (!start) {
      return res.status(400).json({ error: 'Data de início da jornada é obrigatória (AAAA-MM-DD).' });
    }
    const end = normJourneyDate(end_date);
    if (end && end < start) {
      return res.status(400).json({ error: 'Data fim deve ser >= data início.' });
    }

    const titleNorm = title != null && String(title).trim() ? String(title).trim() : 'Jornada';

    const result = await pool.query(
      `UPDATE devocional_journeys SET
        title = $1,
        central_theme = $2,
        journey_description = $3,
        preaching_tone = $4,
        bible_version = $5,
        signature = $6,
        start_date = $7::date,
        end_date = $8::date,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING *`,
      [
        titleNorm,
        central_theme ?? '',
        journey_description ?? '',
        preaching_tone ?? '',
        bible_version ?? 'ACF',
        signature ?? '',
        start,
        end,
        journeyId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Jornada não encontrada' });
    }

    res.json({ success: true, journey: result.rows[0] });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar jornada:', error);
    res.status(500).json({ error: 'Erro ao atualizar jornada' });
  }
});

/**
 * Definir jornada ativa (única usada na geração por IA)
 * POST /api/devocional/journeys/:journeyId/activate
 */
router.post('/journeys/:journeyId/activate', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const journeyId = parseInt(req.params.journeyId, 10);
    if (Number.isNaN(journeyId)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const chk = await client.query(`SELECT id FROM devocional_journeys WHERE id = $1`, [journeyId]);
      if (chk.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Jornada não encontrada' });
      }
      await client.query(`UPDATE devocional_journeys SET is_active = false`);
      await client.query(
        `UPDATE devocional_journeys SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [journeyId]
      );
      await client.query('COMMIT');
      const result = await pool.query(`SELECT * FROM devocional_journeys WHERE id = $1`, [journeyId]);
      res.json({ success: true, journey: result.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('❌ Erro ao ativar jornada:', error);
    res.status(500).json({ error: 'Erro ao ativar jornada' });
  }
});

/**
 * Excluir jornada
 * DELETE /api/devocional/journeys/:journeyId
 */
router.delete('/journeys/:journeyId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const journeyId = parseInt(req.params.journeyId, 10);
    if (Number.isNaN(journeyId)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const row = await pool.query(
      `SELECT is_active FROM devocional_journeys WHERE id = $1`,
      [journeyId]
    );
    if (row.rows.length === 0) {
      return res.status(404).json({ error: 'Jornada não encontrada' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (row.rows[0].is_active) {
        const other = await client.query(
          `SELECT id FROM devocional_journeys WHERE id <> $1 ORDER BY start_date DESC, id DESC LIMIT 1`,
          [journeyId]
        );
        if (other.rows.length > 0) {
          await client.query(`UPDATE devocional_journeys SET is_active = false`);
          await client.query(
            `UPDATE devocional_journeys SET is_active = true WHERE id = $1`,
            [other.rows[0].id]
          );
        }
      }
      await client.query(`DELETE FROM devocional_journeys WHERE id = $1`, [journeyId]);
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('❌ Erro ao excluir jornada:', error);
    res.status(500).json({ error: 'Erro ao excluir jornada' });
  }
});

/**
 * Gerar devocional manualmente via IA
 * POST /api/devocional/generate
 */
router.post('/generate', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: 'Data é obrigatória' });

    const { DevocionalGenerator } = await import('../services/DevocionalGenerator');
    const generator = new DevocionalGenerator();
    const result = await generator.generate(date);

    res.json({ success: true, devocional: result });
  } catch (error: any) {
    console.error('❌ Erro na geração manual:', error);
    res.status(500).json({ error: 'Falha na geração do devocional', message: error.message });
  }
});

/**
 * Buscar devocional por ID
 * GET /api/devocional/:id
 * IMPORTANTE: Esta rota deve vir DEPOIS das rotas específicas (/config, /date/:date, /ai-config, /generate)
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
