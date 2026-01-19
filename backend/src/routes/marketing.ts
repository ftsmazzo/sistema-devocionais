import express from 'express';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

/**
 * Configuração do Marketing
 * GET /api/marketing/config
 */
router.get('/config', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM marketing_ai_config ORDER BY id DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      // Criar configuração padrão
      const defaultConfig = await pool.query(
        `INSERT INTO marketing_ai_config (
          positive_keywords, sentiment_analysis_enabled, enabled
        ) VALUES ($1, $2, $3)
        RETURNING *`,
        [
          ['interesse', 'quero', 'me chama', 'gostei', 'tenho interesse', 
           'quero saber mais', 'me passa', 'informação', 'detalhes', 
           'contato', 'ligar', 'ligue'],
          true,
          true
        ]
      );
      return res.json({ config: defaultConfig.rows[0] });
    }

    res.json({ config: result.rows[0] });
  } catch (error: any) {
    console.error('❌ Erro ao buscar configuração do marketing:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar configuração',
      message: error.message 
    });
  }
});

/**
 * Atualizar configuração do Marketing
 * PUT /api/marketing/config
 */
router.put('/config', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { ai_webhook_url, positive_keywords, sentiment_analysis_enabled, enabled } = req.body;

    // Buscar configuração existente
    const existing = await pool.query(
      `SELECT id FROM marketing_ai_config ORDER BY id DESC LIMIT 1`
    );

    let result;
    if (existing.rows.length === 0) {
      // Criar nova configuração
      result = await pool.query(
        `INSERT INTO marketing_ai_config (
          ai_webhook_url, positive_keywords, sentiment_analysis_enabled, enabled
        ) VALUES ($1, $2, $3, $4)
        RETURNING *`,
        [
          ai_webhook_url || null,
          positive_keywords || ['interesse', 'quero', 'me chama', 'gostei'],
          sentiment_analysis_enabled !== false,
          enabled !== false
        ]
      );
    } else {
      // Atualizar configuração existente
      result = await pool.query(
        `UPDATE marketing_ai_config 
         SET ai_webhook_url = COALESCE($1, ai_webhook_url),
             positive_keywords = COALESCE($2, positive_keywords),
             sentiment_analysis_enabled = COALESCE($3, sentiment_analysis_enabled),
             enabled = COALESCE($4, enabled),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
        [ai_webhook_url, positive_keywords, sentiment_analysis_enabled, enabled, existing.rows[0].id]
      );
    }

    res.json({ 
      success: true,
      config: result.rows[0],
      message: 'Configuração salva com sucesso'
    });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar configuração do marketing:', error);
    res.status(500).json({ 
      error: 'Erro ao atualizar configuração',
      message: error.message 
    });
  }
});

export default router;
