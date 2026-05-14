import { Pool } from 'pg';

/**
 * Data de hoje em America/Sao_Paulo (AAAA-MM-DD).
 */
export function todaySaoPauloYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Itera cada dia entre start e end (inclusive), formato AAAA-MM-DD.
 */
export function* eachDateInclusiveYmd(start: string, end: string): Generator<string> {
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  let cur = new Date(Date.UTC(ys, ms - 1, ds));
  const endD = new Date(Date.UTC(ye, me - 1, de));
  while (cur <= endD) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    yield `${y}-${m}-${d}`;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

/**
 * Define qual jornada deve estar ativa para uma data (AAAA-MM-DD):
 * a primeira jornada, por início e id, cujo período [start_date, end_date] contém essa data.
 * Se nenhuma cobrir essa data, não altera as flags (evita apagar ativa de jornada futura antes do período).
 */
export async function reconcileActiveJourneyForDate(pool: Pool, ymd: string): Promise<{ activeId: number | null }> {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return { activeId: null };
  }

  const pick = await pool.query(
    `SELECT id FROM devocional_journeys
     WHERE start_date <= $1::date
       AND (end_date IS NULL OR end_date >= $1::date)
     ORDER BY start_date ASC, id ASC
     LIMIT 1`,
    [ymd]
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (pick.rows.length > 0) {
      const id = pick.rows[0].id as number;
      await client.query(`UPDATE devocional_journeys SET is_active = false`);
      await client.query(
        `UPDATE devocional_journeys SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id]
      );
      await client.query('COMMIT');
      return { activeId: id };
    }
    await client.query('COMMIT');
    return { activeId: null };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}
