/**
 * Snapshot autenticado das configurações reais do motor de disparo.
 *
 * Classificação por item:
 * - MANTER_SOMENTE_LEITURA: ENV ou estado de instance_send_guard (afeta worker/guard).
 * - MOVER_PARA_COMPATIBILIDADE: blindage_rules ainda usadas por applyBlindage (mensagens avulsas).
 * - REMOVER_DA_TELA / deprecated_or_inactive: não governa o caminho worker → evolutionSafeSender.
 *
 * Caminho real: dispatch_items → dispatchWorker → evolutionSafeSender → instance_send_guard → Evolution
 */
import { pool } from '../database';
import { getDispatchRuntimeSnapshot } from './dispatchRuntimeConfig';
import { getEvolutionCadenceSnapshot, maskPhone } from './evolutionSafeSender';
import {
  getWhatsAppValidationBatchSize,
  isWhatsAppAutoValidateOnPrepare,
  isWhatsAppAutoValidateOnWorker,
} from './listAudienceResolver';

export type ConfigClassification =
  | 'MANTER_EDITAVEL'
  | 'MANTER_SOMENTE_LEITURA'
  | 'MOVER_PARA_COMPATIBILIDADE'
  | 'REMOVER_DA_TELA';

export type ConfigSource = 'env' | 'database' | 'runtime';

export interface ConfigEntry {
  key: string;
  label: string;
  value: string | number | boolean | null;
  source: ConfigSource;
  editable: boolean;
  classification: ConfigClassification;
  note?: string;
}

function envEntry(
  key: string,
  label: string,
  value: string | number | boolean,
  note?: string
): ConfigEntry {
  return {
    key,
    label,
    value,
    source: 'env',
    editable: false,
    classification: 'MANTER_SOMENTE_LEITURA',
    note,
  };
}

/** Regras de blindage_rules usadas por applyBlindage (não pelo worker de campanha). */
const COMPAT_RULE_TYPES = new Set([
  'message_delay',
  'message_limit',
  'instance_rotation',
  'allowed_hours',
  'health_check',
  'content_validation',
  'number_validation',
  'instance_selection',
]);

/** Presentes no banco/UI antiga, mas sem efeito no worker nem em applyBlindage. */
const INACTIVE_FOR_WORKER_RULE_TYPES = new Set(['dispatch_pacing']);

function parseConfig(config: unknown): Record<string, unknown> {
  if (config == null) return {};
  if (typeof config === 'string') {
    try {
      return JSON.parse(config);
    } catch {
      return {};
    }
  }
  if (typeof config === 'object' && !Array.isArray(config)) {
    return config as Record<string, unknown>;
  }
  return {};
}

export async function getWorkerConfigSnapshot() {
  const runtime = getDispatchRuntimeSnapshot();
  const cadence = getEvolutionCadenceSnapshot();

  const runtime_flags: ConfigEntry[] = [
    envEntry('DISPATCH_WORKER_ENABLED', 'Worker ligado', runtime.workerEnabled),
    envEntry('DISPATCH_REAL_SEND_ENABLED', 'Envio real', runtime.realSendEnabled),
    envEntry('DISPATCH_DRY_RUN_ENABLED', 'Dry-run', runtime.dryRunEnabled),
    envEntry('DISPATCH_WORKER_BATCH_SIZE', 'Tamanho do lote', runtime.batchSize, 'Itens claimados por tick'),
    envEntry(
      'DISPATCH_WORKER_INTERVAL_MS',
      'Intervalo do worker (ms)',
      runtime.intervalMs,
      'Pausa entre ticks do worker'
    ),
  ];

  const cadence_flags: ConfigEntry[] = [
    envEntry('EVOLUTION_MIN_DELAY_MS', 'Delay mínimo entre envios (ms)', cadence.min_delay_ms),
    envEntry('EVOLUTION_MAX_DELAY_MS', 'Delay máximo entre envios (ms)', cadence.max_delay_ms),
    envEntry('EVOLUTION_SEND_TIMEOUT_MS', 'Timeout de envio (ms)', cadence.send_timeout_ms),
    envEntry(
      'EVOLUTION_COOLDOWN_RATE_LIMIT_MS',
      'Cooldown após rate limit (ms)',
      cadence.cooldown_rate_limit_ms
    ),
    envEntry(
      'EVOLUTION_COOLDOWN_FORBIDDEN_MS',
      'Cooldown após 403 (ms)',
      cadence.cooldown_forbidden_ms
    ),
    envEntry('EVOLUTION_COOLDOWN_5XX_MS', 'Cooldown após 5xx (ms)', cadence.cooldown_5xx_ms),
    envEntry(
      'EVOLUTION_COOLDOWN_NETWORK_MS',
      'Cooldown após erro de rede (ms)',
      cadence.cooldown_network_ms
    ),
    envEntry(
      'EVOLUTION_COOLDOWN_DEFAULT_MS',
      'Cooldown padrão (ms)',
      cadence.cooldown_default_ms
    ),
    envEntry(
      'DISPATCH_WORKER_BATCH_SIZE',
      'Limite por lote (worker)',
      runtime.batchSize,
      'Mesmo valor do runtime — worker não usa pacing de blindage_rules'
    ),
    envEntry(
      'DISPATCH_WORKER_INTERVAL_MS',
      'Pausa entre lotes/ticks (worker)',
      runtime.intervalMs
    ),
  ];

  const whatsapp_validation: ConfigEntry[] = [
    envEntry(
      'WHATSAPP_AUTO_VALIDATE_ON_PREPARE',
      'Auto-validar no prepare',
      isWhatsAppAutoValidateOnPrepare()
    ),
    envEntry(
      'WHATSAPP_AUTO_VALIDATE_ON_WORKER',
      'Auto-validar no worker',
      isWhatsAppAutoValidateOnWorker()
    ),
    envEntry(
      'WHATSAPP_VALIDATION_BATCH_SIZE',
      'Tamanho do lote de validação',
      getWhatsAppValidationBatchSize()
    ),
  ];

  const instances = await pool.query(
    `SELECT i.id, i.instance_name, i.name, i.status, i.health_status, i.phone_number,
            g.next_available_at, g.last_sent_at, g.cooldown_until,
            g.daily_sent_count, g.hourly_sent_count, g.violation_count
     FROM instances i
     LEFT JOIN instance_send_guard g ON g.instance_id = i.id
     ORDER BY i.id ASC`
  );

  const instance_guards = instances.rows.map((row) => ({
    classification: 'MANTER_SOMENTE_LEITURA' as ConfigClassification,
    source: 'database' as ConfigSource,
    editable: false,
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
    // instance_send_guard não tem last_error — não inventar coluna
    last_error: null as string | null,
  }));

  const rulesResult = await pool.query(
    `SELECT br.id, br.rule_type, br.rule_name, br.enabled, br.instance_id, br.config,
            i.instance_name
     FROM blindage_rules br
     LEFT JOIN instances i ON i.id = br.instance_id
     ORDER BY br.instance_id NULLS FIRST, br.rule_type, br.id`
  );

  const inherited_rules: Array<{
    classification: ConfigClassification;
    id: number;
    rule_type: string;
    rule_name: string;
    enabled: boolean;
    instance_id: number | null;
    instance_name: string | null;
    config_summary: Record<string, unknown>;
    note: string;
  }> = [];

  const deprecated_or_inactive_rules: Array<{
    classification: ConfigClassification;
    id: number;
    rule_type: string;
    rule_name: string;
    enabled: boolean;
    note: string;
  }> = [];

  for (const row of rulesResult.rows) {
    const cfg = parseConfig(row.config);
    // Evitar payload enorme: só chaves top-level
    const config_summary: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cfg)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        config_summary[k] = v;
      } else if (Array.isArray(v)) {
        config_summary[k] = `array(${v.length})`;
      } else if (v && typeof v === 'object') {
        config_summary[k] = 'object';
      }
    }

    if (INACTIVE_FOR_WORKER_RULE_TYPES.has(row.rule_type)) {
      deprecated_or_inactive_rules.push({
        classification: 'REMOVER_DA_TELA',
        id: row.id,
        rule_type: row.rule_type,
        rule_name: row.rule_name,
        enabled: !!row.enabled,
        note: 'Não aplicada pelo worker nem por applyBlindage no caminho de campanha. loadDispatchPacingRuntime existe, mas o worker não a chama.',
      });
      continue;
    }

    if (COMPAT_RULE_TYPES.has(row.rule_type)) {
      inherited_rules.push({
        classification: 'MOVER_PARA_COMPATIBILIDADE',
        id: row.id,
        rule_type: row.rule_type,
        rule_name: row.rule_name,
        enabled: !!row.enabled,
        instance_id: row.instance_id,
        instance_name: row.instance_name,
        config_summary,
        note: 'Usada apenas se applyBlindage for chamado (ex.: mensagem avulsa). Não governa dispatchWorker → evolutionSafeSender.',
      });
      continue;
    }

    deprecated_or_inactive_rules.push({
      classification: 'REMOVER_DA_TELA',
      id: row.id,
      rule_type: row.rule_type,
      rule_name: row.rule_name,
      enabled: !!row.enabled,
      note: 'Tipo de regra não reconhecido no motor novo de campanha.',
    });
  }

  return {
    path: 'dispatch_items → dispatchWorker → evolutionSafeSender → instance_send_guard → Evolution',
    classification_legend: {
      MANTER_EDITAVEL: 'Persistível e usada pelo worker/guard (nenhuma nesta tela — tudo ENV)',
      MANTER_SOMENTE_LEITURA: 'Afeta worker/guard; vem de ENV ou estado no banco',
      MOVER_PARA_COMPATIBILIDADE: 'blindage_rules ainda usadas por applyBlindage (avulsas)',
      REMOVER_DA_TELA: 'Sem efeito no caminho real de campanha',
    },
    runtime: runtime_flags,
    cadence: cadence_flags,
    whatsapp_validation,
    instances: instance_guards,
    inherited_rules,
    deprecated_or_inactive_rules,
    editable_count: 0,
    note: 'Todas as flags operacionais do worker são ENV (redeploy). Não há edição fake nesta API.',
  };
}
