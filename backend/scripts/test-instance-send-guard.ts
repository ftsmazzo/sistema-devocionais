/**
 * Teste de serialização do instance_send_guard.
 * Duas reservas paralelas na mesma instância devem obter next_available distintos
 * (gap >= EVOLUTION_MIN_DELAY_MS).
 *
 * Uso (com DATABASE_URL e pelo menos 1 instância no banco):
 *   npx tsx scripts/test-instance-send-guard.ts [instanceId]
 */
import dotenv from 'dotenv';
dotenv.config();

import { pool, initializeDatabase } from '../src/database';
import { reserveSendSlot } from '../src/services/evolutionSafeSender';

async function main() {
  await initializeDatabase();

  let instanceId = Number(process.argv[2]);
  if (!Number.isFinite(instanceId) || instanceId <= 0) {
    const r = await pool.query(`SELECT id FROM instances ORDER BY id ASC LIMIT 1`);
    if (r.rows.length === 0) {
      console.error('Nenhuma instância no banco. Crie uma ou passe instanceId.');
      process.exit(1);
    }
    instanceId = r.rows[0].id;
  }

  await pool.query(
    `INSERT INTO instance_send_guard (instance_id, next_available_at, sequence_number)
     VALUES ($1, CURRENT_TIMESTAMP, 0)
     ON CONFLICT (instance_id) DO UPDATE
       SET next_available_at = CURRENT_TIMESTAMP,
           cooldown_until = NULL,
           updated_at = CURRENT_TIMESTAMP`,
    [instanceId]
  );

  const minDelay = Number(process.env.EVOLUTION_MIN_DELAY_MS || 60_000);

  console.log(`Reservando 2 slots em paralelo na instância ${instanceId} (minDelay=${minDelay}ms)...`);
  const [a, b] = await Promise.all([
    reserveSendSlot(instanceId),
    reserveSendSlot(instanceId),
  ]);

  const gap = Math.abs(a.sequenceNumber - b.sequenceNumber);
  const waitsOk = a.waitedMs === 0 || b.waitedMs > 0 || a.waitedMs > 0 || b.waitedMs === 0;
  // Uma das reservas deve ter waitedMs próximo do delay da outra (serialização)
  const maxWait = Math.max(a.waitedMs, b.waitedMs);
  const serialized = gap === 1 && maxWait >= minDelay * 0.9;

  console.log('Resultado A:', a);
  console.log('Resultado B:', b);
  console.log('serialized?', serialized, 'waitsOk?', waitsOk);

  if (!serialized) {
    console.error('FALHA: reservas paralelas não serializaram corretamente.');
    process.exit(1);
  }

  console.log('OK: serialização por FOR UPDATE respeitada.');
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
