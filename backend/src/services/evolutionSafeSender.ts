/**
 * Cliente único de envio de texto para Evolution API com guard persistente no PostgreSQL.
 * Serializa envios por instância entre processos/réplicas via SELECT ... FOR UPDATE.
 */
import { randomBytes } from 'crypto';
import axios from 'axios';
import { pool } from '../database';
import { addLog } from '../routes/logs';

export type EvolutionSendErrorKind =
  | 'rate_limit'
  | 'forbidden'
  | 'provider_unavailable'
  | 'timeout'
  | 'network'
  | 'unknown'
  | 'instance_offline'
  | 'cooldown';

export class EvolutionSafeSendError extends Error {
  kind: EvolutionSendErrorKind;
  httpStatus?: number;
  instanceId: number;

  constructor(
    message: string,
    opts: { kind: EvolutionSendErrorKind; instanceId: number; httpStatus?: number }
  ) {
    super(message);
    this.name = 'EvolutionSafeSendError';
    this.kind = opts.kind;
    this.instanceId = opts.instanceId;
    this.httpStatus = opts.httpStatus;
  }
}

export interface SendEvolutionTextParams {
  instanceId: number;
  number: string;
  text: string;
  messageType?: string;
  /** Metadados opcionais (não logados em detalhe) */
  metadata?: Record<string, unknown>;
  /** Se presente, envia mídia (mesmo guard/slot da instância) em vez de só texto */
  media?: {
    url: string;
    type: string;
  };
}

export interface SendEvolutionTextResult {
  success: true;
  instanceId: number;
  instanceName: string;
  evolutionData: unknown;
  messageId: string;
  waitedMs: number;
  delayAppliedMs: number;
  sequenceNumber: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Defaults conservadores: 60–120s entre reservas da mesma instância */
function getDelayBounds(): { minMs: number; maxMs: number } {
  let minMs = envInt('EVOLUTION_MIN_DELAY_MS', 60_000);
  let maxMs = envInt('EVOLUTION_MAX_DELAY_MS', 120_000);
  if (minMs <= 0) minMs = 60_000;
  if (maxMs <= 0) maxMs = 120_000;
  if (maxMs < minMs) maxMs = minMs;
  return { minMs, maxMs };
}

function randomDelayMs(minMs: number, maxMs: number): number {
  if (maxMs <= minMs) return minMs;
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 6) return '***';
  return `${digits.slice(0, 4)}****${digits.slice(-2)}`;
}

function classifyHttpError(status: number | undefined, err: any): EvolutionSendErrorKind {
  if (status === 429) return 'rate_limit';
  if (status === 403) return 'forbidden';
  if (status != null && status >= 500) return 'provider_unavailable';
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') return 'timeout';
  if (
    err?.code === 'ECONNREFUSED' ||
    err?.code === 'ENOTFOUND' ||
    err?.code === 'ECONNRESET' ||
    err?.code === 'EAI_AGAIN'
  ) {
    return 'network';
  }
  return 'unknown';
}

function cooldownMsForKind(kind: EvolutionSendErrorKind): number {
  switch (kind) {
    case 'rate_limit':
      return envInt('EVOLUTION_COOLDOWN_RATE_LIMIT_MS', 15 * 60_000);
    case 'forbidden':
      return envInt('EVOLUTION_COOLDOWN_FORBIDDEN_MS', 30 * 60_000);
    case 'provider_unavailable':
      return envInt('EVOLUTION_COOLDOWN_5XX_MS', 10 * 60_000);
    case 'timeout':
    case 'network':
      return envInt('EVOLUTION_COOLDOWN_NETWORK_MS', 5 * 60_000);
    default:
      return envInt('EVOLUTION_COOLDOWN_DEFAULT_MS', 5 * 60_000);
  }
}

async function ensureGuardRow(instanceId: number): Promise<void> {
  await pool.query(
    `INSERT INTO instance_send_guard (instance_id, next_available_at, sequence_number, daily_sent_count, hourly_sent_count)
     VALUES ($1, CURRENT_TIMESTAMP, 0, 0, 0)
     ON CONFLICT (instance_id) DO NOTHING`,
    [instanceId]
  );
}

async function applyCooldown(instanceId: number, kind: EvolutionSendErrorKind): Promise<void> {
  const ms = cooldownMsForKind(kind);
  await pool.query(
    `UPDATE instance_send_guard
     SET cooldown_until = GREATEST(
           COALESCE(cooldown_until, CURRENT_TIMESTAMP),
           CURRENT_TIMESTAMP + ($2::text || ' milliseconds')::interval
         ),
         violation_count = COALESCE(violation_count, 0) + 1,
         reservation_token = NULL,
         reservation_expires_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE instance_id = $1`,
    [instanceId, String(ms)]
  );
  addLog(
    'warning',
    `[EvolutionSafeSender] Cooldown ${Math.round(ms / 1000)}s na instância ${instanceId} (kind=${kind})`
  );
}

/**
 * Reserva o próximo slot de envio para a instância (lock no Postgres).
 * Exportada para testes de serialização; produção usa via sendEvolutionTextSafely.
 */
export async function reserveSendSlot(instanceId: number): Promise<{
  waitedMs: number;
  delayAppliedMs: number;
  reservationToken: string;
  sequenceNumber: number;
}> {
  const { minMs, maxMs } = getDelayBounds();
  const delayAppliedMs = randomDelayMs(minMs, maxMs);
  const reservationToken = randomBytes(16).toString('hex');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const locked = await client.query(
      `SELECT *
       FROM instance_send_guard
       WHERE instance_id = $1
       FOR UPDATE`,
      [instanceId]
    );

    if (locked.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new EvolutionSafeSendError('Guard da instância não encontrado', {
        kind: 'unknown',
        instanceId,
      });
    }

    const row = locked.rows[0];
    const now = Date.now();
    let earliest = now;

    if (row.cooldown_until) {
      const cd = new Date(row.cooldown_until).getTime();
      if (cd > earliest) earliest = cd;
    }
    if (row.next_available_at) {
      const na = new Date(row.next_available_at).getTime();
      if (na > earliest) earliest = na;
    }

    const waitedMs = Math.max(0, earliest - now);
    const reservedAt = new Date(earliest);
    const nextAvailable = new Date(earliest + delayAppliedMs);
    const reservationExpires = new Date(earliest + Math.max(delayAppliedMs, 180_000));
    const nextSeq = Number(row.sequence_number || 0) + 1;

    const today = new Date().toISOString().slice(0, 10);
    let dailyCount = Number(row.daily_sent_count || 0);
    let dailyDate = row.daily_usage_date
      ? String(row.daily_usage_date).slice(0, 10)
      : today;
    if (dailyDate !== today) {
      dailyDate = today;
      dailyCount = 0;
    }

    let hourlyStart = row.hourly_window_start
      ? new Date(row.hourly_window_start)
      : new Date(now);
    let hourlyCount = Number(row.hourly_sent_count || 0);
    if (now - hourlyStart.getTime() >= 60 * 60 * 1000) {
      hourlyStart = new Date(now);
      hourlyCount = 0;
    }

    await client.query(
      `UPDATE instance_send_guard
       SET next_available_at = $2,
           last_reserved_at = $3,
           reservation_token = $4,
           reservation_expires_at = $5,
           sequence_number = $6,
           daily_usage_date = $7::date,
           daily_sent_count = $8,
           hourly_window_start = $9,
           hourly_sent_count = $10,
           updated_at = CURRENT_TIMESTAMP
       WHERE instance_id = $1`,
      [
        instanceId,
        nextAvailable.toISOString(),
        reservedAt.toISOString(),
        reservationToken,
        reservationExpires.toISOString(),
        nextSeq,
        dailyDate,
        dailyCount,
        hourlyStart.toISOString(),
        hourlyCount,
      ]
    );

    await client.query('COMMIT');

    return { waitedMs, delayAppliedMs, reservationToken, sequenceNumber: nextSeq };
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

async function markSendSuccess(
  instanceId: number,
  reservationToken: string
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await pool.query(
    `UPDATE instance_send_guard
     SET last_sent_at = CURRENT_TIMESTAMP,
         reservation_token = CASE WHEN reservation_token = $2 THEN NULL ELSE reservation_token END,
         reservation_expires_at = CASE WHEN reservation_token = $2 THEN NULL ELSE reservation_expires_at END,
         daily_usage_date = CASE
           WHEN daily_usage_date IS DISTINCT FROM $3::date THEN $3::date
           ELSE COALESCE(daily_usage_date, $3::date)
         END,
         daily_sent_count = CASE
           WHEN daily_usage_date IS DISTINCT FROM $3::date THEN 1
           ELSE COALESCE(daily_sent_count, 0) + 1
         END,
         hourly_window_start = CASE
           WHEN hourly_window_start IS NULL
             OR hourly_window_start < CURRENT_TIMESTAMP - INTERVAL '1 hour'
           THEN CURRENT_TIMESTAMP
           ELSE hourly_window_start
         END,
         hourly_sent_count = CASE
           WHEN hourly_window_start IS NULL
             OR hourly_window_start < CURRENT_TIMESTAMP - INTERVAL '1 hour'
           THEN 1
           ELSE COALESCE(hourly_sent_count, 0) + 1
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE instance_id = $1`,
    [instanceId, reservationToken, today]
  );

  await pool.query(
    `UPDATE instances
     SET last_message_sent_at = CURRENT_TIMESTAMP,
         last_activity_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [instanceId]
  );
}

/**
 * Envia texto (ou mídia com caption) via Evolution com serialização persistente por instância.
 */
export async function sendEvolutionTextSafely(
  params: SendEvolutionTextParams
): Promise<SendEvolutionTextResult> {
  const { instanceId, number, text, messageType, media } = params;
  const masked = maskPhone(number);

  const instanceResult = await pool.query(
    `SELECT id, instance_name, api_url, api_key, status
     FROM instances
     WHERE id = $1`,
    [instanceId]
  );

  if (instanceResult.rows.length === 0) {
    throw new EvolutionSafeSendError('Instância não encontrada', {
      kind: 'unknown',
      instanceId,
    });
  }

  const instance = instanceResult.rows[0];
  if (instance.status !== 'connected') {
    throw new EvolutionSafeSendError('Instância não está conectada', {
      kind: 'instance_offline',
      instanceId,
    });
  }

  await ensureGuardRow(instanceId);

  // Bloqueio rápido se já em cooldown (sem reservar)
  const peek = await pool.query(
    `SELECT cooldown_until FROM instance_send_guard WHERE instance_id = $1`,
    [instanceId]
  );
  const cd = peek.rows[0]?.cooldown_until ? new Date(peek.rows[0].cooldown_until).getTime() : 0;
  if (cd > Date.now() + 1000) {
    const waitSec = Math.ceil((cd - Date.now()) / 1000);
    throw new EvolutionSafeSendError(
      `Instância em cooldown por ~${waitSec}s (proteção Evolution)`,
      { kind: 'cooldown', instanceId }
    );
  }

  const slot = await reserveSendSlot(instanceId);

  if (slot.waitedMs > 0) {
    addLog(
      'info',
      `[EvolutionSafeSender] Aguardando ${Math.round(slot.waitedMs / 1000)}s antes de enviar (inst=${instanceId} to=${masked} type=${messageType || 'avulsa'})`
    );
    await new Promise((r) => setTimeout(r, slot.waitedMs));
  }

  const evolutionApiUrl = process.env.EVOLUTION_API_URL || instance.api_url;
  const evolutionApiKey = process.env.EVOLUTION_API_KEY || instance.api_key;
  const timeoutMs = envInt('EVOLUTION_SEND_TIMEOUT_MS', 20_000);

  let sendUrl: string;
  let body: Record<string, unknown>;

  if (media?.url) {
    const mediaType = String(media.type || '').toLowerCase();
    if (mediaType === 'image') {
      sendUrl = `${evolutionApiUrl}/message/sendMedia/${instance.instance_name}`;
      body = {
        number,
        mediatype: 'image',
        media: media.url,
        caption: text,
        fileName: media.url.split('/').pop() || 'image.jpg',
      };
    } else if (mediaType === 'video') {
      sendUrl = `${evolutionApiUrl}/message/sendMedia/${instance.instance_name}`;
      body = {
        number,
        mediatype: 'video',
        media: media.url,
        caption: text,
      };
    } else if (mediaType === 'audio') {
      sendUrl = `${evolutionApiUrl}/message/sendWhatsAppAudio/${instance.instance_name}`;
      body = {
        number,
        audio: media.url,
      };
    } else if (mediaType === 'pdf' || mediaType === 'document') {
      sendUrl = `${evolutionApiUrl}/message/sendMedia/${instance.instance_name}`;
      body = {
        number,
        mediatype: 'document',
        media: media.url,
        caption: text,
        fileName: media.url.split('/').pop() || 'document.pdf',
      };
    } else {
      throw new EvolutionSafeSendError(`Tipo de mídia não suportado: ${media.type}`, {
        kind: 'unknown',
        instanceId,
      });
    }
  } else {
    sendUrl = `${evolutionApiUrl}/message/sendText/${instance.instance_name}`;
    body = { number, text };
  }

  try {
    const response = await axios.post(sendUrl, body, {
      headers: {
        apikey: evolutionApiKey,
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs,
      validateStatus: () => true,
    });

    if (response.status >= 400) {
      const kind = classifyHttpError(response.status, null);
      await applyCooldown(instanceId, kind);
      throw new EvolutionSafeSendError(`Evolution HTTP ${response.status}`, {
        kind,
        instanceId,
        httpStatus: response.status,
      });
    }

    await markSendSuccess(instanceId, slot.reservationToken);

    const messageId =
      response.data?.key?.id ||
      response.data?.messageId ||
      `evo-${Date.now()}-${slot.sequenceNumber}`;

    addLog(
      'success',
      `[EvolutionSafeSender] Enviado inst=${instanceId} seq=${slot.sequenceNumber} to=${masked} wait=${slot.waitedMs}ms gap=${slot.delayAppliedMs}ms media=${media ? 'yes' : 'no'}`
    );

    return {
      success: true,
      instanceId,
      instanceName: instance.instance_name,
      evolutionData: response.data,
      messageId: String(messageId),
      waitedMs: slot.waitedMs,
      delayAppliedMs: slot.delayAppliedMs,
      sequenceNumber: slot.sequenceNumber,
    };
  } catch (error: any) {
    if (error instanceof EvolutionSafeSendError) {
      throw error;
    }

    const status = error?.response?.status as number | undefined;
    const kind = classifyHttpError(status, error);
    await applyCooldown(instanceId, kind);

    throw new EvolutionSafeSendError(error?.message || 'Falha no envio Evolution', {
      kind,
      instanceId,
      httpStatus: status,
    });
  }
}
