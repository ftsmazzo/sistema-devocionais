/**
 * Flags operacionais do pipeline de disparo (worker PostgreSQL).
 * Defaults seguros: tudo desligado.
 */
export class DispatchOperationalError extends Error {
  readonly code = 'DISPATCH_CONFIG_BLOCKED';

  constructor(message: string) {
    super(message);
    this.name = 'DispatchOperationalError';
  }
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultValue;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function isDispatchWorkerEnabled(): boolean {
  return envFlag('DISPATCH_WORKER_ENABLED', false);
}

export function isDispatchRealSendEnabled(): boolean {
  return envFlag('DISPATCH_REAL_SEND_ENABLED', false);
}

export function isDispatchDryRunEnabled(): boolean {
  return envFlag('DISPATCH_DRY_RUN_ENABLED', false);
}

export function getDispatchWorkerBatchSize(): number {
  return envInt('DISPATCH_WORKER_BATCH_SIZE', 1);
}

export function getDispatchWorkerIntervalMs(): number {
  return envInt('DISPATCH_WORKER_INTERVAL_MS', 30_000);
}

/**
 * Bloqueia novo disparo se a configuração operacional for insegura/incompleta.
 */
export function assertDispatchPipelineAllowed(): void {
  if (isDispatchRealSendEnabled() && isDispatchDryRunEnabled()) {
    throw new DispatchOperationalError(
      'Configuração inválida: envio real e simulação (dry-run) estão ligados juntos. Desligue um dos dois.'
    );
  }
  if (!isDispatchWorkerEnabled()) {
    throw new DispatchOperationalError(
      'Disparo bloqueado: worker desligado. Ative o worker para enfileirar disparos.'
    );
  }
  if (!isDispatchRealSendEnabled() && !isDispatchDryRunEnabled()) {
    throw new DispatchOperationalError(
      'Disparo bloqueado: envio real e simulação estão desligados. Ative simulação ou envio real.'
    );
  }
}

export function getDispatchRuntimeSnapshot(): {
  workerEnabled: boolean;
  realSendEnabled: boolean;
  dryRunEnabled: boolean;
  batchSize: number;
  intervalMs: number;
} {
  return {
    workerEnabled: isDispatchWorkerEnabled(),
    realSendEnabled: isDispatchRealSendEnabled(),
    dryRunEnabled: isDispatchDryRunEnabled(),
    batchSize: getDispatchWorkerBatchSize(),
    intervalMs: getDispatchWorkerIntervalMs(),
  };
}
