/**
 * Teste seco: resolução de lista dinâmica sem exigir whatsapp_validated na query.
 * Não chama /message/sendText/ nem envia mensagem.
 *
 * Uso (DATABASE_URL):
 *   npx tsx scripts/test-list-audience-resolver.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { pool, initializeDatabase } from '../src/database';
import { resolveListAudience } from '../src/services/listAudienceResolver';

async function main() {
  await initializeDatabase();

  const listR = await pool.query(
    `INSERT INTO contact_lists (name, description, list_type, filter_config, total_contacts)
     VALUES ($1, $2, 'dynamic', $3::jsonb, 0)
     RETURNING id`,
    [
      '[test] audience resolver',
      'dry-run',
      JSON.stringify({ tags: [] }),
    ]
  );
  const listId = listR.rows[0].id as number;

  const phones = {
    needs: '5500000000301',
    eligible: '5500000000302',
    optOut: '5500000000303',
  };

  const cNeeds = await pool.query(
    `INSERT INTO contacts (phone_number, name, opt_in, opt_out, whatsapp_validated, source)
     VALUES ($1, 'Needs WA', true, false, false, 'test')
     RETURNING id`,
    [phones.needs]
  );
  const cOk = await pool.query(
    `INSERT INTO contacts (phone_number, name, opt_in, opt_out, whatsapp_validated, whatsapp_validated_at, source)
     VALUES ($1, 'Eligible', true, false, true, CURRENT_TIMESTAMP, 'test')
     RETURNING id`,
    [phones.eligible]
  );
  const cOut = await pool.query(
    `INSERT INTO contacts (phone_number, name, opt_in, opt_out, whatsapp_validated, source)
     VALUES ($1, 'OptOut', true, true, true, 'test')
     RETURNING id`,
    [phones.optOut]
  );

  // Dynamic list with empty tags matches ALL contacts matching WHERE TRUE — too broad for shared DB.
  // Use exclude nothing + filter by putting contacts only via a tag unique to this test.
  const tagR = await pool.query(
    `INSERT INTO contact_tags (name, color, category)
     VALUES ($1, '#999', 'test')
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [`test_audience_${listId}`]
  );
  const tagId = tagR.rows[0].id;

  for (const id of [cNeeds.rows[0].id, cOk.rows[0].id, cOut.rows[0].id]) {
    await pool.query(
      `INSERT INTO contact_tag_relations (contact_id, tag_id) VALUES ($1, $2)
       ON CONFLICT (contact_id, tag_id) DO NOTHING`,
      [id, tagId]
    );
  }

  await pool.query(
    `UPDATE contact_lists SET filter_config = $1::jsonb WHERE id = $2`,
    [JSON.stringify({ tags: [tagId] }), listId]
  );

  try {
    const audience = await resolveListAudience(listId);

    if (audience.counts.total_potential < 3) {
      throw new Error(`FALHA total_potential=${audience.counts.total_potential}`);
    }

    const needsIds = audience.needs_whatsapp_validation.map((c) => c.id);
    if (!needsIds.includes(cNeeds.rows[0].id)) {
      throw new Error('FALHA: contato whatsapp_validated=false deveria estar em needs_whatsapp_validation');
    }

    const eligibleIds = audience.eligible_now.map((c) => c.id);
    if (!eligibleIds.includes(cOk.rows[0].id)) {
      throw new Error('FALHA: contato validado deveria estar em eligible_now');
    }

    const optOutIds = audience.excluded_opt_out.map((c) => c.id);
    if (!optOutIds.includes(cOut.rows[0].id)) {
      throw new Error('FALHA: opt_out deveria estar em excluded_opt_out');
    }

    // Não deve desaparecer o pending como se a lista estivesse vazia
    if (audience.counts.needs_whatsapp_validation < 1) {
      throw new Error('FALHA: needs_whatsapp_validation zerado');
    }

    console.log('OK counts', audience.counts);
    console.log('SUCESSO: listAudienceResolver categoriza potenciais sem sumir com não validados.');
  } finally {
    await pool.query(`DELETE FROM contact_tag_relations WHERE tag_id = $1`, [tagId]);
    await pool.query(`DELETE FROM contact_tags WHERE id = $1`, [tagId]);
    await pool.query(`DELETE FROM contacts WHERE id = ANY($1::int[])`, [
      [cNeeds.rows[0].id, cOk.rows[0].id, cOut.rows[0].id],
    ]);
    await pool.query(`DELETE FROM contact_lists WHERE id = $1`, [listId]);
    await pool.end();
  }
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
