/**
 * Política operacional do worker (linguagem de produto).
 * ENV fica só em campos técnicos opcionais — não é a UI principal.
 *
 * Caminho real: dispatch_items → dispatchWorker → evolutionSafeSender → instance_send_guard
 */
import { pool } from '../database';
import { getDispatchRuntimeSnapshot } from './dispatchRuntimeConfig';
import { getEvolutionCadenceSnapshot, maskPhone } from './evolutionSafeSender';
import {
  isWhatsAppAutoValidateOnPrepare,
  isWhatsAppAutoValidateOnWorker,
  resolveListAudience,
} from './listAudienceResolver';
import {
  getEffectiveWorkerPolicy,
  listWorkerDispatchProfiles,
} from './workerDispatchConfig';

export type OperationalMode = 'blocked' | 'dry_run' | 'real_send' | 'invalid_config';

export type BlockingReasonCode =
  | 'WORKER_DISABLED'
  | 'SEND_MODE_OFF'
  | 'REAL_SEND_AND_DRY_RUN_ENABLED'
  | 'WHATSAPP_VALIDATION_REQUIRED'
  | 'NO_CONNECTED_INSTANCE';

export interface BlockingReason {
  code: BlockingReasonCode;
  message: string;
}

export interface SafetyChecks {
  worker_enabled: boolean;
  real_send_enabled: boolean;
  dry_run_enabled: boolean;
  whatsapp_validation_on_prepare: boolean;
  whatsapp_validation_on_worker: boolean;
  has_pending_whatsapp_validation: boolean;
  all_current_dispatch_contacts_validated: boolean;
  pending_whatsapp_validation_count: number;
}

export interface EffectivePolicy {
  min_delay_ms: number;
  max_delay_ms: number;
  send_timeout_ms: number;
  worker_batch_size: number;
  worker_interval_ms: number;
  cooldowns: {
    rate_limit_ms: number;
    forbidden_ms: number;
    server_error_ms: number;
    network_ms: number;
    default_ms: number;
  };
}

/** Avaliação pura — usada por snapshot, operação e testes secos. */
export function evaluateOperationalPolicy(input: {
  workerEnabled: boolean;
  realSendEnabled: boolean;
  dryRunEnabled: boolean;
  waValidateOnPrepare: boolean;
  waValidateOnWorker: boolean;
  pendingWhatsAppCount: number;
  allCurrentContactsValidated: boolean;
  hasConnectedInstance?: boolean;
}): {
  operational_mode: OperationalMode;
  blocking_reasons: BlockingReason[];
  can_send_real: boolean;
  status_label: string;
} {
  const reasons: BlockingReason[] = [];
  const waAutoOn = input.waValidateOnPrepare || input.waValidateOnWorker;
  const hasPending = input.pendingWhatsAppCount > 0;

  if (input.realSendEnabled && input.dryRunEnabled) {
    reasons.push({
      code: 'REAL_SEND_AND_DRY_RUN_ENABLED',
      message: 'Envio real e simulação estão ligados ao mesmo tempo. Desligue um dos dois.',
    });
    return {
      operational_mode: 'invalid_config',
      blocking_reasons: reasons,
      can_send_real: false,
      status_label: 'Configuração inválida',
    };
  }

  if (!input.workerEnabled) {
    reasons.push({
      code: 'WORKER_DISABLED',
      message: 'Worker desligado. A fila não será processada.',
    });
  }

  if (!input.realSendEnabled && !input.dryRunEnabled) {
    reasons.push({
      code: 'SEND_MODE_OFF',
      message: 'Nem envio real nem simulação estão ligados.',
    });
  }

  if (input.hasConnectedInstance === false) {
    reasons.push({
      code: 'NO_CONNECTED_INSTANCE',
      message: 'Nenhuma instância WhatsApp conectada.',
    });
  }

  // Envio real exige validação automática OU todos os contatos do dispatch já validados
  if (input.realSendEnabled && !input.dryRunEnabled) {
    if (!waAutoOn && (hasPending || !input.allCurrentContactsValidated)) {
      reasons.push({
        code: 'WHATSAPP_VALIDATION_REQUIRED',
        message:
          'Validação WhatsApp automática desligada e há contatos pendentes. Ligue a validação ou valide todos antes do envio real.',
      });
    }
  }

  const canSendReal =
    input.workerEnabled &&
    input.realSendEnabled &&
    !input.dryRunEnabled &&
    (waAutoOn || input.allCurrentContactsValidated) &&
    !hasPending &&
    input.hasConnectedInstance !== false &&
    !reasons.some((r) => r.code === 'WHATSAPP_VALIDATION_REQUIRED');

  if (!input.workerEnabled || (!input.realSendEnabled && !input.dryRunEnabled)) {
    return {
      operational_mode: 'blocked',
      blocking_reasons: reasons,
      can_send_real: false,
      status_label: 'Bloqueado',
    };
  }

  if (input.realSendEnabled && reasons.some((r) => r.code === 'WHATSAPP_VALIDATION_REQUIRED')) {
    return {
      operational_mode: 'blocked',
      blocking_reasons: reasons,
      can_send_real: false,
      status_label: 'Bloqueado',
    };
  }

  if (input.realSendEnabled && canSendReal) {
    return {
      operational_mode: 'real_send',
      blocking_reasons: reasons.filter((r) => r.code === 'NO_CONNECTED_INSTANCE'), // still show instance if any
      can_send_real: reasons.every((r) => r.code !== 'NO_CONNECTED_INSTANCE'),
      status_label: 'Envio real pronto',
    };
  }

  if (input.realSendEnabled && !canSendReal) {
    return {
      operational_mode: 'blocked',
      blocking_reasons: reasons,
      can_send_real: false,
      status_label: 'Bloqueado',
    };
  }

  // dry_run
  return {
    operational_mode: 'dry_run',
    blocking_reasons: reasons.filter((r) => r.code !== 'SEND_MODE_OFF'),
    can_send_real: false,
    status_label: 'Simulação',
  };
}

async function resolvePendingWhatsAppForDevocional(): Promise<{
  pendingCount: number;
  allValidated: boolean;
  dispatchId: number | null;
}> {
  const configR = await pool.query(
    `SELECT list_id, timezone FROM devocional_config ORDER BY id DESC LIMIT 1`
  );
  const config = configR.rows[0];
  const timezone = config?.timezone || 'America/Sao_Paulo';
  const dateYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  let pendingFromAudience = 0;
  let eligibleValidated = 0;
  let eligibleTotal = 0;

  if (config?.list_id) {
    try {
      const audience = await resolveListAudience(config.list_id);
      pendingFromAudience = audience.counts.needs_whatsapp_validation;
      eligibleValidated = audience.counts.eligible_now;
      eligibleTotal = audience.counts.eligible_now + audience.counts.needs_whatsapp_validation;
    } catch {
      /* lista inválida — ignora */
    }
  }

  const devR = await pool.query(`SELECT id FROM devocionais WHERE date = $1 LIMIT 1`, [dateYmd]);
  if (devR.rows.length === 0) {
    return {
      pendingCount: pendingFromAudience,
      allValidated: pendingFromAudience === 0 && (eligibleTotal === 0 || eligibleValidated === eligibleTotal),
      dispatchId: null,
    };
  }

  const dispatchR = await pool.query(
    `SELECT id FROM dispatches
     WHERE dispatch_type = 'devocional'
       AND devocional_id = $1
       AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE $2) = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [devR.rows[0].id, timezone, dateYmd]
  );

  if (dispatchR.rows.length === 0) {
    return {
      pendingCount: pendingFromAudience,
      allValidated: pendingFromAudience === 0 && eligibleTotal > 0
        ? eligibleValidated === eligibleTotal
        : pendingFromAudience === 0,
      dispatchId: null,
    };
  }

  const dispatchId = dispatchR.rows[0].id as number;
  const pendingItems = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM dispatch_items di
     LEFT JOIN contacts c ON c.id = di.contact_id
     WHERE di.dispatch_id = $1
       AND di.status IN ('pending', 'pending_retry', 'processing', 'scheduled')
       AND (
         c.id IS NULL
         OR c.whatsapp_validated IS DISTINCT FROM TRUE
       )`,
    [dispatchId]
  );
  const pendingInDispatch = pendingItems.rows[0]?.c ?? 0;

  const openTotal = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM dispatch_items
     WHERE dispatch_id = $1
       AND status IN ('pending', 'pending_retry', 'processing', 'scheduled')`,
    [dispatchId]
  );
  const open = openTotal.rows[0]?.c ?? 0;

  return {
    pendingCount: Math.max(pendingFromAudience, pendingInDispatch),
    allValidated: pendingInDispatch === 0 && (open === 0 ? pendingFromAudience === 0 : true),
    dispatchId,
  };
}

export async function getWorkerConfigSnapshot() {
  const effective = await getEffectiveWorkerPolicy();
  const runtime = getDispatchRuntimeSnapshot();
  const cadence = getEvolutionCadenceSnapshot();
  const waPrepare = isWhatsAppAutoValidateOnPrepare();
  const waWorker = isWhatsAppAutoValidateOnWorker();

  const pending = await resolvePendingWhatsAppForDevocional();

  const instances = await pool.query(
    `SELECT i.id, i.instance_name, i.name, i.status, i.health_status, i.phone_number,
            g.next_available_at, g.last_sent_at, g.cooldown_until,
            g.daily_sent_count, g.hourly_sent_count, g.violation_count
     FROM instances i
     LEFT JOIN instance_send_guard g ON g.instance_id = i.id
     ORDER BY i.id ASC`
  );
  const connectedCount = instances.rows.filter((r) => r.status === 'connected').length;

  const safety_checks: SafetyChecks = {
    worker_enabled: runtime.workerEnabled,
    real_send_enabled: runtime.realSendEnabled,
    dry_run_enabled: runtime.dryRunEnabled,
    whatsapp_validation_on_prepare: waPrepare,
    whatsapp_validation_on_worker: waWorker,
    has_pending_whatsapp_validation: pending.pendingCount > 0,
    all_current_dispatch_contacts_validated: pending.allValidated,
    pending_whatsapp_validation_count: pending.pendingCount,
  };

  const policyEval = evaluateOperationalPolicy({
    workerEnabled: runtime.workerEnabled,
    realSendEnabled: runtime.realSendEnabled,
    dryRunEnabled: runtime.dryRunEnabled,
    waValidateOnPrepare: waPrepare,
    waValidateOnWorker: waWorker,
    pendingWhatsAppCount: pending.pendingCount,
    allCurrentContactsValidated: pending.allValidated,
    hasConnectedInstance: connectedCount > 0,
  });

  const effective_policy: EffectivePolicy = {
    min_delay_ms: cadence.min_delay_ms,
    max_delay_ms: cadence.max_delay_ms,
    send_timeout_ms: cadence.send_timeout_ms,
    worker_batch_size: runtime.batchSize,
    worker_interval_ms: runtime.intervalMs,
    cooldowns: {
      rate_limit_ms: cadence.cooldown_rate_limit_ms,
      forbidden_ms: cadence.cooldown_forbidden_ms,
      server_error_ms: cadence.cooldown_5xx_ms,
      network_ms: cadence.cooldown_network_ms,
      default_ms: cadence.cooldown_default_ms,
    },
  };

  return {
    operational_mode: policyEval.operational_mode,
    status_label: policyEval.status_label,
    blocking_reasons: policyEval.blocking_reasons,
    can_send_real: policyEval.can_send_real,
    safety_checks,
    effective_policy,
    config: {
      id: effective.id,
      enabled: effective.enabled,
      real_send_enabled: effective.real_send_enabled,
      dry_run_enabled: effective.dry_run_enabled,
      whatsapp_auto_validate_on_prepare: effective.whatsapp_auto_validate_on_prepare,
      whatsapp_auto_validate_on_worker: effective.whatsapp_auto_validate_on_worker,
      whatsapp_validation_batch_size: effective.whatsapp_validation_batch_size,
      min_delay_ms: effective.min_delay_ms,
      max_delay_ms: effective.max_delay_ms,
      send_timeout_ms: effective.send_timeout_ms,
      worker_batch_size: effective.worker_batch_size,
      worker_interval_ms: effective.worker_interval_ms,
      cooldown_rate_limit_ms: effective.cooldown_rate_limit_ms,
      cooldown_forbidden_ms: effective.cooldown_forbidden_ms,
      cooldown_5xx_ms: effective.cooldown_5xx_ms,
      cooldown_network_ms: effective.cooldown_network_ms,
      cooldown_default_ms: effective.cooldown_default_ms,
      profile: effective.profile,
      updated_at: effective.updated_at,
    },
    locked_fields: effective.locked_fields,
    source: effective.source,
    profiles: listWorkerDispatchProfiles(),
    whatsapp_safety: {
      validation_on_prepare: waPrepare,
      validation_on_worker: waWorker,
      pending_count: pending.pendingCount,
      can_send_safely: policyEval.can_send_real || policyEval.operational_mode === 'dry_run',
      all_current_dispatch_contacts_validated: pending.allValidated,
      current_dispatch_id: pending.dispatchId,
    },
    instances: {
      connected_count: connectedCount,
      items: instances.rows.map((row) => ({
        id: row.id,
        instance_name: row.instance_name,
        name: row.name,
        status: row.status,
        health_status: row.health_status,
        phone_masked: row.phone_number ? maskPhone(row.phone_number) : null,
        next_available_at: row.next_available_at,
        last_sent_at: row.last_sent_at,
        cooldown_until: row.cooldown_until,
        daily_sent_count: row.daily_sent_count ?? 0,
        hourly_sent_count: row.hourly_sent_count ?? 0,
        violation_count: row.violation_count ?? 0,
      })),
    },
    path: 'dispatch_items → dispatchWorker → evolutionSafeSender → instance_send_guard → Evolution',
    note: 'Alterações salvas no banco passam a valer no worker sem editar ENV (salvo override explícito).',
  };
}
