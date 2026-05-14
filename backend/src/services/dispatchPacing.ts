import { pool } from '../database';
import { addLog } from '../routes/logs';

/** Pacing entre envios no mesmo disparo + rotação por volume (Fase B). */
export interface DispatchPacingRuntime {
  pacingEnabled: boolean;
  messagesPerBatch: number;
  pauseBetweenBatchesMs: number;
  longPauseEveryN: number;
  longPauseMs: number;
  rotateEveryN: number;
}

function parseJsonb(row: { config: unknown } | undefined): Record<string, any> {
  if (!row?.config) return {};
  if (typeof row.config === 'string') {
    try {
      return JSON.parse(row.config);
    } catch {
      return {};
    }
  }
  if (typeof row.config === 'object' && !Array.isArray(row.config)) {
    return row.config as Record<string, any>;
  }
  return {};
}

/**
 * Lê regra global `dispatch_pacing` e `rotate_every_n_messages` em `instance_rotation`.
 */
export async function loadDispatchPacingRuntime(): Promise<DispatchPacingRuntime> {
  const out: DispatchPacingRuntime = {
    pacingEnabled: false,
    messagesPerBatch: 0,
    pauseBetweenBatchesMs: 0,
    longPauseEveryN: 0,
    longPauseMs: 0,
    rotateEveryN: 0,
  };

  const rotRow = await pool.query(
    `SELECT config FROM blindage_rules
     WHERE instance_id IS NULL AND rule_type = 'instance_rotation' AND enabled = TRUE
     LIMIT 1`
  );
  if (rotRow.rows[0]) {
    const rc = parseJsonb(rotRow.rows[0]);
    const n = Number(rc.rotate_every_n_messages);
    if (Number.isFinite(n) && n > 0) {
      out.rotateEveryN = Math.floor(n);
    }
  }

  const pacingRow = await pool.query(
    `SELECT config FROM blindage_rules
     WHERE instance_id IS NULL AND rule_type = 'dispatch_pacing' AND enabled = TRUE
     LIMIT 1`
  );
  if (!pacingRow.rows[0]) {
    return out;
  }
  const c = parseJsonb(pacingRow.rows[0]);
  if (c.enabled === false) {
    return out;
  }

  out.pacingEnabled = true;
  const batch = Number(c.messages_per_batch);
  out.messagesPerBatch = Number.isFinite(batch) && batch > 0 ? Math.floor(batch) : 0;
  const pbm = Number(c.pause_between_batches_minutes);
  out.pauseBetweenBatchesMs = Number.isFinite(pbm) && pbm > 0 ? Math.round(pbm * 60 * 1000) : 0;
  const le = Number(c.long_pause_every_n_messages);
  out.longPauseEveryN = Number.isFinite(le) && le > 0 ? Math.floor(le) : 0;
  const lpm = Number(c.long_pause_minutes);
  out.longPauseMs = Number.isFinite(lpm) && lpm > 0 ? Math.round(lpm * 60 * 1000) : 0;

  return out;
}

/**
 * Índice da instância preferida antes da blindagem (rotação a cada N **envios com sucesso**).
 */
export function preferredInstanceIndexForDispatch(
  pacing: DispatchPacingRuntime,
  successSoFar: number,
  instanceIndex: number,
  instanceCount: number
): number {
  if (instanceCount <= 0) return 0;
  if (pacing.rotateEveryN > 0) {
    return Math.floor(successSoFar / pacing.rotateEveryN) % instanceCount;
  }
  return instanceIndex % instanceCount;
}

/**
 * Pausas entre lotes / longas após N envios com sucesso no mesmo disparo.
 * Deve rodar **fora** de `withGlobalOutboundGate` para não bloquear outros disparos por vários minutos.
 */
export async function maybeDispatchPacingPause(
  pacing: DispatchPacingRuntime,
  successCountAfterThisSend: number,
  logTag: string
): Promise<void> {
  if (!pacing.pacingEnabled || successCountAfterThisSend <= 0) {
    return;
  }

  let pauseMs = 0;
  const reasons: string[] = [];

  if (pacing.messagesPerBatch > 0 && successCountAfterThisSend % pacing.messagesPerBatch === 0) {
    if (pacing.pauseBetweenBatchesMs > 0) {
      reasons.push(`fim do lote (${pacing.messagesPerBatch} envios)`);
      pauseMs = Math.max(pauseMs, pacing.pauseBetweenBatchesMs);
    }
  }
  if (pacing.longPauseEveryN > 0 && successCountAfterThisSend % pacing.longPauseEveryN === 0) {
    if (pacing.longPauseMs > 0) {
      reasons.push(`marco de ${pacing.longPauseEveryN} envios`);
      pauseMs = Math.max(pauseMs, pacing.longPauseMs);
    }
  }

  if (pauseMs <= 0 || reasons.length === 0) {
    return;
  }

  const sec = Math.ceil(pauseMs / 1000);
  const line = `⏸️ [Pacing] Pausa de ${sec}s após ${successCountAfterThisSend} envio(s) com sucesso (${reasons.join('; ')})`;
  console.log(`   ${line}`);
  addLog('info', `[${logTag}] ${line}`);
  await new Promise((r) => setTimeout(r, pauseMs));
}
