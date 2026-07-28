/**
 * Enfileiramento compartilhado de público de devocional → dispatch_items (+ espelho dispatch_contacts).
 * Usado pelo scheduler automático e pelo start manual.
 */
import { pool } from '../database';
import { ensureDispatchItemsBatch, isDispatchItemSent } from './dispatchItems';
import { personalizeDevocionalMessage, formatDevocionalMessage } from './devocionalPersonalization';
import { normalizePhoneDigits } from '../utils/phoneNumber';
import { recordDispatchEvent } from './dispatchSendEvents';

export type EnqueueDevocionalContact = {
  id?: number | null;
  phone_number: string;
  name?: string | null;
};

export type EnqueueDevocionalAudienceResult = {
  created: number;
  reused: number;
  total: number;
  expected: number;
  enqueuedContacts: number;
  alreadySent: number;
  duplicate_phones_skipped: number;
};

/**
 * Cria/reutiliza dispatch_items e espelha pending em dispatch_contacts.
 * Atualiza total_contacts / contacts_processed / status=running.
 */
export async function enqueueDevocionalAudience(params: {
  dispatchId: number;
  contacts: EnqueueDevocionalContact[];
  devocional: {
    title?: string | null;
    text?: string | null;
    versiculo_principal?: string | null;
    versiculo_apoio?: string | null;
    metadata?: unknown;
  };
  timezone?: string;
  instancePoolIds?: number[] | null;
  logPrefix?: string;
}): Promise<EnqueueDevocionalAudienceResult> {
  const {
    dispatchId,
    contacts,
    devocional,
    timezone = 'America/Sao_Paulo',
    instancePoolIds = null,
    logPrefix = `[Devocional ${dispatchId}]`,
  } = params;

  const formatted = formatDevocionalMessage({
    title: String(devocional.title || ''),
    text: String(devocional.text || ''),
    versiculo_principal: (devocional as any).versiculo_principal,
    versiculo_apoio: (devocional as any).versiculo_apoio,
  });

  const batch = await ensureDispatchItemsBatch({
    dispatchId,
    contacts,
    messageType: 'devocional',
    maxAttempts: 1,
    instancePoolIds,
    buildSnapshot: (contact) =>
      personalizeDevocionalMessage(formatted, contact.name ?? null, timezone),
  });

  if (batch.expected !== contacts.length || batch.total < contacts.length) {
    const msg =
      `Enfileiramento incompleto: elegíveis=${contacts.length}, ` +
      `únicos=${batch.expected}, dispatch_items=${batch.total}`;
    throw new Error(msg);
  }

  let enqueuedContacts = 0;
  let alreadySent = 0;

  for (const contact of contacts) {
    const phone = normalizePhoneDigits(contact.phone_number || '', '55');
    if (await isDispatchItemSent(dispatchId, phone)) {
      alreadySent++;
      continue;
    }

    await pool.query(
      `INSERT INTO dispatch_contacts (dispatch_id, contact_number, contact_name, status)
       SELECT $1::int, $2::varchar(50), $3::varchar(255), 'pending'
       WHERE NOT EXISTS (
         SELECT 1 FROM dispatch_contacts
         WHERE dispatch_id = $4::int AND contact_number = $5::varchar(50)
       )`,
      [dispatchId, phone, contact.name ?? null, dispatchId, phone]
    );
    enqueuedContacts++;
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

  await recordDispatchEvent({
    dispatchId,
    level: 'success',
    code: 'ENQUEUE',
    message:
      `${logPrefix} items=${batch.total} created=${batch.created} reused=${batch.reused} ` +
      `contacts=${enqueuedContacts} already_sent=${alreadySent}`,
    meta: {
      created: batch.created,
      reused: batch.reused,
      total: batch.total,
      enqueuedContacts,
      alreadySent,
      pool: instancePoolIds,
    },
  });

  return {
    created: batch.created,
    reused: batch.reused,
    total: batch.total,
    expected: batch.expected,
    enqueuedContacts,
    alreadySent,
    duplicate_phones_skipped: batch.duplicate_phones_skipped,
  };
}
