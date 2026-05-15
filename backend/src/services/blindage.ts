import { pool } from '../database';
import axios from 'axios';
import { createHash } from 'crypto';
import { addLog } from '../routes/logs';
import { normalizePhoneDigits } from '../utils/phoneNumber';
import {
  getBlindageProfilePackage,
  BLINDAGE_PROFILES_META,
  isBlindageProfileId,
} from './blindageProfiles';

export { BLINDAGE_PROFILES_META, isBlindageProfileId, getBlindageProfilePackage } from './blindageProfiles';

const DEFAULT_BLINDAGE_TIMEZONE = 'America/Sao_Paulo';

/** Config JSONB pode vir como objeto ou string do PostgreSQL */
function parseRuleConfig(config: unknown): Record<string, any> {
  if (config == null) return {};
  if (typeof config === 'string') {
    try {
      return JSON.parse(config);
    } catch {
      return {};
    }
  }
  if (typeof config === 'object' && !Array.isArray(config)) {
    return config as Record<string, any>;
  }
  return {};
}

function normalizeRuleRow(row: any): BlindageRule {
  return { ...row, config: parseRuleConfig(row.config) };
}

/**
 * Configuração canônica por `rule_type` (fonte única para INSERT inicial e reconciliação).
 * Reconciliação só adiciona chaves ausentes; não sobrescreve valores já definidos.
 */
export const BLINDAGE_CANONICAL_CONFIGS: Record<string, Record<string, any>> = {
  message_delay: {
    min_delay_seconds: 5,
    max_delay_seconds: 45,
    progressive: true,
    base_delay: 5,
    increment_per_message: 0.5,
    jitter_min_ms: 150,
    jitter_max_ms: 450,
  },
  message_limit: {
    max_per_hour: 40,
    max_per_day: 400,
    reset_hour: 0,
    reset_day: 1,
    /** Intervalo mínimo entre envios ao mesmo destinatário (minutos). 0 = desligado. */
    min_minutes_between_same_recipient: 0,
    /** Limites opcionais por tipo lógico de envio (chaves: devocional, marketing, avulsa, …). */
    limits_by_message_type: {} as Record<string, { max_per_hour?: number; max_per_day?: number }>,
  },
  instance_rotation: {
    enabled: true,
    min_delay_between_instances: 3,
    round_robin: true,
    /** A cada N envios com sucesso no mesmo disparo, prefere a próxima instância (0 = desligado). */
    rotate_every_n_messages: 50,
  },
  allowed_hours: {
    allowed_hours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    blocked_hours: [22, 23, 0, 1, 2, 3, 4, 5, 6, 7],
    timezone: 'America/Sao_Paulo',
  },
  health_check: {
    pause_if_degraded: true,
    pause_if_down: true,
    check_interval_seconds: 60,
  },
  content_validation: {
    max_length: 4096,
    blocked_words: [],
    /** Anti-repetição de texto (usa histórico recente por tipo de envio). Desligado por padrão. */
    repetition_enabled: false,
    repetition_window: 20,
    /** Com anti-repetição ligada: 100 = só bloqueia cópia exata (mais seguro sem spintax). */
    repetition_alert_percent: 100,
  },
  number_validation: {
    validate_format: true,
    check_whatsapp: true,
    require_whatsapp_check: false,
    default_country_code: '55',
    cache_hours: 24,
    timeout_ms: 10000,
  },
  instance_selection: {
    selected_instance_ids: [],
    max_simultaneous: 1,
    auto_switch_on_failure: true,
    retry_after_pause: true,
  },
  dispatch_pacing: {
    enabled: true,
    messages_per_batch: 20,
    pause_between_batches_minutes: 15,
    long_pause_every_n_messages: 30,
    long_pause_minutes: 60,
  },
};

function mergeMissingDeep(
  target: Record<string, any>,
  defaults: Record<string, any>
): Record<string, any> {
  const out: Record<string, any> = JSON.parse(JSON.stringify(target || {}));
  const def: Record<string, any> = JSON.parse(JSON.stringify(defaults || {}));
  for (const key of Object.keys(def)) {
    const d = def[key];
    const t = out[key];
    if (!(key in out) || t === undefined) {
      out[key] = d;
      continue;
    }
    if (
      d !== null &&
      typeof d === 'object' &&
      !Array.isArray(d) &&
      t !== null &&
      typeof t === 'object' &&
      !Array.isArray(t)
    ) {
      out[key] = mergeMissingDeep(t, d);
    }
  }
  return out;
}

function stableConfigString(obj: Record<string, any>): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((x) => stableConfigString(x)).join(',')}]`;
  }
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableConfigString(obj[k])}`).join(',')}}`;
}

/** Ajustes mínimos de consistência numérica (opcional, `strict` na reconciliação). */
function sanitizeBlindageConfigStrict(ruleType: string, cfg: Record<string, any>): Record<string, any> {
  const c = { ...cfg };
  if (ruleType === 'message_delay') {
    const min = Number(c.min_delay_seconds);
    if (Number.isFinite(min) && min < 0.5) {
      c.min_delay_seconds = 0.5;
    }
    const minS = Number(c.min_delay_seconds);
    const maxS = Number(c.max_delay_seconds);
    if (Number.isFinite(minS) && Number.isFinite(maxS) && maxS > 0 && maxS < minS) {
      c.max_delay_seconds = Math.max(minS * 2, 45);
    }
    let jMin = Number(c.jitter_min_ms);
    let jMax = Number(c.jitter_max_ms);
    if (Number.isFinite(jMin) && Number.isFinite(jMax) && jMax < jMin) {
      const swap = jMin;
      jMin = jMax;
      jMax = swap;
      c.jitter_min_ms = jMin;
      c.jitter_max_ms = jMax;
    }
  }
  return c;
}

export interface ReconcileBlindageOptions {
  /** Se true, não grava no banco; só retorna o que mudaria. */
  dryRun?: boolean;
  /** Aplica `sanitizeBlindageConfigStrict` após o merge de chaves ausentes. */
  strict?: boolean;
}

export interface ReconcileBlindageResult {
  updated: number;
  unchanged: number;
  skippedUnknownType: number;
  details: Array<{
    id: number;
    rule_type: string;
    instance_id: number | null;
    changed: boolean;
  }>;
}

/**
 * Reconcilia `config` JSONB de todas as linhas em `blindage_rules` com o template canônico
 * do respectivo `rule_type` (merge profundo apenas de chaves ausentes).
 *
 * Variáveis de ambiente (startup em `index.ts`):
 * - `BLINDAGE_RECONCILE_ON_STARTUP` — se `false`, não roda no boot (default: roda).
 * - `BLINDAGE_RECONCILE_STRICT` — se `true`, aplica saneamento numérico após o merge.
 */
export async function reconcileBlindageRuleConfigs(
  options: ReconcileBlindageOptions = {}
): Promise<ReconcileBlindageResult> {
  const { dryRun = false, strict = false } = options;
  const result: ReconcileBlindageResult = {
    updated: 0,
    unchanged: 0,
    skippedUnknownType: 0,
    details: [],
  };

  const rows = await pool.query(
    `SELECT id, instance_id, rule_type, config FROM blindage_rules ORDER BY id`
  );

  for (const row of rows.rows) {
    const ruleType = row.rule_type as string;
    const template = BLINDAGE_CANONICAL_CONFIGS[ruleType];
    if (!template) {
      result.skippedUnknownType += 1;
      result.details.push({
        id: row.id,
        rule_type: ruleType,
        instance_id: row.instance_id,
        changed: false,
      });
      continue;
    }

    let current = parseRuleConfig(row.config);
    let merged = mergeMissingDeep(current, template);
    if (strict) {
      merged = sanitizeBlindageConfigStrict(ruleType, merged);
    }

    const before = stableConfigString(current);
    const after = stableConfigString(merged);
    const changed = before !== after;

    result.details.push({
      id: row.id,
      rule_type: ruleType,
      instance_id: row.instance_id,
      changed,
    });

    if (!changed) {
      result.unchanged += 1;
      continue;
    }

    result.updated += 1;
    if (!dryRun) {
      await pool.query(`UPDATE blindage_rules SET config = $1::jsonb WHERE id = $2`, [
        JSON.stringify(merged),
        row.id,
      ]);
    }
  }

  const msg = `[Blindage] Reconciliação: ${result.updated} atualizadas, ${result.unchanged} inalteradas, ${result.skippedUnknownType} tipos sem template${dryRun ? ' (dry-run)' : ''}${strict ? ' (strict)' : ''}`;
  console.log(`✅ ${msg}`);
  addLog('info', msg);
  return result;
}

/**
 * Fuso horário de referência para limites e delay progressivo:
 * usa a regra `allowed_hours` se existir; senão padrão SP.
 */
function getBlindageTimezoneFromRules(rules: BlindageRule[]): string {
  const timeRule = rules.find((r) => r.rule_type === 'allowed_hours');
  const cfg = timeRule ? parseRuleConfig(timeRule.config) : {};
  return typeof cfg.timezone === 'string' && cfg.timezone.trim()
    ? cfg.timezone.trim()
    : DEFAULT_BLINDAGE_TIMEZONE;
}

function formatCalendarDateInTimezone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function getCalendarHourInTimezone(d: Date, timeZone: string): number {
  return parseInt(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    })
      .formatToParts(d)
      .find((p) => p.type === 'hour')?.value || '0',
    10
  );
}

export interface BlindageRule {
  id: number;
  instance_id: number | null;
  rule_name: string;
  rule_type: string;
  enabled: boolean;
  config: any;
}

export interface BlindageResult {
  canSend: boolean;
  delay?: number;
  selectedInstanceId?: number;
  reason?: string;
  blockedBy?: string;
}

/**
 * Sistema de Blindagem Global
 * Aplica blindagens a TODAS as mensagens antes do envio
 */

/**
 * Busca regras ativas: globais (`instance_id IS NULL`) + regras da instância `forInstanceId` (se informada).
 * Por `rule_type`, a regra **da instância sobrescreve** a global (última vence na ordenação).
 */
export async function getActiveRules(forInstanceId?: number | null): Promise<BlindageRule[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM blindage_rules
       WHERE enabled = TRUE
         AND (
           instance_id IS NULL
           OR ($1::int IS NOT NULL AND instance_id = $1)
         )
       ORDER BY rule_type, (instance_id IS NULL) DESC, id ASC`,
      [forInstanceId ?? null]
    );

    const byType = new Map<string, BlindageRule>();
    for (const row of result.rows) {
      const r = normalizeRuleRow(row);
      byType.set(r.rule_type, r);
    }
    const merged = Array.from(byType.values());

    if (merged.length === 0) {
      console.log(`   ⚠️ Nenhuma regra de blindagem ativa encontrada`);
      addLog('warning', `[Blindage] Nenhuma regra ativa (global${forInstanceId ? ` + instância ${forInstanceId}` : ''})`);
    } else {
      console.log(
        `   📋 ${merged.length} regra(s) ativa(s): ${merged.map((r) => r.rule_type).join(', ')}`
      );
      addLog(
        'debug',
        `[Blindage] Regras ativas: ${merged.map((r) => r.rule_type).join(', ')}`
      );
    }

    return merged;
  } catch (error) {
    console.error('Erro ao buscar regras de blindagem:', error);
    addLog('error', `[Blindage] Erro ao buscar regras: ${error}`);
    return [];
  }
}

/**
 * Aplica todas as blindagens antes de enviar mensagem.
 * Ordem: validações com regras globais + preferência → seleção de instância →
 * regras efetivas (global + instância escolhida) para limites, horário e delay.
 */
export async function applyBlindage(messageData: {
  to: string;
  message: string;
  instanceId?: number;
  messageType?: string;
}): Promise<BlindageResult> {
  try {
    const messageCategory = (messageData.messageType?.trim() || 'avulsa').slice(0, 48) || 'avulsa';
    const rulesPass1 = await getActiveRules(messageData.instanceId ?? undefined);

    const numberValidation = await validatePhoneNumber(
      messageData.to,
      messageData.instanceId,
      rulesPass1
    );
    if (!numberValidation.canSend) {
      return numberValidation;
    }

    const cooldownCheck = await checkRecipientCooldown(
      messageData.to,
      rulesPass1,
      messageData.instanceId ?? null
    );
    if (!cooldownCheck.canSend) {
      return cooldownCheck;
    }

    const contentValidation = await validateContent(
      messageData.message,
      rulesPass1,
      messageData.instanceId ?? null,
      messageCategory
    );
    if (!contentValidation.canSend) {
      return contentValidation;
    }

    const instanceSelection = await selectInstance(messageData.instanceId, rulesPass1);
    if (!instanceSelection.canSend) {
      return instanceSelection;
    }

    const selectedId = instanceSelection.selectedInstanceId!;
    const rules = await getActiveRules(selectedId);

    const healthCheck = await checkInstanceHealth(selectedId, rules);
    if (!healthCheck.canSend) {
      return healthCheck;
    }

    const limitCheck = await checkLimits(selectedId, rules, messageCategory);
    if (!limitCheck.canSend) {
      return limitCheck;
    }

    const timeCheck = await checkAllowedHours(selectedId, rules);
    if (!timeCheck.canSend) {
      return timeCheck;
    }

    const delay = await calculateDelay(selectedId, rules);

    let totalDelay = delay;
    if (instanceSelection.delay && instanceSelection.delay > 0) {
      totalDelay = delay + instanceSelection.delay;
      console.log(
        `   🔄 Delay entre instâncias: ${instanceSelection.delay}ms | Delay global: ${delay}ms | Total: ${totalDelay}ms`
      );
      addLog(
        'info',
        `[Blindage] Delay entre instâncias: ${instanceSelection.delay}ms + Delay global: ${delay}ms = Total: ${totalDelay}ms`
      );
    }

    await logBlindageAction(selectedId, {
      action_type: 'blindage_applied',
      delay_applied: totalDelay,
      rules_applied: rules.map((r) => r.rule_type),
    });

    return {
      canSend: true,
      delay: totalDelay,
      selectedInstanceId: selectedId,
    };
  } catch (error: any) {
    console.error('Erro ao aplicar blindagem:', error);
    return {
      canSend: false,
      reason: `Erro ao aplicar blindagem: ${error.message}`,
      blockedBy: 'system_error',
    };
  }
}

/**
 * Valida número de telefone e verifica se está no WhatsApp
 */
async function validatePhoneNumber(
  phoneNumber: string,
  instanceId: number | undefined,
  rules: BlindageRule[]
): Promise<BlindageResult> {
  const numberValidationRule = rules.find(r => r.rule_type === 'number_validation');
  if (!numberValidationRule || !numberValidationRule.enabled) {
    return { canSend: true };
  }

  const config = parseRuleConfig(numberValidationRule.config);

  const countryCode = String(config.default_country_code || '55').replace(/\D/g, '') || '55';
  const numberToCheck = normalizePhoneDigits(phoneNumber, countryCode);
  const normalizedNumber = numberToCheck ? `+${numberToCheck}` : '';

  // 1. Validar formato do número (E.164)
  if (config.validate_format !== false) {
    // Validar formato E.164 básico: +[1-9][0-9]{1,14}
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    if (!e164Regex.test(normalizedNumber)) {
      await logBlindageAction(instanceId ?? null, {
        action_type: 'number_blocked',
        reason: 'invalid_format',
        phone_number: phoneNumber,
        normalized_number: normalizedNumber,
      }, numberValidationRule.id);

      return {
        canSend: false,
        reason: `Número com formato inválido: ${phoneNumber}`,
        blockedBy: 'number_validation',
      };
    }
  }

  // 2. Verificar se número está no WhatsApp (se configurado)
  if (config.check_whatsapp !== false) {
    try {
      // Buscar instância para usar na verificação
      let instanceForCheck = instanceId;
      if (!instanceForCheck) {
        // Se não tem instância específica, buscar uma conectada
        const instanceResult = await pool.query(
          `SELECT id, instance_name, api_url, api_key 
           FROM instances 
           WHERE status = 'connected' 
           LIMIT 1`
        );
        if (instanceResult.rows.length === 0) {
          // Se não há instância conectada, permitir envio (fallback)
          if (config.require_whatsapp_check === true) {
            return {
              canSend: false,
              reason: 'Nenhuma instância conectada para verificar número',
              blockedBy: 'number_validation',
            };
          }
          return { canSend: true };
        }
        instanceForCheck = instanceResult.rows[0].id;
      }

      const logInstanceId: number | null = instanceForCheck ?? instanceId ?? null;
      const instanceResult = await pool.query(
        `SELECT instance_name, api_url, api_key 
         FROM instances 
         WHERE id = $1`,
        [instanceForCheck]
      );

      if (instanceResult.rows.length === 0) {
        return {
          canSend: false,
          reason: 'Instância não encontrada',
          blockedBy: 'number_validation',
        };
      }

      const instance = instanceResult.rows[0];
      const evolutionApiUrl = process.env.EVOLUTION_API_URL || instance.api_url;
      const evolutionApiKey = process.env.EVOLUTION_API_KEY || instance.api_key;

      // Verificar cache primeiro
      const cacheResult = await pool.query(
        `SELECT is_valid, checked_at 
         FROM number_validation_cache 
         WHERE phone_number = $1 
           AND checked_at > NOW() - INTERVAL '${config.cache_hours || 24} hours'`,
        [numberToCheck]
      );

      let isValid = false;
      if (cacheResult.rows.length > 0) {
        isValid = cacheResult.rows[0].is_valid;
        console.log(`   ✅ Número verificado no cache: ${numberToCheck} = ${isValid ? 'válido' : 'inválido'}`);
      } else {
        // Verificar via Evolution API
        try {
          // Evolution API endpoint para verificar números
          // Tentar diferentes endpoints possíveis
          let checkUrl = `${evolutionApiUrl}/chat/whatsappNumbers/${instance.instance_name}`;
          let checkResponse: any;
          
          try {
            // Tentar endpoint POST com array de números
            checkResponse = await axios.post(
              checkUrl,
              {
                numbers: [numberToCheck],
              },
              {
                headers: {
                  'apikey': evolutionApiKey,
                  'Content-Type': 'application/json',
                },
                timeout: config.timeout_ms || 10000,
                validateStatus: () => true,
              }
            );
          } catch (postError: any) {
            // Se POST falhar, tentar GET com query parameter
            if (postError.response?.status === 404 || postError.code === 'ECONNREFUSED') {
              checkUrl = `${evolutionApiUrl}/chat/whatsappNumbers/${instance.instance_name}?numbers=${numberToCheck}`;
              checkResponse = await axios.get(checkUrl, {
                headers: {
                  'apikey': evolutionApiKey,
                },
                timeout: config.timeout_ms || 10000,
                validateStatus: () => true,
              });
            } else {
              throw postError;
            }
          }

          // Evolution API: só considerar válido/inválido com evidência explícita no corpo.
          let gotExplicitResult = false;
          if (checkResponse && checkResponse.data) {
            if (Array.isArray(checkResponse.data)) {
              const numberStatus = checkResponse.data.find((n: any) =>
                n.jid === `${numberToCheck}@s.whatsapp.net` ||
                n.number === numberToCheck ||
                n.jid?.includes(numberToCheck)
              );
              if (numberStatus != null) {
                gotExplicitResult = true;
                isValid =
                  numberStatus.exists === true ||
                  numberStatus.status === 'valid' ||
                  numberStatus.onWhatsApp === true ||
                  numberStatus.isWhatsApp === true;
              }
            } else if (checkResponse.data.exists !== undefined) {
              gotExplicitResult = true;
              isValid = checkResponse.data.exists === true;
            }
          }

          if (!gotExplicitResult) {
            const httpStatus = checkResponse?.status ?? 'n/a';
            console.log(
              `   ⚠️ Evolution não retornou confirmação explícita de WhatsApp para ${numberToCheck} (HTTP ${httpStatus}) — não cacheando.`
            );
            if (config.require_whatsapp_check === true) {
              await logBlindageAction(logInstanceId, {
                action_type: 'number_check_failed',
                reason: 'ambiguous_or_unparsed_response',
                phone_number: numberToCheck,
                http_status: httpStatus,
              }, numberValidationRule.id);
              return {
                canSend: false,
                reason:
                  'Não foi possível confirmar se o número está no WhatsApp (resposta da API sem campos esperados).',
                blockedBy: 'number_validation',
              };
            }
            return { canSend: true };
          }

          if (gotExplicitResult) {
            await pool.query(
              `INSERT INTO number_validation_cache (phone_number, is_valid, checked_at)
               VALUES ($1, $2, CURRENT_TIMESTAMP)
               ON CONFLICT (phone_number) 
               DO UPDATE SET is_valid = $2, checked_at = CURRENT_TIMESTAMP`,
              [numberToCheck, isValid]
            );
          }

          console.log(
            `   ${isValid ? '✅' : '❌'} Número verificado via API: ${numberToCheck} = ${isValid ? 'válido' : 'inválido'}`
          );
        } catch (apiError: any) {
          console.error('   ⚠️ Erro ao verificar número via Evolution API:', apiError.message);
          
          // Se falhar e não for obrigatório, permitir envio
          if (config.require_whatsapp_check !== true) {
            console.log('   ⚠️ Verificação falhou, mas permitindo envio (não obrigatório)');
            return { canSend: true };
          }

          await logBlindageAction(logInstanceId, {
            action_type: 'number_check_failed',
            reason: 'api_error',
            phone_number: numberToCheck,
            error: apiError.message,
          }, numberValidationRule.id);

          return {
            canSend: false,
            reason: `Erro ao verificar número no WhatsApp: ${apiError.message}`,
            blockedBy: 'number_validation',
          };
        }
      }

      if (!isValid) {
        await logBlindageAction(logInstanceId, {
          action_type: 'number_blocked',
          reason: 'not_on_whatsapp',
          phone_number: numberToCheck,
        }, numberValidationRule.id);

        return {
          canSend: false,
          reason: `Número ${numberToCheck} não está registrado no WhatsApp`,
          blockedBy: 'number_validation',
        };
      }
    } catch (error: any) {
      console.error('Erro ao validar número:', error);
      
      // Se não for obrigatório, permitir envio
      if (config.require_whatsapp_check !== true) {
        return { canSend: true };
      }

      return {
        canSend: false,
        reason: `Erro ao validar número: ${error.message}`,
        blockedBy: 'number_validation',
      };
    }
  }

  return { canSend: true };
}

function normalizeBodyForFingerprint(body: string): string {
  return String(body || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function sha256HexUtf8(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function wordTokenSet(text: string): Set<string> {
  const parts = text
    .toLowerCase()
    .split(/[^a-z0-9áàâãéêíóôõúç]+/iu)
    .filter(Boolean);
  return new Set(parts);
}

function jaccardSimilarityWords(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) {
    if (b.has(w)) inter++;
  }
  const u = a.size + b.size - inter;
  return u === 0 ? 0 : inter / u;
}

/** Chave estável para cooldown por destinatário (apenas dígitos, até 15 finais). */
export function recipientCooldownKey(raw: string): string {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  return d.length > 15 ? d.slice(-15) : d;
}

async function checkRecipientCooldown(
  rawTo: string,
  rules: BlindageRule[],
  logInstanceId?: number | null
): Promise<BlindageResult> {
  const limitRule = rules.find((r) => r.rule_type === 'message_limit');
  if (!limitRule || !limitRule.enabled) {
    return { canSend: true };
  }
  const cfg = parseRuleConfig(limitRule.config);
  const minM = Number(cfg.min_minutes_between_same_recipient);
  if (!Number.isFinite(minM) || minM <= 0) {
    return { canSend: true };
  }

  const key = recipientCooldownKey(rawTo);
  if (!key || key.length < 8) {
    return { canSend: true };
  }

  const row = await pool.query(
    `SELECT last_sent_at FROM blindage_recipient_send_log WHERE recipient_key = $1`,
    [key]
  );
  if (!row.rows[0]?.last_sent_at) {
    return { canSend: true };
  }
  const last = new Date(row.rows[0].last_sent_at).getTime();
  const elapsedMin = (Date.now() - last) / 60000;
  if (elapsedMin >= minM) {
    return { canSend: true };
  }

  const waitMin = Math.max(0, minM - elapsedMin);
  await logBlindageAction(logInstanceId ?? null, {
    action_type: 'recipient_cooldown_blocked',
    recipient_key: key,
    min_minutes: minM,
    elapsed_minutes: Math.round(elapsedMin * 100) / 100,
    wait_minutes: Math.round(waitMin * 100) / 100,
  }, limitRule.id);

  return {
    canSend: false,
    reason: `Aguarde ~${Math.ceil(waitMin)} min para reenviar ao mesmo número (cooldown de ${minM} min).`,
    blockedBy: 'message_limit',
  };
}

/**
 * Valida conteúdo da mensagem
 */
async function validateContent(
  message: string,
  rules: BlindageRule[],
  logContextInstanceId?: number | null,
  messageCategory: string = 'avulsa'
): Promise<BlindageResult> {
  const contentRule = rules.find((r) => r.rule_type === 'content_validation');
  if (!contentRule || !contentRule.enabled) {
    return { canSend: true };
  }

  const config = parseRuleConfig(contentRule.config);
  const logInstanceId = (contentRule.instance_id as number | null) ?? logContextInstanceId ?? null;

  // Verificar tamanho máximo
  if (config.max_length && message.length > config.max_length) {
    await logBlindageAction(logInstanceId, {
      action_type: 'content_blocked',
      reason: 'message_too_long',
      message_length: message.length,
      max_length: config.max_length,
    }, contentRule.id);

    return {
      canSend: false,
      reason: `Mensagem muito longa (${message.length} caracteres, máximo: ${config.max_length})`,
      blockedBy: 'content_validation',
    };
  }

  // Verificar palavras bloqueadas
  if (config.blocked_words && Array.isArray(config.blocked_words)) {
    const lowerMessage = message.toLowerCase();
    for (const word of config.blocked_words) {
      if (lowerMessage.includes(word.toLowerCase())) {
        await logBlindageAction(logInstanceId, {
          action_type: 'content_blocked',
          reason: 'blocked_word',
          word: word,
        }, contentRule.id);

        return {
          canSend: false,
          reason: `Mensagem contém palavra bloqueada: ${word}`,
          blockedBy: 'content_validation',
        };
      }
    }
  }

  if (config.repetition_enabled === true && messageCategory !== 'devocional') {
    const scope = String(messageCategory || 'avulsa').trim().slice(0, 48) || 'avulsa';
    const window = Math.min(80, Math.max(5, Number(config.repetition_window) || 20));
    let pct = Number(config.repetition_alert_percent);
    if (!Number.isFinite(pct)) pct = 100;
    pct = Math.min(100, Math.max(50, pct));

    const normalized = normalizeBodyForFingerprint(message);
    if (normalized.length >= 8) {
      const newHash = sha256HexUtf8(normalized);
      const recent = await pool.query(
        `SELECT body_hash, normalized_preview
         FROM blindage_sent_content_recent
         WHERE scope = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [scope, window]
      );

      const newTokens = wordTokenSet(normalized);
      for (const row of recent.rows) {
        if (row.body_hash === newHash) {
          await logBlindageAction(logInstanceId, {
            action_type: 'repetition_blocked',
            reason: 'exact_duplicate',
            scope,
          }, contentRule.id);
          return {
            canSend: false,
            reason: 'Mensagem idêntica a um envio recente deste tipo (anti-repetição).',
            blockedBy: 'content_validation',
          };
        }
        if (pct < 100 && row.normalized_preview) {
          const sim = jaccardSimilarityWords(newTokens, wordTokenSet(String(row.normalized_preview)));
          if (sim >= pct / 100) {
            await logBlindageAction(logInstanceId, {
              action_type: 'repetition_blocked',
              reason: 'similar_content',
              scope,
              similarity: Math.round(sim * 1000) / 1000,
              threshold: pct / 100,
            }, contentRule.id);
            return {
              canSend: false,
              reason: `Conteúdo muito parecido com envio recente (similaridade ${Math.round(sim * 100)}%, mínimo exigido ${pct}%).`,
              blockedBy: 'content_validation',
            };
          }
        }
      }
    }
  }

  return { canSend: true };
}

/**
 * Seleciona instância para envio (seleção + rotação)
 */
async function selectInstance(
  preferredInstanceId: number | undefined,
  rules: BlindageRule[]
): Promise<BlindageResult> {
  // Verificar regra de seleção de instâncias
  const selectionRule = rules.find(r => r.rule_type === 'instance_selection');
  let availableInstanceIds: number[] = [];
  
  if (selectionRule && selectionRule.enabled) {
    const parsedConfig = parseRuleConfig(selectionRule.config);
    const selectedIds = Array.isArray(parsedConfig.selected_instance_ids) ? parsedConfig.selected_instance_ids : [];
    
    console.log(`🔍 Regra de seleção encontrada. IDs selecionados:`, selectedIds);
    
    if (selectedIds.length > 0) {
      // Usar apenas instâncias selecionadas
      const result = await pool.query(
        `SELECT id FROM instances 
         WHERE id = ANY($1::int[]) 
           AND status = 'connected'
         ORDER BY id`,
        [selectedIds]
      );
      availableInstanceIds = result.rows.map((r: any) => r.id);
      console.log(`✅ Instâncias disponíveis (selecionadas):`, availableInstanceIds);
    } else {
      // Se nenhuma selecionada, usar todas as conectadas
      const result = await pool.query(
        `SELECT id FROM instances WHERE status = 'connected' ORDER BY id`
      );
      availableInstanceIds = result.rows.map((r: any) => r.id);
      console.log(`✅ Instâncias disponíveis (todas conectadas):`, availableInstanceIds);
    }
  } else {
    // Sem regra de seleção, usar todas as conectadas
    const result = await pool.query(
      `SELECT id FROM instances WHERE status = 'connected' ORDER BY id`
    );
    availableInstanceIds = result.rows.map((r: any) => r.id);
    console.log(`⚠️ Sem regra de seleção, usando todas conectadas:`, availableInstanceIds);
  }
  
  if (availableInstanceIds.length === 0) {
    return {
      canSend: false,
      reason: 'Nenhuma instância conectada disponível',
      blockedBy: 'instance_selection',
    };
  }
  
  // Se há instância preferida e ela está disponível, usar ela
  if (preferredInstanceId && availableInstanceIds.includes(preferredInstanceId)) {
    return {
      canSend: true,
      selectedInstanceId: preferredInstanceId,
    };
  }
  
  // Verificar regra de rotação
  const rotationRule = rules.find(r => r.rule_type === 'instance_rotation');
  if (!rotationRule || !rotationRule.enabled) {
    // Sem rotação, usar primeira disponível
    return {
      canSend: true,
      selectedInstanceId: availableInstanceIds[0],
    };
  }

  const config = parseRuleConfig(rotationRule.config);
  
  // Buscar instâncias disponíveis com informações de uso
  const instancesResult = await pool.query(
    `SELECT id, name, instance_name, last_message_sent_at 
     FROM instances 
     WHERE id = ANY($1::int[])
       AND status = 'connected'
     ORDER BY 
       COALESCE(last_message_sent_at, '1970-01-01'::timestamp) ASC,
       id ASC`,
    [availableInstanceIds]
  );

  if (instancesResult.rows.length === 0) {
    return {
      canSend: false,
      reason: 'Nenhuma instância conectada disponível',
      blockedBy: 'instance_rotation',
    };
  }

  // Selecionar instância com menos mensagens recentes
  const selectedInstance = instancesResult.rows[0];
  
  console.log(`   🔍 Instância selecionada: ${selectedInstance.id} (${selectedInstance.name || selectedInstance.instance_name})`);
  console.log(`   ⏱️ Última mensagem enviada: ${selectedInstance.last_message_sent_at || 'nunca'}`);
  
  // Verificar delay mínimo entre instâncias
  if (config.min_delay_between_instances) {
    console.log(`   🔄 Verificando delay entre instâncias (mínimo configurado: ${config.min_delay_between_instances}s)`);
    const lastSent = selectedInstance.last_message_sent_at;
    if (lastSent) {
      const secondsSinceLastSent = (Date.now() - new Date(lastSent).getTime()) / 1000;
      console.log(`   ⏱️ Tempo desde última mensagem: ${secondsSinceLastSent.toFixed(2)}s`);
      
      if (secondsSinceLastSent < config.min_delay_between_instances) {
        const delayNeeded = config.min_delay_between_instances - secondsSinceLastSent;
        const delayMs = Math.ceil(delayNeeded * 1000);
        const delayLog = `🔄 Delay entre instâncias necessário: ${delayNeeded.toFixed(2)}s (${delayMs}ms) para instância ${selectedInstance.id}`;
        console.log(`   ${delayLog}`);
        addLog('info', `[Blindage] ${delayLog}`);
        return {
          canSend: true,
          selectedInstanceId: selectedInstance.id,
          delay: delayMs, // em milissegundos
        };
      } else {
        console.log(`   ✅ Instância ${selectedInstance.id} pode enviar (${secondsSinceLastSent.toFixed(2)}s desde última mensagem, mínimo: ${config.min_delay_between_instances}s)`);
        addLog('debug', `[Blindage] Instância ${selectedInstance.id} pode enviar - ${secondsSinceLastSent.toFixed(2)}s desde última mensagem`);
      }
    } else {
      console.log(`   ✅ Instância ${selectedInstance.id} nunca enviou mensagem, sem delay entre instâncias necessário`);
      addLog('debug', `[Blindage] Instância ${selectedInstance.id} nunca enviou mensagem, sem delay necessário`);
    }
  } else {
    console.log(`   ℹ️ Delay entre instâncias não configurado na regra de rotação`);
  }

  return {
    canSend: true,
    selectedInstanceId: selectedInstance.id,
  };
}

/**
 * Verifica saúde da instância
 */
async function checkInstanceHealth(
  instanceId: number,
  rules: BlindageRule[]
): Promise<BlindageResult> {
  const healthRule = rules.find((r) => r.rule_type === 'health_check');
  if (!healthRule || !healthRule.enabled) {
    return { canSend: true };
  }

  const config = parseRuleConfig(healthRule.config);
  const pauseIfDown = config.pause_if_down !== false;
  const pauseIfDegraded = config.pause_if_degraded !== false;

  const instanceResult = await pool.query(
    `SELECT health_status, status FROM instances WHERE id = $1`,
    [instanceId]
  );

  if (instanceResult.rows.length === 0) {
    return {
      canSend: false,
      reason: 'Instância não encontrada',
      blockedBy: 'health_check',
    };
  }

  const instance = instanceResult.rows[0];

  if (instance.status !== 'connected') {
    await logBlindageAction(instanceId, {
      action_type: 'health_blocked',
      reason: 'instance_not_connected',
      status: instance.status,
      health_status: instance.health_status,
    }, healthRule.id);

    return {
      canSend: false,
      reason: `Instância não está conectada (status: ${instance.status})`,
      blockedBy: 'health_check',
    };
  }

  const hs = instance.health_status || 'healthy';

  if (hs === 'down' && pauseIfDown) {
    await logBlindageAction(instanceId, {
      action_type: 'health_blocked',
      reason: 'health_down',
      health_status: hs,
      status: instance.status,
    }, healthRule.id);
    return {
      canSend: false,
      reason: 'Instância com saúde "down" — envio pausado pela blindagem.',
      blockedBy: 'health_check',
    };
  }

  if (hs === 'degraded' && pauseIfDegraded) {
    await logBlindageAction(instanceId, {
      action_type: 'health_blocked',
      reason: 'health_degraded',
      health_status: hs,
      status: instance.status,
    }, healthRule.id);
    return {
      canSend: false,
      reason: 'Instância degradada — envio pausado pela blindagem.',
      blockedBy: 'health_check',
    };
  }

  return { canSend: true };
}

/**
 * Verifica limites de envio (por instância e tipo lógico: devocional, marketing, avulsa, …).
 * Conta em `messages` para alinhar com `dispatch_type` / `message_type`.
 */
function resolveLimitsForMessageType(
  config: Record<string, any>,
  messageCategory: string
): { maxHour: number | null; maxDay: number | null } {
  let maxHour = Number(config.max_per_hour);
  let maxDay = Number(config.max_per_day);
  const by = config.limits_by_message_type;
  if (by && typeof by === 'object' && by[messageCategory] && typeof by[messageCategory] === 'object') {
    const sub = by[messageCategory] as Record<string, unknown>;
    const sh = Number(sub.max_per_hour);
    const sd = Number(sub.max_per_day);
    if (Number.isFinite(sh) && sh > 0) maxHour = sh;
    if (Number.isFinite(sd) && sd > 0) maxDay = sd;
  }
  return {
    maxHour: Number.isFinite(maxHour) && maxHour > 0 ? maxHour : null,
    maxDay: Number.isFinite(maxDay) && maxDay > 0 ? maxDay : null,
  };
}

async function checkLimits(
  instanceId: number,
  rules: BlindageRule[],
  messageCategory: string = 'avulsa'
): Promise<BlindageResult> {
  const limitRule = rules.find((r) => r.rule_type === 'message_limit');
  if (!limitRule || !limitRule.enabled) {
    return { canSend: true };
  }

  const config = parseRuleConfig(limitRule.config);
  const tz = getBlindageTimezoneFromRules(rules);
  const now = new Date();
  const currentHour = getCalendarHourInTimezone(now, tz);
  const currentDate = formatCalendarDateInTimezone(now, tz);
  const cat = String(messageCategory || 'avulsa').trim().slice(0, 48) || 'avulsa';
  const { maxHour, maxDay } = resolveLimitsForMessageType(config, cat);

  if (maxHour != null) {
    const hourCount = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM messages m
       WHERE m.instance_id = $1
         AND m.from_me = true
         AND (m.timestamp AT TIME ZONE $2)::date = $3::date
         AND EXTRACT(HOUR FROM m.timestamp AT TIME ZONE $2)::int = $4
         AND COALESCE(NULLIF(TRIM(m.dispatch_type), ''), NULLIF(TRIM(m.message_type), ''), 'avulsa') = $5`,
      [instanceId, tz, currentDate, currentHour, cat]
    );

    const sentThisHour = hourCount.rows[0]?.c ?? 0;
    if (sentThisHour >= maxHour) {
      await logBlindageAction(instanceId, {
        action_type: 'limit_reached',
        limit_type: 'hourly',
        message_category: cat,
        current: sentThisHour,
        max: maxHour,
      }, limitRule.id);

      return {
        canSend: false,
        reason: `Limite horário atingido (${cat}): ${sentThisHour}/${maxHour} mensagens`,
        blockedBy: 'message_limit',
      };
    }
  }

  if (maxDay != null) {
    const dayCount = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM messages m
       WHERE m.instance_id = $1
         AND m.from_me = true
         AND (m.timestamp AT TIME ZONE $2)::date = $3::date
         AND COALESCE(NULLIF(TRIM(m.dispatch_type), ''), NULLIF(TRIM(m.message_type), ''), 'avulsa') = $4`,
      [instanceId, tz, currentDate, cat]
    );

    const sentToday = dayCount.rows[0]?.c ?? 0;
    if (sentToday >= maxDay) {
      await logBlindageAction(instanceId, {
        action_type: 'limit_reached',
        limit_type: 'daily',
        message_category: cat,
        current: sentToday,
        max: maxDay,
      }, limitRule.id);

      return {
        canSend: false,
        reason: `Limite diário atingido (${cat}): ${sentToday}/${maxDay} mensagens`,
        blockedBy: 'message_limit',
      };
    }
  }

  return { canSend: true };
}

/**
 * Verifica horários permitidos
 */
async function checkAllowedHours(
  instanceId: number,
  rules: BlindageRule[]
): Promise<BlindageResult> {
  const timeRule = rules.find(r => r.rule_type === 'allowed_hours');
  
  if (!timeRule) {
    console.log(
      `   ℹ️ Nenhuma regra ativa "allowed_hours" (global ou instância ${instanceId}); envio sem janela de horário. Habilite a regra global em Blindagem se quiser restringir.`
    );
    addLog(
      'info',
      `[Blindage] Sem regra allowed_hours ativa; horário não restringido (instância ${instanceId}).`
    );
    return { canSend: true };
  }
  
  if (!timeRule.enabled) {
    console.log(`   ⚠️ Regra de horários permitidos desabilitada para instância ${instanceId}`);
    addLog('warning', `[Blindage] Regra de horários permitidos desabilitada para instância ${instanceId}`);
    return { canSend: true };
  }

  const config = parseRuleConfig(timeRule.config);
  const timezone = config.timezone || 'America/Sao_Paulo';
  
  // Obter hora atual no timezone configurado
  const now = new Date();
  const currentHour = parseInt(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now).find(part => part.type === 'hour')?.value || '0',
    10
  );

  console.log(`   🕐 Verificando horários permitidos - Hora atual: ${currentHour}h (timezone: ${timezone})`);
  console.log(`   📋 Horas permitidas: ${config.allowed_hours ? JSON.stringify(config.allowed_hours) : 'não configurado'}`);
  console.log(`   🚫 Horas bloqueadas: ${config.blocked_hours ? JSON.stringify(config.blocked_hours) : 'não configurado'}`);
  addLog('debug', `[Blindage] Verificando horários - Hora: ${currentHour}h | Permitidas: ${JSON.stringify(config.allowed_hours)} | Bloqueadas: ${JSON.stringify(config.blocked_hours)}`);

  // Verificar horas bloqueadas
  if (config.blocked_hours && Array.isArray(config.blocked_hours)) {
    if (config.blocked_hours.includes(currentHour)) {
      const blockedLog = `🚫 Envio bloqueado no horário atual (${currentHour}h está na lista de bloqueados)`;
      console.log(`   ${blockedLog}`);
      addLog('warning', `[Blindage] ${blockedLog}`);
      
      await logBlindageAction(instanceId, {
        action_type: 'time_blocked',
        reason: 'blocked_hour',
        current_hour: currentHour,
      }, timeRule.id);

      return {
        canSend: false,
        reason: `Envio bloqueado no horário atual (${currentHour}h)`,
        blockedBy: 'allowed_hours',
      };
    }
  }

  // Verificar horas permitidas
  if (config.allowed_hours && Array.isArray(config.allowed_hours)) {
    if (!config.allowed_hours.includes(currentHour)) {
      const notAllowedLog = `🚫 Envio não permitido no horário atual (${currentHour}h não está na lista de permitidos: ${JSON.stringify(config.allowed_hours)})`;
      console.log(`   ${notAllowedLog}`);
      addLog('warning', `[Blindage] ${notAllowedLog}`);
      
      await logBlindageAction(instanceId, {
        action_type: 'time_blocked',
        reason: 'not_allowed_hour',
        current_hour: currentHour,
        allowed_hours: config.allowed_hours,
      }, timeRule.id);

      return {
        canSend: false,
        reason: `Envio não permitido no horário atual (${currentHour}h)`,
        blockedBy: 'allowed_hours',
      };
    } else {
      console.log(`   ✅ Hora ${currentHour}h está permitida (lista: ${JSON.stringify(config.allowed_hours)})`);
      addLog('debug', `[Blindage] Hora ${currentHour}h está permitida`);
    }
  } else {
    console.log(`   ⚠️ Lista de horas permitidas não configurada, permitindo envio`);
    addLog('warning', `[Blindage] Lista de horas permitidas não configurada - permitindo envio`);
  }

  return { canSend: true };
}

/**
 * Calcula delay (ms) antes de enviar, com base na última mensagem global e na regra `message_delay`.
 * - Se ainda não decorreu o intervalo mínimo desde o último envio global: espera só o restante.
 * - Se já decorreu: aplica apenas jitter leve (evita burst simultâneo sem "penalizar" com o mínimo inteiro de novo).
 */
async function calculateDelay(instanceId: number, rules: BlindageRule[]): Promise<number> {
  const delayRule = rules.find((r) => r.rule_type === 'message_delay');
  if (!delayRule || !delayRule.enabled) {
    console.log('   ℹ️ Regra de delay desabilitada ou não encontrada. Sem delay.');
    return 0;
  }

  const config = parseRuleConfig(delayRule.config);
  const tz = getBlindageTimezoneFromRules(rules);
  let minDelaySeconds = Math.max(0.5, Number(config.min_delay_seconds) || 5);

  if (config.progressive) {
    const now = new Date();
    const currentHour = getCalendarHourInTimezone(now, tz);
    const currentDate = formatCalendarDateInTimezone(now, tz);

    const metrics = await pool.query(
      `SELECT SUM(messages_sent) as total_messages
       FROM message_metrics 
       WHERE metric_date = $1::date 
         AND hour = $2`,
      [currentDate, currentHour]
    );

    const messagesThisHour = parseInt(metrics.rows[0]?.total_messages || '0', 10);
    const baseDelay = Math.max(minDelaySeconds, Number(config.base_delay) || minDelaySeconds);
    const increment = Number(config.increment_per_message);
    const inc = Number.isFinite(increment) ? increment : 0.5;

    minDelaySeconds = baseDelay + messagesThisHour * inc;

    if (config.max_delay_seconds != null) {
      const cap = Number(config.max_delay_seconds);
      if (Number.isFinite(cap) && cap > 0 && minDelaySeconds > cap) {
        minDelaySeconds = cap;
      }
    }
  }

  let jMin =
    Number.isFinite(Number(config.jitter_min_ms)) && Number(config.jitter_min_ms) >= 0
      ? Number(config.jitter_min_ms)
      : 150;
  let jMax =
    Number.isFinite(Number(config.jitter_max_ms)) && Number(config.jitter_max_ms) > 0
      ? Number(config.jitter_max_ms)
      : 450;
  if (jMax < jMin) {
    const swap = jMin;
    jMin = jMax;
    jMax = swap;
  }
  const jitterMin = jMin;
  const jitterMax = jMax;

  const globalLastSentResult = await pool.query(
    `SELECT MAX(last_message_sent_at) as global_last_sent 
     FROM instances 
     WHERE status = 'connected' AND last_message_sent_at IS NOT NULL`
  );

  const globalLast = globalLastSentResult.rows[0]?.global_last_sent;

  if (!globalLast) {
    const delayMs = Math.ceil(minDelaySeconds * 1000);
    console.log(
      `   ⏳ Primeiro envio registrado (sem last_message_sent_at global) — delay mínimo: ${minDelaySeconds}s (${delayMs}ms)`
    );
    return delayMs;
  }

  const lastSent = new Date(globalLast);
  const secondsSinceLastSent = (Date.now() - lastSent.getTime()) / 1000;

  console.log(
    `   ⏱️ Última mensagem global: ${secondsSinceLastSent.toFixed(2)}s atrás | Intervalo mínimo: ${minDelaySeconds}s`
  );

  if (secondsSinceLastSent < minDelaySeconds) {
    const waitMs = Math.ceil((minDelaySeconds - secondsSinceLastSent) * 1000);
    console.log(`   ⏳ Aguardando intervalo mínimo: ${(waitMs / 1000).toFixed(2)}s (${waitMs}ms)`);
    return waitMs;
  }

  const jitterRange = jitterMax - jitterMin;
  const jitterMs =
    jitterRange <= 0 ? jitterMin : jitterMin + Math.floor(Math.random() * (jitterRange + 1));

  console.log(
    `   ⏳ Intervalo mínimo já respeitado — jitter ${jitterMs}ms (faixa ${jitterMin}–${jitterMax}ms)`
  );
  return jitterMs;
}

/**
 * Após envio bem-sucedido: atualiza cooldown por destinatário e, se configurado, o histórico anti-repetição.
 */
export async function recordBlindageSuccessfulSend(input: {
  to: string;
  message: string;
  messageType?: string;
}): Promise<void> {
  try {
    const key = recipientCooldownKey(input.to);
    if (key.length >= 8) {
      await pool.query(
        `INSERT INTO blindage_recipient_send_log (recipient_key, last_sent_at)
         VALUES ($1, CURRENT_TIMESTAMP)
         ON CONFLICT (recipient_key) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at`,
        [key]
      );
    }

    const rules = await getActiveRules(null);
    const contentRule = rules.find((r) => r.rule_type === 'content_validation');
    const cfg =
      contentRule && contentRule.enabled ? parseRuleConfig(contentRule.config) : {};
    if (cfg.repetition_enabled !== true) {
      return;
    }

    const cat = (input.messageType?.trim() || 'avulsa').slice(0, 48) || 'avulsa';
    /** Devocional: um texto base com só o nome variando — nunca grava nem compara anti-repetição. */
    if (cat === 'devocional') {
      return;
    }

    const scope = cat;
    const normalized = normalizeBodyForFingerprint(input.message);
    if (normalized.length < 8) {
      return;
    }

    const hash = sha256HexUtf8(normalized);
    const preview = normalized.slice(0, 2000);
    await pool.query(
      `INSERT INTO blindage_sent_content_recent (scope, body_hash, normalized_preview)
       VALUES ($1, $2, $3)`,
      [scope, hash, preview]
    );

    const window = Math.min(80, Math.max(5, Number(cfg.repetition_window) || 20));
    await pool.query(
      `WITH ranked AS (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY scope ORDER BY created_at DESC) AS rn
         FROM blindage_sent_content_recent
         WHERE scope = $1
       )
       DELETE FROM blindage_sent_content_recent WHERE id IN (SELECT id FROM ranked WHERE rn > $2)`,
      [scope, window]
    );
  } catch (e) {
    console.error('[Blindage] recordBlindageSuccessfulSend:', e);
  }
}

/**
 * Registra ação de blindagem
 */
async function logBlindageAction(
  instanceId: number | null,
  actionData: any,
  ruleId?: number
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO blindage_actions (instance_id, rule_id, action_type, action_data)
       VALUES ($1, $2, $3, $4)`,
      [instanceId, ruleId || null, actionData.action_type, JSON.stringify(actionData)]
    );
  } catch (error) {
    console.error('Erro ao registrar ação de blindagem:', error);
  }
}

export interface ApplyBlindageProfileResult {
  profileId: string;
  dryRun: boolean;
  updated: Array<{ rule_type: string; id: number }>;
  missing: string[];
}

/**
 * Aplica um perfil global (MassFlow-style) às regras com `instance_id IS NULL`.
 * Garante linhas com `createGlobalDefaultRules()` antes; substitui o JSON `config` inteiro por tipo.
 */
export async function applyBlindageGlobalProfile(
  profileId: string,
  options: { dryRun?: boolean } = {}
): Promise<ApplyBlindageProfileResult> {
  const dryRun = options.dryRun === true;
  const pkg = getBlindageProfilePackage(profileId);
  if (!pkg) {
    throw new Error(`Perfil inválido: use conservative, moderate ou aggressive`);
  }

  await createGlobalDefaultRules();

  const updated: Array<{ rule_type: string; id: number }> = [];
  const missing: string[] = [];

  for (const ruleType of Object.keys(pkg)) {
    const config = pkg[ruleType];
    const row = await pool.query(
      `SELECT id FROM blindage_rules WHERE instance_id IS NULL AND rule_type = $1`,
      [ruleType]
    );
    if (row.rows.length === 0) {
      missing.push(ruleType);
      continue;
    }
    const id = row.rows[0].id as number;
    if (!dryRun) {
      await pool.query(
        `UPDATE blindage_rules SET config = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [JSON.stringify(config), id]
      );
    }
    updated.push({ rule_type: ruleType, id });
  }

  const label = BLINDAGE_PROFILES_META.find((m) => m.id === profileId)?.label || profileId;
  const msg = `[Blindage] Perfil "${label}" (${profileId}) ${dryRun ? 'simulado' : 'aplicado'} em ${updated.length} regra(s) global(is)`;
  console.log(`✅ ${msg}`);
  if (missing.length > 0) {
    console.warn(`   ⚠️ Regras globais ausentes (não atualizadas): ${missing.join(', ')}`);
    addLog('warning', `[Blindage] Perfil ${profileId}: regras ausentes: ${missing.join(', ')}`);
  }
  addLog('info', msg);

  return { profileId, dryRun, updated, missing };
}

/**
 * Cria regras padrão GLOBAIS de blindagem (instance_id = NULL)
 * Todas as regras são aplicadas globalmente, não por instância
 */
export async function createGlobalDefaultRules(): Promise<void> {
  try {
    const defaultRules: Array<{
      instance_id: null;
      rule_name: string;
      rule_type: string;
      enabled: boolean;
    }> = [
      { instance_id: null, rule_name: 'Delay Mínimo Entre Mensagens', rule_type: 'message_delay', enabled: true },
      { instance_id: null, rule_name: 'Limite de Mensagens', rule_type: 'message_limit', enabled: true },
      { instance_id: null, rule_name: 'Rotação de Instâncias', rule_type: 'instance_rotation', enabled: true },
      { instance_id: null, rule_name: 'Horários Permitidos', rule_type: 'allowed_hours', enabled: true },
      { instance_id: null, rule_name: 'Health Check', rule_type: 'health_check', enabled: true },
      { instance_id: null, rule_name: 'Validação de Conteúdo', rule_type: 'content_validation', enabled: true },
      { instance_id: null, rule_name: 'Validação de Número', rule_type: 'number_validation', enabled: true },
      { instance_id: null, rule_name: 'Seleção de Instâncias', rule_type: 'instance_selection', enabled: true },
      { instance_id: null, rule_name: 'Pacing de disparos (lotes)', rule_type: 'dispatch_pacing', enabled: true },
    ];

    for (const rule of defaultRules) {
      const template = BLINDAGE_CANONICAL_CONFIGS[rule.rule_type];
      if (!template) {
        console.warn(`   ⚠️ Sem template canônico para rule_type=${rule.rule_type}, ignorando INSERT`);
        continue;
      }
      const config = { ...template };

      // Verificar se a regra já existe antes de inserir
      const existing = await pool.query(
        `SELECT id FROM blindage_rules 
         WHERE rule_type = $1 AND instance_id IS NULL`,
        [rule.rule_type]
      );

      if (existing.rows.length === 0) {
        await pool.query(
          `INSERT INTO blindage_rules (instance_id, rule_name, rule_type, enabled, config)
           VALUES ($1, $2, $3, $4, $5)`,
          [rule.instance_id, rule.rule_name, rule.rule_type, rule.enabled, JSON.stringify(config)]
        );
        console.log(`   ✅ Regra global criada: ${rule.rule_type}`);
      } else {
        console.log(`   ℹ️ Regra global já existe: ${rule.rule_type}`);
      }
    }

    console.log(`✅ Regras padrão GLOBAIS de blindagem criadas`);
    addLog('info', '[Blindage] Regras padrão globais criadas/verificadas');
  } catch (error) {
    console.error('Erro ao criar regras padrão globais:', error);
    addLog('error', `[Blindage] Erro ao criar regras globais: ${error}`);
  }
}

/**
 * Cria regras padrão de blindagem para uma instância (DEPRECATED - mantido para compatibilidade)
 * @deprecated Use createGlobalDefaultRules() - todas as regras agora são globais
 */
export async function createDefaultRules(instanceId: number): Promise<void> {
  // Apenas criar a regra de instance_selection se não existir
  // Todas as outras regras devem ser globais
  try {
    await createGlobalDefaultRules();
    console.log(`✅ Regras globais verificadas ao criar instância ${instanceId}`);
  } catch (error) {
    console.error('Erro ao criar regras globais:', error);
  }
}
