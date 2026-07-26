/**
 * Mensagem personalizada → dispatch operacional + dispatch_items (worker).
 * Não chama Evolution; não envia de forma síncrona.
 */
import { pool } from '../database';
import { applyMessageTemplate } from './devocionalPersonalization';
import { addLog } from '../routes/logs';
import { pingInstanceHealth } from './retryQueue';
import { markInstanceOfflineInDb } from './dispatchRetry';
import { maskPhone } from './evolutionSafeSender';
import { ensureDispatchItemsBatch, isDispatchItemSent } from './dispatchItems';
import {
  assertDispatchPipelineAllowed,
  DispatchOperationalError,
} from './dispatchRuntimeConfig';
import {
  formatAudienceCountsLog,
  PENDING_WHATSAPP_VALIDATION_MESSAGE,
  resolveContactsByIds,
  resolveListAudience,
  type CategorizedAudience,
} from './listAudienceResolver';
import { normalizePhoneDigits } from '../utils/phoneNumber';

export const PERSONALIZADA_DISPATCH_TYPE = 'personalizada';
/** Alias legado — tratado como personalizada no pipeline. */
export const MARKETING_DISPATCH_TYPE = 'marketing';

export function isPersonalizadaDispatchType(t: string | null | undefined): boolean {
  return t === PERSONALIZADA_DISPATCH_TYPE || t === MARKETING_DISPATCH_TYPE;
}

export class PersonalizadaDispatchError extends Error {
  readonly status: number;
  readonly audience?: AudienceSummary;
  constructor(message: string, status = 400, audience?: AudienceSummary) {
    super(message);
    this.name = 'PersonalizadaDispatchError';
    this.status = status;
    this.audience = audience;
  }
}

export interface AudienceSummary {
  total_potential: number;
  eligible_now: number;
  needs_whatsapp_validation: number;
  excluded_opt_out: number;
  excluded_no_opt_in: number;
  excluded_invalid_phone: number;
  excluded_whatsapp_invalid: number;
  excluded_by_score: number;
}

export interface CreatePersonalizadaInput {
  name: string;
  message_template: string;
  list_id?: number | null;
  contact_ids?: number[] | null;
  instance_ids?: number[];
  media_url?: string | null;
  media_type?: string | null;
  metadata?: Record<string, unknown>;
  created_by?: number | null;
  /** Se true, grava como `marketing` (compat). Default: personalizada */
  legacy_marketing?: boolean;
}

export interface CreatePersonalizadaResult {
  dispatch: Record<string, unknown>;
  audience: AudienceSummary;
  items_enqueued: number;
  items_created: number;
  items_reused: number;
  warning?: string | null;
  message: string;
}

function toAudienceSummary(audience: CategorizedAudience): AudienceSummary {
  return { ...audience.counts };
}

async function resolveAudience(input: {
  list_id?: number | null;
  contact_ids?: number[] | null;
}): Promise<CategorizedAudience> {
  if (input.list_id) {
    const listResult = await pool.query(`SELECT * FROM contact_lists WHERE id = $1`, [input.list_id]);
    if (listResult.rows.length === 0) {
      throw new PersonalizadaDispatchError(`Lista ${input.list_id} não encontrada`, 404);
    }
    return resolveListAudience(listResult.rows[0]);
  }
  if (input.contact_ids && input.contact_ids.length > 0) {
    return resolveContactsByIds(input.contact_ids);
  }
  throw new PersonalizadaDispatchError('É necessário fornecer list_id ou contact_ids');
}

/**
 * Enfileira itens de um dispatch personalizada/marketing já existente.
 * Não envia; só cria dispatch_items para o worker.
 */
export async function enqueuePersonalizadaDispatch(params: {
  dispatchId: number;
  instanceIds?: number[];
}): Promise<{
  items_enqueued: number;
  items_created: number;
  items_reused: number;
  audience: AudienceSummary;
  warning: string | null;
}> {
  const { dispatchId, instanceIds } = params;

  assertDispatchPipelineAllowed();

  const dispatchResult = await pool.query(`SELECT * FROM dispatches WHERE id = $1`, [dispatchId]);
  if (dispatchResult.rows.length === 0) {
    throw new PersonalizadaDispatchError(`Disparo ${dispatchId} não encontrado`, 404);
  }
  const dispatch = dispatchResult.rows[0];
  if (!isPersonalizadaDispatchType(dispatch.dispatch_type)) {
    throw new PersonalizadaDispatchError(
      `Disparo ${dispatchId} não é personalizada/marketing (tipo=${dispatch.dispatch_type})`
    );
  }

  if (dispatch.status === 'completed' || dispatch.status === 'stopped') {
    const itemsCheck = await pool.query(
      `SELECT COUNT(*)::int AS c FROM dispatch_items WHERE dispatch_id = $1`,
      [dispatchId]
    );
    return {
      items_enqueued: itemsCheck.rows[0]?.c || 0,
      items_created: 0,
      items_reused: itemsCheck.rows[0]?.c || 0,
      audience: {
        total_potential: dispatch.total_contacts || 0,
        eligible_now: dispatch.total_contacts || 0,
        needs_whatsapp_validation: 0,
        excluded_opt_out: 0,
        excluded_no_opt_in: 0,
        excluded_invalid_phone: 0,
        excluded_whatsapp_invalid: 0,
        excluded_by_score: 0,
      },
      warning: `Disparo já está em status: ${dispatch.status}`,
    };
  }

  const audience = await resolveAudience({
    list_id: dispatch.list_id,
    contact_ids: Array.isArray(dispatch.contact_ids) ? dispatch.contact_ids : null,
  });

  const countsLog = formatAudienceCountsLog(audience.counts);
  addLog('info', `[Personalizada ${dispatchId}] Público: ${countsLog}`);

  let warning: string | null = null;
  if (audience.counts.needs_whatsapp_validation > 0) {
    warning = PENDING_WHATSAPP_VALIDATION_MESSAGE;
    addLog(
      'warning',
      `[Personalizada ${dispatchId}] ${audience.counts.needs_whatsapp_validation} pendentes WA — ${warning}`
    );
  }

  const contacts = audience.eligible_now;
  if (contacts.length === 0) {
    await pool.query(
      `UPDATE dispatches
       SET status = 'completed',
           contacts_processed = 0,
           total_contacts = 0,
           completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [dispatchId]
    );
    if (audience.counts.needs_whatsapp_validation > 0) {
      throw new PersonalizadaDispatchError(PENDING_WHATSAPP_VALIDATION_MESSAGE, 422, toAudienceSummary(audience));
    }
    throw new PersonalizadaDispatchError('Nenhum contato elegível para enfileirar.', 400, toAudienceSummary(audience));
  }

  let instances: Array<{ id: number; instance_name: string }> = [];
  if (instanceIds && instanceIds.length > 0) {
    const r = await pool.query(
      `SELECT id, instance_name FROM instances WHERE id = ANY($1::int[]) AND status = 'connected'`,
      [instanceIds]
    );
    instances = r.rows;
  } else {
    const r = await pool.query(
      `SELECT id, instance_name FROM instances WHERE status = 'connected' ORDER BY last_message_sent_at ASC NULLS FIRST`
    );
    instances = r.rows;
  }

  if (instances.length === 0) {
    throw new PersonalizadaDispatchError('Nenhuma instância conectada disponível', 400, toAudienceSummary(audience));
  }

  const verified: typeof instances = [];
  for (const inst of instances) {
    const online = await pingInstanceHealth(inst.id);
    if (online) verified.push(inst);
    else await markInstanceOfflineInDb(inst.id);
  }
  if (verified.length === 0) {
    throw new PersonalizadaDispatchError(
      'Todas as instâncias estão offline. Verifique a conexão WhatsApp.',
      400,
      toAudienceSummary(audience)
    );
  }

  await pool.query(
    `UPDATE dispatches SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id = $1`,
    [dispatchId]
  );

  const messageType = isPersonalizadaDispatchType(dispatch.dispatch_type)
    ? PERSONALIZADA_DISPATCH_TYPE
    : 'marketing';

  const batch = await ensureDispatchItemsBatch({
    dispatchId,
    contacts,
    messageType,
    maxAttempts: 1,
    buildSnapshot: (contact) => applyMessageTemplate(dispatch.message_template, contact.name),
  });

  if (batch.expected !== contacts.length || batch.total < contacts.length) {
    throw new PersonalizadaDispatchError(
      `Enfileiramento incompleto: elegíveis=${contacts.length}, items=${batch.total}`,
      500,
      toAudienceSummary(audience)
    );
  }

  let alreadySent = 0;
  let enqueued = 0;
  for (const contact of contacts) {
    const phone = normalizePhoneDigits(contact.phone_number || '', '55');
    if (await isDispatchItemSent(dispatchId, phone)) {
      alreadySent++;
      continue;
    }
    await pool.query(
      `INSERT INTO dispatch_contacts (dispatch_id, contact_number, contact_name, status)
       SELECT $1, $2, $3, 'pending'
       WHERE NOT EXISTS (
         SELECT 1 FROM dispatch_contacts
         WHERE dispatch_id = $1 AND contact_number = $2
       )`,
      [dispatchId, phone, contact.name]
    );
    enqueued++;
    addLog('info', `[Personalizada ${dispatchId}] Enfileirado ${maskPhone(phone)}`);
  }

  await pool.query(
    `UPDATE dispatches
     SET total_contacts = $1,
         contacts_processed = $2,
         status = 'running',
         completed_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3`,
    [contacts.length, alreadySent, dispatchId]
  );

  const msg =
    `✅ Personalizada ${dispatchId} enfileirada: created=${batch.created} reused=${batch.reused} ` +
    `total_items=${batch.total} — worker processará (${countsLog})`;
  console.log(msg);
  addLog('success', msg);

  return {
    items_enqueued: batch.total,
    items_created: batch.created,
    items_reused: batch.reused,
    audience: toAudienceSummary(audience),
    warning,
  };
}

/**
 * Cria dispatch tipo personalizada e enfileira elegíveis imediatamente.
 */
export async function createAndEnqueuePersonalizadaDispatch(
  input: CreatePersonalizadaInput
): Promise<CreatePersonalizadaResult> {
  const name = String(input.name || '').trim();
  const message_template = String(input.message_template || '');
  if (!name || !message_template) {
    throw new PersonalizadaDispatchError('Campos obrigatórios: name, message_template');
  }
  if (!input.list_id && (!input.contact_ids || input.contact_ids.length === 0)) {
    throw new PersonalizadaDispatchError('É necessário fornecer list_id ou contact_ids');
  }

  try {
    assertDispatchPipelineAllowed();
  } catch (e: any) {
    if (e instanceof DispatchOperationalError) {
      throw new PersonalizadaDispatchError(e.message, 400);
    }
    throw e;
  }

  const audience = await resolveAudience({
    list_id: input.list_id,
    contact_ids: input.contact_ids,
  });
  const summary = toAudienceSummary(audience);

  if (audience.eligible_now.length === 0) {
    if (audience.counts.needs_whatsapp_validation > 0) {
      throw new PersonalizadaDispatchError(PENDING_WHATSAPP_VALIDATION_MESSAGE, 422, summary);
    }
    throw new PersonalizadaDispatchError('Nenhum contato elegível para enfileirar.', 400, summary);
  }

  const dispatchType = input.legacy_marketing ? MARKETING_DISPATCH_TYPE : PERSONALIZADA_DISPATCH_TYPE;
  const meta = {
    ...(input.metadata || {}),
    ...(input.media_url ? { media_url: input.media_url } : {}),
    ...(input.media_type ? { media_type: input.media_type } : {}),
    pipeline: 'dispatch_items',
    enqueued_on_create: true,
  };

  const insert = await pool.query(
    `INSERT INTO dispatches (
      name, message_template, dispatch_type, list_id, contact_ids,
      instance_ids, total_contacts, status, created_by,
      blindage_config, metadata, started_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'running',$8,$9,$10,CURRENT_TIMESTAMP)
    RETURNING *`,
    [
      name,
      message_template,
      dispatchType,
      input.list_id || null,
      input.contact_ids || null,
      input.instance_ids || [],
      audience.eligible_now.length,
      input.created_by ?? null,
      JSON.stringify({}),
      JSON.stringify(meta),
    ]
  );

  const dispatch = insert.rows[0];
  const dispatchId = dispatch.id as number;

  try {
    const enq = await enqueuePersonalizadaDispatch({
      dispatchId,
      instanceIds: input.instance_ids,
    });

    const refreshed = await pool.query(`SELECT * FROM dispatches WHERE id = $1`, [dispatchId]);

    return {
      dispatch: refreshed.rows[0],
      audience: enq.audience,
      items_enqueued: enq.items_enqueued,
      items_created: enq.items_created,
      items_reused: enq.items_reused,
      warning: enq.warning,
      message:
        'Mensagem personalizada criada e enfileirada. O worker processará os itens — não há envio direto nesta etapa.',
    };
  } catch (e: any) {
    await pool.query(
      `UPDATE dispatches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [dispatchId]
    );
    if (e instanceof PersonalizadaDispatchError) throw e;
    if (e instanceof DispatchOperationalError) {
      throw new PersonalizadaDispatchError(e.message, 400, summary);
    }
    throw new PersonalizadaDispatchError(e?.message || String(e), 500, summary);
  }
}
