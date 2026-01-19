import axios from 'axios';
import { pool } from '../database';

/**
 * Verifica se um número de telefone está registrado no WhatsApp usando Evolution API
 */
export async function checkWhatsAppNumber(
  phoneNumber: string,
  instanceName?: string,
  apiUrl?: string,
  apiKey?: string
): Promise<{ isValid: boolean; cached?: boolean }> {
  try {
    // Normalizar número (remover + e caracteres não numéricos)
    const normalizedNumber = phoneNumber.replace(/[^\d]/g, '');
    
    if (!normalizedNumber || normalizedNumber.length < 10) {
      return { isValid: false };
    }

    // Verificar cache primeiro (24 horas)
    const cacheResult = await pool.query(
      `SELECT is_valid, checked_at 
       FROM number_validation_cache 
       WHERE phone_number = $1 
         AND checked_at > NOW() - INTERVAL '24 hours'`,
      [normalizedNumber]
    );

    if (cacheResult.rows.length > 0) {
      return { 
        isValid: cacheResult.rows[0].is_valid,
        cached: true
      };
    }

    // Buscar instância conectada se não fornecida
    let instance: any = null;
    if (!instanceName || !apiUrl || !apiKey) {
      const instanceResult = await pool.query(
        `SELECT instance_name, api_url, api_key 
         FROM instances 
         WHERE status = 'connected' 
         LIMIT 1`
      );
      
      if (instanceResult.rows.length === 0) {
        console.error('⚠️ Nenhuma instância conectada para validar número');
        return { isValid: false };
      }
      
      instance = instanceResult.rows[0];
      instanceName = instance.instance_name;
      apiUrl = instance.api_url;
      apiKey = instance.api_key;
    }

    // Verificar via Evolution API
    let checkUrl = `${apiUrl}/chat/whatsappNumbers/${instanceName}`;
    let checkResponse: any;
    
    try {
      // Tentar endpoint POST com array de números
      checkResponse = await axios.post(
        checkUrl,
        {
          numbers: [normalizedNumber],
        },
        {
          headers: {
            'apikey': apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
          validateStatus: () => true,
        }
      );
    } catch (postError: any) {
      // Se POST falhar, tentar GET com query parameter
      if (postError.response?.status === 404 || postError.code === 'ECONNREFUSED') {
        checkUrl = `${apiUrl}/chat/whatsappNumbers/${instanceName}?numbers=${normalizedNumber}`;
        checkResponse = await axios.get(checkUrl, {
          headers: {
            'apikey': apiKey,
          },
          timeout: 10000,
          validateStatus: () => true,
        });
      } else {
        throw postError;
      }
    }

    let isValid = false;

    // Evolution API retorna array com status de cada número
    if (checkResponse && checkResponse.data) {
      if (Array.isArray(checkResponse.data)) {
        const numberStatus = checkResponse.data.find((n: any) => 
          n.jid === `${normalizedNumber}@s.whatsapp.net` || 
          n.number === normalizedNumber ||
          n.jid?.includes(normalizedNumber)
        );
        isValid = numberStatus?.exists === true || 
                 numberStatus?.status === 'valid' || 
                 numberStatus?.onWhatsApp === true ||
                 numberStatus?.isWhatsApp === true;
      } else if (checkResponse.data.exists !== undefined) {
        isValid = checkResponse.data.exists === true;
      } else if (checkResponse.status === 200) {
        // Se retornou 200, assumir que está válido
        isValid = true;
      }
    }

    // Salvar no cache
    await pool.query(
      `INSERT INTO number_validation_cache (phone_number, is_valid, checked_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (phone_number) 
       DO UPDATE SET is_valid = $2, checked_at = CURRENT_TIMESTAMP`,
      [normalizedNumber, isValid]
    );

    return { isValid };
  } catch (error: any) {
    console.error('❌ Erro ao verificar número via Evolution API:', error.message);
    return { isValid: false };
  }
}

/**
 * Valida múltiplos números e atualiza contatos no banco
 */
export async function validateContactsWhatsApp(
  contactIds: number[]
): Promise<{ validated: number; invalid: number; errors: number }> {
  const results = { validated: 0, invalid: 0, errors: 0 };
  
  // Buscar tag "bloqueado"
  const blockedTagResult = await pool.query(
    `SELECT id FROM contact_tags WHERE LOWER(name) = 'bloqueado' OR LOWER(name) = 'bloqueado' LIMIT 1`
  );
  const blockedTagId = blockedTagResult.rows[0]?.id;

  // Buscar contatos
  const contactsResult = await pool.query(
    `SELECT id, phone_number FROM contacts WHERE id = ANY($1)`,
    [contactIds]
  );

  for (const contact of contactsResult.rows) {
    try {
      const { isValid } = await checkWhatsAppNumber(contact.phone_number);
      
      // Atualizar contato
      await pool.query(
        `UPDATE contacts 
         SET whatsapp_validated = $1, 
             whatsapp_validated_at = ${isValid ? 'CURRENT_TIMESTAMP' : 'NULL'},
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [isValid, contact.id]
      );

      if (isValid) {
        results.validated++;
        // Remover tag bloqueado se tiver
        if (blockedTagId) {
          await pool.query(
            `DELETE FROM contact_tag_relations 
             WHERE contact_id = $1 AND tag_id = $2`,
            [contact.id, blockedTagId]
          );
        }
      } else {
        results.invalid++;
        // Adicionar tag bloqueado
        if (blockedTagId) {
          await pool.query(
            `INSERT INTO contact_tag_relations (contact_id, tag_id)
             VALUES ($1, $2)
             ON CONFLICT (contact_id, tag_id) DO NOTHING`,
            [contact.id, blockedTagId]
          );
        }
      }
    } catch (error: any) {
      console.error(`Erro ao validar contato ${contact.id}:`, error);
      results.errors++;
    }
  }

  return results;
}
