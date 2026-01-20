import axios from 'axios';
import { pool } from '../database';
import { addLog } from '../routes/logs';

/**
 * Serviço para detectar intenção positiva em mensagens recebidas
 * Usa palavras-chave e análise de sentimento via OpenAI
 */

interface AIConfig {
  ai_webhook_url: string | null;
  positive_keywords: string[];
  sentiment_analysis_enabled: boolean;
  enabled: boolean;
}

interface DetectionResult {
  isPositive: boolean;
  confidence: number;
  method: 'keywords' | 'sentiment' | 'both';
  detectedKeywords?: string[];
  sentimentScore?: number;
}

/**
 * Detectar se uma mensagem indica intenção positiva
 */
export async function detectPositiveIntent(
  message: string,
  contactId: number,
  dispatchId: number
): Promise<DetectionResult> {
  try {
    console.log(`   🔍 [AI Detection] Verificando mensagem: "${message}"`);
    
    // Buscar configuração de IA
    const configResult = await pool.query(
      `SELECT * FROM marketing_ai_config WHERE enabled = true ORDER BY id DESC LIMIT 1`
    );

    if (configResult.rows.length === 0) {
      console.log(`   ⚠️ [AI Detection] Configuração de marketing não encontrada ou desabilitada`);
      return {
        isPositive: false,
        confidence: 0,
        method: 'keywords',
      };
    }

    const config: AIConfig = configResult.rows[0];
    console.log(`   📋 [AI Detection] Config encontrada:`, {
      keywords: config.positive_keywords,
      sentiment_enabled: config.sentiment_analysis_enabled,
      webhook_url: config.ai_webhook_url ? 'configurado' : 'não configurado',
    });
    
    const messageLower = message.toLowerCase().trim();

    // 1. Verificar palavras-chave
    const detectedKeywords: string[] = [];
    const keywordsList = config.positive_keywords || [];
    
    console.log(`   🔑 [AI Detection] Verificando ${keywordsList.length} palavras-chave...`);
    
    for (const keyword of keywordsList) {
      const keywordLower = keyword.toLowerCase();
      if (messageLower.includes(keywordLower)) {
        detectedKeywords.push(keyword);
        console.log(`   ✅ [AI Detection] Palavra-chave encontrada: "${keyword}"`);
      }
    }

    const hasKeywords = detectedKeywords.length > 0;
    let keywordConfidence = hasKeywords ? Math.min(0.7, 0.4 + (detectedKeywords.length * 0.1)) : 0;
    
    console.log(`   📊 [AI Detection] Palavras-chave: ${detectedKeywords.length} encontradas, confiança: ${keywordConfidence}`);

    // 2. Análise de sentimento (se habilitada)
    let sentimentScore = 0;
    let sentimentConfidence = 0;

    if (config.sentiment_analysis_enabled && config.ai_webhook_url) {
      try {
        sentimentScore = await analyzeSentiment(message, config.ai_webhook_url);
        sentimentConfidence = Math.abs(sentimentScore); // Quanto mais próximo de 1 ou -1, mais confiável
      } catch (error: any) {
        console.error('❌ Erro na análise de sentimento:', error.message);
      }
    }

    // 3. Decisão final
    let isPositive = false;
    let confidence = 0;
    let method: 'keywords' | 'sentiment' | 'both' = 'keywords';

    if (hasKeywords && sentimentScore > 0) {
      // Ambos indicam positivo
      isPositive = true;
      confidence = Math.max(keywordConfidence, sentimentConfidence);
      method = 'both';
    } else if (hasKeywords) {
      // Apenas palavras-chave
      isPositive = true;
      confidence = keywordConfidence;
      method = 'keywords';
    } else if (sentimentScore > 0.3 && sentimentConfidence > 0.5) {
      // Apenas sentimento positivo forte
      isPositive = true;
      confidence = sentimentConfidence;
      method = 'sentiment';
    }

    // Registrar detecção no banco
    await pool.query(
      `INSERT INTO ai_detections (
        contact_id, dispatch_id, message, is_positive,
        confidence, method, detected_keywords, sentiment_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        contactId,
        dispatchId,
        message,
        isPositive,
        confidence,
        method,
        detectedKeywords.length > 0 ? detectedKeywords : null,
        sentimentScore !== 0 ? sentimentScore : null,
      ]
    );

    return {
      isPositive,
      confidence,
      method,
      detectedKeywords: detectedKeywords.length > 0 ? detectedKeywords : undefined,
      sentimentScore: sentimentScore !== 0 ? sentimentScore : undefined,
    };
  } catch (error: any) {
    console.error('❌ Erro ao detectar intenção positiva:', error);
    return {
      isPositive: false,
      confidence: 0,
      method: 'keywords',
    };
  }
}

/**
 * Analisar sentimento usando OpenAI via webhook
 */
async function analyzeSentiment(message: string, webhookUrl: string): Promise<number> {
  try {
    // Chamar webhook de análise de sentimento
    // O webhook deve retornar um score entre -1 (negativo) e 1 (positivo)
    const response = await axios.post(
      webhookUrl,
      {
        message,
        task: 'sentiment_analysis',
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 segundos
      }
    );

    // Esperar resposta no formato: { sentiment_score: 0.8 } ou { score: 0.8 }
    const score = response.data?.sentiment_score || 
                  response.data?.score || 
                  response.data?.sentiment || 
                  0;

    // Garantir que está entre -1 e 1
    return Math.max(-1, Math.min(1, parseFloat(score) || 0));
  } catch (error: any) {
    console.error('❌ Erro ao chamar webhook de análise de sentimento:', error.message);
    return 0;
  }
}

/**
 * Ativar IA externa quando detectar intenção positiva
 */
export async function triggerAIInteraction(
  dispatchId: number,
  contactId: number,
  userMessage: string
): Promise<void> {
  try {
    // Verificar se já existe uma interação recente (últimos 5 minutos) para evitar duplicação
    const recentInteraction = await pool.query(
      `SELECT id FROM ai_interactions 
       WHERE dispatch_id = $1 
         AND contact_id = $2 
         AND user_message = $3
         AND triggered_at > NOW() - INTERVAL '5 minutes'`,
      [dispatchId, contactId, userMessage]
    );

    if (recentInteraction.rows.length > 0) {
      const duplicateLog = `⚠️ Interação já processada recentemente para contato ${contactId} no disparo ${dispatchId}. Ignorando duplicação.`;
      console.log(`   ${duplicateLog}`);
      addLog('warning', duplicateLog);
      return;
    }

    // Buscar dados do disparo e contato separadamente
    const dispatchResult = await pool.query(
      `SELECT id, name, message_template, metadata
       FROM dispatches
       WHERE id = $1`,
      [dispatchId]
    );

    const contactResult = await pool.query(
      `SELECT id, phone_number, name
       FROM contacts
       WHERE id = $1`,
      [contactId]
    );

    if (dispatchResult.rows.length === 0) {
      const errorMsg = `❌ Disparo ${dispatchId} não encontrado`;
      console.error(errorMsg);
      addLog('error', errorMsg);
      return;
    }

    if (contactResult.rows.length === 0) {
      const errorMsg = `❌ Contato ${contactId} não encontrado`;
      console.error(errorMsg);
      addLog('error', errorMsg);
      return;
    }

    const dispatch = dispatchResult.rows[0];
    const contact = contactResult.rows[0];
    const phone_number = contact.phone_number;
    const name = contact.name || 'Sem nome';

    // Buscar configuração de IA
    const configResult = await pool.query(
      `SELECT ai_webhook_url FROM marketing_ai_config WHERE enabled = true ORDER BY id DESC LIMIT 1`
    );

    if (configResult.rows.length === 0 || !configResult.rows[0].ai_webhook_url) {
      console.error('❌ Webhook de IA não configurado');
      return;
    }

    const aiWebhookUrl = configResult.rows[0].ai_webhook_url;

    // Preparar dados para enviar à IA
    const metadata = typeof dispatch.metadata === 'string' 
      ? JSON.parse(dispatch.metadata) 
      : dispatch.metadata || {};

    const payload = {
      dispatch_id: dispatchId,
      dispatch_name: dispatch.name,
      dispatch_content: dispatch.message_template,
      contact_id: contactId,
      contact_name: name,
      contact_phone: phone_number,
      user_message: userMessage,
      media_url: metadata.media_url || null,
      media_type: metadata.media_type || null,
      timestamp: new Date().toISOString(),
    };

    // Chamar webhook da IA
    const webhookCallLog = `📤 CHAMANDO WEBHOOK DO N8N - URL: ${aiWebhookUrl}`;
    console.log(`\n   ========================================`);
    console.log(`   ${webhookCallLog}`);
    console.log(`   ========================================`);
    console.log(`   Payload:`, JSON.stringify(payload, null, 2));
    console.log(`   ========================================\n`);
    addLog('info', webhookCallLog);
    addLog('info', `Payload: ${JSON.stringify(payload)}`);
    
    try {
      const response = await axios.post(
        aiWebhookUrl,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 segundos
        }
      );
      
      const successLog = `✅ WEBHOOK CHAMADO COM SUCESSO! Status: ${response.status}`;
      console.log(`\n   ${successLog}`);
      console.log(`   Resposta:`, JSON.stringify(response.data, null, 2));
      console.log(`\n`);
      addLog('success', successLog);
      addLog('info', `Resposta do N8N: ${JSON.stringify(response.data)}`);
    } catch (error: any) {
      const errorLog = `❌ ERRO AO CHAMAR WEBHOOK DO N8N! URL: ${aiWebhookUrl} | Erro: ${error.message}`;
      console.error(`\n   ${errorLog}`);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Resposta:`, JSON.stringify(error.response.data, null, 2));
        addLog('error', `${errorLog} | Status: ${error.response.status} | Resposta: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        console.error(`   Request enviado mas sem resposta do servidor`);
        addLog('error', `${errorLog} | Sem resposta do servidor`);
      } else {
        addLog('error', errorLog);
      }
      console.error(`\n`);
      throw error;
    }

    // Registrar ativação da IA
    await pool.query(
      `INSERT INTO ai_interactions (
        dispatch_id, contact_id, user_message, triggered_at
      ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [dispatchId, contactId, userMessage]
    );

    console.log(`✅ IA ativada para contato ${contactId} no disparo ${dispatchId}`);
  } catch (error: any) {
    console.error('❌ Erro ao ativar IA externa:', error);
  }
}
