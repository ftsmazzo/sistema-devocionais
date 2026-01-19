import express from 'express';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

/**
 * Listar tags
 * GET /api/tags?category=
 */
router.get('/', async (req: AuthRequest, res) => {
  try {
    const category = req.query.category as string;

    let query = `
      SELECT 
        t.*,
        COUNT(ctr.contact_id) as total_contacts
      FROM contact_tags t
      LEFT JOIN contact_tag_relations ctr ON t.id = ctr.tag_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (category) {
      query += ` AND t.category = $1`;
      params.push(category);
    }

    query += ` GROUP BY t.id ORDER BY t.name`;

    const result = await pool.query(query, params);

    const tags = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      color: row.color,
      description: row.description,
      category: row.category,
      total_contacts: parseInt(row.total_contacts) || 0,
      created_at: row.created_at
    }));

    res.json({ tags });
  } catch (error: any) {
    console.error('❌ Erro ao listar tags:', error);
    res.status(500).json({ 
      error: 'Erro ao listar tags',
      message: error.message 
    });
  }
});

/**
 * Criar tag
 * POST /api/tags
 */
router.post('/', async (req: AuthRequest, res) => {
  try {
    const {
      name,
      color = '#6366f1',
      description,
      category = 'custom'
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name é obrigatório' });
    }

    const result = await pool.query(
      `INSERT INTO contact_tags (name, color, description, category)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, color, description || null, category]
    );

    res.json({ tag: result.rows[0] });
  } catch (error: any) {
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Tag com este nome já existe' });
    }
    console.error('❌ Erro ao criar tag:', error);
    res.status(500).json({ 
      error: 'Erro ao criar tag',
      message: error.message 
    });
  }
});

/**
 * Buscar tag por ID
 * GET /api/tags/:id
 */
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        t.*,
        COUNT(ctr.contact_id) as total_contacts
       FROM contact_tags t
       LEFT JOIN contact_tag_relations ctr ON t.id = ctr.tag_id
       WHERE t.id = $1
       GROUP BY t.id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tag não encontrada' });
    }

    const tag = result.rows[0];
    tag.total_contacts = parseInt(tag.total_contacts) || 0;

    res.json({ tag });
  } catch (error: any) {
    console.error('❌ Erro ao buscar tag:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar tag',
      message: error.message 
    });
  }
});

/**
 * Atualizar tag
 * PUT /api/tags/:id
 */
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, color, description, category } = req.body;

    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount}`);
      params.push(name);
      paramCount++;
    }

    if (color !== undefined) {
      updates.push(`color = $${paramCount}`);
      params.push(color);
      paramCount++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount}`);
      params.push(description);
      paramCount++;
    }

    if (category !== undefined) {
      updates.push(`category = $${paramCount}`);
      params.push(category);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    params.push(id);

    const result = await pool.query(
      `UPDATE contact_tags 
       SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tag não encontrada' });
    }

    res.json({ tag: result.rows[0] });
  } catch (error: any) {
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Tag com este nome já existe' });
    }
    console.error('❌ Erro ao atualizar tag:', error);
    res.status(500).json({ 
      error: 'Erro ao atualizar tag',
      message: error.message 
    });
  }
});

/**
 * Deletar tag
 * DELETE /api/tags/:id
 */
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Verificar se é tag padrão (não pode deletar)
    const tagResult = await pool.query(
      `SELECT category FROM contact_tags WHERE id = $1`,
      [id]
    );

    if (tagResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tag não encontrada' });
    }

    const category = tagResult.rows[0].category;
    const defaultCategories = ['devocional', 'marketing', 'vip', 'teste', 'bloqueado'];
    
    if (defaultCategories.includes(category)) {
      return res.status(400).json({ error: 'Não é possível deletar tags padrão' });
    }

    await pool.query(
      `DELETE FROM contact_tags WHERE id = $1`,
      [id]
    );

    res.json({ success: true, message: 'Tag deletada com sucesso' });
  } catch (error: any) {
    console.error('❌ Erro ao deletar tag:', error);
    res.status(500).json({ 
      error: 'Erro ao deletar tag',
      message: error.message 
    });
  }
});

export default router;
