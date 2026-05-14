/**
 * Perfis de blindagem (Fase A — alinhado ao modelo MassFlow / envio inteligente).
 * Cada perfil define um pacote completo de `config` por `rule_type` para regras **globais**.
 */

export const BLINDAGE_PROFILE_IDS = ['conservative', 'moderate', 'aggressive'] as const;
export type BlindageProfileId = (typeof BLINDAGE_PROFILE_IDS)[number];

export interface BlindageProfileMeta {
  id: BlindageProfileId;
  label: string;
  description: string;
}

export const BLINDAGE_PROFILES_META: BlindageProfileMeta[] = [
  {
    id: 'conservative',
    label: 'Conservador',
    description: 'Máxima proteção, menor volume (limites baixos, horário comercial, intervalos maiores).',
  },
  {
    id: 'moderate',
    label: 'Moderado',
    description: 'Equilíbrio recomendado para a maioria (limites médios, horário estendido).',
  },
  {
    id: 'aggressive',
    label: 'Agressivo',
    description: 'Maior volume, mais risco (limites altos, envio 24h, intervalos menores).',
  },
];

/** Palavras de opt-out padrão (MassFlow-style). */
const OPT_OUT_WORDS = ['sair', 'descadastrar', 'stop', 'parar', 'remover', 'cancelar'];

function hoursRange(start: number, end: number): number[] {
  const out: number[] = [];
  for (let h = start; h <= end; h++) out.push(h);
  return out;
}

/** Horas do dia não presentes em `allowed` (0–23). */
function complementHours(allowed: number[]): number[] {
  const set = new Set(allowed);
  const blocked: number[] = [];
  for (let h = 0; h < 24; h++) {
    if (!set.has(h)) blocked.push(h);
  }
  return blocked;
}

/**
 * Pacote por `rule_type`. Valores substituem o JSON inteiro da regra global ao aplicar o perfil.
 */
export type BlindageProfilePackage = Record<string, Record<string, unknown>>;

const PACKAGES: Record<BlindageProfileId, BlindageProfilePackage> = {
  conservative: {
    message_limit: {
      max_per_hour: 8,
      max_per_day: 80,
      reset_hour: 0,
      reset_day: 1,
      min_minutes_between_same_recipient: 120,
      limits_by_message_type: {},
    },
    allowed_hours: {
      allowed_hours: hoursRange(9, 18),
      blocked_hours: complementHours(hoursRange(9, 18)),
      timezone: 'America/Sao_Paulo',
    },
    message_delay: {
      min_delay_seconds: 30,
      max_delay_seconds: 60,
      progressive: false,
      base_delay: 30,
      increment_per_message: 0.5,
      jitter_min_ms: 200,
      jitter_max_ms: 800,
    },
    instance_rotation: {
      enabled: true,
      min_delay_between_instances: 5,
      round_robin: true,
      rotate_every_n_messages: 50,
    },
    content_validation: {
      max_length: 4096,
      blocked_words: [...OPT_OUT_WORDS],
      repetition_enabled: false,
      repetition_window: 20,
      repetition_alert_percent: 85,
    },
    health_check: {
      pause_if_degraded: true,
      pause_if_down: true,
      check_interval_seconds: 60,
    },
    number_validation: {
      validate_format: true,
      check_whatsapp: true,
      require_whatsapp_check: true,
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
      messages_per_batch: 15,
      pause_between_batches_minutes: 20,
      long_pause_every_n_messages: 25,
      long_pause_minutes: 90,
    },
  },

  moderate: {
    message_limit: {
      max_per_hour: 25,
      max_per_day: 200,
      reset_hour: 0,
      reset_day: 1,
      min_minutes_between_same_recipient: 45,
      limits_by_message_type: {
        marketing: { max_per_hour: 20, max_per_day: 180 },
        devocional: { max_per_hour: 12, max_per_day: 120 },
      },
    },
    allowed_hours: {
      allowed_hours: hoursRange(8, 20),
      blocked_hours: complementHours(hoursRange(8, 20)),
      timezone: 'America/Sao_Paulo',
    },
    message_delay: {
      min_delay_seconds: 12,
      max_delay_seconds: 45,
      progressive: true,
      base_delay: 12,
      increment_per_message: 0.4,
      jitter_min_ms: 150,
      jitter_max_ms: 600,
    },
    instance_rotation: {
      enabled: true,
      min_delay_between_instances: 3,
      round_robin: true,
      rotate_every_n_messages: 50,
    },
    content_validation: {
      max_length: 4096,
      blocked_words: [...OPT_OUT_WORDS],
      repetition_enabled: false,
      repetition_window: 20,
      repetition_alert_percent: 85,
    },
    health_check: {
      pause_if_degraded: true,
      pause_if_down: true,
      check_interval_seconds: 60,
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
  },

  aggressive: {
    message_limit: {
      max_per_hour: 50,
      max_per_day: 400,
      reset_hour: 0,
      reset_day: 1,
      min_minutes_between_same_recipient: 15,
      limits_by_message_type: {},
    },
    allowed_hours: {
      allowed_hours: hoursRange(0, 23),
      blocked_hours: [],
      timezone: 'America/Sao_Paulo',
    },
    message_delay: {
      min_delay_seconds: 5,
      max_delay_seconds: 45,
      progressive: true,
      base_delay: 5,
      increment_per_message: 0.5,
      jitter_min_ms: 150,
      jitter_max_ms: 450,
    },
    instance_rotation: {
      enabled: true,
      min_delay_between_instances: 2,
      round_robin: true,
      rotate_every_n_messages: 50,
    },
    content_validation: {
      max_length: 4096,
      blocked_words: [...OPT_OUT_WORDS],
      repetition_enabled: false,
      repetition_window: 20,
      repetition_alert_percent: 85,
    },
    health_check: {
      pause_if_degraded: true,
      pause_if_down: true,
      check_interval_seconds: 60,
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
      messages_per_batch: 35,
      pause_between_batches_minutes: 10,
      long_pause_every_n_messages: 45,
      long_pause_minutes: 45,
    },
  },
};

export function isBlindageProfileId(id: string): id is BlindageProfileId {
  return (BLINDAGE_PROFILE_IDS as readonly string[]).includes(id);
}

export function getBlindageProfilePackage(id: string): BlindageProfilePackage | null {
  if (!isBlindageProfileId(id)) return null;
  return JSON.parse(JSON.stringify(PACKAGES[id])) as BlindageProfilePackage;
}
