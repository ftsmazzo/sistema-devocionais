/**
 * Teste seco: mensagem personalizada — SQL params + persistência (se DATABASE_URL).
 *
 *   npm run test:personalizada-dispatch
 */
import dotenv from 'dotenv';
dotenv.config();

import {
  buildPersonalizadaDispatchParams,
  createAndEnqueuePersonalizadaDispatch,
  sqlInsertDispatchContactIfAbsent,
  sqlInsertPersonalizadaDispatch,
} from '../src/services/personalizadaDispatch';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function testSqlParamBuilders() {
  const insertSql = sqlInsertPersonalizadaDispatch();
  assert(insertSql.includes('$2::text'), 'message_template deve ter cast ::text');
  assert(insertSql.includes('$5::int[]'), 'contact_ids ::int[]');
  assert(insertSql.includes('$6::int[]'), 'instance_ids ::int[]');
  assert(insertSql.includes('$9::jsonb'), 'blindage ::jsonb');
  assert(insertSql.includes('$10::jsonb'), 'metadata ::jsonb');
  // Não reutilizar $2 em outro tipo
  const dollarTwos = insertSql.match(/\$2/g) || [];
  assert(dollarTwos.length === 1, `$2 aparece ${dollarTwos.length}x no INSERT dispatches`);

  const contactSql = sqlInsertDispatchContactIfAbsent();
  assert(contactSql.includes('$2::varchar(50)'), 'phone cast varchar');
  assert(contactSql.includes('$5::varchar(50)'), 'WHERE phone usa $5 separado (evita 42P08)');
  assert(!/\$2(?!::)/.test(contactSql.replace(/\$2::varchar\(50\)/g, '')), 'não reusa $2 sem cast inconsistente');
  // $2 só no SELECT, $5 no WHERE — tipos alinhados via cast explícito
  assert(contactSql.includes('WHERE dispatch_id = $4::int AND contact_number = $5::varchar(50)'), 'placeholders separados');

  const params = buildPersonalizadaDispatchParams({
    name: 'Teste',
    message_template: 'Olá {{name}}',
    dispatchType: 'personalizada',
    list_id: 10,
    contact_ids: null,
    instance_ids: [],
    total_contacts: 3,
    created_by: 1,
    metadata: { pipeline: 'dispatch_items' },
  });
  assert(params.length === 10, `esperava 10 params, veio ${params.length}`);
  assert(params[0] === 'Teste', 'name');
  assert(params[1] === 'Olá {{name}}', 'template');
  assert(params[3] === 10, 'list_id');
  assert(params[4] === null, 'contact_ids null');
  assert(Array.isArray(params[5]) && (params[5] as number[]).length === 0, 'instance_ids []');
  assert(params[6] === 3, 'total');
  assert(typeof params[8] === 'string' && (params[8] as string).startsWith('{'), 'blindage json string');
  assert(typeof params[9] === 'string' && (params[9] as string).includes('pipeline'), 'metadata json');

  console.log('OK builders SQL/params (sem 42P08 / casts explícitos)');
}

async function main() {
  testSqlParamBuilders();

  try {
    await createAndEnqueuePersonalizadaDispatch({
      name: '',
      message_template: 'x',
      list_id: 1,
    });
    throw new Error('deveria falhar sem nome');
  } catch (e: any) {
    assert(
      e?.message?.includes('obrigatórios') || e?.name === 'PersonalizadaDispatchError',
      'validação name'
    );
  }
  console.log('OK validação campos obrigatórios');

  if (!process.env.DATABASE_URL) {
    console.log('⚠️ DATABASE_URL ausente — pulando teste de persistência');
    console.log('✅ test:personalizada-dispatch (builders) OK');
    return;
  }

  const { pool, initializeDatabase } = await import('../src/database');
  const { refreshWorkerDispatchConfigCache, applyWorkerDispatchProfile } = await import(
    '../src/services/workerDispatchConfig'
  );

  await initializeDatabase();
  await refreshWorkerDispatchConfigCache();
  await applyWorkerDispatchProfile('simulacao');

  const suffix = Date.now();
  const mkPhone = (n: number) => `5511977${String(suffix).slice(-6)}${n}`.slice(0, 13);

  const list = await pool.query(
    `INSERT INTO contact_lists (name, description, list_type, filter_config, total_contacts)
     VALUES ($1, 'test personalizada fix', 'static', '{}'::jsonb, 0)
     RETURNING id`,
    [`[test] personalizada fix ${suffix}`]
  );
  const listId = list.rows[0].id as number;
  const contactIds: number[] = [];

  for (let i = 1; i <= 3; i++) {
    const c = await pool.query(
      `INSERT INTO contacts (phone_number, name, opt_in, opt_out, whatsapp_validated, whatsapp_validated_at, source)
       VALUES ($1, $2, true, false, true, CURRENT_TIMESTAMP, 'test')
       RETURNING id`,
      [mkPhone(i), `Eligible ${i}`]
    );
    contactIds.push(c.rows[0].id);
    await pool.query(
      `INSERT INTO contact_list_items (list_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [listId, c.rows[0].id]
    );
  }
  await pool.query(`UPDATE contact_lists SET total_contacts = 3 WHERE id = $1`, [listId]);

  let instanceId: number | null = null;
  const inst = await pool.query(`SELECT id FROM instances WHERE status = 'connected' ORDER BY id ASC LIMIT 1`);
  if (inst.rows[0]) instanceId = inst.rows[0].id;

  try {
    const result = await createAndEnqueuePersonalizadaDispatch({
      name: `[test] fix personalizada ${suffix}`,
      message_template: 'Olá {{name}}, teste seco.',
      list_id: listId,
      instance_ids: instanceId ? [instanceId] : [],
    });

    assert(!!result.dispatch?.id, 'dispatch persistido');
    assert(result.items_enqueued === 3, `items=${result.items_enqueued}`);
    const items = await pool.query(`SELECT COUNT(*)::int AS c FROM dispatch_items WHERE dispatch_id = $1`, [
      result.dispatch.id,
    ]);
    assert(items.rows[0].c === 3, `dispatch_items=${items.rows[0].c}`);

    await pool.query(`DELETE FROM dispatch_contacts WHERE dispatch_id = $1`, [result.dispatch.id]);
    await pool.query(`DELETE FROM dispatch_items WHERE dispatch_id = $1`, [result.dispatch.id]);
    await pool.query(`DELETE FROM dispatches WHERE id = $1`, [result.dispatch.id]);
    console.log('✅ test:personalizada-dispatch OK (persistência)');
  } catch (e: any) {
    if (String(e.message || '').includes('offline') || String(e.message || '').includes('instância')) {
      console.log('ℹ️ Sem instância online — builders OK; persistência completa requer instância conectada');
      console.log('✅ test:personalizada-dispatch OK (parcial)');
    } else {
      throw e;
    }
  } finally {
    await pool.query(`DELETE FROM contact_list_items WHERE list_id = $1`, [listId]);
    if (contactIds.length) await pool.query(`DELETE FROM contacts WHERE id = ANY($1::int[])`, [contactIds]);
    await pool.query(`DELETE FROM contact_lists WHERE id = $1`, [listId]);
    await pool.end();
  }
}

main().catch(async (e) => {
  console.error('❌', e);
  process.exit(1);
});
