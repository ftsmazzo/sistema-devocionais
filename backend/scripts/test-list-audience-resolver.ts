/**
 * Teste seco: resolução de lista dinâmica/híbrida sem exigir whatsapp_validated na query.
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

  const suffix = Date.now();
  const mkPhone = (n: number) => `5511999${String(suffix).slice(-6)}${n}`.slice(0, 13);

  const pNeeds = mkPhone(1);
  const pEligible = mkPhone(2);
  const pOptOut = mkPhone(3);
  const pInvalid = mkPhone(4);
  const pHybrid = mkPhone(5);
  const pNoOptIn = mkPhone(6);

  const listDyn = await pool.query(
    `INSERT INTO contact_lists (name, description, list_type, filter_config, total_contacts)
     VALUES ($1, $2, 'dynamic', $3::jsonb, 0)
     RETURNING id`,
    [`[test] audience dyn ${suffix}`, 'dry-run', JSON.stringify({ tags: [] })]
  );
  const listDynId = listDyn.rows[0].id as number;

  const listHybrid = await pool.query(
    `INSERT INTO contact_lists (name, description, list_type, filter_config, total_contacts)
     VALUES ($1, $2, 'hybrid', $3::jsonb, 0)
     RETURNING id`,
    [`[test] audience hybrid ${suffix}`, 'dry-run', JSON.stringify({ tags: [] })]
  );
  const listHybridId = listHybrid.rows[0].id as number;

  const cNeeds = await pool.query(
    `INSERT INTO contacts (phone_number, name, opt_in, opt_out, whatsapp_validated, source)
     VALUES ($1, 'Needs WA', true, false, false, 'test')
     RETURNING id`,
    [pNeeds]
  );
  const cOk = await pool.query(
    `INSERT INTO contacts (phone_number, name, opt_in, opt_out, whatsapp_validated, whatsapp_validated_at, source)
     VALUES ($1, 'Eligible', true, false, true, CURRENT_TIMESTAMP, 'test')
     RETURNING id`,
    [pEligible]
  );
  const cOut = await pool.query(
    `INSERT INTO contacts (phone_number, name, opt_in, opt_out, whatsapp_validated, source)
     VALUES ($1, 'OptOut', true, true, true, 'test')
     RETURNING id`,
    [pOptOut]
  );
  const cInvalid = await pool.query(
    `INSERT INTO contacts (phone_number, name, opt_in, opt_out, whatsapp_validated, whatsapp_validated_at, source)
     VALUES ($1, 'InvalidWA', true, false, false, CURRENT_TIMESTAMP, 'test')
     RETURNING id`,
    [pInvalid]
  );
  const cHybrid = await pool.query(
    `INSERT INTO contacts (phone_number, name, opt_in, opt_out, whatsapp_validated, whatsapp_validated_at, source)
     VALUES ($1, 'HybridDup', true, false, true, CURRENT_TIMESTAMP, 'test')
     RETURNING id`,
    [pHybrid]
  );
  const cNoOptIn = await pool.query(
    `INSERT INTO contacts (phone_number, name, opt_in, opt_out, whatsapp_validated, source)
     VALUES ($1, 'NoOptIn', false, false, true, 'test')
     RETURNING id`,
    [pNoOptIn]
  );

  const tagR = await pool.query(
    `INSERT INTO contact_tags (name, color, category)
     VALUES ($1, '#999', 'test')
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [`test_audience_${listDynId}`]
  );
  const tagId = tagR.rows[0].id;

  const allIds = [
    cNeeds.rows[0].id,
    cOk.rows[0].id,
    cOut.rows[0].id,
    cInvalid.rows[0].id,
    cHybrid.rows[0].id,
    cNoOptIn.rows[0].id,
  ];

  for (const id of allIds) {
    await pool.query(
      `INSERT INTO contact_tag_relations (contact_id, tag_id) VALUES ($1, $2)
       ON CONFLICT (contact_id, tag_id) DO NOTHING`,
      [id, tagId]
    );
  }

  await pool.query(`UPDATE contact_lists SET filter_config = $1::jsonb WHERE id = $2`, [
    JSON.stringify({ tags: [tagId] }),
    listDynId,
  ]);

  // Híbrida: mesmo filtro dinâmico + contato estático duplicado (já está na tag)
  await pool.query(`UPDATE contact_lists SET filter_config = $1::jsonb WHERE id = $2`, [
    JSON.stringify({ tags: [tagId] }),
    listHybridId,
  ]);
  await pool.query(
    `INSERT INTO contact_list_items (list_id, contact_id) VALUES ($1, $2)
     ON CONFLICT (list_id, contact_id) DO NOTHING`,
    [listHybridId, cHybrid.rows[0].id]
  );

  try {
    const audience = await resolveListAudience(listDynId);

    if (audience.counts.total_potential < 6) {
      throw new Error(`FALHA total_potential=${audience.counts.total_potential}`);
    }

    const needsIds = audience.needs_whatsapp_validation.map((c) => c.id);
    if (!needsIds.includes(cNeeds.rows[0].id)) {
      throw new Error('FALHA: whatsapp_validated=false sem at deveria estar em needs_whatsapp_validation');
    }

    const eligibleIds = audience.eligible_now.map((c) => c.id);
    if (!eligibleIds.includes(cOk.rows[0].id)) {
      throw new Error('FALHA: contato validado deveria estar em eligible_now');
    }

    const optOutIds = audience.excluded_opt_out.map((c) => c.id);
    if (!optOutIds.includes(cOut.rows[0].id)) {
      throw new Error('FALHA: opt_out deveria estar em excluded_opt_out');
    }

    const invalidIds = audience.excluded_whatsapp_invalid.map((c) => c.id);
    if (!invalidIds.includes(cInvalid.rows[0].id)) {
      throw new Error('FALHA: false+validated_at deveria estar em excluded_whatsapp_invalid');
    }

    const noOptInIds = audience.excluded_no_opt_in.map((c) => c.id);
    if (!noOptInIds.includes(cNoOptIn.rows[0].id)) {
      throw new Error('FALHA: sem opt-in deveria estar em excluded_no_opt_in');
    }

    if (audience.counts.needs_whatsapp_validation < 1) {
      throw new Error('FALHA: needs_whatsapp_validation zerado');
    }

    if (!audience.items.some((i) => i.reason === 'needs_whatsapp_validation')) {
      throw new Error('FALHA: items sem motivo needs_whatsapp_validation');
    }

    const hybrid = await resolveListAudience(listHybridId);
    const hybridIds = [
      ...hybrid.eligible_now,
      ...hybrid.needs_whatsapp_validation,
      ...hybrid.excluded_opt_out,
      ...hybrid.excluded_no_opt_in,
      ...hybrid.excluded_invalid_phone,
      ...hybrid.excluded_whatsapp_invalid,
      ...hybrid.excluded_by_score,
    ].map((c) => c.id);
    const unique = new Set(hybridIds);
    if (unique.size !== hybridIds.length) {
      throw new Error('FALHA: lista híbrida com duplicidade de contatos');
    }
    if (!unique.has(cHybrid.rows[0].id)) {
      throw new Error('FALHA: contato híbrido sumiu');
    }

    console.log('OK dynamic counts', audience.counts);
    console.log('OK hybrid counts', hybrid.counts, 'unique=', unique.size);
    console.log('SUCESSO: listAudienceResolver categoriza potenciais sem sumir com não validados.');
  } finally {
    await pool.query(`DELETE FROM contact_list_items WHERE list_id = ANY($1::int[])`, [
      [listDynId, listHybridId],
    ]);
    await pool.query(`DELETE FROM contact_tag_relations WHERE tag_id = $1`, [tagId]);
    await pool.query(`DELETE FROM contact_tags WHERE id = $1`, [tagId]);
    await pool.query(`DELETE FROM contacts WHERE id = ANY($1::int[])`, [allIds]);
    await pool.query(`DELETE FROM contact_lists WHERE id = ANY($1::int[])`, [
      [listDynId, listHybridId],
    ]);
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
