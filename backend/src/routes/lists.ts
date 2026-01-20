import express from 'express';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Função auxiliar para construir query de lista dinâmica
function buildDynamicListQuery(filterConfig: any, startParam: number, params: any[]): string {
  let query = `
    SELECT DISTINCT
      c.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', t.id,
            'name', t.name,
            'color', t.color,
            'category', t.category
          )
        ) FILTER (WHERE t.id IS NOT NULL),
        '[]'
      ) as tags
    FROM contacts c
    LEFT JOIN contact_tag_relations ctr ON c.id = ctr.contact_id
    LEFT JOIN contact_tags t ON ctr.tag_id = t.id
    WHERE 1=1
  `;
  let paramCount = startParam;

  if (filterConfig.tags && Array.isArray(filterConfig.tags) && filterConfig.tags.length > 0) {
    query += ` AND EXISTS (
      SELECT 1 FROM contact_tag_relations ctr2 
      WHERE ctr2.contact_id = c.id 
      AND ctr2.tag_id = ANY($${paramCount}::int[])
    )`;
    params.push(filterConfig.tags);
    paramCount++;
  }

  if (filterConfig.exclude_tags && Array.isArray(filterConfig.exclude_tags) && filterConfig.exclude_tags.length > 0) {
    query += ` AND NOT EXISTS (
      SELECT 1 FROM contact_tag_relations ctr3 
      WHERE ctr3.contact_id = c.id 
      AND ctr3.tag_id = ANY($${paramCount}::int[])
    )`;
    params.push(filterConfig.exclude_tags);
    paramCount++;
  }

  if (filterConfig.opt_in !== undefined) {
    query += ` AND c.opt_in = $${paramCount}`;
    params.push(filterConfig.opt_in);
    paramCount++;
  }

  if (filterConfig.opt_out !== undefined) {
    query += ` AND c.opt_out = $${paramCount}`;
    params.push(filterConfig.opt_out);
    paramCount++;
  }

  if (filterConfig.whatsapp_validated !== undefined) {
    query += ` AND c.whatsapp_validated = $${paramCount}`;
    params.push(filterConfig.whatsapp_validated);
    paramCount++;
  }
  // Removido filtro obrigatório de whatsapp_validated - deixar opcional para o usuário escolher

  if (filterConfig.last_message_sent_after) {
    query += ` AND c.last_message_sent_at >= $${paramCount}`;
    params.push(filterConfig.last_message_sent_after);
    paramCount++;
  }

  if (filterConfig.last_message_sent_before) {
    query += ` AND c.last_message_sent_at <= $${paramCount}`;
    params.push(filterConfig.last_message_sent_before);
    paramCount++;
  }

  return query;
}

/**
 * Listar listas
 * GET /api/lists?type=
 */
router.get('/', async (req: AuthRequest, res) => {
  try {
    const listType = req.query.type as string;

    let query = `
      SELECT 
        l.*,
        u.name as created_by_name,
        COUNT(DISTINCT li.contact_id) as static_contacts_count
      FROM contact_lists l
      LEFT JOIN users u ON l.created_by = u.id
      LEFT JOIN contact_list_items li ON l.id = li.list_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (listType) {
      query += ` AND l.list_type = $1`;
      params.push(listType);
    }

    query += ` GROUP BY l.id, u.name ORDER BY l.created_at DESC`;

    const result = await pool.query(query, params);

    const lists = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      list_type: row.list_type,
      filter_config: typeof row.filter_config === 'string' ? JSON.parse(row.filter_config) : row.filter_config,
      total_contacts: row.total_contacts || 0,
      static_contacts_count: parseInt(row.static_contacts_count) || 0,
      created_by: row.created_by,
      created_by_name: row.created_by_name,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    res.json({ lists });
  } catch (error: any) {
    console.error('❌ Erro ao listar listas:', error);
    res.status(500).json({ 
      error: 'Erro ao listar listas',
      message: error.message 
    });
  }
});

/**
 * Criar lista
 * POST /api/lists
 */
router.post('/', async (req: AuthRequest, res) => {
  try {
    const {
      name,
      description,
      list_type = 'static',
      filter_config = {}
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name é obrigatório' });
    }

    if (!['static', 'dynamic', 'hybrid'].includes(list_type)) {
      return res.status(400).json({ error: 'list_type deve ser: static, dynamic ou hybrid' });
    }

    const userId = (req as AuthRequest).user?.id;

    const result = await pool.query(
      `INSERT INTO contact_lists (name, description, list_type, filter_config, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, description || null, list_type, JSON.stringify(filter_config), userId || null]
    );

    const list = result.rows[0];
    list.filter_config = typeof list.filter_config === 'string' ? JSON.parse(list.filter_config) : list.filter_config;

    // Calcular total_contacts para listas dinâmicas/híbridas
    if (list_type === 'dynamic' || list_type === 'hybrid') {
      try {
        // Aplicar filtros apenas se especificados pelo usuário
        const finalFilterConfig = {
          ...filter_config,
          // Não forçar whatsapp_validated - deixar o usuário escolher
          opt_in: filter_config.opt_in !== undefined ? filter_config.opt_in : undefined,
          opt_out: filter_config.opt_out !== undefined ? filter_config.opt_out : false
        };

        const params: any[] = [];
        const countQuery = buildDynamicListQuery(finalFilterConfig, 1, params);
        
        // Construir query de contagem corretamente - remover SELECT e GROUP BY
        let countQueryFinal = countQuery
          .replace(/SELECT DISTINCT[\s\S]*?FROM/, 'SELECT COUNT(DISTINCT c.id) as total FROM')
          .replace(/GROUP BY[\s\S]*$/, '');
        
        console.log('📊 Query de contagem:', countQueryFinal);
        console.log('📊 Parâmetros:', params);
        
        const countResult = await pool.query(countQueryFinal, params);
        const dynamicCount = parseInt(countResult.rows[0]?.total || '0');
        
        console.log('📊 Total encontrado:', dynamicCount);
        
        // Atualizar filter_config e total_contacts
        await pool.query(
          `UPDATE contact_lists SET filter_config = $1, total_contacts = $2 WHERE id = $3`,
          [JSON.stringify(finalFilterConfig), dynamicCount, list.id]
        );
        
        // Buscar lista atualizada
        const updatedResult = await pool.query(
          `SELECT * FROM contact_lists WHERE id = $1`,
          [list.id]
        );
        list.total_contacts = parseInt(updatedResult.rows[0]?.total_contacts || '0');
        list.filter_config = finalFilterConfig;
      } catch (error: any) {
        console.error('❌ Erro ao calcular total_contacts:', error);
        console.error('Filter config:', filter_config);
        console.error('Error details:', error.message);
        // Definir total como 0 em caso de erro
        await pool.query(
          `UPDATE contact_lists SET total_contacts = 0 WHERE id = $1`,
          [list.id]
        );
        list.total_contacts = 0;
      }
    }

    res.json({ list });
  } catch (error: any) {
    console.error('❌ Erro ao criar lista:', error);
    res.status(500).json({ 
      error: 'Erro ao criar lista',
      message: error.message 
    });
  }
});

/**
 * Buscar lista por ID
 * GET /api/lists/:id
 */
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        l.*,
        u.name as created_by_name
       FROM contact_lists l
       LEFT JOIN users u ON l.created_by = u.id
       WHERE l.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    const list = result.rows[0];
    list.filter_config = typeof list.filter_config === 'string' ? JSON.parse(list.filter_config) : list.filter_config;

    res.json({ list });
  } catch (error: any) {
    console.error('❌ Erro ao buscar lista:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar lista',
      message: error.message 
    });
  }
});

/**
 * Atualizar lista
 * PUT /api/lists/:id
 */
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, description, list_type, filter_config } = req.body;

    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount}`);
      params.push(name);
      paramCount++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount}`);
      params.push(description);
      paramCount++;
    }

    if (list_type !== undefined) {
      if (!['static', 'dynamic', 'hybrid'].includes(list_type)) {
        return res.status(400).json({ error: 'list_type deve ser: static, dynamic ou hybrid' });
      }
      updates.push(`list_type = $${paramCount}`);
      params.push(list_type);
      paramCount++;
    }

    if (filter_config !== undefined) {
      updates.push(`filter_config = $${paramCount}`);
      params.push(JSON.stringify(filter_config));
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    const result = await pool.query(
      `UPDATE contact_lists 
       SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    const list = result.rows[0];
    list.filter_config = typeof list.filter_config === 'string' ? JSON.parse(list.filter_config) : list.filter_config;

    res.json({ list });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar lista:', error);
    res.status(500).json({ 
      error: 'Erro ao atualizar lista',
      message: error.message 
    });
  }
});

/**
 * Deletar lista
 * DELETE /api/lists/:id
 */
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Verificar se a lista existe
    const listCheck = await pool.query(
      `SELECT id FROM contact_lists WHERE id = $1`,
      [id]
    );

    if (listCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    // Verificar se há referências em devocional_config
    const devocionalConfigCheck = await pool.query(
      `SELECT id FROM devocional_config WHERE list_id = $1`,
      [id]
    );

    if (devocionalConfigCheck.rows.length > 0) {
      // Remover referência (setar para NULL)
      await pool.query(
        `UPDATE devocional_config SET list_id = NULL WHERE list_id = $1`,
        [id]
      );
      console.log(`   ℹ️ Referência removida de devocional_config para lista ${id}`);
    }

    // Verificar se há referências em dispatches
    const dispatchesCheck = await pool.query(
      `SELECT id FROM dispatches WHERE list_id = $1`,
      [id]
    );

    if (dispatchesCheck.rows.length > 0) {
      // Remover referência (setar para NULL)
      await pool.query(
        `UPDATE dispatches SET list_id = NULL WHERE list_id = $1`,
        [id]
      );
      console.log(`   ℹ️ Referência removida de dispatches para lista ${id}`);
    }

    // Agora pode deletar a lista (contact_list_items já tem ON DELETE CASCADE)
    const result = await pool.query(
      `DELETE FROM contact_lists WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    res.json({ success: true, message: 'Lista deletada com sucesso' });
  } catch (error: any) {
    console.error('❌ Erro ao deletar lista:', error);
    res.status(500).json({ 
      error: 'Erro ao deletar lista',
      message: error.message 
    });
  }
});

/**
 * Buscar contatos da lista (com filtros dinâmicos)
 * GET /api/lists/:id/contacts?limit=50&offset=0
 */
router.get('/:id/contacts', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    // Buscar lista
    const listResult = await pool.query(
      `SELECT * FROM contact_lists WHERE id = $1`,
      [id]
    );

    if (listResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    const list = listResult.rows[0];
    const listType = list.list_type;
    const filterConfig = typeof list.filter_config === 'string' 
      ? JSON.parse(list.filter_config) 
      : list.filter_config;

    let query = '';
    const params: any[] = [];
    let paramCount = 1;

    if (listType === 'static') {
      // Lista estática - apenas contatos adicionados manualmente
      query = `
        SELECT DISTINCT
          c.*,
          COALESCE(
            json_agg(
              json_build_object(
                'id', t.id,
                'name', t.name,
                'color', t.color,
                'category', t.category
              )
            ) FILTER (WHERE t.id IS NOT NULL),
            '[]'
          ) as tags
        FROM contacts c
        JOIN contact_list_items li ON c.id = li.contact_id
        LEFT JOIN contact_tag_relations ctr ON c.id = ctr.contact_id
        LEFT JOIN contact_tags t ON ctr.tag_id = t.id
        WHERE li.list_id = $${paramCount}
      `;
      params.push(id);
      paramCount++;
    } else if (listType === 'dynamic') {
      // Lista dinâmica - baseada em filtros
      query = buildDynamicListQuery(filterConfig, paramCount, params);
    } else {
      // Lista híbrida - combina estática + dinâmica
      const staticQuery = `
        SELECT DISTINCT
          c.*,
          COALESCE(
            json_agg(
              json_build_object(
                'id', t.id,
                'name', t.name,
                'color', t.color,
                'category', t.category
              )
            ) FILTER (WHERE t.id IS NOT NULL),
            '[]'
          ) as tags
        FROM contacts c
        JOIN contact_list_items li ON c.id = li.contact_id
        LEFT JOIN contact_tag_relations ctr ON c.id = ctr.contact_id
        LEFT JOIN contact_tags t ON ctr.tag_id = t.id
        WHERE li.list_id = $${paramCount}
      `;
      params.push(id);
      paramCount++;

      const dynamicQuery = buildDynamicListQuery(filterConfig, paramCount, params);
      
      query = `
        SELECT DISTINCT
          c.*,
          COALESCE(
            json_agg(
              json_build_object(
                'id', t.id,
                'name', t.name,
                'color', t.color,
                'category', t.category
              )
            ) FILTER (WHERE t.id IS NOT NULL),
            '[]'
          ) as tags
        FROM (
          ${staticQuery}
          UNION
          ${dynamicQuery.replace(/SELECT DISTINCT.*FROM/, 'SELECT DISTINCT c.*, \'[]\'::json as tags FROM').replace(/GROUP BY c.id/, '')}
        ) c
        LEFT JOIN contact_tag_relations ctr ON c.id = ctr.contact_id
        LEFT JOIN contact_tags t ON ctr.tag_id = t.id
      `;
    }

    query += ` GROUP BY c.id ORDER BY c.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    const contacts = result.rows.map(row => ({
      id: row.id,
      phone_number: row.phone_number,
      name: row.name,
      email: row.email,
      whatsapp_validated: row.whatsapp_validated,
      opt_in: row.opt_in,
      opt_out: row.opt_out,
      source: row.source,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      created_at: row.created_at,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags
    }));

    // Contar total
    let countQuery = '';
    if (listType === 'static') {
      countQuery = `SELECT COUNT(DISTINCT c.id) as total FROM contacts c JOIN contact_list_items li ON c.id = li.contact_id WHERE li.list_id = $1`;
    } else if (listType === 'dynamic') {
      countQuery = buildDynamicListQuery(filterConfig, 1, []).replace(/SELECT DISTINCT.*FROM/, 'SELECT COUNT(DISTINCT c.id) as total FROM').replace(/GROUP BY.*/, '');
    } else {
      // Híbrida - contar ambos
      const staticCount = await pool.query(
        `SELECT COUNT(DISTINCT c.id) as total FROM contacts c JOIN contact_list_items li ON c.id = li.contact_id WHERE li.list_id = $1`,
        [id]
      );
      const dynamicCountQuery = buildDynamicListQuery(filterConfig, 1, []).replace(/SELECT DISTINCT.*FROM/, 'SELECT COUNT(DISTINCT c.id) as total FROM').replace(/GROUP BY.*/, '');
      const dynamicCount = await pool.query(dynamicCountQuery, []);
      
      const total = parseInt(staticCount.rows[0]?.total || '0') + parseInt(dynamicCount.rows[0]?.total || '0');
      return res.json({
        contacts,
        total,
        limit,
        offset
      });
    }
    
    const countResult = await pool.query(
      countQuery,
      listType === 'static' ? [id] : []
    );
    const total = parseInt(countResult.rows[0]?.total || '0');

    res.json({
      contacts,
      total,
      limit,
      offset
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar contatos da lista:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar contatos da lista',
      message: error.message 
    });
  }
});

/**
 * Adicionar contato à lista
 * POST /api/lists/:id/contacts
 */
router.post('/:id/contacts', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { contact_id } = req.body;

    if (!contact_id) {
      return res.status(400).json({ error: 'contact_id é obrigatório' });
    }

    await pool.query(
      `INSERT INTO contact_list_items (list_id, contact_id)
       VALUES ($1, $2)
       ON CONFLICT (list_id, contact_id) DO NOTHING`,
      [id, contact_id]
    );

    // Atualizar total_contacts
    await pool.query(
      `UPDATE contact_lists 
       SET total_contacts = (SELECT COUNT(*) FROM contact_list_items WHERE list_id = $1),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    res.json({ success: true, message: 'Contato adicionado à lista' });
  } catch (error: any) {
    console.error('❌ Erro ao adicionar contato à lista:', error);
    res.status(500).json({ 
      error: 'Erro ao adicionar contato à lista',
      message: error.message 
    });
  }
});

/**
 * Remover contato da lista
 * DELETE /api/lists/:id/contacts/:contactId
 */
router.delete('/:id/contacts/:contactId', async (req: AuthRequest, res) => {
  try {
    const { id, contactId } = req.params;

    await pool.query(
      `DELETE FROM contact_list_items 
       WHERE list_id = $1 AND contact_id = $2`,
      [id, contactId]
    );

    // Atualizar total_contacts
    await pool.query(
      `UPDATE contact_lists 
       SET total_contacts = (SELECT COUNT(*) FROM contact_list_items WHERE list_id = $1),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    res.json({ success: true, message: 'Contato removido da lista' });
  } catch (error: any) {
    console.error('❌ Erro ao remover contato da lista:', error);
    res.status(500).json({ 
      error: 'Erro ao remover contato da lista',
      message: error.message 
    });
  }
});

/**
 * Atualizar lista dinâmica (recalcular contatos)
 * POST /api/lists/:id/refresh
 */
router.post('/:id/refresh', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const listResult = await pool.query(
      `SELECT * FROM contact_lists WHERE id = $1`,
      [id]
    );

    if (listResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    const list = listResult.rows[0];
    
    if (list.list_type === 'static') {
      // Para listas estáticas, apenas contar itens
      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM contact_list_items WHERE list_id = $1`,
        [id]
      );
      const total = parseInt(countResult.rows[0].total);

      await pool.query(
        `UPDATE contact_lists 
         SET total_contacts = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [total, id]
      );
    } else {
      // Para listas dinâmicas/híbridas, contar baseado em filtros
      // (implementação simplificada - pode ser melhorada)
      const filterConfig = typeof list.filter_config === 'string' 
        ? JSON.parse(list.filter_config) 
        : list.filter_config;
      
      // Aqui você pode implementar a lógica de contagem baseada em filtros
      // Por enquanto, vamos apenas atualizar o timestamp
      await pool.query(
        `UPDATE contact_lists 
         SET updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id]
      );
    }

    res.json({ success: true, message: 'Lista atualizada' });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar lista:', error);
    res.status(500).json({ 
      error: 'Erro ao atualizar lista',
      message: error.message 
    });
  }
});

/**
 * Preview de contatos (sem salvar)
 * GET /api/lists/:id/preview
 */
router.get('/:id/preview', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;

    const listResult = await pool.query(
      `SELECT * FROM contact_lists WHERE id = $1`,
      [id]
    );

    if (listResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    const list = listResult.rows[0];
    const filterConfig = typeof list.filter_config === 'string' 
      ? JSON.parse(list.filter_config) 
      : list.filter_config;

    if (list.list_type === 'static') {
      // Lista estática - buscar contatos da lista
      const result = await pool.query(
        `SELECT c.id, c.phone_number, c.name, c.email
         FROM contacts c
         JOIN contact_list_items li ON c.id = li.contact_id
         WHERE li.list_id = $1
         ORDER BY c.created_at DESC
         LIMIT $2`,
        [id, limit]
      );
      
      res.json({ contacts: result.rows, preview: true });
      return;
    }

    // Lista dinâmica ou híbrida - usar filtros
    const params: any[] = [];
    let query: string;
    
    if (list.list_type === 'dynamic') {
      // Lista dinâmica - usar buildDynamicListQuery
      query = buildDynamicListQuery(filterConfig, 1, params);
      // Adicionar GROUP BY e LIMIT
      query += ` GROUP BY c.id ORDER BY c.created_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);
    } else {
      // Lista híbrida - combina estática + dinâmica
      const staticQuery = `
        SELECT DISTINCT 
          c.id,
          c.phone_number,
          c.name,
          c.email,
          c.whatsapp_validated,
          c.opt_in,
          c.opt_out,
          c.created_at
        FROM contacts c
        JOIN contact_list_items li ON c.id = li.contact_id
        WHERE li.list_id = $1
      `;
      
      const dynamicParams: any[] = [id];
      // Construir query dinâmica sem tags agregadas para preview
      let dynamicQueryBase = `
        SELECT DISTINCT
          c.id,
          c.phone_number,
          c.name,
          c.email,
          c.whatsapp_validated,
          c.opt_in,
          c.opt_out,
          c.created_at
        FROM contacts c
        WHERE 1=1
      `;
      let dynamicParamCount = 2;
      
      if (filterConfig.tags && Array.isArray(filterConfig.tags) && filterConfig.tags.length > 0) {
        dynamicQueryBase += ` AND EXISTS (
          SELECT 1 FROM contact_tag_relations ctr2 
          WHERE ctr2.contact_id = c.id 
          AND ctr2.tag_id = ANY($${dynamicParamCount}::int[])
        )`;
        dynamicParams.push(filterConfig.tags);
        dynamicParamCount++;
      }
      
      if (filterConfig.exclude_tags && Array.isArray(filterConfig.exclude_tags) && filterConfig.exclude_tags.length > 0) {
        dynamicQueryBase += ` AND NOT EXISTS (
          SELECT 1 FROM contact_tag_relations ctr3 
          WHERE ctr3.contact_id = c.id 
          AND ctr3.tag_id = ANY($${dynamicParamCount}::int[])
        )`;
        dynamicParams.push(filterConfig.exclude_tags);
        dynamicParamCount++;
      }
      
      if (filterConfig.opt_in !== undefined) {
        dynamicQueryBase += ` AND c.opt_in = $${dynamicParamCount}`;
        dynamicParams.push(filterConfig.opt_in);
        dynamicParamCount++;
      }
      
      if (filterConfig.opt_out !== undefined) {
        dynamicQueryBase += ` AND c.opt_out = $${dynamicParamCount}`;
        dynamicParams.push(filterConfig.opt_out);
        dynamicParamCount++;
      }
      
      if (filterConfig.whatsapp_validated !== undefined) {
        dynamicQueryBase += ` AND c.whatsapp_validated = $${dynamicParamCount}`;
        dynamicParams.push(filterConfig.whatsapp_validated);
        dynamicParamCount++;
      }
      
      query = `
        SELECT DISTINCT
          c.id,
          c.phone_number,
          c.name,
          c.email,
          c.whatsapp_validated,
          c.opt_in,
          c.opt_out,
          c.created_at
        FROM (
          ${staticQuery}
          UNION
          ${dynamicQueryBase}
        ) c
        ORDER BY c.created_at DESC
        LIMIT $${dynamicParamCount}
      `;
      dynamicParams.push(limit);
      params.push(...dynamicParams);
    }
    
    const result = await pool.query(query, params);

    const contacts = result.rows.map((row: any) => ({
      id: row.id,
      phone_number: row.phone_number,
      name: row.name,
      email: row.email,
      whatsapp_validated: row.whatsapp_validated,
      opt_in: row.opt_in,
      opt_out: row.opt_out
    }));

    res.json({ contacts, preview: true });
  } catch (error: any) {
    console.error('❌ Erro ao fazer preview:', error);
    res.status(500).json({ 
      error: 'Erro ao fazer preview',
      message: error.message 
    });
  }
});

export default router;
