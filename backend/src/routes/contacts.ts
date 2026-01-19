import express from 'express';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

/**
 * Listar contatos
 * GET /api/contacts?limit=50&offset=0&search=&optIn=&optOut=&whatsappValidated=&tags=
 */
router.get('/', async (req: AuthRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const search = req.query.search as string;
    const optIn = req.query.optIn as string;
    const optOut = req.query.optOut as string;
    const whatsappValidated = req.query.whatsappValidated as string;
    const tags = req.query.tags as string; // IDs separados por vírgula

    // Primeiro, buscar IDs de contatos que atendem aos filtros
    let baseQuery = `
      SELECT DISTINCT c.id
      FROM contacts c
      LEFT JOIN contact_tag_relations ctr ON c.id = ctr.contact_id
      LEFT JOIN contact_tags t ON ctr.tag_id = t.id
      WHERE 1=1
    `;
    const baseParams: any[] = [];
    let baseParamCount = 1;

    if (search) {
      baseQuery += ` AND (c.name ILIKE $${baseParamCount} OR c.phone_number ILIKE $${baseParamCount} OR c.email ILIKE $${baseParamCount})`;
      baseParams.push(`%${search}%`);
      baseParamCount++;
    }

    if (optIn === 'true') {
      baseQuery += ` AND c.opt_in = TRUE`;
    } else if (optIn === 'false') {
      baseQuery += ` AND c.opt_in = FALSE`;
    }

    if (optOut === 'true') {
      baseQuery += ` AND c.opt_out = TRUE`;
    } else if (optOut === 'false') {
      baseQuery += ` AND c.opt_out = FALSE`;
    }

    if (whatsappValidated === 'true') {
      baseQuery += ` AND c.whatsapp_validated = TRUE`;
    } else if (whatsappValidated === 'false') {
      baseQuery += ` AND c.whatsapp_validated = FALSE`;
    }

    // Filtro por tags
    if (tags) {
      const tagIds = tags.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (tagIds.length > 0) {
        baseQuery += ` AND EXISTS (
          SELECT 1 FROM contact_tag_relations ctr2 
          WHERE ctr2.contact_id = c.id 
          AND ctr2.tag_id = ANY($${baseParamCount}::int[])
        )`;
        baseParams.push(tagIds);
        baseParamCount++;
      }
    }

    // Agora buscar os contatos completos com tags
    let query = `
      SELECT 
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
          '[]'::json
        ) as tags
      FROM contacts c
      LEFT JOIN contact_tag_relations ctr ON c.id = ctr.contact_id
      LEFT JOIN contact_tags t ON ctr.tag_id = t.id
      WHERE c.id IN (${baseQuery})
      GROUP BY c.id, c.phone_number, c.name, c.email, c.whatsapp_validated, c.whatsapp_validated_at,
               c.opt_in, c.opt_in_at, c.opt_out, c.opt_out_at, c.opt_out_reason, c.source, c.metadata,
               c.created_at, c.updated_at, c.last_message_sent_at, c.last_message_received_at,
               c.total_messages_sent, c.total_messages_received
      ORDER BY c.created_at DESC LIMIT $${baseParamCount} OFFSET $${baseParamCount + 1}
    `;
    const params = [...baseParams, limit, offset];

    const result = await pool.query(query, params);

    // Contar total (usar mesma query base, mas sem JOIN de tags para performance)
    let countQuery = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM contacts c
      WHERE 1=1
    `;
    const countParams: any[] = [];
    let countParamCount = 1;

    if (search) {
      countQuery += ` AND (c.name ILIKE $${countParamCount} OR c.phone_number ILIKE $${countParamCount} OR c.email ILIKE $${countParamCount})`;
      countParams.push(`%${search}%`);
      countParamCount++;
    }

    if (optIn === 'true') {
      countQuery += ` AND c.opt_in = TRUE`;
    } else if (optIn === 'false') {
      countQuery += ` AND c.opt_in = FALSE`;
    }

    if (optOut === 'true') {
      countQuery += ` AND c.opt_out = TRUE`;
    } else if (optOut === 'false') {
      countQuery += ` AND c.opt_out = FALSE`;
    }

    if (whatsappValidated === 'true') {
      countQuery += ` AND c.whatsapp_validated = TRUE`;
    } else if (whatsappValidated === 'false') {
      countQuery += ` AND c.whatsapp_validated = FALSE`;
    }

    if (tags) {
      const tagIds = tags.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (tagIds.length > 0) {
        countQuery += ` AND EXISTS (
          SELECT 1 FROM contact_tag_relations ctr 
          WHERE ctr.contact_id = c.id 
          AND ctr.tag_id = ANY($${countParamCount}::int[])
        )`;
        countParams.push(tagIds);
        countParamCount++;
      }
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0]?.total || '0');

    const contacts = result.rows.map(row => ({
      id: row.id,
      phone_number: row.phone_number,
      name: row.name,
      email: row.email,
      whatsapp_validated: row.whatsapp_validated,
      whatsapp_validated_at: row.whatsapp_validated_at,
      opt_in: row.opt_in,
      opt_in_at: row.opt_in_at,
      opt_out: row.opt_out,
      opt_out_at: row.opt_out_at,
      opt_out_reason: row.opt_out_reason,
      source: row.source,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_message_sent_at: row.last_message_sent_at,
      last_message_received_at: row.last_message_received_at,
      total_messages_sent: row.total_messages_sent,
      total_messages_received: row.total_messages_received,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags
    }));

    res.json({
      contacts,
      total,
      limit,
      offset
    });
  } catch (error: any) {
    console.error('❌ Erro ao listar contatos:', error);
    res.status(500).json({ 
      error: 'Erro ao listar contatos',
      message: error.message 
    });
  }
});

/**
 * Criar contato
 * POST /api/contacts
 */
router.post('/', async (req: AuthRequest, res) => {
  try {
    const {
      phone_number,
      name,
      email,
      source = 'manual',
      metadata = {}
    } = req.body;

    if (!phone_number) {
      return res.status(400).json({ error: 'phone_number é obrigatório' });
    }

    // Normalizar número (remover caracteres não numéricos, exceto +)
    const normalizedPhone = phone_number.replace(/[^\d+]/g, '');

    const result = await pool.query(
      `INSERT INTO contacts (phone_number, name, email, source, metadata, opt_in_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (phone_number) 
       DO UPDATE SET
         name = COALESCE(EXCLUDED.name, contacts.name),
         email = COALESCE(EXCLUDED.email, contacts.email),
         source = COALESCE(EXCLUDED.source, contacts.source),
         metadata = contacts.metadata || EXCLUDED.metadata,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [normalizedPhone, name || null, email || null, source, JSON.stringify(metadata)]
    );

    const contact = result.rows[0];
    contact.metadata = typeof contact.metadata === 'string' ? JSON.parse(contact.metadata) : contact.metadata;

    // Buscar tags do contato
    const tagsResult = await pool.query(
      `SELECT t.id, t.name, t.color, t.category
       FROM contact_tags t
       JOIN contact_tag_relations ctr ON t.id = ctr.tag_id
       WHERE ctr.contact_id = $1`,
      [contact.id]
    );

    res.json({
      contact: {
        ...contact,
        tags: tagsResult.rows
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao criar contato:', error);
    res.status(500).json({ 
      error: 'Erro ao criar contato',
      message: error.message 
    });
  }
});

/**
 * Buscar contato por ID
 * GET /api/contacts/:id
 */
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM contacts WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contato não encontrado' });
    }

    const contact = result.rows[0];
    contact.metadata = typeof contact.metadata === 'string' ? JSON.parse(contact.metadata) : contact.metadata;

    // Buscar tags
    const tagsResult = await pool.query(
      `SELECT t.id, t.name, t.color, t.category
       FROM contact_tags t
       JOIN contact_tag_relations ctr ON t.id = ctr.tag_id
       WHERE ctr.contact_id = $1`,
      [contact.id]
    );

    res.json({
      contact: {
        ...contact,
        tags: tagsResult.rows
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar contato:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar contato',
      message: error.message 
    });
  }
});

/**
 * Atualizar contato
 * PUT /api/contacts/:id
 */
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      email,
      opt_in,
      opt_out,
      opt_out_reason,
      whatsapp_validated,
      metadata
    } = req.body;

    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount}`);
      params.push(name);
      paramCount++;
    }

    if (email !== undefined) {
      updates.push(`email = $${paramCount}`);
      params.push(email);
      paramCount++;
    }

    if (opt_in !== undefined) {
      updates.push(`opt_in = $${paramCount}`);
      updates.push(`opt_in_at = ${opt_in ? 'CURRENT_TIMESTAMP' : 'NULL'}`);
      params.push(opt_in);
      paramCount++;
    }

    if (opt_out !== undefined) {
      updates.push(`opt_out = $${paramCount}`);
      updates.push(`opt_out_at = ${opt_out ? 'CURRENT_TIMESTAMP' : 'NULL'}`);
      if (opt_out_reason) {
        updates.push(`opt_out_reason = $${paramCount + 1}`);
        params.push(opt_out, opt_out_reason);
        paramCount += 2;
      } else {
        params.push(opt_out);
        paramCount++;
      }
    }

    if (whatsapp_validated !== undefined) {
      updates.push(`whatsapp_validated = $${paramCount}`);
      updates.push(`whatsapp_validated_at = ${whatsapp_validated ? 'CURRENT_TIMESTAMP' : 'NULL'}`);
      params.push(whatsapp_validated);
      paramCount++;
    }

    if (metadata !== undefined) {
      updates.push(`metadata = $${paramCount}`);
      params.push(JSON.stringify(metadata));
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    const result = await pool.query(
      `UPDATE contacts 
       SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contato não encontrado' });
    }

    const contact = result.rows[0];
    contact.metadata = typeof contact.metadata === 'string' ? JSON.parse(contact.metadata) : contact.metadata;

    // Buscar tags
    const tagsResult = await pool.query(
      `SELECT t.id, t.name, t.color, t.category
       FROM contact_tags t
       JOIN contact_tag_relations ctr ON t.id = ctr.tag_id
       WHERE ctr.contact_id = $1`,
      [contact.id]
    );

    res.json({
      contact: {
        ...contact,
        tags: tagsResult.rows
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar contato:', error);
    res.status(500).json({ 
      error: 'Erro ao atualizar contato',
      message: error.message 
    });
  }
});

/**
 * Deletar contato
 * DELETE /api/contacts/:id
 */
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM contacts WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contato não encontrado' });
    }

    res.json({ success: true, message: 'Contato deletado com sucesso' });
  } catch (error: any) {
    console.error('❌ Erro ao deletar contato:', error);
    res.status(500).json({ 
      error: 'Erro ao deletar contato',
      message: error.message 
    });
  }
});

/**
 * Adicionar tag ao contato
 * POST /api/contacts/:id/tags
 */
router.post('/:id/tags', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { tag_id } = req.body;

    if (!tag_id) {
      return res.status(400).json({ error: 'tag_id é obrigatório' });
    }

    await pool.query(
      `INSERT INTO contact_tag_relations (contact_id, tag_id)
       VALUES ($1, $2)
       ON CONFLICT (contact_id, tag_id) DO NOTHING`,
      [id, tag_id]
    );

    // Buscar contato atualizado
    const contactResult = await pool.query(
      `SELECT * FROM contacts WHERE id = $1`,
      [id]
    );

    if (contactResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contato não encontrado' });
    }

    const contact = contactResult.rows[0];
    contact.metadata = typeof contact.metadata === 'string' ? JSON.parse(contact.metadata) : contact.metadata;

    // Buscar tags
    const tagsResult = await pool.query(
      `SELECT t.id, t.name, t.color, t.category
       FROM contact_tags t
       JOIN contact_tag_relations ctr ON t.id = ctr.tag_id
       WHERE ctr.contact_id = $1`,
      [contact.id]
    );

    res.json({
      contact: {
        ...contact,
        tags: tagsResult.rows
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao adicionar tag:', error);
    res.status(500).json({ 
      error: 'Erro ao adicionar tag',
      message: error.message 
    });
  }
});

/**
 * Remover tag do contato
 * DELETE /api/contacts/:id/tags/:tagId
 */
router.delete('/:id/tags/:tagId', async (req: AuthRequest, res) => {
  try {
    const { id, tagId } = req.params;

    await pool.query(
      `DELETE FROM contact_tag_relations 
       WHERE contact_id = $1 AND tag_id = $2`,
      [id, tagId]
    );

    // Buscar contato atualizado
    const contactResult = await pool.query(
      `SELECT * FROM contacts WHERE id = $1`,
      [id]
    );

    if (contactResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contato não encontrado' });
    }

    const contact = contactResult.rows[0];
    contact.metadata = typeof contact.metadata === 'string' ? JSON.parse(contact.metadata) : contact.metadata;

    // Buscar tags
    const tagsResult = await pool.query(
      `SELECT t.id, t.name, t.color, t.category
       FROM contact_tags t
       JOIN contact_tag_relations ctr ON t.id = ctr.tag_id
       WHERE ctr.contact_id = $1`,
      [contact.id]
    );

    res.json({
      contact: {
        ...contact,
        tags: tagsResult.rows
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao remover tag:', error);
    res.status(500).json({ 
      error: 'Erro ao remover tag',
      message: error.message 
    });
  }
});

/**
 * Importar contatos (CSV/JSON)
 * POST /api/contacts/import
 */
router.post('/import', async (req: AuthRequest, res) => {
  try {
    const { contacts, source = 'import', tags: importTags = [] } = req.body;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'contacts deve ser um array não vazio' });
    }

    const results = {
      created: 0,
      updated: 0,
      errors: [] as any[],
      tagsApplied: 0
    };

    // Buscar tags por nome se fornecido
    const tagMap = new Map<number, string>();
    if (Array.isArray(importTags) && importTags.length > 0) {
      const tagNames = importTags.map((t: string) => t.trim().toLowerCase());
      const tagsResult = await pool.query(
        `SELECT id, LOWER(name) as name FROM contact_tags WHERE LOWER(name) = ANY($1)`,
        [tagNames]
      );
      tagsResult.rows.forEach((tag: any) => {
        tagMap.set(tag.id, tag.name);
      });
    }

    for (const contactData of contacts) {
      try {
        // Sanitização inteligente: aceita vários formatos de campo
        let phone_number = contactData.phone_number || 
                          contactData.phone || 
                          contactData.telefone || 
                          contactData.celular ||
                          contactData.whatsapp ||
                          contactData.numero ||
                          '';
        
        let name = contactData.name || 
                  contactData.nome || 
                  contactData.full_name ||
                  contactData.nome_completo ||
                  '';
        
        let email = contactData.email || 
                   contactData.e_mail ||
                   contactData.email_address ||
                   '';

        // Processar tags do contato (coluna "tags" ou "tag" no CSV)
        let contactTags: string[] = [];
        if (contactData.tags) {
          contactTags = String(contactData.tags).split(',').map((t: string) => t.trim()).filter(Boolean);
        } else if (contactData.tag) {
          contactTags = [String(contactData.tag).trim()].filter(Boolean);
        }

        // Coletar campos extras para metadata
        const metadata: any = {};
        const knownFields = ['phone_number', 'phone', 'telefone', 'celular', 'whatsapp', 'numero',
                            'name', 'nome', 'full_name', 'nome_completo',
                            'email', 'e_mail', 'email_address', 'tags', 'tag'];
        
        for (const [key, value] of Object.entries(contactData)) {
          const normalizedKey = key.toLowerCase().trim();
          if (!knownFields.some(f => normalizedKey.includes(f.toLowerCase())) && value) {
            metadata[normalizedKey] = value;
          }
        }

        if (!phone_number) {
          results.errors.push({ contact: contactData, error: 'phone_number é obrigatório' });
          continue;
        }

        // Normalizar número (remover caracteres não numéricos, exceto +)
        const normalizedPhone = phone_number.replace(/[^\d+]/g, '');
        
        // Validar formato básico de telefone
        if (normalizedPhone.length < 10) {
          results.errors.push({ contact: contactData, error: 'Número de telefone inválido (muito curto)' });
          continue;
        }

        // Sanitizar nome e email
        name = name.trim() || null;
        email = email.trim() || null;
        
        // Validar email se fornecido
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          email = null; // Email inválido, mas não bloqueia o import
        }

        const result = await pool.query(
          `INSERT INTO contacts (phone_number, name, email, source, metadata, opt_in_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
           ON CONFLICT (phone_number) 
           DO UPDATE SET
             name = COALESCE(EXCLUDED.name, contacts.name),
             email = COALESCE(EXCLUDED.email, contacts.email),
             metadata = contacts.metadata || EXCLUDED.metadata,
             updated_at = CURRENT_TIMESTAMP
           RETURNING id, (xmax = 0) as inserted`,
          [normalizedPhone, name, email, source, JSON.stringify(metadata)]
        );

        const contactId = result.rows[0].id;
        const isNew = result.rows[0].inserted;

        if (isNew) {
          results.created++;
        } else {
          results.updated++;
        }

        // Aplicar tags do contato
        const allTags = [...contactTags, ...importTags];
        if (allTags.length > 0) {
          // Buscar IDs das tags por nome
          const tagNames = allTags.map(t => t.trim().toLowerCase());
          const tagsResult = await pool.query(
            `SELECT id FROM contact_tags WHERE LOWER(name) = ANY($1)`,
            [tagNames]
          );

          // Associar tags ao contato
          for (const tag of tagsResult.rows) {
            try {
              await pool.query(
                `INSERT INTO contact_tag_relations (contact_id, tag_id)
                 VALUES ($1, $2)
                 ON CONFLICT (contact_id, tag_id) DO NOTHING`,
                [contactId, tag.id]
              );
              results.tagsApplied++;
            } catch (error) {
              // Ignorar erros de tag
            }
          }
        }
      } catch (error: any) {
        results.errors.push({ contact: contactData, error: error.message });
      }
    }

    res.json({
      success: true,
      results
    });
  } catch (error: any) {
    console.error('❌ Erro ao importar contatos:', error);
    res.status(500).json({ 
      error: 'Erro ao importar contatos',
      message: error.message 
    });
  }
});

export default router;
