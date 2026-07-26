/**
 * Configuração persistente do worker de disparo (editável pela UI).
 * Banco = fonte efetiva. ENV = fallback na primeira linha ou override opcional.
 */
import { pool } from '../database';

export type WorkerDispatchProfileId = 'simulacao' | 'conservador' | 'moderado';

export interface WorkerDispatchConfigRow {
  id: number;
  enabled: boolean;
  real_send_enabled: boolean;
  dry_run_enabled: boolean;
  whatsapp_auto_validate_on_prepare: boolean;
  whatsapp_auto_validate_on_worker: boolean;
  whatsapp_validation_batch_size: number;
  min_delay_ms: number;
  max_delay_ms: number;
  send_timeout_ms: number;
  worker_batch_size: number;
  worker_interval_ms: number;
  cooldown_rate_limit_ms: number;
  cooldown_forbidden_ms: number;
  cooldown_5xx_ms: number;
  cooldown_network_ms: number;
  cooldown_default_ms: number;
  profile: string;
  updated_by: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface EffectiveWorkerPolicy extends WorkerDispatchConfigRow {
  locked_fields: string[];
  source: 'database' | 'env_fallback';
}

export class WorkerConfigValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'WorkerConfigValidationError';
  }
}

function envFlag(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return undefined;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return undefined;
}

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

function envOverridesEnabled(): boolean {
  const v = String(process.env.WORKER_CONFIG_ENV_OVERRIDE || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(v);
}

export const WORKER_DISPATCH_PROFILES: Record<
  WorkerDispatchProfileId,
  { label: string; description: string; values: Partial<WorkerDispatchConfigRow> }
> = {
  simulacao: {
    label: 'Simulação segura',
    description: 'Worker ligado, sem envio real.',
    values: {
      enabled: true,
      real_send_enabled: false,
      dry_run_enabled: true,
      whatsapp_auto_validate_on_prepare: false,
      whatsapp_auto_validate_on_worker: false,
      min_delay_ms: 60_000,
      max_delay_ms: 120_000,
      worker_batch_size: 1,
      worker_interval_ms: 30_000,
      profile: 'simulacao',
    },
  },
  conservador: {
    label: 'Conservador recomendado',
    description: 'Envio real com validação WA e delays altos.',
    values: {
      enabled: true,
      real_send_enabled: true,
      dry_run_enabled: false,
      whatsapp_auto_validate_on_prepare: true,
      whatsapp_auto_validate_on_worker: true,
      whatsapp_validation_batch_size: 10,
      min_delay_ms: 90_000,
      max_delay_ms: 180_000,
      worker_batch_size: 1,
      worker_interval_ms: 30_000,
      profile: 'conservador',
    },
  },
  moderado: {
    label: 'Moderado',
    description: 'Envio real com cadência média e validação WA.',
    values: {
      enabled: true,
      real_send_enabled: true,
      dry_run_enabled: false,
      whatsapp_auto_validate_on_prepare: true,
      whatsapp_auto_validate_on_worker: true,
      whatsapp_validation_batch_size: 20,
      min_delay_ms: 60_000,
      max_delay_ms: 120_000,
      worker_batch_size: 1,
      worker_interval_ms: 20_000,
      profile: 'moderado',
    },
  },
};

function defaultsFromEnvOrSafe(): Omit<WorkerDispatchConfigRow, 'id' | 'created_at' | 'updated_at'> {
  return {
    enabled: envFlag('DISPATCH_WORKER_ENABLED') ?? true,
    real_send_enabled: envFlag('DISPATCH_REAL_SEND_ENABLED') ?? false,
    dry_run_enabled: envFlag('DISPATCH_DRY_RUN_ENABLED') ?? true,
    whatsapp_auto_validate_on_prepare: envFlag('WHATSAPP_AUTO_VALIDATE_ON_PREPARE') ?? true,
    whatsapp_auto_validate_on_worker: envFlag('WHATSAPP_AUTO_VALIDATE_ON_WORKER') ?? true,
    whatsapp_validation_batch_size: envInt('WHATSAPP_VALIDATION_BATCH_SIZE') ?? 10,
    min_delay_ms: envInt('EVOLUTION_MIN_DELAY_MS') ?? 60_000,
    max_delay_ms: envInt('EVOLUTION_MAX_DELAY_MS') ?? 120_000,
    send_timeout_ms: envInt('EVOLUTION_SEND_TIMEOUT_MS') ?? 20_000,
    worker_batch_size: envInt('DISPATCH_WORKER_BATCH_SIZE') ?? 1,
    worker_interval_ms: envInt('DISPATCH_WORKER_INTERVAL_MS') ?? 30_000,
    cooldown_rate_limit_ms: envInt('EVOLUTION_COOLDOWN_RATE_LIMIT_MS') ?? 900_000,
    cooldown_forbidden_ms: envInt('EVOLUTION_COOLDOWN_FORBIDDEN_MS') ?? 1_800_000,
    cooldown_5xx_ms: envInt('EVOLUTION_COOLDOWN_5XX_MS') ?? 600_000,
    cooldown_network_ms: envInt('EVOLUTION_COOLDOWN_NETWORK_MS') ?? 300_000,
    cooldown_default_ms: envInt('EVOLUTION_COOLDOWN_DEFAULT_MS') ?? 300_000,
    profile: 'conservador',
    updated_by: null,
  };
}

let cache: EffectiveWorkerPolicy | null = null;

function mapRow(row: any): WorkerDispatchConfigRow {
  return {
    id: row.id,
    enabled: !!row.enabled,
    real_send_enabled: !!row.real_send_enabled,
    dry_run_enabled: !!row.dry_run_enabled,
    whatsapp_auto_validate_on_prepare: !!row.whatsapp_auto_validate_on_prepare,
    whatsapp_auto_validate_on_worker: !!row.whatsapp_auto_validate_on_worker,
    whatsapp_validation_batch_size: Number(row.whatsapp_validation_batch_size) || 10,
    min_delay_ms: Number(row.min_delay_ms) || 60_000,
    max_delay_ms: Number(row.max_delay_ms) || 120_000,
    send_timeout_ms: Number(row.send_timeout_ms) || 20_000,
    worker_batch_size: Number(row.worker_batch_size) || 1,
    worker_interval_ms: Number(row.worker_interval_ms) || 30_000,
    cooldown_rate_limit_ms: Number(row.cooldown_rate_limit_ms) || 900_000,
    cooldown_forbidden_ms: Number(row.cooldown_forbidden_ms) || 1_800_000,
    cooldown_5xx_ms: Number(row.cooldown_5xx_ms) || 600_000,
    cooldown_network_ms: Number(row.cooldown_network_ms) || 300_000,
    cooldown_default_ms: Number(row.cooldown_default_ms) || 300_000,
    profile: String(row.profile || 'conservador'),
    updated_by: row.updated_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function applyEnvOverrides(cfg: WorkerDispatchConfigRow): { policy: EffectiveWorkerPolicy; locked: string[] } {
  const locked: string[] = [];
  if (!envOverridesEnabled()) {
    return { policy: { ...cfg, locked_fields: [], source: 'database' }, locked };
  }

  const next = { ...cfg };
  const pairs: Array<[keyof WorkerDispatchConfigRow, string, boolean | number | undefined]> = [
    ['enabled', 'DISPATCH_WORKER_ENABLED', envFlag('DISPATCH_WORKER_ENABLED')],
    ['real_send_enabled', 'DISPATCH_REAL_SEND_ENABLED', envFlag('DISPATCH_REAL_SEND_ENABLED')],
    ['dry_run_enabled', 'DISPATCH_DRY_RUN_ENABLED', envFlag('DISPATCH_DRY_RUN_ENABLED')],
    ['whatsapp_auto_validate_on_prepare', 'WHATSAPP_AUTO_VALIDATE_ON_PREPARE', envFlag('WHATSAPP_AUTO_VALIDATE_ON_PREPARE')],
    ['whatsapp_auto_validate_on_worker', 'WHATSAPP_AUTO_VALIDATE_ON_WORKER', envFlag('WHATSAPP_AUTO_VALIDATE_ON_WORKER')],
    ['whatsapp_validation_batch_size', 'WHATSAPP_VALIDATION_BATCH_SIZE', envInt('WHATSAPP_VALIDATION_BATCH_SIZE')],
    ['min_delay_ms', 'EVOLUTION_MIN_DELAY_MS', envInt('EVOLUTION_MIN_DELAY_MS')],
    ['max_delay_ms', 'EVOLUTION_MAX_DELAY_MS', envInt('EVOLUTION_MAX_DELAY_MS')],
    ['send_timeout_ms', 'EVOLUTION_SEND_TIMEOUT_MS', envInt('EVOLUTION_SEND_TIMEOUT_MS')],
    ['worker_batch_size', 'DISPATCH_WORKER_BATCH_SIZE', envInt('DISPATCH_WORKER_BATCH_SIZE')],
    ['worker_interval_ms', 'DISPATCH_WORKER_INTERVAL_MS', envInt('DISPATCH_WORKER_INTERVAL_MS')],
    ['cooldown_rate_limit_ms', 'EVOLUTION_COOLDOWN_RATE_LIMIT_MS', envInt('EVOLUTION_COOLDOWN_RATE_LIMIT_MS')],
    ['cooldown_forbidden_ms', 'EVOLUTION_COOLDOWN_FORBIDDEN_MS', envInt('EVOLUTION_COOLDOWN_FORBIDDEN_MS')],
    ['cooldown_5xx_ms', 'EVOLUTION_COOLDOWN_5XX_MS', envInt('EVOLUTION_COOLDOWN_5XX_MS')],
    ['cooldown_network_ms', 'EVOLUTION_COOLDOWN_NETWORK_MS', envInt('EVOLUTION_COOLDOWN_NETWORK_MS')],
    ['cooldown_default_ms', 'EVOLUTION_COOLDOWN_DEFAULT_MS', envInt('EVOLUTION_COOLDOWN_DEFAULT_MS')],
  ];

  for (const [field, , val] of pairs) {
    if (val === undefined) continue;
    (next as any)[field] = val;
    locked.push(String(field));
  }

  return { policy: { ...next, locked_fields: locked, source: 'database' }, locked };
}

export function validateWorkerDispatchConfigInput(
  input: Partial<WorkerDispatchConfigRow> & { allow_unvalidated_send?: boolean },
  current?: WorkerDispatchConfigRow
): void {
  const merged = { ...(current || defaultsFromEnvOrSafe()), ...input };
  const real = !!merged.real_send_enabled;
  const dry = !!merged.dry_run_enabled;
  const waPrep = !!merged.whatsapp_auto_validate_on_prepare;
  const waWorker = !!merged.whatsapp_auto_validate_on_worker;
  const minDelay = Number(merged.min_delay_ms);
  const maxDelay = Number(merged.max_delay_ms);
  const batch = Number(merged.worker_batch_size);

  if (real && dry) {
    throw new WorkerConfigValidationError(
      'Não é permitido ligar envio real e simulação ao mesmo tempo.'
    );
  }
  if (real && !waPrep && !waWorker && !input.allow_unvalidated_send) {
    throw new WorkerConfigValidationError(
      'Envio real exige validação WhatsApp no prepare ou no worker. Ligue ao menos uma.'
    );
  }
  if (real && (!Number.isFinite(minDelay) || minDelay < 60_000)) {
    throw new WorkerConfigValidationError(
      'Com envio real, o delay mínimo deve ser pelo menos 60000 ms (60s).'
    );
  }
  if (!Number.isFinite(maxDelay) || !Number.isFinite(minDelay) || maxDelay < minDelay) {
    throw new WorkerConfigValidationError('Delay máximo deve ser maior ou igual ao delay mínimo.');
  }
  if (batch !== 1) {
    throw new WorkerConfigValidationError('Por enquanto o lote do worker deve ser 1.');
  }
  if (Number(merged.whatsapp_validation_batch_size) < 1) {
    throw new WorkerConfigValidationError('Lote de validação WhatsApp inválido.');
  }
  if (Number(merged.worker_interval_ms) < 1000) {
    throw new WorkerConfigValidationError('Intervalo do worker deve ser pelo menos 1000 ms.');
  }
}

export async function ensureWorkerDispatchConfigRow(): Promise<WorkerDispatchConfigRow> {
  const existing = await pool.query(
    `SELECT * FROM worker_dispatch_config ORDER BY id ASC LIMIT 1`
  );
  if (existing.rows[0]) {
    return mapRow(existing.rows[0]);
  }

  const d = defaultsFromEnvOrSafe();
  // Se real e dry vierem ambos true do ENV, forçar simulação segura
  if (d.real_send_enabled && d.dry_run_enabled) {
    d.real_send_enabled = false;
    d.dry_run_enabled = true;
    d.profile = 'simulacao';
  }

  const ins = await pool.query(
    `INSERT INTO worker_dispatch_config (
      enabled, real_send_enabled, dry_run_enabled,
      whatsapp_auto_validate_on_prepare, whatsapp_auto_validate_on_worker, whatsapp_validation_batch_size,
      min_delay_ms, max_delay_ms, send_timeout_ms,
      worker_batch_size, worker_interval_ms,
      cooldown_rate_limit_ms, cooldown_forbidden_ms, cooldown_5xx_ms,
      cooldown_network_ms, cooldown_default_ms, profile
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
    ) RETURNING *`,
    [
      d.enabled,
      d.real_send_enabled,
      d.dry_run_enabled,
      d.whatsapp_auto_validate_on_prepare,
      d.whatsapp_auto_validate_on_worker,
      d.whatsapp_validation_batch_size,
      d.min_delay_ms,
      d.max_delay_ms,
      d.send_timeout_ms,
      d.worker_batch_size,
      d.worker_interval_ms,
      d.cooldown_rate_limit_ms,
      d.cooldown_forbidden_ms,
      d.cooldown_5xx_ms,
      d.cooldown_network_ms,
      d.cooldown_default_ms,
      d.profile,
    ]
  );
  return mapRow(ins.rows[0]);
}

export async function refreshWorkerDispatchConfigCache(): Promise<EffectiveWorkerPolicy> {
  try {
    const row = await ensureWorkerDispatchConfigRow();
    const { policy } = applyEnvOverrides(row);
    cache = policy;
    return policy;
  } catch (e) {
    // Fallback ENV se tabela ainda não existir
    const d = defaultsFromEnvOrSafe();
    cache = {
      id: 0,
      ...d,
      locked_fields: [],
      source: 'env_fallback',
    };
    return cache;
  }
}

export async function getWorkerDispatchConfig(): Promise<WorkerDispatchConfigRow> {
  return ensureWorkerDispatchConfigRow();
}

export async function getEffectiveWorkerPolicy(): Promise<EffectiveWorkerPolicy> {
  if (cache) return cache;
  return refreshWorkerDispatchConfigCache();
}

/** Leitura síncrona do cache (após bootstrap). Se vazio, usa defaults seguros. */
export function getCachedEffectiveWorkerPolicy(): EffectiveWorkerPolicy {
  if (cache) return cache;
  const d = defaultsFromEnvOrSafe();
  return { id: 0, ...d, locked_fields: [], source: 'env_fallback' };
}

function coercePatch(
  patch: Record<string, unknown>
): Partial<WorkerDispatchConfigRow> & { allow_unvalidated_send?: boolean } {
  const boolKeys = [
    'enabled',
    'real_send_enabled',
    'dry_run_enabled',
    'whatsapp_auto_validate_on_prepare',
    'whatsapp_auto_validate_on_worker',
    'allow_unvalidated_send',
  ] as const;
  const intKeys = [
    'whatsapp_validation_batch_size',
    'min_delay_ms',
    'max_delay_ms',
    'send_timeout_ms',
    'worker_batch_size',
    'worker_interval_ms',
    'cooldown_rate_limit_ms',
    'cooldown_forbidden_ms',
    'cooldown_5xx_ms',
    'cooldown_network_ms',
    'cooldown_default_ms',
  ] as const;

  const out: Record<string, unknown> = {};
  for (const k of boolKeys) {
    if (patch[k] === undefined) continue;
    out[k] = patch[k] === true || patch[k] === 'true' || patch[k] === 1 || patch[k] === '1';
  }
  for (const k of intKeys) {
    if (patch[k] === undefined || patch[k] === null || patch[k] === '') continue;
    const n = Number(patch[k]);
    if (Number.isFinite(n)) out[k] = Math.floor(n);
  }
  if (typeof patch.profile === 'string') out.profile = patch.profile;
  return out as Partial<WorkerDispatchConfigRow> & { allow_unvalidated_send?: boolean };
}

export async function updateWorkerDispatchConfig(
  patch: Partial<WorkerDispatchConfigRow> & { allow_unvalidated_send?: boolean },
  updatedBy?: number | null
): Promise<EffectiveWorkerPolicy> {
  const current = await ensureWorkerDispatchConfigRow();
  const locked = applyEnvOverrides(current).locked;

  const clean = coercePatch(patch as Record<string, unknown>);
  const allowUnvalidated = !!clean.allow_unvalidated_send;
  delete (clean as any).allow_unvalidated_send;
  delete (clean as any).id;
  delete (clean as any).created_at;
  delete (clean as any).updated_at;

  for (const field of locked) {
    delete (clean as any)[field];
  }

  validateWorkerDispatchConfigInput({ ...clean, allow_unvalidated_send: allowUnvalidated }, current);

  const next = { ...current, ...clean };
  if (patch.profile == null && (clean as any).profile == null) {
    next.profile = 'custom';
  }

  const upd = await pool.query(
    `UPDATE worker_dispatch_config SET
      enabled = $1,
      real_send_enabled = $2,
      dry_run_enabled = $3,
      whatsapp_auto_validate_on_prepare = $4,
      whatsapp_auto_validate_on_worker = $5,
      whatsapp_validation_batch_size = $6,
      min_delay_ms = $7,
      max_delay_ms = $8,
      send_timeout_ms = $9,
      worker_batch_size = $10,
      worker_interval_ms = $11,
      cooldown_rate_limit_ms = $12,
      cooldown_forbidden_ms = $13,
      cooldown_5xx_ms = $14,
      cooldown_network_ms = $15,
      cooldown_default_ms = $16,
      profile = $17,
      updated_by = $18,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = $19
     RETURNING *`,
    [
      next.enabled,
      next.real_send_enabled,
      next.dry_run_enabled,
      next.whatsapp_auto_validate_on_prepare,
      next.whatsapp_auto_validate_on_worker,
      next.whatsapp_validation_batch_size,
      next.min_delay_ms,
      next.max_delay_ms,
      next.send_timeout_ms,
      next.worker_batch_size,
      next.worker_interval_ms,
      next.cooldown_rate_limit_ms,
      next.cooldown_forbidden_ms,
      next.cooldown_5xx_ms,
      next.cooldown_network_ms,
      next.cooldown_default_ms,
      next.profile,
      updatedBy ?? null,
      current.id,
    ]
  );

  const { policy } = applyEnvOverrides(mapRow(upd.rows[0]));
  cache = policy;
  return policy;
}

export async function applyWorkerDispatchProfile(
  profileId: string,
  updatedBy?: number | null
): Promise<EffectiveWorkerPolicy> {
  const id = profileId as WorkerDispatchProfileId;
  const profile = WORKER_DISPATCH_PROFILES[id];
  if (!profile) {
    throw new WorkerConfigValidationError('Perfil inválido. Use: simulacao | conservador | moderado');
  }
  return updateWorkerDispatchConfig({ ...profile.values, profile: id }, updatedBy);
}

export function listWorkerDispatchProfiles() {
  return (Object.keys(WORKER_DISPATCH_PROFILES) as WorkerDispatchProfileId[]).map((id) => ({
    id,
    label: WORKER_DISPATCH_PROFILES[id].label,
    description: WORKER_DISPATCH_PROFILES[id].description,
  }));
}
