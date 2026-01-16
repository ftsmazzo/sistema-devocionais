import { pool } from '../database';
import axios from 'axios';

export interface BlindageRule {
  id: number;
  instance_id: number;
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
 * Busca regras ativas de blindagem para uma instância
 */
export async function getActiveRules(instanceId?: number): Promise<BlindageRule[]> {
  try {
    let query: string;
    const params: any[] = [];

    if (instanceId) {
      // Buscar regras globais (instance_id IS NULL) e regras específicas da instância
      query = `
        SELECT * FROM blindage_rules 
        WHERE enabled = TRUE
          AND (
            instance_id IS NULL 
            OR instance_id = $1
          )
        ORDER BY instance_id NULLS FIRST, rule_type, id
      `;
      params.push(instanceId);
    } else {
      // Se não há instanceId, buscar TODAS as regras (globais e de todas as instâncias)
      // Isso permite que o sistema funcione mesmo sem instanceId específico
      query = `
        SELECT * FROM blindage_rules 
        WHERE enabled = TRUE
        ORDER BY instance_id NULLS FIRST, rule_type, id
      `;
    }

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('Erro ao buscar regras de blindagem:', error);
    return [];
  }
}

/**
 * Aplica todas as blindagens antes de enviar mensagem
 */
export async function applyBlindage(
  messageData: {
    to: string;
    message: string;
    instanceId?: number;
    messageType?: string;
  }
): Promise<BlindageResult> {
  try {
    // 1. Buscar regras ativas
    const rules = await getActiveRules(messageData.instanceId);

    // 2. Validar número e verificar WhatsApp
    const numberValidation = await validatePhoneNumber(messageData.to, messageData.instanceId, rules);
    if (!numberValidation.canSend) {
      return numberValidation;
    }

    // 3. Validar conteúdo
    const contentValidation = await validateContent(messageData.message, rules);
    if (!contentValidation.canSend) {
      return contentValidation;
    }

    // 4. Selecionar instância (seleção + rotação)
    const instanceSelection = await selectInstance(messageData.instanceId, rules);
    if (!instanceSelection.canSend) {
      return instanceSelection;
    }

    // 5. Verificar saúde da instância
    const healthCheck = await checkInstanceHealth(instanceSelection.selectedInstanceId!, rules);
    if (!healthCheck.canSend) {
      return healthCheck;
    }

    // 6. Verificar limites
    const limitCheck = await checkLimits(instanceSelection.selectedInstanceId!, rules);
    if (!limitCheck.canSend) {
      return limitCheck;
    }

    // 7. Verificar horários permitidos
    const timeCheck = await checkAllowedHours(instanceSelection.selectedInstanceId!, rules);
    if (!timeCheck.canSend) {
      return timeCheck;
    }

    // 8. Calcular delay necessário
    const delay = await calculateDelay(instanceSelection.selectedInstanceId!, rules);

    // 8. Registrar ação de blindagem
    await logBlindageAction(instanceSelection.selectedInstanceId!, {
      action_type: 'blindage_applied',
      delay_applied: delay,
      rules_applied: rules.map(r => r.rule_type),
    });

    return {
      canSend: true,
      delay,
      selectedInstanceId: instanceSelection.selectedInstanceId,
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

  const config = numberValidationRule.config || {};

  // Normalizar número (sempre fazer, mesmo se não validar formato)
  const cleanNumber = phoneNumber.replace(/[\s\-\(\)]/g, '');
  let normalizedNumber = cleanNumber;
  
  if (!normalizedNumber.startsWith('+')) {
    // Se não tem +, assumir código do Brasil (55) se não especificado
    if (config.default_country_code) {
      normalizedNumber = `+${config.default_country_code}${normalizedNumber}`;
    } else if (normalizedNumber.startsWith('55')) {
      normalizedNumber = `+${normalizedNumber}`;
    } else {
      normalizedNumber = `+55${normalizedNumber}`;
    }
  }

  // 1. Validar formato do número (E.164)
  if (config.validate_format !== false) {
    // Validar formato E.164 básico: +[1-9][0-9]{1,14}
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    if (!e164Regex.test(normalizedNumber)) {
      await logBlindageAction(numberValidationRule.instance_id, {
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

      // Buscar dados da instância
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

      // Normalizar número para verificação (remover +)
      const numberToCheck = normalizedNumber.replace('+', '');

      // Verificar cache primeiro
      const cacheKey = `whatsapp_check_${numberToCheck}`;
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

          // Evolution API retorna array com status de cada número
          if (checkResponse && checkResponse.data) {
            if (Array.isArray(checkResponse.data)) {
              const numberStatus = checkResponse.data.find((n: any) => 
                n.jid === `${numberToCheck}@s.whatsapp.net` || 
                n.number === numberToCheck ||
                n.jid?.includes(numberToCheck)
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
            [numberToCheck, isValid]
          );

          console.log(`   ${isValid ? '✅' : '❌'} Número verificado via API: ${numberToCheck} = ${isValid ? 'válido' : 'inválido'}`);
        } catch (apiError: any) {
          console.error('   ⚠️ Erro ao verificar número via Evolution API:', apiError.message);
          
          // Se falhar e não for obrigatório, permitir envio
          if (config.require_whatsapp_check !== true) {
            console.log('   ⚠️ Verificação falhou, mas permitindo envio (não obrigatório)');
            return { canSend: true };
          }

          await logBlindageAction(numberValidationRule.instance_id, {
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
        await logBlindageAction(numberValidationRule.instance_id, {
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

/**
 * Valida conteúdo da mensagem
 */
async function validateContent(message: string, rules: BlindageRule[]): Promise<BlindageResult> {
  const contentRule = rules.find(r => r.rule_type === 'content_validation');
  if (!contentRule || !contentRule.enabled) {
    return { canSend: true };
  }

  const config = contentRule.config || {};
  const instanceId = contentRule.instance_id;

  // Verificar tamanho máximo
  if (config.max_length && message.length > config.max_length) {
    await logBlindageAction(instanceId, {
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
        await logBlindageAction(instanceId, {
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
    const config = selectionRule.config || {};
    
    // Parse config se for string (vindo do banco)
    const parsedConfig = typeof config === 'string' ? JSON.parse(config) : config;
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

  const config = rotationRule.config || {};
  
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
  
  // Verificar delay mínimo entre instâncias
  if (config.min_delay_between_instances) {
    const lastSent = selectedInstance.last_message_sent_at;
    if (lastSent) {
      const secondsSinceLastSent = (Date.now() - new Date(lastSent).getTime()) / 1000;
      if (secondsSinceLastSent < config.min_delay_between_instances) {
        const delayNeeded = config.min_delay_between_instances - secondsSinceLastSent;
        return {
          canSend: true,
          selectedInstanceId: selectedInstance.id,
          delay: Math.ceil(delayNeeded * 1000), // em milissegundos
        };
      }
    }
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
  const healthRule = rules.find(r => r.rule_type === 'health_check');
  if (!healthRule || !healthRule.enabled) {
    return { canSend: true };
  }

  const config = healthRule.config || {};

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

  // Se está down e configurado para pausar
  if (config.pause_if_down && instance.health_status === 'down') {
    await logBlindageAction(instanceId, {
      action_type: 'health_blocked',
      reason: 'instance_down',
    }, healthRule.id);

    return {
      canSend: false,
      reason: 'Instância está down',
      blockedBy: 'health_check',
    };
  }

  // Se está degradada e configurado para pausar
  if (config.pause_if_degraded && instance.health_status === 'degraded') {
    await logBlindageAction(instanceId, {
      action_type: 'health_blocked',
      reason: 'instance_degraded',
    }, healthRule.id);

    return {
      canSend: false,
      reason: 'Instância está degradada',
      blockedBy: 'health_check',
    };
  }

  return { canSend: true };
}

/**
 * Verifica limites de envio
 */
async function checkLimits(instanceId: number, rules: BlindageRule[]): Promise<BlindageResult> {
  const limitRule = rules.find(r => r.rule_type === 'message_limit');
  if (!limitRule || !limitRule.enabled) {
    return { canSend: true };
  }

  const config = limitRule.config || {};
  const now = new Date();
  const currentHour = now.getHours();
  const currentDate = now.toISOString().split('T')[0];

  // Verificar limite por hora
  if (config.max_per_hour) {
    const hourMetrics = await pool.query(
      `SELECT messages_sent 
       FROM message_metrics 
       WHERE instance_id = $1 
         AND metric_date = $2 
         AND hour = $3`,
      [instanceId, currentDate, currentHour]
    );

    const sentThisHour = hourMetrics.rows[0]?.messages_sent || 0;
    if (sentThisHour >= config.max_per_hour) {
      await logBlindageAction(instanceId, {
        action_type: 'limit_reached',
        limit_type: 'hourly',
        current: sentThisHour,
        max: config.max_per_hour,
      }, limitRule.id);

      return {
        canSend: false,
        reason: `Limite horário atingido: ${sentThisHour}/${config.max_per_hour} mensagens`,
        blockedBy: 'message_limit',
      };
    }
  }

  // Verificar limite por dia
  if (config.max_per_day) {
    const dayMetrics = await pool.query(
      `SELECT SUM(messages_sent) as total 
       FROM message_metrics 
       WHERE instance_id = $1 
         AND metric_date = $2`,
      [instanceId, currentDate]
    );

    const sentToday = parseInt(dayMetrics.rows[0]?.total || '0');
    if (sentToday >= config.max_per_day) {
      await logBlindageAction(instanceId, {
        action_type: 'limit_reached',
        limit_type: 'daily',
        current: sentToday,
        max: config.max_per_day,
      }, limitRule.id);

      return {
        canSend: false,
        reason: `Limite diário atingido: ${sentToday}/${config.max_per_day} mensagens`,
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
  if (!timeRule || !timeRule.enabled) {
    return { canSend: true };
  }

  const config = timeRule.config || {};
  const now = new Date();
  const currentHour = now.getHours();

  // Verificar horas bloqueadas
  if (config.blocked_hours && Array.isArray(config.blocked_hours)) {
    if (config.blocked_hours.includes(currentHour)) {
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
      await logBlindageAction(instanceId, {
        action_type: 'time_blocked',
        reason: 'not_allowed_hour',
        current_hour: currentHour,
      }, timeRule.id);

      return {
        canSend: false,
        reason: `Envio não permitido no horário atual (${currentHour}h)`,
        blockedBy: 'allowed_hours',
      };
    }
  }

  return { canSend: true };
}

/**
 * Calcula delay necessário antes de enviar
 */
async function calculateDelay(instanceId: number, rules: BlindageRule[]): Promise<number> {
  const delayRule = rules.find(r => r.rule_type === 'message_delay');
  if (!delayRule || !delayRule.enabled) {
    return 0;
  }

  const config = delayRule.config || {};
  let delay = config.min_delay_seconds || 3;

  // Delay progressivo
  if (config.progressive) {
    // Buscar quantas mensagens foram enviadas na última hora
    const now = new Date();
    const currentHour = now.getHours();
    const currentDate = now.toISOString().split('T')[0];

    const metrics = await pool.query(
      `SELECT messages_sent 
       FROM message_metrics 
       WHERE instance_id = $1 
         AND metric_date = $2 
         AND hour = $3`,
      [instanceId, currentDate, currentHour]
    );

    const messagesThisHour = metrics.rows[0]?.messages_sent || 0;
    const baseDelay = config.base_delay || delay;
    const increment = config.increment_per_message || 0.5;

    delay = baseDelay + (messagesThisHour * increment);

    // Limitar delay máximo
    if (config.max_delay_seconds && delay > config.max_delay_seconds) {
      delay = config.max_delay_seconds;
    }
  }

  // Verificar última mensagem enviada
  const instanceResult = await pool.query(
    `SELECT last_message_sent_at FROM instances WHERE id = $1`,
    [instanceId]
  );

  if (instanceResult.rows[0]?.last_message_sent_at) {
    const lastSent = new Date(instanceResult.rows[0].last_message_sent_at);
    const secondsSinceLastSent = (Date.now() - lastSent.getTime()) / 1000;

    if (secondsSinceLastSent < delay) {
      const delayNeeded = (delay - secondsSinceLastSent) * 1000; // em milissegundos
      return Math.ceil(delayNeeded);
    }
  }

  return 0; // Não precisa de delay
}

/**
 * Registra ação de blindagem
 */
async function logBlindageAction(
  instanceId: number,
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

/**
 * Cria regras padrão de blindagem para uma instância
 */
export async function createDefaultRules(instanceId: number): Promise<void> {
  try {
    const defaultRules = [
      {
        instance_id: instanceId,
        rule_name: 'Delay Mínimo Entre Mensagens',
        rule_type: 'message_delay',
        enabled: true,
        config: {
          min_delay_seconds: 3,
          max_delay_seconds: 10,
          progressive: true,
          base_delay: 3,
          increment_per_message: 0.5,
        },
      },
      {
        instance_id: instanceId,
        rule_name: 'Limite de Mensagens',
        rule_type: 'message_limit',
        enabled: true,
        config: {
          max_per_hour: 50,
          max_per_day: 500,
          reset_hour: 0,
          reset_day: 1,
        },
      },
      {
        instance_id: instanceId,
        rule_name: 'Rotação de Instâncias',
        rule_type: 'instance_rotation',
        enabled: true,
        config: {
          enabled: true,
          min_delay_between_instances: 1,
          round_robin: true,
        },
      },
      {
        instance_id: instanceId,
        rule_name: 'Horários Permitidos',
        rule_type: 'allowed_hours',
        enabled: true,
        config: {
          allowed_hours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
          blocked_hours: [22, 23, 0, 1, 2, 3, 4, 5, 6, 7],
          timezone: 'America/Sao_Paulo',
        },
      },
      {
        instance_id: instanceId,
        rule_name: 'Health Check',
        rule_type: 'health_check',
        enabled: true,
        config: {
          pause_if_degraded: true,
          pause_if_down: true,
          check_interval_seconds: 60,
        },
      },
      {
        instance_id: instanceId,
        rule_name: 'Validação de Conteúdo',
        rule_type: 'content_validation',
        enabled: true,
        config: {
          max_length: 4096,
          blocked_words: [],
        },
      },
      {
        instance_id: instanceId,
        rule_name: 'Validação de Número',
        rule_type: 'number_validation',
        enabled: true,
        config: {
          validate_format: true,
          check_whatsapp: true,
          require_whatsapp_check: false, // Se true, bloqueia se não conseguir verificar
          default_country_code: '55', // Código do Brasil
          cache_hours: 24, // Cache por 24 horas
          timeout_ms: 10000, // Timeout de 10 segundos
        },
      },
      // Regra de seleção de instâncias é GLOBAL (instance_id = NULL)
      // Criar apenas uma vez, não por instância
      {
        instance_id: null, // NULL = regra global
        rule_name: 'Seleção de Instâncias',
        rule_type: 'instance_selection',
        enabled: true,
        config: {
          selected_instance_ids: [], // IDs das instâncias selecionadas (vazio = todas)
          max_simultaneous: 1, // Máximo de instâncias simultâneas
          auto_switch_on_failure: true, // Trocar automaticamente quando uma instância cair
          retry_after_pause: true, // Reiniciar com outra instância após pausa
        },
      },
    ];

    for (const rule of defaultRules) {
      await pool.query(
        `INSERT INTO blindage_rules (instance_id, rule_name, rule_type, enabled, config)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [rule.instance_id, rule.rule_name, rule.rule_type, rule.enabled, JSON.stringify(rule.config)]
      );
    }

    console.log(`✅ Regras padrão de blindagem criadas para instância ${instanceId}`);
  } catch (error) {
    console.error('Erro ao criar regras padrão:', error);
  }
}
