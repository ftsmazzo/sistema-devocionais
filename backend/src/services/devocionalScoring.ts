import { pool } from '../database';

/**
 * Atualizar pontuação do devocional para um contato
 * Quando uma mensagem de devocional é enviada, recebida, lida ou há interação
 */
export async function updateDevocionalScore(
  contactId: number,
  action: 'sent' | 'delivered' | 'read' | 'interaction' | 'failed'
) {
  try {
    // Buscar dados atuais do contato
    const contactResult = await pool.query(
      `SELECT 
        devocional_score,
        consecutive_devocional_failures,
        last_devocional_sent_at,
        last_devocional_read_at,
        last_devocional_interaction_at
       FROM contacts
       WHERE id = $1`,
      [contactId]
    );

    if (contactResult.rows.length === 0) {
      console.error(`❌ Contato ${contactId} não encontrado para atualizar pontuação`);
      return;
    }

    const contact = contactResult.rows[0];
    let newScore = contact.devocional_score || 0;
    let consecutiveFailures = contact.consecutive_devocional_failures || 0;
    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    switch (action) {
      case 'sent':
        // Mensagem enviada - atualizar timestamp
        updates.push(`last_devocional_sent_at = CURRENT_TIMESTAMP`);
        break;

      case 'delivered':
        // Mensagem entregue - resetar falhas consecutivas
        if (consecutiveFailures > 0) {
          consecutiveFailures = 0;
          updates.push(`consecutive_devocional_failures = 0`);
        }
        break;

      case 'read':
        // Mensagem lida - aumentar pontuação e resetar falhas
        newScore = Math.max(0, newScore + 1);
        consecutiveFailures = 0;
        updates.push(`last_devocional_read_at = CURRENT_TIMESTAMP`);
        updates.push(`devocional_score = $${paramCount}`);
        params.push(newScore);
        paramCount++;
        updates.push(`consecutive_devocional_failures = 0`);
        break;

      case 'interaction':
        // Interação (resposta) - aumentar pontuação significativamente
        newScore = Math.max(0, newScore + 3);
        consecutiveFailures = 0;
        updates.push(`last_devocional_interaction_at = CURRENT_TIMESTAMP`);
        updates.push(`devocional_score = $${paramCount}`);
        params.push(newScore);
        paramCount++;
        updates.push(`consecutive_devocional_failures = 0`);
        break;

      case 'failed':
        // Falha no envio - incrementar falhas consecutivas
        consecutiveFailures = (consecutiveFailures || 0) + 1;
        updates.push(`consecutive_devocional_failures = $${paramCount}`);
        params.push(consecutiveFailures);
        paramCount++;

        // Se atingiu 3 falhas consecutivas, adicionar tag "bloqueado"
        if (consecutiveFailures >= 3) {
          // Verificar se já tem a tag "bloqueado"
          const tagResult = await pool.query(
            `SELECT id FROM contact_tags WHERE name = 'bloqueado' LIMIT 1`
          );

          if (tagResult.rows.length > 0) {
            const bloqueadoTagId = tagResult.rows[0].id;

            // Verificar se o contato já tem a tag
            const relationResult = await pool.query(
              `SELECT 1 FROM contact_tag_relations 
               WHERE contact_id = $1 AND tag_id = $2`,
              [contactId, bloqueadoTagId]
            );

            if (relationResult.rows.length === 0) {
              // Adicionar tag "bloqueado"
              await pool.query(
                `INSERT INTO contact_tag_relations (contact_id, tag_id)
                 VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [contactId, bloqueadoTagId]
              );
              console.log(`🏷️ Tag "bloqueado" adicionada ao contato ${contactId} (3 falhas consecutivas)`);
            }
          }
        }
        break;
    }

    if (updates.length > 0) {
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      params.push(contactId);

      await pool.query(
        `UPDATE contacts
         SET ${updates.join(', ')}
         WHERE id = $${paramCount}`,
        params
      );
    }

    console.log(`✅ Pontuação atualizada para contato ${contactId}: ${action} (score: ${newScore}, falhas: ${consecutiveFailures})`);
  } catch (error: any) {
    console.error(`❌ Erro ao atualizar pontuação do devocional para contato ${contactId}:`, error);
  }
}

/**
 * Verificar se contato deve receber devocional
 * Retorna false se tiver 3+ falhas consecutivas ou tag "bloqueado"
 */
export async function canReceiveDevocional(contactId: number): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT 
        c.consecutive_devocional_failures,
        c.opt_in,
        c.opt_out,
        c.whatsapp_validated,
        COUNT(ctr.tag_id) FILTER (WHERE t.name = 'bloqueado') as has_bloqueado_tag
       FROM contacts c
       LEFT JOIN contact_tag_relations ctr ON c.id = ctr.contact_id
       LEFT JOIN contact_tags t ON ctr.tag_id = t.id AND t.name = 'bloqueado'
       WHERE c.id = $1
       GROUP BY c.id, c.consecutive_devocional_failures, c.opt_in, c.opt_out, c.whatsapp_validated`,
      [contactId]
    );

    if (result.rows.length === 0) {
      return false;
    }

    const contact = result.rows[0];

    // Não pode receber se:
    // 1. Tem 3+ falhas consecutivas
    // 2. Tem tag "bloqueado"
    // 3. Não está opt-in
    // 4. Está opt-out
    // 5. WhatsApp não validado
    if (
      (contact.consecutive_devocional_failures || 0) >= 3 ||
      (contact.has_bloqueado_tag || 0) > 0 ||
      !contact.opt_in ||
      contact.opt_out ||
      !contact.whatsapp_validated
    ) {
      return false;
    }

    return true;
  } catch (error: any) {
    console.error(`❌ Erro ao verificar se contato pode receber devocional:`, error);
    return false;
  }
}
