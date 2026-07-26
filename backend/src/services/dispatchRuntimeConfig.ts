/**
 * Flags operacionais do pipeline de disparo.
 * Fonte efetiva: worker_dispatch_config (banco). ENV = fallback/override opcional.
 */
import {
  getCachedEffectiveWorkerPolicy,
  getEffectiveWorkerPolicy,
} from './workerDispatchConfig';

export class DispatchOperationalError extends Error {
  readonly code = 'DISPATCH_CONFIG_BLOCKED';

  constructor(message: string) {
    super(message);
    this.name = 'DispatchOperationalError';
  }
}

export function isDispatchWorkerEnabled(): boolean {
  return !!getCachedEffectiveWorkerPolicy().enabled;
}

export function isDispatchRealSendEnabled(): boolean {
  return !!getCachedEffectiveWorkerPolicy().real_send_enabled;
}

export function isDispatchDryRunEnabled(): boolean {
  return !!getCachedEffectiveWorkerPolicy().dry_run_enabled;
}

export function getDispatchWorkerBatchSize(): number {
  return Math.max(1, getCachedEffectiveWorkerPolicy().worker_batch_size || 1);
}

export function getDispatchWorkerIntervalMs(): number {
  return Math.max(1000, getCachedEffectiveWorkerPolicy().worker_interval_ms || 30_000);
}

/**
 * Bloqueia novo disparo se a configuração operacional for insegura/incompleta.
 */
export function assertDispatchPipelineAllowed(): void {
  if (isDispatchRealSendEnabled() && isDispatchDryRunEnabled()) {
    throw new DispatchOperationalError(
      'Configuração inválida: envio real e simulação estão ligados juntos. Desligue um dos dois.'
    );
  }
  if (!isDispatchWorkerEnabled()) {
    throw new DispatchOperationalError(
      'Disparo bloqueado: worker desligado. Ative o worker nas Configurações do Worker.'
    );
  }
  if (!isDispatchRealSendEnabled() && !isDispatchDryRunEnabled()) {
    throw new DispatchOperationalError(
      'Disparo bloqueado: envio real e simulação estão desligados. Ajuste nas Configurações do Worker.'
    );
  }
}

export async function assertDispatchPipelineAllowedAsync(): Promise<void> {
  await getEffectiveWorkerPolicy();
  assertDispatchPipelineAllowed();
}

export function getDispatchRuntimeSnapshot(): {
  workerEnabled: boolean;
  realSendEnabled: boolean;
  dryRunEnabled: boolean;
  batchSize: number;
  intervalMs: number;
} {
  const p = getCachedEffectiveWorkerPolicy();
  return {
    workerEnabled: !!p.enabled,
    realSendEnabled: !!p.real_send_enabled,
    dryRunEnabled: !!p.dry_run_enabled,
    batchSize: Math.max(1, p.worker_batch_size || 1),
    intervalMs: Math.max(1000, p.worker_interval_ms || 30_000),
  };
}
