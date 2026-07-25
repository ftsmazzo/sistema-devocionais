/**
 * Fonte única para resolver público de listas (static / dynamic / hybrid).
 * Não força whatsapp_validated=true na query inicial.
 * Validação WhatsApp é elegibilidade — não faz o contato “sumir” do potencial.
 */
import { pool } from '../database';
import { normalizePhoneDigits } from '../utils/phoneNumber';
import { maskPhone } from './evolutionSafeSender';
import {
  applyWhatsAppValidationToContact,
  checkWhatsAppNumberDetailed,
} from './whatsappValidation';

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

export function isWhatsAppAutoValidateOnPrepare(): boolean {
  return envFlag('WHATSAPP_AUTO_VALIDATE_ON_PREPARE', false);
}

export function isWhatsAppAutoValidateOnWorker(): boolean {
  return envFlag('WHATSAPP_AUTO_VALIDATE_ON_WORKER', false);
}

export function getWhatsAppValidationBatchSize(): number {
  return envInt('WHATSAPP_VALIDATION_BATCH_SIZE', 10);
}

export type AudienceExclusionReason =
  | 'eligible'
  | 'needs_whatsapp_validation'
  | 'excluded_opt_out'
  | 'excluded_no_opt_in'
  | 'excluded_invalid_phone'
  | 'excluded_whatsapp_invalid'
  | 'excluded_by_score';

export interface AudienceContact {
  id: number;
  phone_number: string;
  name: string | null;
  opt_in: boolean;
  opt_out: boolean;
  whatsapp_validated: boolean | null;
  whatsapp_validated_at: string | Date | null;
}

export interface AudienceItemSummary {
  contact_id: number;
  name: string | null;
  phone_masked: string;
  reason: AudienceExclusionReason;
  reason_label: string;
}

export interface ResolvedAudience {
  list_id: number;
  list_type: string;
  total_potential: number;
  eligible_now: AudienceContact[];
  needs_whatsapp_validation: AudienceContact[];
  excluded_opt_out: AudienceContact[];
  excluded_no_opt_in: AudienceContact[];
  excluded_invalid_phone: AudienceContact[];
  excluded_whatsapp_invalid: AudienceContact[];
  excluded_by_score: AudienceContact[];
  /** Alias legado de excluded_by_score */
  excluded_by_filter: AudienceContact[];
  items: AudienceItemSummary[];
  counts: {
    total_potential: number;
    eligible_now: number;
    needs_whatsapp_validation: number;
    excluded_opt_out: number;
    excluded_no_opt_in: number;
    excluded_invalid_phone: number;
    excluded_whatsapp_invalid: number;
    excluded_by_score: number;
    excluded_by_filter: number;
  };
}

const REASON_LABELS: Record<AudienceExclusionReason, string> = {
  eligible: 'Elegível agora',
  needs_whatsapp_validation: 'Pendente de validação WhatsApp',
  excluded_opt_out: 'Opt-out',
  excluded_no_opt_in: 'Sem opt-in',
  excluded_invalid_phone: 'Telefone inválido',
  excluded_whatsapp_invalid: 'WhatsApp inválido (confirmado)',
  excluded_by_score: 'Bloqueado por pontuação/tag',
};

function parseFilterConfig(list: any): any {
  if (!list?.filter_config) return {};
  return typeof list.filter_config === 'string'
    ? JSON.parse(list.filter_config || '{}')
    : list.filter_config || {};
}

function mapContactRow(r: any): AudienceContact {
  return {
    id: r.id,
    phone_number: r.phone_number,
    name: r.name,
    opt_in: !!r.opt_in,
    opt_out: !!r.opt_out,
    whatsapp_validated: r.whatsapp_validated == null ? null : !!r.whatsapp_validated,
    whatsapp_validated_at: r.whatsapp_validated_at ?? null,
  };
}

function hasDynamicFilters(filterConfig: any): boolean {
  return (
    (filterConfig.tags && filterConfig.tags.length > 0) ||
    (filterConfig.exclude_tags && filterConfig.exclude_tags.length > 0) ||
    filterConfig.opt_in !== undefined ||
    filterConfig.opt_out !== undefined ||
    filterConfig.whatsapp_validated !== undefined ||
    !!filterConfig.last_message_sent_after ||
    !!filterConfig.last_message_sent_before
  );
}

/**
 * Busca contatos potenciais da lista sem filtrar whatsapp_validated
 * (salvo se o filter_config da lista pedir explicitamente).
 */
export async function fetchListPotentialContacts(list: any): Promise<AudienceContact[]> {
  const listType = list.list_type || 'static';
  const filterConfig = parseFilterConfig(list);
  let query = '';
  const params: any[] = [];

  if (listType === 'static') {
    query = `
      SELECT DISTINCT c.id, c.phone_number, c.name, c.opt_in, c.opt_out,
             c.whatsapp_validated, c.whatsapp_validated_at
      FROM contacts c
      JOIN contact_list_items cli ON c.id = cli.contact_id
      WHERE cli.list_id = $1
    `;
    params.push(list.id);
  } else {
    let whereConditions: string[] = [];
    let joinClauses = '';
    let paramCount = 1;

    if (filterConfig.tags && Array.isArray(filterConfig.tags) && filterConfig.tags.length > 0) {
      joinClauses += ` JOIN contact_tag_relations ctr${paramCount} ON c.id = ctr${paramCount}.contact_id`;
      whereConditions.push(`ctr${paramCount}.tag_id = ANY($${paramCount}::int[])`);
      params.push(filterConfig.tags);
      paramCount++;
    }

    if (filterConfig.exclude_tags && Array.isArray(filterConfig.exclude_tags) && filterConfig.exclude_tags.length > 0) {
      whereConditions.push(`NOT EXISTS (
        SELECT 1 FROM contact_tag_relations ctr_ex
        WHERE ctr_ex.contact_id = c.id
          AND ctr_ex.tag_id = ANY($${paramCount}::int[])
      )`);
      params.push(filterConfig.exclude_tags);
      paramCount++;
    }

    if (filterConfig.opt_in !== undefined) {
      whereConditions.push(`c.opt_in = $${paramCount}`);
      params.push(!!filterConfig.opt_in);
      paramCount++;
    }

    if (filterConfig.opt_out !== undefined) {
      whereConditions.push(`c.opt_out = $${paramCount}`);
      params.push(!!filterConfig.opt_out);
      paramCount++;
    }

    // Só aplica whatsapp_validated se o usuário configurou explicitamente no filtro da lista
    if (filterConfig.whatsapp_validated !== undefined) {
      whereConditions.push(`c.whatsapp_validated = $${paramCount}`);
      params.push(!!filterConfig.whatsapp_validated);
      paramCount++;
    }

    if (filterConfig.last_message_sent_after) {
      whereConditions.push(`c.last_message_sent_at >= $${paramCount}`);
      params.push(filterConfig.last_message_sent_after);
      paramCount++;
    }

    if (filterConfig.last_message_sent_before) {
      whereConditions.push(`c.last_message_sent_at <= $${paramCount}`);
      params.push(filterConfig.last_message_sent_before);
      paramCount++;
    }

    const whereSql = whereConditions.length > 0 ? whereConditions.join(' AND ') : 'TRUE';

    if (listType === 'hybrid') {
      if (!hasDynamicFilters(filterConfig)) {
        query = `
          SELECT DISTINCT c.id, c.phone_number, c.name, c.opt_in, c.opt_out,
                 c.whatsapp_validated, c.whatsapp_validated_at
          FROM contacts c
          JOIN contact_list_items cli ON c.id = cli.contact_id
          WHERE cli.list_id = $1
        `;
        params.length = 0;
        params.push(list.id);
      } else {
        // Estáticos ∪ dinâmicos, DISTINCT por id
        query = `
          SELECT DISTINCT c.id, c.phone_number, c.name, c.opt_in, c.opt_out,
                 c.whatsapp_validated, c.whatsapp_validated_at
          FROM contacts c
          WHERE (
            c.id IN (SELECT contact_id FROM contact_list_items WHERE list_id = $${paramCount})
            OR c.id IN (
              SELECT DISTINCT c2.id
              FROM contacts c2
              ${joinClauses.replace(/\bc\b/g, 'c2')}
              WHERE ${whereSql.replace(/\bc\./g, 'c2.')}
            )
          )
        `;
        params.push(list.id);
      }
    } else {
      // dynamic
      query = `
        SELECT DISTINCT c.id, c.phone_number, c.name, c.opt_in, c.opt_out,
               c.whatsapp_validated, c.whatsapp_validated_at
        FROM contacts c
        ${joinClauses}
        WHERE ${whereSql}
      `;
    }
  }

  const result = await pool.query(query, params);
  return result.rows.map(mapContactRow);
}

async function isExcludedByScoringOrBlock(contactId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 
       c.consecutive_devocional_failures,
       COUNT(ctr.tag_id) FILTER (WHERE t.name = 'bloqueado') as has_bloqueado_tag
     FROM contacts c
     LEFT JOIN contact_tag_relations ctr ON c.id = ctr.contact_id
     LEFT JOIN contact_tags t ON ctr.tag_id = t.id AND t.name = 'bloqueado'
     WHERE c.id = $1
     GROUP BY c.id, c.consecutive_devocional_failures`,
    [contactId]
  );
  if (result.rows.length === 0) return true;
  const row = result.rows[0];
  if ((row.consecutive_devocional_failures || 0) >= 3) return true;
  if ((row.has_bloqueado_tag || 0) > 0) return true;
  return false;
}

function isInvalidPhone(phone: string | null | undefined): boolean {
  const n = normalizePhoneDigits(phone || '', '55');
  return !n || n.length < 10;
}

/**
 * WhatsApp inválido confirmado: validação já ocorreu (timestamp) e resultado é false.
 * Pendente: nunca validado com sucesso (sem timestamp) ou null — não some do potencial.
 */
export function isConfirmedWhatsAppInvalid(contact: AudienceContact): boolean {
  if (contact.whatsapp_validated === true) return false;
  if (contact.whatsapp_validated === false && contact.whatsapp_validated_at != null) {
    return true;
  }
  return false;
}

export function isPendingWhatsAppValidation(contact: AudienceContact): boolean {
  if (contact.whatsapp_validated === true) return false;
  if (isConfirmedWhatsAppInvalid(contact)) return false;
  return true;
}

function toItem(c: AudienceContact, reason: AudienceExclusionReason): AudienceItemSummary {
  return {
    contact_id: c.id,
    name: c.name,
    phone_masked: maskPhone(c.phone_number),
    reason,
    reason_label: REASON_LABELS[reason],
  };
}

export type CategorizedAudience = Omit<ResolvedAudience, 'list_id' | 'list_type'> & {
  list_id?: number;
  list_type?: string;
};

/**
 * Categoriza contatos já carregados (sem forçar whatsapp_validated na existência).
 */
export async function categorizeAudienceContacts(
  potential: AudienceContact[],
  meta?: { list_id?: number; list_type?: string }
): Promise<CategorizedAudience> {
  const eligible_now: AudienceContact[] = [];
  const needs_whatsapp_validation: AudienceContact[] = [];
  const excluded_opt_out: AudienceContact[] = [];
  const excluded_no_opt_in: AudienceContact[] = [];
  const excluded_invalid_phone: AudienceContact[] = [];
  const excluded_whatsapp_invalid: AudienceContact[] = [];
  const excluded_by_score: AudienceContact[] = [];
  const items: AudienceItemSummary[] = [];

  for (const c of potential) {
    if (isInvalidPhone(c.phone_number)) {
      excluded_invalid_phone.push(c);
      items.push(toItem(c, 'excluded_invalid_phone'));
      continue;
    }
    if (c.opt_out) {
      excluded_opt_out.push(c);
      items.push(toItem(c, 'excluded_opt_out'));
      continue;
    }
    if (!c.opt_in) {
      excluded_no_opt_in.push(c);
      items.push(toItem(c, 'excluded_no_opt_in'));
      continue;
    }

    // Invalid WA confirmado antes de score — evita misturar com tag "bloqueado" pós-validação
    if (isConfirmedWhatsAppInvalid(c)) {
      excluded_whatsapp_invalid.push(c);
      items.push(toItem(c, 'excluded_whatsapp_invalid'));
      continue;
    }

    if (await isExcludedByScoringOrBlock(c.id)) {
      excluded_by_score.push(c);
      items.push(toItem(c, 'excluded_by_score'));
      continue;
    }

    if (c.whatsapp_validated === true) {
      eligible_now.push(c);
      items.push(toItem(c, 'eligible'));
    } else {
      needs_whatsapp_validation.push(c);
      items.push(toItem(c, 'needs_whatsapp_validation'));
    }
  }

  const counts = {
    total_potential: potential.length,
    eligible_now: eligible_now.length,
    needs_whatsapp_validation: needs_whatsapp_validation.length,
    excluded_opt_out: excluded_opt_out.length,
    excluded_no_opt_in: excluded_no_opt_in.length,
    excluded_invalid_phone: excluded_invalid_phone.length,
    excluded_whatsapp_invalid: excluded_whatsapp_invalid.length,
    excluded_by_score: excluded_by_score.length,
    excluded_by_filter: excluded_by_score.length,
  };

  return {
    list_id: meta?.list_id,
    list_type: meta?.list_type,
    total_potential: potential.length,
    eligible_now,
    needs_whatsapp_validation,
    excluded_opt_out,
    excluded_no_opt_in,
    excluded_invalid_phone,
    excluded_whatsapp_invalid,
    excluded_by_score,
    excluded_by_filter: excluded_by_score,
    items,
    counts,
  };
}

export function formatAudienceCountsLog(counts: CategorizedAudience['counts']): string {
  return (
    `potencial=${counts.total_potential} elegíveis=${counts.eligible_now} ` +
    `pendentes_wa=${counts.needs_whatsapp_validation} wa_inválido=${counts.excluded_whatsapp_invalid} ` +
    `opt_out=${counts.excluded_opt_out} sem_opt_in=${counts.excluded_no_opt_in} ` +
    `tel_inválido=${counts.excluded_invalid_phone} pontuação=${counts.excluded_by_score}`
  );
}

export const PENDING_WHATSAPP_VALIDATION_MESSAGE =
  'Existem contatos pendentes de validação WhatsApp; valide ou habilite validação automática.';

/**
 * Resolve público de IDs explícitos (disparo por contact_ids) com as mesmas regras de elegibilidade.
 */
export async function resolveContactsByIds(contactIds: number[]): Promise<CategorizedAudience> {
  if (!contactIds.length) {
    return categorizeAudienceContacts([]);
  }
  const result = await pool.query(
    `SELECT DISTINCT c.id, c.phone_number, c.name, c.opt_in, c.opt_out,
            c.whatsapp_validated, c.whatsapp_validated_at
     FROM contacts c
     WHERE c.id = ANY($1::int[])`,
    [contactIds]
  );
  return categorizeAudienceContacts(result.rows.map(mapContactRow));
}

/**
 * Resolve público em categorias. Não some com contatos não validados.
 */
export async function resolveListAudience(listOrId: any | number): Promise<ResolvedAudience> {
  let list = listOrId;
  if (typeof listOrId === 'number') {
    const r = await pool.query(`SELECT * FROM contact_lists WHERE id = $1`, [listOrId]);
    if (r.rows.length === 0) {
      throw new Error(`Lista ${listOrId} não encontrada`);
    }
    list = r.rows[0];
  }

  const potential = await fetchListPotentialContacts(list);
  const categorized = await categorizeAudienceContacts(potential, {
    list_id: list.id,
    list_type: list.list_type,
  });

  return {
    ...categorized,
    list_id: list.id,
    list_type: list.list_type,
  };
}

export interface AutoValidateBatchResult {
  attempted: number;
  validated: number;
  invalid: number;
  provider_errors: number;
  newly_eligible_ids: number[];
}

/**
 * Valida lote de contatos pendentes (prepare). Não envia mensagem.
 */
export async function autoValidateWhatsAppBatch(
  contacts: AudienceContact[],
  batchSize: number = getWhatsAppValidationBatchSize()
): Promise<AutoValidateBatchResult> {
  const slice = contacts.slice(0, Math.max(1, batchSize));
  const result: AutoValidateBatchResult = {
    attempted: 0,
    validated: 0,
    invalid: 0,
    provider_errors: 0,
    newly_eligible_ids: [],
  };

  for (const c of slice) {
    result.attempted++;
    try {
      const detailed = await checkWhatsAppNumberDetailed(c.phone_number);
      if (!detailed.ok) {
        result.provider_errors++;
        console.log(
          `[Audience] Validação provider indisponível para ${maskPhone(c.phone_number)}: ${detailed.message}`
        );
        continue;
      }
      await applyWhatsAppValidationToContact(c.id, detailed.isValid);
      if (detailed.isValid) {
        result.validated++;
        result.newly_eligible_ids.push(c.id);
      } else {
        result.invalid++;
      }
    } catch (e: any) {
      result.provider_errors++;
      console.error(`[Audience] Erro validando contato ${c.id}:`, e?.message || e);
    }
  }

  return result;
}

/**
 * Contagem DISTINCT para atualizar total_contacts de listas dinâmicas/híbridas.
 */
export async function countListPotentialContacts(list: any): Promise<number> {
  const contacts = await fetchListPotentialContacts(list);
  return contacts.length;
}
