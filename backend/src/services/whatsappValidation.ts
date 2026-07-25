import axios from 'axios';
import { pool } from '../database';
import { normalizePhoneDigits } from '../utils/phoneNumber';
import { maskPhone } from './evolutionSafeSender';

export type WhatsAppCheckDetailed =
  | { ok: true; isValid: boolean; cached?: boolean }
  | { ok: false; providerUnavailable: true; message: string };

/**
 * Verifica se um número de telefone está registrado no WhatsApp usando Evolution API
 */
export async function checkWhatsAppNumber(
  phoneNumber: string,
  instanceName?: string,
  apiUrl?: string,
  apiKey?: string
): Promise<{ isValid: boolean; cached?: boolean }> {
  const detailed = await checkWhatsAppNumberDetailed(phoneNumber, instanceName, apiUrl, apiKey);
  if (!detailed.ok) {
    return { isValid: false };
  }
  return { isValid: detailed.isValid, cached: detailed.cached };
}

/**
 * Versão detalhada: distingue número inválido de falha de provider.
 * Usa chat/whatsappNumbers — NÃO chama /message/sendText/.
 */
export async function checkWhatsAppNumberDetailed(
  phoneNumber: string,
  instanceName?: string,
  apiUrl?: string,
  apiKey?: string
): Promise<WhatsAppCheckDetailed> {
  try {
    const normalizedNumber = normalizePhoneDigits(phoneNumber, '55');

    if (!normalizedNumber || normalizedNumber.length < 10) {
      return { ok: true, isValid: false };
    }

    const cacheResult = await pool.query(
      `SELECT is_valid, checked_at 
       FROM number_validation_cache 
       WHERE phone_number = $1 
         AND checked_at > NOW() - INTERVAL '24 hours'`,
      [normalizedNumber]
    );

    if (cacheResult.rows.length > 0) {
      return {
        ok: true,
        isValid: !!cacheResult.rows[0].is_valid,
        cached: true,
      };
    }

    let resolvedName = instanceName;
    let resolvedUrl = apiUrl;
    let resolvedKey = apiKey;

    if (!resolvedName || !resolvedUrl || !resolvedKey) {
      const instanceResult = await pool.query(
        `SELECT instance_name, api_url, api_key 
         FROM instances 
         WHERE status = 'connected' 
         LIMIT 1`
      );

      if (instanceResult.rows.length === 0) {
        return {
          ok: false,
          providerUnavailable: true,
          message: 'Nenhuma instância conectada para validar número',
        };
      }

      resolvedName = instanceResult.rows[0].instance_name;
      resolvedUrl = instanceResult.rows[0].api_url;
      resolvedKey = instanceResult.rows[0].api_key;
    }

    let checkUrl = `${resolvedUrl}/chat/whatsappNumbers/${resolvedName}`;
    let checkResponse: any;

    try {
      checkResponse = await axios.post(
        checkUrl,
        { numbers: [normalizedNumber] },
        {
          headers: {
            apikey: resolvedKey,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
          validateStatus: () => true,
        }
      );
    } catch (postError: any) {
      if (postError.response?.status === 404 || postError.code === 'ECONNREFUSED') {
        checkUrl = `${resolvedUrl}/chat/whatsappNumbers/${resolvedName}?numbers=${normalizedNumber}`;
        try {
          checkResponse = await axios.get(checkUrl, {
            headers: { apikey: resolvedKey },
            timeout: 10000,
            validateStatus: () => true,
          });
        } catch (getError: any) {
          return {
            ok: false,
            providerUnavailable: true,
            message: getError?.message || 'Falha ao consultar Evolution (whatsappNumbers)',
          };
        }
      } else if (
        postError.code === 'ETIMEDOUT' ||
        postError.code === 'ENOTFOUND' ||
        postError.code === 'ECONNREFUSED'
      ) {
        return {
          ok: false,
          providerUnavailable: true,
          message: postError.message || 'Provider indisponível',
        };
      } else {
        throw postError;
      }
    }

    if (checkResponse && typeof checkResponse.status === 'number' && checkResponse.status >= 500) {
      return {
        ok: false,
        providerUnavailable: true,
        message: `Evolution HTTP ${checkResponse.status}`,
      };
    }

    let isValid = false;

    if (checkResponse && checkResponse.data) {
      if (Array.isArray(checkResponse.data)) {
        const numberStatus = checkResponse.data.find(
          (n: any) =>
            n.jid === `${normalizedNumber}@s.whatsapp.net` ||
            n.number === normalizedNumber ||
            n.jid?.includes(normalizedNumber)
        );
        isValid =
          numberStatus?.exists === true ||
          numberStatus?.status === 'valid' ||
          numberStatus?.onWhatsApp === true ||
          numberStatus?.isWhatsApp === true;
      } else if (checkResponse.data.exists !== undefined) {
        isValid = checkResponse.data.exists === true;
      }
    }

    await pool.query(
      `INSERT INTO number_validation_cache (phone_number, is_valid, checked_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (phone_number) 
       DO UPDATE SET is_valid = $2, checked_at = CURRENT_TIMESTAMP`,
      [normalizedNumber, isValid]
    );

    return { ok: true, isValid };
  } catch (error: any) {
    console.error(
      '❌ Erro ao verificar número via Evolution API:',
      error.message,
      maskPhone(phoneNumber)
    );
    return {
      ok: false,
      providerUnavailable: true,
      message: error.message || 'Erro ao validar número',
    };
  }
}

/**
 * Atualiza contato após checagem bem-sucedida (não usar em providerUnavailable).
 */
export async function applyWhatsAppValidationToContact(
  contactId: number,
  isValid: boolean
): Promise<void> {
  const blockedTagResult = await pool.query(
    `SELECT id FROM contact_tags WHERE LOWER(name) = 'bloqueado' LIMIT 1`
  );
  const blockedTagId = blockedTagResult.rows[0]?.id;

  await pool.query(
    `UPDATE contacts 
     SET whatsapp_validated = $1, 
         whatsapp_validated_at = ${isValid ? 'CURRENT_TIMESTAMP' : 'NULL'},
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [isValid, contactId]
  );

  if (isValid && blockedTagId) {
    await pool.query(
      `DELETE FROM contact_tag_relations WHERE contact_id = $1 AND tag_id = $2`,
      [contactId, blockedTagId]
    );
  } else if (!isValid && blockedTagId) {
    await pool.query(
      `INSERT INTO contact_tag_relations (contact_id, tag_id)
       VALUES ($1, $2)
       ON CONFLICT (contact_id, tag_id) DO NOTHING`,
      [contactId, blockedTagId]
    );
  }
}

/**
 * Valida múltiplos números e atualiza contatos no banco
 */
export async function validateContactsWhatsApp(
  contactIds: number[]
): Promise<{ validated: number; invalid: number; errors: number }> {
  const results = { validated: 0, invalid: 0, errors: 0 };

  const contactsResult = await pool.query(
    `SELECT id, phone_number FROM contacts WHERE id = ANY($1)`,
    [contactIds]
  );

  for (const contact of contactsResult.rows) {
    try {
      const detailed = await checkWhatsAppNumberDetailed(contact.phone_number);
      if (!detailed.ok) {
        results.errors++;
        continue;
      }
      await applyWhatsAppValidationToContact(contact.id, detailed.isValid);
      if (detailed.isValid) results.validated++;
      else results.invalid++;
    } catch (error: any) {
      console.error(`Erro ao validar contato ${contact.id}:`, error);
      results.errors++;
    }
  }

  return results;
}
