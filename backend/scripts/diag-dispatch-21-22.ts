/**
 * Diagnóstico #21 vs #22 + connectionState instâncias 1 e 2.
 * Somente leitura (DB + GET connectionState). Não envia mensagem.
 *
 *   npx tsx scripts/diag-dispatch-21-22.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { pool, initializeDatabase } from '../src/database';

async function connectionState(inst: {
  id: number;
  instance_name: string;
  api_url: string;
  api_key: string;
  status: string;
  phone_number: string | null;
}) {
  const base = process.env.EVOLUTION_API_URL || inst.api_url;
  const key = process.env.EVOLUTION_API_KEY || inst.api_key;
  const url = `${base}/instance/connectionState/${inst.instance_name}`;
  try {
    const r = await axios.get(url, {
      headers: { apikey: key },
      timeout: 15_000,
      validateStatus: () => true,
    });
    const state =
      r.data?.instance?.state || r.data?.state || r.data?.status || null;
    return {
      http: r.status,
      state,
      db_status: inst.status,
      phone: inst.phone_number,
      url_host: (() => {
        try {
          return new URL(base).host;
        } catch {
          return base;
        }
      })(),
      body_preview: JSON.stringify(r.data).slice(0, 280),
    };
  } catch (e: any) {
    return {
      http: null,
      state: null,
      db_status: inst.status,
      phone: inst.phone_number,
      error: e?.message || String(e),
    };
  }
}

function classifyMessageId(id: string | null | undefined): string {
  if (!id) return 'MISSING';
  if (String(id).startsWith('evo-')) return 'FAKE_EVO_TIMESTAMP';
  if (String(id).startsWith('temp-')) return 'FAKE_TEMP';
  return 'REAL_OR_PROVIDER';
}

async function dumpDispatch(dispatchId: number) {
  const d = await pool.query(
    `SELECT id, name, status, instance_ids, started_at, completed_at
     FROM dispatches WHERE id = $1`,
    [dispatchId]
  );
  if (!d.rows[0]) {
    console.log(`\n=== Dispatch #${dispatchId}: NÃO ENCONTRADO ===`);
    return;
  }
  console.log(`\n=== Dispatch #${dispatchId} ===`);
  console.log(JSON.stringify(d.rows[0], null, 2));

  const items = await pool.query(
    `SELECT id, contact_name, contact_number, instance_id, status,
            provider_message_id, attempt_count, sent_at, error_message
     FROM dispatch_items
     WHERE dispatch_id = $1
     ORDER BY id`,
    [dispatchId]
  );
  console.log('\n-- dispatch_items --');
  for (const row of items.rows) {
    const phone = String(row.contact_number || '');
    const masked =
      phone.length >= 6
        ? `${phone.slice(0, 4)}****${phone.slice(-2)}`
        : '***';
    console.log(
      JSON.stringify({
        item_id: row.id,
        name: row.contact_name,
        phone_masked: masked,
        instance_id: row.instance_id,
        status: row.status,
        provider_message_id: row.provider_message_id,
        id_class: classifyMessageId(row.provider_message_id),
        attempt_count: row.attempt_count,
        sent_at: row.sent_at,
        error_message: row.error_message,
      })
    );
  }

  const msgs = await pool.query(
    `SELECT id, instance_id, message_id, status, contact_id, remote_jid, timestamp
     FROM messages
     WHERE dispatch_id = $1
     ORDER BY id`,
    [dispatchId]
  );
  console.log('\n-- messages --');
  for (const row of msgs.rows) {
    console.log(
      JSON.stringify({
        message_row_id: row.id,
        instance_id: row.instance_id,
        message_id: row.message_id,
        id_class: classifyMessageId(row.message_id),
        status: row.status,
        contact_id: row.contact_id,
        remote_jid: row.remote_jid,
        timestamp: row.timestamp,
      })
    );
  }

  const events = await pool.query(
    `SELECT created_at, code, level, instance_id, item_id, message, meta
     FROM dispatch_send_events
     WHERE dispatch_id = $1
     ORDER BY id`,
    [dispatchId]
  );
  console.log('\n-- dispatch_send_events (SEND_OK / FAIL) --');
  for (const row of events.rows) {
    if (!['SEND_OK', 'SEND_FAIL', 'INSTANCE_PICK', 'COMPLETE'].includes(row.code)) {
      continue;
    }
    console.log(
      JSON.stringify({
        at: row.created_at,
        code: row.code,
        instance_id: row.instance_id,
        item_id: row.item_id,
        message: row.message,
        meta: row.meta,
      })
    );
  }
}

async function main() {
  if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
    console.error('Sem DATABASE_URL/DB_* no ambiente. Coloque backend/.env e rode de novo.');
    process.exit(1);
  }

  await initializeDatabase();

  await dumpDispatch(21);
  await dumpDispatch(22);

  const inst = await pool.query(
    `SELECT id, instance_name, api_url, api_key, status, phone_number, last_message_sent_at
     FROM instances
     WHERE id IN (1, 2)
     ORDER BY id`
  );
  console.log('\n=== connectionState instâncias 1 e 2 ===');
  for (const row of inst.rows) {
    const cs = await connectionState(row);
    console.log(
      JSON.stringify({
        id: row.id,
        name: row.instance_name,
        last_message_sent_at: row.last_message_sent_at,
        ...cs,
        api_key_present: Boolean(row.api_key),
      })
    );
  }

  // Frederico: comparar item sticky / preferred
  const pref = await pool.query(
    `SELECT c.id, c.name, c.phone_number, c.preferred_instance_id
     FROM contacts c
     WHERE c.phone_number LIKE '5516%05'
        OR LOWER(c.name) LIKE '%frederico%'
     ORDER BY c.id
     LIMIT 10`
  );
  console.log('\n=== preferred_instance (Frederico / ****05) ===');
  for (const row of pref.rows) {
    const phone = String(row.phone_number || '');
    console.log(
      JSON.stringify({
        id: row.id,
        name: row.name,
        phone_masked:
          phone.length >= 6
            ? `${phone.slice(0, 4)}****${phone.slice(-2)}`
            : '***',
        preferred_instance_id: row.preferred_instance_id,
      })
    );
  }

  console.log('\n=== RESUMO ===');
  console.log(
    'Se provider_message_id do #21 começa com evo- => falso positivo pré-f532eec.'
  );
  console.log(
    'Se id real no #21 e connectionState open nas duas => sessão/entrega da instância 1 (operacional).'
  );
  console.log(
    'Operacional: não usar instância 1 em pool real até reconectar/confirmar; preferir 2+.'
  );

  await pool.end();
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
