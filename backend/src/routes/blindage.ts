import express from 'express';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { BLINDAGE_PROFILES_META, getBlindageProfilePackage } from '../services/blindage';
import { getWorkerConfigSnapshot } from '../services/workerConfigSnapshot';
import {
  applyWorkerDispatchProfile,
  updateWorkerDispatchConfig,
  WorkerConfigValidationError,
} from '../services/workerDispatchConfig';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

/**
 * Configurações do worker (política efetiva + config editável).
 * GET /api/blindage/worker-config
 */
router.get('/worker-config', async (_req: AuthRequest, res) => {
  try {
    const snapshot = await getWorkerConfigSnapshot();
    res.json(snapshot);
  } catch (error: any) {
    console.error('Erro ao carregar worker-config:', error);
    res.status(500).json({
      error: 'Erro ao carregar configurações do worker',
      message: error?.message || String(error),
    });
  }
});

/**
 * Salva configuração editável do worker.
 * PUT /api/blindage/worker-config
 */
router.put('/worker-config', async (req: AuthRequest, res) => {
  try {
    await updateWorkerDispatchConfig(req.body || {}, req.user?.id ?? null);
    const snapshot = await getWorkerConfigSnapshot();
    res.json({
      message: 'Configuração do worker salva',
      ...snapshot,
    });
  } catch (error: any) {
    if (error instanceof WorkerConfigValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Erro ao salvar worker-config:', error);
    res.status(500).json({ error: 'Erro ao salvar configurações do worker', message: error?.message });
  }
});

/**
 * Aplica perfil seguro: simulacao | conservador | moderado
 * POST /api/blindage/worker-config/profile
 */
router.post('/worker-config/profile', async (req: AuthRequest, res) => {
  try {
    const profileId = req.body?.profile || req.body?.profileId;
    if (!profileId || typeof profileId !== 'string') {
      return res.status(400).json({ error: 'Informe profile: simulacao | conservador | moderado' });
    }
    await applyWorkerDispatchProfile(profileId, req.user?.id ?? null);
    const snapshot = await getWorkerConfigSnapshot();
    res.json({
      message: `Perfil "${profileId}" aplicado`,
      ...snapshot,
    });
  } catch (error: any) {
    if (error instanceof WorkerConfigValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Erro ao aplicar perfil worker:', error);
    res.status(500).json({ error: 'Erro ao aplicar perfil', message: error?.message });
  }
});

/**
 * DEPRECATED (legado): rotas de regras blindage_rules / profiles.
 * A UI oficial usa apenas /worker-config (GET/PUT/POST profile).
 * Mutations retornam 410 Gone — leitura ainda responde com aviso de depreciação.
 */
function legacyBlindageGone(res: any, hint?: string) {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', 'worker-config');
  return res.status(410).json({
    deprecated: true,
    error: 'Endpoint legado desativado. Use Worker Config.',
    message: hint || 'Use GET/PUT /api/blindage/worker-config e POST /api/blindage/worker-config/profile',
  });
}

router.get('/profiles', (_req: AuthRequest, res) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', 'worker-config');
  res.json({
    deprecated: true,
    message: 'Use GET/PUT /api/blindage/worker-config e POST /api/blindage/worker-config/profile',
    profiles: BLINDAGE_PROFILES_META,
    profileIds: ['conservative', 'moderate', 'aggressive'],
    apply: { method: 'POST', path: '/api/blindage/worker-config/profile', body: { profile: 'conservador' } },
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
router.post('/profiles/apply', async (_req: AuthRequest, res) => {
  return legacyBlindageGone(
    res,
    'Use POST /api/blindage/worker-config/profile com { profile: "conservador"|"simulacao"|"moderado" }'
  );
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
 * POST /api/blindage/rules — LEGACY 410
 */
router.post('/rules', async (_req: AuthRequest, res) => {
  return legacyBlindageGone(res);
});

/**
 * Atualizar / deletar / reconciliar regras — LEGACY 410
 */
router.put('/rules/:id', async (_req: AuthRequest, res) => {
  return legacyBlindageGone(res);
});

router.delete('/rules/:id', async (_req: AuthRequest, res) => {
  return legacyBlindageGone(res);
});

router.post('/reconcile', async (_req: AuthRequest, res) => {
  return legacyBlindageGone(res);
});

router.post('/rules/default/:instanceId', async (_req: AuthRequest, res) => {
  return legacyBlindageGone(res);
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
