/**
 * Central operacional do disparo diário de devocional.
 * Apenas prepara/consulta — nunca chama Evolution.
 */
import { pool } from '../database';
import { formatDevocionalMessage, personalizeDevocionalMessage } from './devocionalPersonalization';
import {
  ensureDispatchItemsBatch,
  getDispatchItemsSummary,
  isDispatchItemSent,
} from './dispatchItems';
import { getDispatchRuntimeSnapshot } from './dispatchRuntimeConfig';
import { maskPhone } from './evolutionSafeSender';
import { reconcileActiveJourneyForDate } from './journeyReconcile';
import {
  autoValidateWhatsAppBatch,
  isWhatsAppAutoValidateOnPrepare,
  isWhatsAppAutoValidateOnWorker,
  resolveListAudience,
} from './listAudienceResolver';
import { addLog } from '../routes/logs';
import { normalizePhoneDigits } from '../utils/phoneNumber';
import { evaluateOperationalPolicy } from './workerConfigSnapshot';

function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function computeNextDispatchAt(
  hour: number,
  minute: number,
  timezone: string
): { next_at: string; is_today: boolean } {
  const tz = timezone || 'America/Sao_Paulo';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (t: string) => parts.find((p) => p.type === t)?.value || '0';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  const curH = Number(get('hour'));
  const curM = Number(get('minute'));

  let targetDay = d;
  let targetMonth = m;
  let targetYear = y;
  let isToday = true;

  if (curH > hour || (curH === hour && curM >= minute)) {
    // próximo dia civil no timezone (aproximação via Date UTC noon + 24h)
    const noon = new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
    noon.setUTCDate(noon.getUTCDate() + 1);
    targetYear = noon.getUTCFullYear();
    targetMonth = noon.getUTCMonth() + 1;
    targetDay = noon.getUTCDate();
    isToday = false;
  }

  const label = `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (${tz})`;
  return { next_at: label, is_today: isToday };
}

async function loadConfigAndList() {
  const configResult = await pool.query(
    `SELECT * FROM devocional_config ORDER BY id DESC LIMIT 1`
  );
  const config = configResult.rows[0] || null;

  let list: any = null;
  if (config?.list_id) {
    const listResult = await pool.query(`SELECT * FROM contact_lists WHERE id = $1`, [config.list_id]);
    list = listResult.rows[0] || null;
  }

  return { config, list };
}

async function findOrCreateTodayDevocional(dateYmd: string) {
  await reconcileActiveJourneyForDate(pool, dateYmd);

  let result = await pool.query(
    `SELECT id, title, text, date, versiculo_principal, versiculo_apoio, metadata
     FROM devocionais WHERE date = $1`,
    [dateYmd]
  );

  if (result.rows.length === 0) {
    try {
      const { DevocionalGenerator } = await import('./DevocionalGenerator');
      const generator = new DevocionalGenerator();
      await generator.generate(dateYmd);
      result = await pool.query(
        `SELECT id, title, text, date, versiculo_principal, versiculo_apoio, metadata
         FROM devocionais WHERE date = $1`,
        [dateYmd]
      );
    } catch (e: any) {
      return { devocional: null, generated: false, error: e?.message || String(e) };
    }
  }

  if (result.rows.length === 0) {
    return { devocional: null, generated: false, error: 'Devocional não disponível para a data' };
  }

  const row = result.rows[0];
  return {
    generated: false,
    error: null,
    devocional: {
      id: row.id,
      title: row.title,
      date: row.date,
      text: row.text,
      versiculo_principal:
        typeof row.versiculo_principal === 'string'
          ? JSON.parse(row.versiculo_principal)
          : row.versiculo_principal,
      versiculo_apoio:
        typeof row.versiculo_apoio === 'string' ? JSON.parse(row.versiculo_apoio) : row.versiculo_apoio,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    },
  };
}

async function findTodayDispatch(devocionalId: number, timezone: string, dateYmd: string) {
  const r = await pool.query(
    `SELECT id, name, status, total_contacts, contacts_processed, contacts_success, contacts_failed,
            started_at, completed_at, created_at, dispatch_type, list_id, devocional_id
     FROM dispatches
     WHERE dispatch_type = 'devocional'
       AND devocional_id = $1
       AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE $2) = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [devocionalId, timezone, dateYmd]
  );
  return r.rows[0] || null;
}

export async function getDevocionalOperationStatus() {
  const { config, list } = await loadConfigAndList();
  const runtime = getDispatchRuntimeSnapshot();
  const timezone = config?.timezone || 'America/Sao_Paulo';
  const dateYmd = todayInTimezone(timezone);

  let audienceSummary: any = null;
  if (list) {
    const audience = await resolveListAudience(list);
    audienceSummary = {
      total_potential: audience.counts.total_potential,
      eligible_now: audience.counts.eligible_now,
      needs_whatsapp_validation: audience.counts.needs_whatsapp_validation,
      excluded_opt_out: audience.counts.excluded_opt_out,
      excluded_no_opt_in: audience.counts.excluded_no_opt_in,
      excluded_invalid_phone: audience.counts.excluded_invalid_phone,
      excluded_whatsapp_invalid: audience.counts.excluded_whatsapp_invalid,
      excluded_by_score: audience.counts.excluded_by_score,
      excluded_by_filter: audience.counts.excluded_by_filter,
      auto_validate_on_prepare: isWhatsAppAutoValidateOnPrepare(),
    };
  }

  const instances = await pool.query(
    `SELECT i.id, i.instance_name, i.status, i.health_status, i.phone_number,
            g.next_available_at, g.cooldown_until,
            NULL::text AS last_error
     FROM instances i
     LEFT JOIN instance_send_guard g ON g.instance_id = i.id
     ORDER BY i.id ASC`
  );

  const connected = instances.rows.filter((i) => i.status === 'connected');
  const inCooldown = instances.rows.filter(
    (i) => i.cooldown_until && new Date(i.cooldown_until).getTime() > Date.now()
  );

  const blocks: Array<{ code: string; message: string }> = [];
  if (!config) {
    blocks.push({ code: 'NO_CONFIG', message: 'Configuração de devocional não encontrada' });
  } else {
    if (!config.enabled) {
      blocks.push({ code: 'DISABLED', message: 'Disparo automático desabilitado na configuração' });
    }
    if (!config.list_id || !list) {
      blocks.push({ code: 'NO_LIST', message: 'Nenhuma lista alvo configurada' });
    }
  }
  if (!runtime.workerEnabled) {
    blocks.push({
      code: 'WORKER_OFF',
      message: 'Worker desligado — a fila não será processada',
    });
  }
  if (runtime.realSendEnabled && runtime.dryRunEnabled) {
    blocks.push({
      code: 'REAL_SEND_AND_DRY_RUN_ENABLED',
      message: 'Envio real e simulação ligados juntos — configuração inválida',
    });
  }
  if (!runtime.realSendEnabled && !runtime.dryRunEnabled) {
    blocks.push({
      code: 'SEND_MODE_OFF',
      message: 'Nem envio real nem simulação estão ligados',
    });
  }
  if (connected.length === 0) {
    blocks.push({ code: 'NO_INSTANCE', message: 'Nenhuma instância WhatsApp conectada' });
  }

  const pendingWa = audienceSummary?.needs_whatsapp_validation ?? 0;
  const eligibleNow = audienceSummary?.eligible_now ?? 0;
  const allValidated = pendingWa === 0 && eligibleNow >= 0;
  const waPrepare = isWhatsAppAutoValidateOnPrepare();
  const waWorker = isWhatsAppAutoValidateOnWorker();

  if (
    runtime.realSendEnabled &&
    !runtime.dryRunEnabled &&
    !waPrepare &&
    !waWorker &&
    pendingWa > 0
  ) {
    blocks.push({
      code: 'WHATSAPP_VALIDATION_REQUIRED',
      message: `Validação WhatsApp desligada e ${pendingWa} contato(s) pendente(s)`,
    });
  }

  const policy = evaluateOperationalPolicy({
    workerEnabled: runtime.workerEnabled,
    realSendEnabled: runtime.realSendEnabled,
    dryRunEnabled: runtime.dryRunEnabled,
    waValidateOnPrepare: waPrepare,
    waValidateOnWorker: waWorker,
    pendingWhatsAppCount: pendingWa,
    allCurrentContactsValidated: allValidated && pendingWa === 0,
    hasConnectedInstance: connected.length > 0,
  });

  let operationalMode: 'bloqueado' | 'dry_run' | 'envio_real' | 'config_invalida' = 'bloqueado';
  if (policy.operational_mode === 'invalid_config') operationalMode = 'config_invalida';
  else if (policy.operational_mode === 'real_send') operationalMode = 'envio_real';
  else if (policy.operational_mode === 'dry_run') operationalMode = 'dry_run';
  else operationalMode = 'bloqueado';

  const next = config
    ? computeNextDispatchAt(config.dispatch_hour ?? 6, config.dispatch_minute ?? 0, timezone)
    : null;

  const cannot_send_reasons = policy.blocking_reasons.map((r) => ({
    code: r.code,
    message: r.message,
  }));

  return {
    date: dateYmd,
    timezone,
    operational_mode: operationalMode,
    can_send_real: policy.can_send_real,
    cannot_send_reasons,
    pending_whatsapp_validation_count: pendingWa,
    status_label: policy.status_label,
    config: config
      ? {
          id: config.id,
          enabled: !!config.enabled,
          dispatch_hour: config.dispatch_hour,
          dispatch_minute: config.dispatch_minute,
          timezone,
          list_id: config.list_id,
          notification_phone_masked: config.notification_phone
            ? maskPhone(config.notification_phone)
            : null,
        }
      : null,
    list: list
      ? {
          id: list.id,
          name: list.name,
          list_type: list.list_type,
          total_contacts_list: list.total_contacts,
        }
      : null,
    audience: audienceSummary || {
      total_potential: 0,
      eligible_now: 0,
      needs_whatsapp_validation: 0,
      excluded_opt_out: 0,
      excluded_no_opt_in: 0,
      excluded_invalid_phone: 0,
      excluded_whatsapp_invalid: 0,
      excluded_by_score: 0,
      excluded_by_filter: 0,
    },
    // compat com tela anterior
    audience_legacy: {
      estimated_total: audienceSummary?.total_potential ?? 0,
      estimated_eligible: audienceSummary?.eligible_now ?? 0,
    },
    runtime: {
      worker_enabled: runtime.workerEnabled,
      real_send_enabled: runtime.realSendEnabled,
      dry_run_enabled: runtime.dryRunEnabled,
      batch_size: runtime.batchSize,
      interval_ms: runtime.intervalMs,
    },
    instances: {
      connected_count: connected.length,
      cooldown_count: inCooldown.length,
      items: instances.rows.map((i) => ({
        id: i.id,
        instance_name: i.instance_name,
        status: i.status,
        health_status: i.health_status,
        phone_masked: i.phone_number ? maskPhone(i.phone_number) : null,
        next_available_at: i.next_available_at,
        cooldown_until: i.cooldown_until,
        last_error: i.last_error ? String(i.last_error).slice(0, 200) : null,
      })),
    },
    next_dispatch: next,
    blocks,
  };
}

export async function prepareTodayDevocionalOperation() {
  const { config, list } = await loadConfigAndList();
  if (!config) {
    throw Object.assign(new Error('Configuração de devocional não encontrada'), { status: 400 });
  }
  if (!list) {
    throw Object.assign(new Error('Lista alvo não configurada'), { status: 400 });
  }

  const timezone = config.timezone || 'America/Sao_Paulo';
  const dateYmd = todayInTimezone(timezone);

  const { devocional, error: genError } = await findOrCreateTodayDevocional(dateYmd);
  if (!devocional) {
    throw Object.assign(new Error(genError || 'Devocional do dia indisponível'), { status: 400 });
  }

  let audience = await resolveListAudience(list);

  let autoValidateResult = null;
  if (isWhatsAppAutoValidateOnPrepare() && audience.needs_whatsapp_validation.length > 0) {
    autoValidateResult = await autoValidateWhatsAppBatch(audience.needs_whatsapp_validation);
    audience = await resolveListAudience(list);
  }

  const eligible = audience.eligible_now;
  const exclusionCounts = {
    needs_whatsapp_validation: audience.counts.needs_whatsapp_validation,
    opt_out: audience.counts.excluded_opt_out,
    sem_opt_in: audience.counts.excluded_no_opt_in,
    telefone_invalido: audience.counts.excluded_invalid_phone,
    whatsapp_invalid: audience.counts.excluded_whatsapp_invalid,
    pontuacao_ou_bloqueio: audience.counts.excluded_by_score,
  };

  let dispatch = await findTodayDispatch(devocional.id, timezone, dateYmd);
  let dispatchCreated = false;

  if (!dispatch) {
    const formatted = formatDevocionalMessage(devocional);
    const ins = await pool.query(
      `INSERT INTO dispatches (
        name, message_template, dispatch_type, list_id,
        devocional_id, total_contacts, status, started_at, metadata
      ) VALUES ($1, $2, 'devocional', $3, $4, $5, 'running', CURRENT_TIMESTAMP, $6::jsonb)
      RETURNING id, name, status, total_contacts, contacts_processed, contacts_success, contacts_failed,
                started_at, completed_at, created_at, dispatch_type, list_id, devocional_id`,
      [
        `Devocional ${new Date().toLocaleDateString('pt-BR', { timeZone: timezone })}`,
        formatted,
        list.id,
        devocional.id,
        eligible.length,
        JSON.stringify({
          devocional_trigger: 'operation_prepare',
          devocional_title: devocional.title,
          devocional_date: dateYmd,
        }),
      ]
    );
    dispatch = ins.rows[0];
    dispatchCreated = true;
  }

  const dispatchId = dispatch.id as number;

  // Reabre se estava completed/failed — vamos (re)enfileirar todos os elegíveis
  await pool.query(
    `UPDATE dispatches
     SET status = 'running',
         completed_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status IN ('completed', 'failed', 'stopped', 'pending')`,
    [dispatchId]
  );

  const batch = await ensureDispatchItemsBatch({
    dispatchId,
    contacts: eligible,
    messageType: 'devocional',
    maxAttempts: 1,
    buildSnapshot: (contact) =>
      personalizeDevocionalMessage(
        formatDevocionalMessage(devocional),
        contact.name ?? null,
        timezone
      ),
  });

  if (batch.expected !== eligible.length) {
    const msg =
      `Preparação inconsistente: elegíveis=${eligible.length} mas telefones únicos=${batch.expected}` +
      (batch.duplicate_phones_skipped
        ? ` (duplicatas normalizadas=${batch.duplicate_phones_skipped})`
        : '');
    addLog('error', `[Operação] Dispatch ${dispatchId}: ${msg}`);
    throw Object.assign(new Error(msg), { status: 409 });
  }

  if (batch.total < eligible.length) {
    const msg = `Preparação incompleta: elegíveis=${eligible.length}, dispatch_items=${batch.total}`;
    addLog('error', `[Operação] Dispatch ${dispatchId}: ${msg}`);
    throw Object.assign(new Error(msg), { status: 409 });
  }

  let alreadySent = 0;
  for (const contact of eligible) {
    const phone = normalizePhoneDigits(contact.phone_number || '', '55');
    if (await isDispatchItemSent(dispatchId, phone)) {
      alreadySent++;
    }

    await pool.query(
      `INSERT INTO dispatch_contacts (dispatch_id, contact_number, contact_name, status)
       SELECT $1::int, $2::varchar(50), $3::varchar(255), 'pending'
       WHERE NOT EXISTS (
         SELECT 1 FROM dispatch_contacts WHERE dispatch_id = $4::int AND contact_number = $5::varchar(50)
       )`,
      [dispatchId, phone, contact.name, dispatchId, phone]
    );
  }

  await pool.query(
    `UPDATE dispatches
     SET total_contacts = $1,
         status = 'running',
         completed_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [eligible.length, dispatchId]
  );

  const summary = await getDispatchItemsSummary(dispatchId);
  if (summary.total < eligible.length) {
    const msg = `Após prepare: dispatch_items=${summary.total} < elegíveis=${eligible.length}`;
    addLog('error', `[Operação] Dispatch ${dispatchId}: ${msg}`);
    throw Object.assign(new Error(msg), { status: 409 });
  }

  return {
    date: dateYmd,
    dispatch_id: dispatchId,
    dispatch_created: dispatchCreated,
    devocional: {
      id: devocional.id,
      title: devocional.title,
      date: dateYmd,
    },
    audience: {
      total: audience.counts.total_potential,
      eligible: eligible.length,
      excluded: audience.counts.total_potential - eligible.length,
      needs_whatsapp_validation: audience.counts.needs_whatsapp_validation,
      exclusion_reasons: exclusionCounts,
      auto_validate: autoValidateResult,
    },
    items: {
      created: batch.created,
      reused: batch.reused,
      total: batch.total,
      already_sent: alreadySent,
      summary,
    },
    note: 'Preparação concluída sem envio. O worker processa a fila conforme as flags operacionais.',
  };
}

export async function getTodayDevocionalOperation() {
  const { config, list } = await loadConfigAndList();
  const timezone = config?.timezone || 'America/Sao_Paulo';
  const dateYmd = todayInTimezone(timezone);

  const devResult = await pool.query(
    `SELECT id, title, text, date, versiculo_principal, versiculo_apoio, metadata
     FROM devocionais WHERE date = $1`,
    [dateYmd]
  );

  let todayDevocional: any = null;
  if (devResult.rows[0]) {
    const row = devResult.rows[0];
    const text = String(row.text || '');
    todayDevocional = {
      id: row.id,
      title: row.title,
      date: row.date,
      text_preview: text.length > 280 ? `${text.slice(0, 280)}…` : text,
      versiculo_principal:
        typeof row.versiculo_principal === 'string'
          ? JSON.parse(row.versiculo_principal)
          : row.versiculo_principal,
      versiculo_apoio:
        typeof row.versiculo_apoio === 'string' ? JSON.parse(row.versiculo_apoio) : row.versiculo_apoio,
    };
  }

  let dispatch: any = null;
  let itemsSummary: any = null;
  let recentErrors: any[] = [];
  let nextItems: any[] = [];

  if (todayDevocional) {
    dispatch = await findTodayDispatch(todayDevocional.id, timezone, dateYmd);
    if (dispatch) {
      itemsSummary = await getDispatchItemsSummary(dispatch.id);

      const errR = await pool.query(
        `SELECT id, contact_name, contact_number, status, error_category, error_message,
                failed_at, updated_at, instance_id
         FROM dispatch_items
         WHERE dispatch_id = $1
           AND (status IN ('failed', 'skipped') OR error_message IS NOT NULL)
         ORDER BY COALESCE(failed_at, updated_at) DESC NULLS LAST
         LIMIT 15`,
        [dispatch.id]
      );
      recentErrors = errR.rows.map((r) => ({
        id: r.id,
        contact_name: r.contact_name,
        contact_number_masked: maskPhone(r.contact_number),
        status: r.status,
        error_category: r.error_category,
        error_message: r.error_message ? String(r.error_message).slice(0, 200) : null,
        failed_at: r.failed_at,
        instance_id: r.instance_id,
      }));

      const nextR = await pool.query(
        `SELECT id, contact_name, contact_number, status, next_retry_at, scheduled_at, created_at
         FROM dispatch_items
         WHERE dispatch_id = $1 AND status IN ('pending', 'pending_retry')
         ORDER BY COALESCE(next_retry_at, scheduled_at, created_at) ASC NULLS FIRST
         LIMIT 20`,
        [dispatch.id]
      );
      nextItems = nextR.rows.map((r) => ({
        id: r.id,
        contact_name: r.contact_name,
        contact_number_masked: maskPhone(r.contact_number),
        status: r.status,
        next_retry_at: r.next_retry_at,
        scheduled_at: r.scheduled_at,
      }));
    }
  }

  const dryRunCount = dispatch
    ? (
        await pool.query(
          `SELECT COUNT(*)::int AS c FROM dispatch_items
           WHERE dispatch_id = $1 AND error_category = 'dry_run'`,
          [dispatch.id]
        )
      ).rows[0].c
    : 0;

  const inconsistencies: Array<{ code: string; message: string }> = [];
  if (list && todayDevocional) {
    const audience = await resolveListAudience(list);
    const eligibleNow = audience.counts.eligible_now;
    if (dispatch && itemsSummary) {
      if (eligibleNow > itemsSummary.total) {
        inconsistencies.push({
          code: 'ITEMS_LT_ELIGIBLE',
          message: `Elegíveis agora (${eligibleNow}) > dispatch_items (${itemsSummary.total}). Reexecute Preparar envio de hoje.`,
        });
      }
      if (Number(dispatch.total_contacts) > itemsSummary.total) {
        inconsistencies.push({
          code: 'ITEMS_LT_TOTAL_CONTACTS',
          message: `total_contacts (${dispatch.total_contacts}) > dispatch_items (${itemsSummary.total}). Fila incompleta.`,
        });
      }
      if (
        dispatch.status === 'completed' &&
        itemsSummary.terminal < Number(dispatch.total_contacts || 0)
      ) {
        inconsistencies.push({
          code: 'COMPLETED_EARLY',
          message: `Dispatch completed com terminais (${itemsSummary.terminal}) < total_contacts (${dispatch.total_contacts}). Conclusão indevida.`,
        });
      }
      if (
        dispatch.status === 'completed' &&
        itemsSummary.open > 0
      ) {
        inconsistencies.push({
          code: 'COMPLETED_WITH_OPEN',
          message: `Dispatch completed com ${itemsSummary.open} item(ns) ainda aberto(s).`,
        });
      }
    } else if (eligibleNow > 0 && !dispatch) {
      inconsistencies.push({
        code: 'NO_DISPATCH_YET',
        message: `Há ${eligibleNow} elegíveis, mas ainda não há dispatch de hoje. Use Preparar envio de hoje.`,
      });
    }
  }

  const guards = await pool.query(
    `SELECT i.id, i.instance_name, i.status, g.next_available_at, g.cooldown_until
     FROM instances i
     LEFT JOIN instance_send_guard g ON g.instance_id = i.id
     WHERE i.status = 'connected'
     ORDER BY g.next_available_at ASC NULLS FIRST
     LIMIT 10`
  );

  return {
    date: dateYmd,
    timezone,
    config: config
      ? {
          enabled: !!config.enabled,
          dispatch_hour: config.dispatch_hour,
          dispatch_minute: config.dispatch_minute,
          list_id: config.list_id,
        }
      : null,
    list: list ? { id: list.id, name: list.name, list_type: list.list_type } : null,
    devocional: todayDevocional,
    dispatch: dispatch
      ? {
          id: dispatch.id,
          name: dispatch.name,
          status: dispatch.status,
          total_contacts: dispatch.total_contacts,
          contacts_processed: dispatch.contacts_processed,
          contacts_success: dispatch.contacts_success,
          contacts_failed: dispatch.contacts_failed,
          started_at: dispatch.started_at,
          completed_at: dispatch.completed_at,
        }
      : null,
    items_summary: itemsSummary,
    dry_run_marked: dryRunCount,
    inconsistencies,
    recent_errors: recentErrors,
    next_items: nextItems,
    instances_guard: guards.rows.map((g) => ({
      id: g.id,
      instance_name: g.instance_name,
      status: g.status,
      next_available_at: g.next_available_at,
      cooldown_until: g.cooldown_until,
    })),
  };
}

export async function getTodayDevocionalQueue(params: {
  page?: number;
  pageSize?: number;
  status?: string | null;
}) {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 25));
  const offset = (page - 1) * pageSize;

  const { config } = await loadConfigAndList();
  const timezone = config?.timezone || 'America/Sao_Paulo';
  const dateYmd = todayInTimezone(timezone);

  const dev = await pool.query(`SELECT id FROM devocionais WHERE date = $1`, [dateYmd]);
  if (dev.rows.length === 0) {
    return { date: dateYmd, dispatch_id: null, total: 0, page, page_size: pageSize, items: [] };
  }

  const dispatch = await findTodayDispatch(dev.rows[0].id, timezone, dateYmd);
  if (!dispatch) {
    return { date: dateYmd, dispatch_id: null, total: 0, page, page_size: pageSize, items: [] };
  }

  const filters: any[] = [dispatch.id];
  let statusClause = '';
  if (params.status) {
    filters.push(params.status);
    statusClause = ` AND di.status = $${filters.length}`;
  }

  const countR = await pool.query(
    `SELECT COUNT(*)::int AS c FROM dispatch_items di WHERE di.dispatch_id = $1${statusClause}`,
    filters
  );

  filters.push(pageSize, offset);
  const rows = await pool.query(
    `SELECT di.id, di.contact_name, di.contact_number, di.status, di.instance_id,
            di.error_category, di.error_message, di.attempt_count,
            di.scheduled_at, di.started_at, di.sent_at, di.failed_at, di.next_retry_at,
            di.created_at, di.updated_at, i.instance_name
     FROM dispatch_items di
     LEFT JOIN instances i ON i.id = di.instance_id
     WHERE di.dispatch_id = $1${statusClause}
     ORDER BY di.id ASC
     LIMIT $${filters.length - 1} OFFSET $${filters.length}`,
    filters
  );

  return {
    date: dateYmd,
    dispatch_id: dispatch.id,
    total: countR.rows[0].c,
    page,
    page_size: pageSize,
    items: rows.rows.map((r) => ({
      id: r.id,
      contact_name: r.contact_name,
      contact_number_masked: maskPhone(r.contact_number),
      status: r.status,
      instance_id: r.instance_id,
      instance_name: r.instance_name,
      error_category: r.error_category,
      error_message: r.error_message ? String(r.error_message).slice(0, 200) : null,
      attempt_count: r.attempt_count,
      scheduled_at: r.scheduled_at,
      started_at: r.started_at,
      sent_at: r.sent_at,
      failed_at: r.failed_at,
      next_retry_at: r.next_retry_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  };
}
