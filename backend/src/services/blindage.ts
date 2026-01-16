import { pool } from '../database';

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
    let query = `
      SELECT * FROM blindage_rules 
      WHERE enabled = TRUE
    `;
    const params: any[] = [];

    if (instanceId) {
      query += ` AND instance_id = $1`;
      params.push(instanceId);
    }

    query += ` ORDER BY rule_type, id`;

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

    // 2. Validar conteúdo
    const contentValidation = await validateContent(messageData.message, rules);
    if (!contentValidation.canSend) {
      return contentValidation;
    }

    // 3. Selecionar instância (rotação)
    const instanceSelection = await selectInstance(messageData.instanceId, rules);
    if (!instanceSelection.canSend) {
      return instanceSelection;
    }

    // 4. Verificar saúde da instância
    const healthCheck = await checkInstanceHealth(instanceSelection.selectedInstanceId!, rules);
    if (!healthCheck.canSend) {
      return healthCheck;
    }

    // 5. Verificar limites
    const limitCheck = await checkLimits(instanceSelection.selectedInstanceId!, rules);
    if (!limitCheck.canSend) {
      return limitCheck;
    }

    // 6. Verificar horários permitidos
    const timeCheck = await checkAllowedHours(instanceSelection.selectedInstanceId!, rules);
    if (!timeCheck.canSend) {
      return timeCheck;
    }

    // 7. Calcular delay necessário
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
 * Seleciona instância para envio (rotação)
 */
async function selectInstance(
  preferredInstanceId: number | undefined,
  rules: BlindageRule[]
): Promise<BlindageResult> {
  const rotationRule = rules.find(r => r.rule_type === 'instance_rotation');
  
  // Se não há regra de rotação e tem instância preferida, usa ela
  if (!rotationRule || !rotationRule.enabled) {
    if (preferredInstanceId) {
      return {
        canSend: true,
        selectedInstanceId: preferredInstanceId,
      };
    }
    // Se não tem instância preferida, busca uma conectada
    const result = await pool.query(
      `SELECT id FROM instances WHERE status = 'connected' ORDER BY RANDOM() LIMIT 1`
    );
    if (result.rows.length === 0) {
      return {
        canSend: false,
        reason: 'Nenhuma instância conectada disponível',
        blockedBy: 'instance_rotation',
      };
    }
    return {
      canSend: true,
      selectedInstanceId: result.rows[0].id,
    };
  }

  const config = rotationRule.config || {};
  
  // Buscar instâncias conectadas
  const instancesResult = await pool.query(
    `SELECT id, name, instance_name, last_message_sent_at 
     FROM instances 
     WHERE status = 'connected' 
     ORDER BY 
       COALESCE(last_message_sent_at, '1970-01-01'::timestamp) ASC,
       id ASC`
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
