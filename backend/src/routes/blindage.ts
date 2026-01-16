import express from 'express';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { createDefaultRules } from '../services/blindage';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

/**
 * Listar regras de blindagem
 * GET /api/blindage/rules?instanceId=123
 */
router.get('/rules', async (req: AuthRequest, res) => {
  try {
    const { instanceId } = req.query;

    let query: string;
    const params: any[] = [];

    if (instanceId) {
      // Buscar regras globais (instance_id IS NULL) E regras específicas da instância
      query = `
        SELECT 
          br.*,
          i.name as instance_name,
          i.instance_name as instance_identifier
        FROM blindage_rules br
        LEFT JOIN instances i ON br.instance_id = i.id
        WHERE br.enabled = TRUE
          AND (
            br.instance_id IS NULL 
            OR br.instance_id = $1
          )
        ORDER BY br.instance_id NULLS FIRST, br.rule_type, br.id
      `;
      params.push(instanceId);
    } else {
      // Se não há instanceId, buscar apenas regras globais
      query = `
        SELECT 
          br.*,
          i.name as instance_name,
          i.instance_name as instance_identifier
        FROM blindage_rules br
        LEFT JOIN instances i ON br.instance_id = i.id
        WHERE br.enabled = TRUE
          AND br.instance_id IS NULL
        ORDER BY br.rule_type, br.id
      `;
    }

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

    if (enabled !== undefined) {
      updates.push(`enabled = $${paramCount}`);
      params.push(enabled);
      paramCount++;
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

    res.json({ rule: result.rows[0] });
  } catch (error) {
    console.error('Erro ao atualizar regra:', error);
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

/**
 * Listar ações de blindagem
 * GET /api/blindage/actions?instanceId=123&limit=50
 */
router.get('/actions', async (req: AuthRequest, res) => {
  try {
    const { instanceId, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        ba.*,
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

    query += ` ORDER BY ba.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await pool.query(query, params);

    res.json({
      actions: result.rows,
      total: result.rows.length,
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
    const { instanceId } = req.query;

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

    if (instanceId) {
      query += ` AND instance_id = $1`;
      params.push(instanceId);
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
