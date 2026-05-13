import { pool } from '../database';
import { GeminiService } from './GeminiService';
import { addLog } from '../routes/logs';

interface DevocionalAIConfig {
  central_theme: string;
  journey_description: string;
  preaching_tone: string;
  bible_version: string;
  signature: string;
  gemini_api_key: string;
  model_name: string;
  character_limit: number;
}

export class DevocionalGenerator {
  /**
   * Gera um devocional para uma data específica
   */
  async generate(date: string): Promise<any> {
    try {
      addLog('info', `[AI Generator] Iniciando geração de devocional para ${date}`);

      // 1. Buscar configuração de IA
      const configResult = await pool.query(
        `SELECT * FROM devocional_ai_config WHERE enabled = true LIMIT 1`
      );

      if (configResult.rows.length === 0) {
        throw new Error('Configuração de IA de devocional não encontrada ou desativada.');
      }

      const config: DevocionalAIConfig = configResult.rows[0];
      const apiKey = config.gemini_api_key || process.env.GEMINI_API_KEY;

      if (!apiKey) {
        throw new Error('Chave de API do Gemini não configurada.');
      }

      const gemini = new GeminiService(apiKey, config.model_name);

      // 2. Buscar contexto histórico (últimos 30 dias)
      const contextResult = await pool.query(
        `SELECT date, title, metadata FROM devocionais 
         WHERE date < $1 
         ORDER BY date DESC LIMIT 30`,
        [date]
      );

      const history = contextResult.rows.map(d => ({
        data: d.date,
        titulo: d.title,
        tema: d.metadata?.tema,
        conceito: d.metadata?.conceito_central,
        palavras_chave: d.metadata?.palavras_chave
      }));

      // 3. Analisar Jornada (Onde estamos e para onde vamos)
      const analysisPrompt = `
        Você é um especialista em análise de conteúdo devocional e jornadas espirituais.
        
        TEMA CENTRAL DA JORNADA: "${config.central_theme}"
        DESCRIÇÃO DA JORNADA: "${config.journey_description}"
        
        HISTÓRICO RECENTE (Últimos 30 dias):
        ${JSON.stringify(history, null, 2)}
        
        SUA MISSÃO:
        Analise o histórico e sugira o próximo passo na jornada espiritual.
        
        REGRAS:
        - Identifique temas já abordados para evitar repetição.
        - Sugira um novo conceito central que avance na jornada "${config.central_theme}".
        - Forneça um direcionamento teológico claro para o próximo devocional.
      `;

      const analysisSchema = {
        analise: {
          temas_abordados: ["string"],
          progressao: "string",
          proximo_passo: "string"
        },
        sugestao: {
          tema_sugerido: "string",
          conceito_central: "string",
          direcionamento: "string"
        }
      };

      const analysis = await gemini.generateStructuredContent<any>(analysisPrompt, analysisSchema);
      addLog('info', `[AI Generator] Análise concluída: ${analysis.sugestao.tema_sugerido}`);

      // 4. Gerar o Devocional Final
      const creationPrompt = `
        Você é um Pastor experiente, especializado em pregação bíblica poderosa e inspiradora.
        Seu tom é: ${config.preaching_tone}
        Versão Bíblica: ${config.bible_version}
        
        CONTEXTO DA JORNADA:
        "${analysis.analise.progressao}"
        
        DIRECIONAMENTO DE HOJE:
        "${analysis.sugestao.direcionamento}"
        
        CONCEITO A TRABALHAR:
        "${analysis.sugestao.conceito_central}"
        
        ESTRUTURA DO DEVOCIONAL (WhatsApp):
        1. Data formatada (Ex: Terça-feira, 12 de Maio de 2026)
        2. Título Inspirador (🌟 *Título*)
        3. Dois Versículos Inéditos (📖 *Versículo Principal* e 📖 *Versículo de Apoio*) - use ${config.bible_version}
        4. Reflexão (💬) - 3 a 4 parágrafos envolventes
        5. Aplicação Prática (🌱)
        6. Oração (🙏)
        7. Assinatura: ${config.signature}
        
        REGRAS CRÍTICAS:
        - NUNCA use negrito (**). Use *itálico* apenas em títulos de seções.
        - Limite máximo de ${config.character_limit} caracteres.
        - Não inclua saudações personalizadas (Bom dia, etc).
      `;

      const creationSchema = {
        text: "string (conteúdo completo formatado para WhatsApp)",
        title: "string (apenas o título)",
        versiculo_principal: {
          texto: "string",
          referencia: "string"
        },
        versiculo_apoio: {
          texto: "string",
          referencia: "string"
        },
        metadata: {
          tema: "string",
          conceito_central: "string",
          palavras_chave: ["string"],
          relacionado_expressar: "string"
        }
      };

      const result = await gemini.generateStructuredContent<any>(creationPrompt, creationSchema);

      // 5. Salvar no Banco de Dados
      await pool.query(
        `INSERT INTO devocionais (date, title, text, versiculo_principal, versiculo_apoio, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (date) DO UPDATE SET
           title = EXCLUDED.title,
           text = EXCLUDED.text,
           versiculo_principal = EXCLUDED.versiculo_principal,
           versiculo_apoio = EXCLUDED.versiculo_apoio,
           metadata = EXCLUDED.metadata,
           updated_at = CURRENT_TIMESTAMP`,
        [
          date,
          result.title,
          result.text,
          JSON.stringify(result.versiculo_principal),
          JSON.stringify(result.versiculo_apoio),
          JSON.stringify(result.metadata)
        ]
      );

      addLog('success', `[AI Generator] Devocional gerado e salvo para ${date}`);
      return result;

    } catch (error: any) {
      addLog('error', `[AI Generator] Falha na geração: ${error.message}`);
      throw error;
    }
  }
}
