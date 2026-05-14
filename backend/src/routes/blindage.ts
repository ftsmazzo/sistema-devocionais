import express from 'express';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { createDefaultRules, reconcileBlindageRuleConfigs, applyBlindageGlobalProfile, BLINDAGE_PROFILES_META, getBlindageProfilePackage } from '../services/blindage';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

/**
 * Listar perfis de blindagem (Fase A — presets globais estilo MassFlow).
 * GET /api/blindage/profiles
 */
router.get('/profiles', (_req: AuthRequest, res) => {
  res.json({
    profiles: BLINDAGE_PROFILES_META,
    profileIds: ['conservative', 'moderate', 'aggressive'],
    apply: { method: 'POST', path: '/api/blindage/profiles/apply', body: { profileId: 'moderate', dryRun: false } },
  });
});

/**
 * Ver pacote JSON de um perfil (sem gravar no banco).
 * GET /api/blindage/profiles/:profileId
 */
router.get('/profiles/:profileId', (req: AuthRequest, res) => {
  const pkg = getBlindageProfilePackage(req.params.profileId);
  if (!pkg) {
    return res.status(404).json({ error: 'Perfil não encontrado. Use: conservative | moderate | aggressive' });
  }
  res.json({ profileId: req.params.profileId, package: pkg });
});

/**
 * Aplicar perfil às regras globais (substitui `config` de cada `rule_type` do pacote).
 * POST /api/blindage/profiles/apply
 * Body: { "profileId": "moderate", "dryRun": false }
 */
router.post('/profiles/apply', async (req: AuthRequest, res) => {
  try {
    const profileId = req.body?.profileId;
    if (!profileId || typeof profileId !== 'string') {
      return res.status(400).json({
        error: 'Campo profileId obrigatório',
        hint: 'conservative | moderate | aggressive',
      });
    }
    const dryRun = req.body?.dryRun === true;
    const result = await applyBlindageGlobalProfile(profileId, { dryRun });
    res.json({
      message: dryRun ? 'Simulação: nenhuma alteração gravada' : 'Perfil aplicado às regras globais',
      ...result,
    });
  } catch (error: any) {
    const msg = error?.message || String(error);
    if (msg.includes('inválido') || msg.includes('Perfil')) {
      return res.status(400).json({ error: msg });
    }
    console.error('Erro ao aplicar perfil de blindagem:', error);
    res.status(500).json({ error: 'Erro ao aplicar perfil de blindagem' });
  }
});

/**
 * Listar regras de blindagem
 * GET /api/blindage/rules?instanceId=123&enabledOnly=true
 * 
 * Por padrão, retorna TODAS as regras (habilitadas e desabilitadas)
 * Use ?enabledOnly=true para filtrar apenas regras habilitadas
 */
router.get('/rules', async (req: AuthRequest, res) => {
  try {
    const { instanceId, enabledOnly } = req.query;

    let query: string;
    const params: any[] = [];
    let paramCount = 1;

    // Construir WHERE clause
    const whereConditions: string[] = [];
    
    // Filtrar por enabled apenas se enabledOnly=true
    if (enabledOnly === 'true') {
      whereConditions.push(`br.enabled = TRUE`);
    }

    if (instanceId) {
      // Buscar regras globais (instance_id IS NULL) E regras específicas da instância
      whereConditions.push(`(
        br.instance_id IS NULL 
        OR br.instance_id = $${paramCount}
      )`);
      params.push(instanceId);
      paramCount++;
    } else {
      // Se não há instanceId, buscar apenas regras globais (instance_id IS NULL)
      whereConditions.push(`br.instance_id IS NULL`);
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    query = `
      SELECT 
        br.*,
        i.name as instance_name,
        i.instance_name as instance_identifier
      FROM blindage_rules br
      LEFT JOIN instances i ON br.instance_id = i.id
      ${whereClause}
      ORDER BY br.instance_id NULLS FIRST, br.enabled DESC, br.rule_type, br.id
    `;

    const result = await pool.query(query, params);

    res.json({ rules: result.rows });
  } catch (error) {
    console.error('Erro ao listar regras de blindagem:', error);
    res.status(500).json({ error: 'Erro ao listar regras de blindagem' });
  }
});

/**
 * Buscar regra por ID
 * GET /api/blindage/rules/:id
 */
router.get('/rules/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        br.*,
        i.name as instance_name,
        i.instance_name as instance_identifier
      FROM blindage_rules br
      LEFT JOIN instances i ON br.instance_id = i.id
      WHERE br.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Regra não encontrada' });
    }

    res.json({ rule: result.rows[0] });
  } catch (error) {
    console.error('Erro ao buscar regra:', error);
    res.status(500).json({ error: 'Erro ao buscar regra' });
  }
});

/**
 * Criar regra de blindagem
 * POST /api/blindage/rules
 */
router.post('/rules', async (req: AuthRequest, res) => {
  try {
    const { instance_id, rule_name, rule_type, enabled = true, config } = req.body;

    if (!rule_name || !rule_type || !config) {
      return res.status(400).json({
        error: 'Campos obrigatórios: rule_name, rule_type, config',
      });
    }

    // instance_id pode ser null para regras globais (ex: instance_selection)
    // Se fornecido, validar que a instância existe
    if (instance_id !== null && instance_id !== undefined) {
      const instanceCheck = await pool.query(
        'SELECT id FROM instances WHERE id = $1',
        [instance_id]
      );

      if (instanceCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Instância não encontrada' });
      }
    }

    const result = await pool.query(
      `INSERT INTO blindage_rules (instance_id, rule_name, rule_type, enabled, config)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [instance_id, rule_name, rule_type, enabled, JSON.stringify(config)]
    );

    res.status(201).json({ rule: result.rows[0] });
  } catch (error: any) {
    console.error('Erro ao criar regra:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Regra já existe' });
    }
    res.status(500).json({ error: 'Erro ao criar regra' });
  }
});

/**
 * Atualizar regra de blindagem
 * PUT /api/blindage/rules/:id
 */
router.put('/rules/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { rule_name, rule_type, enabled, config } = req.body;

    console.log(`📝 Atualizando regra ${id}:`, { rule_name, rule_type, enabled, config });

    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (rule_name !== undefined) {
      updates.push(`rule_name = $${paramCount}`);
      params.push(rule_name);
      paramCount++;
    }

    if (rule_type !== undefined) {
      updates.push(`rule_type = $${paramCount}`);
      params.push(rule_type);
      paramCount++;
    }

    // IMPORTANTE: enabled pode ser false, então verificar explicitamente !== undefined
    if (enabled !== undefined && enabled !== null) {
      // Garantir que seja boolean
      const enabledValue = enabled === true || enabled === 'true' || enabled === 1;
      updates.push(`enabled = $${paramCount}`);
      params.push(enabledValue);
      paramCount++;
      console.log(`   ✅ Campo 'enabled' será atualizado para: ${enabledValue}`);
    }

    if (config !== undefined) {
      updates.push(`config = $${paramCount}`);
      params.push(JSON.stringify(config));
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    const result = await pool.query(
      `UPDATE blindage_rules 
       SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Regra não encontrada' });
    }

    console.log(`✅ Regra ${id} atualizada com sucesso. enabled: ${result.rows[0].enabled}`);

    res.json({ rule: result.rows[0] });
  } catch (error) {
    console.error('❌ Erro ao atualizar regra:', error);
    res.status(500).json({ error: 'Erro ao atualizar regra' });
  }
});

/**
 * Deletar regra de blindagem
 * DELETE /api/blindage/rules/:id
 */
router.delete('/rules/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM blindage_rules WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Regra não encontrada' });
    }

    res.json({ message: 'Regra deletada com sucesso', rule: result.rows[0] });
  } catch (error) {
    console.error('Erro ao deletar regra:', error);
    res.status(500).json({ error: 'Erro ao deletar regra' });
  }
});

/**
 * Reconciliar configs de blindagem com o template canônico (merge de chaves ausentes).
 * POST /api/blindage/reconcile
 * Body opcional: { "dryRun": true, "strict": true }
 */
router.post('/reconcile', async (req: AuthRequest, res) => {
  try {
    const dryRun = req.body?.dryRun === true;
    const strict = req.body?.strict === true;
    const result = await reconcileBlindageRuleConfigs({ dryRun, strict });
    res.json({
      message: dryRun
        ? 'Simulação de reconciliação concluída (nenhuma alteração gravada)'
        : 'Reconciliação concluída',
      ...result,
    });
  } catch (error) {
    console.error('Erro na reconciliação de blindagem:', error);
    res.status(500).json({ error: 'Erro ao reconciliar regras de blindagem' });
  }
});

/**
 * Criar regras padrão para uma instância
 * POST /api/blindage/rules/default/:instanceId
 */
router.post('/rules/default/:instanceId', async (req: AuthRequest, res) => {
  try {
    const { instanceId } = req.params;

    // Validar que a instância existe
    const instanceCheck = await pool.query(
      'SELECT id FROM instances WHERE id = $1',
      [instanceId]
    );

    if (instanceCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    await createDefaultRules(parseInt(instanceId));

    // Buscar regras criadas
    const rules = await pool.query(
      'SELECT * FROM blindage_rules WHERE instance_id = $1',
      [instanceId]
    );

    res.status(201).json({
      message: 'Regras padrão criadas com sucesso',
      rules: rules.rows,
    });
  } catch (error) {
    console.error('Erro ao criar regras padrão:', error);
    res.status(500).json({ error: 'Erro ao criar regras padrão' });
  }
});

function csvEscapeCell(raw: string): string {
  const s = raw ?? '';
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function actionDataToCsvCell(data: unknown): string {
  if (data == null) return '';
  if (typeof data === 'string') return csvEscapeCell(data);
  try {
    return csvEscapeCell(JSON.stringify(data));
  } catch {
    return '';
  }
}

/**
 * Exportar ações de blindagem em CSV (Fase D).
 * GET /api/blindage/actions/export?instanceId=&actionType=&limit=5000&since=&until=
 * — `limit` máximo 10000.
 */
router.get('/actions/export', async (req: AuthRequest, res) => {
  try {
    const rawLimit = parseInt(String(req.query.limit ?? '5000'), 10);
    const limit = Math.min(10000, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 5000));
    const { instanceId, actionType, since, until } = req.query;

    let query = `
      SELECT 
        ba.id,
        ba.created_at,
        ba.action_type,
        ba.instance_id,
        ba.rule_id,
        ba.action_data,
        br.rule_name,
        br.rule_type,
        i.name as instance_name
      FROM blindage_actions ba
      LEFT JOIN blindage_rules br ON ba.rule_id = br.id
      LEFT JOIN instances i ON ba.instance_id = i.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (instanceId) {
      query += ` AND ba.instance_id = $${paramCount}`;
      params.push(instanceId);
      paramCount++;
    }

    if (actionType && typeof actionType === 'string' && actionType.length > 0 && actionType.length <= 80) {
      query += ` AND ba.action_type = $${paramCount}`;
      params.push(actionType);
      paramCount++;
    }

    if (since && typeof since === 'string') {
      const d = new Date(since);
      if (!Number.isNaN(d.getTime())) {
        query += ` AND ba.created_at >= $${paramCount}::timestamptz`;
        params.push(d.toISOString());
        paramCount++;
      }
    }

    if (until && typeof until === 'string') {
      const d = new Date(until);
      if (!Number.isNaN(d.getTime())) {
        query += ` AND ba.created_at <= $${paramCount}::timestamptz`;
        params.push(d.toISOString());
        paramCount++;
      }
    }

    query += ` ORDER BY ba.created_at DESC LIMIT $${paramCount}`;
    params.push(limit);

    const result = await pool.query(query, params);

    const header = [
      'id',
      'created_at',
      'action_type',
      'instance_id',
      'instance_name',
      'rule_id',
      'rule_name',
      'rule_type',
      'action_data',
    ];
    const lines = [header.join(',')];
    for (const row of result.rows) {
      const ad = actionDataToCsvCell(row.action_data);
      const cells = [
        csvEscapeCell(String(row.id ?? '')),
        csvEscapeCell(row.created_at ? new Date(row.created_at).toISOString() : ''),
        csvEscapeCell(String(row.action_type ?? '')),
        csvEscapeCell(row.instance_id != null ? String(row.instance_id) : ''),
        csvEscapeCell(String(row.instance_name ?? '')),
        csvEscapeCell(row.rule_id != null ? String(row.rule_id) : ''),
        csvEscapeCell(String(row.rule_name ?? '')),
        csvEscapeCell(String(row.rule_type ?? '')),
        ad,
      ];
      lines.push(cells.join(','));
    }

    const body = `\ufeff${lines.join('\n')}\n`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="blindagem-acoes.csv"');
    res.send(body);
  } catch (error) {
    console.error('Erro ao exportar ações de blindagem:', error);
    res.status(500).json({ error: 'Erro ao exportar ações de blindagem' });
  }
});

/**
 * Listar ações de blindagem (Fase C — observabilidade; `total` = total de linhas no filtro, não só da página).
 * GET /api/blindage/actions?instanceId=123&actionType=limit_reached&limit=50&offset=0
 */
router.get('/actions', async (req: AuthRequest, res) => {
  try {
    const { instanceId, actionType, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        ba.*,
        br.rule_name,
        br.rule_type,
        i.name as instance_name,
        COUNT(*) OVER()::int AS _filter_total
      FROM blindage_actions ba
      LEFT JOIN blindage_rules br ON ba.rule_id = br.id
      LEFT JOIN instances i ON ba.instance_id = i.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (instanceId) {
      query += ` AND ba.instance_id = $${paramCount}`;
      params.push(instanceId);
      paramCount++;
    }

    if (actionType && typeof actionType === 'string' && actionType.length > 0 && actionType.length <= 80) {
      query += ` AND ba.action_type = $${paramCount}`;
      params.push(actionType);
      paramCount++;
    }

    query += ` ORDER BY ba.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit as string, 10) || 50, parseInt(offset as string, 10) || 0);

    const result = await pool.query(query, params);

    const total =
      result.rows.length > 0 ? Number((result.rows[0] as { _filter_total?: number })._filter_total) || 0 : 0;
    const actions = result.rows.map((row: Record<string, unknown>) => {
      const { _filter_total: _t, ...rest } = row;
      return rest;
    });

    res.json({
      actions,
      total,
    });
  } catch (error) {
    console.error('Erro ao listar ações de blindagem:', error);
    res.status(500).json({ error: 'Erro ao listar ações de blindagem' });
  }
});

/**
 * Estatísticas de blindagem
 * GET /api/blindage/stats?instanceId=123
 */
router.get('/stats', async (req: AuthRequest, res) => {
  try {
    const { instanceId, actionType } = req.query;

    let query = `
      SELECT 
        action_type,
        COUNT(*) as count,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as last_24h,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '1 hour' THEN 1 END) as last_hour
      FROM blindage_actions
      WHERE 1=1
    `;
    const params: any[] = [];
    let n = 1;

    if (instanceId) {
      query += ` AND instance_id = $${n}`;
      params.push(instanceId);
      n++;
    }

    if (actionType && typeof actionType === 'string' && actionType.length > 0 && actionType.length <= 80) {
      query += ` AND action_type = $${n}`;
      params.push(actionType);
      n++;
    }

    query += ` GROUP BY action_type ORDER BY count DESC`;

    const result = await pool.query(query, params);

    res.json({ stats: result.rows });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

export default router;
